import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, test } from 'node:test'

import {
  abortActivatingGeneration,
  assemblePersonalScopeView,
  commitActivatingGeneration,
  ensurePersonalPluginLinks,
  PERSONAL_PLUGINS,
  startPendingActivation,
} from '../src/personal-plugins.js'
import {
  loadCurrentGeneration,
  normalizeExternalState,
} from '../src/personal-plugin-validation.js'

const COMMIT = 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'
const owned = []
afterEach(() => {
  for (const path of owned.splice(0)) rmSync(path, { recursive: true, force: true })
})

function sha256(text) {
  return createHash('sha256').update(text).digest('hex')
}

function makeBuiltinPluginRoot(root) {
  const pluginRoot = join(root, 'plugins')
  for (const { packageName, directoryName } of PERSONAL_PLUGINS) {
    const dir = join(pluginRoot, directoryName)
    mkdirSync(join(dir, 'lib'), { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: packageName, version: '0.0.0' }))
    writeFileSync(join(dir, 'lib', 'index.js'), '')
    writeFileSync(join(dir, 'lib', 'client.js'), '')
  }
  return pluginRoot
}

function makeGeneration({ externalRoot, generationId, version = '9.9.9', valid = true }) {
  const generationDir = join(externalRoot, 'generations', generationId)
  const pkgDir = join(generationDir, 'packages', 'anysearch', version)
  mkdirSync(join(pkgDir, 'lib'), { recursive: true })
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: '@cyrus/dsh-anysearch', version }))
  writeFileSync(join(pkgDir, 'lib', 'index.js'), valid ? 'export const ok = true\n' : '')
  writeFileSync(join(pkgDir, 'lib', 'client.js'), '')
  const files = {
    'package.json': sha256(readFileSync(join(pkgDir, 'package.json'), 'utf8')),
    'lib/index.js': sha256(readFileSync(join(pkgDir, 'lib', 'index.js'), 'utf8')),
    'lib/client.js': sha256(readFileSync(join(pkgDir, 'lib', 'client.js'), 'utf8')),
  }
  writeFileSync(join(pkgDir, '.install.json'), JSON.stringify({
    schemaVersion: 1,
    packageName: '@cyrus/dsh-anysearch',
    version,
    sourceTag: 'plugins-v2026.08.21.1',
    tgzSha256: 'a'.repeat(64),
    minClient: '0.4.2',
    harnessCommit: COMMIT,
    pluginContractVersion: '2',
    seams: ['web.searchProvider'],
    files,
  }, null, 2))
  writeFileSync(join(generationDir, 'batch.json'), JSON.stringify({
    schemaVersion: 1,
    generationId,
    harness: { version: '0.1.1-rc.2', commit: COMMIT },
    packages: {
      '@cyrus/dsh-anysearch': { source: 'external', directoryName: 'anysearch', version },
      '@cyrus/dsh-trajectory-island': { source: 'builtin' },
    },
  }, null, 2))
  return { generationDir, pkgDir }
}

function makeExternalRoot(root, { currentId = null, pendingId = null } = {}) {
  const externalRoot = join(root, 'plugins-external')
  mkdirSync(externalRoot, { recursive: true })
  if (currentId !== null) {
    makeGeneration({ externalRoot, generationId: currentId, version: currentId === 'gen-1' ? '0.1.0-beta' : '9.9.9' })
    const currentDir = join(externalRoot, 'generations', currentId)
    mkdirSync(join(currentDir, 'scope', '@cyrus'), { recursive: true })
    for (const { packageName } of PERSONAL_PLUGINS) {
      mkdirSync(join(currentDir, 'scope', '@cyrus', packageName.split('/')[1]), { recursive: true })
    }
    writeFileSync(join(externalRoot, 'current.json'), JSON.stringify({ generationId: currentId, committedAt: '2026-08-21T00:00:00.000Z' }))
  }
  if (pendingId !== null) {
    makeGeneration({ externalRoot, generationId: pendingId, version: '9.9.9' })
    writeFileSync(join(externalRoot, 'pending.json'), JSON.stringify({ generationId: pendingId, candidateId: pendingId, createdAt: '2026-08-21T01:00:00.000Z' }))
  }
  return externalRoot
}

test('startPendingActivation records fallback and does not commit current before doctor', () => {
  const root = mkdtempSync(join(tmpdir(), 'a1-atomic-start-'))
  owned.push(root)
  const externalRoot = makeExternalRoot(root, { currentId: 'gen-1', pendingId: 'gen-2' })
  const pluginRoot = makeBuiltinPluginRoot(root)
  const dshHome = join(root, 'home')
  const result = startPendingActivation({ externalRoot, pluginRoot, dshHome })
  assert.equal(result.candidateId, 'gen-2')
  assert.equal(result.fallbackId, 'gen-1')
  assert.equal(JSON.parse(readFileSync(join(externalRoot, 'current.json'), 'utf8')).generationId, 'gen-1')
  const activating = JSON.parse(readFileSync(join(externalRoot, 'activating.json'), 'utf8'))
  assert.equal(activating.candidateId, 'gen-2')
  assert.equal(activating.fallbackId, 'gen-1')
  assert.equal(existsSync(join(externalRoot, 'pending.json')), true)
  const profileScope = join(dshHome, 'profiles', 'web', 'node_modules', '@cyrus')
  const target = resolve(join(externalRoot, 'generations', 'gen-2', 'scope', '@cyrus'))
  const linkTarget = resolve(readlinkSync(profileScope))
  assert.equal(linkTarget, target)
})

test('commitActivatingGeneration atomically commits current and preserves previous after doctor', () => {
  const root = mkdtempSync(join(tmpdir(), 'a1-atomic-commit-'))
  owned.push(root)
  const externalRoot = makeExternalRoot(root, { currentId: 'gen-1', pendingId: 'gen-2' })
  const pluginRoot = makeBuiltinPluginRoot(root)
  const dshHome = join(root, 'home')
  startPendingActivation({ externalRoot, pluginRoot, dshHome })
  const committed = commitActivatingGeneration({ externalRoot, pluginRoot, dshHome, fiberOk: true })
  assert.equal(committed, 'gen-2')
  assert.equal(JSON.parse(readFileSync(join(externalRoot, 'current.json'), 'utf8')).generationId, 'gen-2')
  assert.equal(JSON.parse(readFileSync(join(externalRoot, 'previous.json'), 'utf8')).generationId, 'gen-1')
  assert.equal(existsSync(join(externalRoot, 'activating.json')), false)
  assert.equal(existsSync(join(externalRoot, 'pending.json')), false)
})

test('commitActivatingGeneration aborts and restores fallback when fiber doctor fails', () => {
  const root = mkdtempSync(join(tmpdir(), 'a1-atomic-fiberfail-'))
  owned.push(root)
  const externalRoot = makeExternalRoot(root, { currentId: 'gen-1', pendingId: 'gen-2' })
  const pluginRoot = makeBuiltinPluginRoot(root)
  const dshHome = join(root, 'home')
  startPendingActivation({ externalRoot, pluginRoot, dshHome })
  const committed = commitActivatingGeneration({ externalRoot, pluginRoot, dshHome, fiberOk: false })
  assert.equal(committed, null)
  assert.equal(JSON.parse(readFileSync(join(externalRoot, 'current.json'), 'utf8')).generationId, 'gen-1')
  assert.equal(existsSync(join(externalRoot, 'activating.json')), false)
  assert.equal(existsSync(join(externalRoot, 'pending.json')), false)
  assert.equal(existsSync(join(externalRoot, 'quarantine', 'gen-2')), true)
  assert.equal(existsSync(join(externalRoot, 'quarantine', 'gen-2', 'failure.json')), true)
  const profileScope = join(dshHome, 'profiles', 'web', 'node_modules', '@cyrus')
  const target = resolve(join(externalRoot, 'generations', 'gen-1', 'scope', '@cyrus'))
  assert.equal(resolve(readlinkSync(profileScope)), target)
})

test('normalizeExternalState quarantines stale activating candidate and keeps current', () => {
  const root = mkdtempSync(join(tmpdir(), 'a1-atomic-residue-old-'))
  owned.push(root)
  const externalRoot = makeExternalRoot(root, { currentId: 'gen-1', pendingId: 'gen-2' })
  writeFileSync(join(externalRoot, 'activating.json'), JSON.stringify({ candidateId: 'gen-2', fallbackId: 'gen-1', startedAt: '2026-08-21T00:00:00.000Z' }))
  normalizeExternalState(externalRoot)
  assert.equal(existsSync(join(externalRoot, 'activating.json')), false)
  assert.equal(existsSync(join(externalRoot, 'pending.json')), false)
  assert.equal(existsSync(join(externalRoot, 'quarantine', 'gen-2')), true)
  assert.equal(JSON.parse(readFileSync(join(externalRoot, 'current.json'), 'utf8')).generationId, 'gen-1')
})

test('normalizeExternalState does not quarantine a candidate that was already committed', () => {
  const root = mkdtempSync(join(tmpdir(), 'a1-atomic-residue-new-'))
  owned.push(root)
  const externalRoot = makeExternalRoot(root, { currentId: 'gen-2', pendingId: 'gen-2' })
  writeFileSync(join(externalRoot, 'activating.json'), JSON.stringify({ candidateId: 'gen-2', fallbackId: 'gen-1', startedAt: '2026-08-21T00:00:00.000Z' }))
  normalizeExternalState(externalRoot)
  assert.equal(existsSync(join(externalRoot, 'activating.json')), false)
  assert.equal(existsSync(join(externalRoot, 'pending.json')), false)
  assert.equal(existsSync(join(externalRoot, 'quarantine', 'gen-2')), false)
  assert.equal(JSON.parse(readFileSync(join(externalRoot, 'current.json'), 'utf8')).generationId, 'gen-2')
})

test('ensurePersonalPluginLinks falls back to builtin when pending candidate is invalid', () => {
  const root = mkdtempSync(join(tmpdir(), 'a1-atomic-invalid-'))
  owned.push(root)
  const externalRoot = join(root, 'plugins-external')
  mkdirSync(externalRoot, { recursive: true })
  const generationDir = join(externalRoot, 'generations', 'bad')
  mkdirSync(join(generationDir, 'packages', 'anysearch', '9.9.9'), { recursive: true })
  writeFileSync(join(generationDir, 'batch.json'), JSON.stringify({
    schemaVersion: 1,
    generationId: 'bad',
    harness: { version: '0.1.1-rc.2', commit: COMMIT },
    packages: { '@cyrus/dsh-anysearch': { source: 'external', directoryName: 'anysearch', version: '9.9.9' } },
  }, null, 2))
  writeFileSync(join(externalRoot, 'pending.json'), JSON.stringify({ generationId: 'bad', candidateId: 'bad', createdAt: '2026-08-21T00:00:00.000Z' }))
  const pluginRoot = makeBuiltinPluginRoot(root)
  const dshHome = join(root, 'home')
  const links = ensurePersonalPluginLinks({
    dshHome,
    pluginRoot,
    env: { DSH_PERSONAL_PLUGINS_EXTERNAL: externalRoot, DSH_DESKTOP_FLAVOR: 'stable' },
  })
  const anysearch = links.find(link => link.packageName === '@cyrus/dsh-anysearch')
  assert.ok(anysearch.target.includes('plugins'))
  assert.ok(!anysearch.target.includes('generations'))
  assert.equal(existsSync(join(externalRoot, 'pending.json')), false)
  assert.equal(existsSync(join(externalRoot, 'quarantine', 'bad')), true)
})

test('abortActivatingGeneration writes a diagnostic receipt and restores fallback', () => {
  const root = mkdtempSync(join(tmpdir(), 'a1-atomic-abort-'))
  owned.push(root)
  const externalRoot = makeExternalRoot(root, { currentId: 'gen-1', pendingId: 'gen-2' })
  const pluginRoot = makeBuiltinPluginRoot(root)
  const dshHome = join(root, 'home')
  startPendingActivation({ externalRoot, pluginRoot, dshHome })
  abortActivatingGeneration({ externalRoot, pluginRoot, dshHome, reason: 'post-boot doctor failed' })
  assert.equal(existsSync(join(externalRoot, 'quarantine', 'gen-2', 'failure.json')), true)
  const receipt = JSON.parse(readFileSync(join(externalRoot, 'quarantine', 'gen-2', 'failure.json'), 'utf8'))
  assert.equal(receipt.candidateId, 'gen-2')
  assert.equal(receipt.fallbackId, 'gen-1')
  assert.equal(receipt.reason, 'post-boot doctor failed')
  assert.equal(JSON.parse(readFileSync(join(externalRoot, 'current.json'), 'utf8')).generationId, 'gen-1')
  assert.equal(existsSync(join(externalRoot, 'activating.json')), false)
  assert.equal(existsSync(join(externalRoot, 'pending.json')), false)
})
