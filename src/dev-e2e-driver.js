// src/dev-e2e-driver.js
// Dev-E2E-only orchestration driver. It is compiled only into immutable
// Dev-E2E builds (BUILD_FLAVOR=dev && E2E_BUILD=true) and refuses to run for
// stable, normal Dev, missing configuration, or corrupt configuration.
//
// The driver uses only the real public UpdateService methods and writes an
// independent atomic orchestration journal. It never writes update-center.json
// by hand and never pretends that an installer launched.
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { isStrictLoopbackHttpUrl } from './update-core.js'

export const DEV_E2E_DRIVER_SCHEMA_VERSION = 1
export const DEV_E2E_DRIVER_VERSION = '1.0.0'
export const DEV_E2E_DRIVER_SWITCH = 'DSH_DESKTOP_E2E_DRIVER'
export const DEV_E2E_CONFIG_ENV = 'DSH_DESKTOP_E2E_CONFIG'

const DRIVER_PHASES = new Set([
  'install',
  'rollback',
  'confirm',
  'verify',
  'tamper',
  'installer-failure',
  'cancel-install',
  'repeat-rollback',
  'target-not-booted',
])

const EXPECTED_FAILURE_PHASES = new Set([
  'tamper',
  'installer-failure',
  'cancel-install',
  'target-not-booted',
])

export function isDevE2EDriverRequested({ buildFlavor, e2eBuild, env = process.env }) {
  return buildFlavor === 'dev' && e2eBuild === true && env[DEV_E2E_DRIVER_SWITCH] === '1'
}

/** Parse and strictly validate the orchestration config file. */
export async function loadDevE2EConfig({ env = process.env, userDataPath }) {
  const configPath = env[DEV_E2E_CONFIG_ENV]
  if (typeof configPath !== 'string' || configPath.trim() === '' || configPath !== configPath.trim()) {
    throw new Error(`Dev-E2E driver is enabled but ${DEV_E2E_CONFIG_ENV} is missing or invalid.`)
  }
  let raw
  try {
    raw = await readFile(configPath, 'utf8')
  } catch (error) {
    throw new Error(`Dev-E2E config unreadable: ${error.message}`)
  }
  let config
  try {
    config = JSON.parse(raw)
  } catch (error) {
    throw new Error(`Dev-E2E config corrupt: ${error.message}`)
  }
  if (typeof config !== 'object' || config === null) throw new Error('Dev-E2E config is not an object.')
  if (config.schemaVersion !== DEV_E2E_DRIVER_SCHEMA_VERSION) {
    throw new Error(`Dev-E2E config schemaVersion ${String(config.schemaVersion)} != ${DEV_E2E_DRIVER_SCHEMA_VERSION}`)
  }
  if (typeof config.runId !== 'string' || !/^[A-Za-z0-9._-]+$/u.test(config.runId)) {
    throw new Error('Dev-E2E config runId is missing or invalid.')
  }
  if (typeof config.phase !== 'string' || !DRIVER_PHASES.has(config.phase)) {
    throw new Error(`Dev-E2E config phase is missing or unsupported: ${String(config.phase)}`)
  }
  if (!isStrictLoopbackHttpUrl(config.localUpdateBase)) {
    throw new Error('Dev-E2E config localUpdateBase is not the strict http://127.0.0.1:<port> form.')
  }
  if (typeof config.evidenceDir !== 'string' || !isAbsolute(config.evidenceDir)) {
    throw new Error('Dev-E2E config evidenceDir must be an absolute path.')
  }
  if (typeof config.journalPath !== 'string' || !isAbsolute(config.journalPath)) {
    throw new Error('Dev-E2E config journalPath must be an absolute path.')
  }
  const evidenceRoot = resolve(config.evidenceDir)
  const journal = resolve(config.journalPath)
  const rel = relative(evidenceRoot, journal)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('Dev-E2E config journalPath must be inside evidenceDir.')
  }
  return { ...config, configPath: resolve(configPath) }
}

async function readJournal(journalPath) {
  try {
    const parsed = JSON.parse(await readFile(journalPath, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null || parsed.schemaVersion !== DEV_E2E_DRIVER_SCHEMA_VERSION) {
      throw new Error('journal schema mismatch')
    }
    if (!Array.isArray(parsed.entries)) throw new Error('journal entries missing')
    return parsed
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { schemaVersion: DEV_E2E_DRIVER_SCHEMA_VERSION, entries: [] }
    }
    throw new Error(`Dev-E2E orchestration journal is corrupt: ${error.message}`)
  }
}

async function writeJournal(journalPath, journal) {
  await mkdir(dirname(journalPath), { recursive: true })
  const temporary = `${journalPath}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(journal, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  await rename(temporary, journalPath)
}

async function appendJournalEntry(config, entry) {
  const journal = await readJournal(config.journalPath)
  journal.entries.push({
    at: new Date().toISOString(),
    pid: process.pid,
    ...entry,
  })
  await writeJournal(config.journalPath, journal)
}

async function snapshotState(updateService) {
  try {
    return await updateService.getState()
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

function installerFacts(updateService) {
  const document = updateService.document
  const pending = document?.installPending ?? document?.rollbackPending
  return {
    version: pending?.version,
    installerPath: pending?.path,
    installerSha256: pending?.sha256,
  }
}

/**
 * Run the Dev-E2E driver after startup gates have passed. Positive install and
 * rollback phases call the real public methods and therefore normally end by
 * the real onInstallDesktop -> shutdownAndExit -> launchInstaller path.
 */
export async function runDevE2EDriver(updateService, { buildFlavor, e2eBuild, app, env = process.env }) {
  if (!isDevE2EDriverRequested({ buildFlavor, e2eBuild, env })) {
    return { ran: false }
  }
  const config = await loadDevE2EConfig({ env, userDataPath: updateService.userDataPath })
  await appendJournalEntry(config, {
    stage: 'driver-start',
    phase: config.phase,
    runId: config.runId,
    version: app.getVersion(),
    exitReason: 'starting',
  })

  const record = async (stage, extra = {}) => {
    await appendJournalEntry(config, {
      stage,
      phase: config.phase,
      runId: config.runId,
      version: app.getVersion(),
      ...installerFacts(updateService),
      state: await snapshotState(updateService),
      ...extra,
    })
  }

  try {
    if (config.phase === 'install') {
      await record('before-checkDesktop')
      await updateService.checkDesktop()
      await record('after-checkDesktop')
      await updateService.downloadDesktop()
      await record('after-downloadDesktop')
      await updateService.installDesktop()
      await record('after-installDesktop', { exitReason: 'installer-launch-scheduled' })
      return { ran: true, ok: true, phase: config.phase }
    }
    if (config.phase === 'rollback' || config.phase === 'repeat-rollback') {
      await record('before-rollbackDesktop')
      await updateService.rollbackDesktop()
      await record('after-rollbackDesktop', { exitReason: 'rollback-installer-launch-scheduled' })
      return { ran: true, ok: true, phase: config.phase }
    }
    if (config.phase === 'confirm' || config.phase === 'verify') {
      await record('after-confirmDesktopLifecycle', { exitReason: 'phase-complete' })
      return { ran: true, ok: true, phase: config.phase }
    }
    if (config.phase === 'tamper') {
      // Expected negative: rollbackDesktop must reject a tampered previous
      // installer without clearing pending/previous. The driver records the
      // refusal and returns normally so the outer orchestration can inspect
      // the real update-center.json and the journal.
      try {
        await updateService.rollbackDesktop()
      } catch (error) {
        await record('rollback-refused', {
          expectedFailure: true,
          exitReason: error instanceof Error ? error.message : String(error),
        })
        return { ran: true, ok: true, phase: config.phase, expectedFailure: true }
      }
      throw new Error('Dev-E2E tamper phase expected rollbackDesktop to be refused, but it succeeded.')
    }
    if (config.phase === 'installer-failure' || config.phase === 'cancel-install') {
      // These negative phases are driven by the outer script when it needs to
      // interrupt/break the real installer. In the in-app driver we only
      // record that the phase was requested; the outer script performs the
      // real process-level manipulation and then verifies the persisted state.
      await record('negative-phase-requested', { exitReason: 'outer-script-control' })
      return { ran: true, ok: true, phase: config.phase }
    }
    if (config.phase === 'target-not-booted') {
      // The main process already called confirmDesktopLifecycle on boot. If the
      // current version does not match the pending target, the real method must
      // not clear anything. We record the post-confirm snapshot as evidence.
      await record('after-confirmDesktopLifecycle-target-not-booted', { exitReason: 'phase-complete' })
      return { ran: true, ok: true, phase: config.phase }
    }
    throw new Error(`Unsupported Dev-E2E driver phase: ${config.phase}`)
  } catch (error) {
    await record('driver-error', {
      exitReason: error instanceof Error ? error.message : String(error),
      expectedFailure: EXPECTED_FAILURE_PHASES.has(config.phase),
    })
    throw error
  }
}
