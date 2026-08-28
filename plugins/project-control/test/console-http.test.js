import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { openProjectControlStorage } from '../src/host/index.js'
import { storageConsoleAdapter, storageExternalAdapter } from '../src/index.ts'
import {
  createProjectControlRequestHandler,
  PROJECT_CONTROL_API_PREFIX,
} from '../src/http.ts'

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
    instanceId: 'console-http-test-host',
  })
}

function makeRoot() {
  return mkdtempSync(join(tmpdir(), 'dsh-console-http-'))
}

function cleanup(t, storage, root) {
  t.after(() => {
    storage.close()
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  })
}

const readyService = {
  getStatus() {
    return { state: 'ready', schemaVersion: 9, writable: true, projectCount: 1 }
  },
  listProjects() {
    return { projects: [], total: 0 }
  },
}

async function serve(t, options = {}, readService = readyService) {
  const server = createServer(createProjectControlRequestHandler(readService, options))
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  t.after(() => new Promise(resolve => { server.close(resolve) }))
  const address = server.address()
  assert.equal(typeof address, 'object')
  return `http://127.0.0.1:${address.port}`
}

test('serves bounded project workspace continuity without exposing normalized path internals', async t => {
  const projectId = 'prj_0198f4b2-7c3a-7d92-a5c6-6b6f39e9a0a1'
  const origin = await serve(t, {}, {
    ...readyService,
    getProjectWorkspaceContinuity(id) {
      assert.equal(id, projectId)
      return {
        projectId,
        revision: 2,
        activeRoot: 'F:\\Projects\\canonical\\workspace',
        locations: [
          {
            locationId: 'loc_active',
            root: 'F:\\Projects\\canonical\\workspace',
            kind: 'primary',
            active: true,
            revision: 1,
            createdAt: '2026-08-28T00:00:00.000Z',
            updatedAt: '2026-08-28T00:00:00.000Z',
          },
          {
            locationId: 'loc_legacy',
            root: 'D:\\Legacy',
            kind: 'primary',
            active: false,
            revision: 2,
            createdAt: '2026-08-20T00:00:00.000Z',
            updatedAt: '2026-08-28T00:00:00.000Z',
          },
        ],
      }
    },
  })
  const { response, payload } = await api(origin, `/projects/${projectId}/workspace/continuity`)
  assert.equal(response.status, 200)
  assert.equal(payload.ok, true)
  assert.equal(payload.data.activeRoot, 'F:\\Projects\\canonical\\workspace')
  assert.deepEqual(payload.data.locations.map(location => location.active), [true, false])
  assert.equal(JSON.stringify(payload).includes('normalizedPath'), false)
})

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

test('serves the P7 console commands end to end', async t => {
  const root = makeRoot()
  mkdirSync(join(root, 'Project-1'), { recursive: true })
  const storage = await openStorage(root)
  cleanup(t, storage, root)
  const suffix = serialSuffix(1)
  const projectId = 'prj_0198f4b2-7c3a-7d92-a5c6-6b6f39e9a0a1'
  storage.registerProject({
    protocolVersion: 'project-control.dsh/v1alpha1',
    schemaVersion: 'lifecycle-command-envelope/v1alpha1',
    commandId: `cmd_0198f4b2-7c3a-7d92-a5c6-6b6f39e3${suffix}`,
    correlationId: 'corr.console-http.1',
    idempotencyKey: 'console-http.register.1',
    kind: 'project.registerLegacy',
    occurredAt: '2026-08-15T12:00:00.000Z',
    actor: { kind: 'human', id: 'desktop-user', applicationId: 'deepseek-harness-personal' },
    target: { aggregateType: 'project', projectId },
    expectedRevision: 0,
    provenance: { sourceType: 'human', sourceId: 'console-http-test' },
    payload: {
      locationRef: `loc_0198f4b2-7c3a-7d92-a5c6-6b6f39e4${suffix}`,
      sourceRootRef: `srt_0198f4b2-7c3a-7d92-a5c6-6b6f39e5${suffix}`,
      name: 'Console HTTP Project',
      documentBindings: [],
    },
  }, {
    location: {
      locationId: `loc_0198f4b2-7c3a-7d92-a5c6-6b6f39e4${suffix}`,
      kind: 'primary',
      displayPath: join(root, 'Project-1'),
      normalizedPath: join(root, 'project-1'),
      verifiedAt: '2026-08-15T12:00:00.000Z',
    },
    eventId: `evt_0198f4b2-7c3a-7d92-a5c6-6b6f39e6${suffix}`,
    outboxId: `out_0198f4b2-7c3a-7d92-a5c6-6b6f39e7${suffix}`,
  })
  const origin = await serve(t, {
    external: storageExternalAdapter(storage),
    console: storageConsoleAdapter(storage),
  })

  // create a work item
  const created = await postJson(origin, `/projects/${projectId}/work-items`, {
    title: 'Build the console',
    instruction: 'Ship the P7 pages.',
    acceptance: ['tabs work', 'commands work'],
    priority: 70,
  })
  assert.equal(created.response.status, 200)
  const workItem = created.payload.data
  assert.equal(workItem.executionStatus, 'draft')
  assert.equal(workItem.revision, 1)

  // transition it to ready and request a review
  const ready = await postJson(origin, `/projects/${projectId}/work-items/${workItem.workItemId}/status`, {
    expectedRevision: 1,
    status: 'ready',
  })
  assert.equal(ready.payload.data.executionStatus, 'ready')
  assert.equal(ready.payload.data.revision, 2)

  const review = await postJson(origin, `/projects/${projectId}/work-items/${workItem.workItemId}/review-request`, {
    expectedRevision: 2,
    risk: 'low',
  })
  assert.equal(review.response.status, 200)
  assert.equal(review.payload.data.status, 'requested')
  assert.equal(review.payload.data.risk, 'low')

  // comment then approve
  const comment = await postJson(origin, `/projects/${projectId}/reviews/${review.payload.data.reviewId}/comment`, {
    comment: '注意边界条件。',
  })
  assert.equal(comment.payload.data.action, 'comment')

  const decided = await postJson(origin, `/projects/${projectId}/reviews/${review.payload.data.reviewId}/decide`, {
    expectedRevision: 1,
    decision: 'approve',
    rationale: '验收点全部满足。',
  })
  assert.equal(decided.payload.data.status, 'approved')

  const actions = await api(origin, `/projects/${projectId}/reviews/${review.payload.data.reviewId}/actions`)
  assert.equal(actions.payload.data.total, 2)
  assert.deepEqual(actions.payload.data.actions.map(action => action.action), ['comment', 'approve'])

  // start the only run and verify projections reflect the command trail
  const run = storage.createRun(projectId, workItem.workItemId)
  const runs = await api(origin, `/projects/${projectId}/runs`)
  assert.equal(runs.payload.data.items[0].runId, run.runId)
  const runId = run.runId
  const started = await postJson(origin, `/projects/${projectId}/runs/${runId}/start`, { expectedRevision: 1 })
  assert.equal(started.payload.data.status, 'running')

  const workItems = await api(origin, `/projects/${projectId}/work-items`)
  assert.equal(workItems.payload.data.items[0].executionStatus, 'running')
  assert.equal(workItems.payload.data.items[0].reviewStatus, 'approved')

  const events = await api(origin, `/projects/${projectId}/events`)
  assert.deepEqual(
    events.payload.data.items.map(item => item.eventType),
    [
      'project.legacy.registered',
      'workitem.created',
      'workitem.status_changed',
      'review.requested',
      'review.approved',
      'run.created',
      'run.started',
    ],
  )
})

test('console routes enforce methods and service presence', async t => {
  const origin = await serve(t)

  const missing = await postJson(origin, '/projects/prj_0198f4b2-7c3a-7d92-a5c6-6b6f39e9a0a1/work-items', { title: 'x' })
  assert.equal(missing.response.status, 503)
  assert.equal(missing.payload.error.code, 'CONSOLE_UNAVAILABLE')

  const projection = await api(origin, '/projects/prj_0198f4b2-7c3a-7d92-a5c6-6b6f39e9a0a1/work-items')
  assert.equal(projection.response.status, 503)
  assert.equal(projection.payload.error.code, 'EXTERNAL_UNAVAILABLE')

  const method = await api(origin, '/projects/prj_0198f4b2-7c3a-7d92-a5c6-6b6f39e9a0a1/reviews/rev_0198f4b2-7c3a-7d92-a5c6-6b6f39e9a0a1/decide')
  assert.equal(method.response.status, 405)
  assert.equal(method.payload.error.code, 'METHOD_NOT_ALLOWED')

  const badBody = await postJson(origin, '/projects/prj_0198f4b2-7c3a-7d92-a5c6-6b6f39e9a0a1/work-items', {})
  assert.equal(badBody.response.status, 503, 'service absence wins before body validation')
})
