import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assessNativeRebindPreflight,
  createNativeWorkspaceHistoryBridge,
  projectNativeWorkspaceHistory,
} from '../src/client/nativeWorkspaceHistory.ts'
import { createProjectControlApi } from '../src/client/projectControlApi.ts'
import { PROJECT_CONTROL_API_PREFIX } from '../src/http.ts'

const continuity = {
  projectId: 'prj_0198f4b2-7c3a-7d92-a5c6-6b6f39e9a0a1',
  revision: 2,
  activeRoot: 'F:\\Projects\\deepseek-harness-personal\\workspace',
  locations: [
    {
      locationId: 'loc_new',
      root: 'F:\\Projects\\deepseek-harness-personal\\workspace',
      kind: 'primary',
      active: true,
      revision: 1,
      createdAt: '2026-08-28T00:00:00.000Z',
      updatedAt: '2026-08-28T00:00:00.000Z',
    },
    {
      locationId: 'loc_old',
      root: 'D:\\Deepseek Harness Personal',
      kind: 'primary',
      active: false,
      revision: 2,
      createdAt: '2026-08-14T00:00:00.000Z',
      updatedAt: '2026-08-28T00:00:00.000Z',
    },
  ],
}

function snapshot(overrides = {}) {
  return {
    workspaces: [
      {
        workspaceId: 'ws_old',
        title: 'Deepseek Harness Personal',
        path: 'D:\\Deepseek Harness Personal',
        sessionIds: [],
      },
    ],
    sessions: [
      {
        id: 'session-old-1',
        cwd: 'D:\\Deepseek Harness Personal',
        title: '旧会话一',
        updatedAt: '2026-08-27T10:00:00.000Z',
        blank: false,
      },
      {
        id: 'session-old-2',
        cwd: 'd:/deepseek harness personal/',
        title: '旧会话二',
        updatedAt: '2026-08-26T10:00:00.000Z',
        blank: false,
      },
      {
        id: 'session-blank',
        cwd: 'D:\\Deepseek Harness Personal',
        title: '空白',
        updatedAt: '2026-08-28T10:00:00.000Z',
        blank: true,
      },
      {
        id: 'session-unrelated',
        cwd: 'D:\\Deepseek Harness Personal Extra',
        title: '不属于该项目',
        updatedAt: '2026-08-28T11:00:00.000Z',
        blank: false,
      },
    ],
    archivedSessionIds: ['session-old-2'],
    ...overrides,
  }
}

test('path history projects non-blank exact-path sessions as immutable legacy history', () => {
  const projected = projectNativeWorkspaceHistory(continuity, snapshot())
  assert.equal(projected.activeNativeWorkspace, undefined)
  assert.equal(projected.legacyWorkspaces.length, 1)
  assert.deepEqual(projected.legacySessions.map(item => item.sessionId), [
    'session-old-1',
    'session-old-2',
  ])
  assert.equal(projected.legacySessions[0].nativeWorkspaceId, 'ws_old')
  assert.equal(projected.legacySessions[1].archived, true)
  assert.equal(projected.legacySessions.some(item => item.sessionId === 'session-blank'), false)
  assert.equal(projected.legacySessions.some(item => item.sessionId === 'session-unrelated'), false)
})

test('preflight warns before source history is stranded and blocks native target ambiguity', () => {
  const beforeRebind = {
    ...continuity,
    revision: 1,
    activeRoot: 'D:\\Deepseek Harness Personal',
    locations: [continuity.locations[1]],
  }
  const warning = assessNativeRebindPreflight(
    beforeRebind,
    snapshot(),
    'F:\\Projects\\deepseek-harness-personal\\workspace',
  )
  assert.equal(warning.status, 'warning')
  assert.equal(warning.code, 'NATIVE_HISTORY_WILL_REMAIN_AT_OLD_PATH')
  assert.equal(warning.sourceHistoryCount, 2)

  const blocked = assessNativeRebindPreflight(beforeRebind, snapshot({
    workspaces: [
      ...snapshot().workspaces,
      { workspaceId: 'ws_new_1', path: 'F:/Projects/deepseek-harness-personal/workspace', sessionIds: [] },
      { workspaceId: 'ws_new_2', path: 'f:\\projects\\deepseek-harness-personal\\workspace\\', sessionIds: [] },
    ],
  }), 'F:\\Projects\\deepseek-harness-personal\\workspace')
  assert.equal(blocked.status, 'blocked')
  assert.equal(blocked.code, 'TARGET_NATIVE_WORKSPACE_AMBIGUOUS')
})

test('canonical continuation reuses one native workspace and never rewrites the source session', async () => {
  let workspaceItems = []
  const calls = []
  const sessions = {
    list: {
      getSnapshot: () => ({
        ids: ['session-old-1'],
        byId: {
          'session-old-1': {
            id: 'session-old-1',
            cwd: 'D:\\Deepseek Harness Personal',
            title: '旧会话一',
            updatedAt: '2026-08-27T10:00:00.000Z',
            blank: false,
          },
        },
      }),
      subscribe: () => () => {},
    },
    open(id) { calls.push(['open', id]) },
  }
  const workspaces = {
    list: {
      getSnapshot: () => ({ items: workspaceItems, archivedSessionIds: [] }),
      subscribe: () => () => {},
    },
    async create({ path }) {
      calls.push(['create', path])
      const value = { workspaceId: 'ws_new', title: 'workspace', path, sessionIds: [] }
      workspaceItems = [value]
      return value
    },
    async connectWorkspace(workspaceId) {
      calls.push(['connect', workspaceId])
      return 'session-new'
    },
  }
  const bridge = createNativeWorkspaceHistoryBridge({ sessions, workspaces })
  const result = await bridge.continueInActiveWorkspace(
    'F:\\Projects\\deepseek-harness-personal\\workspace',
    { sessionId: 'session-old-1', expectedRoot: 'D:\\Deepseek Harness Personal' },
  )
  assert.equal(result.sessionId, 'session-new')
  assert.equal(result.workspaceId, 'ws_new')
  assert.equal(result.createdWorkspace, true)
  assert.deepEqual(calls, [
    ['create', 'F:\\Projects\\deepseek-harness-personal\\workspace'],
    ['connect', 'ws_new'],
    ['open', 'session-new'],
  ])
  assert.equal(sessions.list.getSnapshot().byId['session-old-1'].cwd, 'D:\\Deepseek Harness Personal')

  calls.length = 0
  const replay = await bridge.continueInActiveWorkspace(
    'f:/projects/deepseek-harness-personal/workspace/',
    { sessionId: 'session-old-1', expectedRoot: 'd:/deepseek harness personal/' },
  )
  assert.equal(replay.createdWorkspace, false)
  assert.deepEqual(calls, [['connect', 'ws_new'], ['open', 'session-new']])
})

test('continuation fails closed for unknown history or duplicate canonical workspace records', async () => {
  const sessions = {
    list: {
      getSnapshot: () => ({ ids: [], byId: {} }),
      subscribe: () => () => {},
    },
    open() {},
  }
  const duplicated = [
    { workspaceId: 'one', path: 'F:/canonical', sessionIds: [] },
    { workspaceId: 'two', path: 'f:\\canonical\\', sessionIds: [] },
  ]
  const workspaces = {
    list: {
      getSnapshot: () => ({ items: duplicated, archivedSessionIds: [] }),
      subscribe: () => () => {},
    },
    async create() { throw new Error('must not create') },
    async connectWorkspace() { throw new Error('must not connect') },
  }
  const bridge = createNativeWorkspaceHistoryBridge({ sessions, workspaces })
  await assert.rejects(
    bridge.continueInActiveWorkspace('F:\\canonical', { sessionId: 'missing', expectedRoot: 'D:\\old' }),
    error => error?.code === 'LEGACY_SESSION_NOT_FOUND',
  )

  sessions.list.getSnapshot = () => ({
    ids: ['legacy'],
    byId: { legacy: { id: 'legacy', cwd: 'D:\\old', blank: false } },
  })
  await assert.rejects(
    bridge.continueInActiveWorkspace('F:\\canonical', { sessionId: 'legacy', expectedRoot: 'D:\\old' }),
    error => error?.code === 'TARGET_NATIVE_WORKSPACE_AMBIGUOUS',
  )
})

test('client continuity API uses the bounded read route and rejects ambiguous active history', async () => {
  const requests = []
  const api = createProjectControlApi(async (input, init) => {
    requests.push({ input, init })
    return new Response(JSON.stringify({ ok: true, data: continuity }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  })
  const result = await api.getProjectWorkspaceContinuity(continuity.projectId)
  assert.equal(result.activeRoot, continuity.activeRoot)
  assert.equal(result.locations.length, 2)
  assert.equal(requests[0].input, `${PROJECT_CONTROL_API_PREFIX}/projects/${continuity.projectId}/workspace/continuity`)
  assert.equal(requests[0].init.method, 'GET')

  const ambiguous = createProjectControlApi(async () => new Response(JSON.stringify({
    ok: true,
    data: {
      ...continuity,
      locations: continuity.locations.map(location => ({ ...location, active: true })),
    },
  }), { status: 200, headers: { 'content-type': 'application/json' } }))
  await assert.rejects(
    ambiguous.getProjectWorkspaceContinuity(continuity.projectId),
    /活动工作区位置/,
  )
})
