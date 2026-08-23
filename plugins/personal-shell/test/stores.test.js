import assert from 'node:assert/strict'
import test from 'node:test'
import {
  defaultLayoutPreferences,
  LAYOUT_STORAGE_KEY,
  loadLayoutPreferences,
  sanitizeLayoutPreferences,
  saveLayoutPreferences,
} from '../src/client/preferences.ts'
import {
  defaultLayoutState,
  layoutMutations,
} from '../src/client/layout-state.ts'
import { WORKBENCH_DEFAULT } from '../src/client/columns.ts'

function memoryStorage(initial) {
  const values = new Map(initial === undefined ? [] : [[LAYOUT_STORAGE_KEY, initial]])
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
    value: () => values.get(LAYOUT_STORAGE_KEY),
  }
}

test('sanitizes versioned preferences and clamps remembered widths', () => {
  assert.deepEqual(sanitizeLayoutPreferences({
    version: 1,
    sidebarOpen: false,
    project: { open: false, width: 9999 },
    workbench: { open: true, width: 12 },
  }), {
    version: 1,
    sidebarOpen: false,
    project: { open: false, width: 1000 },
    workbench: { open: true, width: 360 },
  })
  assert.deepEqual(sanitizeLayoutPreferences({ version: 99 }), defaultLayoutPreferences())
})

test('initial load recovers corrupt JSON and rewrites a clean current payload', () => {
  const storage = memoryStorage('{not-json')
  const loaded = loadLayoutPreferences(storage)
  assert.deepEqual(loaded, defaultLayoutPreferences())
  assert.deepEqual(JSON.parse(storage.value()), defaultLayoutPreferences())
})

test('save writes only cleansed user preferences, not viewport-derived state', () => {
  const storage = memoryStorage()
  saveLayoutPreferences({
    sidebarOpen: false,
    projectOpen: true,
    projectWidth: 9999,
    workbenchOpen: false,
    workbenchWidth: 100,
    preferredAuxiliary: 'workbench',
    narrow: true,
    narrowExpanded: true,
    detailsCommand: { kind: 'open', revision: 42 },
  }, storage)
  assert.deepEqual(JSON.parse(storage.value()), {
    version: 1,
    sidebarOpen: false,
    project: { open: true, width: 1000 },
    workbench: { open: false, width: 360 },
  })
})

test('action reducers retain widths through focus and restore defaults on reset', () => {
  const state = defaultLayoutState()
  layoutMutations.setProject(state, 512)
  layoutMutations.closeProject(state)
  layoutMutations.openProject(state)
  layoutMutations.setWorkbench(state, 704)
  layoutMutations.closeWorkbench(state)
  layoutMutations.openWorkbench(state)
  assert.equal(state.projectWidth, 512)
  assert.equal(state.workbenchWidth, 704)
  assert.equal(state.preferredAuxiliary, 'workbench')

  layoutMutations.focusConversation(state)
  assert.equal(state.projectOpen, false)
  assert.equal(state.workbenchOpen, false)
  assert.equal(state.projectWidth, 512)
  assert.equal(state.workbenchWidth, 704)

  layoutMutations.resetLayout(state)
  assert.equal(state.sidebarOpen, true)
  assert.equal(state.projectOpen, true)
  assert.equal(state.projectWidth, 360)
  assert.equal(state.workbenchOpen, true)
  assert.equal(state.workbenchWidth, WORKBENCH_DEFAULT)
})

test('fullscreen is transient: it expands Workbench and any console open exits it', () => {
  const state = defaultLayoutState()
  layoutMutations.setWorkbenchFullscreen(state, true)
  assert.equal(state.workbenchFullscreen, true)
  assert.equal(state.workbenchOpen, true)
  assert.equal(state.preferredAuxiliary, 'workbench')
  layoutMutations.setWorkbenchFullscreen(state, false)
  assert.equal(state.workbenchFullscreen, false)
  layoutMutations.setWorkbenchFullscreen(state, true)
  layoutMutations.openProject(state)
  assert.equal(state.workbenchFullscreen, false)
})

test('Details commands remain observable across repeated open, close and Session clear', () => {
  const state = defaultLayoutState()
  assert.deepEqual(state.detailsCommand, { kind: 'dismiss', revision: 0 })

  layoutMutations.closeDetails(state)
  assert.deepEqual(state.detailsCommand, { kind: 'dismiss', revision: 1 })
  layoutMutations.closeDetails(state)
  assert.deepEqual(state.detailsCommand, { kind: 'dismiss', revision: 2 })
  layoutMutations.openDetails(state)
  assert.deepEqual(state.detailsCommand, { kind: 'open', revision: 3 })
  assert.equal(state.workbenchOpen, true)
  layoutMutations.clearDetails(state)
  assert.deepEqual(state.detailsCommand, { kind: 'dismiss', revision: 4 })
  assert.equal(state.workbenchOpen, true, 'Session clear must not collapse Workbench')
})
