import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { issueProjectControlSelectionTicket } from '../../../src/project-control-selection-ticket.js'
import { parseYamlSubset, scanProjectDirectory } from '../src/discovery/runtime.js'
import { openProjectControlStorage } from '../src/host/index.js'
import { createProjectControlRequestHandler, PROJECT_CONTROL_API_PREFIX } from '../src/http.ts'
import { storageLifecycleAdapter } from '../src/index.ts'
import { createProjectControlIntakeRuntime } from '../src/intake.ts'
import { validateLifecycleCommand } from '../src/lifecycle-validator.ts'
import { validateProjectManifest } from '../src/manifest-validator.ts'

const migrationsDirectory = fileURLToPath(new URL('../migrations/', import.meta.url))
const secret = 'upgrade-test-selection-secret-long-enough-for-hmac'

function sha256(content) {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`
}

async function registerLegacyFixture(t, options = {}) {
  const tempRoot = await mkdtemp(join(tmpdir(), 'dsh-project-control-upgrade-'))
  const projectRoot = join(tempRoot, 'Legacy Project')
  await mkdir(projectRoot)
  const prdContent = '# Legacy Project\n\n## Goal\nKeep documents untouched.\n'
  const readmeContent = '# Legacy Project README\n'
  await writeFile(join(projectRoot, 'README.md'), readmeContent)
  await writeFile(join(projectRoot, 'PRD.md'), prdContent)
  const storage = await openProjectControlStorage({
    databasePath: join(tempRoot, 'project-control.sqlite3'),
    migrationsDirectory,
    applicationVersion: '0.1.0-test',
    instanceId: 'upgrade-test-writer',
  })
  t.after(async () => {
    storage.close()
    await rm(tempRoot, { recursive: true, force: true })
  })
  const runtime = createProjectControlIntakeRuntime({
    storage,
    scanner: { scanProjectDirectory, scanSourceDirectory: scanProjectDirectory },
    selectionSecret: secret,
    applicationInstanceId: 'host-upgrade-test',
    applicationVersion: '0.1.0-test',
  })
  const authorization = issueProjectControlSelectionTicket({
    kind: 'project-root', path: projectRoot, secret,
  })
  const recorded = await runtime.intake.scan({
    mode: 'project-root',
    selection: { path: projectRoot, authorization },
  })
  const candidate = recorded.candidates[0]
  const command = await runtime.intake.prepareCandidate(candidate.candidateId, {
    registrationMode: 'linked_legacy',
    name: 'Legacy Project',
    expectedRevision: candidate.revision,
    documentBindings: options.documentBindings ?? [
      { role: 'readme', relativePath: 'README.md', contentHash: sha256(readmeContent) },
      { role: 'prd', relativePath: 'PRD.md', contentHash: sha256(prdContent) },
    ],
  })
  const read = {
    getStatus() {
      const status = storage.status()
      return { state: status.state, schemaVersion: status.schemaVersion, writable: true, projectCount: storage.listProjects().length }
    },
    listProjects() {
      const projects = storage.listProjects().map(project => ({
        projectId: project.projectId, name: project.name, registrationMode: project.mode,
        lifecycle: project.lifecycle, updatedAt: project.updatedAt,
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
  const origin = `http://127.0.0.1:${address.port}`
  const registered = await post(origin, '/lifecycle', command)
  assert.equal(registered.payload.data.status, 'accepted')
  const project = storage.getProject(registered.payload.data.projectId)
  assert.equal(project.mode, 'linked_legacy')
  return { tempRoot, projectRoot, storage, runtime, origin, project, prdContent, readmeContent }
}


async function post(origin, resource, body) {
  const response = await fetch(`${origin}${PROJECT_CONTROL_API_PREFIX}${resource}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-dsh-personal-client': '1' },
    body: JSON.stringify(body),
  })
  return { status: response.status, payload: await response.json() }
}

async function prepareUpgrade(origin, projectId, expectedRevision) {
  const result = await post(origin, `/intake/projects/${projectId}/prepare-upgrade`, { expectedRevision })
  assert.equal(result.status, 200, JSON.stringify(result.payload))
  assert.equal(result.payload.ok, true, JSON.stringify(result.payload))
  return result.payload.data
}

test('preparing and executing an upgrade adds only managed metadata and preserves every document', async t => {
  const { projectRoot, storage, origin, project, prdContent, readmeContent } = await registerLegacyFixture(t)
  const preview = await prepareUpgrade(origin, project.projectId, project.revision)
  assert.equal(Number(preview.documentCount), 2)
  assert.equal(validateLifecycleCommand(preview.command).ok, true)
  assert.equal(preview.writePlan.syncPolicy, 'atomic_additive')

  const submitted = await post(origin, '/lifecycle', preview.command)
  assert.equal(submitted.payload.ok, true, JSON.stringify(submitted.payload))
  const result = submitted.payload.data
  assert.equal(result.status, 'accepted', JSON.stringify(submitted.payload))
  assert.equal(result.outcome, 'managed_upgraded')
  assert.equal(result.aggregateRevision, project.revision + 1)
  assert.equal(result.fileSync.status, 'committed')

  const upgraded = storage.getProject(project.projectId)
  assert.equal(upgraded.mode, 'managed')
  assert.equal(upgraded.revision, project.revision + 1)
  assert.equal(upgraded.originKind, 'imported')
  assert.equal(storage.getFileSyncPlan(preview.writePlan.planId).state, 'accepted')
  assert.equal(await readFile(join(projectRoot, 'README.md'), 'utf8'), readmeContent)
  assert.equal(await readFile(join(projectRoot, 'PRD.md'), 'utf8'), prdContent)
  const manifestText = await readFile(join(projectRoot, '.dsh-project', 'project.yaml'), 'utf8')
  assert.match(manifestText, /\n    entries:\n      - role:/)
  assert.doesNotMatch(manifestText, /\n    entries: \[\]\n/)
  const manifest = parseYamlSubset(manifestText)
  assert.equal(manifest.metadata.projectId, project.projectId)
  assert.equal(manifest.spec.documents.docsRoot, '.')
  assert.equal(validateProjectManifest(manifest).valid, true)
  const events = storage.listEvents()
  assert.equal(events.at(-1).eventType, 'project.managed.upgraded')
  const replay = await post(origin, '/lifecycle', preview.command)
  assert.equal(replay.payload.data.status, 'replayed')
})

test('a zero-document legacy project upgrades with a valid empty manifest without inventing bindings', async t => {
  const { projectRoot, storage, origin, project } = await registerLegacyFixture(t, {
    documentBindings: [],
  })
  assert.deepEqual(project.documentBindings, [])

  const preview = await prepareUpgrade(origin, project.projectId, project.revision)
  assert.equal(Number(preview.documentCount), 0)

  const submitted = await post(origin, '/lifecycle', preview.command)
  assert.equal(submitted.payload.ok, true, JSON.stringify(submitted.payload))
  assert.equal(submitted.payload.data.status, 'accepted', JSON.stringify(submitted.payload))
  assert.equal(submitted.payload.data.outcome, 'managed_upgraded')

  const upgraded = storage.getProject(project.projectId)
  assert.equal(upgraded.mode, 'managed')
  assert.deepEqual(upgraded.documentBindings, [])
  assert.deepEqual(upgraded.manifestMirror.documentBindings, [])

  const manifestText = await readFile(join(projectRoot, '.dsh-project', 'project.yaml'), 'utf8')
  assert.match(manifestText, /\n    entries: \[\]\n/)
  const manifest = parseYamlSubset(manifestText)
  assert.deepEqual(manifest.spec.documents.entries, [])
  assert.equal(validateProjectManifest(manifest).valid, true)
})

test('a document changing after preparation rejects the upgrade and keeps the project legacy', async t => {
  const { projectRoot, storage, origin, project, prdContent } = await registerLegacyFixture(t)
  const preview = await prepareUpgrade(origin, project.projectId, project.revision)
  await writeFile(join(projectRoot, 'PRD.md'), `${prdContent}changed\n`)
  const submitted = await post(origin, '/lifecycle', preview.command)
  assert.equal(submitted.payload.data.status, 'rejected')
  assert.equal(submitted.payload.data.error.code, 'WRITE_PLAN_STALE')
  assert.equal(storage.getProject(project.projectId).mode, 'linked_legacy')
  assert.equal(storage.getFileSyncPlan(preview.writePlan.planId).state, 'planned')
  await assert.rejects(readFile(join(projectRoot, '.dsh-project', 'project.yaml')), /ENOENT/)
})

test('a tampered upgrade command is rejected before any write', async t => {
  const { projectRoot, storage, origin, project } = await registerLegacyFixture(t)
  const preview = await prepareUpgrade(origin, project.projectId, project.revision)
  const forged = structuredClone(preview.command)
  forged.payload.legacyFingerprintHash = `sha256:${'f'.repeat(64)}`
  const submitted = await post(origin, '/lifecycle', forged)
  assert.equal(submitted.payload.data.status, 'rejected')
  assert.equal(submitted.payload.data.error.code, 'REFERENCE_UNRESOLVED')
  assert.equal(storage.getProject(project.projectId).mode, 'linked_legacy')
  await assert.rejects(readFile(join(projectRoot, '.dsh-project', 'project.yaml')), /ENOENT/)
})

test('an appearing .dsh-project directory rejects the upgrade without touching the occupant', async t => {
  const { projectRoot, storage, origin, project } = await registerLegacyFixture(t)
  const preview = await prepareUpgrade(origin, project.projectId, project.revision)
  await mkdir(join(projectRoot, '.dsh-project'))
  await writeFile(join(projectRoot, '.dsh-project', 'occupant.txt'), 'occupant')
  const submitted = await post(origin, '/lifecycle', preview.command)
  assert.equal(submitted.payload.data.status, 'rejected', JSON.stringify(submitted.payload))
  assert.equal(submitted.payload.data.error.code, 'WRITE_PLAN_STALE', JSON.stringify(submitted.payload))
  assert.equal(await readFile(join(projectRoot, '.dsh-project', 'occupant.txt'), 'utf8'), 'occupant')
  assert.equal(storage.getProject(project.projectId).mode, 'linked_legacy')
})

test('an upgraded project can no longer be prepared for a second upgrade', async t => {
  const { storage, origin, project } = await registerLegacyFixture(t)
  const preview = await prepareUpgrade(origin, project.projectId, project.revision)
  const submitted = await post(origin, '/lifecycle', preview.command)
  assert.equal(submitted.payload.data.status, 'accepted', JSON.stringify(submitted.payload))
  const again = await post(origin, `/intake/projects/${project.projectId}/prepare-upgrade`, { expectedRevision: storage.getProject(project.projectId).revision })
  assert.equal(again.payload.ok, false)
  assert.equal(again.payload.error.code, 'MODE_CONFLICT')
})
