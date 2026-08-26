import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer, request as httpRequest } from 'node:http'
import test from 'node:test'
import {
  createProjectControlRequestHandler,
  MAX_BODY_BYTES,
  PROJECT_CONTROL_API_PREFIX,
} from '../src/http.ts'
import { validateLifecycleCommand, validateLifecycleResult } from '../src/lifecycle-validator.ts'
import { createProjectControlApi } from '../src/client/projectControlApi.ts'

const lifecycleExamples = new URL('../../../protocol/project-control/v1alpha1/lifecycle/examples/', import.meta.url)

const readyService = {
  getStatus() {
    return { state: 'ready', schemaVersion: 1, writable: true, projectCount: 1 }
  },
  listProjects() {
    return {
      projects: [{
        projectId: 'prj_0198f4b2-7c3a-7d11-a5c6-6b6f39e34711',
        name: '真实项目',
        registrationMode: 'managed',
        lifecycle: 'active',
        updatedAt: '2026-08-14T12:00:00.000Z',
        databasePath: 'D:\\secret\\project-control.sqlite3',
      }],
      total: 1,
      databasePath: 'D:\\secret\\project-control.sqlite3',
    }
  },
}

test('serves only bounded status and project DTOs to the personal client', async t => {
  const origin = await serve(t, readyService)
  const status = await api(origin, '/status')
  assert.equal(status.response.status, 200)
  assert.equal(status.response.headers.get('cache-control'), 'no-store')
  assert.equal(status.response.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(status.payload.data.protocolVersion, 'project-control.dsh/v1alpha1')
  assert.deepEqual(status.payload.data.counts, { projects: 1 })
  assert.deepEqual(status.payload.data.capabilities, ['status.read', 'projects.read'])

  const projects = await api(origin, '/projects')
  assert.equal(projects.payload.data.total, 1)
  assert.equal(projects.payload.data.projects[0].name, '真实项目')
  assert.equal(projects.payload.data.projects[0].databasePath, undefined)
  assert.doesNotMatch(JSON.stringify(projects.payload), /secret|sqlite3/iu)
})

test('W1 Task D：/projects/workspace-index 一次返回紧凑索引并支持 ETag 条件请求', async t => {
  const indexedService = {
    ...readyService,
    listProjectWorkspaces() {
      return [
        { projectId: 'prj_0198f4b2-7c3a-7d11-a5c6-6b6f39e34711', root: 'F:\\QClawData\\workspace\\meal_tracker', updatedAt: '2026-08-18T00:00:00.000Z' },
        { projectId: 'prj_0198f4b2-7c3a-7d11-a5c6-6b6f39e34712', root: 'F:\\proj\\other', updatedAt: '2026-08-18T00:00:01.000Z' },
      ]
    },
  }
  const origin = await serve(t, indexedService)
  const first = await api(origin, '/projects/workspace-index')
  assert.equal(first.response.status, 200)
  assert.equal(first.payload.data.projects.length, 2)
  assert.equal(first.payload.data.projects[0].root, 'F:\\QClawData\\workspace\\meal_tracker')
  const etag = first.response.headers.get('etag')
  assert.ok(etag !== null && etag.startsWith('"wsidx-'))
  // 条件请求：etag 相同 → 304（无 body，直接 fetch 检查状态）
  const conditional = await fetch(origin + PROJECT_CONTROL_API_PREFIX + '/projects/workspace-index', {
    headers: { 'x-dsh-personal-client': '1', 'if-none-match': etag },
  })
  assert.equal(conditional.status, 304)
})

test('requires the fixed client header and owns route/method errors', async t => {
  const origin = await serve(t, readyService)
  const unauthorized = await fetch(`${origin}${PROJECT_CONTROL_API_PREFIX}/status`)
  assert.equal(unauthorized.status, 403)
  assert.equal((await unauthorized.json()).error.code, 'PROJECT_CONTROL_CLIENT_REQUIRED')

  const missing = await api(origin, '/missing')
  assert.equal(missing.response.status, 404)
  assert.equal(missing.payload.error.code, 'NOT_FOUND')

  const method = await api(origin, '/status', { method: 'POST' })
  assert.equal(method.response.status, 405)
  assert.equal(method.response.headers.get('allow'), 'GET')
  assert.equal(method.payload.error.code, 'METHOD_NOT_ALLOWED')
})

test('rejects bodies on read routes before they reach storage', async t => {
  let calls = 0
  const origin = await serve(t, {
    getStatus() {
      calls += 1
      return readyService.getStatus()
    },
    listProjects: readyService.listProjects,
  })
  const response = await rawRequest(origin, '/status', {
    'content-length': String(MAX_BODY_BYTES + 1),
  })
  assert.equal(response.status, 413)
  assert.equal(response.payload.error.code, 'BODY_TOO_LARGE')
  assert.equal(calls, 0)
})

test('does not expose storage paths, SQL, or stacks from internal failures', async t => {
  const origin = await serve(t, {
    getStatus: readyService.getStatus,
    listProjects() {
      throw new Error('SQLITE_CORRUPT at D:\\private\\project-control.sqlite3\nSELECT * FROM secrets')
    },
  })
  const result = await api(origin, '/projects')
  assert.equal(result.response.status, 500)
  assert.equal(result.payload.error.code, 'INTERNAL_ERROR')
  assert.equal(result.payload.error.message, '项目控制台服务请求失败。')
  assert.doesNotMatch(JSON.stringify(result.payload), /SQLITE|private|SELECT|stack/iu)
})

test('client adapter always sends the fixed same-origin header', async () => {
  let observed
  const api = createProjectControlApi(async (input, init) => {
    observed = { input, init }
    return new Response(JSON.stringify({
      ok: true,
      data: {
        apiVersion: 'project-control-host/v1alpha1',
        protocolVersion: 'project-control.dsh/v1alpha1',
        storage: { state: 'ready', schemaVersion: 1, writable: true },
        counts: { projects: 0 },
        capabilities: ['status.read', 'projects.read'],
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  const status = await api.getStatus()
  assert.equal(status.counts.projects, 0)
  assert.equal(observed.input, `${PROJECT_CONTROL_API_PREFIX}/status`)
  assert.equal(observed.init.method, 'GET')
  assert.equal(observed.init.credentials, 'same-origin')
  assert.equal(observed.init.headers['x-dsh-personal-client'], '1')
})

test('client candidate adapter sends view cursors and revision-bound bulk mutations', async () => {
  const candidate = intakeCandidate()
  const publicCandidate = {
    candidateId: candidate.candidateId,
    jobId: candidate.importJobId,
    revision: candidate.revision,
    rootPath: candidate.root.displayPath,
    suggestedName: candidate.suggestedName,
    evidenceLevel: 'high',
    evidence: [],
    status: candidate.status,
    detectedMode: candidate.detectedMode,
    ignored: false,
    documentCount: candidate.documents.length,
    issueCount: candidate.issues.length,
    documents: [],
    issues: [],
  }
  const observed = []
  const client = createProjectControlApi(async (input, init) => {
    observed.push({ input: String(input), init })
    const data = String(input).includes('/bulk-ignore')
      ? { candidates: [{ ...publicCandidate, status: 'ignored', ignored: true, revision: 2 }], total: 1 }
      : {
          candidates: [{ ...publicCandidate, status: 'imported', historyReason: 'superseded' }],
          total: 5,
          counts: { review: 5, ignored: 50, history: 65 },
          nextCursor: candidate.candidateId,
        }
    return new Response(JSON.stringify({ ok: true, data }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  })

  const page = await client.listCandidates({
    view: 'history',
    search: 'Alpha',
    limit: 25,
    afterCandidateId: candidate.candidateId,
  })
  assert.equal(page.total, 5)
  assert.deepEqual(page.counts, { review: 5, ignored: 50, history: 65 })
  assert.equal(page.nextCursor, candidate.candidateId)
  assert.equal(page.candidates[0].historyReason, 'superseded')
  assert.match(observed[0].input, /view=history/)
  assert.match(observed[0].input, /search=Alpha/)
  assert.match(observed[0].input, /limit=25/)
  assert.match(observed[0].input, new RegExp(`afterCandidateId=${candidate.candidateId}`))

  const changed = await client.setCandidatesIgnored([{
    candidateId: candidate.candidateId,
    expectedRevision: 1,
  }], true)
  assert.equal(changed[0].status, 'ignored')
  assert.deepEqual(JSON.parse(observed[1].init.body), {
    ignored: true,
    candidates: [{ candidateId: candidate.candidateId, expectedRevision: 1 }],
  })
})

test('uses the packaged v1alpha1 schema for all lifecycle commands and rejects raw paths', () => {
  for (const file of [
    'command-register-legacy.valid.json',
    'command-register-managed.valid.json',
    'command-create-template.valid.json',
    'command-rebind-location.valid.json',
    'command-upgrade-managed.valid.json',
  ]) {
    const result = validateLifecycleCommand(example(file))
    assert.equal(result.ok, true, file)
  }
  const invalid = validateLifecycleCommand(example('command-absolute-location.invalid.json'))
  assert.equal(invalid.ok, false)
  assert.equal(invalid.reason, 'schema_invalid')
  assert.ok(invalid.errors.some(error => error.instancePath === '/payload/locationRef'))

  for (const file of [
    'result-register-legacy.valid.json',
    'result-register-managed.valid.json',
    'result-create-template.valid.json',
    'result-rebind-location.valid.json',
    'result-upgrade-managed.valid.json',
    'result-create-capability-rejected.valid.json',
  ]) {
    assert.equal(validateLifecycleResult(example(file)).ok, true, file)
  }
  const invalidResult = validateLifecycleResult(example('result-create-uncommitted.invalid.json'))
  assert.equal(invalidResult.ok, false)
  assert.equal(invalidResult.reason, 'schema_invalid')
})

test('persists deterministic Gate 2B lifecycle rejections without resolving raw paths', async t => {
  const receipts = new Map()
  const rejectedCommands = []
  const lifecycle = {
    recordRejectedCommand(command, result) {
      rejectedCommands.push(command)
      const existing = receipts.get(command.commandId)
      if (existing !== undefined) return existing
      receipts.set(command.commandId, result)
      return result
    },
    registerProject() {
      assert.fail('registerProject must not run before the Gate 2C reference resolver exists')
    },
    rebindProject() {
      assert.fail('rebindProject must not run before the Gate 2C reference resolver exists')
    },
  }
  const origin = await serve(t, readyService, {
    lifecycle,
    now: () => '2026-08-14T12:30:00.000Z',
  })

  const registerCommand = example('command-register-legacy.valid.json')
  const first = await lifecycleApi(origin, registerCommand)
  const replay = await lifecycleApi(origin, registerCommand)
  assert.equal(first.response.status, 200)
  assert.equal(first.payload.data.status, 'rejected')
  assert.equal(first.payload.data.error.code, 'REFERENCE_UNRESOLVED')
  assert.deepEqual(replay.payload.data, first.payload.data)
  assert.equal(rejectedCommands.length, 2)
  assert.doesNotMatch(JSON.stringify(first.payload), /[A-Z]:\\|displayPath|normalizedPath/iu)

  const createCommand = example('command-create-template.valid.json')
  const create = await lifecycleApi(origin, createCommand)
  assert.equal(create.payload.data.status, 'rejected')
  assert.equal(create.payload.data.error.code, 'CAPABILITY_NOT_NEGOTIATED')
  assert.equal(create.payload.data.currentRevision, createCommand.expectedRevision)
  assert.deepEqual(create.payload.data.fileSync, {
    status: 'planned',
    planId: createCommand.payload.writePlan.planId,
    planHash: createCommand.payload.writePlan.planHash,
    manifestHash: createCommand.payload.writePlan.manifestHash,
  })
  assert.equal(validateLifecycleResult(create.payload.data).ok, true)

  const upgradeCommand = example('command-upgrade-managed.valid.json')
  const upgrade = await lifecycleApi(origin, upgradeCommand)
  assert.equal(upgrade.payload.data.status, 'rejected')
  assert.equal(upgrade.payload.data.error.code, 'CAPABILITY_NOT_NEGOTIATED')
  assert.equal(upgrade.payload.data.currentRevision, upgradeCommand.expectedRevision)
  assert.deepEqual(upgrade.payload.data.fileSync, {
    status: 'planned',
    planId: upgradeCommand.payload.writePlan.planId,
    planHash: upgradeCommand.payload.writePlan.planHash,
    manifestHash: upgradeCommand.payload.writePlan.manifestHash,
  })
  assert.equal(validateLifecycleResult(upgrade.payload.data).ok, true)
})

test('maps frozen lifecycle business errors to schema-valid public rejections', async t => {
  const command = example('command-rebind-location.valid.json')
  const cases = [
    ['IDEMPOTENCY_CONFLICT', undefined],
    ['REVISION_CONFLICT', 7],
    ['LOCATION_CONFLICT', 8],
  ]
  for (const [code, currentRevision] of cases) {
    const origin = await serve(t, readyService, {
      lifecycle: {
        recordRejectedCommand() { assert.fail('unexpected rejection persistence') },
        registerProject() { assert.fail('unexpected register') },
        rebindProject() {
          throw Object.assign(
            new Error(`SQLITE_CONSTRAINT at D:\\private\\project-control.sqlite3 for ${code}`),
            {
              code,
              details: currentRevision === undefined
                ? { sql: 'SELECT * FROM private' }
                : { currentRevision, normalizedPath: 'D:\\private' },
            },
          )
        },
      },
      referenceResolver: {
        resolveRegistration() { assert.fail('unexpected registration resolution') },
        resolveRebind() {
          return {
            newLocation: {
              locationId: command.payload.newLocationRef,
              displayPath: 'D:\\resolved',
              normalizedPath: 'D:\\resolved',
            },
          }
        },
      },
      now: () => '2026-08-14T12:30:00.000Z',
    })
    const result = await lifecycleApi(origin, command)
    assert.equal(result.response.status, 200)
    assert.equal(result.payload.data.status, 'rejected')
    assert.equal(result.payload.data.error.code, code)
    assert.equal(validateLifecycleResult(result.payload.data).ok, true)
    if (currentRevision === undefined) assert.equal(result.payload.data.currentRevision, undefined)
    else assert.equal(result.payload.data.currentRevision, currentRevision)
    assert.doesNotMatch(JSON.stringify(result.payload), /SQLITE|private|SELECT|normalizedPath|stack/iu)
  }
})

test('rechecks a signed receipt when candidate resolution loses a concurrent commit race', async t => {
  const command = example('command-register-legacy.valid.json')
  const replayed = {
    ...example('result-register-legacy.valid.json'),
    status: 'replayed',
  }
  let receiptLookups = 0
  let resolverCalls = 0
  const origin = await serve(t, readyService, {
    lifecycle: {
      replayCommandReceipt() {
        receiptLookups += 1
        return receiptLookups === 1 ? null : replayed
      },
      recordRejectedCommand() { assert.fail('the stale resolver error must not be persisted') },
      registerProject() { assert.fail('registration must not run without a trusted resolution') },
      rebindProject() { assert.fail('unexpected rebind') },
    },
    referenceResolver: {
      authorizeStoredReplay() { return true },
      resolveRegistration() {
        resolverCalls += 1
        throw Object.assign(new Error('candidate advanced concurrently'), {
          code: 'REVISION_CONFLICT',
          details: { currentRevision: 2 },
        })
      },
      resolveRebind() { assert.fail('unexpected rebind resolution') },
    },
  })
  const result = await lifecycleApi(origin, command)
  assert.equal(result.response.status, 200)
  assert.equal(result.payload.data.status, 'replayed')
  assert.equal(result.payload.data.commandId, command.commandId)
  assert.equal(receiptLookups, 2)
  assert.equal(resolverCalls, 1)
})

test('rejects invalid lifecycle JSON before storage and advertises exact methods', async t => {
  let calls = 0
  const origin = await serve(t, readyService, {
    lifecycle: {
      recordRejectedCommand() { calls += 1 },
      registerProject() { calls += 1 },
      rebindProject() { calls += 1 },
    },
  })
  const invalid = await lifecycleApi(origin, example('command-absolute-location.invalid.json'))
  assert.equal(invalid.response.status, 400)
  assert.equal(invalid.payload.error.code, 'SCHEMA_INVALID')
  assert.equal(calls, 0)

  const method = await api(origin, '/lifecycle')
  assert.equal(method.response.status, 405)
  assert.equal(method.response.headers.get('allow'), 'POST')
})

test('never exposes a lifecycle result that violates kind-specific schema conditions', async t => {
  const origin = await serve(t, readyService, {
    lifecycle: {
      recordRejectedCommand() {
        return example('result-create-uncommitted.invalid.json')
      },
      registerProject() { assert.fail('unexpected register') },
      rebindProject() { assert.fail('unexpected rebind') },
    },
  })
  const result = await lifecycleApi(origin, example('command-create-template.valid.json'))
  assert.equal(result.response.status, 500)
  assert.equal(result.payload.error.code, 'INTERNAL_ERROR')
  assert.equal(result.payload.error.message, '项目控制台服务请求失败。')
  assert.doesNotMatch(JSON.stringify(result.payload), /schema|fileSync|planned|stack/iu)
})

test('accepts only native-authorized bounded scans and returns a narrow candidate DTO', async t => {
  const calls = []
  const candidate = intakeCandidate()
  const intake = {
    scan(input) {
      calls.push(input)
      return {
        sourceRoot: {
          sourceRootId: 'src_0198f4b2-7c3a-7d11-a5c6-6b6f39e34710',
          kind: 'single_project',
          displayPath: 'D:\\Projects\\Alpha',
          normalizedPath: 'd:\\projects\\alpha',
          revision: 1,
          updatedAt: '2026-08-15T00:00:00.000Z',
        },
        job: {
          importJobId: candidate.importJobId,
          sourceRootId: 'src_0198f4b2-7c3a-7d11-a5c6-6b6f39e34710',
          mode: 'single_project',
          status: 'completed',
          scannerVersion: 'gate2c-test/1',
          startedAt: '2026-08-15T00:00:00.000Z',
          completedAt: '2026-08-15T00:00:01.000Z',
          summary: { candidateCount: 1 },
          issues: [{
            importJobIssueId: 'jis_0198f4b2-7c3a-7d11-a5c6-6b6f39e34718',
            importJobId: candidate.importJobId,
            code: 'SCAN_LIMIT_REACHED',
            severity: 'warning',
            message: '扫描达到安全上限，结果可能不完整。',
            details: { limit: 'maxEntries' },
            status: 'open',
            resolvedAt: null,
          }],
          databasePath: 'D:\\private\\project-control.sqlite3',
        },
        candidates: [candidate],
      }
    },
    listSourceRoots() { return [] },
    listCandidates() { return [candidate] },
    getCandidate() { return candidate },
    setCandidateIgnored() { return { ...candidate, status: 'ignored', revision: 2 } },
    prepareCandidate() { return example('command-register-legacy.valid.json') },
  }
  const origin = await serve(t, readyService, { intake })
  const selection = {
    path: 'D:\\Projects\\Alpha',
    authorization: {
      version: 1,
      kind: 'project-root',
      expiresAt: '2026-08-15T00:05:00.000Z',
      nonce: '0198f4b2-7c3a-7d11-a5c6-6b6f39e34719',
      signature: 'A'.repeat(43),
    },
  }
  const scan = await api(origin, '/intake/scan', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'project-root', selection }),
  })
  assert.equal(scan.response.status, 200)
  assert.equal(scan.payload.data.candidates[0].suggestedName, 'Alpha')
  assert.equal(scan.payload.data.candidates[0].documentCount, 1)
  assert.equal(scan.payload.data.candidates[0].issueCount, 1)
  assert.deepEqual(scan.payload.data.candidates[0].documents, [])
  assert.deepEqual(scan.payload.data.candidates[0].issues, [])
  assert.equal(scan.payload.data.sourceRoot.path, 'D:\\Projects\\Alpha')
  assert.equal(scan.payload.data.sourceRoot.normalizedPath, undefined)
  assert.equal(scan.payload.data.job.databasePath, undefined)
  assert.equal(scan.payload.data.issues[0].code, 'SCAN_LIMIT_REACHED')
  assert.equal(scan.payload.data.issues[0].message, '扫描达到安全上限，结果可能不完整。')
  assert.equal(calls.length, 1)

  const invalid = await api(origin, '/intake/scan', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'source-root', selection }),
  })
  assert.equal(invalid.response.status, 400)
  assert.equal(invalid.payload.error.code, 'INVALID_BODY')
  assert.equal(calls.length, 1)

  const excessiveDepth = await api(origin, '/intake/scan', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'project-root', selection, maxDepth: 4 }),
  })
  assert.equal(excessiveDepth.response.status, 400)
  assert.equal(excessiveDepth.payload.error.code, 'INVALID_BODY')
  assert.equal(calls.length, 1)
})

test('lists, ignores, and prepares candidates while preserving revision and lifecycle contracts', async t => {
  const candidate = intakeCandidate()
  const intake = {
    scan() { assert.fail('unexpected scan') },
    listSourceRoots() { return [] },
    listCandidates(filter) {
      assert.deepEqual(filter, { jobId: candidate.importJobId })
      return [candidate]
    },
    getCandidate(candidateId) {
      assert.equal(candidateId, candidate.candidateId)
      return candidate
    },
    setCandidateIgnored(candidateId, input) {
      assert.equal(candidateId, candidate.candidateId)
      assert.deepEqual(input, { ignored: true, expectedRevision: 1 })
      return { ...candidate, status: 'ignored', revision: 2 }
    },
    prepareCandidate(candidateId, input) {
      assert.equal(candidateId, candidate.candidateId)
      assert.equal(input.registrationMode, 'linked_legacy')
      assert.equal(input.documentBindings[0].contentHash, `sha256:${'a'.repeat(64)}`)
      return example('command-register-legacy.valid.json')
    },
  }
  const origin = await serve(t, readyService, { intake })

  const list = await api(origin, `/intake/candidates?jobId=${candidate.importJobId}`)
  assert.equal(list.response.status, 200)
  assert.equal(list.payload.data.total, 1)
  const detail = await api(origin, `/intake/candidates/${candidate.candidateId}`)
  assert.equal(detail.payload.data.rootPath, 'D:\\Projects\\Alpha')

  const ignored = await api(origin, `/intake/candidates/${candidate.candidateId}/ignore`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ignored: true, expectedRevision: 1 }),
  })
  assert.equal(ignored.payload.data.status, 'ignored')
  assert.equal(ignored.payload.data.revision, 2)

  const prepared = await api(origin, `/intake/candidates/${candidate.candidateId}/prepare`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      registrationMode: 'linked_legacy',
      name: 'Alpha',
      expectedRevision: 1,
      documentBindings: [{
        role: 'readme',
        relativePath: 'README.md',
        contentHash: `sha256:${'a'.repeat(64)}`,
      }],
    }),
  })
  assert.equal(prepared.response.status, 200)
  assert.equal(prepared.payload.data.command.kind, 'project.registerLegacy')
  assert.equal(validateLifecycleCommand(prepared.payload.data.command).ok, true)

  const traversal = await api(origin, `/intake/candidates/${candidate.candidateId}/prepare`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      registrationMode: 'linked_legacy',
      name: 'Alpha',
      expectedRevision: 1,
      documentBindings: [{
        role: 'readme',
        relativePath: '../README.md',
        contentHash: `sha256:${'a'.repeat(64)}`,
      }],
    }),
  })
  assert.equal(traversal.response.status, 400)
  assert.equal(traversal.payload.error.code, 'INVALID_BODY')
})

test('candidate center forwards view filters before pagination and applies bounded bulk mutations', async t => {
  const candidate = intakeCandidate()
  const calls = []
  const intake = {
    scan() { assert.fail('unexpected scan') },
    listSourceRoots() { return [] },
    listCandidates(filter) {
      calls.push({ kind: 'list', filter })
      return {
        candidates: [candidate],
        total: 5,
        counts: { review: 5, ignored: 50, history: 65 },
        nextCursor: candidate.candidateId,
      }
    },
    getCandidate() { return candidate },
    setCandidateIgnored() { assert.fail('unexpected single ignore') },
    setCandidatesIgnored(input) {
      calls.push({ kind: 'bulk', input })
      return [{ ...candidate, status: 'ignored', revision: 2 }]
    },
    prepareCandidate() { assert.fail('unexpected prepare') },
  }
  const origin = await serve(t, readyService, { intake })
  const list = await api(origin,
    `/intake/candidates?view=review&search=Alpha&limit=25&afterCandidateId=${candidate.candidateId}`)
  assert.equal(list.response.status, 200)
  assert.equal(list.payload.data.total, 5)
  assert.deepEqual(list.payload.data.counts, { review: 5, ignored: 50, history: 65 })
  assert.equal(list.payload.data.nextCursor, candidate.candidateId)
  assert.deepEqual(calls[0], {
    kind: 'list',
    filter: {
      view: 'review',
      search: 'Alpha',
      limit: 25,
      afterCandidateId: candidate.candidateId,
    },
  })

  const bulk = await api(origin, '/intake/candidates/bulk-ignore', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ignored: true,
      candidates: [{ candidateId: candidate.candidateId, expectedRevision: 1 }],
    }),
  })
  assert.equal(bulk.response.status, 200)
  assert.equal(bulk.payload.data.total, 1)
  assert.equal(bulk.payload.data.candidates[0].status, 'ignored')
  assert.deepEqual(calls[1], {
    kind: 'bulk',
    input: {
      ignored: true,
      candidates: [{ candidateId: candidate.candidateId, expectedRevision: 1 }],
    },
  })

  const duplicate = await api(origin, '/intake/candidates/bulk-ignore', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ignored: true,
      candidates: [
        { candidateId: candidate.candidateId, expectedRevision: 1 },
        { candidateId: candidate.candidateId, expectedRevision: 1 },
      ],
    }),
  })
  assert.equal(duplicate.response.status, 400)
  assert.equal(duplicate.payload.error.code, 'INVALID_BODY')
  assert.equal(calls.length, 2)
})

test('returns the full agreed 200-document candidate boundary', async t => {
  const candidate = intakeCandidate()
  candidate.documents = Array.from({ length: 200 }, (_, index) => ({
    candidateDocumentId: `doc_0198f4b2-7c3a-7d11-a5c6-${index.toString(16).padStart(12, '0')}`,
    relativePath: `docs/${String(index)}.md`,
    suggestedRole: null,
    sha256: `sha256:${'d'.repeat(64)}`,
    title: null,
    preview: null,
    evidence: {},
  }))
  const intake = {
    scan() { assert.fail('unexpected scan') },
    listSourceRoots() { return [] },
    listCandidates() { return [candidate] },
    getCandidate() { return candidate },
    setCandidateIgnored() { assert.fail('unexpected ignore') },
    prepareCandidate() { assert.fail('unexpected prepare') },
  }
  const origin = await serve(t, readyService, { intake })
  const list = await api(origin, '/intake/candidates')
  assert.equal(list.response.status, 200)
  assert.equal(list.payload.data.candidates[0].documentCount, 200)
  assert.equal(list.payload.data.candidates[0].issueCount, 1)
  assert.deepEqual(list.payload.data.candidates[0].documents, [])
  assert.deepEqual(list.payload.data.candidates[0].issues, [])

  const detail = await api(origin, `/intake/candidates/${candidate.candidateId}`)
  assert.equal(detail.response.status, 200)
  assert.equal(detail.payload.data.documentCount, 200)
  assert.equal(detail.payload.data.documents.length, 200)
})

async function serve(t, service, options) {
  const server = createServer(createProjectControlRequestHandler(service, options))
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  t.after(() => new Promise(resolve => { server.close(resolve) }))
  const address = server.address()
  assert.equal(typeof address, 'object')
  return `http://127.0.0.1:${address.port}`
}

async function lifecycleApi(origin, command) {
  return api(origin, '/lifecycle', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(command),
  })
}

function example(file) {
  return JSON.parse(readFileSync(new URL(file, lifecycleExamples), 'utf8'))
}

function intakeCandidate() {
  return {
    candidateId: 'can_0198f4b2-7c3a-7d11-a5c6-6b6f39e34712',
    importJobId: 'job_0198f4b2-7c3a-7d11-a5c6-6b6f39e34713',
    sourceRootId: 'src_0198f4b2-7c3a-7d11-a5c6-6b6f39e34710',
    root: { displayPath: 'D:\\Projects\\Alpha', normalizedPath: 'd:\\projects\\alpha' },
    detectedMode: 'linked_legacy',
    manifestProjectId: null,
    suggestedName: 'Alpha',
    suggestedSummary: 'A real project.',
    summarySource: 'README.md',
    confidence: { level: 'high', nameSource: 'readme_h1' },
    status: 'discovered',
    revision: 1,
    documents: [{
      candidateDocumentId: 'doc_0198f4b2-7c3a-7d11-a5c6-6b6f39e34714',
      relativePath: 'README.md',
      suggestedRole: 'readme',
      sha256: `sha256:${'a'.repeat(64)}`,
      title: 'Alpha',
      preview: '# Alpha',
      evidence: { source: 'filename' },
    }],
    issues: [{
      importIssueId: 'iss_0198f4b2-7c3a-7d11-a5c6-6b6f39e34715',
      code: 'REVIEW_REQUIRED',
      severity: 'info',
      status: 'open',
      details: { reason: 'human_confirmation' },
    }],
  }
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

async function rawRequest(origin, resource, headers) {
  const target = new URL(`${origin}${PROJECT_CONTROL_API_PREFIX}${resource}`)
  return new Promise((resolve, reject) => {
    const request = httpRequest(target, {
      method: 'GET',
      headers: {
        'x-dsh-personal-client': '1',
        connection: 'close',
        ...headers,
      },
    }, response => {
      const chunks = []
      response.on('data', chunk => { chunks.push(chunk) })
      response.once('end', () => {
        resolve({
          status: response.statusCode,
          payload: JSON.parse(Buffer.concat(chunks).toString('utf8')),
        })
      })
    })
    request.once('error', reject)
    request.end()
  })
}
