import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readlinkSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'

import {
  PERSONAL_PLUGINS,
  commitActivatingGeneration,
  ensurePersonalPluginLinks,
  startPendingActivation,
} from '../src/personal-plugins.js'
import { UpdateService } from '../src/update-service.js'

const PROJECT_CONTROL = '@cyrus/dsh-project-control'
const BASELINE_VERSION = '0.1.0-rc.11'
const CANDIDATE_VERSION = '0.1.0-rc.12'

function parseArgs(argv) {
  const result = {}
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error('usage: node scripts/verify-project-control-plugin-fixture.mjs --fixture <dir> --receipt <file> [--project-root <repo>]')
    }
    result[key.slice(2)] = value
  }
  if (!result.fixture || !result.receipt) {
    throw new Error('--fixture and --receipt are required')
  }
  return result
}

function sha256(data) {
  return createHash('sha256').update(data).digest('hex')
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function writeJsonExclusive(path, value) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
}

function junctionTarget(path) {
  const stat = lstatSync(path)
  assert.equal(stat.isSymbolicLink(), true, `${path} must be a junction`)
  return resolve(dirname(path), readlinkSync(path))
}

async function createBaselineRoot(repositoryRoot, temporaryRoot) {
  const baselineRoot = join(temporaryRoot, 'baseline')
  for (const plugin of PERSONAL_PLUGINS) {
    const sourceManifest = await readJson(join(repositoryRoot, 'plugins', plugin.directoryName, 'package.json'))
    assert.equal(sourceManifest.name, plugin.packageName)
    const version = plugin.packageName === PROJECT_CONTROL ? BASELINE_VERSION : sourceManifest.version
    const directory = join(baselineRoot, 'plugins', plugin.directoryName)
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'package.json'), `${JSON.stringify({ name: plugin.packageName, version }, null, 2)}\n`)
  }
  return baselineRoot
}

async function verifyFixture(fixtureRoot) {
  const indexPath = join(fixtureRoot, 'plugin-index.json')
  const releasePath = join(fixtureRoot, 'release-manifest.json')
  const index = await readJson(indexPath)
  const release = await readJson(releasePath)
  assert.equal(index.schemaVersion, 1)
  assert.equal(index.plugins.length, 1, 'fixture must contain exactly one plugin')
  const entry = index.plugins[0]
  assert.equal(entry.packageName, PROJECT_CONTROL)
  assert.equal(entry.version, CANDIDATE_VERSION)
  assert.equal(entry.externalEligible, true)
  assert.equal(index.minClient, '0.4.6')
  assert.equal(release.localFixture, true)
  assert.equal(release.releaseTag, index.releaseTag)
  assert.equal(release.assets.length, 1)
  assert.equal(release.assets[0].assetName, entry.assetName)
  assert.equal(release.assets[0].sha256, entry.sha256)
  const assetPath = join(fixtureRoot, entry.assetName)
  const asset = await readFile(assetPath)
  assert.equal(asset.length, entry.assetSize)
  assert.equal(sha256(asset), entry.sha256)
  return { assetPath, entry, index, indexPath, release }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const repositoryRoot = resolve(args['project-root'] ?? join(dirname(fileURLToPath(import.meta.url)), '..'))
  const fixtureRoot = resolve(args.fixture)
  const receiptPath = resolve(args.receipt)
  assert.equal(existsSync(receiptPath), false, `receipt already exists: ${receiptPath}`)

  const startedAt = new Date().toISOString()
  let service
  let temporaryRoot
  let outcome = 'failed'
  let failure
  const checks = {}
  const evidence = {}
  const previousIndex = process.env.DSH_PERSONAL_PLUGIN_INDEX

  try {
    const fixture = await verifyFixture(fixtureRoot)
    checks.fixtureContract = 'pass'
    evidence.releaseTag = fixture.index.releaseTag
    evidence.assetName = fixture.entry.assetName
    evidence.assetSha256 = fixture.entry.sha256
    evidence.assetSize = fixture.entry.assetSize
    evidence.compatibleHarnessCommit = fixture.index.compatibleHarness.commit

    temporaryRoot = await mkdtemp(join(tmpdir(), 'dsh-project-control-rc12-project-lifecycle-'))
    const userData = join(temporaryRoot, 'user-data')
    const dshHome = join(temporaryRoot, 'dsh-home')
    const baselineRoot = await createBaselineRoot(repositoryRoot, temporaryRoot)
    await mkdir(userData, { recursive: true })
    process.env.DSH_PERSONAL_PLUGIN_INDEX = fixture.indexPath

    service = new UpdateService({
      app: { getVersion: () => '0.4.6', isPackaged: true },
      shell: {},
      userDataPath: userData,
      projectRoot: baselineRoot,
      getCurrentSourceRoot: () => repositoryRoot,
      preflightHarness: async () => {},
      onInstallDesktop: async () => {},
      onRelaunch: async () => {},
    })
    await service.ensureLoaded()
    service.harness.currentCommit = fixture.index.compatibleHarness.commit
    await service.checkPlugins()
    assert.equal(service.plugin.status, 'available')
    assert.equal(service.plugin.available.length, 1)
    assert.equal(service.plugin.available[0].packageName, PROJECT_CONTROL)
    assert.equal(service.plugin.available[0].version, CANDIDATE_VERSION)
    checks.updateDetection = 'pass'

    await service.preparePluginGeneration()
    const externalRoot = join(userData, 'plugins-external')
    const pending = await readJson(join(externalRoot, 'pending.json'))
    const generationDir = join(externalRoot, 'generations', pending.generationId)
    const batch = await readJson(join(generationDir, 'batch.json'))
    assert.equal(batch.packages[PROJECT_CONTROL].source, 'external')
    assert.equal(batch.packages[PROJECT_CONTROL].version, CANDIDATE_VERSION)
    for (const plugin of PERSONAL_PLUGINS) {
      if (plugin.packageName !== PROJECT_CONTROL) {
        assert.equal(batch.packages[plugin.packageName].source, 'builtin')
      }
    }
    checks.generationPrepared = 'pass'
    evidence.generationId = pending.generationId

    const installedRoot = join(generationDir, 'packages', 'project-control', CANDIDATE_VERSION)
    const hostModule = await import(`${pathToFileURL(join(installedRoot, 'lib', 'index.js')).href}?acceptance=${Date.now()}`)
    assert.equal(typeof hostModule.validateLifecycleCommand, 'function')
    assert.equal(typeof hostModule.validateLifecycleResult, 'function')
    assert.equal(typeof hostModule.validateProjectManifest, 'function')
    const manifest = await readJson(join(repositoryRoot, 'protocol', 'project-control', 'v1alpha1', 'examples', 'project-manifest.valid.json'))
    const lifecycleCommand = await readJson(join(repositoryRoot, 'protocol', 'project-control', 'v1alpha1', 'lifecycle', 'examples', 'command-rebind-location.valid.json'))
    const lifecycleResult = await readJson(join(repositoryRoot, 'protocol', 'project-control', 'v1alpha1', 'lifecycle', 'examples', 'result-rebind-location.valid.json'))
    assert.equal(hostModule.validateProjectManifest(manifest).valid, true)
    assert.equal(hostModule.validateLifecycleCommand(lifecycleCommand).ok, true)
    assert.equal(hostModule.validateLifecycleResult(lifecycleResult).ok, true)
    checks.installedSchemaValidation = 'pass'
    checks.selfContainedHostImport = 'pass'

    const activation = startPendingActivation({
      externalRoot,
      pluginRoot: join(repositoryRoot, 'plugins'),
      dshHome,
    })
    assert.equal(activation.candidateId, pending.generationId)
    const projectControlLink = activation.links.find(link => link.packageName === PROJECT_CONTROL)
    const generationScope = join(generationDir, 'scope', '@cyrus')
    const projectControlScope = join(generationScope, 'dsh-project-control')
    const profileScope = join(dshHome, 'profiles', 'web', 'node_modules', '@cyrus')
    assert.equal(resolve(projectControlLink.target), resolve(projectControlScope))
    assert.equal(resolve(projectControlLink.link), resolve(profileScope, 'dsh-project-control'))
    assert.equal(junctionTarget(profileScope), resolve(generationScope))
    assert.equal(junctionTarget(projectControlScope), resolve(installedRoot))
    checks.pendingActivation = 'pass'

    const committed = commitActivatingGeneration({
      externalRoot,
      pluginRoot: join(repositoryRoot, 'plugins'),
      dshHome,
      fiberOk: true,
    })
    assert.equal(committed, pending.generationId)
    const current = await readJson(join(externalRoot, 'current.json'))
    assert.equal(current.generationId, pending.generationId)
    checks.activationCommitted = 'pass'

    await service.rollbackPluginGeneration()
    assert.equal(existsSync(join(externalRoot, 'current.json')), false)
    const rollbackLinks = ensurePersonalPluginLinks({
      dshHome,
      pluginRoot: join(repositoryRoot, 'plugins'),
      requireBuilt: true,
      env: { ...process.env, DSH_DESKTOP_FLAVOR: 'stable' },
      userData,
    })
    const rolledBack = rollbackLinks.find(link => link.packageName === PROJECT_CONTROL)
    assert.equal(junctionTarget(rolledBack.link), resolve(repositoryRoot, 'plugins', 'project-control'))
    assert.equal(resolve(rolledBack.target), resolve(repositoryRoot, 'plugins', 'project-control'))
    checks.rollbackToBuiltin = 'pass'

    outcome = 'pass'
  } catch (error) {
    failure = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    throw error
  } finally {
    if (service !== undefined) await service.dispose().catch(() => {})
    if (previousIndex === undefined) delete process.env.DSH_PERSONAL_PLUGIN_INDEX
    else process.env.DSH_PERSONAL_PLUGIN_INDEX = previousIndex
    if (temporaryRoot !== undefined) await rm(temporaryRoot, { recursive: true, force: true })
    checks.temporaryProfileRemoved = temporaryRoot === undefined || !existsSync(temporaryRoot) ? 'pass' : 'fail'
    await writeJsonExclusive(receiptPath, {
      schemaVersion: 1,
      task: 'Project Control 0.1.0-rc.12 project lifecycle second batch isolated generation acceptance',
      startedAt,
      completedAt: new Date().toISOString(),
      outcome,
      fixtureRoot,
      receiptPath,
      temporaryRoot,
      checks,
      evidence,
      failure,
    })
  }
}

main().then(() => {
  process.stdout.write('project-control-plugin-fixture: PASS\n')
}).catch(error => {
  process.stderr.write(`project-control-plugin-fixture: FAIL ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
