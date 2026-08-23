import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, test } from 'node:test'
import {
  ensurePersonalPluginLinks,
  PERSONAL_PLUGINS,
  PERSONAL_PLUGIN_PACKAGES,
  resolveHarnessHome,
} from '../src/personal-plugins.js'

const owned = []
afterEach(() => {
  for (const path of owned.splice(0)) rmSync(path, { recursive: true, force: true })
})

test('resolveHarnessHome honors an explicit isolated DSH_HOME', () => {
  assert.equal(resolveHarnessHome({ DSH_HOME: 'relative-test-home' }), resolve('relative-test-home'))
})

test('desktop overlay replaces only the official layout root with Personal Shell', () => {
  const patch = readFileSync(new URL('../plugins/cordis.patch.yml', import.meta.url), 'utf8')
  assert.match(patch, /- id: ui-layout\r?\n\s+name: '@deepseek-ai\/dsh-client-ui-layout'\r?\n\s+disabled: true/u)
  assert.match(patch, /- id: cyrus-personal-shell\r?\n\s+name: '@cyrus\/dsh-personal-shell'/u)
  assert.match(patch, /- id: cyrus-project-control\r?\n\s+name: '@cyrus\/dsh-project-control'/u)
  assert.match(patch, /- id: cyrus-workbench\r?\n\s+name: '@cyrus\/dsh-workbench'/u)
  assert.equal(PERSONAL_PLUGIN_PACKAGES.includes('@cyrus/dsh-personal-shell'), true)
  assert.equal(PERSONAL_PLUGIN_PACKAGES.includes('@cyrus/dsh-project-control'), true)
  assert.equal(PERSONAL_PLUGIN_PACKAGES.includes('@cyrus/dsh-workbench'), true)
})

test('ensurePersonalPluginLinks creates and refreshes only package junctions', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-personal-links-'))
  owned.push(root)
  const pluginRoot = join(root, 'plugins')
  const dshHome = join(root, 'home')
  for (const { packageName, directoryName } of PERSONAL_PLUGINS) {
    const dir = join(pluginRoot, directoryName)
    mkdirSync(join(dir, 'lib'), { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: packageName }))
    writeFileSync(join(dir, 'lib', 'index.js'), '')
    writeFileSync(join(dir, 'lib', 'client.js'), '')
  }

  const first = ensurePersonalPluginLinks({ dshHome, pluginRoot })
  const second = ensurePersonalPluginLinks({ dshHome, pluginRoot })
  assert.equal(first.length, PERSONAL_PLUGIN_PACKAGES.length)
  assert.deepEqual(second, first)
  for (const row of first) assert.equal(resolve(join(row.link, '..'), readlinkSync(row.link)), resolve(row.target))
})

test('ensurePersonalPluginLinks refuses an unbuilt package', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-personal-links-bad-'))
  owned.push(root)
  const pluginRoot = join(root, 'plugins')
  const first = PERSONAL_PLUGINS[0]
  const dir = join(pluginRoot, first.directoryName)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: first.packageName }))
  assert.throws(
    () => ensurePersonalPluginLinks({ dshHome: join(root, 'home'), pluginRoot }),
    /not built/,
  )
})

test('source-only link setup can prepare a profile before the build step', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-personal-links-source-'))
  owned.push(root)
  const pluginRoot = join(root, 'plugins')
  for (const { packageName, directoryName } of PERSONAL_PLUGINS) {
    const dir = join(pluginRoot, directoryName)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: packageName }))
  }
  assert.equal(ensurePersonalPluginLinks({
    dshHome: join(root, 'home'), pluginRoot, requireBuilt: false,
  }).length, PERSONAL_PLUGIN_PACKAGES.length)
})
