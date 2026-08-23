import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { openEngine } from '../src/core/engine.ts'
import { MemoryService } from '../src/core/service.ts'
import {
  dpapiProtect,
  dpapiUnprotect,
  generatePassphrase,
  isPlaintextDatabase,
  masterKeyFilePath,
  legacyKeyFilePath,
  loadOrCreateMasterKey,
  normalizePassphrase,
  unwrapRecovery,
  wrapRecovery,
  DATA_KEY_BYTES,
} from '../src/core/keys.ts'
import { BIP39_ENGLISH } from '../src/core/wordlist.ts'

const here = dirname(fileURLToPath(import.meta.url))

test('wordlist is the canonical 2048-word BIP-39 English list', () => {
  assert.equal(BIP39_ENGLISH.length, 2048)
  assert.equal(new Set(BIP39_ENGLISH).size, 2048)
  for (const word of BIP39_ENGLISH) assert.match(word, /^[a-z]{3,8}$/u)
  assert.equal(BIP39_ENGLISH[0], 'abandon')
  assert.equal(BIP39_ENGLISH[2047], 'zoo')
})

test('DPAPI protect/unprotect roundtrip in this Windows account', () => {
  const secret = Buffer.from('dsh-memory-dpapi-roundtrip-'.padEnd(DATA_KEY_BYTES, 'x'))
  const blob = dpapiProtect(secret)
  assert.ok(blob.length > 0)
  assert.deepEqual(dpapiUnprotect(blob), secret)
  assert.throws(() => dpapiUnprotect(blob.slice(0, -8) + 'AAAAAA=='), /DPAPI/u)
})

test('recovery passphrase wraps and unwraps the data key', () => {
  const key = Buffer.from('k'.repeat(DATA_KEY_BYTES))
  const passphrase = generatePassphrase()
  assert.equal(normalizePassphrase('  ' + passphrase.toUpperCase() + '  '), passphrase)
  const wrapped = wrapRecovery(key, passphrase)
  assert.equal(wrapped.words, 12)
  assert.deepEqual(unwrapRecovery(wrapped, passphrase), key)
  assert.throws(() => unwrapRecovery(wrapped, generatePassphrase()), /恢复口令不正确/u)
  const tampered = { ...wrapped, ciphertext: wrapped.ciphertext.slice(0, -4) + 'AAAA' }
  assert.throws(() => unwrapRecovery(tampered, passphrase), /损坏|口令/u)
})

test('master key file: create once, resolve again, one-time passphrase file at the root', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-memory-keys-'))
  const dbRoot = join(root, 'memory-live')
  const dbPath = join(dbRoot, 'private', 'user.sqlite3')
  try {
    const first = loadOrCreateMasterKey(dbRoot, dbPath)
    assert.equal(first.length, DATA_KEY_BYTES)
    assert.ok(existsSync(masterKeyFilePath(dbRoot)))
    assert.ok(existsSync(join(dbRoot, 'recovery-passphrase.txt')))
    assert.equal(existsSync(join(dbRoot, 'private', 'recovery-passphrase.txt')), false)
    const second = loadOrCreateMasterKey(dbRoot, dbPath)
    assert.deepEqual(second, first)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('v1 hex key file is adopted as the master key and removed', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-memory-keys-'))
  const dbRoot = join(root, 'memory-live')
  const dbPath = join(dbRoot, 'private', 'user.sqlite3')
  try {
    const legacy = 'a1'.repeat(DATA_KEY_BYTES)
    mkdirSync(dirname(dbPath), { recursive: true })
    writeFileSync(legacyKeyFilePath(dbPath), legacy, 'utf8')
    const key = loadOrCreateMasterKey(dbRoot, dbPath)
    assert.equal(key.toString('hex'), legacy)
    assert.ok(existsSync(masterKeyFilePath(dbRoot)))
    assert.equal(existsSync(legacyKeyFilePath(dbPath)), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('existing plaintext database upgrades in place when encryption turns on', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-memory-keys-'))
  const dbRoot = join(root, 'memory-live')
  const plain = new MemoryService({ dbRoot, encrypted: false })
  plain.record({ kind: 'global_fact', text: '迁移验证 migration-marker-2c9e', scope: 'global_user', confirm: true })
  plain.close()
  const dbPath = join(dbRoot, 'private', 'user.sqlite3')
  try {
    assert.equal(isPlaintextDatabase(dbPath), true)
    const encrypted = new MemoryService({ dbRoot, encrypted: true })
    try {
      assert.match(encrypted.query({ q: 'migration-marker' }), /迁移验证/u)
    } finally {
      encrypted.close()
    }
    assert.equal(isPlaintextDatabase(dbPath), false)
    assert.ok(existsSync(dbPath + '.pre-encrypt.bak'))
    assert.ok(!readFileSync(dbPath).includes(Buffer.from('迁移验证')), 'upgraded file must be ciphertext')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('recovery CLI verifies a passphrase and rebuilds the DPAPI blob', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-memory-keys-'))
  const dbRoot = join(root, 'memory-live')
  const dbPath = join(dbRoot, 'private', 'user.sqlite3')
  try {
    loadOrCreateMasterKey(dbRoot, dbPath)
    const passText = readFileSync(join(dbRoot, 'recovery-passphrase.txt'), 'utf8')
    const passphrase = /恢复口令：([a-z ]+)/u.exec(passText)?.[1]?.trim()
    assert.ok(passphrase)
    const script = join(here, '..', 'scripts', 'memory-recover.mjs')
    const before = readFileSync(masterKeyFilePath(dbRoot), 'utf8')
    const verify = spawnSync(process.execPath, [script, dbRoot, '--verify', passphrase], { encoding: 'utf8' })
    assert.equal(verify.status, 0, verify.stderr)
    assert.match(verify.stdout, /校验通过/u)
    const wrong = spawnSync(process.execPath, [script, dbRoot, '--verify', 'wrong passphrase words'], { encoding: 'utf8' })
    assert.equal(wrong.status, 1)
    assert.match(wrong.stderr, /恢复口令不正确/u)
    const rebuild = spawnSync(process.execPath, [script, dbRoot, passphrase], { encoding: 'utf8' })
    assert.equal(rebuild.status, 0, rebuild.stderr)
    assert.match(rebuild.stdout, /恢复成功/u)
    const after = readFileSync(masterKeyFilePath(dbRoot), 'utf8')
    assert.notEqual(after, before)
    assert.deepEqual(dpapiUnprotect(JSON.parse(after).dpapi.blob), dpapiUnprotect(JSON.parse(before).dpapi.blob))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('recovery CLI rotates the passphrase without changing the data key', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-memory-keys-'))
  const dbRoot = join(root, 'memory-live')
  const dbPath = join(dbRoot, 'private', 'user.sqlite3')
  try {
    loadOrCreateMasterKey(dbRoot, dbPath)
    const passText = readFileSync(join(dbRoot, 'recovery-passphrase.txt'), 'utf8')
    const oldPassphrase = /恢复口令：([a-z ]+)/u.exec(passText)?.[1]?.trim()
    assert.ok(oldPassphrase)
    const script = join(here, '..', 'scripts', 'memory-recover.mjs')
    const before = JSON.parse(readFileSync(masterKeyFilePath(dbRoot), 'utf8'))
    const rotated = spawnSync(process.execPath, [script, dbRoot, '--rotate'], { encoding: 'utf8' })
    assert.equal(rotated.status, 0, rotated.stderr)
    const newPassphrase = /([a-z]+( [a-z]+){11})/u.exec(rotated.stdout)?.[1]?.trim()
    assert.ok(newPassphrase)
    const after = JSON.parse(readFileSync(masterKeyFilePath(dbRoot), 'utf8'))
    assert.notEqual(after.recovery.ciphertext, before.recovery.ciphertext)
    assert.deepEqual(unwrapRecovery(after.recovery, newPassphrase), dpapiUnprotect(before.dpapi.blob))
    assert.throws(() => unwrapRecovery(after.recovery, oldPassphrase), /恢复口令不正确/u)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
