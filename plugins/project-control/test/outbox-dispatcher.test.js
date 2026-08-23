import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { openProjectControlStorage } from '../src/host/index.js'
import { createOutboxDispatcher } from '../src/outbox-dispatcher.js'
import { renderProgressUpdate } from '../src/updates-renderer.js'

const migrationsDirectory = fileURLToPath(new URL('../migrations/', import.meta.url))

function serialSuffix(serial) {
  return serial.toString(16).padStart(4, '0')
}

function sha256Text(text) {
  return `sha256:${createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex')}`
}

async function openStorage(root) {
  return openProjectControlStorage({
    databasePath: join(root, 'project-control.sqlite3'),
    backupDirectory: join(root, 'backups'),
    migrationsDirectory,
    applicationVersion: '0.1.0-test',
    instanceId: 'outbox-dispatcher-test-host',
  })
}

function makeRoot() {
  return mkdtempSync(join(tmpdir(), 'dsh-outbox-dispatcher-'))
}

function cleanup(t, storage, root) {
  t.after(() => {
    storage.close()
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  })
}

function registerProject(storage, root, { projectId, name, serial, mode = 'legacy' }) {
  const suffix = serialSuffix(serial)
  const kind = mode === 'managed' ? 'project.registerManaged' : 'project.registerLegacy'
  const manifestHash = mode === 'managed' ? sha256Text('manifest ' + serial) : undefined
  const command = {
    protocolVersion: 'project-control.dsh/v1alpha1',
    schemaVersion: 'lifecycle-command-envelope/v1alpha1',
    commandId: `cmd_0198f4b2-7c3a-7d92-a5c6-6b6f39e3${suffix}`,
    correlationId: `corr.outbox.${serial}`,
    idempotencyKey: `outbox.register.${serial}`,
    kind,
    occurredAt: '2026-08-15T12:00:00.000Z',
    actor: { kind: 'human', id: 'desktop-user', applicationId: 'deepseek-harness-personal' },
    target: { aggregateType: 'project', projectId },
    expectedRevision: 0,
    provenance: { sourceType: 'human', sourceId: 'outbox-dispatcher-test' },
    payload: {
      locationRef: `loc_0198f4b2-7c3a-7d92-a5c6-6b6f39e4${suffix}`,
      sourceRootRef: `srt_0198f4b2-7c3a-7d92-a5c6-6b6f39e5${suffix}`,
      name,
      documentBindings: [],
      ...(manifestHash === undefined ? {} : { manifestHash }),
    },
  }
  const trusted = {
    location: {
      locationId: command.payload.locationRef,
      kind: 'primary',
      displayPath: join(root, 'Project-' + serial),
      normalizedPath: join(root, 'Project-' + serial).toLowerCase(),
      verifiedAt: '2026-08-15T12:00:00.000Z',
    },
    eventId: `evt_0198f4b2-7c3a-7d92-a5c6-6b6f39e6${suffix}`,
    outboxId: `out_0198f4b2-7c3a-7d92-a5c6-6b6f39e7${suffix}`,
    ...(mode === 'managed'
      ? {
          manifestName: name,
          manifestHash,
          manifestDocumentBindings: [],
          origin: { kind: 'imported' },
        }
      : {}),
  }
  const result = storage.registerProject(command, trusted)
  assert.equal(result.status, 'accepted')
}

function setupAggregates(storage, root, { serial, instanceId, mode }) {
  storage.handshakeHostInstance({
    instanceId,
    appVersion: '0.1.0-producer',
    protocolVersions: ['project-control.dsh/v1alpha1'],
    capabilities: ['external.update.submit'],
  })
  const projectId = `prj_0198f4b2-7c3a-7d92-a5c6-6b6f39e9${serialSuffix(serial)}`
  registerProject(storage, root, { projectId, name: 'Dispatcher Project', serial, mode })
  const workItem = storage.createWorkItem(projectId, { title: 'Dispatch updates', acceptance: ['file mirror'] })
  const run = storage.createRun(projectId, workItem.workItemId)
  storage.bindAgentThread(projectId, run.runId, {
    harnessInstanceRef: instanceId,
    sessionId: 'session-' + serial,
    threadId: 'thread-' + serial,
  })
  return { projectId, workItem, run }
}

function makeExternalCommand({ projectId, workItemId, runId, threadId, expectedRevision, serial, instanceId, kind = 'progress.report', payload }) {
  const suffix = serialSuffix(serial)
  return {
    protocolVersion: 'project-control.dsh/v1alpha1',
    schemaVersion: 'command-envelope/v1alpha1',
    commandId: `cmd_0198f4b2-7c3a-7d92-a5c6-6b6f39f8${suffix}`,
    correlationId: `corr.outbox-update.${serial}`,
    idempotencyKey: `outbox.update.${serial}`,
    kind,
    occurredAt: '2026-08-15T12:05:00.000Z',
    actor: { kind: 'agent', id: 'dev-agent', applicationId: 'deepseek-harness-personal-dev' },
    target: {
      projectId,
      workItemId,
      runId,
      threadId,
      aggregateType: 'run',
      aggregateId: runId,
    },
    expectedRevision,
    provenance: {
      sourceType: 'agent',
      sourceId: 'agent-run-' + serial,
      applicationVersion: '0.1.0-producer',
      applicationInstanceId: instanceId,
      observedAt: '2026-08-15T12:05:00.000Z',
    },
    payload,
  }
}

test('drains accepted updates into the managed project standard log and marks delivery', async t => {
  const root = makeRoot()
  const projectRoot = join(root, 'Project-1')
  mkdirSync(projectRoot, { recursive: true })
  const storage = await openStorage(root)
  cleanup(t, storage, root)
  const { projectId, workItem, run } = setupAggregates(storage, root, { serial: 1, instanceId: 'dispatcher-agent-1', mode: 'managed' })

  const command = makeExternalCommand({
    projectId, workItemId: workItem.workItemId, runId: run.runId, threadId: 'thread-1',
    expectedRevision: 1, serial: 10, instanceId: 'dispatcher-agent-1',
    payload: { summary: 'halfway there', completionPercent: 50, nextSteps: ['finish'] },
  })
  const accepted = storage.applyExternalUpdate(command)
  assert.equal(accepted.status, 'accepted')

  const pending = storage.listOutbox({ status: 'pending' })
  const external = pending.filter(message => message.schemaVersion === 'normalized-event/v1alpha1')
  const lifecycle = pending.filter(message => message.schemaVersion !== 'normalized-event/v1alpha1')
  assert.equal(external.length, 1)
  assert.ok(lifecycle.length >= 1, 'registration events stay pending for their own consumer')

  const dispatcher = createOutboxDispatcher({ storage })
  const result = await dispatcher.drain()
  assert.deepEqual(result.failed, [])
  assert.deepEqual(result.delivered, [external[0].outboxId])

  const update = storage.listProgressUpdates({ projectId })[0]
  const rendered = renderProgressUpdate({
    update,
    eventId: storage.listEvents({ projectId }).at(-1).eventId,
    actor: command.actor,
    occurredAt: command.occurredAt,
    recordedAt: accepted.recordedAt,
    generatedBy: update.generatedBy,
  })
  const filePath = join(projectRoot, rendered.relativePath)
  assert.equal(existsSync(filePath), true)
  assert.equal(readFileSync(filePath, 'utf8'), rendered.markdown)

  const delivered = storage.listOutbox({ status: 'delivered' }).find(message => message.outboxId === external[0].outboxId)
  assert.ok(delivered, 'message marked delivered')
  assert.equal(delivered.attemptCount, 1)
  assert.equal(typeof delivered.deliveredAt, 'string')

  // the remaining lifecycle message is untouched by the external-only dispatcher
  assert.equal(storage.listOutbox({ status: 'pending' }).length, lifecycle.length)
})

test('legacy projects deliver without writing into their workspace', async t => {
  const root = makeRoot()
  const projectRoot = join(root, 'Project-2')
  mkdirSync(projectRoot, { recursive: true })
  const storage = await openStorage(root)
  cleanup(t, storage, root)
  const { projectId, workItem, run } = setupAggregates(storage, root, { serial: 2, instanceId: 'dispatcher-agent-2', mode: 'legacy' })

  const accepted = storage.applyExternalUpdate(makeExternalCommand({
    projectId, workItemId: workItem.workItemId, runId: run.runId, threadId: 'thread-2',
    expectedRevision: 1, serial: 20, instanceId: 'dispatcher-agent-2',
    payload: { summary: 'legacy progress' },
  }))
  assert.equal(accepted.status, 'accepted')

  const dispatcher = createOutboxDispatcher({ storage })
  const result = await dispatcher.drain()
  assert.equal(result.failed.length, 0)
  assert.equal(result.delivered.length, 1)
  assert.equal(existsSync(join(projectRoot, '.dsh-project')), false, 'legacy workspace stays untouched')
  assert.equal(storage.listOutbox({ status: 'pending' }).filter(m => m.schemaVersion === 'normalized-event/v1alpha1').length, 0)
})

test('delivery failures back off, then quarantine instead of retrying forever', async t => {
  const root = makeRoot()
  const projectRoot = join(root, 'Project-3')
  mkdirSync(projectRoot, { recursive: true })
  const storage = await openStorage(root)
  cleanup(t, storage, root)
  const { projectId, workItem, run } = setupAggregates(storage, root, { serial: 3, instanceId: 'dispatcher-agent-3', mode: 'managed' })

  storage.applyExternalUpdate(makeExternalCommand({
    projectId, workItemId: workItem.workItemId, runId: run.runId, threadId: 'thread-3',
    expectedRevision: 1, serial: 30, instanceId: 'dispatcher-agent-3',
    payload: { summary: 'will fail' },
  }))

  let clock = new Date().toISOString()
  let writeCalls = 0
  const dispatcher = createOutboxDispatcher({
    storage,
    now: () => clock,
    maxAttempts: 3,
    retryBaseMs: 10_000,
    fileSystem: {
      mkdir: async () => {},
      writeFile: async () => { writeCalls += 1; throw new Error('disk full') },
    },
  })

  // attempt 1 fails and schedules the next attempt 10s out
  const externalPending = () => storage.listOutbox({ status: 'pending' })
    .find(message => message.schemaVersion === 'normalized-event/v1alpha1')
  let result = await dispatcher.drain()
  assert.equal(result.failed.length, 1)
  assert.equal(result.delivered.length, 0)
  let pending = externalPending()
  assert.equal(pending.attemptCount, 1)
  assert.equal(pending.nextAttemptAt, new Date(Date.parse(clock) + 10_000).toISOString())

  // the backoff window is respected: nothing retried yet
  result = await dispatcher.drain()
  assert.equal(result.failed.length, 0)
  assert.equal(writeCalls, 1)

  // after the window, attempt 2 fails and schedules 20s out
  clock = new Date(Date.parse(clock) + 11_000).toISOString()
  result = await dispatcher.drain()
  assert.equal(result.failed.length, 1)
  pending = externalPending()
  assert.equal(pending.attemptCount, 2)
  assert.equal(pending.nextAttemptAt, new Date(Date.parse(clock) + 20_000).toISOString())

  // the final attempt quarantines and marks the message failed
  clock = new Date(Date.parse(clock) + 21_000).toISOString()
  result = await dispatcher.drain()
  assert.equal(result.failed.length, 1)
  assert.equal(externalPending(), undefined)
  const failed = storage.listOutbox({ status: 'failed' })[0]
  assert.equal(failed.attemptCount, 3)
  assert.match(failed.lastError, /disk full/u)
  const quarantine = storage.listQuarantineItems()
  assert.equal(quarantine.length, 1)
  assert.equal(quarantine[0].sourceKind, 'outbox_delivery')
  assert.equal(quarantine[0].reasonCode, 'OUTBOX_DELIVERY_FAILED')
  assert.equal(quarantine[0].status, 'open')
})

test('overlapping drains share one single flight and never double-deliver', async t => {
  const root = makeRoot()
  const projectRoot = join(root, 'Project-4')
  mkdirSync(projectRoot, { recursive: true })
  const storage = await openStorage(root)
  cleanup(t, storage, root)
  const { projectId, workItem, run } = setupAggregates(storage, root, { serial: 4, instanceId: 'dispatcher-agent-4', mode: 'managed' })

  storage.applyExternalUpdate(makeExternalCommand({
    projectId, workItemId: workItem.workItemId, runId: run.runId, threadId: 'thread-4',
    expectedRevision: 1, serial: 40, instanceId: 'dispatcher-agent-4',
    payload: { summary: 'single flight' },
  }))

  let writeCalls = 0
  const dispatcher = createOutboxDispatcher({
    storage,
    fileSystem: {
      mkdir: async () => {},
      writeFile: async (_path, content) => { writeCalls += 1; await new Promise(resolve => setTimeout(resolve, 20)); return content },
    },
  })
  const [first, second] = await Promise.all([dispatcher.drain(), dispatcher.drain()])
  assert.deepEqual(first, second, 'both calls observe the same flight')
  assert.equal(writeCalls, 1)
  assert.equal(storage.listOutbox({ status: 'delivered' }).length, 1)
})
