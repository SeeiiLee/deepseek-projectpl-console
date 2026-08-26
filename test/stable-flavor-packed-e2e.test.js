import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, test } from 'node:test'

import { verifyBuildReceipt } from '../scripts/build-receipt.mjs'
import { resolveBuildRoot } from '../scripts/build-kit.mjs'
import { prepareSmokeExecutable } from '../scripts/smoke-executable.js'
import { PERSONAL_PLUGINS } from '../src/personal-plugins.js'
import { UpdateService } from '../src/update-service.js'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const COMMIT = 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'
const PACKAGED_ROOT = join(repoRoot, 'artifacts', 'win-unpacked')
const PACKAGED_EXE = join(PACKAGED_ROOT, 'DeepSeek Harness Personal.exe')
const PACKAGED_APP_DIR = join(PACKAGED_ROOT, 'resources', 'app')
const PACKAGED_RECEIPT = join(repoRoot, 'artifacts', 'build-receipt.json')
const owned = []
afterEach(() => {
  for (const path of owned.splice(0)) rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
})

function sha256File(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
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

function collectHashes(directory, output = {}, prefix = '') {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name)
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) collectHashes(absolute, output, relative)
    else if (entry.isFile()) output[relative] = sha256File(absolute)
  }
  return output
}

/**
 * Prepare a real pending generation on disk using the actual plugin sources
 * (AnySearch 0.1.1-beta, trajectory-island 0.1.1). The packaged app must turn
 * this pending.json into current.json itself; no current.json is hand-written.
 */
function preparePendingGeneration(externalRoot) {
  const generationId = `pending-${Date.now()}`
  const generationDir = join(externalRoot, 'generations', generationId)
  const packages = {}
  for (const { packageName } of PERSONAL_PLUGINS) {
    packages[packageName] = { source: 'builtin' }
  }
  for (const [directoryName, packageName] of [
    ['anysearch', '@cyrus/dsh-anysearch'],
    ['trajectory-island', '@cyrus/dsh-trajectory-island'],
  ]) {
    const sourceDir = join(repoRoot, 'plugins', directoryName)
    const manifest = JSON.parse(readFileSync(join(sourceDir, 'package.json'), 'utf8'))
    const version = manifest.version
    const pkgDir = join(generationDir, 'packages', directoryName, version)
    mkdirSync(pkgDir, { recursive: true })
    cpSync(sourceDir, pkgDir, { recursive: true })
    const files = collectHashes(pkgDir)
    writeFileSync(join(pkgDir, '.install.json'), JSON.stringify({
      schemaVersion: 1,
      packageName,
      version,
      sourceTag: 'plugins-v2026.08.24.1',
      tgzSha256: 'a'.repeat(64),
      minClient: '0.4.3',
      harnessCommit: COMMIT,
      pluginContractVersion: '2',
      seams: directoryName === 'anysearch' ? ['web.searchProvider'] : ['dsh-client-ui-trajectory'],
      files,
    }, null, 2))
    packages[packageName] = { source: 'external', directoryName, version }
  }
  writeFileSync(join(generationDir, 'batch.json'), JSON.stringify({
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
  return generationId
}

async function launchPackagedSmoke(executable, { expectExternal, profile, resultPath }) {
  const { userData, dshHome, agentsHome, workspaceRoot, projectControlHome } = profile
  const externalRoot = join(userData, 'plugins-external')
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
  // Regression: do NOT inject DSH_PERSONAL_PLUGINS_EXTERNAL here. The packaged
  // stable app must derive the root from its real (temporary) userData and pass
  // it to the Harness helper itself.
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
        const installPath = join(genDir, 'packages', 'anysearch', '0.1.1-beta', '.install.json')
        installExists = readFileSync(installPath, 'utf8')
      } catch (error) {
        currentText = `current-json-error: ${String(error)}`
      }
      externalState = `entries=${entries.join(',')}\ncurrent=${currentText}\ngenerations=${generationDirs}\nbatch=${batchText}\ninstall=${installExists}`
    } catch (error) {
      externalState = String(error)
    }
    assert.equal(doctor?.active, true, `externalDoctor not active after ${expectExternal}.\n${JSON.stringify(result, null, 2)}\n--- externalRoot entries ---\n${externalState}\n--- app output ---\n${output}`)
    const expectedVersions = {
      '@cyrus/dsh-anysearch': '0.1.1-beta',
      '@cyrus/dsh-trajectory-island': '0.1.1',
    }
    for (const name of Object.keys(expectedVersions)) {
      assert.equal(result.personalState?.api?.plugins?.fiber?.[name], 'active', `${name} fiber not active.\n${JSON.stringify(result, null, 2)}`)
      const packageState = doctor?.packages?.find(pkg => pkg.packageName === name)
      assert.equal(packageState?.version, expectedVersions[name], `${name} version not external ${expectedVersions[name]}.\n${JSON.stringify(result, null, 2)}`)
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
  const packageHashesBefore = collectHashes(PACKAGED_ROOT)
  const assertPackageSetUnchanged = label => {
    assert.deepEqual(
      collectHashes(PACKAGED_ROOT),
      packageHashesBefore,
      `package set changed after ${label}`,
    )
  }

  // All three launches share one temporary Profile (userData, DSH_HOME,
  // agentsHome, workspace, Project Control home). The external plugin root is
  // deliberately the real userData/plugins-external path: no env override.
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
  const externalRoot = join(profile.userData, 'plugins-external')
  mkdirSync(externalRoot, { recursive: true })

  // The test manually constructs a valid pending generation (real plugin
  // sources + .install.json + batch.json); the packaged app must promote it.
  const generationId = await preparePendingGeneration(externalRoot)
  assert.ok(generationId.startsWith('pending-'))

  // Launch 1: the real packaged app activates the pending generation and
  // commits current.json only after the live fiber/doctor probes pass. The
  // smoke result is captured before the commit, so the first launch only needs
  // to prove a clean boot; the commit evidence is checked on disk afterwards.
  await launchPackagedSmoke(executable, {
    expectExternal: false,
    profile,
    resultPath: join(profileRoot, 'result-1.json'),
  })
  assertPackageSetUnchanged('activation launch')
  assert.equal(existsSync(join(profile.userData, 'logs', 'boot-error.log')), true, 'boot log must be written below isolated userData')
  assert.equal(existsSync(join(PACKAGED_APP_DIR, 'boot-error.log')), false, 'packaged resources/app must not receive boot logs')
  const currentPath = join(externalRoot, 'current.json')
  assert.equal(existsSync(currentPath), true, 'current.json was not committed after first launch')
  const current = JSON.parse(readFileSync(currentPath, 'utf8'))
  assert.equal(current.generationId, generationId)
  assert.equal(existsSync(join(externalRoot, 'pending.json')), false, 'pending.json should be cleared after commit')
  assert.equal(existsSync(join(externalRoot, 'activating.json')), false, 'activating.json should be cleared after commit')
  const profileScope = join(profile.dshHome, 'profiles', 'web', 'node_modules', '@cyrus')
  assert.equal(existsSync(profileScope), true, 'profile @cyrus scope junction was not created')
  const scopeTarget = resolve(dirname(profileScope), readlinkSync(profileScope))
  assert.equal(
    scopeTarget,
    join(externalRoot, 'generations', generationId, 'scope', '@cyrus'),
    `profile @cyrus must point to the external generation scope, got ${scopeTarget}`,
  )

  // Launch 2: restart while the same external generation is current; it must
  // still report ACTIVE without a new activation journal.
  assert.equal(existsSync(join(externalRoot, 'activating.json')), false, 'activating.json should be gone after commit')
  await launchPackagedSmoke(executable, {
    expectExternal: 'restart',
    profile,
    resultPath: join(profileRoot, 'result-2.json'),
  })
  assertPackageSetUnchanged('restart launch')

  // Rollback through the public UpdateService entry to builtin.
  const service = new UpdateService({
    app: { getVersion: () => '0.4.2', isPackaged: false },
    shell: {},
    userDataPath: profile.userData,
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
    expectExternal: false,
    profile,
    resultPath: join(profileRoot, 'result-3.json'),
  })
  assertPackageSetUnchanged('rollback launch')
  const rolledBackScopeStat = lstatSync(profileScope)
  assert.equal(rolledBackScopeStat.isSymbolicLink(), false, 'profile @cyrus should no longer be a single external junction after rollback')
})
