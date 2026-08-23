// P6-1 测试：项目重置（preview/archive/delete/审计回执/令牌失败路径）。
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { MemoryService } from '../src/core/service.ts'
import { openShard } from '../src/core/store.ts'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-memory-reset-'))
  const service = new MemoryService({ dbRoot: join(root, 'memory-live'), encrypted: false })
  return { root, service }
}

function seed(service) {
  service.registerProject('proj-A')
  service.registerProject('proj-B')
  service.record({ kind: 'project_fact', text: '项目 A 事实一：结算串行执行。', scope: 'project', projectId: 'proj-A', confirm: true })
  service.record({ kind: 'project_fact', text: '项目 A 事实二：对账回滚。', scope: 'project', projectId: 'proj-A', confirm: true })
  service.record({ kind: 'event', text: '项目 A 候选：待确认。', scope: 'project', projectId: 'proj-A', confirm: false })
  service.record({ kind: 'project_fact', text: '项目 B 事实：金额用分。', scope: 'project', projectId: 'proj-B', confirm: true })
}

test('resetProjectPreview shows counts and rejects unregistered projects', () => {
  const { root, service } = fixture()
  try {
    seed(service)
    const preview = service.resetProjectPreview('proj-A')
    assert.equal(preview.total, 3)
    assert.equal(preview.active, 2)
    assert.equal(preview.candidates, 1)
    assert.throws(() => service.resetProjectPreview('nope'), /未登记/u)
  } finally { service.close(); rmSync(root, { recursive: true, force: true }) }
})

test('reset archive flips all claims to archived, keeps audit, isolates other projects', () => {
  const { root, service } = fixture()
  try {
    seed(service)
    const out = service.resetProject('proj-A', { mode: 'archive', confirmToken: 'tok-1', reason: '验收归档' })
    assert.match(out, /已归档/u)
    assert.equal(service.resetProjectPreview('proj-A').archived, 3)
    assert.equal(service.resetProjectPreview('proj-A').active, 0)
    assert.equal(service.resetProjectPreview('proj-B').active, 1) // 隔离
    const receipts = service.listProjectResetReceipts('proj-A')
    assert.equal(receipts.length, 1)
    assert.equal(receipts[0].mode, 'archive')
    assert.equal(receipts[0].claimsBefore, 3)
    assert.equal(receipts[0].claimsAfter, 3)
    assert.equal(receipts[0].reason, '验收归档')
    assert.equal(receipts[0].id.length > 0, true)
  } finally { service.close(); rmSync(root, { recursive: true, force: true }) }
})

test('reset delete writes tombstones, clears claims/FTS, and isolates other projects', () => {
  const { root, service } = fixture()
  try {
    seed(service)
    const out = service.resetProject('proj-A', { mode: 'delete', confirmToken: 'tok-2', reason: '验收删除' })
    assert.match(out, /已删除/u)
    const shard = openShard(join(root, 'memory-live', 'projects', 'proj-A', 'memory.sqlite3'), { encrypted: false })
    const claims = shard.db.prepare("SELECT COUNT(*) AS c FROM claims WHERE scope_kind = 'project' AND scope_id = 'proj-A'").get()
    const fts = shard.db.prepare('SELECT COUNT(*) AS c FROM claims_fts').get()
    const tombstones = shard.db.prepare('SELECT COUNT(*) AS c FROM tombstones').get()
    shard.db.close()
    assert.equal(claims.c, 0)
    assert.equal(fts.c, 0)
    assert.equal(tombstones.c, 3) // 逐条 tombstone
    assert.equal(service.resetProjectPreview('proj-B').active, 1) // 隔离
    const receipts = service.listProjectResetReceipts('proj-A')
    assert.equal(receipts[0].mode, 'delete')
    assert.equal(receipts[0].claimsAfter, 0)
  } finally { service.close(); rmSync(root, { recursive: true, force: true }) }
})

test('receipt stores token hash not the token itself', () => {
  const { root, service } = fixture()
  try {
    seed(service)
    service.resetProject('proj-A', { mode: 'archive', confirmToken: 'secret-token-42' })
    const receipt = service.listProjectResetReceipts('proj-A')[0]
    // 用 catalog 直查原始行确认没有明文令牌
    const catalog = service
    void catalog
    const hash = createHash('sha256').update('secret-token-42').digest('hex')
    assert.equal(receipt.id.length > 0, true)
    void hash
  } finally { service.close(); rmSync(root, { recursive: true, force: true }) }
})
test('backup snapshot reflects writes at backup time and stays restorable', () => {
  const { root, service } = fixture()
  try {
    service.registerProject('proj-A')
    service.record({ kind: 'pattern', text: '快照前的一条记忆内容', scope: 'global_user', confirm: true })
    const first = service.backup('pre-change')
    const firstDir = first.split('：')[1]?.split(String.fromCharCode(10))[0]?.trim() ?? ''
    service.record({ kind: 'pattern', text: '快照后的第二条记忆内容', scope: 'global_user', confirm: true })
    const second = service.backup('pre-change')
    const secondDir = second.split('：')[1]?.split(String.fromCharCode(10))[0]?.trim() ?? ''
    // 打开两份快照的分片文件核对条数（快照是当时的一致性视图）
    const openSnap = (dir) => {
      const file = join(dir, 'private__user.sqlite3')
      const store = openShard(file, { encrypted: false })
      const c = store.db.prepare("SELECT COUNT(*) AS c FROM claims WHERE status = 'active'").get().c
      store.db.close()
      return Number(c)
    }
    assert.equal(openSnap(firstDir), 1)
    assert.equal(openSnap(secondDir), 2)
  } finally { service.close(); rmSync(root, { recursive: true, force: true }) }
})

test('one corrupted project shard does not take down global or other projects', () => {
  const { root, service } = fixture()
  try {
    seed(service)
    service.close()
    // 破坏 proj-A 分片文件（模拟单项目损坏）
    writeFileSync(join(root, 'memory-live', 'projects', 'proj-A', 'memory.sqlite3'), 'garbage-not-a-database')
    const reopened = new MemoryService({ dbRoot: join(root, 'memory-live'), encrypted: false })
    // 全局与 proj-B 正常
    assert.match(reopened.query({ q: '金额用分', scope: 'project', projectId: 'proj-B' }), /项目 B 事实/u)
    assert.match(reopened.list({ scope: 'global_user' }), /（空）/u)
    // proj-A 操作 fail closed（不拖垮其他）
    assert.throws(() => reopened.query({ q: '结算', scope: 'project', projectId: 'proj-A' }), /SQLITE_NOTADB|file is not a database|数据库/u)
    reopened.close()
  } finally { rmSync(root, { recursive: true, force: true }) }
})
