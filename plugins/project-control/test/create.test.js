import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { issueProjectControlSelectionTicket } from '../../../src/project-control-selection-ticket.js'
import { scanProjectDirectory } from '../src/discovery/runtime.js'
import { commitPlan, stagePlan, validateWritePlanDomain } from '../src/filesync/plan-executor.js'
import { openProjectControlStorage } from '../src/host/index.js'
import { createProjectControlRequestHandler, PROJECT_CONTROL_API_PREFIX } from '../src/http.ts'
import { storageLifecycleAdapter } from '../src/index.ts'
import { createProjectControlIntakeRuntime } from '../src/intake.ts'
import { validateLifecycleCommand } from '../src/lifecycle-validator.ts'

const migrationsDirectory = fileURLToPath(new URL('../migrations/', import.meta.url))
const secret = 'create-test-selection-secret-long-enough-for-hmac'
const referenceContext = { applicationInstanceId: 'host-create-test', scope: 'project-control.lifecycle' }

async function openCreateFixture(t) {
  const tempRoot = await mkdtemp(join(tmpdir(), 'dsh-project-control-create-'))
  const parent = join(tempRoot, 'Parents')
  await mkdir(parent)
  const storage = await openProjectControlStorage({
    databasePath: join(tempRoot, 'project-control.sqlite3'),
    migrationsDirectory,
    applicationVersion: '0.1.0-test',
    instanceId: 'create-test-writer',
  })
  t.after(async () => {
    storage.close()
    await rm(tempRoot, { recursive: true, force: true })
  })
  const runtime = createProjectControlIntakeRuntime({
    storage,
    scanner: {
      scanProjectDirectory,
      async scanSourceDirectory() { assert.fail('unexpected source scan') },
    },
    selectionSecret: secret,
    applicationInstanceId: 'host-create-test',
    applicationVersion: '0.1.0-test',
    projectHomeRoot: parent,
  })
  return { tempRoot, parent, storage, runtime }
}

async function serveProjectControl(t, storage, runtime) {
  const read = {
    getStatus() {
      const status = storage.status()
      return {
        state: status.state,
        schemaVersion: status.schemaVersion,
        writable: true,
        projectCount: storage.listProjects().length,
      }
    },
    listProjects() {
      const projects = storage.listProjects().map(project => ({
        projectId: project.projectId,
        name: project.name,
        registrationMode: project.mode,
        lifecycle: project.lifecycle,
        updatedAt: project.updatedAt,
      }))
      return { projects, total: projects.length }
    },
  }
  const server = createServer(createProjectControlRequestHandler(read, {
    lifecycle: storageLifecycleAdapter(storage),
    referenceResolver: runtime.referenceResolver,
    intake: runtime.intake,
  }))
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolvePromise)
  })
  t.after(() => new Promise(resolvePromise => {
    server.close(resolvePromise)
    server.closeAllConnections?.()
  }))
  const address = server.address()
  assert.equal(typeof address, 'object')
  return `http://127.0.0.1:${address.port}`
}

async function post(origin, resource, body) {
  const response = await fetch(`${origin}${PROJECT_CONTROL_API_PREFIX}${resource}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-dsh-personal-client': '1' },
    body: JSON.stringify(body),
  })
  return { status: response.status, payload: await response.json() }
}

async function prepareCreate(origin, parent, overrides = {}) {
  const authorization = issueProjectControlSelectionTicket({
    kind: 'create-parent', path: parent, secret,
  })
  const result = await post(origin, '/intake/prepare-create', {
    selection: { path: parent, authorization },
    directoryName: overrides.directoryName ?? 'new-project',
    name: overrides.name ?? 'New Project',
    templateId: overrides.templateId ?? 'software-standard',
    templateVersion: overrides.templateVersion ?? '2.0.0',
  })
  assert.equal(result.status, 200, JSON.stringify(result.payload))
  assert.equal(result.payload.ok, true, JSON.stringify(result.payload))
  return result.payload.data
}

test('the template registry lists the three built-in templates with stable hashes', async t => {
  const { runtime } = await openCreateFixture(t)
  const templates = runtime.intake.listTemplates()
  assert.deepEqual(
    templates.map(template => template.templateId).sort(),
    ['minimal-standard', 'research-standard', 'software-standard'],
  )
  for (const template of templates) {
    assert.match(template.templateHash, /^sha256:[a-f0-9]{64}$/)
    assert.equal(template.protocolVersion, 'project-control.dsh/v1alpha1')
    assert.equal(template.templateVersion, '2.0.0')
  }
})

test('prepareCreate renders a preview and the signed command atomically creates a managed project', async t => {
  const { parent, storage, runtime } = await openCreateFixture(t)
  const origin = await serveProjectControl(t, storage, runtime)
  const preview = await prepareCreate(origin, parent)
  assert.equal(preview.template.templateId, 'software-standard')
  assert.equal(validateLifecycleCommand(preview.command).ok, true)
  const target = join(parent, 'new-project')
  const workspace = join(target, 'workspace')
  assert.equal(preview.targetDisplayPath, target)
  assert.equal(preview.writePlan.syncPolicy, 'atomic_create')

  const first = await post(origin, '/lifecycle', preview.command)
  assert.equal(first.payload.ok, true, JSON.stringify(first.payload))
  const result = first.payload.data
  assert.equal(result.status, 'accepted')
  assert.equal(result.outcome, 'managed_created')
  assert.equal(result.fileSync.status, 'committed')

  const marker = JSON.parse(await readFile(join(target, '.project-home', 'project-home.json'), 'utf8'))
  assert.equal(marker.projectId, preview.projectId)
  assert.equal(marker.slug, 'new-project')
  const manifest = await readFile(join(workspace, '.dsh-project', 'project.yaml'), 'utf8')
  assert.ok(manifest.includes(`projectId: ${preview.projectId}`))
  assert.ok((await readFile(join(workspace, 'docs', 'prd', 'PRD.md'), 'utf8')).includes('# New Project'))
  assert.ok((await readFile(join(workspace, 'docs', 'architecture', 'CURRENT.md'), 'utf8')).includes('当前软件架构'))
  const parentEntries = await readdir(parent)
  assert.ok(!parentEntries.some(name => name.startsWith('.dsh-staging.')))

  const project = storage.getProject(preview.projectId)
  assert.equal(project.mode, 'managed')
  assert.equal(project.revision, 1)
  assert.equal(project.templateId, 'software-standard')
  assert.equal(project.templateVersion, '2.0.0')
  assert.equal(project.workspaceLocations[0].displayPath, workspace)
  assert.equal(storage.getFileSyncPlan(preview.writePlan.planId).state, 'accepted')
  const events = storage.listEvents()
  assert.equal(events.length, 1)
  assert.equal(events[0].eventType, 'project.managed.created')
  assert.equal(storage.listOutbox().length, 1)

  const replay = await post(origin, '/lifecycle', preview.command)
  assert.equal(replay.payload.data.status, 'replayed')
  assert.equal(replay.payload.data.eventId, result.eventId)
  assert.equal(storage.listEvents().length, 1, 'replay must not duplicate events')
})

test('prepareCreate refuses an occupied target before any write', async t => {
  const { parent, runtime } = await openCreateFixture(t)
  await mkdir(join(parent, 'taken'))
  await writeFile(join(parent, 'taken', 'keep.txt'), 'keep')
  const authorization = issueProjectControlSelectionTicket({ kind: 'create-parent', path: parent, secret })
  await assert.rejects(
    runtime.intake.prepareCreate({
      selection: { path: parent, authorization },
      directoryName: 'taken', name: 'Taken', templateId: 'minimal-standard', templateVersion: '2.0.0',
    }),
    error => error?.code === 'TARGET_NOT_EMPTY',
  )
  assert.equal(await readFile(join(parent, 'taken', 'keep.txt'), 'utf8'), 'keep')
})

test('new Project Home creation rejects a legacy template, a non-canonical root and an invalid slug', async t => {
  const { tempRoot, parent, runtime } = await openCreateFixture(t)
  const authorize = path => issueProjectControlSelectionTicket({ kind: 'create-parent', path, secret })

  await assert.rejects(runtime.intake.prepareCreate({
    selection: { path: parent, authorization: authorize(parent) },
    directoryName: 'legacy-project', name: 'Legacy', templateId: 'minimal-standard', templateVersion: '1.0.0',
  }), error => error?.code === 'TEMPLATE_UNAVAILABLE')

  const wrongRoot = join(tempRoot, 'WrongRoot')
  await mkdir(wrongRoot)
  await assert.rejects(runtime.intake.prepareCreate({
    selection: { path: wrongRoot, authorization: authorize(wrongRoot) },
    directoryName: 'wrong-root-project', name: 'Wrong Root', templateId: 'minimal-standard', templateVersion: '2.0.0',
  }), error => error?.code === 'PROJECT_HOME_ROOT_REQUIRED')

  await assert.rejects(runtime.intake.prepareCreate({
    selection: { path: parent, authorization: authorize(parent) },
    directoryName: 'Not Canonical', name: 'Bad Slug', templateId: 'minimal-standard', templateVersion: '2.0.0',
  }), error => error?.code === 'PROJECT_SLUG_INVALID')

  assert.deepEqual(await readdir(parent), [])
})

test('plan references allow only the Project Home workspace child as a distinct primary location', async t => {
  const { parent, storage, runtime } = await openCreateFixture(t)
  const authorization = issueProjectControlSelectionTicket({ kind: 'create-parent', path: parent, secret })
  const preview = await runtime.intake.prepareCreate({
    selection: { path: parent, authorization },
    directoryName: 'reference-project', name: 'Reference Project', templateId: 'minimal-standard', templateVersion: '2.0.0',
  })
  assert.throws(() => storage.issueFileSyncPlanRefs(preview.writePlan.planId, {
    ...referenceContext,
    targetDisplayPath: preview.targetDisplayPath,
    locationDisplayPath: join(preview.targetDisplayPath, 'local'),
    parentDisplayPath: parent,
  }), error => error?.details?.reason === 'location_outside_target')
})

test('a target appearing between prepare and execute rejects without touching the racer', async t => {
  const { parent, storage, runtime } = await openCreateFixture(t)
  const origin = await serveProjectControl(t, storage, runtime)
  const preview = await prepareCreate(origin, parent)
  await mkdir(join(parent, 'new-project'))
  await writeFile(join(parent, 'new-project', 'raced.txt'), 'race')
  const submitted = await post(origin, '/lifecycle', preview.command)
  assert.equal(submitted.payload.ok, true, JSON.stringify(submitted.payload))
  assert.equal(submitted.payload.data.status, 'rejected', JSON.stringify(submitted.payload))
  assert.equal(submitted.payload.data.error.code, 'TARGET_NOT_EMPTY', JSON.stringify(submitted.payload))
  assert.equal(submitted.payload.data.fileSync.status, 'planned')
  assert.equal(await readFile(join(parent, 'new-project', 'raced.txt'), 'utf8'), 'race')
  assert.equal(storage.getFileSyncPlan(preview.writePlan.planId).state, 'rolled_back')
  assert.equal(storage.listProjects().length, 0)
})

test('files committed before acceptance resume on the same command retry', async t => {
  const { parent, storage, runtime } = await openCreateFixture(t)
  const origin = await serveProjectControl(t, storage, runtime)
  const preview = await prepareCreate(origin, parent)
  const plan = storage.getFileSyncPlan(preview.writePlan.planId)
  const resolution = await runtime.referenceResolver.resolveCreate(preview.command)
  assert.notEqual(resolution, null)
  const canonical = validateWritePlanDomain(plan)
  await storage.setFileSyncPlanState(plan.planId, 'planned', { state: 'staging' })
  await stagePlan({
    plan, canonical, targetRoot: plan.targetDisplayPath, stagingRoot: plan.stagingDisplayPath,
    authorizedRoot: parent, contents: resolution.contents,
  })
  await storage.setFileSyncPlanState(plan.planId, 'staging', { state: 'staged' })
  const commit = await commitPlan({ plan, canonical, targetRoot: plan.targetDisplayPath, stagingRoot: plan.stagingDisplayPath, rootPreexistedEmpty: false })
  await storage.setFileSyncPlanState(plan.planId, 'staged', { state: 'files_committed', createdPaths: commit.createdPaths })

  const first = await post(origin, '/lifecycle', preview.command)
  assert.equal(first.payload.data.status, 'accepted')
  assert.equal(storage.getProject(preview.projectId).revision, 1)
  const replay = await post(origin, '/lifecycle', preview.command)
  assert.equal(replay.payload.data.status, 'replayed')
})

test('a tampered create command is rejected before any file or project write', async t => {
  const { parent, storage, runtime } = await openCreateFixture(t)
  const origin = await serveProjectControl(t, storage, runtime)
  const preview = await prepareCreate(origin, parent)
  const forged = structuredClone(preview.command)
  forged.payload.name = 'Forged Name'
  assert.equal(await runtime.referenceResolver.resolveCreate(forged), null)
  const submitted = await post(origin, '/lifecycle', forged)
  assert.equal(submitted.payload.data.status, 'rejected')
  assert.equal(submitted.payload.data.error.code, 'REFERENCE_UNRESOLVED')
  assert.equal(storage.listProjects().length, 0)
  assert.equal(storage.getFileSyncPlan(preview.writePlan.planId).state, 'planned')
  await assert.rejects(readFile(join(parent, 'new-project', 'workspace', '.dsh-project', 'project.yaml')), /ENOENT/)
})

test('create selection tickets are single-use', async t => {
  const { parent, runtime } = await openCreateFixture(t)
  const authorization = issueProjectControlSelectionTicket({ kind: 'create-parent', path: parent, secret })
  const input = {
    selection: { path: parent, authorization },
    directoryName: 'once', name: 'Once', templateId: 'minimal-standard', templateVersion: '2.0.0',
  }
  const first = await runtime.intake.prepareCreate(input)
  assert.equal(first.projectId.startsWith('prj_'), true)
  await assert.rejects(
    runtime.intake.prepareCreate({ ...input, directoryName: 'twice' }),
    error => error?.code === 'DIRECTORY_SELECTION_REQUIRED',
  )
})

test('plan references expire and stop resolving', async t => {
  const { parent, storage, runtime } = await openCreateFixture(t)
  const origin = await serveProjectControl(t, storage, runtime)
  const preview = await prepareCreate(origin, parent)
  const planId = preview.writePlan.planId
  const shortLived = storage.issueFileSyncPlanRefs(planId, {
    ...referenceContext,
    targetDisplayPath: preview.targetDisplayPath,
    locationDisplayPath: join(preview.targetDisplayPath, 'workspace'),
    parentDisplayPath: parent,
    ttlSeconds: 1,
  })
  await new Promise(resolvePromise => setTimeout(resolvePromise, 1100))
  assert.throws(() => storage.resolveFileSyncPlanRefs(planId, {
    locationRef: shortLived.locationRef,
    sourceRootRef: shortLived.sourceRootRef,
  }, referenceContext), error => error?.details?.reason === 'reference_expired')
})

test('a created project restores its identity from its files in a fresh control plane', async t => {
  const { tempRoot, parent, storage, runtime } = await openCreateFixture(t)
  const origin = await serveProjectControl(t, storage, runtime)
  const preview = await prepareCreate(origin, parent)
  const created = await post(origin, '/lifecycle', preview.command)
  assert.equal(created.payload.data.status, 'accepted')

  const secondStorage = await openProjectControlStorage({
    databasePath: join(tempRoot, 'second-plane', 'project-control.sqlite3'),
    migrationsDirectory,
    applicationVersion: '0.1.0-test',
    instanceId: 'second-plane-writer',
  })
  const scan = await scanProjectDirectory(join(parent, 'new-project', 'workspace'))
  assert.equal(scan.candidates.length, 1)
  assert.equal(scan.candidates[0].detectedMode, 'managed')
  assert.equal(scan.candidates[0].manifestProjectId, preview.projectId)
  assert.equal(secondStorage.listProjects().length, 0)
  // Close both storages before the openCreateFixture cleanup removes the tree;
  // node:test runs after hooks in registration order.
  storage.close()
  secondStorage.close()
})
