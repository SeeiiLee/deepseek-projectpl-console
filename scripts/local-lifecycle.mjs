import { createHash } from 'node:crypto'
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statfsSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import { hashTree } from './build-receipt.mjs'

const GIB = 1024 * 1024 * 1024
const VALID_STATUSES = new Set(['ACTIVE', 'QUARANTINED', 'RETIRED', 'DELETABLE', 'PINNED'])
const VALID_RETENTION_CLASSES = new Set(['successful-run', 'failed-run', 'interrupted-run', 'package-set'])
const OPERATION_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,95}$/iu
const OBJECT_ID_PATTERN = /^(?:run|pkg)_[a-z0-9][a-z0-9._-]{0,160}$/iu
const SOURCE_HASH_PATTERN = /^[a-f0-9]{64}$/u

export const DEFAULT_RETENTION_POLICY = Object.freeze({
  schemaVersion: 'local-retention-policy/v1',
  policyId: 'recommended-v1',
  schedule: Object.freeze({ intervalHours: 24, overdueGraceHours: 12 }),
  disk: Object.freeze({ minimumFreeBytes: 5 * GIB }),
  quota: Object.freeze({ maximumRegisteredBytes: 20 * GIB }),
  retention: Object.freeze({
    'successful-run': Object.freeze({ keepRecent: 2, minimumAgeHours: 7 * 24, requireIssueClosed: false }),
    'failed-run': Object.freeze({ keepRecent: 3, minimumAgeHours: 14 * 24, requireIssueClosed: true }),
    'interrupted-run': Object.freeze({ keepRecent: 0, minimumAgeHours: 72, requireIssueClosed: false }),
    'package-set': Object.freeze({ keepRecent: 2, minimumAgeHours: 7 * 24, requireIssueClosed: false }),
  }),
})

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function sha256Bytes(value) {
  return createHash('sha256').update(value).digest('hex')
}

function sha256File(path) {
  return sha256Bytes(readFileSync(path))
}

function hashJson(value) {
  return sha256Bytes(JSON.stringify(value))
}

function assertIsoTimestamp(value, field) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${field} must be an ISO timestamp.`)
  }
}

function assertProjectId(value) {
  if (typeof value !== 'string' || !/^prj_[0-9a-z-]{20,80}$/iu.test(value)) {
    throw new Error('projectId is invalid.')
  }
}

function assertOperationId(value) {
  if (typeof value !== 'string' || !OPERATION_ID_PATTERN.test(value)) {
    throw new Error('Lifecycle operationId is invalid.')
  }
}

function lifecycleError(code, message) {
  const error = new Error(`${code}: ${message}`)
  error.code = code
  return error
}

function assertSourceReceiptHash(value) {
  if (typeof value !== 'string' || !SOURCE_HASH_PATTERN.test(value)) {
    throw lifecycleError('PACKAGE_SET_SOURCE_HASH_INVALID', 'sourceReceiptHash must be 64 lowercase hexadecimal characters.')
  }
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value))
}

export function resolveLocalLifecyclePaths(projectRoot) {
  const workspace = resolve(projectRoot)
  if (basename(workspace).toLowerCase() !== 'workspace') {
    throw new Error(`Local lifecycle requires a Project Home workspace path: ${workspace}`)
  }
  const projectHome = resolve(workspace, '..')
  const localRoot = join(projectHome, 'local')
  const ledgersRoot = join(localRoot, 'ledgers')
  const receiptsRoot = join(localRoot, 'receipts')
  return {
    projectHome,
    workspace,
    localRoot,
    markerPath: join(projectHome, '.project-home', 'project-home.json'),
    ledgersRoot,
    receiptsRoot,
    registryDir: join(ledgersRoot, 'local-object-registry'),
    policyPath: join(ledgersRoot, 'retention-policy.json'),
    healthDir: join(ledgersRoot, 'lifecycle-health'),
    packageSetTasksRoot: join(ledgersRoot, 'package-set-tasks'),
    lockPath: join(ledgersRoot, 'local-lifecycle.lock'),
    packageSetsRoot: join(localRoot, 'package-sets'),
    runsRoot: join(localRoot, 'runs'),
  }
}

function assertProjectHome({ projectRoot, projectId }) {
  assertProjectId(projectId)
  const paths = resolveLocalLifecyclePaths(projectRoot)
  if (!existsSync(paths.markerPath)) throw new Error(`Project Home marker is missing: ${paths.markerPath}`)
  const marker = readJson(paths.markerPath)
  if (marker.schemaVersion !== 'project-home/v1' || marker.projectId !== projectId) {
    throw new Error(`Project Home project identity mismatch: marker=${String(marker.projectId)} requested=${projectId}`)
  }
  if (marker.zones?.workspace !== 'workspace' || marker.zones?.worktrees !== 'worktrees' || marker.zones?.local !== 'local') {
    throw new Error('Project Home zones do not match the fixed three-zone contract.')
  }
  mkdirSync(paths.ledgersRoot, { recursive: true })
  mkdirSync(paths.receiptsRoot, { recursive: true })
  mkdirSync(paths.packageSetsRoot, { recursive: true })
  mkdirSync(paths.runsRoot, { recursive: true })
  return { marker, paths }
}

function withLifecycleLock(paths, callback) {
  mkdirSync(paths.ledgersRoot, { recursive: true })
  let handle
  try {
    handle = openSync(paths.lockPath, 'wx')
  } catch {
    throw new Error(`Local lifecycle writer lock is already held: ${paths.lockPath}`)
  }
  try {
    return callback()
  } finally {
    closeSync(handle)
    unlinkSync(paths.lockPath)
  }
}

function readLatestSnapshot(directory) {
  if (!existsSync(directory)) return null
  const names = readdirSync(directory)
    .filter(name => /^\d{12}\.json$/u.test(name))
    .sort()
  return names.length === 0 ? null : readJson(join(directory, names.at(-1)))
}

function writeSnapshot(directory, value, revision) {
  mkdirSync(directory, { recursive: true })
  const path = join(directory, `${String(revision).padStart(12, '0')}.json`)
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  return path
}

function emptyRegistry(projectId) {
  return {
    schemaVersion: 'local-object-registry/v1',
    projectId,
    revision: 0,
    updatedAt: null,
    objects: [],
  }
}

export function readLocalRegistry({ projectRoot, projectId }) {
  const { paths } = assertProjectHome({ projectRoot, projectId })
  const registry = readLatestSnapshot(paths.registryDir) ?? emptyRegistry(projectId)
  if (registry.schemaVersion !== 'local-object-registry/v1' || registry.projectId !== projectId) {
    throw new Error('Local object registry identity or schema mismatch.')
  }
  return registry
}

function assertPackageSetTaskClaim(claim, { projectId, logicalTaskId }) {
  if (claim?.schemaVersion !== 'package-set-build-task/v1' || claim.projectId !== projectId || claim.logicalTaskId !== logicalTaskId) {
    throw lifecycleError('PACKAGE_SET_TASK_CLAIM_INVALID', `claim identity mismatch for ${logicalTaskId}.`)
  }
  assertSourceReceiptHash(claim.sourceReceiptHash)
  if (!Number.isSafeInteger(claim.revision) || claim.revision < 1 || !['claimed', 'completed', 'failed'].includes(claim.status)) {
    throw lifecycleError('PACKAGE_SET_TASK_CLAIM_INVALID', `claim state is invalid for ${logicalTaskId}.`)
  }
  return claim
}

export function readPackageSetBuildTask({ projectRoot, projectId, logicalTaskId }) {
  const { paths } = assertProjectHome({ projectRoot, projectId })
  assertOperationId(logicalTaskId)
  const claim = readLatestSnapshot(join(paths.packageSetTasksRoot, logicalTaskId))
  return claim === null ? null : assertPackageSetTaskClaim(claim, { projectId, logicalTaskId })
}

export function claimPackageSetBuildTask({
  projectRoot,
  projectId,
  logicalTaskId,
  sourceReceiptHash,
  now = new Date().toISOString(),
}) {
  const { paths } = assertProjectHome({ projectRoot, projectId })
  assertOperationId(logicalTaskId)
  assertSourceReceiptHash(sourceReceiptHash)
  assertIsoTimestamp(now, 'now')
  return withLifecycleLock(paths, () => {
    const taskDir = join(paths.packageSetTasksRoot, logicalTaskId)
    const existing = readLatestSnapshot(taskDir)
    if (existing !== null) {
      const claim = assertPackageSetTaskClaim(existing, { projectId, logicalTaskId })
      if (claim.sourceReceiptHash !== sourceReceiptHash) {
        throw lifecycleError('PACKAGE_SET_TASK_SOURCE_CHANGED', `logical task ${logicalTaskId} already claimed source ${claim.sourceReceiptHash}; start an explicitly registered new task.`)
      }
      throw lifecycleError('PACKAGE_SET_TASK_ALREADY_CLAIMED', `logical task ${logicalTaskId} already consumed its one physical package-set build attempt.`)
    }
    const registry = readLatestSnapshot(paths.registryDir) ?? emptyRegistry(projectId)
    const existingPhysical = registry.objects.filter(item => item.kind === 'package-set' && item.taskId === logicalTaskId)
    if (existingPhysical.length > 0) {
      throw lifecycleError('PACKAGE_SET_TASK_ALREADY_HAS_PHYSICAL_SET', `logical task ${logicalTaskId} is already recorded on ${existingPhysical.length} physical package set(s).`)
    }
    const claim = {
      schemaVersion: 'package-set-build-task/v1',
      projectId,
      logicalTaskId,
      sourceReceiptHash,
      revision: 1,
      status: 'claimed',
      claimedAt: now,
      maximumPhysicalPackageSets: 1,
    }
    claim.path = writeSnapshot(taskDir, claim, claim.revision)
    return { claim, reused: false }
  })
}

export function completePackageSetBuildTask({
  projectRoot,
  projectId,
  logicalTaskId,
  sourceReceiptHash,
  packageSetTreeHash,
  physicalCreated,
  now = new Date().toISOString(),
}) {
  const { paths } = assertProjectHome({ projectRoot, projectId })
  assertOperationId(logicalTaskId)
  assertSourceReceiptHash(sourceReceiptHash)
  assertSourceReceiptHash(packageSetTreeHash)
  assertIsoTimestamp(now, 'now')
  if (typeof physicalCreated !== 'boolean') throw lifecycleError('PACKAGE_SET_TASK_COMPLETION_INVALID', 'physicalCreated must be boolean.')
  return withLifecycleLock(paths, () => {
    const taskDir = join(paths.packageSetTasksRoot, logicalTaskId)
    const current = readLatestSnapshot(taskDir)
    if (current === null) throw lifecycleError('PACKAGE_SET_TASK_CLAIM_MISSING', `logical task ${logicalTaskId} has no build claim.`)
    const claim = assertPackageSetTaskClaim(current, { projectId, logicalTaskId })
    if (claim.sourceReceiptHash !== sourceReceiptHash) throw lifecycleError('PACKAGE_SET_TASK_SOURCE_CHANGED', `logical task ${logicalTaskId} completion source does not match its claim.`)
    if (claim.status === 'completed') {
      if (claim.packageSetTreeHash !== packageSetTreeHash || claim.physicalCreated !== physicalCreated) {
        throw lifecycleError('PACKAGE_SET_TASK_COMPLETION_CONFLICT', `logical task ${logicalTaskId} already completed with different evidence.`)
      }
      return { claim, replayed: true }
    }
    if (claim.status !== 'claimed') throw lifecycleError('PACKAGE_SET_TASK_NOT_COMPLETABLE', `logical task ${logicalTaskId} is ${claim.status}.`)
    const next = {
      ...claim,
      revision: claim.revision + 1,
      status: 'completed',
      completedAt: now,
      packageSetTreeHash,
      physicalCreated,
    }
    next.path = writeSnapshot(taskDir, next, next.revision)
    return { claim: next, replayed: false }
  })
}

export function failPackageSetBuildTask({
  projectRoot,
  projectId,
  logicalTaskId,
  sourceReceiptHash,
  failureCode,
  now = new Date().toISOString(),
}) {
  const { paths } = assertProjectHome({ projectRoot, projectId })
  assertOperationId(logicalTaskId)
  assertSourceReceiptHash(sourceReceiptHash)
  assertIsoTimestamp(now, 'now')
  if (typeof failureCode !== 'string' || failureCode.length === 0 || failureCode.length > 120) {
    throw lifecycleError('PACKAGE_SET_TASK_FAILURE_INVALID', 'failureCode is required and bounded.')
  }
  return withLifecycleLock(paths, () => {
    const taskDir = join(paths.packageSetTasksRoot, logicalTaskId)
    const current = readLatestSnapshot(taskDir)
    if (current === null) throw lifecycleError('PACKAGE_SET_TASK_CLAIM_MISSING', `logical task ${logicalTaskId} has no build claim.`)
    const claim = assertPackageSetTaskClaim(current, { projectId, logicalTaskId })
    if (claim.sourceReceiptHash !== sourceReceiptHash) throw lifecycleError('PACKAGE_SET_TASK_SOURCE_CHANGED', `logical task ${logicalTaskId} failure source does not match its claim.`)
    if (claim.status === 'failed') return { claim, replayed: true }
    if (claim.status !== 'claimed') throw lifecycleError('PACKAGE_SET_TASK_NOT_FAILABLE', `logical task ${logicalTaskId} is ${claim.status}.`)
    const next = {
      ...claim,
      revision: claim.revision + 1,
      status: 'failed',
      failedAt: now,
      failureCode,
    }
    next.path = writeSnapshot(taskDir, next, next.revision)
    return { claim: next, replayed: false }
  })
}

function writeRegistry(paths, registry, objects, updatedAt = new Date().toISOString()) {
  const next = {
    schemaVersion: 'local-object-registry/v1',
    projectId: registry.projectId,
    revision: registry.revision + 1,
    updatedAt,
    objects: [...objects].sort((left, right) => left.objectId.localeCompare(right.objectId)),
  }
  next.path = writeSnapshot(paths.registryDir, next, next.revision)
  return next
}

function assertPolicy(policy) {
  if (policy?.schemaVersion !== 'local-retention-policy/v1' || typeof policy.policyId !== 'string') {
    throw new Error('Retention policy schema or policyId is invalid.')
  }
  for (const field of ['intervalHours', 'overdueGraceHours']) {
    if (!Number.isFinite(policy.schedule?.[field]) || policy.schedule[field] < 0) throw new Error(`Retention policy schedule.${field} is invalid.`)
  }
  if (!Number.isSafeInteger(policy.disk?.minimumFreeBytes) || policy.disk.minimumFreeBytes < 0) {
    throw new Error('Retention policy disk.minimumFreeBytes is invalid.')
  }
  if (!Number.isSafeInteger(policy.quota?.maximumRegisteredBytes) || policy.quota.maximumRegisteredBytes < 0) {
    throw new Error('Retention policy quota.maximumRegisteredBytes is invalid.')
  }
  for (const retentionClass of VALID_RETENTION_CLASSES) {
    const rule = policy.retention?.[retentionClass]
    if (!Number.isSafeInteger(rule?.keepRecent) || rule.keepRecent < 0 || !Number.isFinite(rule.minimumAgeHours) || rule.minimumAgeHours < 0 || typeof rule.requireIssueClosed !== 'boolean') {
      throw new Error(`Retention policy rule is invalid: ${retentionClass}`)
    }
  }
}

export function installRetentionPolicy({ projectRoot, projectId, policy = DEFAULT_RETENTION_POLICY }) {
  const { paths } = assertProjectHome({ projectRoot, projectId })
  assertPolicy(policy)
  const value = { ...cloneJson(policy), projectId, installedAt: new Date().toISOString() }
  if (existsSync(paths.policyPath)) {
    const existing = readJson(paths.policyPath)
    const existingComparable = { ...existing }
    const valueComparable = { ...value }
    delete existingComparable.installedAt
    delete valueComparable.installedAt
    if (hashJson(existingComparable) !== hashJson(valueComparable)) {
      throw new Error('Retention policy is already installed with different bytes; publish a new policy version instead of overwriting it.')
    }
    return { policy: existing, path: paths.policyPath, reused: true, policyHash: hashJson(existingComparable) }
  }
  mkdirSync(dirname(paths.policyPath), { recursive: true })
  writeFileSync(paths.policyPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  const comparable = { ...value }
  delete comparable.installedAt
  return { policy: value, path: paths.policyPath, reused: false, policyHash: hashJson(comparable) }
}

function readInstalledPolicy(paths, projectId) {
  if (!existsSync(paths.policyPath)) throw new Error('Retention policy is not installed.')
  const policy = readJson(paths.policyPath)
  if (policy.projectId !== projectId) throw new Error('Retention policy projectId mismatch.')
  assertPolicy(policy)
  const comparable = { ...policy }
  delete comparable.installedAt
  return { policy, policyHash: hashJson(comparable) }
}

function assertRelativeObjectPath({ localRoot, kind, relativePath }) {
  if (typeof relativePath !== 'string' || relativePath.includes('\\') || isAbsolute(relativePath)) {
    throw new Error('Local object path must be a forward-slash relative path.')
  }
  const parts = relativePath.split('/')
  if (parts.length !== 2 || parts.some(part => part === '' || part === '.' || part === '..')) {
    throw new Error('Local object path must be exactly <kind-root>/<object-name>.')
  }
  const expectedRoot = kind === 'package-set' ? 'package-sets' : kind === 'run' ? 'runs' : null
  if (expectedRoot === null || parts[0] !== expectedRoot) throw new Error(`Local object path does not match kind ${String(kind)}.`)
  const absolute = resolve(localRoot, ...parts)
  const rel = relative(resolve(localRoot), absolute)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Local object path resolves outside local root.')
  return { absolute, parts }
}

function assertNoReparsePath(localRoot, absolute) {
  const rel = relative(resolve(localRoot), resolve(absolute))
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Local object is outside the managed local root.')
  let current = resolve(localRoot)
  for (const part of rel.split(sep)) {
    current = join(current, part)
    if (!existsSync(current)) throw new Error(`Registered local object path is missing: ${current}`)
    if (lstatSync(current).isSymbolicLink()) throw new Error(`Local object path contains a symbolic link or reparse point: ${current}`)
  }
}

function assertNoReparseDescendants(root) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const absolute = join(root, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`Local object contains a symbolic link or reparse point: ${absolute}`)
    if (entry.isDirectory()) assertNoReparseDescendants(absolute)
  }
}

function validateObjectRecord(paths, projectId, object, { skipQuarantinedPackageSetTree = false } = {}) {
  if (typeof object !== 'object' || object === null || !OBJECT_ID_PATTERN.test(object.objectId ?? '')) throw new Error('Local objectId is invalid.')
  if (!VALID_STATUSES.has(object.status)) throw new Error(`Local object status is invalid: ${String(object.status)}`)
  if (!VALID_RETENTION_CLASSES.has(object.retentionClass)) throw new Error(`Local object retentionClass is invalid: ${String(object.retentionClass)}`)
  if (!Number.isSafeInteger(object.expectedBytes) || object.expectedBytes < 0) throw new Error('Local object expectedBytes is invalid.')
  for (const field of ['ownerId', 'taskId', 'markerRelativePath']) {
    if (typeof object[field] !== 'string' || object[field].length === 0) throw new Error(`Local object ${field} is required.`)
  }
  assertIsoTimestamp(object.createdAt, 'createdAt')
  assertIsoTimestamp(object.lastUsedAt, 'lastUsedAt')
  const { absolute } = assertRelativeObjectPath({ localRoot: paths.localRoot, kind: object.kind, relativePath: object.relativePath })
  assertNoReparsePath(paths.localRoot, absolute)
  assertNoReparseDescendants(absolute)
  const markerPath = resolve(absolute, ...object.markerRelativePath.split('/'))
  const markerRel = relative(absolute, markerPath)
  if (markerRel.startsWith('..') || isAbsolute(markerRel) || !existsSync(markerPath)) throw new Error('Local object owner marker is missing or outside the object root.')
  const marker = readJson(markerPath)
  if (marker.projectId !== undefined && marker.projectId !== projectId) throw new Error('Local object marker projectId mismatch.')
  if (marker.objectId !== undefined && marker.objectId !== object.objectId) throw new Error('Local object marker objectId mismatch.')
  if (object.kind === 'run') {
    if (marker.projectId !== projectId || marker.objectId !== object.objectId || marker.taskId !== object.taskId) {
      throw new Error('Run owner marker does not match its registry record.')
    }
  } else if (object.kind === 'package-set') {
    const hash = object.sourceHashes?.packageSetTreeHash
    if (typeof hash !== 'string' || marker.packageSetTreeHash !== hash || object.objectId !== `pkg_${hash}`) {
      throw new Error('Package-set marker or tree hash does not match its registry record.')
    }
    if (skipQuarantinedPackageSetTree && object.status !== 'QUARANTINED') {
      throw new Error('Package-set tree validation can only be skipped for QUARANTINED evidence.')
    }
    if (!skipQuarantinedPackageSetTree) {
      const tree = hashTree(join(absolute, 'win-unpacked'))
      if (tree.hash !== hash) throw new Error('Package-set complete tree bytes no longer match the registered hash.')
    }
  }
  return { absolute, markerPath, marker, markerSha256: sha256File(markerPath) }
}

function validateQuarantinedPackageSetRecord(paths, projectId, object, registry) {
  const live = registry.objects.filter(item => item.deletedAt === undefined)
  const objectIdMatches = live.filter(item => item.objectId === object.objectId)
  const pathMatches = live.filter(item => item.relativePath === object.relativePath)
  if (objectIdMatches.length !== 1 || pathMatches.length !== 1 || object.kind !== 'package-set' || object.status !== 'QUARANTINED') {
    throw new Error(`QUARANTINED package-set registry identity is ambiguous or invalid: ${String(object.objectId)}`)
  }
  const verified = validateObjectRecord(paths, projectId, object, { skipQuarantinedPackageSetTree: true })
  if (verified.marker?.schemaVersion !== 'managed-package-set/v1'
    || verified.marker.projectId !== projectId
    || verified.marker.objectId !== object.objectId
    || object.markerSha256 !== verified.markerSha256) {
    throw new Error(`QUARANTINED package-set marker identity or hash mismatch: ${String(object.objectId)}`)
  }
  return verified
}

function coreObjectIdentity(object) {
  return {
    objectId: object.objectId,
    kind: object.kind,
    relativePath: object.relativePath,
    ownerId: object.ownerId,
    taskId: object.taskId,
    markerRelativePath: object.markerRelativePath,
  }
}

export function registerLocalObject({ projectRoot, projectId, object }) {
  const { paths } = assertProjectHome({ projectRoot, projectId })
  return withLifecycleLock(paths, () => {
    const registry = readLatestSnapshot(paths.registryDir) ?? emptyRegistry(projectId)
    const existingById = registry.objects.find(item => item.objectId === object?.objectId)
    const existingByPath = registry.objects.find(item => item.relativePath === object?.relativePath && item.objectId !== object?.objectId && item.deletedAt === undefined)
    if (existingByPath !== undefined) throw new Error(`Local object path conflict with ${existingByPath.objectId}.`)
    if (existingById !== undefined && hashJson(coreObjectIdentity(existingById)) !== hashJson(coreObjectIdentity(object))) {
      throw new Error(`Local objectId conflict: ${object.objectId}`)
    }
    const verified = validateObjectRecord(paths, projectId, object)
    const normalized = {
      ...cloneJson(object),
      cleanupAuthority: 'policy',
      markerSha256: verified.markerSha256,
      registeredAt: existingById?.registeredAt ?? new Date().toISOString(),
    }
    const objects = registry.objects.filter(item => item.objectId !== object.objectId)
    objects.push(existingById === undefined ? normalized : {
      ...existingById,
      ...normalized,
      registeredAt: existingById.registeredAt,
      deletedAt: undefined,
      cleanupOperationId: undefined,
    })
    const next = writeRegistry(paths, registry, objects)
    return { object: next.objects.find(item => item.objectId === object.objectId), registry: next, root: verified.absolute }
  })
}

export function createRegisteredRun({
  projectRoot,
  projectId,
  runId,
  ownerId,
  taskId,
  createdAt = new Date().toISOString(),
  retentionClass,
  packageSetObjectId,
  expectedBytes,
}) {
  const { paths } = assertProjectHome({ projectRoot, projectId })
  assertOperationId(runId)
  assertIsoTimestamp(createdAt, 'createdAt')
  if (!VALID_RETENTION_CLASSES.has(retentionClass) || retentionClass === 'package-set') throw new Error('Run retentionClass is invalid.')
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0) throw new Error('Run expectedBytes is invalid.')
  const freeBytes = currentFreeBytes(paths.localRoot)
  const preflight = evaluateLargeRunPreflight({ projectRoot, projectId, expectedBytes, freeBytes, now: createdAt })
  if (!preflight.ok) {
    throw new Error(`Run lifecycle preflight failed: ${preflight.issues.map(issue => issue.code).join(', ')}`)
  }
  const objectId = `run_${runId}`
  const relativePath = `runs/${runId}`
  const root = join(paths.runsRoot, runId)
  const stagingRoot = join(paths.runsRoot, '.staging', runId)
  assertRelativeObjectPath({ localRoot: paths.localRoot, kind: 'run', relativePath })
  if (existsSync(root) || existsSync(stagingRoot)) throw new Error(`Run path already exists: ${runId}`)
  if (packageSetObjectId !== undefined) {
    const registry = readLocalRegistry({ projectRoot, projectId })
    if (!registry.objects.some(item => item.objectId === packageSetObjectId && item.kind === 'package-set' && item.deletedAt === undefined)) {
      throw new Error(`Referenced package set is not registered: ${packageSetObjectId}`)
    }
  }
  mkdirSync(stagingRoot, { recursive: true })
  const marker = {
    schemaVersion: 'managed-local-run/v1',
    projectId,
    objectId,
    runId,
    ownerId,
    taskId,
    createdAt,
    retentionClass,
    ...(packageSetObjectId === undefined ? {} : { packageSetObjectId }),
    cleanupAuthority: 'policy',
  }
  writeFileSync(join(stagingRoot, 'run.json'), `${JSON.stringify(marker, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  renameSync(stagingRoot, root)
  try {
    return registerLocalObject({
      projectRoot,
      projectId,
      object: {
        objectId,
        kind: 'run',
        relativePath,
        ownerId,
        taskId,
        createdAt,
        lastUsedAt: createdAt,
        status: 'ACTIVE',
        retentionClass,
        expectedBytes,
        markerRelativePath: 'run.json',
        sourceHashes: {},
        references: packageSetObjectId === undefined ? [] : [packageSetObjectId],
      },
    })
  } catch (error) {
    assertNoReparsePath(paths.localRoot, root)
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    throw error
  }
}

export function completeRegisteredRun({
  projectRoot,
  projectId,
  objectId,
  outcome,
  completedAt = new Date().toISOString(),
  issueClosed,
  status = 'RETIRED',
}) {
  const { paths } = assertProjectHome({ projectRoot, projectId })
  assertIsoTimestamp(completedAt, 'completedAt')
  if (!VALID_STATUSES.has(status) || !VALID_RETENTION_CLASSES.has(outcome) || outcome === 'package-set') throw new Error('Run completion status or outcome is invalid.')
  return withLifecycleLock(paths, () => {
    const registry = readLatestSnapshot(paths.registryDir) ?? emptyRegistry(projectId)
    const current = registry.objects.find(item => item.objectId === objectId)
    if (current === undefined || current.kind !== 'run' || current.deletedAt !== undefined) throw new Error(`Registered run not found: ${objectId}`)
    const updated = {
      ...current,
      status,
      retentionClass: outcome,
      completedAt,
      lastUsedAt: completedAt,
      ...(issueClosed === undefined ? {} : { issueClosed }),
    }
    const objects = registry.objects.map(item => item.objectId === objectId ? updated : item)
    const next = writeRegistry(paths, registry, objects, completedAt)
    return { object: next.objects.find(item => item.objectId === objectId), registry: next }
  })
}

export function updateLocalObjectLifecycle({
  projectRoot,
  projectId,
  objectId,
  status,
  lastUsedAt = new Date().toISOString(),
}) {
  const { paths } = assertProjectHome({ projectRoot, projectId })
  assertIsoTimestamp(lastUsedAt, 'lastUsedAt')
  if (!VALID_STATUSES.has(status)) throw new Error(`Local object status is invalid: ${String(status)}`)
  return withLifecycleLock(paths, () => {
    const registry = readLatestSnapshot(paths.registryDir) ?? emptyRegistry(projectId)
    const current = registry.objects.find(item => item.objectId === objectId)
    if (current === undefined || current.deletedAt !== undefined) throw new Error(`Registered local object not found: ${objectId}`)
    const updated = { ...current, status, lastUsedAt }
    const objects = registry.objects.map(item => item.objectId === objectId ? updated : item)
    const next = writeRegistry(paths, registry, objects, lastUsedAt)
    return { object: next.objects.find(item => item.objectId === objectId), registry: next }
  })
}

function discoverUnknownObjects(paths, registry) {
  const known = new Set(registry.objects.filter(item => item.deletedAt === undefined).map(item => item.relativePath))
  const unknown = []
  for (const [kindRoot, absoluteRoot] of [['package-sets', paths.packageSetsRoot], ['runs', paths.runsRoot]]) {
    if (!existsSync(absoluteRoot)) continue
    for (const entry of readdirSync(absoluteRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === '.staging') continue
      const relativePath = `${kindRoot}/${entry.name}`
      if (!known.has(relativePath)) unknown.push(relativePath)
    }
  }
  for (const object of registry.objects.filter(item => item.deletedAt === undefined)) {
    const { absolute } = assertRelativeObjectPath({ localRoot: paths.localRoot, kind: object.kind, relativePath: object.relativePath })
    if (!existsSync(absolute)) unknown.push(`missing:${object.relativePath}`)
  }
  return [...new Set(unknown)].sort()
}

function writeHealth(paths, projectId, patch) {
  const current = readLatestSnapshot(paths.healthDir) ?? {
    schemaVersion: 'local-lifecycle-health/v1', projectId, revision: 0,
  }
  const next = { ...current, ...patch, schemaVersion: 'local-lifecycle-health/v1', projectId, revision: current.revision + 1 }
  next.path = writeSnapshot(paths.healthDir, next, next.revision)
  return next
}

function readHealth(paths, projectId) {
  const health = readLatestSnapshot(paths.healthDir)
  if (health !== null && health.projectId !== projectId) throw new Error('Lifecycle health projectId mismatch.')
  return health
}

function retentionReferenceTime(object) {
  return object.completedAt ?? object.lastUsedAt ?? object.createdAt
}

function hoursBetween(older, newer) {
  return (Date.parse(newer) - Date.parse(older)) / (60 * 60 * 1000)
}

function cleanupPlanPayload(plan) {
  const payload = { ...plan }
  delete payload.planHash
  delete payload.path
  return payload
}

export function createCleanupPlan({ projectRoot, projectId, operationId, now = new Date().toISOString() }) {
  const { paths } = assertProjectHome({ projectRoot, projectId })
  assertOperationId(operationId)
  assertIsoTimestamp(now, 'now')
  const { policy, policyHash } = readInstalledPolicy(paths, projectId)
  const registry = readLocalRegistry({ projectRoot, projectId })
  const unknown = discoverUnknownObjects(paths, registry)
  const referencedPackageSets = new Set(registry.objects
    .filter(item => item.kind === 'run' && item.deletedAt === undefined)
    .flatMap(item => item.references ?? []))
  const recentRanks = new Map()
  for (const retentionClass of VALID_RETENTION_CLASSES) {
    const objects = registry.objects
      .filter(item => item.retentionClass === retentionClass && item.deletedAt === undefined)
      .sort((left, right) => Date.parse(retentionReferenceTime(right)) - Date.parse(retentionReferenceTime(left)) || right.objectId.localeCompare(left.objectId))
    objects.forEach((object, index) => recentRanks.set(object.objectId, index))
  }
  const targets = []
  const retained = []
  for (const object of registry.objects.filter(item => item.deletedAt === undefined)) {
    let reason
    if (['ACTIVE', 'QUARANTINED', 'PINNED'].includes(object.status)) reason = `status-${object.status}`
    else if (!['RETIRED', 'DELETABLE'].includes(object.status)) reason = `status-${object.status}`
    else if (object.kind === 'package-set' && referencedPackageSets.has(object.objectId)) reason = 'referenced-by-run'
    else {
      const rule = policy.retention[object.retentionClass]
      if ((recentRanks.get(object.objectId) ?? 0) < rule.keepRecent) reason = 'within-recent-count'
      else if (hoursBetween(retentionReferenceTime(object), now) <= rule.minimumAgeHours) reason = 'within-minimum-age'
      else if (rule.requireIssueClosed && object.issueClosed !== true) reason = 'issue-open'
    }
    const verified = object.kind === 'package-set' && object.status === 'QUARANTINED'
      ? validateQuarantinedPackageSetRecord(paths, projectId, object, registry)
      : validateObjectRecord(paths, projectId, object)
    if (reason !== undefined) {
      retained.push({ objectId: object.objectId, relativePath: object.relativePath, reason })
    } else {
      targets.push({
        objectId: object.objectId,
        kind: object.kind,
        relativePath: object.relativePath,
        expectedBytes: object.expectedBytes,
        markerRelativePath: object.markerRelativePath,
        markerSha256: verified.markerSha256,
        sourceHashes: object.sourceHashes,
        reason: 'retention-satisfied',
      })
    }
  }
  targets.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
  retained.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
  const blockers = unknown.map(path => `unknown or unregistered local object: ${path}`)
  const plan = {
    schemaVersion: 'local-cleanup-plan/v1',
    operationId,
    projectId,
    createdAt: now,
    registryRevision: registry.revision,
    policyId: policy.policyId,
    policyHash,
    applyAllowed: blockers.length === 0,
    estimatedBytes: targets.reduce((sum, item) => sum + item.expectedBytes, 0),
    targets,
    retained,
    blockers,
  }
  plan.planHash = hashJson(cleanupPlanPayload(plan))
  const path = join(paths.receiptsRoot, `${operationId}-cleanup-plan.json`)
  writeFileSync(path, `${JSON.stringify(plan, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  plan.path = path
  writeHealth(paths, projectId, {
    status: blockers.length === 0 ? 'plan-ready' : 'blocked',
    lastPlanAt: now,
    lastPlanOperationId: operationId,
    unknownObjects: unknown,
    lastFailure: blockers.length === 0 ? null : blockers.join('; '),
  })
  return plan
}

function assertAuthorizedSupersededObjects(registry, targetObjectId, supersededByObjectId) {
  const target = registry.objects.find(item => item.objectId === targetObjectId && item.deletedAt === undefined)
  const supersededBy = registry.objects.find(item => item.objectId === supersededByObjectId && item.deletedAt === undefined)
  if (target?.kind !== 'package-set') throw lifecycleError('AUTHORIZED_CLEANUP_TARGET_INVALID', 'target must be a live registered package set.')
  if (target.status !== 'RETIRED') throw lifecycleError('AUTHORIZED_CLEANUP_TARGET_NOT_RETIRED', `target ${targetObjectId} is ${String(target.status)}.`)
  if (supersededBy?.kind !== 'package-set' || supersededBy.status !== 'ACTIVE') {
    throw lifecycleError('AUTHORIZED_CLEANUP_SUPERSEDER_NOT_ACTIVE', 'superseding object must be a live ACTIVE package set.')
  }
  if (targetObjectId === supersededByObjectId) throw lifecycleError('AUTHORIZED_CLEANUP_TARGET_INVALID', 'target and superseding object must differ.')
  const referenced = registry.objects.some(item => item.kind === 'run' && item.deletedAt === undefined && (item.references ?? []).includes(targetObjectId))
  if (referenced) throw lifecycleError('AUTHORIZED_CLEANUP_TARGET_REFERENCED', `target ${targetObjectId} is referenced by a live run.`)
  return { target, supersededBy }
}

function readAuthorizedCleanupReceipt({ paths, projectId, authorizationReceiptPath, targetTreeHash, expectedSha256 }) {
  const resolvedReceipt = resolve(authorizationReceiptPath)
  const receiptRelativePath = relative(paths.receiptsRoot, resolvedReceipt)
  if (receiptRelativePath.startsWith('..') || isAbsolute(receiptRelativePath) || !existsSync(resolvedReceipt)) {
    throw lifecycleError('AUTHORIZED_CLEANUP_RECEIPT_INVALID', 'authorization receipt is outside Project Home receipts or missing.')
  }
  const receiptSha256 = sha256File(resolvedReceipt)
  if (expectedSha256 !== undefined && receiptSha256 !== expectedSha256) {
    throw lifecycleError('AUTHORIZED_CLEANUP_RECEIPT_DRIFT', 'authorization receipt hash changed after preview.')
  }
  const receipt = readJson(resolvedReceipt)
  const prefix = `lifecycle-delete-exact-${targetTreeHash}`
  if (receipt.projectId !== projectId || !Array.isArray(receipt.authorization?.allowed) || !receipt.authorization.allowed.some(value => typeof value === 'string' && (value === prefix || value.startsWith(`${prefix}-`)))) {
    throw lifecycleError('AUTHORIZED_CLEANUP_SCOPE_MISSING', `authorization receipt does not allow exact package set ${targetTreeHash}.`)
  }
  return { resolvedReceipt, receiptRelativePath: receiptRelativePath.split(sep).join('/'), receiptSha256 }
}

export function createAuthorizedSupersededPackageSetCleanupPlan({
  projectRoot,
  projectId,
  operationId,
  targetObjectId,
  supersededByObjectId,
  authorizationReceiptPath,
  now = new Date().toISOString(),
}) {
  const { paths } = assertProjectHome({ projectRoot, projectId })
  assertOperationId(operationId)
  assertIsoTimestamp(now, 'now')
  const { policy, policyHash } = readInstalledPolicy(paths, projectId)
  const registry = readLocalRegistry({ projectRoot, projectId })
  const unknown = discoverUnknownObjects(paths, registry)
  if (unknown.length > 0) throw lifecycleError('AUTHORIZED_CLEANUP_UNKNOWN_OBJECT', `unknown or missing local objects: ${unknown.join(', ')}`)
  const { target } = assertAuthorizedSupersededObjects(registry, targetObjectId, supersededByObjectId)
  const targetVerified = validateObjectRecord(paths, projectId, target)
  const authorization = readAuthorizedCleanupReceipt({
    paths,
    projectId,
    authorizationReceiptPath,
    targetTreeHash: target.sourceHashes.packageSetTreeHash,
  })
  const retained = registry.objects
    .filter(item => item.deletedAt === undefined && item.objectId !== targetObjectId)
    .map(item => {
      validateObjectRecord(paths, projectId, item)
      return { objectId: item.objectId, relativePath: item.relativePath, reason: item.objectId === supersededByObjectId ? 'active-superseder' : 'not-authorized-target' }
    })
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
  const targets = [{
    objectId: target.objectId,
    kind: target.kind,
    relativePath: target.relativePath,
    expectedBytes: target.expectedBytes,
    markerRelativePath: target.markerRelativePath,
    markerSha256: targetVerified.markerSha256,
    sourceHashes: target.sourceHashes,
    reason: 'cyrus-authorized-superseded-package-set',
  }]
  const plan = {
    schemaVersion: 'local-cleanup-plan/v1',
    planType: 'authorized-superseded-package-set/v1',
    operationId,
    projectId,
    createdAt: now,
    registryRevision: registry.revision,
    policyId: policy.policyId,
    policyHash,
    authorization: {
      receiptRelativePath: authorization.receiptRelativePath,
      receiptSha256: authorization.receiptSha256,
      targetObjectId,
      supersededByObjectId,
    },
    applyAllowed: true,
    estimatedBytes: target.expectedBytes,
    targets,
    retained,
    blockers: [],
  }
  plan.planHash = hashJson(cleanupPlanPayload(plan))
  const path = join(paths.receiptsRoot, `${operationId}-cleanup-plan.json`)
  writeFileSync(path, `${JSON.stringify(plan, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  plan.path = path
  writeHealth(paths, projectId, {
    status: 'authorized-plan-ready',
    lastPlanAt: now,
    lastPlanOperationId: operationId,
    unknownObjects: [],
    lastFailure: null,
  })
  return plan
}

function currentFreeBytes(path) {
  const disk = statfsSync(path)
  return Number(disk.bavail) * Number(disk.bsize)
}

export function applyCleanupPlan({ projectRoot, projectId, planPath, now = new Date().toISOString(), afterDelete }) {
  const { paths } = assertProjectHome({ projectRoot, projectId })
  assertIsoTimestamp(now, 'now')
  const resolvedPlan = resolve(planPath)
  const relPlan = relative(paths.receiptsRoot, resolvedPlan)
  if (relPlan.startsWith('..') || isAbsolute(relPlan) || !existsSync(resolvedPlan)) throw new Error('Cleanup plan path is outside the Project Home receipts root or missing.')
  const plan = readJson(resolvedPlan)
  if (plan.schemaVersion !== 'local-cleanup-plan/v1' || plan.projectId !== projectId) throw new Error('Cleanup plan schema or projectId mismatch.')
  assertOperationId(plan.operationId)
  if (hashJson(cleanupPlanPayload(plan)) !== plan.planHash) throw new Error('Cleanup plan hash mismatch.')
  if (plan.applyAllowed !== true || plan.blockers?.length !== 0) throw new Error('Cleanup plan is blocked and cannot be applied.')
  const { policyHash } = readInstalledPolicy(paths, projectId)
  if (policyHash !== plan.policyHash) throw new Error('Cleanup plan policy hash is stale.')
  const receiptPath = join(paths.receiptsRoot, `${plan.operationId}-cleanup-receipt.json`)
  if (existsSync(receiptPath)) return { ...readJson(receiptPath), path: receiptPath, replayed: true }

  return withLifecycleLock(paths, () => {
    const registry = readLatestSnapshot(paths.registryDir) ?? emptyRegistry(projectId)
    const replay = registry.revision !== plan.registryRevision && plan.targets.every(target => {
      const current = registry.objects.find(item => item.objectId === target.objectId)
      return current?.deletedAt !== undefined && current.cleanupOperationId === plan.operationId
    })
    if (registry.revision !== plan.registryRevision && !replay) throw new Error(`Cleanup plan registry revision is stale: ${plan.registryRevision} != ${registry.revision}`)
    if (plan.planType !== undefined) {
      if (plan.planType !== 'authorized-superseded-package-set/v1' || plan.targets.length !== 1 || plan.targets[0].objectId !== plan.authorization?.targetObjectId) {
        throw lifecycleError('AUTHORIZED_CLEANUP_PLAN_INVALID', 'authorized cleanup plan type or exact target is invalid.')
      }
      if (!replay) {
        const { target } = assertAuthorizedSupersededObjects(registry, plan.authorization.targetObjectId, plan.authorization.supersededByObjectId)
        readAuthorizedCleanupReceipt({
          paths,
          projectId,
          authorizationReceiptPath: join(paths.receiptsRoot, ...plan.authorization.receiptRelativePath.split('/')),
          targetTreeHash: target.sourceHashes.packageSetTreeHash,
          expectedSha256: plan.authorization.receiptSha256,
        })
      }
    }
    const operationDir = join(paths.ledgersRoot, 'cleanup-operations', plan.operationId)
    let journal = readLatestSnapshot(operationDir)
    if (journal !== null && (journal.projectId !== projectId || journal.planHash !== plan.planHash)) {
      throw new Error(`Cleanup apply journal conflicts with plan: ${plan.operationId}`)
    }
    if (journal === null) {
      journal = {
        schemaVersion: 'local-cleanup-apply-journal/v1',
        projectId,
        operationId: plan.operationId,
        planHash: plan.planHash,
        revision: 1,
        status: 'applying',
        startedAt: now,
        freeBytesBefore: currentFreeBytes(paths.localRoot),
        deletedObjectIds: [],
      }
      journal.path = writeSnapshot(operationDir, journal, journal.revision)
    }
    const freeBytesBefore = journal.freeBytesBefore
    const resumed = journal.deletedObjectIds.length > 0 && !replay
    const acknowledgedDeleted = new Set(journal.deletedObjectIds)
    const verifiedTargets = new Map()
    if (!replay) {
      for (const target of plan.targets) {
        const object = registry.objects.find(item => item.objectId === target.objectId)
        if (object === undefined || object.deletedAt !== undefined) throw new Error(`Cleanup target is not live in registry: ${target.objectId}`)
        if (object.cleanupAuthority !== 'policy') throw new Error(`Cleanup target lacks policy authority: ${target.objectId}`)
        const { absolute } = assertRelativeObjectPath({ localRoot: paths.localRoot, kind: object.kind, relativePath: object.relativePath })
        if (!existsSync(absolute)) {
          if (!acknowledgedDeleted.has(target.objectId)) throw new Error(`Cleanup target disappeared without journal evidence: ${target.relativePath}`)
          verifiedTargets.set(target.objectId, { object, absolute, alreadyDeleted: true })
          continue
        }
        const verified = validateObjectRecord(paths, projectId, object)
        if (verified.markerSha256 !== target.markerSha256) throw new Error(`Cleanup target marker hash mismatch: ${target.objectId}`)
        assertNoReparsePath(paths.localRoot, verified.absolute)
        verifiedTargets.set(target.objectId, { object, absolute: verified.absolute, alreadyDeleted: false })
      }
      for (const retained of plan.retained) {
        const object = registry.objects.find(item => item.objectId === retained.objectId)
        if (object?.deletedAt === undefined) {
          if (object.kind === 'package-set' && object.status === 'QUARANTINED') {
            validateQuarantinedPackageSetRecord(paths, projectId, object, registry)
          } else {
            validateObjectRecord(paths, projectId, object)
          }
        }
      }
    }
    const deleted = plan.targets.map(target => ({ objectId: target.objectId, relativePath: target.relativePath, expectedBytes: target.expectedBytes }))
    if (!replay) {
      for (const target of plan.targets) {
        const verified = verifiedTargets.get(target.objectId)
        if (!verified.alreadyDeleted) {
          rmSync(verified.absolute, { recursive: true, force: false, maxRetries: 5, retryDelay: 100 })
          if (existsSync(verified.absolute)) throw new Error(`Cleanup target still exists after deletion: ${target.relativePath}`)
          acknowledgedDeleted.add(target.objectId)
          journal = {
            ...journal,
            revision: journal.revision + 1,
            status: 'applying',
            lastProgressAt: now,
            deletedObjectIds: [...acknowledgedDeleted].sort(),
          }
          journal.path = writeSnapshot(operationDir, journal, journal.revision)
          if (typeof afterDelete === 'function') afterDelete({ target, deletedCount: acknowledgedDeleted.size })
        }
      }
      if (deleted.length > 0) {
        const objects = registry.objects.map(object => deleted.some(item => item.objectId === object.objectId)
          ? { ...object, status: 'DELETABLE', deletedAt: now, cleanupOperationId: plan.operationId, references: [] }
          : object)
        writeRegistry(paths, registry, objects, now)
      }
    }
    for (const retained of plan.retained) {
      const object = registry.objects.find(item => item.objectId === retained.objectId)
      if (object?.deletedAt === undefined) {
        const { absolute } = assertRelativeObjectPath({ localRoot: paths.localRoot, kind: object.kind, relativePath: object.relativePath })
        if (!existsSync(absolute)) throw new Error(`Retained local object disappeared during cleanup: ${retained.relativePath}`)
      }
    }
    const unknownAfter = discoverUnknownObjects(paths, readLatestSnapshot(paths.registryDir) ?? registry)
    if (unknownAfter.length > 0) throw new Error(`Cleanup verification found unknown local objects: ${unknownAfter.join(', ')}`)
    const freeBytesAfter = currentFreeBytes(paths.localRoot)
    const { policy } = readInstalledPolicy(paths, projectId)
    const nextDueAt = new Date(Date.parse(now) + policy.schedule.intervalHours * 60 * 60 * 1000).toISOString()
    const overdueAt = new Date(Date.parse(now) + (policy.schedule.intervalHours + policy.schedule.overdueGraceHours) * 60 * 60 * 1000).toISOString()
    const health = writeHealth(paths, projectId, {
      status: 'healthy',
      lastSuccessfulCycleAt: now,
      lastApplyOperationId: plan.operationId,
      nextDueAt,
      overdueAt,
      unknownObjects: [],
      lastFailure: null,
    })
    const receipt = {
      schemaVersion: 'local-cleanup-receipt/v1',
      operationId: plan.operationId,
      projectId,
      planHash: plan.planHash,
      appliedAt: now,
      status: 'applied-and-verified',
      replayed: replay,
      resumed,
      deleted,
      deletedExpectedBytes: deleted.reduce((sum, item) => sum + item.expectedBytes, 0),
      retainedVerified: plan.retained.length,
      freeBytesBefore,
      freeBytesAfter,
      registryRevisionAfter: (readLatestSnapshot(paths.registryDir) ?? registry).revision,
      healthRevision: health.revision,
      nextDueAt,
      overdueAt,
    }
    journal = {
      ...journal,
      revision: journal.revision + 1,
      status: 'applied-and-verified',
      completedAt: now,
      deletedObjectIds: deleted.map(item => item.objectId).sort(),
      registryRevisionAfter: receipt.registryRevisionAfter,
    }
    journal.path = writeSnapshot(operationDir, journal, journal.revision)
    writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    return { ...receipt, path: receiptPath }
  })
}

export function evaluateLargeRunPreflight({ projectRoot, projectId, expectedBytes, freeBytes, now = new Date().toISOString() }) {
  const { paths } = assertProjectHome({ projectRoot, projectId })
  assertIsoTimestamp(now, 'now')
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0 || !Number.isSafeInteger(freeBytes) || freeBytes < 0) {
    throw new Error('Large-run expectedBytes/freeBytes are invalid.')
  }
  const { policy } = readInstalledPolicy(paths, projectId)
  const registry = readLocalRegistry({ projectRoot, projectId })
  const health = readHealth(paths, projectId)
  const unknown = discoverUnknownObjects(paths, registry)
  const registeredBytes = registry.objects.filter(item => item.deletedAt === undefined).reduce((sum, item) => sum + item.expectedBytes, 0)
  const issues = []
  if (unknown.length > 0) issues.push({ code: 'UNKNOWN_LOCAL_OBJECT', message: unknown.join(', ') })
  if (health?.lastSuccessfulCycleAt === undefined) issues.push({ code: 'LIFECYCLE_CYCLE_MISSING', message: 'No successful cleanup cycle is recorded.' })
  else {
    const overdueAt = Date.parse(health.lastSuccessfulCycleAt) + (policy.schedule.intervalHours + policy.schedule.overdueGraceHours) * 60 * 60 * 1000
    if (Date.parse(now) > overdueAt) issues.push({ code: 'LIFECYCLE_CYCLE_OVERDUE', message: `Lifecycle cycle overdue since ${new Date(overdueAt).toISOString()}.` })
  }
  if (freeBytes - expectedBytes < policy.disk.minimumFreeBytes) {
    issues.push({ code: 'DISK_RESERVE_INSUFFICIENT', message: 'Large run would cross the minimum free-disk reserve.' })
  }
  if (registeredBytes + expectedBytes > policy.quota.maximumRegisteredBytes) {
    issues.push({ code: 'LOCAL_QUOTA_EXCEEDED', message: 'Large run would exceed the registered local-object quota.' })
  }
  return {
    schemaVersion: 'large-run-preflight/v1',
    projectId,
    checkedAt: now,
    ok: issues.length === 0,
    expectedBytes,
    freeBytes,
    registeredBytes,
    minimumFreeBytes: policy.disk.minimumFreeBytes,
    maximumRegisteredBytes: policy.quota.maximumRegisteredBytes,
    healthRevision: health?.revision ?? null,
    issues,
  }
}

export function ensureNonDestructiveLifecycleCycle({
  projectRoot,
  projectId,
  operationId,
  now = new Date().toISOString(),
}) {
  const { paths } = assertProjectHome({ projectRoot, projectId })
  assertOperationId(operationId)
  assertIsoTimestamp(now, 'now')
  const { policy } = readInstalledPolicy(paths, projectId)
  const health = readHealth(paths, projectId)
  if (health?.lastSuccessfulCycleAt !== undefined) {
    const overdueAt = Date.parse(health.lastSuccessfulCycleAt) + (policy.schedule.intervalHours + policy.schedule.overdueGraceHours) * 60 * 60 * 1000
    if (Date.parse(now) <= overdueAt) return { status: 'healthy-reused', health }
  }
  const plan = createCleanupPlan({ projectRoot, projectId, operationId, now })
  if (!plan.applyAllowed) throw new Error(`Lifecycle cycle is blocked: ${plan.blockers.join('; ')}`)
  if (plan.targets.length > 0) {
    throw new Error(`Lifecycle cleanup requires an explicit apply decision for ${plan.targets.length} target(s); no object was deleted.`)
  }
  return { status: 'healthy-refreshed', plan, receipt: applyCleanupPlan({ projectRoot, projectId, planPath: plan.path, now }) }
}
