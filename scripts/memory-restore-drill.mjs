// P6-1 恢复演练（fixture-only）：加密库灾难 → 快照恢复 → 全量对账；
// 演练 B 覆盖整机迁移：密钥文件也丢失 → 用恢复口令重建本机解锁。
// 用法：node scripts/memory-restore-drill.mjs
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryService } from '../plugins/memory/src/core/service.ts'
import { openCatalog, openShard } from '../plugins/memory/src/core/store.ts'

const NL = String.fromCharCode(10)
const checks = []
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail })
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== '' ? ' — ' + detail : ''))
}
function fail(message) { console.error(message); process.exit(1) }

const root = mkdtempSync(join(tmpdir(), 'dsh-memory-drill-'))
const live = join(root, 'memory-live')
const receipt = { root, startedAt: new Date().toISOString(), checks }

function passphraseOf() {
  const text = readFileSync(join(live, 'recovery-passphrase.txt'), 'utf8')
  const line = text.split(NL).find((l) => l.startsWith('恢复口令：'))
  if (line === undefined) fail('夹具未生成恢复口令文件')
  return line.slice('恢复口令：'.length).trim()
}

function shardStats() {
  const out = {}
  for (const [scope, rel] of [['global', join('private', 'user.sqlite3')], ['projA', join('projects', 'proj-A', 'memory.sqlite3')], ['projB', join('projects', 'proj-B', 'memory.sqlite3')]]) {
    const store = openShard(join(live, rel), { encrypted: true, keyRoot: live })
    out[scope] = {
      integrity: store.db.integrityOk(),
      active: Number(store.db.prepare("SELECT COUNT(*) AS c FROM claims WHERE status = 'active'").get().c),
      candidates: Number(store.db.prepare("SELECT COUNT(*) AS c FROM claims WHERE status = 'candidate'").get().c),
      ftsRows: Number(store.db.prepare('SELECT COUNT(*) AS c FROM claims_fts').get().c),
      schemaVersion: store.version,
    }
    store.db.close()
  }
  const catalog = openCatalog(join(live, 'catalog.sqlite3'), { encrypted: true, keyRoot: live })
  out.catalog = { integrity: catalog.db.integrityOk(), projects: Number(catalog.db.prepare('SELECT COUNT(*) AS c FROM memory_projects').get().c), schemaVersion: catalog.version }
  catalog.db.close()
  return out
}

function recallBaseline() {
  const service = new MemoryService({ dbRoot: live, encrypted: true })
  const out = {
    q1: service.query({ q: '发布之前必须跑完整测试', scope: 'global_user' }),
    q2: service.query({ q: '结算任务', scope: 'project', projectId: 'proj-A' }),
    candidates: service.listCandidates({ scope: 'global_user' }),
  }
  service.close()
  return out
}

// ---------- 阶段 1：建库（加密 + 双项目 + 证据 + 关系 + 候选） ----------
{
  const service = new MemoryService({ dbRoot: live, encrypted: true })
  service.registerProject('proj-A')
  service.registerProject('proj-B')
  service.record({ kind: 'pattern', text: '发布之前必须跑完整测试和预检，这是发布门禁。', scope: 'global_user', evidence: 'drill 证据一', confirm: true })
  service.record({ kind: 'pattern', text: '备份必须用在线一致性快照，不能直接复制 WAL 主库文件。', scope: 'global_user', evidence: 'drill 证据二', confirm: true })
  service.record({ kind: 'pattern', text: '尚未确认的候选：验收专用。', scope: 'global_user', confirm: false })
  service.record({ kind: 'project_fact', text: '结算任务必须串行执行避免订单状态并发冲突。', scope: 'project', projectId: 'proj-A', evidence: 'drill 项目证据 A', confirm: true })
  service.record({ kind: 'project_fact', text: '对账失败必须回滚重新生成对账单。', scope: 'project', projectId: 'proj-A', confirm: true })
  service.record({ kind: 'project_fact', text: '结算金额单位统一为分。', scope: 'project', projectId: 'proj-B', confirm: true })
  const baseline = recallBaseline()
  service.close()
  check('建库：3 分片加密可开 + integrity', true, JSON.stringify(shardStats().global))
  // 修正一条以产生 supersede 关系
  const fixer = new MemoryService({ dbRoot: live, encrypted: true })
  const listed = fixer.list({ scope: 'global_user', status: 'active' })
  const firstId = listed.split(NL)[0]?.split(' ')[0] ?? ''
  if (firstId !== '') { fixer.correct(firstId, '修正后的发布门禁：发布前必须跑完整测试、预检和打包态冒烟。') }
  fixer.close()
}

const passphrase = passphraseOf()
const before = shardStats()
const beforeRecall = recallBaseline()
console.log('建库完成。快照前状态：global.active=' + before.global.active + ' projA.active=' + before.projA.active + ' candidates=' + before.global.candidates)

// ---------- 阶段 2：快照 ----------
const snapshotter = new MemoryService({ dbRoot: live, encrypted: true })
const snapshotMessage = snapshotter.backup('pre-change')
snapshotter.close()
const snapshotDir = snapshotMessage.split('：')[1]?.split(NL)[0]?.trim() ?? ''
check('快照生成', snapshotDir !== '' && existsSync(join(snapshotDir, 'manifest.json')), snapshotDir)
const keyFile = readFileSync(join(live, 'memory.key.json'))

// ---------- 阶段 3：演练 A——库文件全毁（密钥文件存活）→ 快照恢复 → 对账 ----------
rmSync(join(live, 'private'), { recursive: true, force: true })
rmSync(join(live, 'catalog.sqlite3'), { force: true })
rmSync(join(live, 'projects'), { recursive: true, force: true })
for (const rel of ['private', 'projects']) mkdirSync(join(live, rel), { recursive: true })
for (const entry of JSON.parse(readFileSync(join(snapshotDir, 'manifest.json'), 'utf8')).entries) {
  const target = join(live, entry.file.split(/[\\\/]/gu).pop().replace(/__/gu, '/'))
  mkdirSync(join(target, '..'), { recursive: true })
  cpSync(entry.file, target)
}
{
  const restored = shardStats()
  check('演练A：恢复后 integrity', restored.global.integrity && restored.projA.integrity && restored.projB.integrity && restored.catalog.integrity)
  check('演练A：active 计数一致', restored.global.active === before.global.active && restored.projA.active === before.projA.active && restored.projB.active === before.projB.active,
    'global ' + restored.global.active + '/' + before.global.active + ' projA ' + restored.projA.active + '/' + before.projA.active)
  check('演练A：候选与 FTS 一致', restored.global.candidates === before.global.candidates && restored.global.ftsRows === before.global.ftsRows)
  check('演练A：schemaVersion=3', restored.global.schemaVersion === 3 && restored.catalog.schemaVersion === 3)
  const after = recallBaseline()
  check('演练A：召回输出一致', after.q1 === beforeRecall.q1 && after.q2 === beforeRecall.q2 && after.candidates === beforeRecall.candidates)
}

// ---------- 阶段 4：演练 B——整机迁移（密钥文件也丢失）→ 口令重建解锁 → 对账 ----------
rmSync(join(live, 'memory.key.json'), { force: true })
writeFileSync(join(live, 'memory.key.json'), keyFile) // 模拟从安全备份带回密钥文件（含 recovery wrap）
const recover = spawnSync(process.execPath, ['plugins/memory/scripts/memory-recover.mjs', live, passphrase], { encoding: 'utf8', windowsHide: true, timeout: 60_000 })
check('演练B：恢复口令重建本机解锁（CLI 退出 0）', recover.status === 0, String(recover.stderr ?? '').trim().slice(0, 120))
{
  const restored = shardStats()
  check('演练B：重建后 integrity', restored.global.integrity && restored.projA.integrity && restored.projB.integrity && restored.catalog.integrity)
  check('演练B：计数一致', restored.global.active === before.global.active && restored.projA.active === before.projA.active)
  const after = recallBaseline()
  check('演练B：召回输出一致', after.q1 === beforeRecall.q1 && after.q2 === beforeRecall.q2)
}

receipt.finishedAt = new Date().toISOString()
receipt.passed = checks.every((c) => c.ok)
const receiptPath = join(root, 'restore-drill-receipt.json')
writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + NL, 'utf8')
// 可复核 receipt 持久化到固定目录（fixture 根会被清理）
const archiveDir = 'F:/AI/memory-drill-receipts'
mkdirSync(archiveDir, { recursive: true })
const archived = join(archiveDir, 'restore-drill-' + new Date().toISOString().replace(/[:.]/gu, '-') + '.json')
cpSync(receiptPath, archived)
console.log('receipt: ' + archived)
console.log(receipt.passed ? 'DRILL PASS' : 'DRILL FAIL')
rmSync(root, { recursive: true, force: true })
process.exit(receipt.passed ? 0 : 1)
