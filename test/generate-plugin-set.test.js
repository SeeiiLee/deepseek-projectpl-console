import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

import { buildInstallOrder, collectPlugins, computeLock, locksEquivalent } from '../scripts/generate-plugin-set.mjs'

function makePlugin(root, name, extra = {}) {
  const dir = join(root, name.replace('@cyrus/', ''))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name,
    version: '0.1.0-rc.7',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
    ...extra.manifest,
  }))
  return { name, version: '0.1.0-rc.7', dir, bundle: true, role: extra.role, requires: extra.requires ?? [], bridges: extra.bridges ?? [], conflicts: extra.conflicts ?? [], dataDir: extra.dataDir }
}

test('collectPlugins 读取 manifest 与 dshComposable', () => {
  const root = mkdtempSync(join(tmpdir(), 'plugin-set-'))
  makePlugin(root, '@cyrus/dsh-shell', { role: 'adapter' })
  makePlugin(root, '@cyrus/dsh-workbench', {
    role: 'core',
    requires: ['@cyrus/dsh-shell'],
    manifest: { dshComposable: { schemaVersion: 1, role: 'core', requires: { packages: ['@cyrus/dsh-shell'] } } },
  })
  const plugins = collectPlugins(root)
  assert.equal(plugins.length, 2)
  const wb = plugins.find(p => p.name === '@cyrus/dsh-workbench')
  assert.deepEqual(wb.requires, ['@cyrus/dsh-shell'])
  rmSync(root, { recursive: true, force: true })
})

test('buildInstallOrder 依赖先行 + 环报错', () => {
  const shell = { name: '@cyrus/dsh-shell', requires: [] }
  const wb = { name: '@cyrus/dsh-workbench', requires: ['@cyrus/dsh-shell'] }
  const bridge = { name: '@cyrus/dsh-bridge', requires: ['@cyrus/dsh-shell', '@cyrus/dsh-workbench'] }
  assert.deepEqual(buildInstallOrder([bridge, wb, shell]), ['@cyrus/dsh-shell', '@cyrus/dsh-workbench', '@cyrus/dsh-bridge'])
  const a = { name: '@cyrus/a', requires: ['@cyrus/b'] }
  const b = { name: '@cyrus/b', requires: ['@cyrus/a'] }
  assert.throws(() => buildInstallOrder([a, b]))
})

test('computeLock 产出符合 preset-lock schema', () => {
  const root = mkdtempSync(join(tmpdir(), 'plugin-set-'))
  const shell = makePlugin(root, '@cyrus/dsh-shell', { role: 'adapter' })
  const wb = makePlugin(root, '@cyrus/dsh-workbench', { role: 'core', requires: ['@cyrus/dsh-shell'] })
  shell.integrity = 'a'.repeat(64)
  wb.integrity = 'b'.repeat(64)
  const lock = computeLock({
    plugins: [wb, shell],
    harness: { version: '0.1.0-rc.7', commit: '99f6f02fecdb7dff40c3fbc9470f5907c29f74ca' },
    generatedAt: '2026-08-18T00:00:00.000Z',
  })
  const ajv = new Ajv2020({ allErrors: true, strict: true })
  addFormats(ajv)
  const schema = JSON.parse(readFileSync(new URL('../protocol/personal-plugin-contract/v1/schemas/preset-lock.schema.json', import.meta.url)))
  assert.equal(ajv.compile(schema)(lock), true)
  assert.deepEqual(lock.installOrder, ['@cyrus/dsh-shell', '@cyrus/dsh-workbench'])
  rmSync(root, { recursive: true, force: true })
})

test('locksEquivalent 比较 name/version/integrity/requires/order', () => {
  const base = {
    compatibleHarness: { version: '0.1.0-rc.7', commit: '99f6f02fecdb7dff40c3fbc9470f5907c29f74ca' },
    packages: { '@cyrus/dsh-shell': { version: '0.1.0-rc.7', integrity: 'a'.repeat(64), bundle: true, role: 'adapter' } },
    installOrder: ['@cyrus/dsh-shell'],
  }
  const same = JSON.parse(JSON.stringify(base))
  const diff = JSON.parse(JSON.stringify(base))
  diff.packages['@cyrus/dsh-shell'].integrity = 'b'.repeat(64)
  assert.equal(locksEquivalent(base, same), true)
  assert.equal(locksEquivalent(base, diff), false)
})
