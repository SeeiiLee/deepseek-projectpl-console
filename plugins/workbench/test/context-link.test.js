import assert from 'node:assert/strict'
import test from 'node:test'

import { WorkbenchController } from '../src/client/service.ts'
import { installContextLink, projectContext } from '../src/client/contextLink.ts'

function hubFixture(initial) {
  let snapshot = initial
  const listeners = new Set()
  const commands = []
  return {
    hub: {
      getSnapshot: () => snapshot,
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
      setMode: async (mode) => { commands.push(['setMode', mode]) },
      pinMount: async (mountId) => { commands.push(['pinMount', mountId]) },
      clearPin: async () => { commands.push(['clearPin']) },
      setConsoleProject: (projectId) => { commands.push(['setConsoleProject', projectId]) },
    },
    listeners,
    commands,
    emit(next) { snapshot = { ...snapshot, ...next }; for (const listener of [...listeners]) listener() },
  }
}

function controllerFixture() {
  const data = new Map()
  const shell = {
    openWorkbench() {}, closeWorkbench() {}, toggleWorkbench() {},
    toggleWorkbenchFullscreen() {}, focusConversation() {}, resetLayout() {},
  }
  const storage = {
    getItem(key) { return data.get(key) ?? null },
    setItem(key, value) { data.set(key, value) },
    removeItem(key) { data.delete(key) },
  }
  return new WorkbenchController(shell, storage)
}

const SESSION_SNAPSHOT = {
  mode: 'follow-session',
  status: 'ready',
  resolvedProjectId: undefined,
  consoleProjectId: undefined,
  primaryMountId: 'native:w9',
  mounts: [{ mountId: 'native:w9', label: '食溯App', path: 'F:/QClawData/workspace/meal_tracker' }],
}

test('projectContext 投影 hub 快照为 workbench 结构面', () => {
  const projection = projectContext(SESSION_SNAPSHOT)
  assert.equal(projection.mode, 'follow-session')
  assert.equal(projection.status, 'ready')
  assert.equal(projection.primaryMountId, 'native:w9')
  assert.equal(projection.primaryLabel, '食溯App')
  assert.equal(projection.primaryPath, 'F:/QClawData/workspace/meal_tracker')
  assert.equal(projection.projectId, undefined)
})

test('projectContext 携带控制台项目轴', () => {
  const projection = projectContext({
    mode: 'follow-console',
    status: 'ready',
    resolvedProjectId: 'prj_1',
    consoleProjectId: 'prj_1',
    primaryMountId: 'project:prj_1',
    mounts: [{ mountId: 'project:prj_1', label: 'prj_1', path: 'F:/proj' }],
  })
  assert.equal(projection.projectId, 'prj_1')
  assert.equal(projection.consoleProjectId, 'prj_1')
})

test('installContextLink 注入命令并立即投影一次', () => {
  const { hub, listeners, commands } = hubFixture(SESSION_SNAPSHOT)
  const controller = controllerFixture()
  const dispose = installContextLink(hub, controller)
  assert.equal(listeners.size, 1)
  const snapshot = controller.getSnapshot()
  assert.equal(snapshot.context?.mode, 'follow-session')
  assert.equal(snapshot.context?.primaryLabel, '食溯App')
  // 注入命令存在
  controller.setProjectWorkspace('prj_x', 'F:/x')
  assert.deepEqual(commands, [['setConsoleProject', 'prj_x'], ['setMode', 'follow-console']])
  dispose()
})

test('hub 事件触发重新投影', () => {
  const { hub, emit } = hubFixture(SESSION_SNAPSHOT)
  const controller = controllerFixture()
  installContextLink(hub, controller)
  emit({ mode: 'follow-console', status: 'ready', resolvedProjectId: 'prj_2', consoleProjectId: 'prj_2', primaryMountId: 'project:prj_2', mounts: [{ mountId: 'project:prj_2', label: 'prj_2', path: 'F:/two' }] })
  const snapshot = controller.getSnapshot()
  assert.equal(snapshot.context?.mode, 'follow-console')
  assert.equal(snapshot.context?.projectId, 'prj_2')
  // projectWorkspace 兼容字段派生
  assert.deepEqual(snapshot.projectWorkspace, { projectId: 'prj_2', root: 'F:/two' })
})

test('hub 缺失（降级）：不注入命令、不投影', () => {
  const controller = controllerFixture()
  const dispose = installContextLink(undefined, controller)
  const snapshot = controller.getSnapshot()
  assert.equal(snapshot.context, undefined)
  // 旧路径仍可用
  controller.setProjectWorkspace('prj_old', 'F:/old')
  assert.deepEqual(controller.getSnapshot().projectWorkspace, { projectId: 'prj_old', root: 'F:/old' })
  controller.clearProjectWorkspace()
  assert.equal(controller.getSnapshot().projectWorkspace, undefined)
  dispose()
})

test('dispose 停止订阅并清空命令注入', () => {
  const { hub, listeners, emit, commands } = hubFixture(SESSION_SNAPSHOT)
  const controller = controllerFixture()
  const dispose = installContextLink(hub, controller)
  dispose()
  assert.equal(listeners.size, 0)
  controller.setProjectWorkspace('prj_y', 'F:/y')
  // 命令已清空 → 回退旧绑定
  assert.deepEqual(controller.getSnapshot().projectWorkspace, { projectId: 'prj_y', root: 'F:/y' })
  assert.deepEqual(commands, [])
  emit({ mode: 'pinned', status: 'ready', primaryMountId: 'native:w9', mounts: [] })
  assert.equal(controller.getSnapshot().context, undefined)
})

test('setWorkbenchMode / toggleWorkbenchPin 转译到 hub 命令', async () => {
  const { hub, emit, commands } = hubFixture(SESSION_SNAPSHOT)
  const controller = controllerFixture()
  installContextLink(hub, controller)
  controller.setWorkbenchMode('pinned')
  assert.deepEqual(commands, [['pinMount', 'native:w9'], ['setMode', 'pinned']])
  // hub 状态同步后（pinned 生效），再点击取消固定
  emit({ mode: 'pinned', status: 'ready', primaryMountId: 'native:w9', mounts: SESSION_SNAPSHOT.mounts })
  controller.toggleWorkbenchPin()
  assert.deepEqual(commands.slice(2), [['clearPin'], ['setMode', 'follow-session']])
  controller.setWorkbenchMode('follow-console')
  assert.deepEqual(commands.slice(4), [['setMode', 'follow-console']])
  controller.setWorkbenchMode('follow-session')
  assert.deepEqual(commands.slice(5), [['clearPin'], ['setMode', 'follow-session']])
})

test('Step D：打开 Tab 自动绑定当前浏览目标（hub 投影 projectId）', () => {
  const { hub } = hubFixture({
    mode: 'follow-console',
    status: 'ready',
    resolvedProjectId: 'prj_meal',
    consoleProjectId: 'prj_meal',
    primaryMountId: 'project:prj_meal',
    mounts: [{ mountId: 'project:prj_meal', label: '食溯App', path: 'F:/QClawData/workspace/meal_tracker' }],
  })
  const controller = controllerFixture()
  installContextLink(hub, controller)
  const tab = controller.open({ family: 'preview', resourceKey: 'workspace:README.md', title: 'README.md' })
  assert.equal(tab.workspaceProjectId, 'prj_meal')
  // 显式指定仍优先
  const explicit = controller.open({ family: 'preview', resourceKey: 'workspace:a.md', title: 'a.md', workspaceProjectId: 'prj_other' })
  assert.equal(explicit.workspaceProjectId, 'prj_other')
  // 无投影时不绑定
  const { hub: hub2 } = hubFixture(SESSION_SNAPSHOT)
  const c2 = controllerFixture()
  installContextLink(hub2, c2)
  const unbound = c2.open({ family: 'preview', resourceKey: 'workspace:b.md', title: 'b.md' })
  assert.equal(unbound.workspaceProjectId, undefined)
})

test('follow-session 无项目时 projectWorkspace 兼容字段为空（退回会话 API）', () => {
  const { hub } = hubFixture(SESSION_SNAPSHOT)
  const controller = controllerFixture()
  installContextLink(hub, controller)
  assert.equal(controller.getSnapshot().projectWorkspace, undefined)
})
