import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

import { hashTree } from '../scripts/build-receipt.mjs'
import {
  DEFAULT_RETENTION_POLICY,
  applyCleanupPlan,
  completeRegisteredRun,
  createCleanupPlan,
  createRegisteredRun,
  evaluateLargeRunPreflight,
  ensureNonDestructiveLifecycleCycle,
  installRetentionPolicy,
  readLocalRegistry,
  registerLocalObject,
  updateLocalObjectLifecycle,
} from '../scripts/local-lifecycle.mjs'

const PROJECT_ID = 'prj_01a0082e-fea8-7d6f-b6c2-08a259fba389'
const NOW = '2026-08-25T07:00:00.000Z'

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function makeProject() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-local-lifecycle-'))
  const projectHome = join(root, 'project')
  const projectRoot = join(projectHome, 'workspace')
  mkdirSync(projectRoot, { recursive: true })
  for (const zone of ['runs', 'package-sets', 'ledgers', 'receipts']) {
    mkdirSync(join(projectHome, 'local', zone), { recursive: true })
  }
  writeJson(join(projectHome, '.project-home', 'project-home.json'), {
    schemaVersion: 'project-home/v1',
    projectId: PROJECT_ID,
    slug: 'fixture',
    zones: { workspace: 'workspace', worktrees: 'worktrees', local: 'local' },
    createdAt: NOW,
  })
  return { root, projectHome, projectRoot, localRoot: join(projectHome, 'local') }
}

function cleanup(fixture) {
  rmSync(fixture.root, { recursive: true, force: true })
}

function policy(overrides = {}) {
  return {
    ...DEFAULT_RETENTION_POLICY,
    schedule: { ...DEFAULT_RETENTION_POLICY.schedule, ...overrides.schedule },
    disk: { ...DEFAULT_RETENTION_POLICY.disk, ...overrides.disk },
    quota: { ...DEFAULT_RETENTION_POLICY.quota, ...overrides.quota },
    retention: {
      ...DEFAULT_RETENTION_POLICY.retention,
      ...overrides.retention,
    },
  }
}

function bootstrapLifecycle(fixture, lifecyclePolicy = DEFAULT_RETENTION_POLICY) {
  installRetentionPolicy({ projectRoot: fixture.projectRoot, projectId: PROJECT_ID, policy: lifecyclePolicy })
  return ensureNonDestructiveLifecycleCycle({
    projectRoot: fixture.projectRoot,
    projectId: PROJECT_ID,
    operationId: 'fixture-lifecycle-bootstrap',
    now: NOW,
  })
}

function createRun(fixture, {
  runId,
  createdAt,
  retentionClass = 'successful-run',
  status = 'RETIRED',
  packageSetObjectId,
  issueClosed,
  expectedBytes = 10,
} = {}) {
  const result = createRegisteredRun({
    projectRoot: fixture.projectRoot,
    projectId: PROJECT_ID,
    runId,
    ownerId: 'g2-p1-test',
    taskId: `fixture-${runId}`,
    createdAt,
    retentionClass,
    packageSetObjectId,
    expectedBytes,
  })
  if (status !== 'ACTIVE') {
    completeRegisteredRun({
      projectRoot: fixture.projectRoot,
      projectId: PROJECT_ID,
      objectId: result.object.objectId,
      outcome: retentionClass,
      completedAt: createdAt,
      issueClosed,
      status,
    })
  }
  return result
}

function registerPackageSet(fixture, { createdAt = '2026-08-01T00:00:00.000Z' } = {}) {
  const temporaryRoot = join(fixture.localRoot, 'package-sets', '.staging-package')
  mkdirSync(join(temporaryRoot, 'win-unpacked'), { recursive: true })
  writeFileSync(join(temporaryRoot, 'win-unpacked', 'payload.bin'), 'fixture', 'utf8')
  const hash = hashTree(join(temporaryRoot, 'win-unpacked')).hash
  const objectId = `pkg_${hash}`
  const relativePath = `package-sets/sha256-${hash}`
  const root = join(fixture.localRoot, ...relativePath.split('/'))
  mkdirSync(dirname(root), { recursive: true })
  renameSync(temporaryRoot, root)
  writeJson(join(root, 'package-set.json'), {
    schemaVersion: 'managed-package-set/v1',
    projectId: PROJECT_ID,
    objectId,
    packageSetTreeHash: hash,
    createdAt,
    operationId: 'fixture-package-set',
  })
  return registerLocalObject({
    projectRoot: fixture.projectRoot,
    projectId: PROJECT_ID,
    object: {
      objectId,
      kind: 'package-set',
      relativePath,
      ownerId: 'g2-p1-test',
      taskId: 'fixture-package-set',
      createdAt,
      lastUsedAt: createdAt,
      status: 'RETIRED',
      retentionClass: 'package-set',
      expectedBytes: 7,
      markerRelativePath: 'package-set.json',
      sourceHashes: { packageSetTreeHash: hash },
    },
  })
}

test('registration fails closed when Project Home identity differs', () => {
  const fixture = makeProject()
  try {
    assert.throws(() => createRegisteredRun({
      projectRoot: fixture.projectRoot,
      projectId: 'prj_01b0082e-fea8-7d6f-b6c2-08a259fba389',
      runId: 'run_identity_mismatch',
      ownerId: 'g2-p1-test',
      taskId: 'fixture-identity',
      createdAt: NOW,
      retentionClass: 'successful-run',
      expectedBytes: 1,
    }), /project.*identity|projectId/iu)
  } finally {
    cleanup(fixture)
  }
})

test('run creation writes an owner marker and registry entry atomically', () => {
  const fixture = makeProject()
  try {
    bootstrapLifecycle(fixture)
    const result = createRun(fixture, { runId: 'run_atomic', createdAt: NOW, status: 'ACTIVE' })
    assert.equal(existsSync(join(result.root, 'run.json')), true)
    const marker = JSON.parse(readFileSync(join(result.root, 'run.json'), 'utf8'))
    assert.equal(marker.projectId, PROJECT_ID)
    assert.equal(marker.taskId, 'fixture-run_atomic')
    const registry = readLocalRegistry({ projectRoot: fixture.projectRoot, projectId: PROJECT_ID })
    assert.equal(registry.objects.length, 1)
    assert.equal(registry.objects[0].relativePath, 'runs/run_atomic')
  } finally {
    cleanup(fixture)
  }
})

test('registration rejects a conflicting object id or path', () => {
  const fixture = makeProject()
  try {
    bootstrapLifecycle(fixture)
    createRun(fixture, { runId: 'run_conflict_a', createdAt: NOW, status: 'ACTIVE' })
    assert.throws(() => registerLocalObject({
      projectRoot: fixture.projectRoot,
      projectId: PROJECT_ID,
      object: {
        objectId: 'run_run_conflict_a',
        kind: 'run',
        relativePath: 'runs/run_conflict_b',
        ownerId: 'g2-p1-test',
        taskId: 'fixture-conflict',
        createdAt: NOW,
        lastUsedAt: NOW,
        status: 'ACTIVE',
        retentionClass: 'successful-run',
        expectedBytes: 1,
        markerRelativePath: 'run.json',
        sourceHashes: {},
      },
    }), /conflict/iu)
  } finally {
    cleanup(fixture)
  }
})

test('retention requires both outside the recent count and older than the age floor', () => {
  const fixture = makeProject()
  try {
    bootstrapLifecycle(fixture)
    createRun(fixture, { runId: 'run_oldest', createdAt: '2026-08-10T00:00:00.000Z' })
    createRun(fixture, { runId: 'run_old', createdAt: '2026-08-11T00:00:00.000Z' })
    createRun(fixture, { runId: 'run_recent_old', createdAt: '2026-08-12T00:00:00.000Z' })
    createRun(fixture, { runId: 'run_young', createdAt: '2026-08-24T00:00:00.000Z' })
    createRun(fixture, { runId: 'run_young_newer_1', createdAt: '2026-08-24T01:00:00.000Z' })
    createRun(fixture, { runId: 'run_young_newer_2', createdAt: '2026-08-24T02:00:00.000Z' })
    const plan = createCleanupPlan({ projectRoot: fixture.projectRoot, projectId: PROJECT_ID, operationId: 'plan-retention', now: NOW })
    assert.deepEqual(plan.targets.map(item => item.objectId).sort(), ['run_run_old', 'run_run_oldest', 'run_run_recent_old'])
    assert.equal(plan.retained.some(item => item.objectId === 'run_run_young_newer_1' && item.reason === 'within-recent-count'), true)
    assert.equal(plan.retained.some(item => item.objectId === 'run_run_young' && item.reason === 'within-minimum-age'), true)
  } finally {
    cleanup(fixture)
  }
})

test('ACTIVE, QUARANTINED and PINNED objects never enter a cleanup target', () => {
  const fixture = makeProject()
  try {
    bootstrapLifecycle(fixture)
    for (const [runId, status] of [['run_active', 'ACTIVE'], ['run_quarantine', 'QUARANTINED'], ['run_pinned', 'PINNED']]) {
      createRun(fixture, { runId, createdAt: '2026-07-01T00:00:00.000Z', status })
    }
    const plan = createCleanupPlan({ projectRoot: fixture.projectRoot, projectId: PROJECT_ID, operationId: 'plan-states', now: NOW })
    assert.equal(plan.targets.length, 0)
    assert.deepEqual(plan.retained.map(item => item.reason).sort(), ['status-ACTIVE', 'status-PINNED', 'status-QUARANTINED'])
  } finally {
    cleanup(fixture)
  }
})

test('cleanup planning retains registered QUARANTINED package-set evidence after known tree drift', () => {
  const fixture = makeProject()
  try {
    bootstrapLifecycle(fixture)
    const pkg = registerPackageSet(fixture)
    updateLocalObjectLifecycle({
      projectRoot: fixture.projectRoot,
      projectId: PROJECT_ID,
      objectId: pkg.object.objectId,
      status: 'QUARANTINED',
      lastUsedAt: NOW,
    })
    writeFileSync(join(pkg.root, 'win-unpacked', 'known-incident.log'), 'known quarantined drift\n', 'utf8')

    const plan = createCleanupPlan({
      projectRoot: fixture.projectRoot,
      projectId: PROJECT_ID,
      operationId: 'plan-quarantined-known-drift',
      now: NOW,
    })
    assert.equal(plan.targets.some(item => item.objectId === pkg.object.objectId), false)
    assert.equal(plan.retained.some(item => item.objectId === pkg.object.objectId && item.reason === 'status-QUARANTINED'), true)
    const receipt = applyCleanupPlan({ projectRoot: fixture.projectRoot, projectId: PROJECT_ID, planPath: plan.path, now: NOW })
    assert.equal(receipt.status, 'applied-and-verified')
    assert.deepEqual(receipt.deleted, [])
    assert.equal(receipt.retainedVerified, 1)
    assert.equal(existsSync(pkg.root), true)
  } finally {
    cleanup(fixture)
  }
})

test('zero-delete apply resumes a failed journal after QUARANTINED marker restoration', () => {
  const fixture = makeProject()
  try {
    bootstrapLifecycle(fixture)
    const pkg = registerPackageSet(fixture)
    updateLocalObjectLifecycle({
      projectRoot: fixture.projectRoot,
      projectId: PROJECT_ID,
      objectId: pkg.object.objectId,
      status: 'QUARANTINED',
      lastUsedAt: NOW,
    })
    writeFileSync(join(pkg.root, 'win-unpacked', 'known-incident.log'), 'known quarantined drift\n', 'utf8')
    const plan = createCleanupPlan({
      projectRoot: fixture.projectRoot,
      projectId: PROJECT_ID,
      operationId: 'plan-quarantined-resume',
      now: NOW,
    })
    const markerPath = join(pkg.root, 'package-set.json')
    const markerBytes = readFileSync(markerPath)
    const marker = JSON.parse(markerBytes.toString('utf8'))
    writeJson(markerPath, { ...marker, projectId: 'prj_01a0000-apply-marker-drift' })

    assert.throws(
      () => applyCleanupPlan({ projectRoot: fixture.projectRoot, projectId: PROJECT_ID, planPath: plan.path, now: NOW }),
      /marker|identity|hash/iu,
    )
    const journalDir = join(fixture.localRoot, 'ledgers', 'cleanup-operations', plan.operationId)
    assert.equal(readdirSync(journalDir).length, 1)
    assert.equal(existsSync(pkg.root), true)

    writeFileSync(markerPath, markerBytes)
    const receipt = applyCleanupPlan({ projectRoot: fixture.projectRoot, projectId: PROJECT_ID, planPath: plan.path, now: NOW })
    assert.equal(receipt.status, 'applied-and-verified')
    assert.deepEqual(receipt.deleted, [])
    assert.equal(readdirSync(journalDir).length, 2)
    assert.equal(existsSync(pkg.root), true)
  } finally {
    cleanup(fixture)
  }
})

test('cleanup planning rejects QUARANTINED package-set evidence after marker identity drift', () => {
  const fixture = makeProject()
  try {
    bootstrapLifecycle(fixture)
    const pkg = registerPackageSet(fixture)
    updateLocalObjectLifecycle({
      projectRoot: fixture.projectRoot,
      projectId: PROJECT_ID,
      objectId: pkg.object.objectId,
      status: 'QUARANTINED',
      lastUsedAt: NOW,
    })
    const markerPath = join(pkg.root, 'package-set.json')
    const marker = JSON.parse(readFileSync(markerPath, 'utf8'))
    writeJson(markerPath, { ...marker, projectId: 'prj_01a0000-marker-identity-drift' })

    assert.throws(
      () => createCleanupPlan({ projectRoot: fixture.projectRoot, projectId: PROJECT_ID, operationId: 'plan-quarantined-marker-drift', now: NOW }),
      /marker|identity|hash/iu,
    )
  } finally {
    cleanup(fixture)
  }
})

test('cleanup planning keeps complete-tree validation for PINNED and ACTIVE package sets', () => {
  for (const status of ['PINNED', 'ACTIVE']) {
    const fixture = makeProject()
    try {
      bootstrapLifecycle(fixture)
      const pkg = registerPackageSet(fixture)
      updateLocalObjectLifecycle({
        projectRoot: fixture.projectRoot,
        projectId: PROJECT_ID,
        objectId: pkg.object.objectId,
        status,
        lastUsedAt: NOW,
      })
      writeFileSync(join(pkg.root, 'win-unpacked', 'unexpected-drift.bin'), status, 'utf8')

      assert.throws(
        () => createCleanupPlan({ projectRoot: fixture.projectRoot, projectId: PROJECT_ID, operationId: `plan-${status.toLowerCase()}-tree-drift`, now: NOW }),
        /tree bytes.*registered hash/iu,
      )
    } finally {
      cleanup(fixture)
    }
  }
})

test('cleanup apply keeps complete-tree validation for retained PINNED and ACTIVE package sets', () => {
  for (const status of ['PINNED', 'ACTIVE']) {
    const fixture = makeProject()
    try {
      bootstrapLifecycle(fixture)
      const pkg = registerPackageSet(fixture)
      updateLocalObjectLifecycle({
        projectRoot: fixture.projectRoot,
        projectId: PROJECT_ID,
        objectId: pkg.object.objectId,
        status,
        lastUsedAt: NOW,
      })
      const plan = createCleanupPlan({
        projectRoot: fixture.projectRoot,
        projectId: PROJECT_ID,
        operationId: `apply-${status.toLowerCase()}-tree-drift`,
        now: NOW,
      })
      writeFileSync(join(pkg.root, 'win-unpacked', 'unexpected-apply-drift.bin'), status, 'utf8')

      assert.throws(
        () => applyCleanupPlan({ projectRoot: fixture.projectRoot, projectId: PROJECT_ID, planPath: plan.path, now: NOW }),
        /tree bytes.*registered hash/iu,
      )
      assert.equal(existsSync(pkg.root), true)
    } finally {
      cleanup(fixture)
    }
  }
})

test('cleanup planning rejects ambiguous live registry identity before preserving QUARANTINED evidence', () => {
  const fixture = makeProject()
  try {
    bootstrapLifecycle(fixture)
    const pkg = registerPackageSet(fixture)
    updateLocalObjectLifecycle({
      projectRoot: fixture.projectRoot,
      projectId: PROJECT_ID,
      objectId: pkg.object.objectId,
      status: 'QUARANTINED',
      lastUsedAt: NOW,
    })
    const registry = readLocalRegistry({ projectRoot: fixture.projectRoot, projectId: PROJECT_ID })
    const duplicate = { ...registry.objects.find(item => item.objectId === pkg.object.objectId), objectId: 'pkg_duplicate_registry_identity' }
    writeJson(join(fixture.localRoot, 'ledgers', 'local-object-registry', `${String(registry.revision + 1).padStart(12, '0')}.json`), {
      ...registry,
      revision: registry.revision + 1,
      updatedAt: NOW,
      objects: [...registry.objects, duplicate],
    })

    assert.throws(
      () => createCleanupPlan({ projectRoot: fixture.projectRoot, projectId: PROJECT_ID, operationId: 'plan-quarantined-ambiguous-registry', now: NOW }),
      /registry.*ambiguous|unique/iu,
    )
  } finally {
    cleanup(fixture)
  }
})

test('failed runs remain retained until their issue is closed', () => {
  const fixture = makeProject()
  try {
    const custom = policy({ retention: { 'failed-run': { keepRecent: 0, minimumAgeHours: 336, requireIssueClosed: true } } })
    bootstrapLifecycle(fixture, custom)
    createRun(fixture, { runId: 'run_issue_open', createdAt: '2026-07-01T00:00:00.000Z', retentionClass: 'failed-run', issueClosed: false })
    createRun(fixture, { runId: 'run_issue_closed', createdAt: '2026-07-02T00:00:00.000Z', retentionClass: 'failed-run', issueClosed: true })
    const plan = createCleanupPlan({ projectRoot: fixture.projectRoot, projectId: PROJECT_ID, operationId: 'plan-failed', now: NOW })
    assert.deepEqual(plan.targets.map(item => item.objectId), ['run_run_issue_closed'])
    assert.equal(plan.retained.some(item => item.objectId === 'run_run_issue_open' && item.reason === 'issue-open'), true)
  } finally {
    cleanup(fixture)
  }
})

test('a package set referenced by a registered run is retained', () => {
  const fixture = makeProject()
  try {
    const custom = policy({ retention: { 'package-set': { keepRecent: 0, minimumAgeHours: 0, requireIssueClosed: false } } })
    bootstrapLifecycle(fixture, custom)
    const pkg = registerPackageSet(fixture)
    createRun(fixture, { runId: 'run_reference', createdAt: '2026-08-20T00:00:00.000Z', packageSetObjectId: pkg.object.objectId, status: 'ACTIVE' })
    const plan = createCleanupPlan({ projectRoot: fixture.projectRoot, projectId: PROJECT_ID, operationId: 'plan-reference', now: NOW })
    assert.equal(plan.targets.some(item => item.objectId === pkg.object.objectId), false)
    assert.equal(plan.retained.some(item => item.objectId === pkg.object.objectId && item.reason === 'referenced-by-run'), true)
  } finally {
    cleanup(fixture)
  }
})

test('unknown package-set or run directories block cleanup apply', () => {
  const fixture = makeProject()
  try {
    installRetentionPolicy({ projectRoot: fixture.projectRoot, projectId: PROJECT_ID })
    mkdirSync(join(fixture.localRoot, 'runs', 'unknown-run'), { recursive: true })
    const plan = createCleanupPlan({ projectRoot: fixture.projectRoot, projectId: PROJECT_ID, operationId: 'plan-unknown', now: NOW })
    assert.equal(plan.applyAllowed, false)
    assert.match(plan.blockers[0], /unknown|unregistered/iu)
    assert.throws(() => applyCleanupPlan({ projectRoot: fixture.projectRoot, projectId: PROJECT_ID, planPath: plan.path, now: NOW }), /block/iu)
  } finally {
    cleanup(fixture)
  }
})

test('tampered cleanup plans and stale registry revisions fail closed', () => {
  const fixture = makeProject()
  try {
    const custom = policy({ retention: { 'successful-run': { keepRecent: 0, minimumAgeHours: 0, requireIssueClosed: false } } })
    bootstrapLifecycle(fixture, custom)
    createRun(fixture, { runId: 'run_tamper', createdAt: '2026-07-01T00:00:00.000Z' })
    const tamperPlan = createCleanupPlan({ projectRoot: fixture.projectRoot, projectId: PROJECT_ID, operationId: 'plan-tamper', now: NOW })
    const tampered = JSON.parse(readFileSync(tamperPlan.path, 'utf8'))
    tampered.targets[0].expectedBytes += 1
    writeJson(tamperPlan.path, tampered)
    assert.throws(() => applyCleanupPlan({ projectRoot: fixture.projectRoot, projectId: PROJECT_ID, planPath: tamperPlan.path, now: NOW }), /hash/iu)

    const stalePlan = createCleanupPlan({ projectRoot: fixture.projectRoot, projectId: PROJECT_ID, operationId: 'plan-stale', now: NOW })
    createRun(fixture, { runId: 'run_revision_change', createdAt: '2026-08-24T00:00:00.000Z', status: 'ACTIVE' })
    assert.throws(() => applyCleanupPlan({ projectRoot: fixture.projectRoot, projectId: PROJECT_ID, planPath: stalePlan.path, now: NOW }), /revision|stale/iu)
  } finally {
    cleanup(fixture)
  }
})

test('apply deletes only a planned owned fixture and writes verification evidence', () => {
  const fixture = makeProject()
  try {
    const custom = policy({ retention: { 'successful-run': { keepRecent: 0, minimumAgeHours: 0, requireIssueClosed: false } } })
    bootstrapLifecycle(fixture, custom)
    const deletable = createRun(fixture, { runId: 'run_delete_me', createdAt: '2026-07-01T00:00:00.000Z' })
    const pinned = createRun(fixture, { runId: 'run_keep_me', createdAt: '2026-07-01T00:00:00.000Z', status: 'PINNED' })
    const plan = createCleanupPlan({ projectRoot: fixture.projectRoot, projectId: PROJECT_ID, operationId: 'plan-apply', now: NOW })
    const receipt = applyCleanupPlan({ projectRoot: fixture.projectRoot, projectId: PROJECT_ID, planPath: plan.path, now: NOW })
    assert.equal(receipt.status, 'applied-and-verified')
    assert.equal(existsSync(deletable.root), false)
    assert.equal(existsSync(pinned.root), true)
    assert.equal(existsSync(receipt.path), true)
    const registry = readLocalRegistry({ projectRoot: fixture.projectRoot, projectId: PROJECT_ID })
    assert.equal(registry.objects.find(item => item.objectId === deletable.object.objectId).deletedAt, NOW)
  } finally {
    cleanup(fixture)
  }
})

test('an interrupted cleanup apply resumes from its append-only journal', () => {
  const fixture = makeProject()
  try {
    const custom = policy({ retention: { 'successful-run': { keepRecent: 0, minimumAgeHours: 0, requireIssueClosed: false } } })
    bootstrapLifecycle(fixture, custom)
    const first = createRun(fixture, { runId: 'run_resume_a', createdAt: '2026-07-01T00:00:00.000Z' })
    const second = createRun(fixture, { runId: 'run_resume_b', createdAt: '2026-07-02T00:00:00.000Z' })
    const plan = createCleanupPlan({ projectRoot: fixture.projectRoot, projectId: PROJECT_ID, operationId: 'plan-resume', now: NOW })
    assert.throws(() => applyCleanupPlan({
      projectRoot: fixture.projectRoot,
      projectId: PROJECT_ID,
      planPath: plan.path,
      now: NOW,
      afterDelete: ({ deletedCount }) => {
        if (deletedCount === 1) throw new Error('injected interruption')
      },
    }), /injected interruption/iu)
    assert.equal([existsSync(first.root), existsSync(second.root)].filter(value => value === false).length, 1)
    const receipt = applyCleanupPlan({ projectRoot: fixture.projectRoot, projectId: PROJECT_ID, planPath: plan.path, now: NOW })
    assert.equal(receipt.status, 'applied-and-verified')
    assert.equal(receipt.resumed, true)
    assert.equal(existsSync(first.root), false)
    assert.equal(existsSync(second.root), false)
  } finally {
    cleanup(fixture)
  }
})

test('paths outside local and reparse-point objects are rejected', () => {
  const fixture = makeProject()
  try {
    assert.throws(() => registerLocalObject({
      projectRoot: fixture.projectRoot,
      projectId: PROJECT_ID,
      object: {
        objectId: 'run_escape', kind: 'run', relativePath: '../workspace', ownerId: 'test', taskId: 'test',
        createdAt: NOW, lastUsedAt: NOW, status: 'ACTIVE', retentionClass: 'successful-run', expectedBytes: 1,
        markerRelativePath: 'run.json', sourceHashes: {},
      },
    }), /outside|relative|path/iu)
    const external = join(fixture.root, 'external')
    mkdirSync(external)
    writeJson(join(external, 'run.json'), { projectId: PROJECT_ID, objectId: 'run_reparse', taskId: 'fixture-reparse' })
    const link = join(fixture.localRoot, 'runs', 'run_reparse')
    symlinkSync(external, link, process.platform === 'win32' ? 'junction' : 'dir')
    assert.throws(() => registerLocalObject({
      projectRoot: fixture.projectRoot,
      projectId: PROJECT_ID,
      object: {
        objectId: 'run_reparse', kind: 'run', relativePath: 'runs/run_reparse', ownerId: 'test', taskId: 'fixture-reparse',
        createdAt: NOW, lastUsedAt: NOW, status: 'ACTIVE', retentionClass: 'successful-run', expectedBytes: 1,
        markerRelativePath: 'run.json', sourceHashes: {},
      },
    }), /reparse|symbolic|link/iu)
  } finally {
    cleanup(fixture)
  }
})

test('large-run preflight enforces cleanup health, disk reserve and total quota', () => {
  const fixture = makeProject()
  try {
    const custom = policy({
      disk: { minimumFreeBytes: 100 },
      quota: { maximumRegisteredBytes: 50 },
      schedule: { intervalHours: 24, overdueGraceHours: 12 },
    })
    installRetentionPolicy({ projectRoot: fixture.projectRoot, projectId: PROJECT_ID, policy: custom })
    assert.equal(evaluateLargeRunPreflight({ projectRoot: fixture.projectRoot, projectId: PROJECT_ID, expectedBytes: 10, freeBytes: 1000, now: NOW }).ok, false)
    const emptyPlan = createCleanupPlan({ projectRoot: fixture.projectRoot, projectId: PROJECT_ID, operationId: 'plan-health', now: NOW })
    applyCleanupPlan({ projectRoot: fixture.projectRoot, projectId: PROJECT_ID, planPath: emptyPlan.path, now: NOW })
    assert.equal(evaluateLargeRunPreflight({ projectRoot: fixture.projectRoot, projectId: PROJECT_ID, expectedBytes: 10, freeBytes: 1000, now: NOW }).ok, true)
    assert.equal(evaluateLargeRunPreflight({ projectRoot: fixture.projectRoot, projectId: PROJECT_ID, expectedBytes: 10, freeBytes: 105, now: NOW }).ok, false)
    createRun(fixture, { runId: 'run_quota', createdAt: NOW, status: 'ACTIVE', expectedBytes: 45 })
    assert.equal(evaluateLargeRunPreflight({ projectRoot: fixture.projectRoot, projectId: PROJECT_ID, expectedBytes: 10, freeBytes: 1000, now: NOW }).ok, false)
    assert.equal(evaluateLargeRunPreflight({ projectRoot: fixture.projectRoot, projectId: PROJECT_ID, expectedBytes: 1, freeBytes: 1000, now: '2026-08-27T00:00:01.000Z' }).ok, false)
  } finally {
    cleanup(fixture)
  }
})
