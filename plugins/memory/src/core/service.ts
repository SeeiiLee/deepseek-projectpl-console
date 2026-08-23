// MemoryService：P1 最小存储核心（单写者、显式工具、召回、审计、备份、导出）。
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { assertWritableContent, buildSearchableText, canonicalizeClaim, normalizedHash } from './gates.ts'
import { HYBRID_STRICT_FLOOR, rrfFuse, topFused } from './hybrid.ts'
import { GLOBAL_SCOPE_ID, SCHEMA_VERSION, openCatalog, openShard } from './store.ts'
import type { OpenStore } from './store.ts'
import type { EngineHandle } from './engine.ts'

const KINDS = Object.freeze(['event', 'project_fact', 'global_fact', 'user_profile', 'skill', 'task', 'pattern'])
const EVIDENCE_KINDS = Object.freeze(['repo_file', 'rollout', 'session', 'command', 'artifact', 'user_confirmation'])
const SCOPES = Object.freeze(['global_user', 'project'])
const QUERY_MAX_BYTES = 8000
const SUMMARY_MAX_BYTES = 4000
const SUMMARY_TOP_CLAIMS = 5
const SUMMARY_RECENT_CLAIMS = 3

export function uuidv7(): string {
  const bytes = randomBytes(16)
  const ts = BigInt(Date.now())
  for (let i = 0; i < 6; i += 1) bytes[i] = Number((ts >> BigInt(8 * (5 - i))) & 0xffn)
  bytes[6] = (bytes[6]! & 0x0f) | 0x70
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20)
}

export interface RecordInput {
  kind: string
  text: string
  scope: string
  projectId?: string | undefined
  evidence?: string | undefined
  /** 证据类型（缺省 user_confirmation；自动提取用 session）。 */
  evidenceKind?: string | undefined
  confirm?: boolean | undefined
  /** P3-2：自动提取幂等键（project|session|turn|extractor_version|candidate_index）；同键重放不重复写入。 */
  idempotencyKey?: string | undefined
  /** P6-3：事实时间（该条记忆所描述的决定/事件发生时间；缺省取录入时间，项目记忆应尽量提供）。 */
  factualAt?: string | undefined
}

export interface QueryInput {
  q: string
  projectId?: string | undefined
  scope?: string | undefined
  limit?: number | undefined
  /** P4-2：向量通道名次候选（插件侧先余弦排序）；非空时与 FTS 做并集 + RRF 融合。 */
  vectorRanked?: Array<{ id: string; rank: number }> | undefined
  /** P4-2：本查询向量最高分（FTS 零命中时低于严格下限则忽略向量通道）。 */
  vectorTopScore?: number | undefined
}

export interface ListInput {
  scope?: string | undefined
  projectId?: string | undefined
  kind?: string | undefined
  status?: string | undefined
  limit?: number | undefined
}

export interface ExportInput {
  scope?: string | undefined
  projectId?: string | undefined
}

interface ShardRef {
  db: EngineHandle
  store: OpenStore
  scopeKind: string
  scopeId: string
}

interface ClaimRow {
  id: string
  scope_kind: string
  scope_id: string
  kind: string
  canonical_text: string
  status: string
  authority_class: string
  confidence: number
  importance: number
  sensitivity_class: string
  last_verified_at: string | null
  normalized_content_hash: string
  created_at: string
  updated_at: string
  factual_at: string | null
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}

/** kind×scope 配对硬规则：项目级内容禁止落全局，全局内容禁止冒充项目事实。 */
const GLOBAL_KINDS = new Set(['global_fact', 'user_profile', 'pattern', 'skill'])
const PROJECT_KINDS = new Set(['project_fact', 'event', 'task', 'skill', 'pattern'])

export function assertKindScopePairing(scope: string, kind: string): void {
  if (scope === 'global_user' && !GLOBAL_KINDS.has(kind)) {
    throw new Error('归类拒绝：kind=' + kind + ' 属于项目级内容，不允许写入 global_user。请先登记项目并用 scope=project；若确是跨项目通用教训，请改用 kind=pattern 并重述为通用表述。')
  }
  if (scope === 'project' && !PROJECT_KINDS.has(kind)) {
    throw new Error('归类拒绝：kind=' + kind + ' 属于全局内容，不允许写入项目分片。请改用 scope=global_user。')
  }
}

export class MemoryService {
  readonly dbRoot: string
  readonly encrypted: boolean
  private catalogStore: OpenStore | null = null
  private shardStores = new Map<string, OpenStore>()
  private paused = false

  constructor(options: { dbRoot: string; encrypted?: boolean; candidateTtlDays?: number }) {
    this.dbRoot = resolve(options.dbRoot)
    this.encrypted = options.encrypted === true
    this.candidateTtlDays = Math.min(Math.max(Number(options.candidateTtlDays ?? 14) || 14, 1), 90)
    mkdirSync(this.dbRoot, { recursive: true })
  }

  /** 候选自动过期天数（P3：默认 14 天，1–90 可配）。 */
  readonly candidateTtlDays: number

  /** 启动自检：真实走一遍密钥解锁 + 密文库打开 + 完整性校验；失败即抛（fail closed）。 */
  selfTest(): void {
    const store = this.catalog()
    if (!store.db.integrityOk()) {
      throw new Error('记忆库加密自检失败：catalog 完整性校验未通过。')
    }
  }

  private catalog(): OpenStore {
    if (this.catalogStore === null) {
      this.catalogStore = openCatalog(join(this.dbRoot, 'catalog.sqlite3'), { encrypted: this.encrypted, keyRoot: this.dbRoot })
      if (this.catalogStore.version > SCHEMA_VERSION) throw new Error('catalog schemaVersion 过高，拒绝打开。')
    }
    return this.catalogStore
  }

  private shardPathFor(scope: string, projectId?: string): { kind: string; id: string; rel: string } {
    if (scope === 'global_user') return { kind: 'global_user', id: GLOBAL_SCOPE_ID, rel: join('private', 'user.sqlite3') }
    if (scope === 'project') {
      const project = String(projectId ?? '').trim()
      if (project === '') throw new Error('scope=project 必须提供 project_id。')
      const row = this.catalog().db.prepare('SELECT shard_locator FROM memory_projects WHERE project_id = ?').get(project) as
        | { shard_locator?: string }
        | undefined
      if (row === undefined || row.shard_locator === undefined) {
        throw new Error('项目 ' + project + ' 未登记（fail closed）：先经 Project Control 注册项目身份再写入记忆。')
      }
      return { kind: 'project', id: project, rel: row.shard_locator }
    }
    throw new Error('scope 必须是 global_user 或 project（workspace 折叠入 project，P2 扩展）。')
  }

  private shard(scope: string, projectId?: string): ShardRef {
    const target = this.shardPathFor(scope, projectId)
    const key = target.rel
    let store = this.shardStores.get(key)
    if (store === undefined) {
      store = openShard(join(this.dbRoot, target.rel), { encrypted: this.encrypted, keyRoot: this.dbRoot })
      if (store.version > SCHEMA_VERSION) throw new Error('分片 schemaVersion 过高，拒绝打开。')
      this.shardStores.set(key, store)
    }
    return { db: store.db, store, scopeKind: target.kind, scopeId: target.id }
  }

  /** 登记项目分片（身份仍以 Project Control 为准；此处仅建立记忆侧引用）。 */
  registerProject(projectId: string): { projectId: string; shardLocator: string } {
    const project = String(projectId).trim()
    if (project === '' || project.includes('/') || project.includes('\\')) throw new Error('project_id 非法。')
    const rel = join('projects', project, 'memory.sqlite3')
    this.catalog().db.prepare(
      'INSERT INTO memory_projects(project_id, shard_locator, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(project_id) DO NOTHING',
    ).run(project, rel, new Date().toISOString(), new Date().toISOString())
    return { projectId: project, shardLocator: rel }
  }

  listRegisteredProjects(): string[] {
    return (this.catalog().db.prepare('SELECT project_id FROM memory_projects ORDER BY project_id').all() as Array<{ project_id: string }>)
      .map((row) => row.project_id)
  }

  record(input: RecordInput): string {
    const kind = String(input.kind ?? '')
    const scope = String(input.scope ?? '')
    if (!KINDS.includes(kind)) throw new Error('kind 不在白名单：' + KINDS.join(' / '))
    if (!SCOPES.includes(scope)) throw new Error('scope 必须是 global_user 或 project。')
    assertKindScopePairing(scope, kind)
    assertWritableContent(input.text)
    const canonical = canonicalizeClaim(input.text)
    const hash = normalizedHash(input.text)
    const confirm = input.confirm === true
    const { db, scopeKind, scopeId } = this.shard(scope, input.projectId)
    const now = new Date().toISOString()
    const idempotencyKey = typeof input.idempotencyKey === 'string' && input.idempotencyKey.trim() !== ''
      ? input.idempotencyKey.trim().slice(0, 400)
      : undefined
    if (idempotencyKey !== undefined) {
      const prior = db.prepare('SELECT claim_id, outcome FROM candidate_idempotency WHERE idempotency_key = ?').get(idempotencyKey) as
        | { claim_id: string | null; outcome: string }
        | undefined
      if (prior !== undefined) {
        return '幂等键已存在（outcome=' + prior.outcome + '），跳过重复提取。'
      }
    }
    const existing = db.prepare(
      'SELECT id, status FROM claims WHERE scope_kind = ? AND scope_id = ? AND kind = ? AND normalized_content_hash = ?',
    ).get(scopeKind, scopeId, kind, hash) as { id: string; status: string } | undefined
    if (existing !== undefined) {
      if (idempotencyKey !== undefined) {
        db.prepare(`INSERT INTO candidate_idempotency(idempotency_key, claim_id, original_claim_hash, outcome, expires_at, created_at)
          VALUES (?, ?, ?, 'pending', NULL, ?)`).run(idempotencyKey, existing.id, hash, now)
      }
      return '内容与既有条目相同（' + existing.id + '，status=' + existing.status + '），未重复写入。' + (confirm ? ' 如需确认请用 memory_correct 更新。' : '')
    }
    const id = uuidv7()
    const expiresAt = confirm ? null : new Date(Date.now() + this.candidateTtlDays * 86_400_000).toISOString()
    const factualAt = typeof input.factualAt === 'string' && input.factualAt.trim() !== ''
      ? input.factualAt.trim().slice(0, 40)
      : null
    db.prepare(`INSERT INTO claims(id, scope_kind, scope_id, kind, canonical_text, searchable_text, status, authority_class,
      confidence, importance, sensitivity_class, normalized_content_hash, expires_at, factual_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 50, 50, 'internal', ?, ?, ?, ?, ?)`).run(
      id, scopeKind, scopeId, kind, canonical, buildSearchableText(canonical), confirm ? 'active' : 'candidate',
      confirm ? 'user_confirmed' : 'llm_extracted', hash, expiresAt, factualAt, now, now,
    )
    if (idempotencyKey !== undefined) {
      db.prepare(`INSERT INTO candidate_idempotency(idempotency_key, claim_id, original_claim_hash, outcome, expires_at, created_at)
        VALUES (?, ?, ?, 'pending', ?, ?)`).run(idempotencyKey, id, hash, expiresAt, now)
    }
    if (confirm) {
      // P4-2：active 条目入嵌入队列（候选先不入，确认时才嵌）。
      db.prepare("INSERT INTO embedding_jobs(claim_id, state, created_at, updated_at) VALUES (?, 'pending', ?, ?) ON CONFLICT(claim_id) DO NOTHING")
        .run(id, now, now)
    }
    const evidenceKind = typeof input.evidenceKind === 'string' && EVIDENCE_KINDS.includes(input.evidenceKind) ? input.evidenceKind : 'user_confirmation'
    if (typeof input.evidence === 'string' && input.evidence.trim() !== '') {
      const evidenceId = uuidv7()
      db.prepare(`INSERT INTO evidence_sources(id, kind, portable_locator, captured_at, availability, sensitivity_class)
        VALUES (?, ?, ?, ?, 'available', 'internal')`).run(evidenceId, evidenceKind, input.evidence.trim(), now)
      db.prepare('INSERT INTO claim_evidence(claim_id, evidence_id, kind, created_at) VALUES (?, ?, ?, ?)')
        .run(id, evidenceId, 'DERIVED_FROM', now)
    }
    if (confirm) return '已确认写入（active + user_confirmed）：' + id + '\n  scope: ' + scopeKind + '/' + scopeId + '\n  kind: ' + kind + '\n  claim: ' + canonical
    return '已暂存为候选（candidate，14 天内确认，否则自动过期）：' + id + '\n  scope: ' + scopeKind + '/' + scopeId + '\n  kind: ' + kind + '\n  claim: ' + canonical + '\n回传 confirm=true 即确认写入为 active + user_confirmed。'
  }

  query(input: QueryInput): string {
    const q = String(input.q ?? '').trim()
    if (q === '') throw new Error('query 不能为空。')
    const limit = Math.min(Math.max(Number(input.limit ?? 5) || 5, 1), 10)
    const useProject = input.scope === 'project' || (input.projectId !== undefined && input.projectId !== '')
    const { db, scopeKind, scopeId } = useProject ? this.shard('project', input.projectId) : this.shard('global_user')
    const tokens = buildSearchableText(q).split(/\s+/u).filter((token) => token.length > 0).slice(0, 8)
    const ftsQuery = tokens.map((token) => '"' + token.replace(/"/gu, '""') + '"').join(' OR ')
    const now = new Date().toISOString()
    const runId = uuidv7()
    db.prepare('INSERT INTO recall_runs(id, project_id, query_hash, query_len, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(runId, scopeKind === 'project' ? scopeId : null, createHash('sha256').update(q).digest('hex'), q.length, now)
    let rows: Array<ClaimRow>
    if (tokens.length === 0) {
      rows = db.prepare(
        "SELECT * FROM claims WHERE scope_kind = ? AND scope_id = ? AND status = 'active' ORDER BY importance DESC, updated_at DESC LIMIT ?",
      ).all(scopeKind, scopeId, limit) as unknown as Array<ClaimRow>
    } else {
      const matched = db.prepare('SELECT rowid FROM claims_fts WHERE claims_fts MATCH ? LIMIT 64').all(ftsQuery) as Array<{ rowid: number }>
      if (matched.length === 0) rows = []
      else {
        const rowids = matched.map((row) => row.rowid)
        const placeholders = rowids.map(() => '?').join(', ')
        rows = db.prepare(
          `SELECT * FROM claims WHERE rowid IN (${placeholders}) AND scope_kind = ? AND scope_id = ? AND status = 'active'
           ORDER BY importance DESC, updated_at DESC LIMIT ?`,
        ).all(...rowids, scopeKind, scopeId, limit) as unknown as Array<ClaimRow>
      }
    }
    // P4-2：向量通道并集 + RRF 融合（不改变单路行为；融合失败降级为原顺序）。
    // FTS 零命中时：向量最高分低于严格下限 → 语义通道不参与（全噪声查询不吐全库）。
    const ftsEmpty = tokens.length > 0 && rows.length === 0
    const vectorRanked = input.vectorRanked !== undefined && input.vectorRanked.length > 0
      && !(ftsEmpty && (input.vectorTopScore ?? 0) < HYBRID_STRICT_FLOOR)
      ? input.vectorRanked
      : undefined
    if (vectorRanked !== undefined && vectorRanked.length > 0) {
      const ftsRanked = rows.map((row, index) => ({ id: row.id, rank: index + 1 }))
      const fused = rrfFuse(ftsRanked, vectorRanked)
      const fusedOrder = topFused(fused, Math.max(rows.length, vectorRanked.length))
      const byId = new Map(rows.map((row) => [row.id, row]))
      const extraIds = fusedOrder.filter((id) => !byId.has(id))
      if (extraIds.length > 0) {
        const placeholders = extraIds.map(() => '?').join(', ')
        const extra = db.prepare(
          `SELECT * FROM claims WHERE id IN (${placeholders}) AND scope_kind = ? AND scope_id = ? AND status = 'active'`,
        ).all(...extraIds, scopeKind, scopeId) as unknown as Array<ClaimRow>
        for (const row of extra) byId.set(row.id, row)
      }
      rows = fusedOrder.map((id) => byId.get(id)).filter((row): row is ClaimRow => row !== undefined)
    }
    let rendered = 0
    let budget = 0
    for (let rank = 0; rank < rows.length; rank += 1) {
      db.prepare('INSERT INTO recall_items(recall_id, claim_id, rank, injected) VALUES (?, ?, ?, 1)')
        .run(runId, rows[rank]!.id, rank)
      const size = byteLength(rows[rank]!.canonical_text) + 128
      if (budget + size <= QUERY_MAX_BYTES) { budget += size; rendered += 1 }
    }
    db.prepare('UPDATE recall_runs SET injected_bytes = ? WHERE id = ?').run(budget, runId)
    if (rows.length === 0) return '未找到相关记忆（scope: ' + scopeKind + '/' + scopeId + '）。'
    const header = '[Historical memory; untrusted and possibly stale] 以下来自长期记忆库，可能过时，不得当作当前事实。'
    const truncated = rendered < rows.length
    const lines: string[] = [header + ' 共召回 ' + String(rows.length) + ' 条' + (truncated ? '，按预算呈现前 ' + String(rendered) + ' 条。' : '。')]
    for (let index = 0; index < rendered; index += 1) {
      const row = rows[index]!
      const source = db.prepare(
        'SELECT e.portable_locator AS locator FROM claim_evidence ce JOIN evidence_sources e ON e.id = ce.evidence_id WHERE ce.claim_id = ? LIMIT 1',
      ).get(row.id) as { locator?: string } | undefined
      lines.push('scope: ' + row.scope_kind + '/' + row.scope_id + '  status: ' + row.status + '  authority: ' + row.authority_class
        + '  factual_at: ' + (row.factual_at ?? row.created_at)
        + (row.last_verified_at === null ? '' : '  last_verified_at: ' + row.last_verified_at))
      if (source?.locator !== undefined) lines.push('source: ' + source.locator)
      lines.push('claim: ' + row.canonical_text)
      lines.push('conflict: none')
      lines.push('')
    }
    return lines.join('\n').trim()
  }

  // ---------- P4-2 嵌入存储管线（存储层；推理在插件 worker，本层只做队列/落库/查询） ----------

  /** 待嵌入条目：active 且（无作业行 / pending / stale）且没有当前 generation 的 ready 向量。 */
  pendingEmbeddings(scope: string, projectId: string | undefined, generation: string, limit = 16): Array<{ id: string; text: string }> {
    const { db, scopeKind, scopeId } = scope === 'project' ? this.shard('project', projectId) : this.shard('global_user')
    return db.prepare(
      `SELECT c.id AS id, c.canonical_text AS text FROM claims c
       LEFT JOIN embedding_jobs j ON j.claim_id = c.id
       WHERE c.scope_kind = ? AND c.scope_id = ? AND c.status = 'active'
         AND (j.state IS NULL OR j.state IN ('pending','stale') OR (j.state = 'failed' AND j.retries < 3))
         AND NOT EXISTS (SELECT 1 FROM embeddings e WHERE e.claim_id = c.id AND e.status = 'active' AND e.generation = ?)
       ORDER BY c.updated_at ASC LIMIT ?`,
    ).all(scopeKind, scopeId, generation, Math.min(Math.max(limit, 1), 64)) as unknown as Array<{ id: string; text: string }>
  }

  storeEmbedding(input: {
    id: string
    scope: string
    projectId?: string | undefined
    providerId: string
    modelId: string
    modelRevision: string
    dimensions: number
    contentHash: string
    vector: Float32Array
    generation: string
  }): void {
    const { db, scopeKind, scopeId } = input.scope === 'project' ? this.shard('project', input.projectId) : this.shard('global_user')
    const now = new Date().toISOString()
    const blob = Buffer.from(input.vector.buffer, input.vector.byteOffset, input.vector.byteLength)
    db.prepare(
      `INSERT INTO embeddings(claim_id, provider_id, model_id, model_revision, dimensions, encoding, normalization, content_hash, vector_blob, generated_at, generation, status)
       VALUES (?, ?, ?, ?, ?, 'float32-le', 'l2', ?, ?, ?, ?, 'active')
       ON CONFLICT(claim_id) DO UPDATE SET provider_id = excluded.provider_id, model_id = excluded.model_id,
         model_revision = excluded.model_revision, dimensions = excluded.dimensions, content_hash = excluded.content_hash,
         vector_blob = excluded.vector_blob, generated_at = excluded.generated_at, generation = excluded.generation, status = 'active'`,
    ).run(input.id, input.providerId, input.modelId, input.modelRevision, input.dimensions, input.contentHash, blob, now, input.generation)
    // 作业行有则更新、无则补行（迁移前旧条目的首次回填没有作业行，必须补上，否则统计漏报）。
    db.prepare(
      `INSERT INTO embedding_jobs(claim_id, state, error_code, retries, created_at, updated_at)
       SELECT id, 'ready', NULL, 0, ?, ? FROM claims WHERE id = ? AND scope_kind = ? AND scope_id = ?
       ON CONFLICT(claim_id) DO UPDATE SET state = 'ready', error_code = NULL, updated_at = excluded.updated_at`,
    ).run(now, now, input.id, scopeKind, scopeId)
  }

  /** 嵌入失败：只记错误码与重试次数，不记正文（评审 §4.2.2）。 */
  markEmbeddingFailed(scope: string, projectId: string | undefined, id: string, errorCode: string): void {
    const { db, scopeKind, scopeId } = scope === 'project' ? this.shard('project', projectId) : this.shard('global_user')
    const now = new Date().toISOString()
    db.prepare(
      "UPDATE embedding_jobs SET state = 'failed', error_code = ?, retries = retries + 1, updated_at = ? WHERE claim_id = ? AND state != 'ready' AND claim_id IN (SELECT id FROM claims WHERE scope_kind = ? AND scope_id = ?)",
    ).run(errorCode.slice(0, 120), now, id, scopeKind, scopeId)
  }

  /** 对账：embeddings 里已有当前 generation 的 ready 向量，但作业行缺失时补行（修复统计漏报）。 */
  reconcileEmbeddingJobs(scope: string, projectId: string | undefined, generation: string): number {
    const { db, scopeKind, scopeId } = scope === 'project' ? this.shard('project', projectId) : this.shard('global_user')
    const result = db.prepare(
      `INSERT INTO embedding_jobs(claim_id, state, error_code, retries, created_at, updated_at)
       SELECT e.claim_id, 'ready', NULL, 0, e.generated_at, e.generated_at FROM embeddings e
       JOIN claims c ON c.id = e.claim_id
       WHERE c.scope_kind = ? AND c.scope_id = ? AND c.status = 'active' AND e.status = 'active' AND e.generation = ?
       ON CONFLICT(claim_id) DO NOTHING`,
    ).run(scopeKind, scopeId, generation) as { changes?: number | bigint }
    return Number(result.changes ?? 0)
  }

  /** generation 变更：旧向量全部退役，对应作业转 stale（等回填重嵌）。 */
  retireStaleEmbeddings(scope: string, projectId: string | undefined, generation: string): number {
    const { db, scopeKind, scopeId } = scope === 'project' ? this.shard('project', projectId) : this.shard('global_user')
    const now = new Date().toISOString()
    const retired = db.prepare(
      "UPDATE embeddings SET status = 'retired' WHERE status = 'active' AND generation != ? AND claim_id IN (SELECT id FROM claims WHERE scope_kind = ? AND scope_id = ?)",
    ).run(generation, scopeKind, scopeId) as { changes?: number | bigint }
    db.prepare(
      "UPDATE embedding_jobs SET state = 'stale', updated_at = ? WHERE state = 'ready' AND claim_id IN (SELECT claim_id FROM embeddings WHERE status = 'retired')",
    ).run(now)
    return Number(retired.changes ?? 0)
  }

  /** 查询侧：本 scope 当前 generation 的全部活跃向量（数百条规模 brute-force，≤limit 截断）。 */
  activeEmbeddingVectors(scope: string, projectId: string | undefined, generation: string, limit = 512): Array<{ claimId: string; vector: Float32Array }> {
    const { db, scopeKind, scopeId } = scope === 'project' ? this.shard('project', projectId) : this.shard('global_user')
    const rows = db.prepare(
      `SELECT e.claim_id AS claimId, e.vector_blob AS blob FROM embeddings e
       JOIN claims c ON c.id = e.claim_id
       WHERE c.scope_kind = ? AND c.scope_id = ? AND c.status = 'active' AND e.status = 'active' AND e.generation = ?
       ORDER BY c.updated_at DESC LIMIT ?`,
    ).all(scopeKind, scopeId, generation, Math.min(Math.max(limit, 1), 1024)) as unknown as Array<{ claimId: string; blob: Uint8Array }>
    return rows.map((row) => ({
      claimId: row.claimId,
      vector: new Float32Array(row.blob.buffer, row.blob.byteOffset, Math.floor(row.blob.byteLength / 4)),
    })).filter((row) => row.vector.length > 0)
  }

  embeddingStats(scope: string, projectId: string | undefined): { pending: number; ready: number; failed: number; stale: number } {
    const { db } = scope === 'project' ? this.shard('project', projectId) : this.shard('global_user')
    const rows = db.prepare(
      'SELECT j.state AS state, COUNT(*) AS c FROM embedding_jobs j JOIN claims c ON c.id = j.claim_id WHERE c.status = ? GROUP BY j.state',
    ).all('active') as unknown as Array<{ state: string; c: number }>
    const stats = { pending: 0, ready: 0, failed: 0, stale: 0 }
    for (const row of rows) {
      if (row.state === 'pending') stats.pending = row.c
      else if (row.state === 'ready') stats.ready = row.c
      else if (row.state === 'failed') stats.failed = row.c
      else if (row.state === 'stale') stats.stale = row.c
    }
    return stats
  }

  // ---------- P6-1 项目重置（archive/delete + 审计回执） ----------

  /** 预览：项目条目构成与可重置范围（只读；令牌由插件层管理并二次确认）。 */
  resetProjectPreview(projectId: string): { projectId: string; total: number; active: number; candidates: number; archived: number; tombstones: number } {
    const { db, scopeKind, scopeId } = this.shard('project', projectId) // 未登记 fail closed
    const counts = db.prepare(
      "SELECT status, COUNT(*) AS c FROM claims WHERE scope_kind = ? AND scope_id = ? GROUP BY status",
    ).all(scopeKind, scopeId) as unknown as Array<{ status: string; c: number }>
    const pick = (status: string) => counts.find((row) => row.status === status)?.c ?? 0
    const tombstones = db.prepare("SELECT COUNT(*) AS c FROM tombstones WHERE scope_kind = ? AND scope_id = ?").get(scopeKind, scopeId) as { c: number }
    return {
      projectId,
      total: counts.reduce((sum, row) => sum + row.c, 0),
      active: pick('active'),
      candidates: pick('candidate'),
      archived: pick('archived'),
      tombstones: tombstones.c,
    }
  }

  /** 执行重置：archive（全部条目转归档，保留审计）或 delete（逐条 tombstone 后物理删除）。写 catalog 回执。 */
  resetProject(projectId: string, input: { mode: 'archive' | 'delete'; confirmToken: string; reason?: string }): string {
    const { db, scopeKind, scopeId } = this.shard('project', projectId)
    const mode = input.mode === 'delete' ? 'delete' : 'archive'
    const tokenHash = createHash('sha256').update(input.confirmToken).digest('hex')
    const before = this.resetProjectPreview(projectId).total
    const now = new Date().toISOString()
    if (mode === 'archive') {
      const result = db.prepare("UPDATE claims SET status = 'archived', updated_at = ? WHERE scope_kind = ? AND scope_id = ? AND status != 'archived'")
        .run(now, scopeKind, scopeId) as { changes?: number | bigint }
      void result
    } else {
      const rows = db.prepare('SELECT id, normalized_content_hash AS hash FROM claims WHERE scope_kind = ? AND scope_id = ?')
        .all(scopeKind, scopeId) as unknown as Array<{ id: string; hash: string }>
      for (const row of rows) {
        db.prepare('INSERT INTO tombstones(id, scope_kind, scope_id, content_hash, deleted_at, reason) VALUES (?, ?, ?, ?, ?, ?)')
          .run(uuidv7(), scopeKind, scopeId, row.hash, now, 'reset_project:' + (input.reason ?? ''))
      }
      db.prepare('DELETE FROM claims WHERE scope_kind = ? AND scope_id = ?').run(scopeKind, scopeId)
    }
    const after = mode === 'archive' ? this.resetProjectPreview(projectId).archived : 0
    const receiptId = uuidv7()
    this.catalog().db.prepare(
      'INSERT INTO project_reset_receipts(id, project_id, mode, confirm_token_hash, claims_before, claims_after, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(receiptId, projectId, mode, tokenHash, before, after, (input.reason ?? '').slice(0, 500), now)
    return '项目 ' + projectId + ' 已' + (mode === 'archive' ? '归档' : '删除') + '：处理 ' + String(before) + ' 条。回执 ' + receiptId
  }

  /** 审计：项目重置回执列表（catalog 侧）。 */
  listProjectResetReceipts(projectId?: string): Array<{ id: string; projectId: string; mode: string; claimsBefore: number; claimsAfter: number; reason: string; createdAt: string }> {
    const rows = projectId === undefined
      ? this.catalog().db.prepare('SELECT * FROM project_reset_receipts ORDER BY created_at DESC LIMIT 50').all()
      : this.catalog().db.prepare('SELECT * FROM project_reset_receipts WHERE project_id = ? ORDER BY created_at DESC LIMIT 50').all(projectId)
    return (rows as unknown as Array<{ id: string; project_id: string; mode: string; claims_before: number; claims_after: number; reason: string; created_at: string }>)
      .map((row) => ({ id: row.id, projectId: row.project_id, mode: row.mode, claimsBefore: row.claims_before, claimsAfter: row.claims_after, reason: row.reason, createdAt: row.created_at }))
  }

  // ---------- P3 候选治理（P3-1：暂停态 / 候选队列 / 评审 / 过期清理 / 摘要块） ----------

  /** 暂停自动候选与自动召回（quick-pass 注入门由插件层检查）。 */
  isPaused(): boolean {
    return this.paused
  }

  setPaused(on: boolean): boolean {
    this.paused = on
    return this.paused
  }

  /** 列出待处理候选（status=candidate，按创建时间升序 = 最老优先）。 */
  listCandidates(input: { scope?: string | undefined; projectId?: string | undefined; limit?: number | undefined }): string {
    const useProject = input.scope === 'project' || (input.projectId !== undefined && input.projectId !== '')
    const { db, scopeKind, scopeId } = useProject ? this.shard('project', input.projectId) : this.shard('global_user')
    const limit = Math.min(Math.max(Number(input.limit ?? 10) || 10, 1), 50)
    const now = new Date().toISOString()
    const rows = db.prepare(
      "SELECT id, kind, canonical_text, expires_at, factual_at, created_at FROM claims WHERE scope_kind = ? AND scope_id = ? AND status = 'candidate' ORDER BY created_at ASC LIMIT ?",
    ).all(scopeKind, scopeId, limit) as unknown as Array<{ id: string; kind: string; canonical_text: string; expires_at: string | null; factual_at: string | null; created_at: string }>
    if (rows.length === 0) return '当前没有待处理候选（scope: ' + scopeKind + '/' + scopeId + '）。'
    const lines: string[] = ['待处理候选 ' + String(rows.length) + ' 条（scope: ' + scopeKind + '/' + scopeId + '，最老优先；用 memory_review 确认或拒绝）：']
    for (const row of rows) {
      lines.push('- [' + row.id + '] (' + row.kind + ') ' + row.canonical_text
        + '  // 事实时间: ' + (row.factual_at !== null ? row.factual_at.slice(0, 10) : '未记录（录入 ' + row.created_at.slice(0, 10) + '）')
        + '  // 到期: ' + String(row.expires_at ?? '未设') + (row.expires_at !== null && row.expires_at <= now ? '（已过期，将被清理）' : ''))
    }
    return lines.join('\n')
  }

  /** 评审候选：confirm → active + user_confirmed；reject → archived（退出候选队列与默认召回）。 */
  reviewCandidate(input: { id: string; decision: 'confirm' | 'reject'; scope?: string | undefined; projectId?: string | undefined; rationale?: string | undefined }): string {
    const id = String(input.id ?? '').trim()
    if (id === '') throw new Error('必须提供候选 id（来自 memory_candidates）。')
    const decision = input.decision === 'reject' ? 'reject' : 'confirm'
    const useProject = input.scope === 'project' || (input.projectId !== undefined && input.projectId !== '')
    const { db, scopeKind, scopeId } = useProject ? this.shard('project', input.projectId) : this.shard('global_user')
    const now = new Date().toISOString()
    const claim = db.prepare('SELECT id, kind, canonical_text, status, revision FROM claims WHERE id = ? AND scope_kind = ? AND scope_id = ?').get(id, scopeKind, scopeId) as
      | { id: string; kind: string; canonical_text: string; status: string; revision: number }
      | undefined
    if (claim === undefined) throw new Error('未找到候选 ' + id + '（scope: ' + scopeKind + '/' + scopeId + '）。')
    if (claim.status !== 'candidate') throw new Error('条目 ' + id + ' 当前状态是 ' + claim.status + '，不是候选。')
    if (decision === 'confirm') {
      db.prepare("UPDATE claims SET status = 'active', authority_class = 'user_confirmed', last_verified_at = ?, updated_at = ?, revision = revision + 1, expires_at = NULL WHERE id = ?")
        .run(now, now, id)
      db.prepare("UPDATE candidate_idempotency SET outcome = 'promoted' WHERE claim_id = ?").run(id)
      // P4-2：确认提升的条目进入嵌入队列。
      db.prepare("INSERT INTO embedding_jobs(claim_id, state, created_at, updated_at) VALUES (?, 'pending', ?, ?) ON CONFLICT(claim_id) DO NOTHING")
        .run(id, now, now)
    } else {
      db.prepare("UPDATE claims SET status = 'archived', updated_at = ?, expires_at = NULL WHERE id = ?").run(now, id)
      db.prepare("UPDATE candidate_idempotency SET outcome = 'rejected' WHERE claim_id = ?").run(id)
    }
    db.prepare('INSERT INTO promotion_events(id, claim_id, decision, reviewer, rationale, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(uuidv7(), id, decision, 'user', String(input.rationale ?? '').trim().slice(0, 500), now)
    return decision === 'confirm'
      ? '已确认：' + id + ' → active + user_confirmed（scope: ' + scopeKind + '/' + scopeId + '）。'
      : '已拒绝：' + id + ' → archived（退出候选队列与默认召回）。'
  }

  /** 过期清理（维护任务）：删除到期候选并保留幂等键 outcome；返回清理数。 */
  expireCandidates(): number {
    const now = new Date().toISOString()
    let expired = 0
    for (const rel of ['private/user.sqlite3', ...this.listRegisteredProjects().map((id) => join('projects', id, 'memory.sqlite3'))]) {
      let store: OpenStore
      try { store = openShard(join(this.dbRoot, rel), { encrypted: this.encrypted, keyRoot: this.dbRoot }) } catch { continue }
      try {
        store.db.prepare("UPDATE candidate_idempotency SET outcome = 'expired' WHERE outcome = 'pending' AND claim_id IN (SELECT id FROM claims WHERE status = 'candidate' AND expires_at IS NOT NULL AND expires_at <= ?)").run(now)
        const result = store.db.prepare("DELETE FROM claims WHERE status = 'candidate' AND expires_at IS NOT NULL AND expires_at <= ?").run(now) as { changes?: number | bigint }
        expired += Number(result.changes ?? 0)
      } finally {
        store.db.close()
      }
    }
    return expired
  }

  /** 候选摘要块（挂入 summary）：待处理数、最老 3 条、本分片决策统计。 */
  candidateDigest(db: EngineHandle, scopeKind: string, scopeId: string): string {
    const pending = db.prepare("SELECT COUNT(*) AS c FROM claims WHERE scope_kind = ? AND scope_id = ? AND status = 'candidate'").get(scopeKind, scopeId) as { c: number }
    const oldest = db.prepare("SELECT id, kind, canonical_text, expires_at FROM claims WHERE scope_kind = ? AND scope_id = ? AND status = 'candidate' ORDER BY created_at ASC LIMIT 3")
      .all(scopeKind, scopeId) as unknown as Array<{ id: string; kind: string; canonical_text: string; expires_at: string | null }>
    const decisions = db.prepare("SELECT decision, COUNT(*) AS c FROM promotion_events WHERE created_at >= ? GROUP BY decision ORDER BY c DESC")
      .all(new Date(Date.now() - 7 * 86_400_000).toISOString()) as unknown as Array<{ decision: string; c: number }>
    const lines = ['候选队列: 待处理 ' + String(pending.c) + ' 条（14 天不处理自动过期）']
    if (oldest.length > 0) {
      lines.push('最老候选:')
      for (const row of oldest) lines.push('  - [' + row.id + '] ' + row.canonical_text.slice(0, 120))
    }
    if (decisions.length > 0) lines.push('近 7 天评审: ' + decisions.map((d) => d.decision + ' ' + String(d.c)).join(' / '))
    return lines.join('\n')
  }
  /** 紧凑摘要（渐进披露第一层）：种类/状态计数、高重要性条目、最近更新、冲突对。 */
  summary(input: ExportInput & { limit?: number | undefined }): string {
    const useProject = input.scope === 'project' || (input.projectId !== undefined && input.projectId !== '')
    const { db, scopeKind, scopeId } = useProject ? this.shard('project', input.projectId) : this.shard('global_user')
    const topLimit = Math.min(Math.max(Number(input.limit ?? SUMMARY_TOP_CLAIMS) || SUMMARY_TOP_CLAIMS, 1), 10)
    const kindCounts = db.prepare(
      "SELECT kind, COUNT(*) AS c FROM claims WHERE scope_kind = ? AND scope_id = ? AND status = 'active' GROUP BY kind ORDER BY c DESC",
    ).all(scopeKind, scopeId) as unknown as Array<{ kind: string; c: number }>
    const statusCounts = db.prepare(
      'SELECT status, COUNT(*) AS c FROM claims WHERE scope_kind = ? AND scope_id = ? GROUP BY status',
    ).all(scopeKind, scopeId) as unknown as Array<{ status: string; c: number }>
    const top = db.prepare(
      "SELECT id, kind, canonical_text, importance FROM claims WHERE scope_kind = ? AND scope_id = ? AND status = 'active' ORDER BY importance DESC, updated_at DESC LIMIT ?",
    ).all(scopeKind, scopeId, topLimit) as unknown as Array<{ id: string; kind: string; canonical_text: string; importance: number }>
    // P6-3：项目记忆的「最近」以事实时间为准（没有事实时间才回退验证/录入时间）。
    const recent = db.prepare(
      "SELECT id, kind, canonical_text, COALESCE(factual_at, last_verified_at, updated_at) AS fresh_at FROM claims WHERE scope_kind = ? AND scope_id = ? AND status = 'active' ORDER BY fresh_at DESC LIMIT ?",
    ).all(scopeKind, scopeId, SUMMARY_RECENT_CLAIMS) as unknown as Array<{ id: string; kind: string; canonical_text: string; fresh_at: string }>
    const conflicts = db.prepare(
      'SELECT cr.source_id AS a, cr.target_id AS b, s.canonical_text AS at, t.canonical_text AS bt FROM claim_relations cr JOIN claims s ON s.id = cr.source_id JOIN claims t ON t.id = cr.target_id WHERE cr.kind = ? LIMIT 5',
    ).all('CONFLICTS_WITH') as unknown as Array<{ a: string; b: string; at: string; bt: string }>
    const lines: string[] = ['紧凑摘要（scope: ' + scopeKind + '/' + scopeId + '；不可信历史参考，先看这里再决定是否 query）']
    lines.push('active: ' + kindCounts.map((row) => row.kind + '×' + String(row.c)).join(' ') + '（' + (kindCounts.length === 0 ? '无' : '共 ' + String(kindCounts.reduce((sum, row) => sum + row.c, 0)) + ' 条') + '）')
    lines.push('status: ' + statusCounts.map((row) => row.status + '×' + String(row.c)).join(' '))
    lines.push('重要条目（importance 排序）：')
    for (const row of top) lines.push('  [' + row.kind + '] ' + row.canonical_text + '（' + row.id.slice(0, 8) + '）')
    lines.push('最近验证/更新：')
    for (const row of recent) lines.push('  [' + row.kind + '] ' + row.canonical_text + '（' + row.fresh_at.slice(0, 10) + '）')
    lines.push('冲突对（需成对呈现）：')
    if (conflicts.length === 0) lines.push('  （无）')
    for (const pair of conflicts) lines.push('  ' + pair.at + ' ⇄ ' + pair.bt)
    lines.push('')
    lines.push(this.candidateDigest(db, scopeKind, scopeId))
    const text = lines.join('\n')
    if (byteLength(text) > SUMMARY_MAX_BYTES) {
      return text.slice(0, Math.floor(SUMMARY_MAX_BYTES * 0.8)) + '\n…（摘要超出预算，已截断；请用 memory_query 精确检索）'
    }
    return text
  }

  list(input: ListInput): string {
    const limit = Math.min(Math.max(Number(input.limit ?? 20) || 20, 1), 50)
    const useProject = input.scope === 'project' || (input.projectId !== undefined && input.projectId !== '')
    const { db, scopeKind, scopeId } = useProject ? this.shard('project', input.projectId) : this.shard('global_user')
    const conditions = ['scope_kind = ?', 'scope_id = ?']
    const args: Array<string | number> = [scopeKind, scopeId]
    if (typeof input.kind === 'string' && input.kind !== '') { conditions.push('kind = ?'); args.push(input.kind) }
    if (typeof input.status === 'string' && input.status !== '') { conditions.push('status = ?'); args.push(input.status) }
    const rows = db.prepare(
      'SELECT id, kind, status, authority_class, canonical_text, factual_at, created_at FROM claims WHERE ' + conditions.join(' AND ') + ' ORDER BY updated_at DESC LIMIT ?',
    ).all(...args, limit) as unknown as Array<{ id: string; kind: string; status: string; authority_class: string; canonical_text: string; factual_at: string | null; created_at: string }>
    if (rows.length === 0) return '（空）'
    return rows.map((row) => row.id + ' [' + row.status + ' / ' + row.authority_class + ' / ' + row.kind + '] ' + row.canonical_text
      + '  // ' + (row.factual_at !== null ? '事实 ' + row.factual_at.slice(0, 10) : '录 ' + row.created_at.slice(0, 10))).join('\n')
  }

  status(): string {
    const lines: string[] = ['dbRoot: ' + this.dbRoot]
    lines.push('registered projects: ' + (this.listRegisteredProjects().join(', ') || '（无）'))
    const shards = ['private/user.sqlite3', ...this.listRegisteredProjects().map((id) => join('projects', id, 'memory.sqlite3'))]
    for (const rel of shards) {
      const path = join(this.dbRoot, rel)
      if (!existsSync(path)) { lines.push('shard ' + rel + ': 未创建'); continue }
      const store = openShard(path, { encrypted: this.encrypted, keyRoot: this.dbRoot })
      const counts = store.db.prepare("SELECT COUNT(*) AS c FROM claims WHERE status = 'active'").get() as { c: number }
      const fts = store.db.prepare('SELECT COUNT(*) AS c FROM claims_fts').get() as { c: number }
      lines.push('shard ' + rel + ': schemaVersion=' + String(store.version) + ' active=' + String(counts.c) + ' ftsRows=' + String(fts.c))
      store.db.close()
    }
    lines.push('schemaVersion: ' + String(this.catalog().version))
    return lines.join('\n')
  }

  private findClaim(id: string): { shardRef: ShardRef; row: ClaimRow } | null {
    const candidates: Array<ShardRef> = [this.shard('global_user')]
    for (const project of this.listRegisteredProjects()) candidates.push(this.shard('project', project))
    for (const ref of candidates) {
      const row = ref.db.prepare('SELECT * FROM claims WHERE id = ?').get(id) as ClaimRow | undefined
      if (row !== undefined) return { shardRef: ref, row }
    }
    return null
  }

  explain(id: string): string {
    const found = this.findClaim(id)
    if (found === null) throw new Error('未找到条目 ' + id + '。')
    const { shardRef, row } = found
    const evidence = shardRef.db.prepare(
      'SELECT e.kind AS kind, e.portable_locator AS locator, e.availability AS availability FROM claim_evidence ce JOIN evidence_sources e ON e.id = ce.evidence_id WHERE ce.claim_id = ?',
    ).all(id) as unknown as Array<{ kind: string; locator: string; availability: string }>
    const promotions = shardRef.db.prepare('SELECT decision, target, rationale, created_at FROM promotion_events WHERE claim_id = ? ORDER BY created_at DESC').all(id) as unknown as Array<{ decision: string; target: string | null; rationale: string | null; created_at: string }>
    const recallCount = (shardRef.db.prepare('SELECT COUNT(*) AS c FROM recall_items WHERE claim_id = ?').get(id) as { c: number }).c
    const lines = [
      'id: ' + row.id,
      'scope: ' + row.scope_kind + '/' + row.scope_id + '  kind: ' + row.kind,
      'status: ' + row.status + '  authority: ' + row.authority_class + '  sensitivity: ' + row.sensitivity_class,
      'claim: ' + row.canonical_text,
      'created_at: ' + row.created_at + '  updated_at: ' + row.updated_at + (row.last_verified_at === null ? '' : '  last_verified_at: ' + row.last_verified_at),
      'evidence: ' + (evidence.length === 0 ? '（无）' : evidence.map((e) => e.kind + ' ' + e.locator + ' (' + e.availability + ')').join('；')),
      'promotions: ' + (promotions.length === 0 ? '（无）' : promotions.map((p) => p.decision + (p.target === null ? '' : ' → ' + p.target) + (p.rationale === null || p.rationale === '' ? '' : '（' + p.rationale + '）') + ' @ ' + p.created_at).join('；')),
      'recall_uses: ' + String(recallCount),
    ]
    return lines.join('\n')
  }

  correct(id: string, correctedText: string): string {
    assertWritableContent(correctedText)
    const found = this.findClaim(id)
    if (found === null) throw new Error('未找到条目 ' + id + '。')
    const { shardRef, row } = found
    if (row.status === 'archived') throw new Error('已归档条目不可再修正。')
    const canonical = canonicalizeClaim(correctedText)
    const hash = normalizedHash(correctedText)
    const now = new Date().toISOString()
    const newId = uuidv7()
    const db = shardRef.db
    db.exec('BEGIN')
    try {
      db.prepare(`INSERT INTO claims(id, scope_kind, scope_id, kind, canonical_text, searchable_text, status, authority_class,
        confidence, importance, sensitivity_class, normalized_content_hash, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'active', 'user_confirmed', 50, 50, ?, ?, ?, ?)`).run(
        newId, row.scope_kind, row.scope_id, row.kind, canonical, buildSearchableText(canonical), row.sensitivity_class, hash, now, now,
      )
      db.prepare("UPDATE claims SET status = 'superseded', superseded_by = ?, updated_at = ? WHERE id = ?").run(newId, now, id)
      db.prepare('INSERT INTO claim_relations(source_id, target_id, kind, created_at) VALUES (?, ?, ?, ?)')
        .run(newId, id, 'SUPERSEDES', now)
      db.prepare('INSERT INTO promotion_events(id, claim_id, decision, reviewer, rationale, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(uuidv7(), id, 'archive', 'user', 'corrected by ' + newId, now)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    return '已修正：新条目 ' + newId + '（active + user_confirmed）取代 ' + id + '（superseded）。\n  claim: ' + canonical
  }

  archive(id: string, reason?: string): string {
    const found = this.findClaim(id)
    if (found === null) throw new Error('未找到条目 ' + id + '。')
    const now = new Date().toISOString()
    found.shardRef.db.prepare("UPDATE claims SET status = 'archived', updated_at = ? WHERE id = ?").run(now, id)
    found.shardRef.db.prepare('INSERT INTO promotion_events(id, claim_id, decision, reviewer, rationale, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(uuidv7(), id, 'archive', 'user', reason ?? '', now)
    return '已归档 ' + id + '（退出默认召回，保留审计）。'
  }

  /** 一致性快照：VACUUM INTO + integrity_check + manifest + sha256。 */
  backup(kind: 'daily' | 'pre-change' = 'daily'): string {
    const stamp = new Date().toISOString().replace(/[:.]/gu, '-')
    const dir = join(this.dbRoot, 'memory-snapshots', stamp)
    mkdirSync(dir, { recursive: true })
    const entries: Array<{ file: string; sha256: string }> = []
    const sources: Array<{ rel: string }> = [{ rel: join('private', 'user.sqlite3') }, { rel: 'catalog.sqlite3' },
      ...this.listRegisteredProjects().map((id) => ({ rel: join('projects', id, 'memory.sqlite3') }))]
    for (const source of sources) {
      const live = join(this.dbRoot, source.rel)
      if (!existsSync(live)) continue
      const snap = join(dir, source.rel.replace(/[\\\/]/gu, '__'))
      const cached = this.shardStores.get(source.rel)
      const opened = cached === undefined ? openShard(live, { encrypted: this.encrypted, keyRoot: this.dbRoot }) : undefined
      const db = cached?.db ?? opened!.db
      try {
        if (!db.integrityOk()) throw new Error('integrity_check 失败：' + source.rel)
        db.vacuumInto(snap)
        const hash = createHash('sha256').update(readFileSync(snap)).digest('hex')
        entries.push({ file: snap, sha256: hash })
      } finally {
        opened?.db.close()
      }
    }
    const manifest = { kind, createdAt: new Date().toISOString(), schemaVersion: 1, entries }
    const manifestPath = join(dir, 'manifest.json')
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
    return '快照完成（' + entries.length + ' 个文件）：' + dir + '\n' + entries.map((entry) => '  ' + entry.file + '  sha256=' + entry.sha256).join('\n')
  }

  /** 导出包：JSONL + manifest + hashes（仅包含非 Restrict 的长期内容；local_locator 默认省略）。 */
  exportPackage(input: ExportInput): string {
    const useProject = input.scope === 'project' || (input.projectId !== undefined && input.projectId !== '')
    const { db, scopeKind, scopeId } = useProject ? this.shard('project', input.projectId) : this.shard('global_user')
    const stamp = new Date().toISOString().replace(/[:.]/gu, '-')
    const dir = join(this.dbRoot, 'exports', 'export-' + (useProject ? scopeId : 'global-user') + '-' + stamp)
    mkdirSync(dir, { recursive: true })
    const tables: Array<{ name: string; jsonl: string }> = [
      { name: 'claims', jsonl: 'claims.jsonl' },
      { name: 'evidence_sources', jsonl: 'evidence.jsonl' },
      { name: 'claim_evidence', jsonl: 'claim_evidence.jsonl' },
      { name: 'claim_relations', jsonl: 'claim_relations.jsonl' },
      { name: 'promotion_events', jsonl: 'promotions.jsonl' },
      { name: 'tombstones', jsonl: 'tombstones.jsonl' },
    ]
    const counts: Record<string, number> = {}
    for (const table of tables) {
      const rows = db.prepare('SELECT * FROM ' + table.name).all() as unknown as Array<Record<string, unknown>>
      if (table.name === 'evidence_sources') {
        for (const row of rows) if (row.local_locator !== null) row.local_locator = null
      }
      const lines = rows.map((row) => JSON.stringify(row)).join('\n')
      writeFileSync(join(dir, table.jsonl), lines === '' ? '' : lines + '\n')
      counts[table.name] = rows.length
    }
    const manifest = {
      exportFormatVersion: 1, schemaVersion: 1, createdAt: new Date().toISOString(),
      scopeKind, scopeId, counts,
      files: tables.map((table) => ({ name: table.jsonl, sha256: createHash('sha256').update(readFileSync(join(dir, table.jsonl))).digest('hex') })),
    }
    const manifestPath = join(dir, 'manifest.json')
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
    writeFileSync(join(dir, 'hashes.sha256'), manifest.files.map((f) => f.sha256 + ' *' + f.name).join('\n') + '\n')
    return '导出完成：' + dir + '\n  counts: ' + Object.entries(counts).map(([k, v]) => k + '=' + String(v)).join(' ') + '\n  manifest: ' + manifestPath
  }

  /** 导入导出包到目标分片（P1 供 fixture 往返验证；真实导入走 shadow import 合同）。 */
  importPackage(dir: string, options: ExportInput): string {
    const useProject = options.scope === 'project' || (options.projectId !== undefined && options.projectId !== '')
    const { db } = useProject ? this.shard('project', options.projectId) : this.shard('global_user')
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as { counts: Record<string, number> }
    const tables: Array<{ name: string; jsonl: string }> = [
      { name: 'claims', jsonl: 'claims.jsonl' },
      { name: 'evidence_sources', jsonl: 'evidence.jsonl' },
      { name: 'claim_evidence', jsonl: 'claim_evidence.jsonl' },
      { name: 'claim_relations', jsonl: 'claim_relations.jsonl' },
      { name: 'promotion_events', jsonl: 'promotions.jsonl' },
      { name: 'tombstones', jsonl: 'tombstones.jsonl' },
    ]
    let inserted = 0
    db.exec('BEGIN')
    try {
      for (const table of tables) {
        const rows = readFileSync(join(dir, table.jsonl), 'utf8').trim() === ''
          ? []
          : readFileSync(join(dir, table.jsonl), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>)
        for (const row of rows) {
          const columns = Object.keys(row)
          const values = columns.map((column) => row[column]) as unknown as Array<string | number | bigint | Uint8Array | null>
          db.prepare('INSERT INTO ' + table.name + ' (' + columns.join(', ') + ') VALUES (' + columns.map(() => '?').join(', ') + ')')
            .run(...values)
          inserted += 1
        }
      }
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    return '导入完成：' + String(inserted) + ' 行（counts: ' + JSON.stringify(manifest.counts) + '）'
  }

  close(): void {
    for (const store of this.shardStores.values()) store.db.close()
    this.shardStores.clear()
    this.catalogStore?.db.close()
    this.catalogStore = null
  }
}
