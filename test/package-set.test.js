import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { RECEIPT_SOURCE_FILES, hashTree, writeBuildReceipt } from '../scripts/build-receipt.mjs'
import { readLocalRegistry } from '../scripts/local-lifecycle.mjs'
import { findReusablePackageSet, packageSetDirectoryName, reconcileManagedPackageSets, recordPackageSetProvenance } from '../scripts/package-set.mjs'

const PROJECT_ID = 'prj_01a0082e-fea8-7d6f-b6c2-08a259fba389'

function write(path, content) {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content, 'utf8')
}

function makeProjectAndSet() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-package-set-'))
  const projectRoot = join(root, 'workspace')
  const setsRoot = join(root, 'local', 'package-sets')
  write(join(root, '.project-home', 'project-home.json'), `${JSON.stringify({
    schemaVersion: 'project-home/v1',
    projectId: PROJECT_ID,
    slug: 'fixture',
    zones: { workspace: 'workspace', worktrees: 'worktrees', local: 'local' },
    createdAt: '2026-08-25T00:00:00.000Z',
  }, null, 2)}\n`)
  for (const file of RECEIPT_SOURCE_FILES) {
    const content = file === 'package.json'
      ? JSON.stringify({ name: 'fixture', version: '0.4.5' })
      : file === 'src/build-flavor.js'
        ? "export const BUILD_FLAVOR = 'stable'\n"
        : `${file}\n`
    write(join(projectRoot, file), content)
  }
  const staging = join(setsRoot, '.staging', 'fixture')
  const appDir = join(staging, 'win-unpacked', 'resources', 'app')
  const exePath = join(staging, 'win-unpacked', 'DeepSeek Harness Personal.exe')
  write(join(appDir, 'src', 'build-flavor.js'), "export const BUILD_FLAVOR = 'stable'\n")
  write(join(appDir, 'src', 'main.js'), 'main\n')
  write(join(staging, 'win-unpacked', 'resources.pak'), 'resources\n')
  write(exePath, 'exe\n')
  const receipt = writeBuildReceipt({
    projectRoot,
    flavor: 'stable',
    exePath,
    packagedAppDir: appDir,
    receiptPath: join(staging, 'build-receipt.json'),
  })
  const finalRoot = join(setsRoot, packageSetDirectoryName(receipt.packageSetTreeHash))
  mkdirSync(setsRoot, { recursive: true })
  renameSync(staging, finalRoot)
  write(join(finalRoot, 'package-set.json'), `${JSON.stringify({
    schemaVersion: 'managed-package-set/v1',
    packageSetTreeHash: receipt.packageSetTreeHash,
    packageSetFileCount: receipt.packageSetFileCount,
    createdAt: '2026-08-25T00:00:00.000Z',
    operationId: 'fixture-package-set',
    immutabilityMode: 'hash-guarded-runtime-no-writes',
  }, null, 2)}\n`)
  return { root, projectRoot, setsRoot, finalRoot }
}

test('managed package-set lookup reuses an exact source and complete package receipt', () => {
  const fixture = makeProjectAndSet()
  try {
    const result = findReusablePackageSet({
      projectRoot: fixture.projectRoot,
      packageSetsRoot: fixture.setsRoot,
    })
    assert.equal(result?.root, fixture.finalRoot)
    assert.equal(result?.reused, true)
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('managed package-set lookup fails closed after non-app package bytes drift', () => {
  const fixture = makeProjectAndSet()
  try {
    writeFileSync(join(fixture.finalRoot, 'win-unpacked', 'resources.pak'), 'tampered\n')
    assert.equal(findReusablePackageSet({
      projectRoot: fixture.projectRoot,
      packageSetsRoot: fixture.setsRoot,
    }), null)
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('managed package-set reconciliation registers existing sets without changing package bytes', () => {
  const fixture = makeProjectAndSet()
  try {
    const before = hashTree(join(fixture.finalRoot, 'win-unpacked'))
    const result = reconcileManagedPackageSets({ projectRoot: fixture.projectRoot })
    const after = hashTree(join(fixture.finalRoot, 'win-unpacked'))
    assert.deepEqual(after, before)
    assert.equal(result.registered.length, 1)
    const registry = readLocalRegistry({ projectRoot: fixture.projectRoot, projectId: PROJECT_ID })
    assert.equal(registry.objects.length, 1)
    assert.equal(registry.objects[0].kind, 'package-set')
    assert.equal(registry.objects[0].status, 'RETIRED')
    assert.equal(registry.objects[0].sourceHashes.packageSetTreeHash, before.hash)
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('managed package-set reconciliation marks exactly the selected set ACTIVE', () => {
  const fixture = makeProjectAndSet()
  try {
    reconcileManagedPackageSets({ projectRoot: fixture.projectRoot, activeRoot: fixture.finalRoot, now: '2026-08-25T01:00:00.000Z' })
    const registry = readLocalRegistry({ projectRoot: fixture.projectRoot, projectId: PROJECT_ID })
    assert.equal(registry.objects[0].status, 'ACTIVE')
    assert.equal(registry.objects[0].lastUsedAt, '2026-08-25T01:00:00.000Z')
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('source provenance reuses identical immutable package bytes without duplicating the package set', () => {
  const fixture = makeProjectAndSet()
  try {
    const before = hashTree(join(fixture.finalRoot, 'win-unpacked'))
    write(join(fixture.projectRoot, 'scripts', 'local-lifecycle.mjs'), 'changed lifecycle source\n')
    assert.equal(findReusablePackageSet({ projectRoot: fixture.projectRoot, packageSetsRoot: fixture.setsRoot }), null)
    const receipt = writeBuildReceipt({
      projectRoot: fixture.projectRoot,
      flavor: 'stable',
      exePath: join(fixture.finalRoot, 'win-unpacked', 'DeepSeek Harness Personal.exe'),
      packagedAppDir: join(fixture.finalRoot, 'win-unpacked', 'resources', 'app'),
      receiptPath: join(fixture.root, 'new-build-receipt.json'),
    })
    const provenance = recordPackageSetProvenance({ projectRoot: fixture.projectRoot, root: fixture.finalRoot, receipt })
    assert.equal(provenance.reused, false)
    const reusable = findReusablePackageSet({ projectRoot: fixture.projectRoot, packageSetsRoot: fixture.setsRoot })
    assert.equal(reusable?.root, fixture.finalRoot)
    assert.deepEqual(hashTree(join(fixture.finalRoot, 'win-unpacked')), before)
    assert.equal(readdirSync(fixture.setsRoot).filter(name => name.startsWith('sha256-')).length, 1)
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})
