// scripts/build-receipt.mjs
// Build receipt for packaged artifacts. Used by pack-desktop.js to record what
// source produced an EXE and what the packaged resources/app tree contains.
// Stable packed E2E verifies the receipt before trusting an existing EXE.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { EXPECTED_HARNESS_COMMIT } from './build-kit.mjs'
import { DEV_E2E_DRIVER_SCHEMA_VERSION, DEV_E2E_DRIVER_VERSION } from '../src/dev-e2e-driver.js'

export const RECEIPT_SCHEMA_VERSION = 3

export const RECEIPT_SOURCE_FILES = Object.freeze([
  'package.json',
  'plugin-set.lock.json',
  'src/main.js',
  'src/boot-log.js',
  'src/update-service.js',
  'src/update-core.js',
  'src/dev-e2e-driver.js',
  'src/personal-plugins.js',
  'src/personal-plugin-validation.js',
  'src/harness-helper.js',
  'src/harness-process.js',
  'src/desktop-bridge.js',
  'src/preload.cjs',
  'src/app-flavor.js',
  'src/build-flavor.js',
  'scripts/build-plugins.js',
  'scripts/pack-desktop.js',
  'scripts/package-set.mjs',
  'scripts/local-lifecycle.mjs',
  'scripts/apply-harness-tsdown-fallback.mjs',
])

const PACKAGED_EXCLUDE_RELATIVE = new Set()

export function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

export function createSourceReceipt(projectRoot) {
  const packageManifest = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'))
  const sourceFiles = {}
  for (const file of RECEIPT_SOURCE_FILES) {
    const absolute = join(projectRoot, file)
    if (!existsSync(absolute)) throw new Error(`Build receipt source file missing: ${absolute}`)
    sourceFiles[file] = sha256File(absolute)
  }
  return {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    clientVersion: packageManifest.version,
    harnessCommit: EXPECTED_HARNESS_COMMIT,
    sourceFiles,
  }
}

/**
 * Deterministic hash of a directory tree.
 * Walks all files, sorts by relative posix path, and hashes
 * `<relative>\0<fileSha256>\n` lines.
 */
export function hashTree(directory, { excludeRelative = PACKAGED_EXCLUDE_RELATIVE } = {}) {
  const files = []
  const walk = current => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolute = join(current, entry.name)
      const rel = relative(directory, absolute).split(sep).join('/')
      if (entry.isDirectory()) {
        walk(absolute)
      } else if (entry.isFile()) {
        if (!excludeRelative.has(rel)) files.push(rel)
      }
    }
  }
  walk(directory)
  files.sort()
  const hash = createHash('sha256')
  for (const rel of files) {
    hash.update(`${rel}\0`)
    hash.update(sha256File(join(directory, ...rel.split('/'))))
    hash.update('\n')
  }
  return { hash: hash.digest('hex'), fileCount: files.length }
}

export function writeBuildReceipt({ projectRoot, flavor, exePath, packagedAppDir, receiptPath, e2eBuild = false, installerSha256 }) {
  const packagedTree = hashTree(packagedAppDir)
  const packageSetTree = hashTree(dirname(exePath))
  const receipt = {
    ...createSourceReceipt(projectRoot),
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    flavor,
    e2eBuild,
    clientVersion: JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')).version,
    driverSchemaVersion: DEV_E2E_DRIVER_SCHEMA_VERSION,
    driverVersion: DEV_E2E_DRIVER_VERSION,
    generatedAt: new Date().toISOString(),
    exeSha256: sha256File(exePath),
    ...(installerSha256 === undefined ? {} : { installerSha256 }),
    packagedTreeHash: packagedTree.hash,
    packagedFileCount: packagedTree.fileCount,
    packageSetTreeHash: packageSetTree.hash,
    packageSetFileCount: packageSetTree.fileCount,
  }
  const resolvedReceiptPath = receiptPath ?? join(resolve(projectRoot), 'artifacts', 'build-receipt.json')
  writeFileSync(resolvedReceiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: 'utf8' })
  return { ...receipt, path: resolvedReceiptPath }
}

export function verifyBuildReceipt({
  projectRoot,
  receipt,
  exePath,
  packagedAppDir,
  expectedFlavor = 'stable',
  expectedE2eBuild,
}) {
  const issues = []
  if (typeof receipt !== 'object' || receipt === null) {
    return { ok: false, issues: ['build receipt is missing or not an object'] }
  }
  if (receipt.schemaVersion !== RECEIPT_SCHEMA_VERSION) {
    issues.push(`build receipt schemaVersion ${receipt.schemaVersion} != ${RECEIPT_SCHEMA_VERSION}`)
  }
  if (receipt.flavor !== expectedFlavor) {
    issues.push(`build receipt flavor ${receipt.flavor} != expected ${expectedFlavor}`)
  }
  if (expectedE2eBuild !== undefined && receipt.e2eBuild !== expectedE2eBuild) {
    issues.push(`build receipt e2eBuild ${receipt.e2eBuild} != expected ${expectedE2eBuild}`)
  }
  if (expectedE2eBuild === true) {
    if (receipt.driverSchemaVersion !== DEV_E2E_DRIVER_SCHEMA_VERSION) {
      issues.push(`build receipt driverSchemaVersion ${receipt.driverSchemaVersion} != ${DEV_E2E_DRIVER_SCHEMA_VERSION}`)
    }
    if (receipt.driverVersion !== DEV_E2E_DRIVER_VERSION) {
      issues.push(`build receipt driverVersion ${receipt.driverVersion} != ${DEV_E2E_DRIVER_VERSION}`)
    }
  }
  if (!existsSync(exePath)) {
    issues.push(`packaged exe does not exist: ${exePath}`)
  }
  if (!existsSync(packagedAppDir)) {
    issues.push(`packaged resources/app does not exist: ${packagedAppDir}`)
  }
  let expected
  try {
    expected = createSourceReceipt(projectRoot)
  } catch (error) {
    return { ok: false, issues: [error.message] }
  }
  if (receipt.clientVersion !== expected.clientVersion) {
    issues.push(`clientVersion ${receipt.clientVersion} != ${expected.clientVersion}`)
  }
  if (receipt.harnessCommit !== expected.harnessCommit) {
    issues.push(`harnessCommit ${receipt.harnessCommit} != ${expected.harnessCommit}`)
  }
  const expectedFiles = expected.sourceFiles
  const actualFiles = receipt.sourceFiles
  if (typeof actualFiles !== 'object' || actualFiles === null) {
    issues.push('build receipt sourceFiles missing')
  } else {
    for (const file of RECEIPT_SOURCE_FILES) {
      if (actualFiles[file] !== expectedFiles[file]) {
        issues.push(`source file hash mismatch: ${file}`)
      }
    }
  }
  if (existsSync(exePath)) {
    const currentExeSha = sha256File(exePath)
    if (receipt.exeSha256 !== currentExeSha) {
      issues.push(`exe sha256 mismatch: receipt ${receipt.exeSha256} != current ${currentExeSha}`)
    }
  }
  if (existsSync(packagedAppDir)) {
    const currentTree = hashTree(packagedAppDir)
    if (receipt.packagedTreeHash !== currentTree.hash) {
      issues.push(`packaged resources/app tree hash mismatch: receipt ${receipt.packagedTreeHash} != current ${currentTree.hash}`)
    }
    if (receipt.packagedFileCount !== currentTree.fileCount) {
      issues.push(`packaged resources/app file count mismatch: receipt ${receipt.packagedFileCount} != current ${currentTree.fileCount}`)
    }
    const flavorFile = join(packagedAppDir, 'src', 'build-flavor.js')
    if (!existsSync(flavorFile)) {
      issues.push('packaged resources/app/src/build-flavor.js missing')
    } else {
      const flavorText = readFileSync(flavorFile, 'utf8')
      if (expectedFlavor === 'stable' && !flavorText.includes("'stable'")) {
        issues.push('packaged resources/app build-flavor is not stable')
      }
      if (expectedFlavor === 'dev' && !flavorText.includes("'dev'")) {
        issues.push('packaged resources/app build-flavor is not dev')
      }
    }
  }
  const packageSetRoot = dirname(exePath)
  if (existsSync(packageSetRoot)) {
    const currentPackageSet = hashTree(packageSetRoot)
    if (receipt.packageSetTreeHash !== currentPackageSet.hash) {
      issues.push(`package-set tree hash mismatch: receipt ${String(receipt.packageSetTreeHash)} != current ${currentPackageSet.hash}`)
    }
    if (receipt.packageSetFileCount !== currentPackageSet.fileCount) {
      issues.push(`package-set file count mismatch: receipt ${String(receipt.packageSetFileCount)} != current ${currentPackageSet.fileCount}`)
    }
  }
  return { ok: issues.length === 0, issues }
}
