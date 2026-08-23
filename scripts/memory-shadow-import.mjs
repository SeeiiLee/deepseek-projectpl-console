// P6-1 shadow import（fixture 版）：临时新库 → 迁移 → 模拟导入 → 全量对账 → 原子切换 → 回滚。
// 真实导入写入器将在 P6-0C/P6-2 接入（本脚本先证明「导错也能安全退出」的机制）。
// 用法：node scripts/memory-shadow-import.mjs [--plaintext]
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
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

const PLAINTEXT = process.argv.includes('--plaintext')
const base = mkdtempSync(join(tmpdir(), 'dsh-shadow-'))
const live = join(base, 'live')
const receiptPath = join(base, 'shadow-receipt.json')

function statsOf(root) {
  const out = {}
  for (const [key, rel] of [['global', join('private', 'user.sqlite3')], ['projA', join('projects', 'proj-A', 'memory.sqlite3')]]) {
    const store = openShard(join(root, rel), PLAINTEXT ? {} : { encrypted: true, keyRoot: root })
    out[key] = {
      integrity: store.db.integrityOk(),
      claims: Number(store.db.prepare('SELECT COUNT(*) AS c FROM claims').get().c),
      active: Number(store.db.prepare("SELECT COUNT(*) AS c FROM claims WHERE status = 'active'").get().c),
      ftsRows: Number(store.db.prepare('SELECT COUNT(*) AS c FROM claims_fts').get().c),
      fkViolations: Number(store.db.prepare('PRAGMA foreign_key_check').all().length),
      schemaVersion: store.version,
    }
    store.db.close()
  }
  const catalog = openCatalog(join(root, 'catalog.sqlite3'), PLAINTEXT ? {} : { encrypted: true, keyRoot: root })
  out.catalog = { integrity: catalog.db.integrityOk(), projects: Number(catalog.db.prepare('SELECT COUNT(*) AS c FROM memory_projects').get().c), schemaVersion: catalog.version }
  catalog.db.close()
  return out
}

// ---------- 阶段 1：建 live 库（加密或明文）+ 基线 ----------
{
  const service = new MemoryService({ dbRoot: live, encrypted: !PLAINTEXT })
  service.registerProject('proj-A')
  service.record({ kind: 'pattern', text: '基线记忆一：发布前必须跑完整测试。', scope: 'global_user', confirm: true })
  service.record({ kind: 'project_fact', text: '基线项目记忆：结算串行执行。', scope: 'project', projectId: 'proj-A', confirm: true })
  const recallBefore = service.query({ q: '发布前', scope: 'global_user' })
  service.close()
  globalThis.recallBefore = recallBefore
}
const before = statsOf(live)
check('live 建库（' + (PLAINTEXT ? '明文' : '加密') + '）', before.global.integrity && before.catalog.integrity, 'claims=' + before.global.claims + ' schema=' + before.catalog.schemaVersion)

// ---------- 阶段 2：shadow 副本 + 迁移 + 模拟导入 ----------
const shadow = join(base, 'shadow')
cpSync(live, shadow, { recursive: true })
{
  const service = new MemoryService({ dbRoot: shadow, encrypted: !PLAINTEXT })
  // 模拟导入批次（真实写入器后续接入；写入必须在 shadow 上，绝不能碰 live）
  service.record({ kind: 'pattern', text: '模拟导入记忆一：换说法也能召回的约定。', scope: 'global_user', confirm: true })
  service.record({ kind: 'pattern', text: '模拟导入记忆二：备份先过完整性校验。', scope: 'global_user', confirm: true })
  service.record({ kind: 'project_fact', text: '模拟导入项目记忆：对账回滚。', scope: 'project', projectId: 'proj-A', confirm: true })
  service.close()
}
const afterImport = statsOf(shadow)
check('shadow 迁移到最新 schema', afterImport.catalog.schemaVersion === 4 && afterImport.global.schemaVersion === 4)
check('shadow 导入后计数正确', afterImport.global.active === before.global.active + 2 && afterImport.projA.active === before.projA.active + 1,
  'global ' + afterImport.global.active + '/' + (before.global.active + 2) + ' projA ' + afterImport.projA.active + '/' + (before.projA.active + 1))
check('shadow FTS 与 claims 对账', afterImport.global.ftsRows === afterImport.global.claims && afterImport.projA.ftsRows === afterImport.projA.claims)
check('shadow 外键零违规', afterImport.global.fkViolations === 0 && afterImport.projA.fkViolations === 0)
check('live 未被污染', statsOf(live).global.claims === before.global.claims)

// ---------- 阶段 3：召回回归（shadow 上导入后仍能召回基线内容） ----------
{
  const service = new MemoryService({ dbRoot: shadow, encrypted: !PLAINTEXT })
  const recallAfter = service.query({ q: '发布前', scope: 'global_user' })
  service.close()
  check('shadow 召回回归一致', recallAfter === globalThis.recallBefore, '基线查询输出逐字一致')
}

// ---------- 阶段 4：原子切换（live → .old；shadow → live）与回滚 ----------
const old = live + '.old-' + Date.now()
renameSync(live, old)
renameSync(shadow, live)
{
  const switched = statsOf(live)
  check('原子切换后 live 可开且为导入后状态', switched.global.active === before.global.active + 2 && switched.catalog.schemaVersion === 4)
}
renameSync(live, shadow)
renameSync(old, live)
{
  const rolledBack = statsOf(live)
  check('回滚后 live 回到基线', rolledBack.global.claims === before.global.claims && rolledBack.global.integrity)
}

const receipt = { startedAt: new Date().toISOString(), plaintext: PLAINTEXT, checks, passed: checks.every((c) => c.ok) }
writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + NL, 'utf8')
const archiveDir = 'F:/AI/memory-drill-receipts'
mkdirSync(archiveDir, { recursive: true })
cpSync(receiptPath, join(archiveDir, 'shadow-import-' + new Date().toISOString().replace(/[:.]/gu, '-') + '.json'))
console.log('receipt: ' + receiptPath)
console.log(receipt.passed ? 'SHADOW PASS' : 'SHADOW FAIL')
rmSync(base, { recursive: true, force: true })
process.exit(receipt.passed ? 0 : 1)
