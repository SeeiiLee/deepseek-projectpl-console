import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { openProjectControlStorage } from '../src/host/index.js'
import { storageExternalAdapter } from '../src/index.ts'
import {
  createProjectControlRequestHandler,
  PROJECT_CONTROL_API_PREFIX,
} from '../src/http.ts'

const migrationsDirectory = fileURLToPath(new URL('../migrations/', import.meta.url))

const PRODUCER_VERSION = '0.1.0-producer'
const PRODUCER_INSTANCE = 'external-http-producer-01'

function serialSuffix(serial) {
  return serial.toString(16).padStart(4, '0')
}

async function openStorage(root) {
  return openProjectControlStorage({
    databasePath: join(root, 'project-control.sqlite3'),
    backupDirectory: join(root, 'backups'),
    migrationsDirectory,
    applicationVersion: '0.1.0-test',
    instanceId: 'external-http-test-host',
  })
}

function makeRoot() {
  return mkdtempSync(join(tmpdir(), 'dsh-external-http-'))
}

function cleanup(t, storage, root) {
  t.after(() => {
    storage.close()
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  })
}

function registerProject(storage, root, { projectId, name, serial }) {
  const suffix = serialSuffix(serial)
  const command = {
    protocolVersion: 'project-control.dsh/v1alpha1',
    schemaVersion: 'lifecycle-command-envelope/v1alpha1',
    commandId: `cmd_0198f4b2-7c3a-7d92-a5c6-6b6f39e3${suffix}`,
    correlationId: `corr.external-http.${serial}`,
    idempotencyKey: `external-http.register.${serial}`,
    kind: 'project.registerLegacy',
    occurredAt: '2026-08-15T12:00:00.000Z',
    actor: { kind: 'human', id: 'desktop-user', applicationId: 'deepseek-harness-personal' },
    target: { aggregateType: 'project', projectId },
    expectedRevision: 0,
    provenance: { sourceType: 'human', sourceId: 'external-http-test' },
    payload: {
      locationRef: `loc_0198f4b2-7c3a-7d92-a5c6-6b6f39e4${suffix}`,
      sourceRootRef: `srt_0198f4b2-7c3a-7d92-a5c6-6b6f39e5${suffix}`,
      name,
      documentBindings: [],
    },
  }
  const result = storage.registerProject(command, {
    location: {
      locationId: command.payload.locationRef,
      kind: 'primary',
      displayPath: join(root, 'Project-' + serial),
      normalizedPath: join(root, 'Project-' + serial).toLowerCase(),
      verifiedAt: '2026-08-15T12:00:00.000Z',
    },
    eventId: `evt_0198f4b2-7c3a-7d92-a5c6-6b6f39e6${suffix}`,
    outboxId: `out_0198f4b2-7c3a-7d92-a5c6-6b6f39e7${suffix}`,
  })
  assert.equal(result.status, 'accepted')
}

function setupAggregates(storage, root, { serial, instanceId }) {
  storage.handshakeHostInstance({
    instanceId,
    appVersion: PRODUCER_VERSION,
    protocolVersions: ['project-control.dsh/v1alpha1'],
    capabilities: ['external.update.submit'],
  })
  const projectId = `prj_0198f4b2-7c3a-7d92-a5c6-6b6f39e9${serialSuffix(serial)}`
  registerProject(storage, root, { projectId, name: 'External HTTP Project', serial })
  const workItem = storage.createWorkItem(projectId, {
    title: 'Wire the HTTP pipeline',
    instruction: 'Deliver the external update adapter over HTTP.',
    acceptance: ['updates accepted', 'lists served'],
  })
  const run = storage.createRun(projectId, workItem.workItemId)
  storage.bindAgentThread(projectId, run.runId, {
    harnessInstanceRef: instanceId,
    sessionId: 'session-' + serial,
    threadId: 'thread-' + serial,
  })
  return { projectId, workItem, run }
}

function makeExternalCommand({ kind, projectId, workItemId, runId, threadId, expectedRevision, serial, instanceId = PRODUCER_INSTANCE, payload, targetAggregate = 'run' }) {
  const suffix = serialSuffix(serial)
  return {
    protocolVersion: 'project-control.dsh/v1alpha1',
    schemaVersion: 'command-envelope/v1alpha1',
    commandId: `cmd_0198f4b2-7c3a-7d92-a5c6-6b6f39f8${suffix}`,
    correlationId: `corr.external-http-update.${serial}`,
    idempotencyKey: `external-http.update.${serial}`,
    kind,
    occurredAt: '2026-08-15T12:05:00.000Z',
    actor: { kind: 'agent', id: 'dev-agent', applicationId: 'deepseek-harness-personal-dev' },
    target: {
      projectId,
      workItemId,
      runId,
      threadId,
      aggregateType: targetAggregate,
      aggregateId: targetAggregate === 'run' ? runId : workItemId,
    },
    expectedRevision,
    provenance: {
      sourceType: 'agent',
      sourceId: 'agent-run-' + serial,
      applicationVersion: PRODUCER_VERSION,
      applicationInstanceId: instanceId,
      observedAt: '2026-08-15T12:05:00.000Z',
    },
    payload,
  }
}

const readyService = {
  getStatus() {
    return { state: 'ready', schemaVersion: 9, writable: true, projectCount: 1 }
  },
  listProjects() {
    return { projects: [], total: 0 }
  },
}

async function serve(t, options = {}) {
  const server = createServer(createProjectControlRequestHandler(readyService, options))
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  t.after(() => new Promise(resolve => { server.close(resolve) }))
  const address = server.address()
  assert.equal(typeof address, 'object')
  return `http://127.0.0.1:${address.port}`
}

async function api(origin, resource, init = {}) {
  const response = await fetch(`${origin}${PROJECT_CONTROL_API_PREFIX}${resource}`, {
    ...init,
    headers: {
      'x-dsh-personal-client': '1',
      ...init.headers,
    },
  })
  return { response, payload: await response.json() }
}

async function postJson(origin, resource, body) {
  return api(origin, resource, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

test('serves the Gate 2E external routes end to end', async t => {
  const root = makeRoot()
  const storage = await openStorage(root)
  cleanup(t, storage, root)
  const { projectId, workItem, run } = setupAggregates(storage, root, {
    serial: 5,
    instanceId: PRODUCER_INSTANCE,
  })
  const origin = await serve(t, { external: storageExternalAdapter(storage) })

  // capability handshake
  const handshake = await postJson(origin, '/handshake', {
    instanceId: PRODUCER_INSTANCE,
    appVersion: PRODUCER_VERSION,
    protocolVersions: ['project-control.dsh/v1alpha1'],
    capabilities: ['external.update.submit'],
  })
  assert.equal(handshake.response.status, 200)
  assert.equal(handshake.payload.data.instanceId, PRODUCER_INSTANCE)
  assert.deepEqual(handshake.payload.data.capabilities, ['external.update.submit'])

  // progress → accepted
  const progress = await postJson(origin, '/external-updates', makeExternalCommand({
    kind: 'progress.report', projectId, workItemId: workItem.workItemId, runId: run.runId,
    threadId: 'thread-5', expectedRevision: 1, serial: 50,
    payload: { summary: 'halfway there', completionPercent: 50 },
  }))
  assert.equal(progress.response.status, 200)
  assert.equal(progress.payload.data.status, 'accepted')
  assert.equal(progress.payload.data.aggregateRevision, 2)
  assert.equal(progress.payload.data.aggregateType, 'run')

  // blocker → run blocked
  const blocker = await postJson(origin, '/external-updates', makeExternalCommand({
    kind: 'blocker.raise', projectId, workItemId: workItem.workItemId, runId: run.runId,
    threadId: 'thread-5', expectedRevision: 2, serial: 51,
    payload: { summary: 'stuck', impact: 'cannot continue', needs: ['a decision'] },
  }))
  assert.equal(blocker.payload.data.status, 'accepted')

  // completion → run completed
  const completion = await postJson(origin, '/external-updates', makeExternalCommand({
    kind: 'completion.declare', projectId, workItemId: workItem.workItemId, runId: run.runId,
    threadId: 'thread-5', expectedRevision: 3, serial: 52,
    payload: {
      summary: 'done',
      acceptanceClaims: ['all updates accepted'],
      evidence: [{ kind: 'test', ref: 'external-http.test.js' }],
    },
  }))
  assert.equal(completion.payload.data.status, 'accepted')

  // replay returns the accepted shape with status replayed
  const replay = await postJson(origin, '/external-updates', makeExternalCommand({
    kind: 'progress.report', projectId, workItemId: workItem.workItemId, runId: run.runId,
    threadId: 'thread-5', expectedRevision: 1, serial: 50,
    payload: { summary: 'halfway there', completionPercent: 50 },
  }))
  assert.equal(replay.response.status, 200)
  assert.equal(replay.payload.data.status, 'replayed')
  assert.equal(replay.payload.data.aggregateRevision, 2)

  // P6 projections
  const workItems = await api(origin, `/projects/${projectId}/work-items`)
  assert.equal(workItems.response.status, 200)
  assert.equal(workItems.payload.data.total, 1)
  assert.equal(workItems.payload.data.items[0].title, 'Wire the HTTP pipeline')
  assert.equal(workItems.payload.data.items[0].executionStatus, 'draft')
  assert.doesNotMatch(JSON.stringify(workItems.payload), /sqlite|SELECT/u)

  const runs = await api(origin, `/projects/${projectId}/runs`)
  assert.equal(runs.payload.data.total, 1)
  assert.equal(runs.payload.data.items[0].status, 'completed')

  const filtered = await api(origin, `/projects/${projectId}/runs?workItemId=${workItem.workItemId}`)
  assert.equal(filtered.payload.data.total, 1)

  const updates = await api(origin, `/projects/${projectId}/progress-updates`)
  assert.equal(updates.payload.data.total, 3)
  assert.deepEqual(updates.payload.data.items.map(item => item.kind), ['progress', 'blocker', 'completion_declared'])
  assert.equal(updates.payload.data.items[0].completionPercent, 50)

  const reviews = await api(origin, `/projects/${projectId}/reviews`)
  assert.equal(reviews.payload.data.total, 0)
  const decisions = await api(origin, `/projects/${projectId}/decisions`)
  assert.equal(decisions.payload.data.total, 0)

  // quarantine projection
  storage.recordQuarantineItem({
    projectId,
    sourceKind: 'external_update',
    sourceRef: 'agent-run-50',
    reasonCode: 'SCHEMA_INVALID',
    details: { field: 'payload.summary' },
  })
  const quarantine = await api(origin, '/quarantine')
  assert.equal(quarantine.response.status, 200)
  assert.equal(quarantine.payload.data.total, 1)
  assert.equal(quarantine.payload.data.quarantineItems[0].reasonCode, 'SCHEMA_INVALID')
  assert.equal(quarantine.payload.data.quarantineItems[0].status, 'open')

  // repair: resolve the quarantine item
  const quarantineId = quarantine.payload.data.quarantineItems[0].quarantineId
  const resolved = await postJson(origin, `/quarantine/${quarantineId}/resolve`, {
    expectedRevision: 1,
    decision: 'resolved',
  })
  assert.equal(resolved.response.status, 200)
  assert.equal(resolved.payload.data.status, 'resolved')
  assert.equal(typeof resolved.payload.data.resolvedAt, 'string')
  const staleResolve = await postJson(origin, `/quarantine/${quarantineId}/resolve`, {
    expectedRevision: 1,
    decision: 'ignored',
  })
  assert.equal(staleResolve.response.status, 500)
  assert.equal(staleResolve.payload.error.code, 'INTERNAL_ERROR', 'stale revision stays a private storage error')

  // audit: events projection with pagination
  const events = await api(origin, `/projects/${projectId}/events`)
  assert.equal(events.response.status, 200)
  assert.equal(events.payload.data.total, 6, 'registration + creations + progress + blocker + completion')
  assert.deepEqual(
    events.payload.data.items.map(item => item.eventType),
    [
      'project.legacy.registered',
      'workitem.created',
      'run.created',
      'progress.recorded',
      'blocker.raised',
      'completion.declared',
    ],
  )
  const sequences = events.payload.data.items.map(item => item.sequence)
  assert.deepEqual(sequences, [...sequences].sort((a, b) => a - b))
  const afterFour = await api(origin, `/projects/${projectId}/events?afterSequence=4`)
  assert.equal(afterFour.payload.data.total, 2)
  assert.deepEqual(afterFour.payload.data.items.map(item => item.sequence), [5, 6])
  const badCursor = await api(origin, `/projects/${projectId}/events?afterSequence=-1`)
  assert.equal(badCursor.response.status, 400)
  assert.equal(badCursor.payload.error.code, 'INVALID_QUERY')
})

test('invalid envelopes get 400 and capability failures surface as rejected results', async t => {
  const root = makeRoot()
  const storage = await openStorage(root)
  cleanup(t, storage, root)
  const { projectId, workItem, run } = setupAggregates(storage, root, {
    serial: 6,
    instanceId: PRODUCER_INSTANCE,
  })
  const origin = await serve(t, { external: storageExternalAdapter(storage) })

  const invalid = await postJson(origin, '/external-updates', { nope: true })
  assert.equal(invalid.response.status, 400)
  assert.equal(invalid.payload.error.code, 'SCHEMA_INVALID')

  const unhandshaken = await postJson(origin, '/external-updates', makeExternalCommand({
    kind: 'progress.report', projectId, workItemId: workItem.workItemId, runId: run.runId,
    threadId: 'thread-6', expectedRevision: 1, serial: 60, instanceId: 'never-handshaken-host',
    payload: { summary: 'progress' },
  }))
  assert.equal(unhandshaken.response.status, 200)
  assert.equal(unhandshaken.payload.data.status, 'rejected')
  assert.equal(unhandshaken.payload.data.error.code, 'CAPABILITY_NOT_NEGOTIATED')

  const stale = await postJson(origin, '/external-updates', makeExternalCommand({
    kind: 'progress.report', projectId, workItemId: workItem.workItemId, runId: run.runId,
    threadId: 'thread-6', expectedRevision: 99, serial: 61,
    payload: { summary: 'late' },
  }))
  assert.equal(stale.payload.data.status, 'rejected')
  assert.equal(stale.payload.data.error.code, 'REVISION_CONFLICT')
  assert.equal(stale.payload.data.currentRevision, 1)
})

test('route rules hold when the external service is absent or the method is wrong', async t => {
  const origin = await serve(t)

  const handshake = await postJson(origin, '/handshake', { instanceId: 'x', appVersion: '1' })
  assert.equal(handshake.response.status, 503)
  assert.equal(handshake.payload.error.code, 'EXTERNAL_UNAVAILABLE')

  const method = await api(origin, '/handshake')
  assert.equal(method.response.status, 405)
  assert.equal(method.payload.error.code, 'METHOD_NOT_ALLOWED')

  const unknown = await api(origin, '/projects/prj_0198f4b2-7c3a-7d11-a5c6-6b6f39e34711/work-items')
  assert.equal(unknown.response.status, 503)
  assert.equal(unknown.payload.error.code, 'EXTERNAL_UNAVAILABLE')
})
