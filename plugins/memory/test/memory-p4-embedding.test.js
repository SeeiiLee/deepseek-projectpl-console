// P4-2 测试：manifest 校验 / generation / worker 运行时（真模型，缺失自动跳过）/ 状态渲染。
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { EmbeddingRuntime, embeddingWorkerPath } from '../src/core/embedding.ts'
import {
  EMBEDDING_MANIFEST_NAME,
  embeddingGeneration,
  readEmbeddingManifest,
  verifyEmbeddingManifest,
} from '../src/core/embedding-manifest.ts'
import { renderEmbeddingStatus } from '../src/core/embedding-status.ts'

const sha256 = (text) => createHash('sha256').update(text).digest('hex')

function fakeModelDir(t, { sizeMismatch = false, badSha = false, badShape = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-emb-manifest-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const modelBytes = Buffer.from('fake-model-' + (sizeMismatch ? 'longer' : ''))
  const declaredModelBytes = Buffer.from('fake-model-').length
  const tokenizerBytes = Buffer.from('{"fake":"tokenizer"}')
  const configBytes = Buffer.from('{"fake":"config"}')
  writeFileSync(join(root, 'model.onnx'), modelBytes)
  writeFileSync(join(root, 'tokenizer.json'), tokenizerBytes)
  writeFileSync(join(root, 'config.json'), configBytes)
  const manifest = {
    schemaVersion: 1,
    role: 'selected',
    modelId: 'fake-model',
    source: { repository: 'x/fake', revision: 'abc123' },
    license: 'MIT',
    dimensions: 32,
    maxInputTokens: 512,
    dtype: 'q8',
    pooling: 'cls',
    normalization: 'l2',
    queryInstruction: null,
    files: {
      model: { path: 'model.onnx', bytes: sizeMismatch ? declaredModelBytes : modelBytes.length, sha256: badSha ? '0'.repeat(64) : sha256(modelBytes) },
      tokenizer: { path: 'tokenizer.json', bytes: tokenizerBytes.length, sha256: sha256(tokenizerBytes) },
      config: { path: 'config.json', bytes: configBytes.length, sha256: sha256(configBytes) },
    },
  }
  if (badShape) delete manifest.dimensions
  writeFileSync(join(root, EMBEDDING_MANIFEST_NAME), JSON.stringify(manifest))
  return root
}

const RUNTIME = { transformersJs: '4.2.0', onnxruntimeNode: '1.24.3' }

test('manifest read + verify pass, generation is deterministic', (t) => {
  const dir = fakeModelDir(t)
  const manifest = readEmbeddingManifest(dir)
  assert.ok(manifest)
  assert.equal(manifest.modelId, 'fake-model')
  const verified = verifyEmbeddingManifest(dir, manifest, RUNTIME, true)
  assert.equal(verified.ok, true)
  assert.match(String(verified.generation), /^[0-9a-f]{16}$/u)
  assert.equal(verified.generation, embeddingGeneration(manifest, RUNTIME))
  // 任何语义字段变化都改变 generation
  const changed = { ...manifest, dtype: 'fp32' }
  assert.notEqual(embeddingGeneration(changed, RUNTIME), verified.generation)
})

test('manifest verify rejects missing file, size mismatch and hash mismatch', (t) => {
  const ok = fakeModelDir(t)
  const manifest = readEmbeddingManifest(ok)
  assert.ok(manifest)
  const missing = verifyEmbeddingManifest(join(tmpdir(), 'dsh-emb-nonexistent-' + String(Date.now())), manifest, RUNTIME, false)
  assert.equal(missing.ok, false)
  assert.match(String(missing.error), /缺失/u)

  const sizeBad = fakeModelDir(t, { sizeMismatch: true })
  const sizeManifest = readEmbeddingManifest(sizeBad)
  assert.ok(sizeManifest)
  assert.equal(verifyEmbeddingManifest(sizeBad, sizeManifest, RUNTIME, false).ok, false)

  const hashBad = fakeModelDir(t, { badSha: true })
  const hashManifest = readEmbeddingManifest(hashBad)
  assert.ok(hashManifest)
  const verified = verifyEmbeddingManifest(hashBad, hashManifest, RUNTIME, true)
  assert.equal(verified.ok, false)
  assert.match(String(verified.error), /SHA-256/u)
})

test('manifest read rejects broken shapes and missing files', (t) => {
  const dir = fakeModelDir(t, { badShape: true })
  assert.equal(readEmbeddingManifest(dir), null)
  assert.equal(readEmbeddingManifest(join(tmpdir(), 'dsh-emb-none-' + String(Date.now()))), null)
})

const STATUS_BASE = { jobs: null, hybridEnabled: false, lastDrain: '未运行' }
test('renderEmbeddingStatus covers disabled / no dir / invalid / ok states', () => {
  assert.match(renderEmbeddingStatus({ enabled: false, modelDir: '', manifest: null, manifestError: '', generation: '', workerState: '', workerError: '', ...STATUS_BASE }), /未开启/u)
  assert.match(renderEmbeddingStatus({ enabled: true, modelDir: '', manifest: null, manifestError: '', generation: '', workerState: '', workerError: '', ...STATUS_BASE }), /未配置模型目录/u)
  assert.match(renderEmbeddingStatus({ enabled: true, modelDir: 'X', manifest: null, manifestError: '坏', generation: '', workerState: '', workerError: '', ...STATUS_BASE }), /semantic_unavailable/u)
  const ok = renderEmbeddingStatus({ enabled: true, modelDir: 'X', manifest: { modelId: 'bge-m3-onnx-int8', dimensions: 1024, dtype: 'q8', pooling: 'cls' }, manifestError: '', generation: 'abc123', workerState: '未加载（首次嵌入时懒加载）', workerError: '', jobs: { pending: 1, ready: 2, failed: 0, stale: 0 }, hybridEnabled: false })
  assert.match(ok, /1024 维/u)
  assert.match(ok, /jobs：pending 1 \/ ready 2/u)
  assert.match(ok, /hybrid 召回：未启用/u)
  assert.match(renderEmbeddingStatus({ enabled: true, modelDir: 'X', manifest: { modelId: 'bge-m3-onnx-int8', dimensions: 1024, dtype: 'q8', pooling: 'cls' }, manifestError: '', generation: 'g', workerState: '', workerError: '', jobs: null, hybridEnabled: true }), /已启用/u)
})

// ---------- 真模型集成（本机有 bge-m3 才跑；无模型自动跳过，保证任意机器全绿） ----------

const REAL_MODEL_DIR = process.env.DSH_MEMORY_EMBEDDING_MODEL_DIR || 'F:\\Cyrus Dev Harness Data\\models\\bge-m3-onnx' || 'F:\\AI\\bge-m3-onnx'

test('worker path resolves in source layout', () => {
  assert.ok(existsSync(embeddingWorkerPath()))
})

test('EmbeddingRuntime loads local bge-m3 offline and embeds with sane semantics', { skip: !existsSync(join(REAL_MODEL_DIR, EMBEDDING_MANIFEST_NAME)) }, async () => {
  const manifest = readEmbeddingManifest(REAL_MODEL_DIR)
  assert.ok(manifest, 'manifest 应存在')
  const verified = verifyEmbeddingManifest(REAL_MODEL_DIR, manifest, RUNTIME, true)
  assert.equal(verified.ok, true, String(verified.error))
  const runtime = new EmbeddingRuntime({ modelDir: REAL_MODEL_DIR, manifest, generation: String(verified.generation) })
  try {
    const started = Date.now()
    const result = await runtime.embed(['发布前必须先跑完整测试再出包', '每次出包之前都要把测试跑完', '今天晚饭吃什么'], 'query')
    assert.equal(result.count, 3)
    assert.equal(result.dimensions, 1024)
    assert.equal(result.vectors.length, 3 * 1024)
    // L2 归一化：每个向量范数 ≈ 1
    for (let i = 0; i < 3; i += 1) {
      let sum = 0
      for (let j = 0; j < 1024; j += 1) sum += result.vectors[i * 1024 + j] ** 2
      assert.ok(Math.abs(Math.sqrt(sum) - 1) < 1e-3, '范数应≈1')
    }
    const cosine = (a, b) => {
      let dot = 0
      for (let j = 0; j < 1024; j += 1) dot += result.vectors[a * 1024 + j] * result.vectors[b * 1024 + j]
      return dot
    }
    const synonym = cosine(0, 1)
    const unrelated = cosine(0, 2)
    assert.ok(synonym > unrelated, '同义相似度应高于无关（' + synonym.toFixed(3) + ' vs ' + unrelated.toFixed(3) + '）')
    assert.ok(runtime.stateText() === 'ready')
    assert.ok(Date.now() - started < 120_000, '加载+嵌入应在 120s 内')
  } finally {
    await runtime.close()
  }
})
