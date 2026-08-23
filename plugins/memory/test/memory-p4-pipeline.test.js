// P4-2 管线测试：嵌入存储方法 / 混合融合纯函数 / 查询并集 / drain 回填 / 真模型端到端。
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { EmbeddingRuntime } from '../src/core/embedding.ts'
import { EMBEDDING_MANIFEST_NAME, readEmbeddingManifest, verifyEmbeddingManifest } from '../src/core/embedding-manifest.ts'
import { drainEmbeddings } from '../src/core/embedding-pipeline.ts'
import { cosineSimilarity, rankByScore, rrfFuse, topFused, vectorCandidates } from '../src/core/hybrid.ts'
import { openShard } from '../src/core/store.ts'
import { MemoryService } from '../src/core/service.ts'
import { normalizedHash } from '../src/core/gates.ts'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-memory-p4p-'))
  const service = new MemoryService({ dbRoot: join(root, 'memory-live'), encrypted: false })
  return { root, service }
}

const GEN = 'gen-v1'

// ---------- 存储管线 ----------

test('embedding jobs lifecycle: pending → ready, failed retries, stale on generation change', () => {
  const { root, service } = fixture()
  try {
    service.record({ kind: 'pattern', text: '出包之前必须跑完整测试和预检再发布', scope: 'global_user', confirm: true })
    service.record({ kind: 'pattern', text: '数据库迁移前先做在线一致性备份', scope: 'global_user', confirm: true })
    // 未确认候选不入队
    service.record({ kind: 'pattern', text: '尚未确认的候选内容', scope: 'global_user', confirm: false })
    const pending = service.pendingEmbeddings('global_user', undefined, GEN)
    assert.equal(pending.length, 2)
    assert.match(pending[0].text, /出包|备份/u)
    // 存储向量 → ready
    service.storeEmbedding({
      id: pending[0].id, scope: 'global_user', providerId: 'local-onnx', modelId: 'fake', modelRevision: 'r1',
      dimensions: 4, contentHash: normalizedHash(pending[0].text), vector: new Float32Array([0.5, 0.5, 0.5, 0.5]), generation: GEN,
    })
    assert.equal(service.pendingEmbeddings('global_user', undefined, GEN).length, 1)
    assert.equal(service.embeddingStats('global_user', undefined).ready, 1)
    const vectors = service.activeEmbeddingVectors('global_user', undefined, GEN)
    assert.equal(vectors.length, 1)
    assert.equal(vectors[0].claimId, pending[0].id)
    assert.equal(vectors[0].vector.length, 4)
    // 失败 + 重试上限（3 次后不再重试）
    const second = service.pendingEmbeddings('global_user', undefined, GEN)[0]
    service.markEmbeddingFailed('global_user', undefined, second.id, 'EMBED_FAILED')
    assert.equal(service.pendingEmbeddings('global_user', undefined, GEN).length, 1) // retries=1 < 3 仍可重试
    service.markEmbeddingFailed('global_user', undefined, second.id, 'EMBED_FAILED')
    service.markEmbeddingFailed('global_user', undefined, second.id, 'EMBED_FAILED')
    assert.equal(service.pendingEmbeddings('global_user', undefined, GEN).length, 0) // retries=3 不再重试
    assert.equal(service.embeddingStats('global_user', undefined).failed, 1)
    // generation 变更 → 退役 + stale 重排队
    const retired = service.retireStaleEmbeddings('global_user', undefined, 'gen-v2')
    assert.equal(retired, 1)
    assert.equal(service.activeEmbeddingVectors('global_user', undefined, GEN).length, 0)
    assert.equal(service.embeddingStats('global_user', undefined).stale, 1)
    assert.equal(service.pendingEmbeddings('global_user', undefined, 'gen-v2').length, 1)
  } finally {
    service.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('storeEmbedding backfills missing job rows and reconcile repairs legacy embeddings', () => {
  const { root, service } = fixture()
  try {
    // 模拟迁移前旧条目：直接写 claims（无作业行），再直接写 embeddings（无作业行）
    const shard = openShard(join(root, 'memory-live', 'private', 'user.sqlite3'), { encrypted: false })
    shard.db.prepare("INSERT INTO claims(id, scope_kind, scope_id, kind, canonical_text, searchable_text, status, authority_class, confidence, importance, sensitivity_class, normalized_content_hash, created_at, updated_at) VALUES ('legacy-1', 'global_user', 'user:cyrus', 'pattern', '旧条目一：没有作业行', '', 'active', 'user_confirmed', 50, 50, 'internal', 'h1', '2026-08-17T00:00:00Z', '2026-08-17T00:00:00Z')").run()
    shard.db.prepare("INSERT INTO embeddings(claim_id, provider_id, model_id, model_revision, dimensions, encoding, normalization, content_hash, vector_blob, generated_at, generation, status) VALUES ('legacy-1', 'local-onnx', 'fake', 'r1', 4, 'float32-le', 'l2', 'h1', X'0000803F0000803F0000803F0000803F', '2026-08-17T00:00:00Z', ?, 'active')").run(GEN)
    shard.db.close()
    // 对账前：stats 看不到 legacy（无作业行）
    assert.equal(service.embeddingStats('global_user', undefined).ready, 0)
    // 对账补行
    const added = service.reconcileEmbeddingJobs('global_user', undefined, GEN)
    assert.equal(added, 1)
    assert.equal(service.embeddingStats('global_user', undefined).ready, 1)
    assert.equal(service.pendingEmbeddings('global_user', undefined, GEN).length, 0)
    // storeEmbedding 对无作业行条目也会补行
    service.record({ kind: 'pattern', text: '旧条目二：等 storeEmbedding 补作业行', scope: 'global_user', confirm: true })
    const pending = service.pendingEmbeddings('global_user', undefined, GEN)
    assert.equal(pending.length, 1)
    service.storeEmbedding({
      id: pending[0].id, scope: 'global_user', providerId: 'local-onnx', modelId: 'fake', modelRevision: 'r1',
      dimensions: 4, contentHash: 'h2', vector: new Float32Array([0.5, 0.5, 0.5, 0.5]), generation: GEN,
    })
    assert.equal(service.embeddingStats('global_user', undefined).ready, 2)
  } finally {
    service.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('project-scope embeddings stay isolated from global', () => {
  const { root, service } = fixture()
  try {
    service.registerProject('proj-A')
    service.record({ kind: 'project_fact', text: '项目专属：发布时先跑完整测试', scope: 'project', projectId: 'proj-A', confirm: true })
    const pendingProject = service.pendingEmbeddings('project', 'proj-A', GEN)
    assert.equal(pendingProject.length, 1)
    assert.equal(service.pendingEmbeddings('global_user', undefined, GEN).length, 0) // 全局看不到项目条目
    service.storeEmbedding({
      id: pendingProject[0].id, scope: 'project', projectId: 'proj-A', providerId: 'local-onnx', modelId: 'fake', modelRevision: 'r1',
      dimensions: 4, contentHash: 'h', vector: new Float32Array([0.5, 0.5, 0.5, 0.5]), generation: GEN,
    })
    assert.equal(service.activeEmbeddingVectors('global_user', undefined, GEN).length, 0)
    assert.equal(service.activeEmbeddingVectors('project', 'proj-A', GEN).length, 1)
  } finally {
    service.close()
    rmSync(root, { recursive: true, force: true })
  }
})

// ---------- 融合纯函数 ----------

test('vectorCandidates applies the calibrated relative pruning and reports topScore', () => {
  const unit = (x) => new Float32Array([x, Math.sqrt(1 - x * x)])
  const docs = [
    { claimId: 'a', vector: unit(0.3) },
    { claimId: 'b', vector: unit(0.42) },
    { claimId: 'c', vector: unit(0.9) },
    { claimId: 'd', vector: unit(0.5) },
  ]
  const q = new Float32Array([1, 0])
  // 强信号：top≈0.9 → floor≈0.54 → 留 c；topScore 报告≈0.9
  const strong = vectorCandidates(q, docs)
  assert.deepEqual(strong.ranked, [{ id: 'c', rank: 1 }])
  assert.ok(Math.abs(strong.topScore - 0.9) < 1e-4, 'topScore≈0.9')
  // 弱信号：top=0.5 → floor=0.375 → 留 d，a(0.3) 被剪
  const weak = vectorCandidates(q, [docs[3], docs[0]])
  assert.deepEqual(weak.ranked, [{ id: 'd', rank: 1 }])
  assert.ok(Math.abs(weak.topScore - 0.5) < 1e-4, 'topScore≈0.5')
  // 空文档
  assert.deepEqual(vectorCandidates(q, []), { ranked: [], topScore: 0 })
})

test('cosineSimilarity, rankByScore and rrfFuse behave', () => {
  assert.ok(Math.abs(cosineSimilarity(new Float32Array([1, 0]), new Float32Array([1, 0])) - 1) < 1e-6)
  assert.ok(Math.abs(cosineSimilarity(new Float32Array([1, 0]), new Float32Array([0, 1])) - 0) < 1e-6)
  const ranked = rankByScore([{ id: 'b', score: 0.9 }, { id: 'a', score: 0.95 }, { id: 'c', score: 0.9 }])
  assert.deepEqual(ranked, [{ id: 'a', rank: 1 }, { id: 'b', rank: 2 }, { id: 'c', rank: 2 }])
  const fused = rrfFuse([{ id: 'x', rank: 1 }, { id: 'y', rank: 2 }], [{ id: 'y', rank: 1 }], 60)
  assert.equal(fused.size, 2)
  const xy = fused.get('y')
  const xx = fused.get('x')
  assert.ok(xy !== undefined && xx !== undefined && xy > xx, '双路命中的 y 应高于单路 x')
  assert.deepEqual(topFused(fused, 1), ['y'])
})

test('query unions vector candidates FTS missed and fuses ranks', () => {
  const { root, service } = fixture()
  try {
    const a = service.record({ kind: 'pattern', text: '出包之前的门禁必须把测试全跑完', scope: 'global_user', confirm: true })
    const aId = /[0-9a-f-]{36}/u.exec(a)?.[0]
    assert.ok(aId)
    service.record({ kind: 'pattern', text: '苹果香蕉是水果不是工程术语', scope: 'global_user', confirm: true })
    // FTS 对「发布前预检」可能零命中；向量通道补回 A（topScore 必须 ≥ 严格下限才参与）
    const ftsOnly = service.query({ q: '发布前预检', scope: 'global_user' })
    const hybrid = service.query({ q: '发布前预检', scope: 'global_user', vectorRanked: [{ id: aId, rank: 1 }], vectorTopScore: 0.9 })
    assert.match(hybrid, /出包之前的门禁/u)
    void ftsOnly
  } finally {
    service.close()
    rmSync(root, { recursive: true, force: true })
  }
})

// ---------- drain 回填 ----------

test('drainEmbeddings batches pending claims and handles bad vectors', async () => {
  const { root, service } = fixture()
  try {
    service.record({ kind: 'pattern', text: '回填批处理第一条可嵌入的记忆内容', scope: 'global_user', confirm: true })
    service.record({ kind: 'pattern', text: '回填批处理第二条可嵌入的记忆内容', scope: 'global_user', confirm: true })
    const stored = []
    const fakeRuntime = {
      ensureReady: async () => {},
      embed: async (texts) => {
        const vectors = new Float32Array(texts.length * 4)
        for (let i = 0; i < texts.length; i += 1) {
          // 第一条合法（单位向量），第二条零向量（坏向量）
          if (i === 0) { vectors[i * 4] = 1 }
        }
        return { vectors, count: texts.length, dimensions: 4, generation: GEN }
      },
    }
    const result = await drainEmbeddings(service, fakeRuntime, {
      providerId: 'local-onnx', modelId: 'fake', modelRevision: 'r1', dimensions: 4, generation: GEN,
      contentHashOf: (text) => text,
    })
    assert.equal(result.embedded, 1)
    assert.equal(result.failed, 1)
    assert.equal(service.embeddingStats('global_user', undefined).failed, 1)
    // 失败的作业 retries=1 < 3，仍在可重试队列
    assert.equal(service.pendingEmbeddings('global_user', undefined, GEN).length, 1)
    void stored
  } finally {
    service.close()
    rmSync(root, { recursive: true, force: true })
  }
})

// ---------- 真模型端到端（缺模型自动跳过） ----------

const REAL_MODEL_DIR = process.env.DSH_MEMORY_EMBEDDING_MODEL_DIR || 'F:\\Cyrus Dev Harness Data\\models\\bge-m3-onnx' || 'F:\\AI\\bge-m3-onnx'
const RUNTIME = { transformersJs: '4.2.0', onnxruntimeNode: '1.24.3' }

test('real bge-m3 end-to-end: drain fills vectors, hybrid query recovers word-mismatch claim', { skip: !existsSync(join(REAL_MODEL_DIR, EMBEDDING_MANIFEST_NAME)) }, async () => {
  const { root, service } = fixture()
  const manifest = readEmbeddingManifest(REAL_MODEL_DIR)
  assert.ok(manifest)
  const verified = verifyEmbeddingManifest(REAL_MODEL_DIR, manifest, RUNTIME, true)
  assert.ok(verified.ok, String(verified.error))
  const runtime = new EmbeddingRuntime({ modelDir: REAL_MODEL_DIR, manifest, generation: String(verified.generation) })
  try {
    service.record({ kind: 'pattern', text: '出包之前必须把完整测试和发布预检全部跑完', scope: 'global_user', confirm: true })
    service.record({ kind: 'pattern', text: '水果拼盘里的苹果和香蕉都不能算工程术语', scope: 'global_user', confirm: true })
    const result = await drainEmbeddings(service, runtime, {
      providerId: 'local-onnx', modelId: manifest.modelId, modelRevision: manifest.source.revision,
      dimensions: manifest.dimensions, generation: String(verified.generation),
      contentHashOf: (text) => normalizedHash(text),
    })
    assert.equal(result.embedded, 2)
    assert.equal(service.embeddingStats('global_user', undefined).ready, 2)
    // 查询「发布门禁」：字面不匹配，向量应把第一条捞回
    const docs = service.activeEmbeddingVectors('global_user', undefined, String(verified.generation))
    assert.equal(docs.length, 2)
    const query = await runtime.embed(['发布之前有什么门禁要求'], 'query')
    const scored = docs.map((doc) => ({ id: doc.claimId, score: cosineSimilarity(query.vectors, doc.vector) }))
    scored.sort((a, b) => b.score - a.score)
    const hybrid = service.query({ q: '发布门禁', scope: 'global_user', vectorRanked: [{ id: scored[0].id, rank: 1 }] })
    assert.match(hybrid, /出包之前必须把完整测试/u)
  } finally {
    await runtime.close()
    service.close()
    rmSync(root, { recursive: true, force: true })
  }
})
