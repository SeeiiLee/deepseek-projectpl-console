import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, test } from 'node:test'

import { commitActivatingGeneration, ensurePersonalPluginLinks, PERSONAL_PLUGINS, startPendingActivation } from '../src/personal-plugins.js'
import { UpdateService } from '../src/update-service.js'

const COMMIT = 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'
const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const pluginRoot = join(repoRoot, 'plugins')
const owned = []
afterEach(() => {
  for (const path of owned.splice(0)) rmSync(path, { recursive: true, force: true })
})

function sha256File(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function collectHashes(directory, output = {}, prefix = '') {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name)
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) collectHashes(absolute, output, rel)
    else if (entry.isFile()) output[rel] = sha256File(absolute)
  }
  return output
}

function makeExternalGeneration(externalRoot, generationId) {
  const source = join(pluginRoot, 'anysearch')
  const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
  const version = manifest.version
  const pkgDir = join(externalRoot, 'generations', generationId, 'packages', 'anysearch', version)
  mkdirSync(pkgDir, { recursive: true })
  cpSync(source, pkgDir, { recursive: true })
  const files = collectHashes(pkgDir)
  writeFileSync(join(pkgDir, '.install.json'), JSON.stringify({
    schemaVersion: 1,
    packageName: '@cyrus/dsh-anysearch',
    version,
    sourceTag: 'plugins-v2026.08.22.1',
    tgzSha256: 'a'.repeat(64),
    minClient: '0.4.2',
    harnessCommit: COMMIT,
    pluginContractVersion: '2',
    seams: ['web.searchProvider'],
    files,
  }, null, 2))
  const packages = {
    '@cyrus/dsh-anysearch': { source: 'external', directoryName: 'anysearch', version },
  }
  for (const { packageName } of PERSONAL_PLUGINS) {
    if (!packages[packageName]) packages[packageName] = { source: 'builtin' }
  }
  writeFileSync(join(externalRoot, 'generations', generationId, 'batch.json'), JSON.stringify({
    schemaVersion: 1,
    generationId,
    harness: { version: '0.1.1-rc.2', commit: COMMIT },
    packages,
  }, null, 2))
  writeFileSync(join(externalRoot, 'pending.json'), JSON.stringify({
    generationId,
    candidateId: generationId,
    createdAt: new Date().toISOString(),
  }, null, 2))
}

test('stable flavor + temp userData external generation activates and rolls back to builtin (integration)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'stable-ext-e2e-'))
  owned.push(root)
  const userData = join(root, 'userData')
  const dshHome = join(root, 'dshHome')
  const externalRoot = join(userData, 'plugins-external')
  mkdirSync(externalRoot, { recursive: true })
  const generationId = 'stable-e2e-gen'
  makeExternalGeneration(externalRoot, generationId)

  const env = {
    DSH_DESKTOP_FLAVOR: 'stable',
    DSH_PERSONAL_PLUGINS_EXTERNAL: externalRoot,
    DSH_HOME: dshHome,
  }
  const links = ensurePersonalPluginLinks({ dshHome, pluginRoot, env, userData })
  const anysearch = links.find(link => link.packageName === '@cyrus/dsh-anysearch')
  assert.ok(anysearch.target.includes('generations'))
  assert.equal(existsSync(join(externalRoot, 'activating.json')), true)
  assert.equal(existsSync(join(externalRoot, 'current.json')), false)

  const committed = commitActivatingGeneration({ externalRoot, pluginRoot, dshHome, fiberOk: true })
  assert.equal(committed, generationId)
  const currentLinks = ensurePersonalPluginLinks({ dshHome, pluginRoot, env, userData })
  assert.ok(currentLinks.find(link => link.packageName === '@cyrus/dsh-anysearch').target.includes('generations'))

  const service = new UpdateService({
    app: { getVersion: () => '0.4.2', isPackaged: false },
    shell: {},
    userDataPath: userData,
    projectRoot: repoRoot,
    getCurrentSourceRoot: () => repoRoot,
    preflightHarness: async () => {},
    onInstallDesktop: async () => {},
    onRelaunch: async () => {},
  })
  try {
    await service.ensureLoaded()
    await service.rollbackPluginGeneration()
  } finally {
    await service.dispose().catch(() => {})
  }
  const rolledBackLinks = ensurePersonalPluginLinks({ dshHome, pluginRoot, env, userData })
  const rolledBackAnysearch = rolledBackLinks.find(link => link.packageName === '@cyrus/dsh-anysearch')
  assert.ok(rolledBackAnysearch.target.includes('plugins'))
  assert.ok(!rolledBackAnysearch.target.includes('generations'))
})
