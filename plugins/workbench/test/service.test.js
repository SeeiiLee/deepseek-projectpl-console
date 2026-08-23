import assert from 'node:assert/strict'
import test from 'node:test'
import {
  FILES_DOCK_STORAGE_KEY,
  storageKey,
  WorkbenchController,
  WORKBENCH_STORAGE_VERSION,
} from '../src/client/service.ts'
import { WorkbenchViewerRegistry } from '../src/client/viewers.ts'

function fixture(seed = {}) {
  const data = new Map(Object.entries(seed))
  const calls = []
  const shell = {
    openWorkbench() { calls.push('open') },
    closeWorkbench() { calls.push('close') },
    toggleWorkbench() { calls.push('toggle') },
    toggleWorkbenchFullscreen() { calls.push('fullscreen') },
  }
  const storage = {
    getItem(key) { return data.get(key) ?? null },
    setItem(key, value) { data.set(key, value) },
    removeItem(key) { data.delete(key) },
  }
  return { controller: new WorkbenchController(shell, storage), calls, data }
}

test('files dock opens by default, toggles and persists its own storage record', () => {
  const { controller, data } = fixture()
  assert.equal(controller.getSnapshot().filesDockOpen, true)
  controller.toggleFilesDock()
  assert.equal(controller.getSnapshot().filesDockOpen, false)
  assert.equal(data.get(FILES_DOCK_STORAGE_KEY), '0')
  controller.toggleFilesDock()
  assert.equal(controller.getSnapshot().filesDockOpen, true)
  assert.equal(data.get(FILES_DOCK_STORAGE_KEY), '1')
})

test('restores a persisted collapsed files dock', () => {
  const { controller } = fixture({ [FILES_DOCK_STORAGE_KEY]: '0' })
  assert.equal(controller.getSnapshot().filesDockOpen, false)
})
test('toggleFullscreen delegates to the shell layout', () => {
  const { controller, calls } = fixture()
  controller.toggleFullscreen()
  assert.deepEqual(calls, ['fullscreen'])
})

test('starts with the two functional pinned tabs (Terminal + Details); file review opens from the dock', () => {
  const { controller } = fixture()
  assert.deepEqual(controller.getSnapshot().tabs.map(tab => tab.title), [
    'Details',
  ])
  assert.equal(controller.getSnapshot().activeTabId, 'workbench:details')
  assert.equal(controller.getSnapshot().tabs.some(tab => tab.family === 'file'), false)
  assert.equal(controller.getSnapshot().tabs.some(tab => tab.family === 'preview'), false)
})

test('activateTab can re-activate the pinned Details tab after another tab took focus', () => {
  const { controller } = fixture()
  const tab = controller.open({ family: 'preview', resourceKey: 'workspace:README.md', title: 'README.md' })
  assert.equal(controller.getSnapshot().activeTabId, tab.id)
  // 固定页签不在 descriptors 里（投影时合成）：activateTab 曾一度对它 no-op（详情按钮点不动）
  assert.equal(controller.activateTab('workbench:details'), true)
  assert.equal(controller.getSnapshot().activeTabId, 'workbench:details')
  assert.equal(controller.getSnapshot().tabs.find(item => item.id === 'workbench:details')?.active, true)
  // 再切回普通页签仍正常
  assert.equal(controller.activateTab(tab.id), true)
  assert.equal(controller.getSnapshot().activeTabId, tab.id)
})

test('open only creates or focuses a descriptor and reveals the shell', () => {
  const { controller, calls } = fixture()
  const first = controller.open({ family: 'preview', resourceKey: 'src/main.ts', title: 'main.ts' })
  const second = controller.open({ family: 'preview', resourceKey: 'src/main.ts', title: 'main.ts' })
  assert.equal(first.id, second.id)
  assert.equal(controller.getSnapshot().tabs.filter(tab => tab.id === first.id).length, 1)
  assert.equal(controller.getSnapshot().activeTabId, first.id)
  assert.deepEqual(calls, ['open', 'open'])
  controller.collapse()
  controller.toggle()
  assert.deepEqual(calls, ['open', 'open', 'close', 'toggle'])
})

test('global preview tabs stay visible and active across session switches (review survives)', () => {
  const { controller } = fixture()
  controller.setCurrentSession('s1')
  const tab = controller.open({ family: 'preview', resourceKey: 'workspace:README.md', title: 'README.md', workspaceProjectId: 'prj_meal' })
  const snapshot = controller.getSnapshot()
  assert.equal(snapshot.scope, 'session')
  assert.equal(snapshot.sessionId, 's1')
  assert.equal(snapshot.activeTabId, tab.id)
  assert.equal(snapshot.tabs.some(item => item.id === tab.id && item.family === 'preview'), true)
  // 切会话：全局审阅页签保持激活且仍可见
  controller.setCurrentSession('s2')
  const after = controller.getSnapshot()
  assert.equal(after.scope, 'session')
  assert.equal(after.sessionId, 's2')
  assert.equal(after.activeTabId, tab.id)
  assert.equal(after.tabs.some(item => item.id === tab.id), true)
})

test('merged list keeps session tabs per session and global tabs everywhere', () => {
  const { controller } = fixture()
  controller.setCurrentSession('s1')
  const preview = controller.open({ family: 'preview', resourceKey: 'workspace:a.md', title: 'a.md' })
  const terminal = controller.open({ family: 'terminal', scope: 'session', resourceKey: 'primary', title: 'PowerShell' })
  assert.equal(controller.getSnapshot().tabs.some(tab => tab.id === terminal.id), true)
  controller.setCurrentSession('s2')
  const after = controller.getSnapshot()
  assert.equal(after.tabs.some(tab => tab.id === terminal.id), false)
  assert.equal(after.tabs.some(tab => tab.id === preview.id), true)
})

test('activateTab, markDirty and closeTab operate across the merged list', () => {
  const { controller } = fixture()
  controller.setCurrentSession('s1')
  const preview = controller.open({ family: 'preview', resourceKey: 'workspace:b.md', title: 'b.md' })
  const terminal = controller.open({ family: 'terminal', scope: 'session', resourceKey: 'primary', title: 'PowerShell' })
  assert.equal(controller.activateTab(preview.id), true)
  assert.equal(controller.getSnapshot().activeTabId, preview.id)
  assert.equal(controller.activateTab(terminal.id), true)
  assert.equal(controller.markDirty(preview.id, true), true)
  assert.equal(controller.getSnapshot().tabs.find(tab => tab.id === preview.id)?.dirty, true)
  assert.deepEqual(controller.closeTab(terminal.id), { closed: true })
  assert.deepEqual(controller.closeTab(preview.id), { closed: false, reason: 'dirty' })
  assert.deepEqual(controller.closeTab(preview.id, { force: true }), { closed: true })
  assert.equal(controller.getSnapshot().activeTabId, 'workbench:details')
})

test('preview tabs survive boot rehydration when their viewer is registered first', () => {
  const registry = new WorkbenchViewerRegistry()
  registry.installDefaults()
  registry.register({
    id: 'workbench.workspace-preview',
    family: 'preview',
    title: '工作区预览',
    canRestore: descriptor => descriptor.family === 'preview'
      && descriptor.viewerId === 'workbench.workspace-preview'
      && typeof descriptor.resourceKey === 'string'
      && descriptor.resourceKey.startsWith('workspace:'),
  })
  const data = new Map([[storageKey('global'), JSON.stringify({
    version: WORKBENCH_STORAGE_VERSION,
    activeTabId: 'review-readme',
    tabs: [{
      id: 'review-readme',
      family: 'preview',
      viewerId: 'workbench.workspace-preview',
      title: 'README.md',
      resourceKey: 'workspace:README.md',
      workspaceProjectId: 'prj_meal',
    }],
  })]])
  const controller = new WorkbenchController({
    openWorkbench() {},
    closeWorkbench() {},
    toggleWorkbench() {},
    toggleWorkbenchFullscreen() {},
  }, {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value) },
    removeItem: key => { data.delete(key) },
  }, registry)
  const restored = controller.getSnapshot().tabs.find(tab => tab.id === 'review-readme')
  assert.ok(restored)
  assert.equal(restored.workspaceProjectId, 'prj_meal')
  assert.equal(controller.getSnapshot().activeTabId, 'review-readme')
  // 恢复后的存储仍保留该页签（未被当成未知查看器清洗）
  assert.equal(JSON.parse(data.get(storageKey('global'))).tabs[0].id, 'review-readme')
})

test('workspaceProjectId persists through the storage round-trip', () => {
  const { controller, data } = fixture()
  controller.open({ family: 'preview', resourceKey: 'workspace:README.md', title: 'README.md', workspaceProjectId: 'prj_meal' })
  const persisted = JSON.parse(data.get(storageKey('global')))
  assert.equal(persisted.tabs[0].workspaceProjectId, 'prj_meal')
  const restored = fixture({ [storageKey('global')]: data.get(storageKey('global')) })
  const tab = restored.controller.getSnapshot().tabs.find(item => item.family === 'preview')
  assert.equal(tab?.workspaceProjectId, 'prj_meal')
})

test('updateTab persists resourceKey/title and rejects missing tabs', () => {
  const { controller, data } = fixture()
  const tab = controller.open({
    family: 'browser',
    resourceKey: 'browser:https%3A%2F%2Fexample.com',
    title: 'example.com',
  })
  assert.equal(controller.updateTab(tab.id, {
    resourceKey: 'browser:https%3A%2F%2Fnew.example',
    title: 'new.example',
  }), true)
  const updated = controller.getSnapshot().tabs.find(item => item.id === tab.id)
  assert.equal(updated?.resourceKey, 'browser:https%3A%2F%2Fnew.example')
  assert.equal(updated?.title, 'new.example')
  assert.equal(controller.updateTab('missing', { title: 'x' }), false)
  const persisted = JSON.parse(data.get(storageKey('global')))
  assert.equal(persisted.tabs[0].resourceKey, 'browser:https%3A%2F%2Fnew.example')
})

test('protects dirty tabs and never permits closing pinned tool tabs', () => {
  const { controller } = fixture()
  const tab = controller.open({ family: 'file', resourceKey: 'README.md', title: 'README.md' })
  assert.equal(controller.markDirty(tab.id, true), true)
  assert.deepEqual(controller.closeTab(tab.id), { closed: false, reason: 'dirty' })
  assert.deepEqual(controller.closeTab(tab.id, { force: true }), { closed: true })
  assert.deepEqual(controller.closeTab('workbench:details'), { closed: false, reason: 'pinned' })
})

test('keeps global and session state in separate versioned storage records', () => {
  const { controller, data } = fixture()
  controller.open({ family: 'browser', resourceKey: 'https://example.invalid', title: 'Example' })
  controller.setCurrentSession('session/one')
  controller.open({ family: 'terminal', scope: 'session', resourceKey: 'primary', title: 'PowerShell' })
  const global = JSON.parse(data.get(storageKey('global')))
  const session = JSON.parse(data.get(storageKey('session', 'session/one')))
  assert.equal(global.version, WORKBENCH_STORAGE_VERSION)
  assert.equal(session.version, WORKBENCH_STORAGE_VERSION)
  assert.equal(global.tabs[0].family, 'browser')
  assert.equal(session.tabs[0].family, 'terminal')
  assert.equal('dirty' in session.tabs[0], false)
  assert.equal('projectId' in session.tabs[0], false)
})

test('drops stale versions, unknown families, and missing viewers during rehydration', () => {
  const globalKey = storageKey('global')
  const stale = fixture({
    [globalKey]: JSON.stringify({ version: 0, activeTabId: 'bad', tabs: [] }),
  })
  assert.equal(stale.data.has(globalKey), false)

  const invalid = fixture({
    [globalKey]: JSON.stringify({
      version: WORKBENCH_STORAGE_VERSION,
      activeTabId: 'missing',
      tabs: [
        { id: 'one', family: 'future', viewerId: 'workbench.future', title: 'Future' },
        { id: 'two', family: 'file', viewerId: 'workbench.missing', title: 'Missing' },
        { id: 'workbench:files', family: 'file', viewerId: 'workbench.files.placeholder', title: 'Forged pinned duplicate' },
        { id: 'three', family: 'file', viewerId: 'workbench.files.placeholder', title: 'Good', resourceKey: 'README.md', projectId: 'must-not-survive' },
      ],
    }),
  })
  assert.deepEqual(invalid.controller.getSnapshot().tabs.filter(tab => !tab.pinned).map(tab => tab.id), ['workbench:files', 'three'])
  const cleaned = JSON.parse(invalid.data.get(globalKey))
  assert.equal(cleaned.activeTabId, 'workbench:details')
  assert.deepEqual(cleaned.tabs, [{
    id: 'workbench:files',
    family: 'file',
    viewerId: 'workbench.files.placeholder',
    title: 'Forged pinned duplicate',
  }, {
    id: 'three',
    family: 'file',
    viewerId: 'workbench.files.placeholder',
    title: 'Good',
    resourceKey: 'README.md',
  }])
})

test('rewrites otherwise-valid restored state to remove extra persisted fields', () => {
  const globalKey = storageKey('global')
  const restored = fixture({
    [globalKey]: JSON.stringify({
      version: WORKBENCH_STORAGE_VERSION,
      activeTabId: 'clean-me',
      tabs: [{
        id: 'clean-me',
        family: 'file',
        viewerId: 'workbench.files.placeholder',
        title: 'Clean me',
        resourceKey: 'README.md',
        projectId: 'project-fact',
        dirty: true,
      }],
      detailsSelection: { requestId: 9 },
      projectId: 'root-project-fact',
    }),
  })
  assert.equal(restored.controller.getSnapshot().activeTabId, 'clean-me')
  assert.deepEqual(JSON.parse(restored.data.get(globalKey)), {
    version: WORKBENCH_STORAGE_VERSION,
    activeTabId: 'clean-me',
    tabs: [{
      id: 'clean-me',
      family: 'file',
      viewerId: 'workbench.files.placeholder',
      title: 'Clean me',
      resourceKey: 'README.md',
    }],
  })
})

test('rejects a numeric persisted tab id instead of coercing it into the model', () => {
  const globalKey = storageKey('global')
  const restored = fixture({
    [globalKey]: JSON.stringify({
      version: WORKBENCH_STORAGE_VERSION,
      activeTabId: 'workbench:files',
      tabs: [{
        id: 123,
        family: 'file',
        viewerId: 'workbench.files.placeholder',
        title: 'Numeric id',
      }],
    }),
  })
  assert.deepEqual(restored.controller.getSnapshot().tabs.filter(tab => !tab.pinned), [])
  assert.deepEqual(JSON.parse(restored.data.get(globalKey)).tabs, [])
})

test('uses one ephemeral details-selection route and focuses the legacy Details tab', () => {
  const { controller, calls, data } = fixture()
  controller.setCurrentSession('s1')
  controller.selectDetails({ source: 'legacy-details', requestId: 7, sessionId: 's1' })
  assert.equal(controller.getSnapshot().activeTabId, 'workbench:details')
  assert.deepEqual(controller.getSnapshot().detailsSelection, {
    source: 'legacy-details', requestId: 7, sessionId: 's1',
  })
  assert.deepEqual(calls, ['open'])
  const persisted = JSON.parse(data.get(storageKey('session', 's1')))
  assert.equal('detailsSelection' in persisted, false)
  controller.dismissDetails()
  assert.equal(controller.getSnapshot().detailsSelection, undefined)
  assert.equal(controller.getSnapshot().activeTabId, 'workbench:details')
  assert.equal(JSON.parse(data.get(storageKey('session', 's1'))).activeTabId, 'workbench:details')
})

test('session switching retires an ephemeral Details selection in the previous scope', () => {
  const { controller, data } = fixture()
  controller.setCurrentSession('s1')
  controller.selectDetails({ source: 'legacy-details', requestId: 1, sessionId: 's1' })
  controller.setCurrentSession('s2')
  assert.equal(controller.getSnapshot().detailsSelection, undefined)
  assert.equal(JSON.parse(data.get(storageKey('session', 's1'))).activeTabId, 'workbench:details')
  controller.setCurrentSession('s1')
  assert.equal(controller.getSnapshot().activeTabId, 'workbench:details')
})

test('viewer removal cleans its loaded tabs without disturbing built-in viewers', () => {
  const { controller } = fixture()
  const dispose = controller.viewers.register({
    id: 'example.viewer',
    family: 'artifact',
    title: 'Example',
    canRestore: () => true,
  })
  const tab = controller.open({ family: 'artifact', viewerId: 'example.viewer', resourceKey: 'artifact:1' })
  assert.equal(controller.getSnapshot().tabs.some(item => item.id === tab.id), true)
  dispose()
  assert.equal(controller.getSnapshot().tabs.some(item => item.id === tab.id), false)
  assert.equal(controller.viewers.get('workbench.files.placeholder')?.family, 'file')
})

test('rejects a non-callable plugin viewer renderer', () => {
  const { controller } = fixture()
  assert.throws(() => controller.viewers.register({
    id: 'invalid.renderer',
    family: 'details',
    title: 'Invalid',
    canRestore: () => true,
    render: 'not-a-function',
  }), /render must be a function/)
})

test('keeps non-recoverable viewer tabs live but out of persisted descriptors', () => {
  const { controller, data } = fixture()
  controller.viewers.register({
    id: 'memory.only',
    family: 'preview',
    title: 'Memory only',
    canRestore: () => false,
  })
  const tab = controller.open({ family: 'preview', viewerId: 'memory.only', resourceKey: 'volatile' })
  assert.equal(controller.getSnapshot().tabs.some(item => item.id === tab.id), true)
  const persisted = JSON.parse(data.get(storageKey('global')))
  assert.deepEqual(persisted.tabs, [])
  assert.equal(persisted.activeTabId, 'workbench:details')
})
