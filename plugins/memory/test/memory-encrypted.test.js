import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { openEngine } from '../src/core/engine.ts'
import { MemoryService } from '../src/core/service.ts'

test('encrypted service: ciphertext-at-rest, v2 DPAPI key file + recovery passphrase, reopen via same key', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-memory-enc-'))
  const dbRoot = join(root, 'memory-live')
  const service = new MemoryService({ dbRoot, encrypted: true })
  try {
    service.record({ kind: 'global_fact', text: '加密记忆 encrypted-marker-7f3a 密文验证', scope: 'global_user', confirm: true })
    const q1 = service.query({ q: 'encrypted-marker' })
    assert.match(q1, /密文验证/u)
    service.close()
    const dbPath = join(dbRoot, 'private', 'user.sqlite3')
    const dbBytes = readFileSync(dbPath)
    assert.ok(!dbBytes.includes(Buffer.from('密文验证')), 'ciphertext must not contain plaintext claim')
    const keyPath = join(dbRoot, 'memory.key.json')
    assert.ok(existsSync(keyPath), 'v2 key file exists')
    const keyFile = JSON.parse(readFileSync(keyPath, 'utf8'))
    assert.equal(keyFile.version, 2)
    assert.equal(keyFile.dpapi.scope, 'current-user')
    assert.ok(typeof keyFile.dpapi.blob === 'string' && keyFile.dpapi.blob.length > 0)
    assert.equal(keyFile.recovery.kdf, 'scrypt')
    assert.equal(keyFile.recovery.words, 12)
    const passPath = join(dbRoot, 'recovery-passphrase.txt')
    assert.ok(existsSync(passPath), 'one-time passphrase file exists')
    assert.match(readFileSync(passPath, 'utf8'), /恢复口令：[a-z]+( [a-z]+){11}/u)
    const reopened = new MemoryService({ dbRoot, encrypted: true })
    try {
      const q2 = reopened.query({ q: 'encrypted-marker' })
      assert.match(q2, /密文验证/u)
    } finally {
      reopened.close()
    }
    // opening without the key engine fails closed
    assert.throws(() => {
      const engine = openEngine(dbPath, {})
      try { engine.prepare('SELECT * FROM claims').all() } finally { engine.close() }
    }, /not a database|SQLITE_NOTADB/u)
  } finally {
    service.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('wrong key refuses to open the cipher database', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-memory-enc-'))
  const service = new MemoryService({ dbRoot: join(root, 'memory-live'), encrypted: true })
  try {
    service.record({ kind: 'global_fact', text: 'wrong-key-marker', scope: 'global_user', confirm: true })
    service.close()
    const dbPath = join(root, 'memory-live', 'private', 'user.sqlite3')
    assert.throws(() => {
      const engine = openEngine(dbPath, { encrypted: true, key: Buffer.alloc(32, 7) })
      try { engine.prepare('SELECT * FROM claims').all() } finally { engine.close() }
    }, /not a database|SQLITE_NOTADB/u)
  } finally {
    service.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('encrypted backup snapshot stays encrypted', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-memory-enc-'))
  const service = new MemoryService({ dbRoot: join(root, 'memory-live'), encrypted: true })
  try {
    service.record({ kind: 'global_fact', text: 'backup-enc-marker 快照加密', scope: 'global_user', confirm: true })
    const report = service.backup('pre-change')
    assert.match(report, /快照完成/u)
    const dir = /快照完成（\d+ 个文件）：([^\n]+)/u.exec(report)?.[1]?.trim()
    assert.ok(dir)
    const snap = join(dir, 'private__user.sqlite3')
    assert.ok(existsSync(snap))
    assert.ok(!readFileSync(snap).includes(Buffer.from('快照加密')), 'snapshot must stay encrypted')
  } finally {
    service.close()
    rmSync(root, { recursive: true, force: true })
  }
})
