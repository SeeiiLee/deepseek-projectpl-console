import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { assertWritableContent, canonicalizeClaim, normalizedHash } from '../src/core/gates.ts'
import { MemoryService, uuidv7 } from '../src/core/service.ts'
import { migrationsDir, openShard } from '../src/core/store.ts'

function makeService() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-memory-test-'))
  const service = new MemoryService({ dbRoot: join(root, 'memory-live') })
  return { root, service }
}

test('write gate blocks credentials, id numbers and oversize claims', () => {
  assert.throws(() => assertWritableContent('把 sk-aaaaaaaaaaaaaaaaaaaa123 存起来'), /写入拒绝/u)
  assert.throws(() => assertWritableContent('身份证 11010519491231002X'), /写入拒绝/u)
  assert.throws(() => assertWritableContent('卡号 62220202001122334455'), /写入拒绝/u)
  assert.throws(() => assertWritableContent('x'.repeat(4001)), /上限/u)
  assert.throws(() => assertWritableContent('  '), /不能为空/u)
  assert.equal(canonicalizeClaim('  a   b\tc '), 'a b c')
  assert.equal(normalizedHash('a b'), normalizedHash('  a b  '))
})

test('uuidv7 looks like a version-7 uuid', () => {
  const value = uuidv7()
  assert.match(value, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u)
})

test('record: candidate first, confirm promotes, dedup refuses repeats', () => {
  const { root, service } = makeService()
  try {
    const out1 = service.record({ kind: 'global_fact', text: '本机无全局 pnpm，用 npx pnpm', scope: 'global_user' })
    assert.match(out1, /候选/u)
    assert.match(out1, /confirm=true/u)
    const id = /（candidate[^）]*）：([0-9a-f-]{36})/u.exec(out1)?.[1]
    assert.ok(id)
    const out2 = service.record({ kind: 'global_fact', text: '本机无全局 pnpm，用 npx pnpm', scope: 'global_user' })
    assert.match(out2, /未重复写入/u)
    const out3 = service.record({ kind: 'global_fact', text: '本机无全局 pnpm，用 npx pnpm', scope: 'global_user', confirm: true })
    assert.match(out3, /未重复写入/u, 'dedup even on confirm')
    const out4 = service.record({ kind: 'user_profile', text: 'Cyrus 喜欢先看结论', scope: 'global_user', confirm: true })
    assert.match(out4, /active \+ user_confirmed/u)
  } finally {
    service.close()
    rmSync(root, { recursive: true, force: true })
  }
test('factual_at roundtrips and surfaces in candidates/list render (P6-3)', () => {
  const { root, service } = makeService()
  try {
    service.registerProject('proj-F')
    service.record({ kind: 'event', text: 'factual-marker 上线发布完成', scope: 'project', projectId: 'proj-F', factualAt: '2026-07-29T01:42:23.000Z' })
    service.record({ kind: 'event', text: 'factual-marker 无事实时间的条目', scope: 'project', projectId: 'proj-F' })
    const candidates = service.listCandidates({ scope: 'project', projectId: 'proj-F', limit: 5 })
    assert.match(candidates, /事实时间: 2026-07-29/u)
    assert.match(candidates, /事实时间: 未记录（录入 \d{4}-\d{2}-\d{2}）/u)
    const list = service.list({ scope: 'project', projectId: 'proj-F', status: 'candidate' })
    assert.match(list, /事实 2026-07-29/u)
    assert.match(list, /录 \d{4}-\d{2}-\d{2}/u)
  } finally {
    service.close()
    rmSync(root, { recursive: true, force: true })
  }
})

})

test('project writes fail closed until registered; cross-project recall is zero', () => {
  const { root, service } = makeService()
  try {
    assert.throws(() => service.record({ kind: 'event', text: 'x', scope: 'project', projectId: 'proj-A' }), /未登记/u)
    service.registerProject('proj-A')
    service.registerProject('proj-B')
    service.record({ kind: 'event', text: 'alpha-project-marker 配方调整', scope: 'project', projectId: 'proj-A', confirm: true })
    service.record({ kind: 'event', text: 'alpha-project-marker 定价策略', scope: 'project', projectId: 'proj-B', confirm: true })
    const a = service.query({ q: 'alpha', scope: 'project', projectId: 'proj-A' })
    const b = service.query({ q: 'alpha', scope: 'project', projectId: 'proj-B' })
    assert.match(a, /配方调整/u)
    assert.doesNotMatch(a, /定价策略/u, 'project A must not see project B claims')
    assert.match(b, /定价策略/u)
    assert.doesNotMatch(b, /配方调整/u)
    const global = service.query({ q: 'alpha' })
    assert.match(global, /未找到/u, 'global query must not touch project shards')
  } finally {
    service.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('correct supersedes; archive exits default recall; explain shows provenance', () => {
  const { root, service } = makeService()
  try {
    const first = service.record({ kind: 'global_fact', text: '构建命令是 pnpm run pack', scope: 'global_user', confirm: true })
    const id = /：([0-9a-f-]{36})/u.exec(first)?.[1]
    assert.ok(id)
    const fixed = service.correct(id, '构建命令是 npx pnpm run pack:win')
    assert.match(fixed, /superseded/u)
    const newId = /新条目 ([0-9a-f-]{36})/u.exec(fixed)?.[1]
    assert.ok(newId)
    assert.notEqual(newId, id)
    const q1 = service.query({ q: '构建命令' })
    assert.match(q1, /pack:win/u)
    assert.doesNotMatch(q1, /run pack'/u, 'superseded claim exits default recall')
    const explanation = service.explain(newId)
    assert.match(explanation, /status: active/u)
    assert.match(explanation, /recall_uses: 1/u)
    const archived = service.archive(newId, '策略已变更')
    assert.match(archived, /已归档/u)
    const q2 = service.query({ q: 'pack:win' })
    assert.match(q2, /未找到/u, 'archived claim exits default recall')
    const listed = service.list({ status: 'archived' })
    assert.match(listed, /archived/u)
    assert.match(service.explain(newId), /archive/u)
    assert.match(service.explain(newId), /策略已变更/u)
  } finally {
    service.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('export/import roundtrip preserves counts and content', () => {
  const { root, service } = makeService()
  try {
    service.record({ kind: 'global_fact', text: 'roundtrip marker one', scope: 'global_user', confirm: true })
    service.record({ kind: 'user_profile', text: 'roundtrip marker two', scope: 'global_user', confirm: true })
    const exported = service.exportPackage({ scope: 'global_user' })
    const dir = /导出完成：([^\n]+)/u.exec(exported)?.[1]?.trim()
    assert.ok(dir)
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
    assert.equal(manifest.counts.claims, 2)
    const hashes = readFileSync(join(dir, 'hashes.sha256'), 'utf8')
    assert.match(hashes, /claims\.jsonl/u)
    const target = new MemoryService({ dbRoot: join(root, 'memory-live-2') })
    try {
      target.importPackage(dir, { scope: 'global_user' })
      const q = target.query({ q: 'roundtrip' })
      assert.match(q, /marker one/u)
      assert.match(q, /marker two/u)
    } finally {
      target.close()
    }
  } finally {
    service.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('backup produces verified snapshots with manifest and hashes', () => {
  const { root, service } = makeService()
  try {
    service.record({ kind: 'global_fact', text: 'backup drill claim', scope: 'global_user', confirm: true })
    const report = service.backup('pre-change')
    assert.match(report, /快照完成/u)
    assert.match(report, /sha256=/u)
    const dir = /快照完成（\d+ 个文件）：([^\n]+)/u.exec(report)?.[1]?.trim()
    assert.ok(dir)
    assert.ok(existsSync(join(dir, 'manifest.json')))
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
    assert.equal(manifest.kind, 'pre-change')
    assert.ok(manifest.entries.length >= 1)
  } finally {
    service.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('unsupported newer schemaVersion refuses to open (fail closed)', () => {
  const { root, service } = makeService()
  try {
    service.record({ kind: 'global_fact', text: 'seed', scope: 'global_user', confirm: true })
    const shardPath = join(root, 'memory-live', 'private', 'user.sqlite3')
    const db = new DatabaseSync(shardPath)
    db.prepare("INSERT INTO meta(key, value) VALUES ('schemaVersion', '999') ON CONFLICT(key) DO UPDATE SET value = '999'").run()
    db.close()
    assert.throws(() => openShard(shardPath), /高于当前支持版本/u)
  } finally {
    service.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('migrations dir resolves in both source and bundled layouts', () => {
  assert.ok(existsSync(join(migrationsDir(), '0001_initial.sql')))
})
