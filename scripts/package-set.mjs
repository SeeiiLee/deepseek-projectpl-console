import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statfsSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'

import { createSourceReceipt, hashTree, sha256File, verifyBuildReceipt } from './build-receipt.mjs'
import {
  claimPackageSetBuildTask,
  completePackageSetBuildTask,
  evaluateLargeRunPreflight,
  failPackageSetBuildTask,
  installRetentionPolicy,
  readLocalRegistry,
  readPackageSetBuildTask,
  registerLocalObject,
  resolveLocalLifecyclePaths,
} from './local-lifecycle.mjs'

const FIVE_GIB = 5 * 1024 * 1024 * 1024
const ONE_GIB = 1024 * 1024 * 1024
const PACKAGE_HASH_PATTERN = /^[A-Fa-f0-9]{64}$/u
const LOGICAL_TASK_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,95}$/iu
const PRESERVED_PACKAGE_SET_STATUSES = new Set(['QUARANTINED', 'PINNED'])

function packageSetError(code, message) {
  const error = new Error(`${code}: ${message}`)
  error.code = code
  return error
}

export function packageSetDirectoryName(hash) {
  if (typeof hash !== 'string' || !PACKAGE_HASH_PATTERN.test(hash)) {
    throw new Error('Package-set hash must be 64 hexadecimal characters.')
  }
  return `sha256-${hash.toLowerCase()}`
}

export function resolveManagedPackageSetsRoot(projectRoot) {
  const workspace = resolve(projectRoot)
  if (workspace.split(/[\\/]/u).at(-1)?.toLowerCase() !== 'workspace') {
    throw new Error(`Managed package sets require a Project Home workspace path: ${workspace}`)
  }
  return join(resolve(workspace, '..'), 'local', 'package-sets')
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function packageSetPaths(root) {
  const winUnpacked = join(root, 'win-unpacked')
  return {
    root,
    winUnpacked,
    appDir: join(winUnpacked, 'resources', 'app'),
    exePath: join(winUnpacked, 'DeepSeek Harness Personal.exe'),
    receiptPath: join(root, 'build-receipt.json'),
  }
}

function sourceReceiptHash(projectRoot) {
  return createHash('sha256').update(JSON.stringify(createSourceReceipt(projectRoot))).digest('hex')
}

function provenanceRoot(projectRoot) {
  return join(resolveLocalLifecyclePaths(projectRoot).ledgersRoot, 'package-set-provenance')
}

function verifyManagedPackageSetWithReceipt({ projectRoot, sourceRoot = projectRoot, root, receipt }) {
  const paths = packageSetPaths(root)
  if (receipt === null || typeof receipt?.packageSetTreeHash !== 'string') return null
  if (packageSetDirectoryName(receipt.packageSetTreeHash) !== root.split(/[\\/]/u).at(-1)?.toLowerCase()) return null
  const verification = verifyBuildReceipt({
    projectRoot: sourceRoot,
    receipt,
    exePath: paths.exePath,
    packagedAppDir: paths.appDir,
    expectedFlavor: 'stable',
  })
  if (!verification.ok) return null
  return { ...paths, receipt, verification, reused: true }
}

export function recordPackageSetProvenance({ projectRoot, sourceRoot = projectRoot, root, receipt }) {
  const verified = verifyManagedPackageSetWithReceipt({ projectRoot, sourceRoot, root, receipt })
  if (verified === null) throw new Error(`Package-set provenance does not verify against immutable package bytes: ${root}`)
  const { projectId } = projectIdentity(projectRoot)
  const currentSourceHash = sourceReceiptHash(sourceRoot)
  const receiptSourceHash = createHash('sha256').update(JSON.stringify({
    schemaVersion: receipt.schemaVersion,
    clientVersion: receipt.clientVersion,
    harnessCommit: receipt.harnessCommit,
    sourceFiles: receipt.sourceFiles,
  })).digest('hex')
  if (receiptSourceHash !== currentSourceHash) throw new Error('Package-set provenance source receipt does not match the current source tree.')
  const rootDir = provenanceRoot(projectRoot)
  mkdirSync(rootDir, { recursive: true })
  const path = join(rootDir, `sha256-${currentSourceHash}.json`)
  const buildReceipt = { ...receipt }
  delete buildReceipt.path
  const value = {
    schemaVersion: 'managed-package-set-provenance/v1',
    projectId,
    sourceReceiptHash: currentSourceHash,
    packageSetTreeHash: receipt.packageSetTreeHash,
    packageSetRelativePath: `package-sets/${packageSetDirectoryName(receipt.packageSetTreeHash)}`,
    recordedAt: new Date().toISOString(),
    buildReceipt,
  }
  if (existsSync(path)) {
    const existing = readJson(path)
    if (existing?.sourceReceiptHash !== currentSourceHash || existing?.packageSetTreeHash !== receipt.packageSetTreeHash) {
      throw new Error(`Package-set provenance conflict: ${path}`)
    }
    return { path, value: existing, reused: true, packageSet: verified }
  }
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  return { path, value, reused: false, packageSet: verified }
}

function findProvenancePackageSet({ projectRoot, sourceRoot = projectRoot, packageSetsRoot }) {
  const hash = sourceReceiptHash(sourceRoot)
  const path = join(provenanceRoot(projectRoot), `sha256-${hash}.json`)
  if (!existsSync(path)) return null
  const provenance = readJson(path)
  const { projectId } = projectIdentity(projectRoot)
  if (provenance?.schemaVersion !== 'managed-package-set-provenance/v1' || provenance.projectId !== projectId || provenance.sourceReceiptHash !== hash) {
    throw new Error(`Managed package-set provenance is invalid: ${path}`)
  }
  const root = join(packageSetsRoot, packageSetDirectoryName(provenance.packageSetTreeHash))
  const verified = verifyManagedPackageSetWithReceipt({ projectRoot, sourceRoot, root, receipt: provenance.buildReceipt })
  if (verified === null) throw new Error(`Managed package-set provenance points to missing or drifted bytes: ${path}`)
  return { ...verified, provenancePath: path }
}

function projectIdentity(projectRoot) {
  const paths = resolveLocalLifecyclePaths(projectRoot)
  const marker = readJson(paths.markerPath)
  if (marker?.schemaVersion !== 'project-home/v1' || typeof marker.projectId !== 'string') {
    throw new Error(`Managed package sets require a valid Project Home marker: ${paths.markerPath}`)
  }
  return { paths, projectId: marker.projectId }
}

export function resolvePackedLogicalTaskId({ projectRoot, stateRoot = projectRoot, env = process.env }) {
  const { projectId } = projectIdentity(projectRoot)
  const statePath = join(resolve(stateRoot), 'docs', 'governance', 'current-state.json')
  const state = readJson(statePath)
  const logicalTaskId = state?.nextTask?.id
  if (state?.schemaVersion !== 'current-state/v1' || state.projectId !== projectId || typeof logicalTaskId !== 'string' || !LOGICAL_TASK_ID_PATTERN.test(logicalTaskId)) {
    throw packageSetError('PACKED_LOGICAL_TASK_CONTEXT_INVALID', `current-state project identity or nextTask is invalid: ${statePath}`)
  }
  const override = typeof env?.DSH_LOGICAL_TASK_ID === 'string' ? env.DSH_LOGICAL_TASK_ID.trim() : ''
  if (override !== '' && override !== logicalTaskId) {
    throw packageSetError('PACKED_LOGICAL_TASK_ID_MISMATCH', `DSH_LOGICAL_TASK_ID=${override} does not match authoritative nextTask.id=${logicalTaskId}.`)
  }
  return logicalTaskId
}

function directoryBytes(root) {
  let bytes = 0
  const walk = current => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolute = join(current, entry.name)
      if (entry.isSymbolicLink()) throw new Error(`Managed package set contains a symbolic link or reparse point: ${absolute}`)
      if (entry.isDirectory()) walk(absolute)
      else if (entry.isFile()) bytes += statSync(absolute).size
    }
  }
  walk(root)
  if (!Number.isSafeInteger(bytes)) throw new Error('Managed package-set byte count exceeds the safe integer range.')
  return bytes
}

export function registerManagedPackageSet({ projectRoot, root, status = 'ACTIVE', lastUsedAt = new Date().toISOString() }) {
  const { paths: lifecyclePaths, projectId } = projectIdentity(projectRoot)
  const resolvedRoot = resolve(root)
  const rel = relative(resolve(lifecyclePaths.packageSetsRoot), resolvedRoot)
  if (rel.startsWith('..') || isAbsolute(rel) || rel.includes('\\') || rel.includes('/') || rel === '.staging') {
    throw new Error(`Managed package-set registration is outside the package-sets root: ${resolvedRoot}`)
  }
  const paths = packageSetPaths(resolvedRoot)
  const marker = readJson(join(resolvedRoot, 'package-set.json'))
  const receipt = readJson(paths.receiptPath)
  if (marker?.schemaVersion !== 'managed-package-set/v1' || receipt?.schemaVersion !== 3) {
    throw new Error(`Managed package-set marker or build receipt is invalid: ${resolvedRoot}`)
  }
  const tree = hashTree(paths.winUnpacked)
  if (tree.hash !== receipt.packageSetTreeHash || tree.fileCount !== receipt.packageSetFileCount || marker.packageSetTreeHash !== tree.hash) {
    throw new Error(`Managed package-set complete tree integrity mismatch: ${resolvedRoot}`)
  }
  if (packageSetDirectoryName(tree.hash) !== rel.toLowerCase()) {
    throw new Error(`Managed package-set directory name does not match its tree hash: ${resolvedRoot}`)
  }
  const objectId = `pkg_${tree.hash}`
  const createdAt = marker.createdAt ?? receipt.generatedAt
  const markerTaskId = marker.logicalTaskId ?? marker.operationId
  if (!LOGICAL_TASK_ID_PATTERN.test(markerTaskId ?? '') || (marker.logicalTaskId !== undefined && marker.operationId !== marker.logicalTaskId)) {
    throw new Error(`Managed package-set logical task identity is invalid: ${resolvedRoot}`)
  }
  const result = registerLocalObject({
    projectRoot,
    projectId,
    object: {
      objectId,
      kind: 'package-set',
      relativePath: `package-sets/${rel}`,
      ownerId: 'managed-package-set',
      taskId: markerTaskId,
      createdAt,
      lastUsedAt,
      status,
      retentionClass: 'package-set',
      expectedBytes: directoryBytes(resolvedRoot),
      markerRelativePath: 'package-set.json',
      sourceHashes: {
        packageSetTreeHash: tree.hash,
        buildReceiptSha256: sha256File(paths.receiptPath),
      },
      references: [],
    },
  })
  return { ...result, projectId, packageSetTreeHash: tree.hash }
}

function verifyPreservedManagedPackageSet({ projectId, root, object }) {
  const directoryName = root.split(/[\\/]/u).at(-1)?.toLowerCase()
  const markerPath = join(root, 'package-set.json')
  const marker = readJson(markerPath)
  const hash = marker?.packageSetTreeHash
  const expectedObjectId = typeof hash === 'string' ? `pkg_${hash}` : null
  const expectedRelativePath = `package-sets/${String(directoryName)}`
  const valid = object?.kind === 'package-set'
    && PRESERVED_PACKAGE_SET_STATUSES.has(object.status)
    && object.deletedAt === undefined
    && object.relativePath === expectedRelativePath
    && object.markerRelativePath === 'package-set.json'
    && marker?.schemaVersion === 'managed-package-set/v1'
    && marker.projectId === projectId
    && marker.objectId === object.objectId
    && marker.objectId === expectedObjectId
    && object.sourceHashes?.packageSetTreeHash === hash
    && packageSetDirectoryName(hash) === directoryName
    && object.markerSha256 === sha256File(markerPath)
  if (!valid) {
    throw packageSetError('PRESERVED_PACKAGE_SET_IDENTITY_INVALID', `preserved package-set identity is invalid: ${root}`)
  }
  return { root, projectId, packageSetTreeHash: hash, object, preserved: true }
}

export function reconcileManagedPackageSets({ projectRoot, activeRoot, now = new Date().toISOString() }) {
  const { paths, projectId } = projectIdentity(projectRoot)
  installRetentionPolicy({ projectRoot, projectId })
  const active = activeRoot === undefined ? null : resolve(activeRoot)
  const roots = existsSync(paths.packageSetsRoot)
    ? readdirSync(paths.packageSetsRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && entry.name.startsWith('sha256-'))
      .map(entry => join(paths.packageSetsRoot, entry.name))
      .sort()
    : []
  const registryBefore = readLocalRegistry({ projectRoot, projectId })
  const registered = []
  const preserved = []
  for (const root of roots) {
    const directoryName = root.split(/[\\/]/u).at(-1)?.toLowerCase()
    const relativePath = `package-sets/${String(directoryName)}`
    const existing = registryBefore.objects.filter(item => item.deletedAt === undefined && item.relativePath === relativePath)
    if (existing.length > 1) {
      throw packageSetError('PACKAGE_SET_REGISTRY_PATH_AMBIGUOUS', `multiple registry objects claim managed package-set path: ${root}`)
    }
    if (existing[0]?.kind === 'package-set' && PRESERVED_PACKAGE_SET_STATUSES.has(existing[0].status)) {
      if (active !== null && resolve(root) === active) {
        throw packageSetError('PRESERVED_PACKAGE_SET_ACTIVE_FORBIDDEN', `preserved ${existing[0].status} package-set cannot become active through reconciliation: ${root}`)
      }
      preserved.push(verifyPreservedManagedPackageSet({ projectId, root, object: existing[0] }))
      continue
    }
    const marker = readJson(join(root, 'package-set.json'))
    registered.push(registerManagedPackageSet({
      projectRoot,
      root,
      status: active !== null && resolve(root) === active ? 'ACTIVE' : 'RETIRED',
      lastUsedAt: active !== null && resolve(root) === active ? now : marker?.createdAt ?? now,
    }))
  }
  if (active !== null && !registered.some(item => resolve(item.root) === active)) {
    throw new Error(`Active managed package set was not reconciled: ${active}`)
  }
  return { projectId, registered, preserved, registry: readLocalRegistry({ projectRoot, projectId }) }
}

export function verifyManagedPackageSet({ projectRoot, sourceRoot = projectRoot, root }) {
  const paths = packageSetPaths(root)
  const receipt = readJson(paths.receiptPath)
  return verifyManagedPackageSetWithReceipt({ projectRoot, sourceRoot, root, receipt })
}

export function findReusablePackageSet({
  projectRoot,
  sourceRoot = projectRoot,
  packageSetsRoot = resolveManagedPackageSetsRoot(projectRoot),
}) {
  const provenance = findProvenancePackageSet({ projectRoot, sourceRoot, packageSetsRoot })
  if (provenance !== null) return provenance
  if (!existsSync(packageSetsRoot)) return null
  const candidates = readdirSync(packageSetsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name.startsWith('sha256-'))
    .map(entry => join(packageSetsRoot, entry.name))
    .sort()
  for (const root of candidates) {
    const verified = verifyManagedPackageSet({ projectRoot, sourceRoot, root })
    if (verified !== null) return verified
  }
  return null
}

function assertOwnedStagingPath(packageSetsRoot, stagingRoot) {
  const resolvedSets = resolve(packageSetsRoot)
  const resolvedStaging = resolve(stagingRoot)
  const rel = relative(join(resolvedSets, '.staging'), resolvedStaging)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Refusing package-set staging operation outside owned root: ${resolvedStaging}`)
  }
}

export function ensureManagedPackageSet({
  projectRoot,
  sourceRoot = projectRoot,
  packageSetsRoot = resolveManagedPackageSetsRoot(projectRoot),
  minimumFreeBytes = FIVE_GIB,
  logicalTaskId,
} = {}) {
  if (typeof logicalTaskId !== 'string' || !LOGICAL_TASK_ID_PATTERN.test(logicalTaskId)) {
    throw packageSetError('PACKED_LOGICAL_TASK_ID_REQUIRED', 'a stable logicalTaskId from current-state.nextTask.id is required.')
  }
  const buildSourceRoot = resolve(sourceRoot)
  const { projectId } = projectIdentity(projectRoot)
  const currentSourceReceiptHash = sourceReceiptHash(buildSourceRoot)
  const existingTask = readPackageSetBuildTask({ projectRoot, projectId, logicalTaskId })
  if (existingTask !== null && existingTask.sourceReceiptHash !== currentSourceReceiptHash) {
    throw packageSetError('PACKAGE_SET_TASK_SOURCE_CHANGED', `logical task ${logicalTaskId} already claimed a different source; update current-state to an explicitly approved new task before another physical build.`)
  }
  if (existingTask?.status === 'failed') {
    throw packageSetError('PACKAGE_SET_TASK_PREVIOUSLY_FAILED', `logical task ${logicalTaskId} already failed its one build attempt; no automatic retry is allowed.`)
  }
  const reusable = findReusablePackageSet({ projectRoot, sourceRoot: buildSourceRoot, packageSetsRoot })
  if (reusable !== null) {
    const provenance = recordPackageSetProvenance({ projectRoot, sourceRoot: buildSourceRoot, root: reusable.root, receipt: reusable.receipt })
    const lifecycle = reconcileManagedPackageSets({ projectRoot, activeRoot: reusable.root })
    let packageSetTask = existingTask
    if (existingTask?.status === 'claimed') {
      const marker = readJson(join(reusable.root, 'package-set.json'))
      packageSetTask = completePackageSetBuildTask({
        projectRoot,
        projectId,
        logicalTaskId,
        sourceReceiptHash: currentSourceReceiptHash,
        packageSetTreeHash: reusable.receipt.packageSetTreeHash,
        physicalCreated: (marker.logicalTaskId ?? marker.operationId) === logicalTaskId,
      }).claim
    }
    return { ...reusable, provenance, lifecycle, packageSetTask }
  }

  mkdirSync(join(packageSetsRoot, '.staging'), { recursive: true })
  const disk = statfsSync(packageSetsRoot)
  const freeBytes = Number(disk.bavail) * Number(disk.bsize)
  if (!Number.isFinite(freeBytes) || freeBytes < minimumFreeBytes) {
    throw new Error(`Package-set preflight failed: ${freeBytes} free bytes is below ${minimumFreeBytes}.`)
  }
  const lifecycleBefore = reconcileManagedPackageSets({ projectRoot })
  const lifecyclePreflight = evaluateLargeRunPreflight({
    projectRoot,
    projectId: lifecycleBefore.projectId,
    expectedBytes: ONE_GIB,
    freeBytes,
  })
  if (!lifecyclePreflight.ok) {
    throw new Error(`Package-set lifecycle preflight failed: ${lifecyclePreflight.issues.map(issue => issue.code).join(', ')}`)
  }
  const stagingRoot = join(packageSetsRoot, '.staging', logicalTaskId)
  assertOwnedStagingPath(packageSetsRoot, stagingRoot)
  if (existsSync(stagingRoot)) throw new Error(`Package-set staging path already exists: ${stagingRoot}`)
  claimPackageSetBuildTask({
    projectRoot,
    projectId: lifecycleBefore.projectId,
    logicalTaskId,
    sourceReceiptHash: currentSourceReceiptHash,
  })

  let finalized = false
  let taskCompleted = false
  try {
    const result = spawnSync(process.execPath, ['scripts/pack-desktop.js', 'stable', 'dir'], {
      cwd: buildSourceRoot,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 900_000,
      maxBuffer: 20 * 1024 * 1024,
      env: { ...process.env, DSH_ARTIFACT_DIR: stagingRoot, DSH_MANAGED_PROJECT_ROOT: resolve(projectRoot) },
    })
    if (result.status !== 0) {
      throw new Error(`Managed package-set build failed (${String(result.status)}).\n${result.stderr || result.stdout}`)
    }
    const stagingPaths = packageSetPaths(stagingRoot)
    const receipt = readJson(stagingPaths.receiptPath)
    if (receipt === null) throw new Error('Managed package-set build did not write a receipt.')
    const verification = verifyBuildReceipt({
      projectRoot: buildSourceRoot,
      receipt,
      exePath: stagingPaths.exePath,
      packagedAppDir: stagingPaths.appDir,
      expectedFlavor: 'stable',
    })
    if (!verification.ok) {
      throw new Error(`Managed package-set verification failed: ${verification.issues.join('; ')}`)
    }
    const finalRoot = join(packageSetsRoot, packageSetDirectoryName(receipt.packageSetTreeHash))
    if (existsSync(finalRoot)) {
      const collision = verifyManagedPackageSetWithReceipt({ projectRoot, sourceRoot: buildSourceRoot, root: finalRoot, receipt })
      if (collision === null) throw new Error(`Managed package-set destination exists with different or invalid bytes: ${finalRoot}`)
      const provenance = recordPackageSetProvenance({ projectRoot, sourceRoot: buildSourceRoot, root: finalRoot, receipt })
      const lifecycle = reconcileManagedPackageSets({ projectRoot, activeRoot: finalRoot })
      const packageSetTask = completePackageSetBuildTask({
        projectRoot,
        projectId: lifecycleBefore.projectId,
        logicalTaskId,
        sourceReceiptHash: currentSourceReceiptHash,
        packageSetTreeHash: receipt.packageSetTreeHash,
        physicalCreated: false,
      }).claim
      taskCompleted = true
      return { ...collision, reusedAfterBuild: true, provenance, lifecyclePreflight, lifecycle, packageSetTask }
    }
    writeFileSync(join(stagingRoot, 'package-set.json'), `${JSON.stringify({
      schemaVersion: 'managed-package-set/v1',
      projectId: lifecycleBefore.projectId,
      objectId: `pkg_${receipt.packageSetTreeHash}`,
      packageSetTreeHash: receipt.packageSetTreeHash,
      packageSetFileCount: receipt.packageSetFileCount,
      sourceFiles: receipt.sourceFiles,
      createdAt: new Date().toISOString(),
      operationId: logicalTaskId,
      logicalTaskId,
      immutabilityMode: 'hash-guarded-runtime-no-writes',
    }, null, 2)}\n`, 'utf8')
    renameSync(stagingRoot, finalRoot)
    finalized = true
    const provenance = recordPackageSetProvenance({ projectRoot, sourceRoot: buildSourceRoot, root: finalRoot, receipt })
    const lifecycle = reconcileManagedPackageSets({ projectRoot, activeRoot: finalRoot })
    const packageSetTask = completePackageSetBuildTask({
      projectRoot,
      projectId: lifecycleBefore.projectId,
      logicalTaskId,
      sourceReceiptHash: currentSourceReceiptHash,
      packageSetTreeHash: receipt.packageSetTreeHash,
      physicalCreated: true,
    }).claim
    taskCompleted = true
    return { ...packageSetPaths(finalRoot), receipt, verification, reused: false, freeBytesAtPreflight: freeBytes, provenance, lifecyclePreflight, lifecycle, packageSetTask }
  } catch (error) {
    if (!taskCompleted) {
      try {
        failPackageSetBuildTask({
          projectRoot,
          projectId: lifecycleBefore.projectId,
          logicalTaskId,
          sourceReceiptHash: currentSourceReceiptHash,
          failureCode: typeof error?.code === 'string' ? error.code : 'PACKAGE_SET_BUILD_FAILED',
        })
      } catch {
        // Preserve the original build failure; the immutable claim still prevents an automatic retry.
      }
    }
    throw error
  } finally {
    if (!finalized && existsSync(stagingRoot)) {
      assertOwnedStagingPath(packageSetsRoot, stagingRoot)
      rmSync(stagingRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    }
  }
}
