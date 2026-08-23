import assert from 'node:assert/strict'
import test from 'node:test'

import {
  canonicalPath,
  installNativeWorkspaceAdapter,
  projectInputs,
  shadowDifference,
  withProjectMatch,
} from '../src/client/adapter.ts'

function observable(initial) {
  let value = initial
  const listeners = new Set()
  return {
    getSnapshot: () => value,
    set(next) { value = next; for (const l of [...listeners]) l() },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
  }
}

function harness({ current, cwd, items = [] } = {}) {
  const sessions = observable({ current, byId: current === undefined ? {} : { [current]: { cwd } } })
  const workspaces = observable({ items })
  return { sessions, workspaces }
}

test('canonicalPath 归一化分隔符/大小写/尾分隔符', () => {
  assert.equal(canonicalPath('C:/Work/'), 'c:\\work')
  assert.equal(canonicalPath('c:\\work'), 'c:\\work')
  assert.equal(canonicalPath('  F:/a/b  '), 'f:\\a\\b')
})

test('projectInputs：原生工作区 title 优先于路径末段', () => {
  const h = harness({
    current: 's1',
    cwd: 'C:/elsewhere',
    items: [{ workspaceId: 'w1', title: '食溯App', path: 'F:/proj', sessionIds: ['s1'] }],
  })
  const inputs = projectInputs({ list: h.sessions }, { list: h.workspaces })
  assert.equal(inputs.nativeWorkspace?.title, '食溯App')
})

test('projectInputs：原生工作区成员优先于 cwd', () => {
  const h = harness({
    current: 's1',
    cwd: 'C:/elsewhere',
    items: [{ workspaceId: 'w1', path: 'F:/proj', sessionIds: ['s1'] }],
  })
  const inputs = projectInputs({ list: h.sessions }, { list: h.workspaces })
  assert.deepEqual(inputs.nativeWorkspace, { workspaceId: 'w1', title: 'proj', path: 'F:/proj' })
  assert.equal(inputs.sessionCwd, 'C:/elsewhere')
})

test('projectInputs：无会话 → 空输入', () => {
  const h = harness({})
  assert.deepEqual(projectInputs({ list: h.sessions }, { list: h.workspaces }), {})
})

test('适配器订阅：初始投影 + 切换 100 次无重复订阅/泄漏', () => {
  const h = harness({ current: 's1', cwd: 'C:/a' })
  const calls = []
  let inputsAt = []
  const dispose = installNativeWorkspaceAdapter({
    sessions: { list: h.sessions },
    workspaces: { list: h.workspaces },
    recompute: (inputs, reason) => { calls.push(reason); inputsAt = inputs },
    shadowEnabled: false,
  })
  assert.equal(calls[0], 'initial')
  assert.equal(inputsAt.currentSessionId, 's1')
  for (let n = 0; n < 100; n += 1) {
    h.sessions.set({ current: 's' + (n % 3), byId: { ['s' + (n % 3)]: { cwd: 'C:/w' + (n % 3) } } })
  }
  assert.equal(calls.length, 101)
  // 订阅者集合无膨胀：再次触发仍只有适配器在收
  const before = h.sessions.getSnapshot().current
  h.sessions.set({ current: 'x1', byId: { x1: { cwd: 'C:/x' } } })
  assert.equal(calls.length, 102)
  assert.equal(h.sessions.getSnapshot().current, 'x1')
  assert.equal(before, 's0')
  dispose()
  const countAfterDispose = calls.length
  h.sessions.set({ current: 'y1', byId: { y1: { cwd: 'C:/y' } } })
  assert.equal(calls.length, countAfterDispose) // dispose 后不再触发
})

test('适配器 reason 区分会话切换与工作区变化', () => {
  const h = harness({ current: 's1', cwd: 'C:/a' })
  const calls = []
  installNativeWorkspaceAdapter({
    sessions: { list: h.sessions },
    workspaces: { list: h.workspaces },
    recompute: (inputs, reason) => { calls.push(reason) },
    shadowEnabled: false,
  })
  h.sessions.set({ current: 's2', byId: { s2: { cwd: 'C:/b' } } })
  assert.equal(calls[1], 'session-changed')
  h.workspaces.set({ items: [{ workspaceId: 'w1', path: 'F:/p', sessionIds: ['s2'] }] })
  assert.equal(calls[2], 'workspace-changed')
})

test('影子对比：hub 根与旧绑定根一致无差异；不一致报差异', () => {
  const workbench = { getSnapshot: () => ({ projectWorkspace: { projectId: 'prj_1', root: 'F:/QClawData/workspace/meal_tracker' } }) }
  const same = shadowDifference(workbench, { currentSessionId: 's1', nativeWorkspace: { workspaceId: 'w1', title: 't', path: 'F:/QClawData/workspace/meal_tracker' } })
  assert.equal(same, undefined)
  const diff = shadowDifference(workbench, { currentSessionId: 's1', sessionCwd: 'C:/other' })
  assert.deepEqual(diff, { hubPath: 'C:/other', bindingRoot: 'F:/QClawData/workspace/meal_tracker', projectId: 'prj_1' })
})

test('W1 项目匹配：会话工作区命中项目根 → recompute 携带 projectRootMatch', async () => {
  const h = harness({ current: 's1', cwd: 'F:/QClawData/workspace/meal_tracker' })
  const received = []
  const index = {
    roots: () => [{ projectId: 'prj_meal', root: 'F:/QClawData/workspace/meal_tracker', updatedAt: 't' }],
    refresh: async () => {},
  }
  installNativeWorkspaceAdapter({
    sessions: { list: h.sessions },
    workspaces: { list: h.workspaces },
    recompute: (inputs) => { received.push(inputs) },
    projectIndex: index,
    shadowEnabled: false,
  })
  await new Promise(resolve => setImmediate(resolve))
  assert.ok(received.some(inputs => inputs.projectRootMatch?.projectId === 'prj_meal'))
  assert.equal(received[0].projectRootMatch.root, 'F:/QClawData/workspace/meal_tracker')
})

test('W1 项目匹配：无命中不携带 match', async () => {
  const h = harness({ current: 's1', cwd: 'C:/elsewhere' })
  const received = []
  installNativeWorkspaceAdapter({
    sessions: { list: h.sessions },
    workspaces: { list: h.workspaces },
    recompute: (inputs) => { received.push(inputs) },
    projectIndex: { roots: () => [{ projectId: 'prj_meal', root: 'F:/QClawData/workspace/meal_tracker', updatedAt: 't' }], refresh: async () => {} },
    shadowEnabled: false,
  })
  await new Promise(resolve => setImmediate(resolve))
  assert.ok(received.every(inputs => inputs.projectRootMatch === undefined))
})

test('withProjectMatch 纯函数：命中携带 match、未命中原样返回', () => {
  const roots = [{ projectId: 'prj_meal', root: 'F:/QClawData/workspace/meal_tracker', updatedAt: 't' }]
  const hit = withProjectMatch({ currentSessionId: 's1', sessionCwd: 'F:/QClawData/workspace/meal_tracker/docs' }, roots)
  assert.equal(hit.projectRootMatch?.projectId, 'prj_meal')
  const miss = withProjectMatch({ currentSessionId: 's1', sessionCwd: 'C:/other' }, roots)
  assert.equal(miss.projectRootMatch, undefined)
  assert.equal(withProjectMatch({}, roots).projectRootMatch, undefined)
})

test('影子差异只进回调不写状态（W0 不切换）', () => {
  const h = harness({ current: 's1', cwd: 'C:/a' })
  const diffs = []
  const states = []
  installNativeWorkspaceAdapter({
    sessions: { list: h.sessions },
    workspaces: { list: h.workspaces },
    recompute: (inputs) => { states.push(inputs) },
    workbench: { getSnapshot: () => ({ projectWorkspace: { projectId: 'p', root: 'F:/other' } }) },
    shadowEnabled: true,
    onShadowDifference: (diff) => { diffs.push(diff) },
  })
  assert.equal(diffs.length, 1)
  assert.equal(diffs[0].hubPath, 'C:/a')
  assert.equal(states.length, 1) // 状态只投影一次，差异不影响
})
