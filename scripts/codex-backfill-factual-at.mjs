// P6-3 回填：为既有候选按 evidence locator 补 factual_at（turn-index 时间戳）。
// ⚠️ 安全守卫：分片 schemaVersion < 5 时拒绝执行——避免把稳定库从 v4 迁到 v5 导致仍在运行的旧版应用 fail closed。
// 运行时机：稳定版更新到携带 v5 的构建之后。用法：node scripts/codex-backfill-factual-at.mjs [dbRoot] [projectId] [packageDir]
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { openEngine } from '../plugins/memory/src/core/engine.ts'
import { openShard, prepareDataKey } from '../plugins/memory/src/core/store.ts'

const [, , dbRootArg, projectIdArg, packageDirArg] = process.argv
const dbRoot = dbRootArg ?? 'F:/documents/Cyrus Deepseek Harness Data/memory-live'
const projectId = projectIdArg ?? 'prj_01a0109b-0dd8-7bfb-be07-ee80c768640d'
const packageDir = packageDirArg ?? 'F:/AI/codex-import/package-snapshot-v2'
const shardPath = join(dbRoot, 'projects', projectId, 'memory.sqlite3')
if (!existsSync(shardPath)) throw new Error('分片不存在：' + shardPath)

// 守卫：先开引擎（不跑迁移）读 schemaVersion
const probe = openEngine(shardPath, { encrypted: true, key: prepareDataKey(dbRoot, shardPath) })
const meta = probe.prepare("SELECT value FROM meta WHERE key = 'schemaVersion'").get()
const version = Number.parseInt(String(meta?.value ?? '0'), 10)
probe.close()
if (version < 5) {
  console.log('GUARD: 分片 schemaVersion=' + version + ' < 5——稳定版应用尚未升级到 v5 构建，禁止迁移（否则其记忆 fail closed）。请先更新应用再运行。')
  process.exit(3)
}

const store = openShard(shardPath, { encrypted: true, keyRoot: dbRoot })
const candidates = store.db.prepare("SELECT id, canonical_text FROM claims WHERE scope_kind = 'project' AND status = 'candidate' AND factual_at IS NULL").all()
console.log('待回填候选: ' + candidates.length)

const turnIndexPath = join(packageDir, 'turn-index.jsonl')
if (!existsSync(turnIndexPath)) throw new Error('缺少 turn-index.jsonl：' + turnIndexPath)
const byLocator = new Map()
for (const line of readFileSync(turnIndexPath, 'utf8').trim().split(/\r?\n/u).filter((l) => l !== '')) {
  const row = JSON.parse(line)
  if (typeof row?.timestamp === 'string' && row.timestamp !== '') byLocator.set(row.locator, row.timestamp)
}

let updated = 0
let missing = 0
for (const claim of candidates) {
  const evidence = store.db.prepare(
    'SELECT e.portable_locator AS locator FROM claim_evidence ce JOIN evidence_sources e ON e.id = ce.evidence_id WHERE ce.claim_id = ? LIMIT 1',
  ).get(claim.id)
  const locator = typeof evidence?.locator === 'string' ? evidence.locator : ''
  const timestamp = locator === '' ? undefined : byLocator.get(locator)
  if (timestamp === undefined) { missing += 1; continue }
  store.db.prepare('UPDATE claims SET factual_at = ? WHERE id = ?').run(timestamp, claim.id)
  updated += 1
}
console.log('回填完成: updated=' + updated + ' missing=' + missing)
store.db.close()
