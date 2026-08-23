import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { openProjectControlStorage, StorageValidationError } from '../src/host/index.js'

const migrationsDirectory = fileURLToPath(new URL('../migrations/', import.meta.url))

function serialSuffix(serial) {
  return serial.toString(16).padStart(4, '0')
}

async function openStorage(root) {
  return openProjectControlStorage({
    databasePath: join(root, 'project-control.sqlite3'),
    backupDirectory: join(root, 'backups'),
    migrationsDirectory,
    applicationVersion: '0.1.0-test',
    instanceId: 'console-commands-test-host',
  })
}

function makeRoot() {
  return mkdtempSync(join(tmpdir(), 'dsh-console-commands-'))
}

function cleanup(t, storage, root) {
  t.after(() => {
    storage.close()
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  })
}

function registerProject(storage, root, { projectId, serial }) {
  const suffix = serialSuffix(serial)
  const command = {
    protocolVersion: 'project-control.dsh/v1alpha1',
    schemaVersion: 'lifecycle-command-envelope/v1alpha1',
    commandId: `cmd_0198f4b2-7c3a-7d92-a5c6-6b6f39e3${suffix}`,
    correlationId: `corr.console.${serial}`,
    idempotencyKey: `console.register.${serial}`,
    kind: 'project.registerLegacy',
    occurredAt: '2026-08-15T12:00:00.000Z',
    actor: { kind: 'human', id: 'desktop-user', applicationId: 'deepseek-harness-personal' },
    target: { aggregateType: 'project', projectId },
    expectedRevision: 0,
    provenance: { sourceType: 'human', sourceId: 'console-commands-test' },
    payload: {
      locationRef: `loc_0198f4b2-7c3a-7d92-a5c6-6b6f39e4${suffix}`,
      sourceRootRef: `srt_0198f4b2-7c3a-7d92-a5c6-6b6f39e5${suffix}`,
      name: 'Console Project',
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

function fixture(t) {
  const root = makeRoot()
  mkdirSync(join(root, 'Project-1'), { recursive: true })
  return { root }
}

async function setup(t) {
  const { root } = fixture(t)
  const storage = await openStorage(root)
  cleanup(t, storage, root)
  const projectId = 'prj_0198f4b2-7c3a-7d92-a5c6-6b6f39e9a0a1'
  registerProject(storage, root, { projectId, serial: 1 })
  return { storage, root, projectId }
}

test('work item status transitions enforce the map and revisions', async t => {
  const { storage, projectId } = await setup(t)
  const workItem = storage.createWorkItem(projectId, { title: 'Ship the console', acceptance: ['tabs work'] })
  assert.equal(workItem.executionStatus, 'draft')
  assert.equal(workItem.revision, 1)

  const ready = storage.setWorkItemStatus(projectId, workItem.workItemId, { expectedRevision: 1, status: 'ready' })
  assert.equal(ready.executionStatus, 'ready')
  assert.equal(ready.revision, 2)

  const running = storage.setWorkItemStatus(projectId, workItem.workItemId, { expectedRevision: 2, status: 'running' })
  assert.equal(running.executionStatus, 'running')

  const paused = storage.setWorkItemStatus(projectId, workItem.workItemId, { expectedRevision: 3, status: 'paused' })
  assert.equal(paused.executionStatus, 'paused')

  const resumed = storage.setWorkItemStatus(projectId, workItem.workItemId, { expectedRevision: 4, status: 'ready' })
  assert.equal(resumed.executionStatus, 'ready')

  assert.throws(
    () => storage.setWorkItemStatus(projectId, workItem.workItemId, { expectedRevision: 5, status: 'completed' }),
    (error) => error instanceof StorageValidationError && error.details?.reason === 'transition_not_allowed',
  )
  assert.throws(
    () => storage.setWorkItemStatus(projectId, workItem.workItemId, { expectedRevision: 4, status: 'ready' }),
    (error) => error instanceof StorageValidationError && error.details?.reason === 'revision_conflict',
  )

  const events = storage.listEvents({ projectId }).filter(event => event.eventType === 'workitem.status_changed')
  assert.equal(events.length, 4)
  assert.deepEqual(events.map(event => event.data.to), ['ready', 'running', 'paused', 'ready'])
  assert.equal(events[0].schemaVersion, 'console-event/v1alpha1')
  assert.equal(storage.getCommandReceipt(events[0].commandId).status, 'accepted')
})

test('starting a run moves it to running and marks the work item', async t => {
  const { storage, projectId } = await setup(t)
  const workItem = storage.createWorkItem(projectId, { title: 'Runnable item' })
  const run = storage.createRun(projectId, workItem.workItemId)
  assert.equal(run.status, 'queued')

  const started = storage.startRun(projectId, run.runId, { expectedRevision: 1 })
  assert.equal(started.status, 'running')
  assert.equal(started.revision, 2)
  assert.equal(typeof started.startedAt, 'string')
  assert.equal(storage.getWorkItem(workItem.workItemId).executionStatus, 'running')

  assert.throws(
    () => storage.startRun(projectId, run.runId, { expectedRevision: 2 }),
    (error) => error instanceof StorageValidationError && error.details?.reason === 'transition_not_allowed',
  )
  assert.throws(
    () => storage.startRun(projectId, run.runId, { expectedRevision: 1 }),
    (error) => error instanceof StorageValidationError && error.details?.reason === 'revision_conflict',
  )
  const runEvents = storage.listEvents({ projectId }).filter(event => event.aggregateType === 'run')
  assert.deepEqual(runEvents.map(event => event.eventType), ['run.created', 'run.started'])
})

test('review request, comments and decisions move work item review state', async t => {
  const { storage, projectId } = await setup(t)
  const workItem = storage.createWorkItem(projectId, { title: 'Review me', acceptance: ['clean'] })

  const review = storage.requestReview(projectId, workItem.workItemId, { expectedRevision: 1, risk: 'medium' })
  assert.equal(review.status, 'requested')
  assert.equal(review.risk, 'medium')
  assert.equal(review.reviewedWorkItemRevision, 2)
  assert.equal(review.requestedBy.kind, 'human')
  assert.equal(storage.getWorkItem(workItem.workItemId).reviewStatus, 'pending')

  assert.throws(
    () => storage.requestReview(projectId, workItem.workItemId, { expectedRevision: 2 }),
    (error) => error instanceof StorageValidationError && error.details?.reason === 'review_state_conflict',
  )

  const comment = storage.commentReview(projectId, review.reviewId, { comment: '检查一下边界条件。' })
  assert.equal(comment.action, 'comment')
  assert.equal(comment.comment, '检查一下边界条件。')
  assert.equal(storage.listReviewActions(review.reviewId).length, 1)

  const decided = storage.decideReview(projectId, review.reviewId, {
    expectedRevision: 1,
    decision: 'approve',
    rationale: '验收点全部满足。',
  })
  assert.equal(decided.status, 'approved')
  assert.equal(decided.decidedBy.kind, 'human')
  assert.equal(typeof decided.decidedAt, 'string')
  assert.equal(storage.getWorkItem(workItem.workItemId).reviewStatus, 'approved')
  const actions = storage.listReviewActions(review.reviewId)
  assert.deepEqual(actions.map(action => action.action), ['comment', 'approve'])

  assert.throws(
    () => storage.decideReview(projectId, review.reviewId, { expectedRevision: 2, decision: 'reject' }),
    (error) => error instanceof StorageValidationError && error.details?.reason === 'review_not_open',
  )
  const reviewEvents = storage.listEvents({ projectId }).filter(event => event.eventType.startsWith('review.'))
  assert.deepEqual(reviewEvents.map(event => event.eventType), ['review.requested', 'review.approved'])
})

test('request_changes keeps the review open and records the action', async t => {
  const { storage, projectId } = await setup(t)
  const workItem = storage.createWorkItem(projectId, { title: 'Needs changes' })
  const review = storage.requestReview(projectId, workItem.workItemId, { expectedRevision: 1 })

  const changed = storage.decideReview(projectId, review.reviewId, {
    expectedRevision: 1,
    decision: 'request_changes',
    rationale: '请补充失败恢复说明。',
  })
  assert.equal(changed.status, 'rejected', 'request_changes closes the review as rejected-with-feedback')
  assert.equal(changed.decidedBy.kind, 'human')
  assert.equal(storage.getWorkItem(workItem.workItemId).reviewStatus, 'changes_requested')
  const actions = storage.listReviewActions(review.reviewId)
  assert.deepEqual(actions.map(action => action.action), ['request_changes'])
  assert.equal(actions[0].comment, '请补充失败恢复说明。')

  // a changed work item can be re-reviewed after fixes
  const updated = storage.setWorkItemStatus(projectId, workItem.workItemId, { expectedRevision: 3, status: 'ready' })
  assert.equal(updated.reviewStatus, 'changes_requested')
  const reopened = storage.requestReview(projectId, workItem.workItemId, { expectedRevision: 4 })
  assert.equal(reopened.status, 'requested')
})
