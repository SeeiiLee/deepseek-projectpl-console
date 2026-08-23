import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'

import {
  DEV_E2E_DRIVER_SCHEMA_VERSION,
  isDevE2EDriverRequested,
  loadDevE2EConfig,
  runDevE2EDriver,
} from '../src/dev-e2e-driver.js'

const owned = []
afterEach(() => {
  for (const path of owned.splice(0)) rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
})

function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-dev-e2e-driver-'))
  owned.push(root)
  return root
}

function makeConfig(root, overrides = {}) {
  const config = {
    schemaVersion: DEV_E2E_DRIVER_SCHEMA_VERSION,
    runId: 'run-1',
    phase: 'verify',
    localUpdateBase: 'http://127.0.0.1:8765',
    evidenceDir: join(root, 'evidence'),
    journalPath: join(root, 'evidence', 'journal.json'),
    ...overrides,
  }
  const configPath = join(root, 'config.json')
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)
  return { config, configPath }
}

function makeUpdateService(root, calls = []) {
  return {
    userDataPath: root,
    document: {},
    async getState() {
      return { ok: true }
    },
    async checkDesktop() {
      calls.push('checkDesktop')
    },
    async downloadDesktop() {
      calls.push('downloadDesktop')
    },
    async installDesktop() {
      calls.push('installDesktop')
    },
    async rollbackDesktop() {
      calls.push('rollbackDesktop')
    },
  }
}

test('driver request requires immutable dev E2E build and explicit switch', () => {
  const env = { DSH_DESKTOP_E2E_DRIVER: '1' }
  assert.equal(isDevE2EDriverRequested({ buildFlavor: 'dev', e2eBuild: true, env }), true)
  assert.equal(isDevE2EDriverRequested({ buildFlavor: 'dev', e2eBuild: false, env }), false)
  assert.equal(isDevE2EDriverRequested({ buildFlavor: 'stable', e2eBuild: true, env }), false)
  assert.equal(isDevE2EDriverRequested({ buildFlavor: 'dev', e2eBuild: true, env: {} }), false)
})

test('valid orchestration config loads and invalid config fails closed', async () => {
  const root = makeRoot()
  const { configPath } = makeConfig(root)
  const config = await loadDevE2EConfig({ env: { DSH_DESKTOP_E2E_CONFIG: configPath }, userDataPath: root })
  assert.equal(config.runId, 'run-1')

  await assert.rejects(
    () => loadDevE2EConfig({ env: {}, userDataPath: root }),
    /missing or invalid/u,
  )
  const bad = join(root, 'bad.json')
  writeFileSync(bad, '{not-json')
  await assert.rejects(
    () => loadDevE2EConfig({ env: { DSH_DESKTOP_E2E_CONFIG: bad }, userDataPath: root }),
    /corrupt/u,
  )
  const badPhase = makeConfig(root, { phase: 'not-a-phase' })
  await assert.rejects(
    () => loadDevE2EConfig({ env: { DSH_DESKTOP_E2E_CONFIG: badPhase.configPath }, userDataPath: root }),
    /phase/u,
  )
  const badUrl = makeConfig(root, { localUpdateBase: 'http://127.0.0.2:8765' })
  await assert.rejects(
    () => loadDevE2EConfig({ env: { DSH_DESKTOP_E2E_CONFIG: badUrl.configPath }, userDataPath: root }),
    /localUpdateBase/u,
  )
})

test('driver refuses to write journal outside evidenceDir', async () => {
  const root = makeRoot()
  const outside = join(root, 'outside', 'journal.json')
  const { configPath } = makeConfig(root, { journalPath: outside })
  await assert.rejects(
    () => loadDevE2EConfig({ env: { DSH_DESKTOP_E2E_CONFIG: configPath }, userDataPath: root }),
    /inside evidenceDir/u,
  )
})

test('driver verify phase writes an atomic journal without calling update methods', async () => {
  const root = makeRoot()
  const calls = []
  const updateService = makeUpdateService(root, calls)
  const { configPath } = makeConfig(root)
  const result = await runDevE2EDriver(updateService, {
    buildFlavor: 'dev',
    e2eBuild: true,
    app: { getVersion: () => '0.4.1' },
    env: { DSH_DESKTOP_E2E_DRIVER: '1', DSH_DESKTOP_E2E_CONFIG: configPath },
  })
  assert.equal(result.ran, true)
  assert.equal(result.ok, true)
  assert.deepEqual(calls, [])
  const journal = JSON.parse(readFileSync(join(root, 'evidence', 'journal.json'), 'utf8'))
  assert.equal(journal.schemaVersion, DEV_E2E_DRIVER_SCHEMA_VERSION)
  assert.ok(journal.entries.some(entry => entry.stage === 'driver-start'))
  assert.ok(journal.entries.some(entry => entry.stage === 'after-confirmDesktopLifecycle'))
})

test('driver install phase calls the real public methods in order', async () => {
  const root = makeRoot()
  const calls = []
  const updateService = makeUpdateService(root, calls)
  const { configPath } = makeConfig(root, { phase: 'install' })
  const result = await runDevE2EDriver(updateService, {
    buildFlavor: 'dev',
    e2eBuild: true,
    app: { getVersion: () => '0.4.0' },
    env: { DSH_DESKTOP_E2E_DRIVER: '1', DSH_DESKTOP_E2E_CONFIG: configPath },
  })
  assert.equal(result.ok, true)
  assert.deepEqual(calls, ['checkDesktop', 'downloadDesktop', 'installDesktop'])
})

test('driver tamper phase records the expected rollback refusal', async () => {
  const root = makeRoot()
  const calls = []
  const updateService = makeUpdateService(root, calls)
  updateService.rollbackDesktop = async () => {
    calls.push('rollbackDesktop')
    throw new Error('上一客户端安装包的校验值发生变化。')
  }
  const { configPath } = makeConfig(root, { phase: 'tamper' })
  const result = await runDevE2EDriver(updateService, {
    buildFlavor: 'dev',
    e2eBuild: true,
    app: { getVersion: () => '0.4.2' },
    env: { DSH_DESKTOP_E2E_DRIVER: '1', DSH_DESKTOP_E2E_CONFIG: configPath },
  })
  assert.equal(result.expectedFailure, true)
  assert.deepEqual(calls, ['rollbackDesktop'])
  const journal = JSON.parse(readFileSync(join(root, 'evidence', 'journal.json'), 'utf8'))
  assert.ok(journal.entries.some(entry => entry.stage === 'rollback-refused'))
})

test('driver does not run for stable/normal Dev even when env is set', async () => {
  const root = makeRoot()
  const updateService = makeUpdateService(root)
  const { configPath } = makeConfig(root)
  const env = { DSH_DESKTOP_E2E_DRIVER: '1', DSH_DESKTOP_E2E_CONFIG: configPath }
  assert.deepEqual(await runDevE2EDriver(updateService, { buildFlavor: 'stable', e2eBuild: true, app: { getVersion: () => '0.4.2' }, env }), { ran: false })
  assert.deepEqual(await runDevE2EDriver(updateService, { buildFlavor: 'dev', e2eBuild: false, app: { getVersion: () => '0.4.2' }, env }), { ran: false })
})
