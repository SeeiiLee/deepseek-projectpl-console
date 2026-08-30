import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { RECEIPT_SOURCE_FILES, hashTree, writeBuildReceipt } from '../scripts/build-receipt.mjs'
import { readLocalRegistry, updateLocalObjectLifecycle } from '../scripts/local-lifecycle.mjs'
import {
  findReusablePackageSet,
  packageSetDirectoryName,
  reconcileManagedPackageSets,
  recordPackageSetProvenance,
  resolvePackedLogicalTaskId,
} from '../scripts/package-set.mjs'

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
    projectId: PROJECT_ID,
    objectId: `pkg_${receipt.packageSetTreeHash}`,
    packageSetTreeHash: receipt.packageSetTreeHash,
    packageSetFileCount: receipt.packageSetFileCount,
    createdAt: '2026-08-25T00:00:00.000Z',
    operationId: 'fixture-package-set',
    immutabilityMode: 'hash-guarded-runtime-no-writes',
  }, null, 2)}\n`)
  return { root, projectRoot, setsRoot, finalRoot }
}

function rewriteBuildReceiptSchema(fixture, schemaVersion) {
  const receiptPath = join(fixture.finalRoot, 'build-receipt.json')
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'))
  writeFileSync(receiptPath, `${JSON.stringify({ ...receipt, schemaVersion }, null, 2)}\n`, 'utf8')
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

test('managed package-set reconciliation preserves registered QUARANTINED and PINNED legacy evidence without re-registration', () => {
  for (const status of ['QUARANTINED', 'PINNED']) {
    const fixture = makeProjectAndSet()
    try {
      const first = reconcileManagedPackageSets({ projectRoot: fixture.projectRoot })
      const objectId = first.registered[0].object.objectId
      updateLocalObjectLifecycle({
        projectRoot: fixture.projectRoot,
        projectId: PROJECT_ID,
        objectId,
        status,
        lastUsedAt: '2026-08-25T02:00:00.000Z',
      })
      rewriteBuildReceiptSchema(fixture, 2)
      const registryBefore = readLocalRegistry({ projectRoot: fixture.projectRoot, projectId: PROJECT_ID })
      const receiptBefore = readFileSync(join(fixture.finalRoot, 'build-receipt.json'))
      const result = reconcileManagedPackageSets({ projectRoot: fixture.projectRoot })
      const registryAfter = readLocalRegistry({ projectRoot: fixture.projectRoot, projectId: PROJECT_ID })

      assert.equal(result.registered.length, 0)
      assert.equal(result.preserved.length, 1)
      assert.equal(result.preserved[0].object.objectId, objectId)
      assert.equal(result.preserved[0].object.status, status)
      assert.deepEqual(registryAfter, registryBefore)
      assert.deepEqual(readFileSync(join(fixture.finalRoot, 'build-receipt.json')), receiptBefore)
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  }
})

test('managed package-set reconciliation rejects an unknown legacy package set', () => {
  const fixture = makeProjectAndSet()
  try {
    rewriteBuildReceiptSchema(fixture, 2)
    assert.throws(
      () => reconcileManagedPackageSets({ projectRoot: fixture.projectRoot }),
      /marker or build receipt is invalid/u,
    )
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('managed package-set reconciliation rejects ACTIVE legacy package-set evidence', () => {
  const fixture = makeProjectAndSet()
  try {
    reconcileManagedPackageSets({ projectRoot: fixture.projectRoot, activeRoot: fixture.finalRoot })
    rewriteBuildReceiptSchema(fixture, 2)
    assert.throws(
      () => reconcileManagedPackageSets({ projectRoot: fixture.projectRoot }),
      /marker or build receipt is invalid/u,
    )
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('managed package-set reconciliation rejects preserved evidence after marker identity drift', () => {
  const fixture = makeProjectAndSet()
  try {
    const first = reconcileManagedPackageSets({ projectRoot: fixture.projectRoot })
    updateLocalObjectLifecycle({
      projectRoot: fixture.projectRoot,
      projectId: PROJECT_ID,
      objectId: first.registered[0].object.objectId,
      status: 'QUARANTINED',
      lastUsedAt: '2026-08-25T02:00:00.000Z',
    })
    rewriteBuildReceiptSchema(fixture, 2)
    const markerPath = join(fixture.finalRoot, 'package-set.json')
    const marker = JSON.parse(readFileSync(markerPath, 'utf8'))
    writeFileSync(markerPath, `${JSON.stringify({ ...marker, projectId: 'prj_01a0000-bad-identity-drift' }, null, 2)}\n`, 'utf8')
    assert.throws(
      () => reconcileManagedPackageSets({ projectRoot: fixture.projectRoot }),
      /preserved package-set identity is invalid/u,
    )
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

test('packed logical task identity comes from an isolated source checkout while project identity stays canonical', () => {
  const fixture = makeProjectAndSet()
  try {
    const sourceRoot = join(fixture.root, 'worktrees', 'isolated-source')
    write(join(sourceRoot, 'docs', 'governance', 'current-state.json'), `${JSON.stringify({
      schemaVersion: 'current-state/v1',
      projectId: PROJECT_ID,
      nextTask: { id: 'B-G4-RC16-PACKED-CHECKOUT-ISOLATION-CLOSURE' },
    }, null, 2)}\n`)
    assert.equal(resolvePackedLogicalTaskId({
      projectRoot: fixture.projectRoot,
      stateRoot: sourceRoot,
      env: {},
    }), 'B-G4-RC16-PACKED-CHECKOUT-ISOLATION-CLOSURE')
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('package-set provenance separates the isolated source checkout from canonical lifecycle storage', () => {
  const fixture = makeProjectAndSet()
  try {
    const sourceRoot = join(fixture.root, 'worktrees', 'isolated-source')
    for (const file of RECEIPT_SOURCE_FILES) {
      write(join(sourceRoot, file), readFileSync(join(fixture.projectRoot, file), 'utf8'))
    }
    const receipt = writeBuildReceipt({
      projectRoot: sourceRoot,
      flavor: 'stable',
      exePath: join(fixture.finalRoot, 'win-unpacked', 'DeepSeek Harness Personal.exe'),
      packagedAppDir: join(fixture.finalRoot, 'win-unpacked', 'resources', 'app'),
      receiptPath: join(fixture.root, 'isolated-build-receipt.json'),
    })
    write(join(fixture.projectRoot, 'scripts', 'package-set.mjs'), 'canonical source intentionally differs\n')

    const provenance = recordPackageSetProvenance({
      projectRoot: fixture.projectRoot,
      sourceRoot,
      root: fixture.finalRoot,
      receipt,
    })
    assert.equal(provenance.reused, false)
    const reusable = findReusablePackageSet({
      projectRoot: fixture.projectRoot,
      sourceRoot,
      packageSetsRoot: fixture.setsRoot,
    })
    assert.equal(reusable?.root, fixture.finalRoot)
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})
