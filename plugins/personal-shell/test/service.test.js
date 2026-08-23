import assert from 'node:assert/strict'
import test from 'node:test'
import { LayoutController } from '../src/client/service.ts'

function actions() {
  const calls = []
  return {
    calls,
    panelActions: {
      setProject() {},
      toggleProject() { calls.push('toggle-project') },
      openProject() { calls.push('open-project') },
      closeProject() { calls.push('close-project') },
      setWorkbench() {},
      toggleWorkbench() { calls.push('toggle-workbench') },
      openWorkbench() { calls.push('open-workbench') },
      closeWorkbench() { calls.push('close-workbench') },
      setNarrow() {},
      toggleSidebar() { calls.push('sidebar') },
      openDetails() { calls.push('open-details') },
      closeDetails() { calls.push('close-details') },
      focusConversation() { calls.push('focus-conversation') },
      resetLayout() { calls.push('reset-layout') },
    },
  }
}

test('fails loud until the root entry attaches panel actions', () => {
  const layout = new LayoutController()
  for (const invoke of [
    () => layout.toggleSidebar(),
    () => layout.openDetails(),
    () => layout.closeDetails(),
    () => layout.openProject(),
    () => layout.closeProject(),
    () => layout.toggleProject(),
    () => layout.openWorkbench(),
    () => layout.closeWorkbench(),
    () => layout.toggleWorkbench(),
    () => layout.focusConversation(),
    () => layout.resetLayout(),
  ]) assert.throws(invoke, /panel actions not wired/)
})

test('forwards the rc.5 layout and complete personalShell service faces', () => {
  const layout = new LayoutController()
  const fake = actions()
  layout.attachPanels(fake.panelActions)
  layout.toggleSidebar()
  layout.openDetails()
  layout.closeDetails()
  layout.openProject()
  layout.closeProject()
  layout.toggleProject()
  layout.openWorkbench()
  layout.closeWorkbench()
  layout.toggleWorkbench()
  layout.focusConversation()
  layout.resetLayout()
  assert.deepEqual(fake.calls, [
    'sidebar',
    'open-details',
    'close-details',
    'open-project',
    'close-project',
    'toggle-project',
    'open-workbench',
    'close-workbench',
    'toggle-workbench',
    'focus-conversation',
    'reset-layout',
  ])
})

test('a remounted root replaces stale panel actions', () => {
  const layout = new LayoutController()
  const stale = actions()
  const current = actions()
  layout.attachPanels(stale.panelActions)
  layout.attachPanels(current.panelActions)
  layout.toggleSidebar()
  assert.deepEqual(stale.calls, [])
  assert.deepEqual(current.calls, ['sidebar'])
})
