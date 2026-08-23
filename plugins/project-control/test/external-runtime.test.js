import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { fileURLToPath } from 'node:url'
import { openProjectControlStorage } from '../src/host/index.js'

const migrationsDirectory = fileURLToPath(new URL('../migrations/', import.meta.url))

function serialSuffix(serial) {
  return serial.toString(16).padStart(4, '0')
}

async function openStorage(root, instanceId = 'external-runtime-test-host') {
  return openProjectControlStorage({
    databasePath: join(root, 'project-control.sqlite3'),
    backupDirectory: join(root, 'backups'),
    migrationsDirectory,
    applicationVersion: '0.1.0-test',
    instanceId,
  })
}

function makeRoot() {
  return mkdtempSync(join(tmpdir(), 'dsh-external-runtime-'))
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
    correlationId: `corr.external.${serial}`,
    idempotencyKey: `external.register.${serial}`,
    kind: 'project.registerLegacy',
    occurredAt: '2026-08-15T12:00:00.000Z',
    actor: { kind: 'human', id: 'desktop-user', applicationId: 'deepseek-harness-personal' },
    target: { aggregateType: 'project', projectId },
    expectedRevision: 0,
    provenance: { sourceType: 'human', sourceId: 'external-runtime-test' },
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

function makeExternalCommand({ kind, projectId, workItemId, runId, threadId, expectedRevision, serial, instanceId, appVersion = '0.1.0-producer', payload, targetAggregate = 'run' }) {
  const suffix = serialSuffix(serial)
  return {
    protocolVersion: 'project-control.dsh/v1alpha1',
    schemaVersion: 'command-envelope/v1alpha1',
    commandId: `cmd_0198f4b2-7c3a-7d92-a5c6-6b6f39f8${suffix}`,
    correlationId: `corr.external-update.${serial}`,
    idempotencyKey: `external.update.${serial}`,
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
      applicationVersion: appVersion,
      applicationInstanceId: instanceId,
      observedAt: '2026-08-15T12:05:00.000Z',
    },
    payload,
  }
}

function setupAggregates(storage, root, { serial, instanceId }) {
  storage.handshakeHostInstance({
    instanceId,
    appVersion: '0.1.0-producer',
    protocolVersions: ['project-control.dsh/v1alpha1'],
    capabilities: ['external.update.submit'],
  })
  const projectId = `prj_0198f4b2-7c3a-7d92-a5c6-6b6f39e9${serialSuffix(serial)}`
  registerProject(storage, root, { projectId, name: 'External Project', serial })
  const workItem = storage.createWorkItem(projectId, {
    title: 'Wire the pipeline',
    instruction: 'Deliver the external update adapter.',
    acceptance: ['updates accepted', 'events recorded'],
  })
  const run = storage.createRun(projectId, workItem.workItemId)
  const binding = storage.bindAgentThread(projectId, run.runId, {
    harnessInstanceRef: instanceId,
    sessionId: 'session-' + serial,
    threadId: 'thread-' + serial,
  })
  return { projectId, workItem, run, binding }
}

test('capability handshake, work items, runs and thread bindings form the P6 foundation', async t => {
  const root = makeRoot()
  const storage = await openStorage(root)
  cleanup(t, storage, root)

  const first = storage.handshakeHostInstance({
    instanceId: 'agent-host-1',
    appVersion: '0.1.0-producer',
    protocolVersions: ['project-control.dsh/v1alpha1'],
    capabilities: ['external.update.submit'],
  })
  assert.equal(first.revision, 1)
  assert.deepEqual(first.capabilities, ['external.update.submit'])
  const second = storage.handshakeHostInstance({
    instanceId: 'agent-host-1',
    appVersion: '0.1.1-producer',
    protocolVersions: ['project-control.dsh/v1alpha1'],
    capabilities: ['external.update.submit'],
  })
  assert.equal(second.revision, 2)
  assert.equal(second.appVersion, '0.1.1-producer')

  const { projectId, workItem, run, binding } = setupAggregates(storage, root, {
    serial: 1,
    instanceId: 'agent-host-1',
  })
  assert.equal(workItem.executionStatus, 'draft')
  assert.equal(workItem.reviewStatus, 'not_requested')
  assert.equal(run.status, 'queued')
  assert.equal(run.attemptNo, 1)
  assert.equal(binding.threadId, 'thread-1')
  assert.equal(storage.getWorkItem(workItem.workItemId).title, 'Wire the pipeline')
  assert.equal(storage.listRuns({ projectId }).length, 1)
  assert.equal(storage.listWorkItems({ projectId }).length, 1)
})

test('unhandshaken producers and mismatched versions are refused before any write', async t => {
  const root = makeRoot()
  const storage = await openStorage(root)
  cleanup(t, storage, root)
  const { projectId, workItem, run } = setupAggregates(storage, root, {
    serial: 2,
    instanceId: 'agent-host-2',
  })

  const noHandshake = makeExternalCommand({
    kind: 'progress.report', projectId, workItemId: workItem.workItemId, runId: run.runId,
    threadId: 'thread-2', expectedRevision: 1, serial: 20, instanceId: 'ghost-host',
    payload: { summary: 'progress' },
  })
  const refused = storage.applyExternalUpdate(noHandshake)
  assert.equal(refused.status, 'rejected')
  assert.equal(refused.error.code, 'CAPABILITY_NOT_NEGOTIATED')

  const versionMismatch = makeExternalCommand({
    kind: 'progress.report', projectId, workItemId: workItem.workItemId, runId: run.runId,
    threadId: 'thread-2', expectedRevision: 1, serial: 21, instanceId: 'agent-host-2',
    appVersion: '0.9.9-impostor',
    payload: { summary: 'progress' },
  })
  const mismatched = storage.applyExternalUpdate(versionMismatch)
  assert.equal(mismatched.status, 'rejected')
  assert.equal(mismatched.error.code, 'CAPABILITY_NOT_NEGOTIATED')
  assert.equal(storage.getRun(run.runId).revision, 1)
  assert.equal(storage.listProgressUpdates({ projectId }).length, 0)
})

test('accepted updates advance exactly one aggregate, record events and keep idempotency', async t => {
  const root = makeRoot()
  const storage = await openStorage(root)
  cleanup(t, storage, root)
  const { projectId, workItem, run } = setupAggregates(storage, root, {
    serial: 3,
    instanceId: 'agent-host-3',
  })

  const progress = makeExternalCommand({
    kind: 'progress.report', projectId, workItemId: workItem.workItemId, runId: run.runId,
    threadId: 'thread-3', expectedRevision: 1, serial: 30, instanceId: 'agent-host-3',
    payload: { summary: 'halfway there', completionPercent: 50, nextSteps: ['finish'] },
  })
  const accepted = storage.applyExternalUpdate(progress)
  assert.equal(accepted.status, 'accepted')
  assert.equal(accepted.aggregateRevision, 2)
  assert.equal(storage.getRun(run.runId).revision, 2)
  assert.equal(storage.getRun(run.runId).status, 'queued', 'progress must not change run status')
  const updates = storage.listProgressUpdates({ projectId })
  assert.equal(updates.length, 1)
  assert.equal(updates[0].kind, 'progress')
  assert.equal(updates[0].completionPercent, 50)
  const events = storage.listEvents({ projectId })
  assert.equal(events.length, 4, 'registration + workitem/run creation + one external update')
  assert.equal(events.at(-1).eventType, 'progress.recorded')
  assert.equal(events.at(-1).aggregateType, 'run')
  const outbox = storage.listOutbox({ limit: 100 })
  assert.equal(outbox.length, 2, 'creation events have no outbox rows')

  const replay = storage.applyExternalUpdate(progress)
  assert.equal(replay.status, 'replayed')
  assert.equal(storage.listProgressUpdates({ projectId }).length, 1, 'replay must not duplicate updates')
  assert.equal(storage.listEvents({ projectId }).length, 4)

  const blocker = makeExternalCommand({
    kind: 'blocker.raise', projectId, workItemId: workItem.workItemId, runId: run.runId,
    threadId: 'thread-3', expectedRevision: 2, serial: 31, instanceId: 'agent-host-3',
    payload: { summary: 'stuck', impact: 'cannot continue', needs: ['a decision'] },
  })
  const blocked = storage.applyExternalUpdate(blocker)
  assert.equal(blocked.status, 'accepted')
  assert.equal(storage.getRun(run.runId).status, 'blocked')

  const completion = makeExternalCommand({
    kind: 'completion.declare', projectId, workItemId: workItem.workItemId, runId: run.runId,
    threadId: 'thread-3', expectedRevision: 3, serial: 32, instanceId: 'agent-host-3',
    payload: {
      summary: 'done',
      acceptanceClaims: ['all updates accepted'],
      evidence: [{ kind: 'test', ref: 'external-runtime.test.js' }],
    },
  })
  const completed = storage.applyExternalUpdate(completion)
  assert.equal(completed.status, 'accepted')
  assert.equal(storage.getRun(run.runId).status, 'completed')
  assert.equal(storage.getRun(run.runId).revision, 4)

  const workItemCompletion = makeExternalCommand({
    kind: 'completion.declare', projectId, workItemId: workItem.workItemId, runId: run.runId,
    threadId: 'thread-3', expectedRevision: 1, serial: 33, instanceId: 'agent-host-3',
    targetAggregate: 'work_item',
    payload: {
      summary: 'work item delivered',
      acceptanceClaims: ['pipeline verified'],
      evidence: [{ kind: 'test', ref: 'external-runtime.test.js' }],
    },
  })
  const wiCompleted = storage.applyExternalUpdate(workItemCompletion)
  assert.equal(wiCompleted.status, 'accepted')
  assert.equal(storage.getWorkItem(workItem.workItemId).executionStatus, 'completed')
  assert.equal(storage.getWorkItem(workItem.workItemId).reviewStatus, 'pending')
  assert.equal(storage.getWorkItem(workItem.workItemId).revision, 2)
  const kinds = storage.listProgressUpdates({ projectId }).map(update => update.kind)
  assert.deepEqual(kinds, ['progress', 'blocker', 'completion_declared', 'completion_declared'])
  const workItemEvents = storage.listEvents({ projectId }).filter(event => event.aggregateType === 'work_item')
  assert.equal(workItemEvents.length, 2)
  assert.equal(workItemEvents[0].eventType, 'workitem.created')
  assert.equal(workItemEvents[1].eventType, 'completion.declared')
})

test('revision conflicts and unbound session threads reject without side effects', async t => {
  const root = makeRoot()
  const storage = await openStorage(root)
  cleanup(t, storage, root)
  const { projectId, workItem, run } = setupAggregates(storage, root, {
    serial: 4,
    instanceId: 'agent-host-4',
  })

  const stale = makeExternalCommand({
    kind: 'progress.report', projectId, workItemId: workItem.workItemId, runId: run.runId,
    threadId: 'thread-4', expectedRevision: 9, serial: 40, instanceId: 'agent-host-4',
    payload: { summary: 'late' },
  })
  const rejected = storage.applyExternalUpdate(stale)
  assert.equal(rejected.status, 'rejected')
  assert.equal(rejected.error.code, 'REVISION_CONFLICT')
  assert.equal(rejected.currentRevision, 1)

  const wrongThread = makeExternalCommand({
    kind: 'progress.report', projectId, workItemId: workItem.workItemId, runId: run.runId,
    threadId: 'some-other-thread', expectedRevision: 1, serial: 41, instanceId: 'agent-host-4',
    payload: { summary: 'routed' },
  })
  const unrouted = storage.applyExternalUpdate(wrongThread)
  assert.equal(unrouted.status, 'rejected')
  assert.equal(unrouted.error.code, 'REFERENCE_UNRESOLVED')
  assert.equal(storage.listProgressUpdates({ projectId }).length, 0)
  assert.equal(storage.getRun(run.runId).revision, 1)
})

test('the 8-to-9 migration rebuild preserves existing events and outbox rows', async t => {
  const root = makeRoot()
  const staged = join(root, 'migrations8')
  mkdirSync(staged, { recursive: true })
  for (const name of readdirSync(migrationsDirectory)) {
    if (name.startsWith('0009')) continue
    copyFileSync(join(migrationsDirectory, name), join(staged, name))
  }
  const first = await openProjectControlStorage({
    databasePath: join(root, 'db.sqlite3'),
    backupDirectory: join(root, 'backups'),
    migrationsDirectory: staged,
    applicationVersion: '0.1.0-test',
    instanceId: 'upgrade-test-1',
  })
  assert.equal(first.status().schemaVersion, 8)
  registerProject(first, root, {
    projectId: 'prj_0198f4b2-7c3a-7d92-a5c6-6b6f39e9a90',
    name: 'Upgrade Project',
    serial: 90,
  })
  assert.equal(first.listEvents().length, 1)
  assert.equal(first.listOutbox().length, 1)
  first.close()

  const second = await openProjectControlStorage({
    databasePath: join(root, 'db.sqlite3'),
    backupDirectory: join(root, 'backups'),
    migrationsDirectory,
    applicationVersion: '0.1.0-test',
    instanceId: 'upgrade-test-2',
  })
  assert.equal(second.status().schemaVersion, 9)
  const events = second.listEvents()
  assert.equal(events.length, 1, 'event rows must survive the rebuild')
  assert.equal(events[0].aggregateType, 'project')
  assert.equal(second.listOutbox().length, 1, 'outbox rows must survive the rebuild')
  second.close()
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
})

test('quarantine records, lists and resolves with revision protection', async t => {
  const root = makeRoot()
  const storage = await openStorage(root)
  cleanup(t, storage, root)

  const quarantined = storage.recordQuarantineItem({
    sourceKind: 'external_update',
    sourceRef: 'cmd_0198f4b2-7c3a-7d92-a5c6-6b6f39e8888',
    reasonCode: 'UNTRUSTED_PRODUCER',
    details: { message: 'unrecognized producer' },
  })
  assert.equal(quarantined.status, 'open')
  assert.equal(quarantined.revision, 1)
  assert.equal(storage.listQuarantineItems({ status: 'open' }).length, 1)

  assert.throws(
    () => storage.resolveQuarantineItem(quarantined.quarantineId, { expectedRevision: 5, decision: 'resolved' }),
    /changed before resolution/u,
  )
  const resolved = storage.resolveQuarantineItem(quarantined.quarantineId, { expectedRevision: 1, decision: 'resolved' })
  assert.equal(resolved.status, 'resolved')
  assert.equal(storage.listQuarantineItems({ status: 'open' }).length, 0)
  assert.equal(storage.listQuarantineItems({ status: 'resolved' }).length, 1)
})
