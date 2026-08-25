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
  evaluateLargeRunPreflight,
  installRetentionPolicy,
  readLocalRegistry,
  registerLocalObject,
  resolveLocalLifecyclePaths,
} from './local-lifecycle.mjs'

const FIVE_GIB = 5 * 1024 * 1024 * 1024
const ONE_GIB = 1024 * 1024 * 1024
const PACKAGE_HASH_PATTERN = /^[A-Fa-f0-9]{64}$/u

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

function verifyManagedPackageSetWithReceipt({ projectRoot, root, receipt }) {
  const paths = packageSetPaths(root)
  if (receipt === null || typeof receipt?.packageSetTreeHash !== 'string') return null
  if (packageSetDirectoryName(receipt.packageSetTreeHash) !== root.split(/[\\/]/u).at(-1)?.toLowerCase()) return null
  const verification = verifyBuildReceipt({
    projectRoot,
    receipt,
    exePath: paths.exePath,
    packagedAppDir: paths.appDir,
    expectedFlavor: 'stable',
  })
  if (!verification.ok) return null
  return { ...paths, receipt, verification, reused: true }
}

export function recordPackageSetProvenance({ projectRoot, root, receipt }) {
  const verified = verifyManagedPackageSetWithReceipt({ projectRoot, root, receipt })
  if (verified === null) throw new Error(`Package-set provenance does not verify against immutable package bytes: ${root}`)
  const { projectId } = projectIdentity(projectRoot)
  const currentSourceHash = sourceReceiptHash(projectRoot)
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

function findProvenancePackageSet({ projectRoot, packageSetsRoot }) {
  const hash = sourceReceiptHash(projectRoot)
  const path = join(provenanceRoot(projectRoot), `sha256-${hash}.json`)
  if (!existsSync(path)) return null
  const provenance = readJson(path)
  const { projectId } = projectIdentity(projectRoot)
  if (provenance?.schemaVersion !== 'managed-package-set-provenance/v1' || provenance.projectId !== projectId || provenance.sourceReceiptHash !== hash) {
    throw new Error(`Managed package-set provenance is invalid: ${path}`)
  }
  const root = join(packageSetsRoot, packageSetDirectoryName(provenance.packageSetTreeHash))
  const verified = verifyManagedPackageSetWithReceipt({ projectRoot, root, receipt: provenance.buildReceipt })
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
  const result = registerLocalObject({
    projectRoot,
    projectId,
    object: {
      objectId,
      kind: 'package-set',
      relativePath: `package-sets/${rel}`,
      ownerId: 'managed-package-set',
      taskId: marker.operationId,
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
  const registered = []
  for (const root of roots) {
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
  return { projectId, registered, registry: readLocalRegistry({ projectRoot, projectId }) }
}

export function verifyManagedPackageSet({ projectRoot, root }) {
  const paths = packageSetPaths(root)
  const receipt = readJson(paths.receiptPath)
  return verifyManagedPackageSetWithReceipt({ projectRoot, root, receipt })
}

export function findReusablePackageSet({
  projectRoot,
  packageSetsRoot = resolveManagedPackageSetsRoot(projectRoot),
}) {
  const provenance = findProvenancePackageSet({ projectRoot, packageSetsRoot })
  if (provenance !== null) return provenance
  if (!existsSync(packageSetsRoot)) return null
  const candidates = readdirSync(packageSetsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name.startsWith('sha256-'))
    .map(entry => join(packageSetsRoot, entry.name))
    .sort()
  for (const root of candidates) {
    const verified = verifyManagedPackageSet({ projectRoot, root })
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
  packageSetsRoot = resolveManagedPackageSetsRoot(projectRoot),
  minimumFreeBytes = FIVE_GIB,
  operationId = `op-package-set-${Date.now()}`,
} = {}) {
  const reusable = findReusablePackageSet({ projectRoot, packageSetsRoot })
  if (reusable !== null) {
    const provenance = recordPackageSetProvenance({ projectRoot, root: reusable.root, receipt: reusable.receipt })
    const lifecycle = reconcileManagedPackageSets({ projectRoot, activeRoot: reusable.root })
    return { ...reusable, provenance, lifecycle }
  }

  mkdirSync(join(packageSetsRoot, '.staging'), { recursive: true })
  const disk = statfsSync(packageSetsRoot)
  const freeBytes = Number(disk.bavail) * Number(disk.bsize)
  if (!Number.isFinite(freeBytes) || freeBytes < minimumFreeBytes) {
    throw new Error(`Package-set preflight failed: ${freeBytes} free bytes is below ${minimumFreeBytes}.`)
  }
  if (!/^[a-z0-9][a-z0-9._-]{0,95}$/iu.test(operationId)) {
    throw new Error('Package-set operationId is invalid.')
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
  const stagingRoot = join(packageSetsRoot, '.staging', operationId)
  assertOwnedStagingPath(packageSetsRoot, stagingRoot)
  if (existsSync(stagingRoot)) throw new Error(`Package-set staging path already exists: ${stagingRoot}`)

  let finalized = false
  try {
    const result = spawnSync(process.execPath, ['scripts/pack-desktop.js', 'stable', 'dir'], {
      cwd: projectRoot,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 900_000,
      maxBuffer: 20 * 1024 * 1024,
      env: { ...process.env, DSH_ARTIFACT_DIR: stagingRoot },
    })
    if (result.status !== 0) {
      throw new Error(`Managed package-set build failed (${String(result.status)}).\n${result.stderr || result.stdout}`)
    }
    const stagingPaths = packageSetPaths(stagingRoot)
    const receipt = readJson(stagingPaths.receiptPath)
    if (receipt === null) throw new Error('Managed package-set build did not write a receipt.')
    const verification = verifyBuildReceipt({
      projectRoot,
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
      const collision = verifyManagedPackageSetWithReceipt({ projectRoot, root: finalRoot, receipt })
      if (collision === null) throw new Error(`Managed package-set destination exists with different or invalid bytes: ${finalRoot}`)
      const provenance = recordPackageSetProvenance({ projectRoot, root: finalRoot, receipt })
      const lifecycle = reconcileManagedPackageSets({ projectRoot, activeRoot: finalRoot })
      return { ...collision, reusedAfterBuild: true, provenance, lifecyclePreflight, lifecycle }
    }
    writeFileSync(join(stagingRoot, 'package-set.json'), `${JSON.stringify({
      schemaVersion: 'managed-package-set/v1',
      projectId: lifecycleBefore.projectId,
      objectId: `pkg_${receipt.packageSetTreeHash}`,
      packageSetTreeHash: receipt.packageSetTreeHash,
      packageSetFileCount: receipt.packageSetFileCount,
      sourceFiles: receipt.sourceFiles,
      createdAt: new Date().toISOString(),
      operationId,
      immutabilityMode: 'hash-guarded-runtime-no-writes',
    }, null, 2)}\n`, 'utf8')
    renameSync(stagingRoot, finalRoot)
    finalized = true
    const provenance = recordPackageSetProvenance({ projectRoot, root: finalRoot, receipt })
    const lifecycle = reconcileManagedPackageSets({ projectRoot, activeRoot: finalRoot })
    return { ...packageSetPaths(finalRoot), receipt, verification, reused: false, freeBytesAtPreflight: freeBytes, provenance, lifecyclePreflight, lifecycle }
  } finally {
    if (!finalized && existsSync(stagingRoot)) {
      assertOwnedStagingPath(packageSetsRoot, stagingRoot)
      rmSync(stagingRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    }
  }
}
