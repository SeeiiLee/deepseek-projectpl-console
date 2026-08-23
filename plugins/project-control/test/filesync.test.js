import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  rmSync, symlinkSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { scanSourceDirectory } from '../src/discovery/runtime.js'
import {
  FileSyncPlanError, commitPlan, computePlanHash, executeFileSyncPlan,
  recoverPlan, rollbackCreated, stagePlan, stagingRootForPlan,
  validateWritePlanDomain,
} from '../src/filesync/plan-executor.js'
import { createPrefixedUuidV7, InvalidStoragePathError, openProjectControlStorage } from '../src/host/index.js'

const projectRoot = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const migrationsDirectory = join(projectRoot, 'migrations')

const MANIFEST_YAML = [
  'apiVersion: project-control.dsh/v1alpha1',
  'kind: ProjectManifest',
  'metadata:',
  '  projectId: prj_0198f4b2-7c3a-7d11-a5c6-6b6f39e34711',
  '  name: Test Project',
  '  createdAt: 2026-08-15T09:30:00.000Z',
  '  createdBy:',
  '    kind: human',
  '    id: cyrus',
  '  origin:',
  '    kind: template',
  '    templateId: minimal-standard',
  '    templateVersion: 1.0.0',
  'spec:',
  '  documents:',
  '    docsRoot: docs',
  '    entries:',
  '      - role: prd',
  '        path: docs/PRD.md',
  '        required: true',
  '    standardOutputs:',
  '      updatesRoot: .dsh-project/updates',
  '      decisionsRoot: .dsh-project/decisions',
  '      artifactsRoot: .dsh-project/artifacts',
].join('\n') + '\n'
const PRD_CONTENT = '# PRD 待填写\n'
const NEXT_CONTENT = '# 下一步 待填写\n'

function sha256(content) {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`
}

function makeRoot(t) {
  // Cleanup registration is deliberately deferred to cleanupRoot so tests can
  // register storage close hooks first: node:test runs after hooks FIFO and
  // deleting SQLite files while the storage is still open fails with EPERM.
  return mkdtempSync(join(tmpdir(), 'dsh-filesync-'))
}

function cleanupRoot(t, root) {
  t.after(() => {
    const sleep = new Int32Array(new SharedArrayBuffer(4))
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        chmodSync(root, 0o700)
      } catch {}
      try {
        rmSync(root, { recursive: true, force: true })
        return
      } catch (error) {
        if (attempt === 2) throw error
        Atomics.wait(sleep, 0, 0, 75)
      }
    }
  })
  return root
}

async function openStorage(root) {
  return openProjectControlStorage({
    databasePath: join(root, 'control', 'project-control.sqlite3'),
    applicationVersion: '0.1.0-test',
    instanceId: 'test-host-1',
    migrationsDirectory,
  })
}

function makeJournal(storage, planId) {
  return {
    transition(from, to, options = {}) {
      return storage.setFileSyncPlanState(planId, from, {
        state: to,
        createdPaths: options.createdPaths ?? [],
        errorCode: options.errorCode,
      })
    },
  }
}

function dirOp(relativePath) {
  return { kind: 'create_directory', relativePath, expectedState: 'absent', contentHash: null }
}

function fileOp(relativePath, content) {
  return { kind: 'create_file', relativePath, expectedState: 'absent', contentHash: sha256(content) }
}

function createPlan(overrides = {}) {
  const manifest = overrides.manifest ?? MANIFEST_YAML
  const prd = overrides.prd ?? PRD_CONTENT
  const operations = overrides.operations ?? [
    dirOp('.dsh-project'),
    fileOp('.dsh-project/project.yaml', manifest),
    dirOp('docs'),
    fileOp('docs/PRD.md', prd),
  ]
  const manifestHash = overrides.manifestHash ?? sha256(manifest)
  const syncPolicy = overrides.syncPolicy ?? 'atomic_create'
  const planHash = overrides.planHash ?? computePlanHash({ manifestHash, syncPolicy, operations })
  return Object.freeze({
    planId: overrides.planId ?? createPrefixedUuidV7('pln'),
    commandId: overrides.commandId ?? createPrefixedUuidV7('cmd'),
    kind: overrides.kind ?? 'create_from_template',
    projectId: overrides.projectId ?? createPrefixedUuidV7('prj'),
    syncPolicy,
    manifestHash,
    planHash,
    operations: Object.freeze(operations),
    state: overrides.state ?? 'planned',
    createdPaths: Object.freeze(overrides.createdPaths ?? []),
    rootPreexistedEmpty: overrides.rootPreexistedEmpty ?? false,
  })
}

function contentsFor(plan) {
  const contents = new Map()
  for (const operation of plan.operations) {
    if (operation.kind !== 'create_file') continue
    if (operation.relativePath === '.dsh-project/project.yaml') contents.set(operation.relativePath, MANIFEST_YAML)
    if (operation.relativePath === 'docs/PRD.md') contents.set(operation.relativePath, PRD_CONTENT)
    if (operation.relativePath === 'docs/NEXT.md') contents.set(operation.relativePath, NEXT_CONTENT)
  }
  return contents
}

function createJournaledPlan(storage, plan, targetRoot, stagingRoot) {
  storage.createFileSyncPlan({
    planId: plan.planId,
    commandId: plan.commandId,
    kind: plan.kind,
    projectId: plan.projectId,
    syncPolicy: plan.syncPolicy,
    targetDisplayPath: targetRoot,
    targetNormalizedPath: targetRoot,
    stagingDisplayPath: stagingRoot,
    planHash: plan.planHash,
    manifestHash: plan.manifestHash,
    operations: plan.operations,
    rootPreexistedEmpty: plan.rootPreexistedEmpty,
  })
  return storage.getFileSyncPlan(plan.planId)
}

function assertNoStagingResidue(parentPath) {
  for (const name of readdirSync(parentPath)) {
    assert.ok(!name.startsWith('.dsh-staging.'), `staging residue left behind: ${name}`)
  }
}

function assertRejectsWithCode(promise, code) {
  return promise.then(
    () => assert.fail(`expected rejection with ${code}`),
    (error) => {
      assert.ok(error instanceof FileSyncPlanError, `unexpected error type: ${error?.name}`)
      assert.equal(error.code, code, `unexpected code: ${error?.code}`)
    },
  )
}

test('write plan domain rules reject duplicates, unneeded directories and manifest violations', async () => {
  const plan = createPlan()
  const canonical = validateWritePlanDomain(plan)
  assert.deepEqual(canonical.map(op => op.relativePath), [
    '.dsh-project', 'docs', '.dsh-project/project.yaml', 'docs/PRD.md',
  ])
  await assertRejectsWithCode(Promise.resolve().then(() => validateWritePlanDomain(createPlan({
    operations: [
      dirOp('.dsh-project'), fileOp('.dsh-project/project.yaml', MANIFEST_YAML),
      dirOp('docs'), fileOp('docs/PRD.md', PRD_CONTENT), fileOp('docs/PRD.md', PRD_CONTENT),
    ],
  }))), 'WRITE_PLAN_STALE')
  await assertRejectsWithCode(Promise.resolve().then(() => validateWritePlanDomain(createPlan({
    operations: [
      dirOp('.dsh-project'), fileOp('.dsh-project/project.yaml', MANIFEST_YAML),
      dirOp('docs'), fileOp('docs/PRD.md', PRD_CONTENT), dirOp('docs/extra'),
    ],
  }))), 'WRITE_PLAN_STALE')
  await assertRejectsWithCode(Promise.resolve().then(() => validateWritePlanDomain(createPlan({
    operations: [dirOp('docs'), fileOp('docs/PRD.md', PRD_CONTENT)],
  }))), 'MANIFEST_INVALID')
  await assertRejectsWithCode(Promise.resolve().then(() => validateWritePlanDomain(createPlan({
    manifestHash: sha256('different manifest bytes'),
  }))), 'MANIFEST_INVALID')
})

test('a whole-tree create stages, renames atomically, verifies hashes and journals files_committed', async (t) => {
  const parent = makeRoot(t)
  const targetRoot = join(parent, 'NewProject')
  const plan = createPlan()
  const stagingRoot = stagingRootForPlan(plan, targetRoot)
  const storage = await openStorage(parent)
  t.after(() => storage.close())
  cleanupRoot(t, parent)
  createJournaledPlan(storage, plan, targetRoot, stagingRoot)
  const journal = makeJournal(storage, plan.planId)

  const result = await executeFileSyncPlan({
    plan, targetRoot, stagingRoot, authorizedRoot: parent, contents: contentsFor(plan), journal,
  })

  assert.equal(result.rootPreexistedEmpty, false)
  assert.equal(readFileSync(join(targetRoot, '.dsh-project', 'project.yaml'), 'utf8'), MANIFEST_YAML)
  assert.equal(readFileSync(join(targetRoot, 'docs', 'PRD.md'), 'utf8'), PRD_CONTENT)
  assertNoStagingResidue(parent)
  const row = storage.getFileSyncPlan(plan.planId)
  assert.equal(row.state, 'files_committed')
  assert.deepEqual(row.createdPaths, ['.dsh-project', 'docs', '.dsh-project/project.yaml', 'docs/PRD.md'])
})

test('create into a pre-existing empty directory commits inside it and keeps the root', async (t) => {
  const parent = makeRoot(t)
  const targetRoot = join(parent, 'EmptyRoot')
  mkdirSync(targetRoot)
  const plan = createPlan()
  const stagingRoot = stagingRootForPlan(plan, targetRoot)
  const storage = await openStorage(parent)
  t.after(() => storage.close())
  cleanupRoot(t, parent)
  createJournaledPlan(storage, plan, targetRoot, stagingRoot)
  const journal = makeJournal(storage, plan.planId)

  const result = await executeFileSyncPlan({
    plan, targetRoot, stagingRoot, authorizedRoot: parent, contents: contentsFor(plan), journal,
  })

  assert.equal(result.rootPreexistedEmpty, true)
  assert.ok(existsSync(join(targetRoot, '.dsh-project', 'project.yaml')))
  assert.equal(storage.getFileSyncPlan(plan.planId).state, 'files_committed')
})

test('an occupied create target is rejected before any write and leaves the occupant intact', async (t) => {
  const parent = makeRoot(t)
  const targetRoot = join(parent, 'Occupied')
  mkdirSync(targetRoot)
  const occupant = join(targetRoot, 'keep.txt')
  writeFileSync(occupant, 'pre-existing')
  const plan = createPlan()
  const stagingRoot = stagingRootForPlan(plan, targetRoot)
  const storage = await openStorage(parent)
  t.after(() => storage.close())
  cleanupRoot(t, parent)
  createJournaledPlan(storage, plan, targetRoot, stagingRoot)
  const journal = makeJournal(storage, plan.planId)

  await assertRejectsWithCode(executeFileSyncPlan({
    plan, targetRoot, stagingRoot, authorizedRoot: parent, contents: contentsFor(plan), journal,
  }), 'TARGET_NOT_EMPTY')

  assert.equal(readFileSync(occupant, 'utf8'), 'pre-existing')
  assert.equal(readdirSync(targetRoot).length, 1)
  assertNoStagingResidue(parent)
  assert.equal(storage.getFileSyncPlan(plan.planId).state, 'rolled_back')
})

test('a target appearing between stage and commit triggers a clean rollback and keeps the racer intact', async (t) => {
  const parent = makeRoot(t)
  const targetRoot = join(parent, 'RaceTarget')
  const plan = createPlan()
  const stagingRoot = stagingRootForPlan(plan, targetRoot)
  const storage = await openStorage(parent)
  t.after(() => storage.close())
  cleanupRoot(t, parent)
  createJournaledPlan(storage, plan, targetRoot, stagingRoot)
  const journal = makeJournal(storage, plan.planId)
  const canonical = validateWritePlanDomain(plan)

  await journal.transition('planned', 'staging', {})
  const staged = await stagePlan({ plan, canonical, targetRoot, stagingRoot, authorizedRoot: parent, contents: contentsFor(plan) })
  await journal.transition('staging', 'staged', {})
  mkdirSync(targetRoot)
  writeFileSync(join(targetRoot, 'raced.txt'), 'race')

  let renamed = []
  try {
    await commitPlan({ plan, canonical, targetRoot, stagingRoot, rootPreexistedEmpty: staged.rootPreexistedEmpty })
  } catch (error) {
    assert.equal(error.code, 'TARGET_NOT_EMPTY')
    renamed = error.details?.renamed ?? []
  }
  await rollbackCreated({ plan, canonical, targetRoot, stagingRoot, createdPaths: renamed, removeTargetRoot: false })
  await journal.transition('staged', 'rolled_back', {})

  assert.equal(readFileSync(join(targetRoot, 'raced.txt'), 'utf8'), 'race')
  assertNoStagingResidue(parent)
  assert.equal(storage.getFileSyncPlan(plan.planId).state, 'rolled_back')
})

test('an additive upgrade only adds declared paths and never rewrites existing documents', async (t) => {
  const parent = makeRoot(t)
  const targetRoot = join(parent, 'LegacyProject')
  mkdirSync(join(targetRoot, 'docs'), { recursive: true })
  const existingPrd = join(targetRoot, 'docs', 'PRD.md')
  writeFileSync(existingPrd, 'legacy prd content')
  const plan = createPlan({
    syncPolicy: 'atomic_additive',
    kind: 'upgrade_managed',
    operations: [
      dirOp('.dsh-project'),
      fileOp('.dsh-project/project.yaml', MANIFEST_YAML),
      fileOp('docs/NEXT.md', NEXT_CONTENT),
    ],
  })
  const stagingRoot = stagingRootForPlan(plan, targetRoot)
  const storage = await openStorage(parent)
  t.after(() => storage.close())
  cleanupRoot(t, parent)
  createJournaledPlan(storage, plan, targetRoot, stagingRoot)
  const journal = makeJournal(storage, plan.planId)

  await executeFileSyncPlan({
    plan, targetRoot, stagingRoot, authorizedRoot: targetRoot, contents: contentsFor(plan), journal,
  })

  assert.equal(readFileSync(existingPrd, 'utf8'), 'legacy prd content')
  assert.equal(readFileSync(join(targetRoot, '.dsh-project', 'project.yaml'), 'utf8'), MANIFEST_YAML)
  assert.equal(readFileSync(join(targetRoot, 'docs', 'NEXT.md'), 'utf8'), NEXT_CONTENT)
  assertNoStagingResidue(targetRoot)
  assert.equal(storage.getFileSyncPlan(plan.planId).state, 'files_committed')
})

test('an additive conflict refuses to overwrite the appearing path', async (t) => {
  const parent = makeRoot(t)
  const targetRoot = join(parent, 'ConflictRoot')
  mkdirSync(targetRoot)
  const plan = createPlan({
    syncPolicy: 'atomic_additive',
    kind: 'upgrade_managed',
    operations: [
      dirOp('.dsh-project'),
      fileOp('.dsh-project/project.yaml', MANIFEST_YAML),
    ],
  })
  const stagingRoot = stagingRootForPlan(plan, targetRoot)
  const storage = await openStorage(parent)
  t.after(() => storage.close())
  cleanupRoot(t, parent)
  createJournaledPlan(storage, plan, targetRoot, stagingRoot)
  const journal = makeJournal(storage, plan.planId)
  const canonical = validateWritePlanDomain(plan)

  await journal.transition('planned', 'staging', {})
  await stagePlan({ plan, canonical, targetRoot, stagingRoot, authorizedRoot: targetRoot, contents: contentsFor(plan) })
  await journal.transition('staging', 'staged', {})
  mkdirSync(join(targetRoot, '.dsh-project'), { recursive: true })
  const occupant = join(targetRoot, '.dsh-project', 'project.yaml')
  writeFileSync(occupant, 'someone elses manifest')

  let renamed = []
  try {
    await commitPlan({ plan, canonical, targetRoot, stagingRoot, rootPreexistedEmpty: false })
  } catch (error) {
    assert.equal(error.code, 'WRITE_PLAN_STALE')
    renamed = error.details?.renamed ?? []
  }
  await rollbackCreated({ plan, canonical, targetRoot, stagingRoot, createdPaths: renamed, removeTargetRoot: false })
  await journal.transition('staged', 'rolled_back', {})

  assert.equal(readFileSync(occupant, 'utf8'), 'someone elses manifest')
  assertNoStagingResidue(targetRoot)
})

test('a missing rendered file fails the sync, rolls back and leaves no residue', async (t) => {
  const parent = makeRoot(t)
  const targetRoot = join(parent, 'MissingContent')
  const plan = createPlan()
  const stagingRoot = stagingRootForPlan(plan, targetRoot)
  const storage = await openStorage(parent)
  t.after(() => storage.close())
  cleanupRoot(t, parent)
  createJournaledPlan(storage, plan, targetRoot, stagingRoot)
  const journal = makeJournal(storage, plan.planId)
  const contents = contentsFor(plan)
  contents.delete('docs/PRD.md')

  await assertRejectsWithCode(executeFileSyncPlan({
    plan, targetRoot, stagingRoot, authorizedRoot: parent, contents, journal,
  }), 'FILE_SYNC_FAILED')

  assert.ok(!existsSync(targetRoot))
  assertNoStagingResidue(parent)
  assert.equal(storage.getFileSyncPlan(plan.planId).state, 'rolled_back')
})

test('an interrupted staged plan is recovered on restart and rolled back', async (t) => {
  const parent = makeRoot(t)
  const targetRoot = join(parent, 'Interrupted')
  const plan = createPlan()
  const stagingRoot = stagingRootForPlan(plan, targetRoot)
  const canonical = validateWritePlanDomain(plan)
  const storage = await openStorage(parent)
  createJournaledPlan(storage, plan, targetRoot, stagingRoot)
  const journal = makeJournal(storage, plan.planId)
  await journal.transition('planned', 'staging', {})
  await stagePlan({ plan, canonical, targetRoot, stagingRoot, authorizedRoot: parent, contents: contentsFor(plan) })
  await journal.transition('staging', 'staged', {})
  storage.close() // simulated crash

  const restarted = await openStorage(parent)
  t.after(() => restarted.close())
  cleanupRoot(t, parent)
  const pending = restarted.listFileSyncPlansForRecovery()
  assert.equal(pending.length, 1)
  assert.equal(pending[0].state, 'staged')
  const outcome = await recoverPlan({
    plan: pending[0], canonical, targetRoot, stagingRoot, journal: makeJournal(restarted, plan.planId),
  })
  assert.equal(outcome.outcome, 'rolled_back')
  assert.ok(!existsSync(stagingRoot))
  assert.ok(!existsSync(targetRoot))
  assert.equal(restarted.getFileSyncPlan(plan.planId).state, 'rolled_back')
})

test('committed files before database acceptance resume on restart, and tampering quarantines', async (t) => {
  const parent = makeRoot(t)
  const targetRoot = join(parent, 'CommittedCrash')
  const plan = createPlan()
  const stagingRoot = stagingRootForPlan(plan, targetRoot)
  const canonical = validateWritePlanDomain(plan)
  const storage = await openStorage(parent)
  cleanupRoot(t, parent)
  createJournaledPlan(storage, plan, targetRoot, stagingRoot)
  const journal = makeJournal(storage, plan.planId)
  await journal.transition('planned', 'staging', {})
  const staged = await stagePlan({ plan, canonical, targetRoot, stagingRoot, authorizedRoot: parent, contents: contentsFor(plan) })
  await journal.transition('staging', 'staged', {})
  const commit = await commitPlan({ plan, canonical, targetRoot, stagingRoot, rootPreexistedEmpty: staged.rootPreexistedEmpty })
  await journal.transition('staged', 'files_committed', { createdPaths: commit.createdPaths })
  storage.close() // simulated crash before the database acceptance

  const restarted = await openStorage(parent)
  const pending = restarted.listFileSyncPlansForRecovery()
  assert.equal(pending[0].state, 'files_committed')
  const resumable = await recoverPlan({
    plan: pending[0], canonical, targetRoot, stagingRoot, journal: makeJournal(restarted, plan.planId),
  })
  assert.equal(resumable.outcome, 'resumable')

  writeFileSync(join(targetRoot, 'docs', 'PRD.md'), 'tampered', { flag: 'a' })
  const tamperedRow = restarted.getFileSyncPlan(plan.planId)
  const quarantined = await recoverPlan({
    plan: tamperedRow, canonical, targetRoot, stagingRoot, journal: makeJournal(restarted, plan.planId),
  })
  assert.equal(quarantined.outcome, 'quarantined')
  assert.equal(restarted.getFileSyncPlan(plan.planId).state, 'recovery_required')
  assert.ok(readFileSync(join(targetRoot, 'docs', 'PRD.md'), 'utf8').includes('tampered'))
  restarted.close()
})

test('a clean rollback allows the same command plan to retry into files_committed', async (t) => {
  const parent = makeRoot(t)
  const targetRoot = join(parent, 'RetryTarget')
  const plan = createPlan()
  const stagingRoot = stagingRootForPlan(plan, targetRoot)
  const storage = await openStorage(parent)
  t.after(() => storage.close())
  cleanupRoot(t, parent)
  createJournaledPlan(storage, plan, targetRoot, stagingRoot)
  const journal = makeJournal(storage, plan.planId)
  const broken = contentsFor(plan)
  broken.delete('.dsh-project/project.yaml')
  await assertRejectsWithCode(executeFileSyncPlan({
    plan, targetRoot, stagingRoot, authorizedRoot: parent, contents: broken, journal,
  }), 'FILE_SYNC_FAILED')
  assert.equal(storage.getFileSyncPlan(plan.planId).state, 'rolled_back')

  const retryPlan = { ...plan, state: 'rolled_back' }
  const result = await executeFileSyncPlan({
    plan: retryPlan, targetRoot, stagingRoot, authorizedRoot: parent, contents: contentsFor(plan), journal,
  })
  assert.equal(result.createdPaths.length, 4)
  assert.equal(readFileSync(join(targetRoot, '.dsh-project', 'project.yaml'), 'utf8'), MANIFEST_YAML)
  assert.equal(storage.getFileSyncPlan(plan.planId).state, 'files_committed')
})

test('the journal enforces transition rules, plan uniqueness and optimistic state updates', async (t) => {
  const parent = makeRoot(t)
  const targetRoot = join(parent, 'JournalProject')
  const plan = createPlan()
  const stagingRoot = stagingRootForPlan(plan, targetRoot)
  const storage = await openStorage(parent)
  t.after(() => storage.close())
  cleanupRoot(t, parent)
  createJournaledPlan(storage, plan, targetRoot, stagingRoot)

  assert.throws(() => storage.setFileSyncPlanState(plan.planId, 'planned', { state: 'files_committed' }), /cannot move between these states/)
  assert.throws(() => storage.createFileSyncPlan({
    planId: plan.planId, commandId: plan.commandId, kind: plan.kind, projectId: plan.projectId,
    syncPolicy: plan.syncPolicy, targetDisplayPath: targetRoot, stagingDisplayPath: stagingRoot,
    planHash: plan.planHash, manifestHash: plan.manifestHash, operations: plan.operations,
  }), /planId already exists/)
  assert.throws(() => storage.setFileSyncPlanState(plan.planId, 'staging', { state: 'staged' }), /state changed/)
})

test('a symlink occupying an additive target path is treated as an occupied path, never followed', async (t) => {
  const parent = makeRoot(t)
  const targetRoot = join(parent, 'SymlinkRoot')
  mkdirSync(targetRoot)
  const outside = join(parent, 'outside')
  mkdirSync(outside)
  writeFileSync(join(outside, 'payload.txt'), 'outside payload')
  symlinkSync(outside, join(targetRoot, '.dsh-project'), 'junction')
  const plan = createPlan({
    syncPolicy: 'atomic_additive',
    kind: 'upgrade_managed',
    operations: [
      dirOp('.dsh-project'),
      fileOp('.dsh-project/project.yaml', MANIFEST_YAML),
    ],
  })
  const stagingRoot = stagingRootForPlan(plan, targetRoot)
  const storage = await openStorage(parent)
  t.after(() => storage.close())
  cleanupRoot(t, parent)
  createJournaledPlan(storage, plan, targetRoot, stagingRoot)
  const journal = makeJournal(storage, plan.planId)

  await assertRejectsWithCode(executeFileSyncPlan({
    plan, targetRoot, stagingRoot, authorizedRoot: targetRoot, contents: contentsFor(plan), journal,
  }), 'WRITE_PLAN_STALE')

  assert.equal(readFileSync(join(outside, 'payload.txt'), 'utf8'), 'outside payload')
  assert.equal(storage.getFileSyncPlan(plan.planId).state, 'rolled_back')
})

test('journal storage refuses UNC and non-absolute target paths', async (t) => {
  const parent = makeRoot(t)
  const storage = await openStorage(parent)
  t.after(() => storage.close())
  cleanupRoot(t, parent)
  const plan = createPlan()
  assert.throws(() => storage.createFileSyncPlan({
    planId: plan.planId, commandId: plan.commandId, kind: plan.kind, projectId: plan.projectId,
    syncPolicy: plan.syncPolicy, targetDisplayPath: '\\\\server\\share\\project',
    stagingDisplayPath: join(parent, 'staging'),
    planHash: plan.planHash, manifestHash: plan.manifestHash, operations: plan.operations,
  }), InvalidStoragePathError)
})

test('the scanner skips journal-owned staging directories', async (t) => {
  const sourceRoot = makeRoot(t)
  cleanupRoot(t, sourceRoot)
  mkdirSync(join(sourceRoot, '.dsh-staging.pln_00000000-0000-7000-8000-000000000000'))
  writeFileSync(join(sourceRoot, '.dsh-staging.pln_00000000-0000-7000-8000-000000000000', 'README.md'), '# staging residue')
  mkdirSync(join(sourceRoot, 'RealProject'))
  writeFileSync(join(sourceRoot, 'RealProject', 'README.md'), '# Real Project')
  const scan = await scanSourceDirectory(sourceRoot)
  assert.equal(scan.candidates.length, 1)
  assert.ok(scan.candidates[0].root.displayPath.endsWith('RealProject'))
  assert.ok(scan.summary.skippedDirectories >= 1)
})
