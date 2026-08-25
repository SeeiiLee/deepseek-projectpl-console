import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statfsSync,
  writeFileSync,
} from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'

import { verifyBuildReceipt } from './build-receipt.mjs'

const FIVE_GIB = 5 * 1024 * 1024 * 1024
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

export function verifyManagedPackageSet({ projectRoot, root }) {
  const paths = packageSetPaths(root)
  const receipt = readJson(paths.receiptPath)
  if (receipt === null || typeof receipt.packageSetTreeHash !== 'string') return null
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

export function findReusablePackageSet({
  projectRoot,
  packageSetsRoot = resolveManagedPackageSetsRoot(projectRoot),
}) {
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
  if (reusable !== null) return reusable

  mkdirSync(join(packageSetsRoot, '.staging'), { recursive: true })
  const disk = statfsSync(packageSetsRoot)
  const freeBytes = Number(disk.bavail) * Number(disk.bsize)
  if (!Number.isFinite(freeBytes) || freeBytes < minimumFreeBytes) {
    throw new Error(`Package-set preflight failed: ${freeBytes} free bytes is below ${minimumFreeBytes}.`)
  }
  if (!/^[a-z0-9][a-z0-9._-]{0,95}$/iu.test(operationId)) {
    throw new Error('Package-set operationId is invalid.')
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
    const existing = existsSync(finalRoot) ? verifyManagedPackageSet({ projectRoot, root: finalRoot }) : null
    if (existing !== null) return existing
    if (existsSync(finalRoot)) {
      throw new Error(`Managed package-set destination exists but is invalid: ${finalRoot}`)
    }
    writeFileSync(join(stagingRoot, 'package-set.json'), `${JSON.stringify({
      schemaVersion: 'managed-package-set/v1',
      packageSetTreeHash: receipt.packageSetTreeHash,
      packageSetFileCount: receipt.packageSetFileCount,
      sourceFiles: receipt.sourceFiles,
      createdAt: new Date().toISOString(),
      operationId,
      immutabilityMode: 'hash-guarded-runtime-no-writes',
    }, null, 2)}\n`, 'utf8')
    renameSync(stagingRoot, finalRoot)
    finalized = true
    return { ...packageSetPaths(finalRoot), receipt, verification, reused: false, freeBytesAtPreflight: freeBytes }
  } finally {
    if (!finalized && existsSync(stagingRoot)) {
      assertOwnedStagingPath(packageSetsRoot, stagingRoot)
      rmSync(stagingRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    }
  }
}
