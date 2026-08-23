import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { MemoryService } from '../src/core/service.ts'
import { openShard } from '../src/core/store.ts'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-memory-p3-'))
  const service = new MemoryService({ dbRoot: join(root, 'memory-live'), encrypted: false })
  return { root, service }
}

test('unconfirmed record lands as candidate with a TTL expiry', () => {
  const { root, service } = fixture()
  try {
    const out = service.record({ kind: 'pattern', text: 'P3 候选治理：先候选后确认', scope: 'global_user' })
    assert.match(out, /已暂存为候选/u)
    const rows = service.listCandidates({ scope: 'global_user' })
    assert.match(rows, /P3 候选治理/u)
    assert.match(rows, /到期: 20/u)
  } finally {
    service.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('review confirm promotes to active + user_confirmed and reject archives', () => {
  const { root, service } = fixture()
  try {
    service.record({ kind: 'pattern', text: '评审确认的候选 A', scope: 'global_user', confirm: false })
    service.record({ kind: 'pattern', text: '评审拒绝的候选 B', scope: 'global_user', confirm: false })
    const listed = service.listCandidates({ scope: 'global_user' })
    const idA = /\[([^\]]+)\] \(pattern\) 评审确认的候选 A/u.exec(listed)?.[1]
    const idB = /\[([^\]]+)\] \(pattern\) 评审拒绝的候选 B/u.exec(listed)?.[1]
    assert.ok(idA && idB)
    assert.match(service.reviewCandidate({ id: idA, decision: 'confirm', scope: 'global_user' }), /已确认/u)
    assert.match(service.reviewCandidate({ id: idB, decision: 'reject', scope: 'global_user' }), /已拒绝/u)
    assert.equal(service.listCandidates({ scope: 'global_user' }).includes('评审确认的候选 A'), false)
    assert.equal(service.listCandidates({ scope: 'global_user' }).includes('评审拒绝的候选 B'), false)
    const activeList = service.list({ scope: 'global_user', status: 'active' })
    assert.match(activeList, /评审确认的候选 A/u)
    assert.match(activeList, /user_confirmed/u)
    const archivedList = service.list({ scope: 'global_user', status: 'archived' })
    assert.match(archivedList, /评审拒绝的候选 B/u)
    assert.throws(() => service.reviewCandidate({ id: idA, decision: 'confirm', scope: 'global_user' }), /不是候选/u)
  } finally {
    service.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('expireCandidates removes expired candidates and preserves idempotency outcome', () => {
  const { root, service } = fixture()
  try {
    service.record({ kind: 'pattern', text: '将会过期的候选', scope: 'global_user' })
    const listed = service.listCandidates({ scope: 'global_user' })
    const id = /\[([^\]]+)\] \(pattern\) 将会过期的候选/u.exec(listed)?.[1]
    assert.ok(id)
    // 直接改库：把 expires_at 与 idempotency 置为过期（用独立连接，避免与缓存连接纠缠）
    const now = new Date().toISOString()
    const shard = openShard(join(root, 'memory-live', 'private', 'user.sqlite3'), { encrypted: false })
    shard.db.prepare("UPDATE claims SET expires_at = ? WHERE id = ?").run(new Date(Date.now() - 60_000).toISOString(), id)
    shard.db.prepare("INSERT OR IGNORE INTO candidate_idempotency(idempotency_key, claim_id, original_claim_hash, outcome, created_at) VALUES (?, ?, ?, 'pending', ?)")
      .run('test|s|1|v|0', id, 'h', now)
    shard.db.close()
    service.record({ kind: 'pattern', text: '不会过期的候选', scope: 'global_user' })
    const expired = service.expireCandidates()
    assert.ok(expired >= 1)
    assert.equal(service.listCandidates({ scope: 'global_user' }).includes('将会过期的候选'), false)
    assert.match(service.listCandidates({ scope: 'global_user' }), /不会过期的候选/u)
    const check = openShard(join(root, 'memory-live', 'private', 'user.sqlite3'), { encrypted: false })
    const row = check.db.prepare('SELECT outcome FROM candidate_idempotency WHERE idempotency_key = ?').get('test|s|1|v|0')
    assert.equal(row?.outcome, 'expired')
    check.db.close()
  } finally {
    service.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('pause toggles the auto-candidate/recall gate state', () => {
  const { root, service } = fixture()
  try {
    assert.equal(service.isPaused(), false)
    assert.equal(service.setPaused(true), true)
    assert.equal(service.isPaused(), true)
    assert.equal(service.setPaused(false), false)
    assert.equal(service.isPaused(), false)
  } finally {
    service.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('summary includes the candidate digest block', () => {
  const { root, service } = fixture()
  try {
    service.record({ kind: 'pattern', text: '摘要候选条目', scope: 'global_user' })
    const summary = service.summary({ scope: 'global_user' })
    assert.match(summary, /候选队列: 待处理 1 条/u)
    assert.match(summary, /摘要候选条目/u)
  } finally {
    service.close()
    rmSync(root, { recursive: true, force: true })
  }
})
