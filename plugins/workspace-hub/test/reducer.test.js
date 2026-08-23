import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveContext } from '../src/client/reducer.ts'

const NOW = '2026-08-18T10:00:00.000Z'

test('初始：无会话 → unbound，revision 1，reason initial', () => {
  const s = resolveContext(undefined, {}, { mode: 'follow-session' }, 'initial', NOW)
  assert.equal(s.status, 'unbound')
  assert.equal(s.revision, 1)
  assert.equal(s.reason, 'initial')
  assert.equal(s.mode, 'follow-session')
  assert.deepEqual(s.mounts, [])
  assert.equal(s.primaryMountId, undefined)
})

test('follow-session：会话 cwd → ready，mount=session:{id}', () => {
  const s = resolveContext(undefined, { currentSessionId: 's1', sessionCwd: 'C:/work' }, { mode: 'follow-session' }, 'session-changed', NOW)
  assert.equal(s.status, 'ready')
  assert.equal(s.currentSessionId, 's1')
  assert.equal(s.primaryMountId, 'session:s1')
  assert.equal(s.mounts.length, 1)
  assert.equal(s.mounts[0].persistence, 'session')
  assert.equal(s.mounts[0].path, 'C:/work')
})

test('follow-session：原生工作区成员优先于 cwd', () => {
  const s = resolveContext(undefined, {
    currentSessionId: 's1',
    sessionCwd: 'C:/elsewhere',
    nativeWorkspace: { workspaceId: 'w9', title: '食溯App', path: 'F:/QClawData/workspace/meal_tracker' },
  }, { mode: 'follow-session' }, 'workspace-changed', NOW)
  assert.equal(s.status, 'ready')
  assert.equal(s.primaryMountId, 'native:w9')
  assert.equal(s.mounts[0].path, 'F:/QClawData/workspace/meal_tracker')
  assert.deepEqual(s.nativeWorkspace, { workspaceId: 'w9', title: '食溯App', primaryMountId: 'native:w9' })
})

test('follow-session：有会话但无路径 → missing', () => {
  const s = resolveContext(undefined, { currentSessionId: 's1' }, { mode: 'follow-session' }, 'session-changed', NOW)
  assert.equal(s.status, 'missing')
})

test('同语义输入返回原引用、revision 不递增；变化则 +1', () => {
  const first = resolveContext(undefined, { currentSessionId: 's1', sessionCwd: 'C:/a' }, { mode: 'follow-session' }, 'initial', NOW)
  const same = resolveContext(first, { currentSessionId: 's1', sessionCwd: 'C:/a' }, { mode: 'follow-session' }, 'workspace-changed', NOW)
  assert.equal(same, first)
  assert.equal(same.revision, 1)
  const changed = resolveContext(first, { currentSessionId: 's2', sessionCwd: 'C:/b' }, { mode: 'follow-session' }, 'session-changed', NOW)
  assert.notEqual(changed, first)
  assert.equal(changed.revision, 2)
})

test('follow-console：未选项目 → unbound；选了但根未知 → missing；根就绪 → ready', () => {
  const unbound = resolveContext(undefined, {}, { mode: 'follow-console' }, 'mode-changed', NOW)
  assert.equal(unbound.status, 'unbound')
  const missing = resolveContext(undefined, {}, { mode: 'follow-console', consoleProjectId: 'prj_1' }, 'console-project-changed', NOW)
  assert.equal(missing.status, 'missing')
  assert.equal(missing.resolvedProjectId, 'prj_1')
  assert.equal(missing.primaryMountId, 'project:prj_1')
  const ready = resolveContext(undefined, { consoleProjectRoot: 'F:/proj' }, { mode: 'follow-console', consoleProjectId: 'prj_1' }, 'console-project-changed', NOW)
  assert.equal(ready.status, 'ready')
  assert.equal(ready.mounts[0].projectId, 'prj_1')
  assert.equal(ready.mounts[0].path, 'F:/proj')
})

test('控制台切项目只改 consoleProjectId，不碰 session 轴', () => {
  const base = resolveContext(undefined, { currentSessionId: 's1', sessionCwd: 'C:/a' }, { mode: 'follow-session' }, 'initial', NOW)
  const r = resolveContext(base, { currentSessionId: 's1', sessionCwd: 'C:/a' }, { mode: 'follow-console', consoleProjectId: 'prj_2' }, 'console-project-changed', NOW)
  assert.equal(r.mode, 'follow-console')
  assert.equal(r.currentSessionId, 's1') // 会话轴保留
  assert.equal(r.consoleProjectId, 'prj_2')
  assert.equal(r.revision, 2)
})

test('pinned：固定后 Session 切换不改变主根', () => {
  const first = resolveContext(undefined, { currentSessionId: 's1', sessionCwd: 'C:/a' }, { mode: 'follow-session' }, 'initial', NOW)
  const pinned = resolveContext(first, { currentSessionId: 's1', sessionCwd: 'C:/a' }, { mode: 'pinned', pinMountId: 'session:s1' }, 'pinned', NOW)
  assert.equal(pinned.status, 'ready')
  assert.equal(pinned.primaryMountId, 'session:s1')
  const switched = resolveContext(pinned, { currentSessionId: 's2', sessionCwd: 'C:/b' }, { mode: 'pinned', pinMountId: 'session:s1' }, 'session-changed', NOW)
  assert.equal(switched.primaryMountId, 'session:s1') // 根不变
  assert.equal(switched.currentSessionId, 's2')
  assert.equal(switched.revision, 3)
})

test('pinned：未知/失效 pinMountId → missing（stale pin）', () => {
  const first = resolveContext(undefined, { currentSessionId: 's1', sessionCwd: 'C:/a' }, { mode: 'follow-session' }, 'initial', NOW)
  const stale = resolveContext(first, { currentSessionId: 's1', sessionCwd: 'C:/a' }, { mode: 'pinned', pinMountId: 'native:gone' }, 'pinned', NOW)
  assert.equal(stale.status, 'missing')
})

test('模式回切：pinned → follow-session 恢复会话根', () => {
  const first = resolveContext(undefined, { currentSessionId: 's1', sessionCwd: 'C:/a' }, { mode: 'follow-session' }, 'initial', NOW)
  const pinned = resolveContext(first, { currentSessionId: 's1', sessionCwd: 'C:/a' }, { mode: 'pinned', pinMountId: 'session:s1' }, 'pinned', NOW)
  const back = resolveContext(pinned, { currentSessionId: 's1', sessionCwd: 'C:/a' }, { mode: 'follow-session' }, 'mode-changed', NOW)
  assert.equal(back.mode, 'follow-session')
  assert.equal(back.primaryMountId, 'session:s1')
  assert.equal(back.reason, 'mode-changed')
})

test('capabilities 为只读文件能力（W0）', () => {
  const s = resolveContext(undefined, { currentSessionId: 's1', sessionCwd: 'C:/a' }, { mode: 'follow-session' }, 'initial', NOW)
  assert.deepEqual(s.capabilities, ['read-files'])
})

test('follow-session 项目匹配：resolvedProjectId 与 mount.path 使用匹配根', () => {
  const s = resolveContext(undefined, {
    currentSessionId: 's1',
    sessionCwd: 'F:/QClawData/workspace/meal_tracker/docs',
    projectRootMatch: { projectId: 'prj_meal', root: 'F:/QClawData/workspace/meal_tracker' },
  }, { mode: 'follow-session', consoleProjectId: undefined, pinMountId: undefined }, 'session-changed', NOW)
  assert.equal(s.status, 'ready')
  assert.equal(s.resolvedProjectId, 'prj_meal')
  assert.equal(s.mounts[0].path, 'F:/QClawData/workspace/meal_tracker')
})

test('revisionKey 对消费者隐藏语义但保持单调', () => {
  const s = resolveContext(undefined, { currentSessionId: 's1', sessionCwd: 'C:/a' }, { mode: 'follow-session' }, 'initial', NOW)
  assert.equal(typeof s.revisionKey, 'string')
  assert.ok(s.revisionKey.length > 0)
})
