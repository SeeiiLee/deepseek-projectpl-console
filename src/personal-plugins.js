import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadAppFlavor } from './app-flavor.js'
import {
  loadCurrentGeneration,
  normalizeExternalState,
  quarantineGeneration,
  resolveExternalRoot,
  validateGeneration,
  verifyGenerationDoctor,
} from './personal-plugin-validation.js'

export const PERSONAL_PLUGINS = Object.freeze([
  Object.freeze({ packageName: '@cyrus/dsh-personal-foundation', directoryName: 'personal-foundation' }),
  Object.freeze({ packageName: '@cyrus/dsh-personal-policy', directoryName: 'personal-policy' }),
  Object.freeze({ packageName: '@cyrus/dsh-personal-shell', directoryName: 'personal-shell' }),
  Object.freeze({ packageName: '@cyrus/dsh-workspace-hub', directoryName: 'workspace-hub' }),
  Object.freeze({ packageName: '@cyrus/dsh-project-control', directoryName: 'project-control' }),
  Object.freeze({ packageName: '@cyrus/dsh-workbench', directoryName: 'workbench' }),
  Object.freeze({ packageName: '@cyrus/dsh-personal-theme', directoryName: 'personal-theme' }),
  Object.freeze({ packageName: '@cyrus/dsh-desktop-integration', directoryName: 'desktop-integration' }),
  Object.freeze({ packageName: '@cyrus/dsh-skill-library', directoryName: 'skill-library' }),
  Object.freeze({ packageName: '@cyrus/dsh-plugin-organizer', directoryName: 'plugin-organizer' }),
  Object.freeze({ packageName: '@cyrus/dsh-connection-center', directoryName: 'connection-center' }),
  Object.freeze({ packageName: '@cyrus/dsh-session-terminal', directoryName: 'session-terminal' }),
  Object.freeze({ packageName: '@cyrus/dsh-usage-balance', directoryName: 'usage-balance' }),
  Object.freeze({ packageName: '@cyrus/dsh-trajectory-island', directoryName: 'trajectory-island' }),
  Object.freeze({ packageName: '@cyrus/dsh-update-center', directoryName: 'update-center' }),
  Object.freeze({ packageName: '@cyrus/dsh-image-vision', directoryName: 'image-vision' }),
  Object.freeze({ packageName: '@cyrus/dsh-anysearch', directoryName: 'anysearch' }),
  Object.freeze({ packageName: '@cyrus/dsh-memory', directoryName: 'memory' }),
])

export const PERSONAL_PLUGIN_PACKAGES = Object.freeze(PERSONAL_PLUGINS.map(plugin => plugin.packageName))

const MODULE_DIR = dirname(fileURLToPath(import.meta.url))

/** Resolve the unpacked plugin directory beside this launcher's source. */
export function resolvePersonalPluginsRoot(moduleDirectory = MODULE_DIR) {
  return resolve(moduleDirectory, '..', 'plugins')
}

/** Resolve Harness home without reading or changing the user's profile files. */
export function resolveHarnessHome(env = process.env) {
  return resolve(env.DSH_HOME || join(homedir(), '.dsh'))
}

/** Return the desktop-only Cordis overlay shipped with the personal plugins. */
export function resolvePersonalPatch(pluginRoot = resolvePersonalPluginsRoot()) {
  const patch = join(pluginRoot, 'cordis.patch.yml')
  if (!existsSync(patch)) throw new Error(`Personal plugin overlay is missing: ${patch}`)
  return patch
}

function readJsonFile(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function atomicWriteJsonSync(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  try {
    renameSync(temporary, path)
  } catch (error) {
    rmSync(temporary, { force: true })
    throw error
  }
}

function profileScopePath(dshHome) {
  return join(dshHome, 'profiles', 'web', 'node_modules', '@cyrus')
}

function isManagedScopeDirectory(path) {
  let entries
  try {
    entries = readdirSync(path, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
  return entries.every(entry => entry.isSymbolicLink())
}

function removeProfileScopeJunction(profileModules) {
  const scopePath = join(profileModules, '@cyrus')
  let stat
  try {
    stat = lstatSync(scopePath)
  } catch (error) {
    if (error?.code === 'ENOENT') return
    throw error
  }
  if (stat.isSymbolicLink()) {
    unlinkSync(scopePath)
    return
  }
  if (stat.isDirectory()) {
    if (!isManagedScopeDirectory(scopePath)) {
      throw new Error(`Refusing to remove non-managed profile @cyrus directory: ${scopePath}`)
    }
    rmSync(scopePath, { recursive: true, force: true })
    return
  }
  throw new Error(`Refusing to replace non-link/non-directory profile @cyrus path: ${scopePath}`)
}

function ensureProfileScopeJunction(profileModules, scopeTarget) {
  removeProfileScopeJunction(profileModules)
  mkdirSync(profileModules, { recursive: true })
  ensureJunction(join(profileModules, '@cyrus'), scopeTarget)
}

function quarantineCandidate(externalRoot, generationId, reason, extra = {}) {
  return quarantineGeneration(externalRoot, generationId, reason, extra)
}

function readActivating(externalRoot) {
  const path = join(externalRoot, 'activating.json')
  if (!existsSync(path)) return null
  return readJsonFile(path)
}

function removePendingFor(externalRoot, candidateId) {
  const pendingPath = join(externalRoot, 'pending.json')
  if (!existsSync(pendingPath)) return
  try {
    const pending = readJsonFile(pendingPath)
    if (pending?.generationId === candidateId || pending?.candidateId === candidateId) {
      rmSync(pendingPath, { force: true })
    }
  } catch {
    rmSync(pendingPath, { force: true })
  }
}

/**
 * Start a pending plugin generation activation.
 *
 * This is the pre-boot phase: it validates the candidate, writes the
 * `activating.json` journal with the fallback generation, assembles the
 * generation-local scope view, repoints the profile `@cyrus` junction to the
 * candidate scope, and returns without committing `current.json`. The commit
 * is performed later by `commitActivatingGeneration` after the Harness boot
 * and fiber/doctor probes pass.
 */
export function startPendingActivation({ externalRoot, pluginRoot, dshHome = resolveHarnessHome() } = {}) {
  const pendingPath = join(externalRoot, 'pending.json')
  if (!existsSync(pendingPath)) return null
  let pending
  try {
    pending = readJsonFile(pendingPath)
  } catch (error) {
    throw new Error(`pending.json 解析失败: ${error.message}`)
  }
  const candidateId = pending?.generationId ?? pending?.candidateId
  if (typeof candidateId !== 'string' || candidateId.length === 0) {
    throw new Error('pending.json 缺 generationId')
  }
  const generationDir = join(externalRoot, 'generations', candidateId)
  const batchPath = join(generationDir, 'batch.json')
  if (!existsSync(batchPath)) {
    quarantineCandidate(externalRoot, candidateId, 'pending generation 缺 batch.json')
    rmSync(pendingPath, { force: true })
    throw new Error(`pending generation 缺 batch.json: ${batchPath}`)
  }
  const batch = readJsonFile(batchPath)
  const current = loadCurrentGeneration(externalRoot, {
    directoryByPackage: new Map(PERSONAL_PLUGINS.map(plugin => [plugin.packageName, plugin.directoryName])),
  })
  const fallbackId = current?.generationId ?? null
  atomicWriteJsonSync(join(externalRoot, 'activating.json'), {
    candidateId,
    fallbackId,
    startedAt: new Date().toISOString(),
  })
  try {
    const links = assemblePersonalScopeView({ generationDir, batch, pluginRoot })
    const validation = validateGeneration(generationDir, {
      directoryByPackage: new Map(PERSONAL_PLUGINS.map(plugin => [plugin.packageName, plugin.directoryName])),
    })
    if (!validation.ok) {
      throw new Error(`generation 校验失败: ${validation.issues.join('; ')}`)
    }
    const doctor = verifyGenerationDoctor({ generationDir, batch })
    if (!doctor.ok) {
      throw new Error(`doctor 未通过: ${doctor.issues.join('; ')}`)
    }
    ensureProfileScopeJunction(dirname(profileScopePath(dshHome)), join(generationDir, 'scope', '@cyrus'))
    const profileModules = dirname(profileScopePath(dshHome))
    const scopeLink = join(profileModules, '@cyrus')
    const profileLinks = PERSONAL_PLUGINS.map(({ packageName }) => {
      const shortName = packageName.split('/')[1]
      return {
        packageName,
        link: join(scopeLink, shortName),
        target: join(generationDir, 'scope', '@cyrus', shortName),
      }
    })
    return { candidateId, fallbackId, generationDir, batch, links: profileLinks }
  } catch (error) {
    abortActivatingGeneration({
      externalRoot,
      pluginRoot,
      dshHome,
      reason: error instanceof Error ? error.message : String(error),
      candidateId,
      fallbackId,
    })
    throw error
  }
}

/**
 * Commit the currently activating generation after all boot/fiber/doctor
 * probes pass. Writes `current.json` atomically and promotes the previous
 * current generation to `previous.json`. If `fiberOk` is false or the doctor
 * fails, the activation is aborted and the fallback is restored.
 */
export function commitActivatingGeneration({ externalRoot, pluginRoot, dshHome = resolveHarnessHome(), fiberOk = true } = {}) {
  const activating = readActivating(externalRoot)
  if (activating === null) return null
  const candidateId = activating.candidateId
  const fallbackId = activating.fallbackId ?? null
  if (typeof candidateId !== 'string' || candidateId.length === 0) {
    abortActivatingGeneration({ externalRoot, pluginRoot, dshHome, reason: 'activating.json 缺 candidateId' })
    return null
  }
  if (!fiberOk) {
    abortActivatingGeneration({ externalRoot, pluginRoot, dshHome, reason: 'fiber doctor 未通过', candidateId, fallbackId })
    return null
  }
  const generationDir = join(externalRoot, 'generations', candidateId)
  const batchPath = join(generationDir, 'batch.json')
  if (!existsSync(batchPath)) {
    abortActivatingGeneration({ externalRoot, pluginRoot, dshHome, reason: 'activating generation 缺 batch.json', candidateId, fallbackId })
    return null
  }
  const batch = readJsonFile(batchPath)
  const doctor = verifyGenerationDoctor({ generationDir, batch, dshHome })
  if (!doctor.ok) {
    abortActivatingGeneration({ externalRoot, pluginRoot, dshHome, reason: `post-boot doctor 未通过: ${doctor.issues.join('; ')}`, candidateId, fallbackId })
    return null
  }
  const now = new Date().toISOString()
  if (fallbackId !== null && fallbackId !== candidateId) {
    atomicWriteJsonSync(join(externalRoot, 'previous.json'), { generationId: fallbackId, committedAt: now })
  } else {
    rmSync(join(externalRoot, 'previous.json'), { force: true })
  }
  atomicWriteJsonSync(join(externalRoot, 'current.json'), { generationId: candidateId, committedAt: now })
  rmSync(join(externalRoot, 'activating.json'), { force: true })
  rmSync(join(externalRoot, 'pending.json'), { force: true })
  return candidateId
}

/**
 * Abort an in-flight activation: restore the profile junction to the fallback
 * generation (or builtin when no fallback exists), quarantine the candidate,
 * and leave a diagnostic receipt.
 */
export function abortActivatingGeneration({ externalRoot, pluginRoot, dshHome = resolveHarnessHome(), reason = 'activation aborted', candidateId, fallbackId } = {}) {
  const activating = readActivating(externalRoot)
  const resolvedCandidate = candidateId ?? activating?.candidateId
  const resolvedFallback = fallbackId ?? activating?.fallbackId ?? null
  const profileModules = dirname(profileScopePath(dshHome))
  if (resolvedFallback !== null && resolvedFallback !== undefined) {
    const fallbackDir = join(externalRoot, 'generations', resolvedFallback)
    const fallbackScope = join(fallbackDir, 'scope', '@cyrus')
    if (existsSync(fallbackScope)) {
      ensureProfileScopeJunction(profileModules, fallbackScope)
    } else {
      removeProfileScopeJunction(profileModules)
    }
  } else {
    removeProfileScopeJunction(profileModules)
  }
  if (resolvedCandidate !== null && resolvedCandidate !== undefined) {
    quarantineCandidate(externalRoot, resolvedCandidate, reason, {
      fallbackId: resolvedFallback,
      startedAt: activating?.startedAt ?? null,
    })
    removePendingFor(externalRoot, resolvedCandidate)
  }
  rmSync(join(externalRoot, 'activating.json'), { force: true })
}

/**
 * Make the unpacked personal packages resolvable from Harness' web profile.
 * The profile manifest is deliberately untouched: activation remains owned by
 * the desktop-only overlay, while these junctions provide Node package lookup.
 *
 * A1: stable flavor prefers an external generation (userData/plugins-external)
 * and freezes the activation point to `<profile>/node_modules/@cyrus` as one
 * scope junction to `generations/<id>/scope/@cyrus`; dev flavor and any
 * invalid/missing external generation keep the built-in dev checkout links.
 */
export function ensurePersonalPluginLinks({
  dshHome = resolveHarnessHome(),
  pluginRoot = resolvePersonalPluginsRoot(),
  requireBuilt = true,
  env = process.env,
  userData,
} = {}) {
  const profileModules = join(dshHome, 'profiles', 'web', 'node_modules')
  const flavor = loadAppFlavor(env.DSH_DESKTOP_FLAVOR?.trim() || undefined).flavor
  const externalRoot = resolveExternalRoot({ env, userData })
  normalizeExternalState(externalRoot)

  if (flavor !== 'dev' && externalRoot !== null) {
    try {
      const activation = startPendingActivation({ externalRoot, pluginRoot, dshHome })
      if (activation !== null) return activation.links
    } catch (error) {
      console.error(`A1 pending activation skipped: ${error instanceof Error ? error.message : String(error)}`)
    }
    const generation = loadCurrentGeneration(externalRoot, {
      directoryByPackage: new Map(PERSONAL_PLUGINS.map(plugin => [plugin.packageName, plugin.directoryName])),
    })
    if (generation !== null) {
      const scopeLink = join(profileModules, '@cyrus')
      const scopeTarget = join(generation.generationDir, 'scope', '@cyrus')
      ensureProfileScopeJunction(profileModules, scopeTarget)
      const links = []
      for (const { packageName } of PERSONAL_PLUGINS) {
        const shortName = packageName.split('/')[1]
        const target = join(scopeTarget, shortName)
        if (!existsSync(target)) {
          throw new Error(`External generation scope is missing ${packageName}: ${target}`)
        }
        links.push({ packageName, link: join(scopeLink, shortName), target })
      }
      return links
    }
  }

  removeProfileScopeJunction(profileModules)
  const links = []
  for (const { packageName, directoryName } of PERSONAL_PLUGINS) {
    const target = join(pluginRoot, directoryName)
    validatePluginPackage(target, packageName, requireBuilt)
    const link = join(profileModules, ...packageName.split('/'))
    mkdirSync(dirname(link), { recursive: true })
    ensureJunction(link, target)
    links.push({ packageName, link, target })
  }
  return links
}

/**
 * A1 startup assembly: rebuild the generation-local scope view.
 * Each scope entry is a junction to either the external entity
 * (generations/<id>/packages/<directoryName>/<version>) or the current
 * client built-in plugin directory. This is called before activation, never
 * while Harness is running.
 */
export function assemblePersonalScopeView({ generationDir, batch, pluginRoot }) {
  const scopeRoot = join(generationDir, 'scope', '@cyrus')
  mkdirSync(scopeRoot, { recursive: true })
  const links = []
  for (const { packageName, directoryName } of PERSONAL_PLUGINS) {
    const info = batch?.packages?.[packageName]
    const shortName = packageName.split('/')[1]
    const link = join(scopeRoot, shortName)
    let target
    if (info?.source === 'external') {
      target = join(generationDir, 'packages', info.directoryName, info.version)
    } else {
      target = join(pluginRoot, directoryName)
    }
    if (!existsSync(target)) {
      throw new Error(`Scope target missing for ${packageName}: ${target}`)
    }
    ensureJunction(link, target)
    links.push({ packageName, link, target })
  }
  return links
}

/**
 * A1/A3 startup promotion: start the pending activation without committing.
 * The caller must call `commitActivatingGeneration` after Harness boot and
 * fiber/doctor probes pass. Kept as the named entry used by the local-fixture
 * E2E path; it now implements the full pending → activating journal.
 */
export function promotePendingGeneration(options) {
  const result = startPendingActivation(options)
  return result === null ? null : result.candidateId
}

function validatePluginPackage(directory, expectedName, requireBuilt) {
  const manifestPath = join(directory, 'package.json')
  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    throw new Error(`Personal plugin package is unavailable: ${manifestPath}`, { cause: error })
  }
  if (manifest?.name !== expectedName) {
    throw new Error(`Personal plugin at ${directory} declares ${JSON.stringify(manifest?.name)} instead of ${expectedName}.`)
  }
  if (!requireBuilt) return
  for (const artifact of ['lib/index.js', 'lib/client.js']) {
    const path = join(directory, ...artifact.split('/'))
    if (!existsSync(path)) throw new Error(`Personal plugin is not built: ${path}`)
  }
}

function ensureJunction(link, target) {
  const resolvedTarget = resolve(target)
  try {
    const stat = lstatSync(link)
    if (!stat.isSymbolicLink()) {
      throw new Error(`Refusing to replace non-link personal plugin path: ${link}`)
    }
    if (resolve(dirname(link), readlinkSync(link)) === resolvedTarget) return
    unlinkSync(link)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  symlinkSync(resolvedTarget, link, process.platform === 'win32' ? 'junction' : 'dir')
}
