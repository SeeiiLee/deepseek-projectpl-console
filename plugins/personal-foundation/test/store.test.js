import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { PersonalStore, connectionKind, credentialRefFor, defaultDocument, normalizeDocument } from '../src/store.ts'

test('normalizes the complete theme contract and inherits workspace gaps from global', () => {
  const document = normalizeDocument({
    theme: {
      global: { fontFamily: 'Test Font', baseFontSize: 18, accentColor: '#abcdef' },
      workspaces: { 'D:/Project/': { backgroundColor: '#123456' } },
    },
  })
  assert.equal(document.theme.version, 1)
  assert.equal(document.theme.global.baseFontSize, 18)
  assert.equal(document.theme.workspaces['d:/project']?.fontFamily, 'Test Font')
  assert.equal(document.theme.workspaces['d:/project']?.backgroundColor, '#123456')
})

test('atomic store persists only references and sanitized connection display text', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-personal-store-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const filename = join(root, 'personal', 'personal-suite.json')
  const store = new PersonalStore(filename)
  const secretUrl = 'https://example.test/hook/private-token'
  await store.mutate(document => {
    document.connections.push({
      id: 'sample', label: 'Sample', kind: 'webhook', enabled: false,
      endpointDisplay: 'Webhook 目标已保存（不回显）',
      endpointRef: credentialRefFor('sample', 'ENDPOINT'),
      secretRef: credentialRefFor('sample', 'SECRET'),
      createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
    })
  })
  const raw = await readFile(filename, 'utf8')
  assert.doesNotMatch(raw, /private-token/u)
  assert.ok(!raw.includes(secretUrl))
  assert.match(raw, /DSH_PERSONAL_CONNECTION_SAMPLE_ENDPOINT/u)
})

test('default document returns independent mutable copies', () => {
  const first = defaultDocument()
  const second = defaultDocument()
  first.theme.global.fontFamily = 'Changed'
  assert.notEqual(first.theme.global.fontFamily, second.theme.global.fontFamily)
})

test('connection kind whitelist covers memory-extraction and personal-wechat', () => {
  assert.equal(connectionKind('memory-extraction'), 'memory-extraction')
  assert.equal(connectionKind('personal-wechat'), 'personal-wechat')
  assert.equal(connectionKind('model'), 'model')
  assert.equal(connectionKind('unknown-kind'), undefined)
})
