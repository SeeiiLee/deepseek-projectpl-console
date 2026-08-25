import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

import { RECEIPT_SOURCE_FILES, createSourceReceipt, hashTree } from '../scripts/build-receipt.mjs'

const PROJECT_ID = 'prj_01a0082e-fea8-7d6f-b6c2-08a259fba389'
const NOW = '2026-08-25T16:00:00.000Z'

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function makeProject() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-g2-p2-'))
  const projectHome = join(root, 'project')
  const projectRoot = join(projectHome, 'workspace')
  mkdirSync(projectRoot, { recursive: true })
  writeJson(join(projectHome, '.project-home', 'project-home.json'), {
    schemaVersion: 'project-home/v1',
    projectId: PROJECT_ID,
    slug: 'fixture',
    zones: { workspace: 'workspace', worktrees: 'worktrees', local: 'local' },
    createdAt: NOW,
  })
  writeJson(join(projectRoot, 'docs', 'governance', 'current-state.json'), {
    schemaVersion: 'current-state/v1',
    projectId: PROJECT_ID,
    nextTask: { id: 'G2-P2-FIXTURE-TASK', goal: 'fixture' },
  })
  return { root, projectHome, projectRoot, localRoot: join(projectHome, 'local') }
}

function registerFixturePackageSet(lifecycle, fixture, { payload, taskId, status }) {
  const staging = join(fixture.localRoot, 'package-sets', `.fixture-${payload}`)
  mkdirSync(join(staging, 'win-unpacked'), { recursive: true })
  writeFileSync(join(staging, 'win-unpacked', 'payload.bin'), payload, 'utf8')
  const tree = hashTree(join(staging, 'win-unpacked'))
  const objectId = `pkg_${tree.hash}`
  const relativePath = `package-sets/sha256-${tree.hash}`
  const root = join(fixture.localRoot, ...relativePath.split('/'))
  mkdirSync(dirname(root), { recursive: true })
  writeJson(join(staging, 'package-set.json'), {
    schemaVersion: 'managed-package-set/v1',
    projectId: PROJECT_ID,
    objectId,
    packageSetTreeHash: tree.hash,
    createdAt: NOW,
    operationId: taskId,
    logicalTaskId: taskId,
  })
  mkdirSync(root, { recursive: true })
  for (const name of readdirSync(staging)) {
    const source = join(staging, name)
    const target = join(root, name)
    if (name === 'win-unpacked') {
      mkdirSync(target, { recursive: true })
      writeFileSync(join(target, 'payload.bin'), payload, 'utf8')
    } else {
      writeFileSync(target, readFileSync(source))
    }
  }
  rmSync(staging, { recursive: true, force: true })
  lifecycle.registerLocalObject({
    projectRoot: fixture.projectRoot,
    projectId: PROJECT_ID,
    object: {
      objectId,
      kind: 'package-set',
      relativePath,
      ownerId: 'g2-p2-fixture',
      taskId,
      createdAt: NOW,
      lastUsedAt: NOW,
      status,
      retentionClass: 'package-set',
      expectedBytes: Buffer.byteLength(payload),
      markerRelativePath: 'package-set.json',
      sourceHashes: {
        packageSetTreeHash: tree.hash,
        buildReceiptSha256: '0'.repeat(64),
      },
      references: [],
    },
  })
  return { objectId, root, treeHash: tree.hash }
}

function populateReceiptSources(projectRoot) {
  for (const file of RECEIPT_SOURCE_FILES) {
    const content = file === 'package.json'
      ? JSON.stringify({ name: 'fixture', version: '0.4.5' })
      : file === 'src/build-flavor.js'
        ? "export const BUILD_FLAVOR = 'stable'\n"
        : `${file}\n`
    const path = join(projectRoot, ...file.split('/'))
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content, 'utf8')
  }
}

test('packed E2E derives one logical task identity and never uses process.pid as operation identity', () => {
  const source = readFileSync(new URL('./stable-flavor-packed-e2e.test.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /operationId:[^\n]*process\.pid/u)
  assert.match(source, /resolvePackedLogicalTaskId/u)
})

test('packed logical task identity comes from authoritative current-state and rejects an override mismatch', async () => {
  const packageSet = await import('../scripts/package-set.mjs')
  assert.equal(typeof packageSet.resolvePackedLogicalTaskId, 'function')
  const fixture = makeProject()
  try {
    assert.equal(packageSet.resolvePackedLogicalTaskId({ projectRoot: fixture.projectRoot, env: {} }), 'G2-P2-FIXTURE-TASK')
    assert.throws(
      () => packageSet.resolvePackedLogicalTaskId({ projectRoot: fixture.projectRoot, env: { DSH_LOGICAL_TASK_ID: 'OTHER-TASK' } }),
      error => error?.code === 'PACKED_LOGICAL_TASK_ID_MISMATCH',
    )
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('one logical task can claim at most one physical package-set build across invocations', async () => {
  const lifecycle = await import('../scripts/local-lifecycle.mjs')
  assert.equal(typeof lifecycle.claimPackageSetBuildTask, 'function')
  const fixture = makeProject()
  try {
    const first = lifecycle.claimPackageSetBuildTask({
      projectRoot: fixture.projectRoot,
      projectId: PROJECT_ID,
      logicalTaskId: 'G2-P2-FIXTURE-TASK',
      sourceReceiptHash: 'a'.repeat(64),
      now: NOW,
    })
    assert.equal(first.claim.status, 'claimed')
    assert.throws(
      () => lifecycle.claimPackageSetBuildTask({
        projectRoot: fixture.projectRoot,
        projectId: PROJECT_ID,
        logicalTaskId: 'G2-P2-FIXTURE-TASK',
        sourceReceiptHash: 'a'.repeat(64),
        now: NOW,
      }),
      error => error?.code === 'PACKAGE_SET_TASK_ALREADY_CLAIMED',
    )
    assert.throws(
      () => lifecycle.claimPackageSetBuildTask({
        projectRoot: fixture.projectRoot,
        projectId: PROJECT_ID,
        logicalTaskId: 'G2-P2-FIXTURE-TASK',
        sourceReceiptHash: 'b'.repeat(64),
        now: NOW,
      }),
      error => error?.code === 'PACKAGE_SET_TASK_SOURCE_CHANGED',
    )
    const other = lifecycle.claimPackageSetBuildTask({
      projectRoot: fixture.projectRoot,
      projectId: PROJECT_ID,
      logicalTaskId: 'G2-P2-FIXTURE-TASK-2',
      sourceReceiptHash: 'b'.repeat(64),
      now: NOW,
    })
    assert.equal(other.claim.status, 'claimed')
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('managed package-set build fails before packing when a claimed logical task changes source', async () => {
  const lifecycle = await import('../scripts/local-lifecycle.mjs')
  const packageSet = await import('../scripts/package-set.mjs')
  const fixture = makeProject()
  try {
    populateReceiptSources(fixture.projectRoot)
    const sourceReceiptHash = createHash('sha256').update(JSON.stringify(createSourceReceipt(fixture.projectRoot))).digest('hex')
    lifecycle.claimPackageSetBuildTask({
      projectRoot: fixture.projectRoot,
      projectId: PROJECT_ID,
      logicalTaskId: 'G2-P2-FIXTURE-TASK',
      sourceReceiptHash,
      now: NOW,
    })
    writeFileSync(join(fixture.projectRoot, 'scripts', 'package-set.mjs'), 'changed source\n', 'utf8')
    assert.throws(
      () => packageSet.ensureManagedPackageSet({
        projectRoot: fixture.projectRoot,
        logicalTaskId: 'G2-P2-FIXTURE-TASK',
        minimumFreeBytes: 0,
      }),
      error => error?.code === 'PACKAGE_SET_TASK_SOURCE_CHANGED',
    )
    assert.equal(existsSync(join(fixture.localRoot, 'package-sets', '.staging', 'G2-P2-FIXTURE-TASK')), false)
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('logical task claim persists across separate Node processes', () => {
  const fixture = makeProject()
  try {
    const moduleUrl = new URL('../scripts/local-lifecycle.mjs', import.meta.url).href
    const script = `
      import { claimPackageSetBuildTask } from ${JSON.stringify(moduleUrl)};
      try {
        claimPackageSetBuildTask({
          projectRoot: process.argv[1],
          projectId: ${JSON.stringify(PROJECT_ID)},
          logicalTaskId: 'G2-P2-CROSS-PROCESS',
          sourceReceiptHash: 'c'.repeat(64),
          now: ${JSON.stringify(NOW)},
        });
        process.stdout.write('CLAIMED');
      } catch (error) {
        process.stderr.write(String(error?.code ?? error));
        process.exit(17);
      }
    `
    const first = spawnSync(process.execPath, ['--input-type=module', '--eval', script, fixture.projectRoot], { encoding: 'utf8', windowsHide: true })
    const second = spawnSync(process.execPath, ['--input-type=module', '--eval', script, fixture.projectRoot], { encoding: 'utf8', windowsHide: true })
    assert.equal(first.status, 0, first.stderr)
    assert.equal(first.stdout, 'CLAIMED')
    assert.equal(second.status, 17)
    assert.match(second.stderr, /PACKAGE_SET_TASK_ALREADY_CLAIMED/u)
    const snapshots = readdirSync(join(fixture.localRoot, 'ledgers', 'package-set-tasks', 'G2-P2-CROSS-PROCESS'))
    assert.deepEqual(snapshots, ['000000000001.json'])
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('authorized superseded cleanup targets and deletes exactly one retired package set', async () => {
  const lifecycle = await import('../scripts/local-lifecycle.mjs')
  assert.equal(typeof lifecycle.createAuthorizedSupersededPackageSetCleanupPlan, 'function')
  const fixture = makeProject()
  try {
    lifecycle.installRetentionPolicy({ projectRoot: fixture.projectRoot, projectId: PROJECT_ID })
    const target = registerFixturePackageSet(lifecycle, fixture, { payload: 'superseded', taskId: 'B-G4-FIXTURE', status: 'RETIRED' })
    const survivor = registerFixturePackageSet(lifecycle, fixture, { payload: 'current', taskId: 'G2-P2-FIXTURE-TASK', status: 'ACTIVE' })
    const authorizationPath = join(fixture.localRoot, 'receipts', 'fixture-cleanup-authorization.json')
    writeJson(authorizationPath, {
      schemaVersion: 'project-context-receipt/v1',
      projectId: PROJECT_ID,
      authorization: { allowed: [`lifecycle-delete-exact-${target.treeHash}`] },
    })
    const plan = lifecycle.createAuthorizedSupersededPackageSetCleanupPlan({
      projectRoot: fixture.projectRoot,
      projectId: PROJECT_ID,
      operationId: 'fixture-authorized-superseded-cleanup',
      targetObjectId: target.objectId,
      supersededByObjectId: survivor.objectId,
      authorizationReceiptPath: authorizationPath,
      now: NOW,
    })
    assert.deepEqual(plan.targets.map(item => item.objectId), [target.objectId])
    assert.equal(plan.retained.some(item => item.objectId === survivor.objectId), true)
    const receipt = lifecycle.applyCleanupPlan({
      projectRoot: fixture.projectRoot,
      projectId: PROJECT_ID,
      planPath: plan.path,
      now: '2026-08-25T16:01:00.000Z',
    })
    assert.deepEqual(receipt.deleted.map(item => item.objectId), [target.objectId])
    assert.equal(existsSync(target.root), false)
    assert.equal(existsSync(survivor.root), true)
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('authorized superseded cleanup rejects an ACTIVE target before writing a plan', async () => {
  const lifecycle = await import('../scripts/local-lifecycle.mjs')
  assert.equal(typeof lifecycle.createAuthorizedSupersededPackageSetCleanupPlan, 'function')
  const fixture = makeProject()
  try {
    lifecycle.installRetentionPolicy({ projectRoot: fixture.projectRoot, projectId: PROJECT_ID })
    const target = registerFixturePackageSet(lifecycle, fixture, { payload: 'target-active', taskId: 'B-G4-FIXTURE', status: 'ACTIVE' })
    const survivor = registerFixturePackageSet(lifecycle, fixture, { payload: 'other-active', taskId: 'G2-P2-FIXTURE-TASK', status: 'ACTIVE' })
    const authorizationPath = join(fixture.localRoot, 'receipts', 'fixture-active-authorization.json')
    writeJson(authorizationPath, {
      schemaVersion: 'project-context-receipt/v1',
      projectId: PROJECT_ID,
      authorization: { allowed: [`lifecycle-delete-exact-${target.treeHash}`] },
    })
    assert.throws(
      () => lifecycle.createAuthorizedSupersededPackageSetCleanupPlan({
        projectRoot: fixture.projectRoot,
        projectId: PROJECT_ID,
        operationId: 'fixture-active-target-cleanup',
        targetObjectId: target.objectId,
        supersededByObjectId: survivor.objectId,
        authorizationReceiptPath: authorizationPath,
        now: NOW,
      }),
      error => error?.code === 'AUTHORIZED_CLEANUP_TARGET_NOT_RETIRED',
    )
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})