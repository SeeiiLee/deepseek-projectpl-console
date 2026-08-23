import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, test } from 'node:test'

import { assemblePersonalScopeView, commitActivatingGeneration, ensurePersonalPluginLinks, PERSONAL_PLUGINS, promotePendingGeneration } from '../src/personal-plugins.js'
import {
  getPluginStatus,
  loadCurrentGeneration,
  normalizeExternalState,
  resolveExternalRoot,
  validateGeneration,
  verifyGenerationDoctor,
} from '../src/personal-plugin-validation.js'

const COMMIT = 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'
const owned = []
afterEach(() => {
  for (const path of owned.splice(0)) rmSync(path, { recursive: true, force: true })
})

function sha256(text) {
  return createHash('sha256').update(text).digest('hex')
}

function makeExternalRoot(root, { corruptHash = false, extraPlugin = false } = {}) {
  const externalRoot = join(root, 'plugins-external')
  const generationId = 'gen-1'
  const generationDir = join(externalRoot, 'generations', generationId)
  const pkgDir = join(generationDir, 'packages', 'anysearch', '0.1.0-beta')
  mkdirSync(join(pkgDir, 'lib'), { recursive: true })
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: '@cyrus/dsh-anysearch', version: '0.1.0-beta' }))
  writeFileSync(join(pkgDir, 'lib', 'index.js'), 'export const ok = true\n')
  writeFileSync(join(pkgDir, 'lib', 'client.js'), 'id: "@cyrus/dsh-anysearch"\n')
  const files = {
    'package.json': sha256(readFileSync(join(pkgDir, 'package.json'), 'utf8')),
    'lib/index.js': sha256(readFileSync(join(pkgDir, 'lib', 'index.js'), 'utf8')),
    'lib/client.js': sha256(readFileSync(join(pkgDir, 'lib', 'client.js'), 'utf8')),
  }
  if (corruptHash) files['lib/index.js'] = '0'.repeat(64)
  writeFileSync(join(pkgDir, '.install.json'), JSON.stringify({
    schemaVersion: 1,
    packageName: '@cyrus/dsh-anysearch',
    version: '0.1.0-beta',
    sourceTag: 'plugins-2026.08.21.1',
    tgzSha256: 'a'.repeat(64),
    minClient: '0.4.2',
    harnessCommit: COMMIT,
    pluginContractVersion: '2',
    seams: ['web.searchProvider'],
    files,
  }, null, 2))
  const packages = {
    '@cyrus/dsh-anysearch': { source: 'external', directoryName: 'anysearch', version: '0.1.0-beta' },
    '@cyrus/dsh-trajectory-island': { source: 'builtin' },
  }
  if (extraPlugin) {
    packages['@cyrus/dsh-memory'] = { source: 'external', directoryName: 'memory', version: '0.1.0' }
  }
  writeFileSync(join(generationDir, 'batch.json'), JSON.stringify({
    schemaVersion: 1,
    generationId,
    harness: { version: '0.1.1-rc.2', commit: COMMIT },
    packages,
  }, null, 2))
  // scope 组合视图：18 包都应有组合条目（外部实体或内置基线），本测试为全部建目录。
  mkdirSync(join(generationDir, 'scope', '@cyrus'), { recursive: true })
  for (const { packageName } of PERSONAL_PLUGINS) {
    mkdirSync(join(generationDir, 'scope', '@cyrus', packageName.split('/')[1]), { recursive: true })
  }
  writeFileSync(join(externalRoot, 'current.json'), JSON.stringify({ generationId, committedAt: new Date().toISOString() }))
  return externalRoot
}

test('resolveExternalRoot honors env override', () => {
  assert.equal(resolveExternalRoot({ env: { DSH_PERSONAL_PLUGINS_EXTERNAL: 'C:\\ext' } }), resolve('C:\\ext'))
  assert.equal(resolveExternalRoot({ env: {}, userData: 'C:\\ud' }), resolve('C:\\ud\\plugins-external'))
})

test('normalizeExternalState removes activating.json residue', () => {
  const root = mkdtempSync(join(tmpdir(), 'a1-ext-'))
  owned.push(root)
  const externalRoot = join(root, 'ext')
  mkdirSync(externalRoot, { recursive: true })
  writeFileSync(join(externalRoot, 'activating.json'), JSON.stringify({ candidateId: 'x' }))
  normalizeExternalState(externalRoot)
  assert.equal(existsSync(join(externalRoot, 'activating.json')), false)
})

test('loadCurrentGeneration returns valid generation and rejects corrupt hash', () => {
  const root = mkdtempSync(join(tmpdir(), 'a1-ext-'))
  owned.push(root)
  const externalRoot = makeExternalRoot(root)
  const gen = loadCurrentGeneration(externalRoot)
  assert.equal(gen?.generationId, 'gen-1')
  assert.equal(validateGeneration(gen.generationDir).ok, true)

  const badRoot = mkdtempSync(join(tmpdir(), 'a1-ext-bad-'))
  owned.push(badRoot)
  const badExternal = makeExternalRoot(badRoot, { corruptHash: true })
  assert.equal(loadCurrentGeneration(badExternal), null)
})

test('getPluginStatus exposes source/generationId/installedAt', () => {
  const root = mkdtempSync(join(tmpdir(), 'a1-status-'))
  owned.push(root)
  const externalRoot = makeExternalRoot(root)
  const status = getPluginStatus(externalRoot, { packageNames: ['@cyrus/dsh-anysearch', '@cyrus/dsh-trajectory-island'] })
  const anysearch = status.find(item => item.packageName === '@cyrus/dsh-anysearch')
  assert.equal(anysearch.source, 'external')
  assert.equal(anysearch.generationId, 'gen-1')
  assert.equal(anysearch.version, '0.1.0-beta')
  assert.equal(anysearch.installedAt !== null, true)
  const trajectory = status.find(item => item.packageName === '@cyrus/dsh-trajectory-island')
  assert.equal(trajectory.source, 'builtin')
})

test('external generation rejects not-whitelisted external plugin', () => {
  const root = mkdtempSync(join(tmpdir(), 'a1-ext-extra-'))
  owned.push(root)
  const externalRoot = makeExternalRoot(root, { extraPlugin: true })
  const result = validateGeneration(join(externalRoot, 'generations', 'gen-1'))
  assert.equal(result.ok, false)
  assert.ok(result.issues.some(issue => issue.includes('未允许的外部插件')))
})

test('assemblePersonalScopeView builds all package junctions from batch', () => {
  const root = mkdtempSync(join(tmpdir(), 'a1-assemble-'))
  owned.push(root)
  const externalRoot = join(root, 'plugins-external')
  const generationId = 'gen-assemble'
  const generationDir = join(externalRoot, 'generations', generationId)
  const pkgDir = join(generationDir, 'packages', 'anysearch', '0.1.0-beta')
  mkdirSync(join(pkgDir, 'lib'), { recursive: true })
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: '@cyrus/dsh-anysearch', version: '0.1.0-beta' }))
  writeFileSync(join(pkgDir, 'lib', 'index.js'), '')
  writeFileSync(join(pkgDir, 'lib', 'client.js'), '')
  const pluginRoot = join(root, 'plugins')
  for (const { packageName, directoryName } of PERSONAL_PLUGINS) {
    if (packageName === '@cyrus/dsh-anysearch') continue
    const dir = join(pluginRoot, directoryName)
    mkdirSync(join(dir, 'lib'), { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: packageName }))
    writeFileSync(join(dir, 'lib', 'index.js'), '')
    writeFileSync(join(dir, 'lib', 'client.js'), '')
  }
  const batch = {
    schemaVersion: 1,
    generationId,
    harness: { version: '0.1.1-rc.2', commit: COMMIT },
    packages: {
      '@cyrus/dsh-anysearch': { source: 'external', directoryName: 'anysearch', version: '0.1.0-beta' },
    },
  }
  const links = assemblePersonalScopeView({ generationDir, batch, pluginRoot })
  assert.equal(links.length, PERSONAL_PLUGINS.length)
  assert.ok(links.find(link => link.packageName === '@cyrus/dsh-anysearch').target.includes('packages'))
  assert.ok(links.find(link => link.packageName === '@cyrus/dsh-personal-shell').target.includes(pluginRoot))
})

test('promotePendingGeneration starts an activation and commitActivatingGeneration commits it', () => {
  const root = mkdtempSync(join(tmpdir(), 'a1-promote-'))
  owned.push(root)
  const externalRoot = join(root, 'plugins-external')
  const generationId = 'pending-gen'
  const generationDir = join(externalRoot, 'generations', generationId)
  const pkgDir = join(generationDir, 'packages', 'anysearch', '9.9.9')
  mkdirSync(join(pkgDir, 'lib'), { recursive: true })
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: '@cyrus/dsh-anysearch', version: '9.9.9' }))
  writeFileSync(join(pkgDir, 'lib', 'index.js'), '')
  writeFileSync(join(pkgDir, 'lib', 'client.js'), '')
  const files = {
    'package.json': sha256(readFileSync(join(pkgDir, 'package.json'), 'utf8')),
    'lib/index.js': sha256(readFileSync(join(pkgDir, 'lib', 'index.js'), 'utf8')),
    'lib/client.js': sha256(readFileSync(join(pkgDir, 'lib', 'client.js'), 'utf8')),
  }
  writeFileSync(join(pkgDir, '.install.json'), JSON.stringify({
    schemaVersion: 1,
    packageName: '@cyrus/dsh-anysearch',
    version: '9.9.9',
    sourceTag: 'plugins-v2026.08.21.1',
    tgzSha256: 'a'.repeat(64),
    minClient: '0.4.2',
    harnessCommit: COMMIT,
    pluginContractVersion: '2',
    seams: ['web.searchProvider'],
    files,
  }, null, 2))
  const pluginRoot = join(root, 'plugins')
  for (const { packageName, directoryName } of PERSONAL_PLUGINS) {
    if (packageName === '@cyrus/dsh-anysearch') continue
    const dir = join(pluginRoot, directoryName)
    mkdirSync(join(dir, 'lib'), { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: packageName }))
    writeFileSync(join(dir, 'lib', 'index.js'), '')
    writeFileSync(join(dir, 'lib', 'client.js'), '')
  }
  writeFileSync(join(generationDir, 'batch.json'), JSON.stringify({
    schemaVersion: 1,
    generationId,
    harness: { version: '0.1.1-rc.2', commit: COMMIT },
    packages: {
      '@cyrus/dsh-anysearch': { source: 'external', directoryName: 'anysearch', version: '9.9.9' },
    },
  }, null, 2))
  writeFileSync(join(externalRoot, 'pending.json'), JSON.stringify({ generationId, candidateId: generationId, createdAt: new Date().toISOString() }))
  const promoted = promotePendingGeneration({ externalRoot, pluginRoot, dshHome: join(root, 'home') })
  assert.equal(promoted, generationId)
  assert.equal(existsSync(join(externalRoot, 'pending.json')), true)
  assert.equal(existsSync(join(externalRoot, 'current.json')), false)
  assert.equal(existsSync(join(generationDir, 'scope', '@cyrus', 'dsh-anysearch')), true)
  const committed = commitActivatingGeneration({ externalRoot, pluginRoot, dshHome: join(root, 'home'), fiberOk: true })
  assert.equal(committed, generationId)
  assert.equal(existsSync(join(externalRoot, 'pending.json')), false)
  assert.equal(JSON.parse(readFileSync(join(externalRoot, 'current.json'), 'utf8')).generationId, generationId)
})

test('verifyGenerationDoctor rejects non-junction scope entries', () => {
  const root = mkdtempSync(join(tmpdir(), 'a1-doctor-bad-'))
  owned.push(root)
  const generationDir = join(root, 'gen')
  const pkgDir = join(generationDir, 'packages', 'anysearch', '9.9.9')
  mkdirSync(join(pkgDir, 'lib'), { recursive: true })
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: '@cyrus/dsh-anysearch', version: '9.9.9' }))
  mkdirSync(join(generationDir, 'scope', '@cyrus', 'dsh-anysearch'), { recursive: true })
  const batch = {
    packages: {
      '@cyrus/dsh-anysearch': { source: 'external', directoryName: 'anysearch', version: '9.9.9' },
    },
  }
  const result = verifyGenerationDoctor({ generationDir, batch })
  assert.equal(result.ok, false)
  assert.ok(result.issues.some(issue => issue.includes('不是 junction')))
})

test('loadCurrentGeneration returns null when current points to a missing generation', () => {
  const root = mkdtempSync(join(tmpdir(), 'a1-missing-current-'))
  owned.push(root)
  const externalRoot = join(root, 'plugins-external')
  mkdirSync(externalRoot, { recursive: true })
  writeFileSync(join(externalRoot, 'current.json'), JSON.stringify({ generationId: 'missing-gen' }))
  assert.equal(loadCurrentGeneration(externalRoot), null)
})

test('promotePendingGeneration quarantines a missing pending generation and clears the journal', () => {
  const root = mkdtempSync(join(tmpdir(), 'a1-missing-pending-'))
  owned.push(root)
  const externalRoot = join(root, 'plugins-external')
  mkdirSync(externalRoot, { recursive: true })
  writeFileSync(join(externalRoot, 'pending.json'), JSON.stringify({ generationId: 'missing-gen' }))
  const pluginRoot = join(root, 'plugins')
  assert.throws(() => promotePendingGeneration({ externalRoot, pluginRoot }), /batch\.json|generation/u)
  assert.equal(existsSync(join(externalRoot, 'pending.json')), false)
  assert.equal(existsSync(join(externalRoot, 'quarantine', 'missing-gen')), true)
})

test('ensurePersonalPluginLinks falls back to builtin when current generation scope is broken', () => {
  const root = mkdtempSync(join(tmpdir(), 'a1-broken-scope-'))
  owned.push(root)
  const externalRoot = makeExternalRoot(root)
  rmSync(join(externalRoot, 'generations', 'gen-1', 'scope', '@cyrus', 'dsh-anysearch'), { recursive: true, force: true })
  const dshHome = join(root, 'home')
  const pluginRoot = join(root, 'plugins')
  for (const { packageName, directoryName } of PERSONAL_PLUGINS) {
    const dir = join(pluginRoot, directoryName)
    mkdirSync(join(dir, 'lib'), { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: packageName }))
    writeFileSync(join(dir, 'lib', 'index.js'), '')
    writeFileSync(join(dir, 'lib', 'client.js'), '')
  }
  const links = ensurePersonalPluginLinks({
    dshHome,
    pluginRoot,
    env: { DSH_PERSONAL_PLUGINS_EXTERNAL: externalRoot, DSH_DESKTOP_FLAVOR: 'stable' },
  })
  const anysearch = links.find(link => link.packageName === '@cyrus/dsh-anysearch')
  assert.ok(anysearch.target.includes('plugins'))
  assert.ok(!anysearch.target.includes('generations'))
})

test('ensurePersonalPluginLinks normalizes activating residue to current generation', () => {
  const root = mkdtempSync(join(tmpdir(), 'a1-crash-'))
  owned.push(root)
  const externalRoot = makeExternalRoot(root)
  writeFileSync(join(externalRoot, 'activating.json'), JSON.stringify({ candidateId: 'stale', fallbackId: null, startedAt: '2026-08-21T00:00:00.000Z' }))
  const dshHome = join(root, 'home')
  const pluginRoot = join(root, 'plugins')
  for (const { packageName, directoryName } of PERSONAL_PLUGINS) {
    const dir = join(pluginRoot, directoryName)
    mkdirSync(join(dir, 'lib'), { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: packageName }))
    writeFileSync(join(dir, 'lib', 'index.js'), '')
    writeFileSync(join(dir, 'lib', 'client.js'), '')
  }
  const links = ensurePersonalPluginLinks({
    dshHome,
    pluginRoot,
    env: { DSH_PERSONAL_PLUGINS_EXTERNAL: externalRoot, DSH_DESKTOP_FLAVOR: 'stable' },
  })
  assert.equal(existsSync(join(externalRoot, 'activating.json')), false)
  const anysearch = links.find(link => link.packageName === '@cyrus/dsh-anysearch')
  assert.ok(anysearch.target.includes('generations'))
})

test('ensurePersonalPluginLinks uses external scope only for stable flavor', () => {
  const root = mkdtempSync(join(tmpdir(), 'a1-links-'))
  owned.push(root)
  const externalRoot = makeExternalRoot(root)
  const stableHome = join(root, 'home-stable')
  const devHome = join(root, 'home-dev')
  const pluginRoot = join(root, 'plugins')
  // 内置目录也要存在，因为 dev fallback 会校验它们。
  for (const { packageName, directoryName } of PERSONAL_PLUGINS) {
    const dir = join(pluginRoot, directoryName)
    mkdirSync(join(dir, 'lib'), { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: packageName }))
    writeFileSync(join(dir, 'lib', 'index.js'), '')
    writeFileSync(join(dir, 'lib', 'client.js'), '')
  }

  const stableLinks = ensurePersonalPluginLinks({
    dshHome: stableHome,
    pluginRoot,
    env: { DSH_PERSONAL_PLUGINS_EXTERNAL: externalRoot, DSH_DESKTOP_FLAVOR: 'stable' },
  })
  const anysearch = stableLinks.find(link => link.packageName === '@cyrus/dsh-anysearch')
  assert.ok(anysearch.target.includes('generations'))
  assert.ok(anysearch.target.includes('scope'))
  assert.equal(existsSync(anysearch.link), true)

  const devLinks = ensurePersonalPluginLinks({
    dshHome: devHome,
    pluginRoot,
    env: { DSH_PERSONAL_PLUGINS_EXTERNAL: externalRoot, DSH_DESKTOP_FLAVOR: 'dev' },
  })
  const devAnysearch = devLinks.find(link => link.packageName === '@cyrus/dsh-anysearch')
  assert.ok(devAnysearch.target.includes('plugins'))
  assert.ok(!devAnysearch.target.includes('generations'))
})
