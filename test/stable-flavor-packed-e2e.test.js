import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, test } from 'node:test'

import { verifyBuildReceipt } from '../scripts/build-receipt.mjs'
import { resolveBuildRoot } from '../scripts/build-kit.mjs'
import { prepareSmokeExecutable } from '../scripts/smoke-executable.js'
import { UpdateService } from '../src/update-service.js'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const COMMIT = 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'
const PACKAGED_EXE = join(repoRoot, 'artifacts', 'win-unpacked', 'DeepSeek Harness Personal.exe')
const PACKAGED_APP_DIR = join(repoRoot, 'artifacts', 'win-unpacked', 'resources', 'app')
const PACKAGED_RECEIPT = join(repoRoot, 'artifacts', 'build-receipt.json')
const owned = []
afterEach(() => {
  for (const path of owned.splice(0)) rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
})

function sha256Buffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function readBuildReceipt() {
  if (!existsSync(PACKAGED_RECEIPT)) return null
  try {
    return JSON.parse(readFileSync(PACKAGED_RECEIPT, 'utf8'))
  } catch {
    return null
  }
}

function verifyCurrentReceipt(receipt) {
  return verifyBuildReceipt({
    projectRoot: repoRoot,
    receipt,
    exePath: PACKAGED_EXE,
    packagedAppDir: PACKAGED_APP_DIR,
    expectedFlavor: 'stable',
  })
}

function runStablePackDir() {
  const result = spawnSync(process.execPath, ['scripts/pack-desktop.js', 'stable', 'dir'], {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 600_000,
  })
  if (result.status !== 0) {
    throw new Error(`pack:win:dir failed (${String(result.status)}).\n${result.stderr || result.stdout}`)
  }
  if (!existsSync(PACKAGED_EXE)) throw new Error('pack:win:dir did not produce artifacts/win-unpacked exe')
}

function ensureStablePackagedExecutable() {
  const existingReceipt = readBuildReceipt()
  if (existingReceipt !== null) {
    const verification = verifyCurrentReceipt(existingReceipt)
    if (verification.ok) return PACKAGED_EXE
  }
  // Never trust an EXE just because it exists: rebuild unless the receipt
  // proves it was produced from the current source/lock/client version.
  runStablePackDir()
  const receipt = readBuildReceipt()
  if (receipt === null) throw new Error('pack:win:dir did not write artifacts/build-receipt.json')
  const verification = verifyCurrentReceipt(receipt)
  if (!verification.ok) {
    throw new Error(`pack:win:dir produced a receipt that does not match current source: ${verification.issues.join('; ')}`)
  }
  return PACKAGED_EXE
}

function listFiles(directory, prefix = '') {
  const output = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    const absolute = join(directory, entry.name)
    if (entry.isDirectory()) output.push(...listFiles(absolute, relative))
    else if (entry.isFile()) output.push(relative)
  }
  return output
}

async function makeLocalPluginFixture() {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'dsh-packed-e2e-fixture-'))
  owned.push(fixtureRoot)
  const indexPlugins = []
  const tar = requireTar()
  for (const [directoryName, packageName, assetVersion] of [
    ['anysearch', '@cyrus/dsh-anysearch', '9.9.9'],
    ['trajectory-island', '@cyrus/dsh-trajectory-island', '9.9.9'],
  ]) {
    const sourceDir = join(repoRoot, 'plugins', directoryName)
    const packageDir = join(fixtureRoot, 'src', directoryName, 'package')
    cpSync(sourceDir, packageDir, { recursive: true })
    const manifestPath = join(packageDir, 'package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    manifest.version = assetVersion
    if (!manifest.dshComposable) manifest.dshComposable = { schemaVersion: 2 }
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    const assetName = `cyrus-dsh-${directoryName}-${assetVersion}.tgz`
    const tgzPath = join(fixtureRoot, assetName)
    const sourceParent = join(fixtureRoot, 'src', directoryName)
    const fileEntries = listFiles(packageDir).map(relative => `package/${relative}`)
    await tar.c({ gzip: true, cwd: sourceParent, file: tgzPath }, fileEntries)
    const data = readFileSync(tgzPath)
    indexPlugins.push({
      packageName,
      version: assetVersion,
      assetName,
      assetSize: data.length,
      sha256: sha256Buffer(data),
      minClient: '0.4.2',
      compatibleHarness: { versionRange: '0.1.1-rc.2', commits: [COMMIT] },
      seams: directoryName === 'anysearch' ? ['web.searchProvider'] : ['dsh-client-ui-trajectory'],
      requires: [],
      externalEligible: true,
    })
  }
  const indexPath = join(fixtureRoot, 'plugin-index.json')
  writeFileSync(indexPath, `${JSON.stringify({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    releaseTag: 'plugins-v2026.08.22.99',
    minClient: '0.4.2',
    compatibleHarness: { version: '0.1.1-rc.2', commit: COMMIT },
    plugins: indexPlugins,
  }, null, 2)}\n`)
  return { fixtureRoot, indexPath }
}

function requireTar() {
  const localRequire = createRequire(import.meta.url)
  return localRequire('../vendor/pnpm/dist/node_modules/tar')
}

async function preparePendingGeneration(externalRoot) {
  const fixture = await makeLocalPluginFixture()
  const previousIndex = process.env.DSH_PERSONAL_PLUGIN_INDEX
  process.env.DSH_PERSONAL_PLUGIN_INDEX = fixture.indexPath
  const service = new UpdateService({
    app: { getVersion: () => '0.4.2', isPackaged: false },
    shell: {},
    userDataPath: resolve(externalRoot, '..'),
    projectRoot: repoRoot,
    getCurrentSourceRoot: () => resolveBuildRoot(),
    preflightHarness: async () => {},
    onInstallDesktop: async () => {},
    onRelaunch: async () => {},
  })
  try {
    await service.ensureLoaded()
    service.harness.currentCommit = COMMIT
    await service.checkPlugins()
    assert.ok(service.plugin.available.length >= 2, `expected two available plugins, got ${service.plugin.available.length}`)
    await service.preparePluginGeneration()
  } finally {
    if (previousIndex === undefined) delete process.env.DSH_PERSONAL_PLUGIN_INDEX
    else process.env.DSH_PERSONAL_PLUGIN_INDEX = previousIndex
    await service.dispose().catch(() => {})
  }
  const pendingPath = join(externalRoot, 'pending.json')
  assert.equal(existsSync(pendingPath), true, 'preparePluginGeneration did not write pending.json')
  const pending = JSON.parse(readFileSync(pendingPath, 'utf8'))
  assert.ok(pending.generationId, 'pending.json missing generationId')
  return pending.generationId
}

async function launchPackagedSmoke(executable, { externalRoot, expectExternal, profile, resultPath }) {
  const { userData, dshHome, agentsHome, workspaceRoot, projectControlHome } = profile
  const prepared = prepareSmokeExecutable(executable)
  const env = {
    ...process.env,
    DSH_DESKTOP_SMOKE: '1',
    DSH_DESKTOP_SMOKE_RESULT: resultPath,
    DSH_DESKTOP_USER_DATA: userData,
    DSH_HOME: dshHome,
    DSH_AGENTS_HOME: agentsHome,
    PROJECT_CONTROL_HOME: projectControlHome,
    DSH_SOURCE_ROOT: resolveBuildRoot(),
    DSH_WORKSPACE_ROOT: workspaceRoot,
    DSH_TELEMETRY_DISABLED: '1',
    DSH_MEMORY_SELF_TEST: '1',
    DSH_MEMORY_EXTRACTION: '1',
  }
  if (externalRoot !== undefined) env.DSH_PERSONAL_PLUGINS_EXTERNAL = externalRoot
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(prepared?.executable ?? executable, [], {
    cwd: repoRoot,
    env,
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', chunk => { output = `${output}${chunk}`.slice(-30_000) })
  child.stderr.on('data', chunk => { output = `${output}${chunk}`.slice(-30_000) })
  let outcome
  try {
    outcome = await waitForProcess(child, 180_000)
  } finally {
    if (child.exitCode === null && child.signalCode === null) terminateTree(child.pid)
    prepared?.cleanup()
  }
  assert.equal(outcome.timedOut, false, `packed smoke timed out.\n${output}`)
  assert.equal(outcome.code, 0, `packed smoke exited ${String(outcome.code)}.\n${output}`)
  assert.equal(existsSync(resultPath), true, `packed smoke did not write result.\n${output}`)
  const result = JSON.parse(readFileSync(resultPath, 'utf8'))
  assert.equal(result.pageLoaded, true, `packed smoke page not loaded.\n${output}`)
  assert.equal(result.stop?.graceful, true, `packed smoke stop not graceful.\n${output}`)
  const doctor = result.personalState?.externalDoctor
  if (expectExternal) {
    let externalState = ''
    if (externalRoot !== undefined) {
      try {
        const entries = readdirSync(externalRoot)
        let currentText = ''
        let generationDirs = ''
        let batchText = ''
        let installExists = ''
        try {
          currentText = readFileSync(join(externalRoot, 'current.json'), 'utf8')
          const current = JSON.parse(currentText)
          const genDir = join(externalRoot, 'generations', current.generationId)
          generationDirs = readdirSync(genDir).join(',')
          batchText = readFileSync(join(genDir, 'batch.json'), 'utf8')
          const installPath = join(genDir, 'packages', 'anysearch', '9.9.9', '.install.json')
          installExists = readFileSync(installPath, 'utf8')
        } catch (error) {
          currentText = `current-json-error: ${String(error)}`
        }
        externalState = `entries=${entries.join(',')}\ncurrent=${currentText}\ngenerations=${generationDirs}\nbatch=${batchText}\ninstall=${installExists}`
      } catch (error) {
        externalState = String(error)
      }
    }
    assert.equal(doctor?.active, true, `externalDoctor not active after ${expectExternal}.\n${JSON.stringify(result, null, 2)}\n--- externalRoot entries ---\n${externalState}\n--- app output ---\n${output}`)
    for (const name of ['@cyrus/dsh-anysearch', '@cyrus/dsh-trajectory-island']) {
      assert.equal(result.personalState?.api?.plugins?.fiber?.[name], 'active', `${name} fiber not active.\n${JSON.stringify(result, null, 2)}`)
    }
  } else {
    assert.equal(doctor?.active, false, `externalDoctor should be inactive after rollback.\n${JSON.stringify(result, null, 2)}`)
  }
  return result
}

function waitForProcess(child, timeoutMs) {
  return new Promise(resolvePromise => {
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      terminateTree(child.pid)
    }, timeoutMs)
    child.once('error', error => {
      clearTimeout(timer)
      resolvePromise({ code: null, signal: null, timedOut, error })
    })
    child.once('close', (code, signal) => {
      clearTimeout(timer)
      resolvePromise({ code, signal, timedOut })
    })
  })
}

function terminateTree(pid) {
  if (pid === undefined) return
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/pid', String(pid), '/t', '/f'], {
      shell: false,
      windowsHide: true,
      stdio: 'ignore',
    })
    return
  }
  try {
    process.kill(pid, 'SIGKILL')
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error
  }
}

test('stable packed Electron/Harness external plugin closure activates, restarts ACTIVE, rolls back to builtin', async () => {
  const executable = ensureStablePackagedExecutable()
  const root = mkdtempSync(join(tmpdir(), 'dsh-packed-e2e-'))
  owned.push(root)
  const externalRoot = join(root, 'plugins-external')
  mkdirSync(externalRoot, { recursive: true })

  // All three launches share one temporary Profile (userData, DSH_HOME,
  // agentsHome, workspace, Project Control home).
  const profileRoot = mkdtempSync(join(tmpdir(), 'dsh-packed-e2e-profile-'))
  owned.push(profileRoot)
  const profile = {
    userData: join(profileRoot, 'userData'),
    dshHome: join(profileRoot, 'dshHome'),
    agentsHome: join(profileRoot, 'agentsHome'),
    workspaceRoot: join(profileRoot, 'workspace'),
    projectControlHome: join(profileRoot, 'projectControl'),
  }
  for (const dir of Object.values(profile)) mkdirSync(dir, { recursive: true })

  // Real UpdateService prepares the pending generation from a local fixture.
  const generationId = await preparePendingGeneration(externalRoot)
  assert.ok(generationId.startsWith('pending-'))

  // Launch 1: the real packaged app activates the pending generation and
  // commits current.json only after the live fiber/doctor probes pass. The
  // smoke result is captured before the commit, so the first launch only needs
  // to prove a clean boot; the commit evidence is checked on disk afterwards.
  await launchPackagedSmoke(executable, {
    externalRoot,
    expectExternal: false,
    profile,
    resultPath: join(profileRoot, 'result-1.json'),
  })
  const currentPath = join(externalRoot, 'current.json')
  assert.equal(existsSync(currentPath), true, 'current.json was not committed after first launch')
  const current = JSON.parse(readFileSync(currentPath, 'utf8'))
  assert.equal(current.generationId, generationId)

  // Launch 2: restart while the same external generation is current; it must
  // still report ACTIVE without a new activation journal.
  assert.equal(existsSync(join(externalRoot, 'activating.json')), false, 'activating.json should be gone after commit')
  await launchPackagedSmoke(executable, {
    externalRoot,
    expectExternal: 'restart',
    profile,
    resultPath: join(profileRoot, 'result-2.json'),
  })

  // Rollback through the public UpdateService entry to builtin.
  const service = new UpdateService({
    app: { getVersion: () => '0.4.2', isPackaged: false },
    shell: {},
    userDataPath: root,
    projectRoot: repoRoot,
    getCurrentSourceRoot: () => resolveBuildRoot(),
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
  assert.equal(existsSync(currentPath), false, 'rollbackPluginGeneration did not clear current.json')

  // Launch 3: after rollback the same externalRoot has no current generation,
  // so the packaged app must boot on the built-in plugin baseline.
  await launchPackagedSmoke(executable, {
    externalRoot,
    expectExternal: false,
    profile,
    resultPath: join(profileRoot, 'result-3.json'),
  })
})
