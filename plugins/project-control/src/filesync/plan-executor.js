import { createHash } from 'node:crypto'
import {
  lstat, mkdir, open, readFile, readdir, rename, rm,
} from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'

import { canonicalJson } from '../host/canonical-json.js'

const RELATIVE_PATH = /^(?!\/)(?!.*[:\\])(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*[\u0000-\u001F\u007F])(?!.*\/\/)(?!.*\/$)[^/]+(?:\/[^/]+)*$/
const CONTENT_HASH = /^sha256:[0-9a-f]{64}$/
const LEGACY_MANIFEST_PATH = '.dsh-project/project.yaml'
const PROJECT_HOME_MANIFEST_PATH = 'workspace/.dsh-project/project.yaml'
const PROJECT_HOME_MARKER_PATH = '.project-home/project-home.json'
const PROJECT_HOME_TOP_LEVEL = new Set(['.project-home', 'workspace', 'worktrees', 'local'])
const STAGING_PREFIX = '.dsh-staging.'

export class FileSyncPlanError extends Error {
  constructor(code, message, details) {
    super(message)
    this.name = 'FileSyncPlanError'
    this.code = code
    if (details !== undefined) this.details = details
  }
}

function fail(code, message, details) {
  throw new FileSyncPlanError(code, message, details)
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

function windowsKey(path) {
  return resolve(path).replaceAll('/', '\\').replace(/[\\]+$/, '').toLocaleLowerCase('en-US')
}

export function pathIsWithin(rootPath, candidatePath) {
  const rootKey = windowsKey(rootPath)
  const candidateKey = windowsKey(candidatePath)
  const prefix = rootKey.endsWith('\\') ? rootKey : `${rootKey}\\`
  return candidateKey === rootKey || candidateKey.startsWith(prefix)
}

export function isStagingDirectoryName(name) {
  return name.startsWith(STAGING_PREFIX)
}

/** Canonical staging location: sibling of the target for whole-tree creates,
 * inside the authorized root for additive syncs. Both stay on the same volume. */
export function stagingRootForPlan(plan, targetRoot) {
  if (plan.syncPolicy === 'atomic_create') {
    return join(dirname(resolve(targetRoot)), `${STAGING_PREFIX}${plan.planId}`)
  }
  return join(resolve(targetRoot), `${STAGING_PREFIX}${plan.planId}`)
}

/** Host domain rules on top of the lifecycle schema. Returns the canonical
 * execution order: directories in ascending path order, then files. */
export function validateWritePlanDomain(plan) {
  if (!plan || typeof plan !== 'object') fail('WRITE_PLAN_STALE', 'The write plan is missing.')
  if (!['atomic_create', 'atomic_additive'].includes(plan.syncPolicy)) {
    fail('WRITE_PLAN_STALE', 'The write plan sync policy is unsupported.')
  }
  if (!CONTENT_HASH.test(String(plan.manifestHash ?? ''))) {
    fail('WRITE_PLAN_STALE', 'The write plan manifest hash uses an unsupported format.')
  }
  if (!Array.isArray(plan.operations) || plan.operations.length < 1 || plan.operations.length > 500) {
    fail('WRITE_PLAN_STALE', 'The write plan must carry 1..500 operations.')
  }
  const byPath = new Map()
  const directories = []
  const files = []
  for (const raw of plan.operations) {
    const operation = raw && typeof raw === 'object' ? raw : {}
    const kind = operation.kind
    const relativePath = String(operation.relativePath ?? '')
    if (!['create_directory', 'create_file'].includes(kind)) {
      fail('WRITE_PLAN_STALE', 'The write plan contains an unsupported operation.')
    }
    if (!RELATIVE_PATH.test(relativePath)) {
      fail('PATH_OUTSIDE_WORKSPACE', 'A write plan path is not a safe project-relative path.', { relativePath })
    }
    if (operation.expectedState !== 'absent') {
      fail('WRITE_PLAN_STALE', 'Write plans may only create absent paths.', { relativePath })
    }
    if (byPath.has(relativePath)) {
      fail('WRITE_PLAN_STALE', 'The write plan repeats a relative path.', { relativePath })
    }
    const contentHash = operation.contentHash ?? null
    if (kind === 'create_file') {
      if (typeof contentHash !== 'string' || !CONTENT_HASH.test(contentHash)) {
        fail('WRITE_PLAN_STALE', 'A write plan file operation lacks a valid content hash.', { relativePath })
      }
      files.push({ kind, relativePath, contentHash })
    } else {
      if (contentHash !== null && contentHash !== undefined) {
        fail('WRITE_PLAN_STALE', 'A directory operation cannot carry a content hash.', { relativePath })
      }
      directories.push({ kind, relativePath, contentHash: null })
    }
    byPath.set(relativePath, kind)
  }
  const requiredDirectories = new Set()
  for (const file of files) {
    const segments = file.relativePath.split('/')
    for (let length = 1; length < segments.length; length += 1) {
      requiredDirectories.add(segments.slice(0, length).join('/'))
    }
  }
  // Every declared directory must be an ancestor some file needs. Ancestors that
  // already exist on disk are verified at execution time and must not be declared
  // as create_directory operations (their presence would fail the absent check).
  for (const directory of directories) {
    if (!requiredDirectories.has(directory.relativePath)) {
      fail('WRITE_PLAN_STALE', 'The write plan declares a directory no file needs.', { relativePath: directory.relativePath })
    }
  }
  const markerEntries = files.filter(operation => operation.relativePath === PROJECT_HOME_MARKER_PATH)
  const isProjectHome = markerEntries.length > 0
  if (markerEntries.length > 1) {
    fail('MANIFEST_INVALID', 'The write plan repeats the Project Home marker.')
  }
  if (isProjectHome) {
    if (plan.syncPolicy !== 'atomic_create') {
      fail('MANIFEST_INVALID', 'Project Home plans must create the whole Home atomically.')
    }
    if (files.some(operation => operation.relativePath === LEGACY_MANIFEST_PATH)) {
      fail('MANIFEST_INVALID', 'A Project Home plan cannot also create a legacy root manifest.')
    }
    for (const operation of [...directories, ...files]) {
      if (!PROJECT_HOME_TOP_LEVEL.has(operation.relativePath.split('/')[0])) {
        fail('PATH_OUTSIDE_WORKSPACE', 'A Project Home plan writes outside the fixed zones.', {
          relativePath: operation.relativePath,
        })
      }
    }
    for (const zone of PROJECT_HOME_TOP_LEVEL) {
      if (!directories.some(operation => operation.relativePath === zone)) {
        fail('MANIFEST_INVALID', 'A Project Home plan is missing a fixed zone.', { zone })
      }
    }
  } else if (files.some(operation => operation.relativePath === PROJECT_HOME_MANIFEST_PATH)) {
    fail('MANIFEST_INVALID', 'A workspace manifest under Project Home requires its Host marker.')
  }
  const manifestPath = isProjectHome ? PROJECT_HOME_MANIFEST_PATH : LEGACY_MANIFEST_PATH
  const manifestEntries = files.filter(operation => operation.relativePath === manifestPath)
  if (manifestEntries.length !== 1) {
    fail('MANIFEST_INVALID', `The write plan must create exactly one ${manifestPath} file.`)
  }
  if (manifestEntries[0].contentHash !== plan.manifestHash) {
    fail('MANIFEST_INVALID', 'The manifest hash does not match the project.yaml operation.')
  }
  const canonical = [
    ...directories.sort((a, b) => (a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0)),
    ...files.sort((a, b) => (a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0)),
  ]
  return Object.freeze(canonical)
}

export function computePlanHash(plan) {
  const operations = validateWritePlanDomain(plan).map(operation => ({
    kind: operation.kind,
    relativePath: operation.relativePath,
    ...(operation.kind === 'create_file' ? { contentHash: operation.contentHash } : {}),
  }))
  const digest = createHash('sha256').update(canonicalJson({
    manifestHash: plan.manifestHash,
    syncPolicy: plan.syncPolicy,
    operations,
  }), 'utf8').digest('hex')
  return `sha256:${digest}`
}

/** The Host re-computes the plan hash and never trusts the self-reported value. */
export function verifyWritePlanHashes(plan) {
  if (!CONTENT_HASH.test(String(plan.planHash ?? ''))) {
    fail('WRITE_PLAN_STALE', 'The write plan hash uses an unsupported format.')
  }
  const expected = computePlanHash(plan)
  if (expected !== plan.planHash) {
    fail('WRITE_PLAN_STALE', 'The write plan hash does not match its contents.')
  }
  return true
}

function topLevelOperations(canonical) {
  return canonical.filter((operation) => {
    const segments = operation.relativePath.split('/')
    for (let length = 1; length < segments.length; length += 1) {
      if (canonical.some(candidate => candidate.relativePath === segments.slice(0, length).join('/'))) {
        return false
      }
    }
    return true
  })
}

async function requireAbsent(displayPath, code, details) {
  try {
    const info = await lstat(displayPath)
    fail(code, `The target path already exists: ${displayPath}`, { ...details, occupied: true, entryKind: info.isDirectory() ? 'directory' : info.isSymbolicLink() ? 'link' : 'file' })
  } catch (error) {
    if (error?.code === 'ENOENT') return
    if (error instanceof FileSyncPlanError) throw error
    fail(code, `The target path cannot be checked: ${displayPath}`, { ...details, causeCode: error?.code ?? 'UNKNOWN' })
  }
}

async function writeStagedFile(stagingRoot, relativePath, content, expectedHash) {
  if (!Buffer.isBuffer(content)) content = Buffer.from(String(content), 'utf8')
  if (sha256(content) !== expectedHash) {
    fail('FILE_SYNC_FAILED', 'Staged content does not match the write plan hash.', { relativePath })
  }
  const stagedPath = join(stagingRoot, ...relativePath.split('/'))
  let handle
  try {
    handle = await open(stagedPath, 'wx')
    await handle.writeFile(content)
    await handle.sync()
  } catch (error) {
    fail('FILE_SYNC_FAILED', 'A staged file could not be written.', { relativePath, causeCode: error?.code ?? 'UNKNOWN' })
  } finally {
    try {
      await handle?.close()
    } catch {}
  }
}

async function syncDirectoryBestEffort(displayPath) {
  try {
    const handle = await open(displayPath, 'r')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  } catch {
    // Windows does not guarantee directory fsync; file fsync above is authoritative.
  }
}

export async function stagePlan(options) {
  const { plan, canonical, targetRoot, stagingRoot, authorizedRoot, contents } = options
  if (!isAbsolute(targetRoot) || !isAbsolute(stagingRoot) || !isAbsolute(authorizedRoot)) {
    fail('PATH_OUTSIDE_WORKSPACE', 'File sync paths must be absolute local paths.')
  }
  if (pathIsWithin(authorizedRoot, targetRoot) === false) {
    fail('PATH_OUTSIDE_WORKSPACE', 'The target root escapes the authorized root.')
  }
  if (pathIsWithin(authorizedRoot, stagingRoot) === false || !pathIsWithin(dirname(resolve(targetRoot)), stagingRoot) && pathIsWithin(resolve(targetRoot), stagingRoot) === false) {
    fail('PATH_OUTSIDE_WORKSPACE', 'The staging directory is not inside an authorized same-volume location.')
  }
  const rootInfo = await (async () => {
    try {
      return await lstat(targetRoot)
    } catch (error) {
      if (error?.code === 'ENOENT') return null
      throw error
    }
  })()
  let rootPreexistedEmpty = false
  if (plan.syncPolicy === 'atomic_create') {
    if (rootInfo !== null && (!rootInfo.isDirectory() || rootInfo.isSymbolicLink())) {
      fail('TARGET_NOT_EMPTY', 'The new project target is occupied by a non-directory entry.')
    }
    if (rootInfo !== null) {
      const entries = await readdir(targetRoot)
      if (entries.length > 0) fail('TARGET_NOT_EMPTY', 'The new project target directory is not empty.')
      rootPreexistedEmpty = true
    }
  } else {
    if (rootInfo === null || !rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
      fail('WRITE_PLAN_STALE', 'The project root for an additive sync no longer exists.')
    }
    for (const file of canonical.filter(operation => operation.kind === 'create_file')) {
      const segments = file.relativePath.split('/')
      for (let length = 1; length < segments.length; length += 1) {
        const ancestor = segments.slice(0, length).join('/')
        const declared = canonical.some(operation => operation.kind === 'create_directory' && operation.relativePath === ancestor)
        if (declared) continue
        const info = await (async () => {
          try {
            return await lstat(join(targetRoot, ...ancestor.split('/')))
          } catch (error) {
            if (error?.code === 'ENOENT') return null
            throw error
          }
        })()
        if (info === null || !info.isDirectory() || info.isSymbolicLink()) {
          fail('WRITE_PLAN_STALE', 'A file ancestor is neither declared nor present on disk.', { relativePath: ancestor })
        }
      }
    }
  }
  if (plan.syncPolicy === 'atomic_create') {
    for (const file of canonical.filter(operation => operation.kind === 'create_file')) {
      const segments = file.relativePath.split('/')
      for (let length = 1; length < segments.length; length += 1) {
        const ancestor = segments.slice(0, length).join('/')
        const declared = canonical.some(operation => operation.kind === 'create_directory' && operation.relativePath === ancestor)
        if (!declared) {
          fail('WRITE_PLAN_STALE', 'A file ancestor is missing from the write plan.', { relativePath: ancestor })
        }
      }
    }
  }
  for (const operation of canonical) {
    await requireAbsent(join(targetRoot, ...operation.relativePath.split('/')), 'WRITE_PLAN_STALE', { relativePath: operation.relativePath })
  }
  await requireAbsent(stagingRoot, 'FILE_SYNC_FAILED', { reason: 'staging_leftover' })
  await mkdir(stagingRoot)
  await syncDirectoryBestEffort(dirname(stagingRoot))
  for (const operation of canonical) {
    const stagedPath = join(stagingRoot, ...operation.relativePath.split('/'))
    if (operation.kind === 'create_directory') {
      await mkdir(stagedPath)
    } else {
      const content = contents.get(operation.relativePath)
      if (content === undefined) {
        fail('FILE_SYNC_FAILED', 'The renderer did not provide staged content.', { relativePath: operation.relativePath })
      }
      // Pre-existing ancestors are mirrored as empty passthrough directories so
      // the staged file can be written; only declared operations are renamed back.
      await mkdir(dirname(stagedPath), { recursive: true })
      await writeStagedFile(stagingRoot, operation.relativePath, content, operation.contentHash)
    }
  }
  for (const operation of canonical) {
    await syncDirectoryBestEffort(join(stagingRoot, ...operation.relativePath.split('/')))
  }
  return Object.freeze({ rootPreexistedEmpty, stagedPaths: canonical.map(operation => operation.relativePath) })
}

export async function commitPlan(options) {
  const { plan, canonical, targetRoot, stagingRoot, rootPreexistedEmpty } = options
  if (plan.syncPolicy === 'atomic_create' && !rootPreexistedEmpty) {
    await requireAbsent(targetRoot, 'TARGET_NOT_EMPTY', { reason: 'target_appeared' })
    try {
      await rename(stagingRoot, targetRoot)
    } catch (error) {
      if (error?.code === 'EEXIST' || error?.code === 'ENOTEMPTY' || error?.code === 'EPERM') {
        fail('TARGET_NOT_EMPTY', 'The new project target appeared during commit.', { causeCode: error.code })
      }
      throw error
    }
  } else {
    const renamed = []
    try {
      for (const operation of topLevelOperations(canonical)) {
        await requireAbsent(join(targetRoot, ...operation.relativePath.split('/')), 'WRITE_PLAN_STALE', { relativePath: operation.relativePath })
        await rename(
          join(stagingRoot, ...operation.relativePath.split('/')),
          join(targetRoot, ...operation.relativePath.split('/')),
        )
        renamed.push(operation.relativePath)
      }
    } catch (error) {
      fail('WRITE_PLAN_STALE', 'A write plan target appeared during commit.', {
        renamed,
        causeCode: error?.code ?? 'UNKNOWN',
      })
    }
    try {
      // Only empty passthrough directories remain after the renames.
      await rm(stagingRoot, { recursive: true, force: false })
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
  return Object.freeze({ createdPaths: canonical.map(operation => operation.relativePath) })
}

export async function verifyCommittedPlan(options) {
  const { plan, canonical, targetRoot } = options
  const mismatches = []
  for (const operation of canonical) {
    if (operation.kind !== 'create_file') continue
    const finalPath = join(targetRoot, ...operation.relativePath.split('/'))
    let bytes
    try {
      bytes = await readFile(finalPath)
    } catch (error) {
      mismatches.push({ relativePath: operation.relativePath, reason: 'missing', causeCode: error?.code ?? 'UNKNOWN' })
      continue
    }
    const observed = sha256(bytes)
    if (observed !== operation.contentHash) {
      mismatches.push({ relativePath: operation.relativePath, reason: 'hash_mismatch' })
    }
  }
  return Object.freeze({ ok: mismatches.length === 0, mismatches })
}

export async function rollbackCreated(options) {
  const { plan, canonical, targetRoot, stagingRoot, createdPaths, removeTargetRoot } = options
  const failures = []
  const remove = async (displayPath) => {
    try {
      await rm(displayPath, { recursive: true, force: false })
    } catch (error) {
      if (error?.code !== 'ENOENT') failures.push({ displayPath, causeCode: error?.code ?? 'UNKNOWN' })
    }
  }
  const staged = canonical.filter(operation => createdPaths.includes(operation.relativePath))
  const reversed = [...staged].sort((a, b) => {
    const depthA = a.relativePath.split('/').length
    const depthB = b.relativePath.split('/').length
    if (depthA !== depthB) return depthB - depthA
    const kindA = a.kind === 'create_file' ? 0 : 1
    const kindB = b.kind === 'create_file' ? 0 : 1
    if (kindA !== kindB) return kindA - kindB
    return a.relativePath < b.relativePath ? 1 : a.relativePath > b.relativePath ? -1 : 0
  })
  for (const operation of reversed) {
    await remove(join(targetRoot, ...operation.relativePath.split('/')))
  }
  if (removeTargetRoot === true) {
    await remove(targetRoot)
  }
  await remove(stagingRoot)
  return Object.freeze({ complete: failures.length === 0, failures })
}

/** Startup recovery for one journaled plan. */
export async function recoverPlan(options) {
  const { plan, canonical, targetRoot, stagingRoot, journal } = options
  if (plan.state === 'staging' || plan.state === 'staged') {
    if (basename(stagingRoot) !== `${STAGING_PREFIX}${plan.planId}`) {
      fail('FILE_SYNC_FAILED', 'The staging directory name does not belong to this plan.', { stagingRoot })
    }
    try {
      await rm(stagingRoot, { recursive: true, force: false })
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        fail('FILE_SYNC_FAILED', 'A staging residue could not be removed during recovery.', { causeCode: error?.code ?? 'UNKNOWN' })
      }
    }
    await journal.transition(plan.state, 'rolled_back', { createdPaths: [], errorCode: 'CRASH_RECOVERED' })
    return Object.freeze({ outcome: 'rolled_back' })
  }
  if (plan.state === 'files_committed') {
    const verification = await verifyCommittedPlan({ plan, canonical, targetRoot })
    if (verification.ok) {
      return Object.freeze({ outcome: 'resumable' })
    }
    await journal.transition(plan.state, 'recovery_required', { createdPaths: plan.createdPaths, errorCode: 'FILE_SYNC_VERIFY_FAILED' })
    return Object.freeze({ outcome: 'quarantined', mismatches: verification.mismatches })
  }
  fail('FILE_SYNC_FAILED', 'The plan is not in a recoverable state.', { state: plan.state })
}

/** End-to-end executor: stage -> commit -> verify, with journal transitions and rollback. */
export async function executeFileSyncPlan(options) {
  const { plan, targetRoot, stagingRoot, authorizedRoot, contents, journal } = options
  const canonical = validateWritePlanDomain(plan)
  const stage = async () => stagePlan({ plan, canonical, targetRoot, stagingRoot, authorizedRoot, contents })
  if (plan.state !== 'planned' && plan.state !== 'rolled_back') {
    fail('FILE_SYNC_FAILED', 'The plan is not in an executable state.', { state: plan.state })
  }
  await journal.transition(plan.state, 'staging', {})
  let staged = null
  try {
    staged = await stage()
    await journal.transition('staging', 'staged', {})
    const commit = await commitPlan({ plan, canonical, targetRoot, stagingRoot, rootPreexistedEmpty: staged.rootPreexistedEmpty })
    const verification = await verifyCommittedPlan({ plan, canonical, targetRoot })
    if (!verification.ok) {
      const rollback = await rollbackCreated({ plan, canonical, targetRoot, stagingRoot, createdPaths: commit.createdPaths, removeTargetRoot: !staged.rootPreexistedEmpty })
      await journal.transition('staged', rollback.complete ? 'rolled_back' : 'recovery_required', { createdPaths: [], errorCode: 'FILE_SYNC_VERIFY_FAILED' })
      fail('FILE_SYNC_FAILED', 'Committed files failed the write plan re-verification.', { verification })
    }
    await journal.transition('staged', 'files_committed', { createdPaths: commit.createdPaths })
    return Object.freeze({ createdPaths: commit.createdPaths, rootPreexistedEmpty: staged.rootPreexistedEmpty })
  } catch (error) {
    if (journal) {
      const currentState = staged === null ? 'staging' : 'staged'
      // Only delete what this attempt actually renamed; commitPlan reports it on failure.
      const renamed = Array.isArray(error?.details?.renamed) ? error.details.renamed : []
      try {
        const rollback = await rollbackCreated({ plan, canonical, targetRoot, stagingRoot, createdPaths: renamed, removeTargetRoot: false })
        await journal.transition(currentState, rollback.complete ? 'rolled_back' : 'recovery_required', {
          createdPaths: [],
          errorCode: error instanceof FileSyncPlanError ? error.code : 'FILE_SYNC_FAILED',
        })
      } catch {
        try {
          await journal.transition(currentState, 'recovery_required', {
            createdPaths: renamed,
            errorCode: 'ROLLBACK_INCOMPLETE',
          })
        } catch {}
      }
    }
    throw error
  }
}
