import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clampWidth,
  computeColumns,
  CONVERSATION_MIN,
  PROJECT_COLLAPSED_RAIL,
  PROJECT_DEFAULT,
  PROJECT_MAX,
  PROJECT_MIN,
  SIDEBAR_COLLAPSED,
  SIDEBAR_DEFAULT,
  WORKBENCH_COLLAPSED_RAIL,
  WORKBENCH_DEFAULT,
  WORKBENCH_MAX,
  WORKBENCH_MIN,
} from '../src/client/columns.ts'

function preferences(overrides = {}) {
  return {
    sidebarCollapsed: false,
    projectOpen: true,
    projectWidth: PROJECT_DEFAULT,
    workbenchOpen: true,
    workbenchWidth: WORKBENCH_DEFAULT,
    preferredAuxiliary: 'project',
    workbenchFullscreen: false,
    ...overrides,
  }
}

test('keeps the native sidebar at the rc.5 fixed open and rail widths', () => {
  assert.equal(computeColumns(1920, preferences()).sidebar, SIDEBAR_DEFAULT)
  assert.equal(computeColumns(1920, preferences({ sidebarCollapsed: true })).sidebar, SIDEBAR_COLLAPSED)
})

test('renders all four tracks at preferred widths when they fit', () => {
  assert.deepEqual(computeColumns(1920, preferences()), {
    sidebar: 280,
    project: 360,
    conversation: 640,
    workbench: WORKBENCH_DEFAULT,
  })
})

test('shrinks Workbench to minimum and then derives its rail before Project', () => {
  assert.deepEqual(computeColumns(1600, preferences()), {
    sidebar: 280,
    project: 360,
    conversation: CONVERSATION_MIN,
    workbench: 400,
  })
  assert.deepEqual(computeColumns(1530, preferences()), {
    sidebar: 280,
    project: 360,
    conversation: 846,
    workbench: WORKBENCH_COLLAPSED_RAIL,
  })
})

test('a recently operated Workbench wins at 1380px and Project wins in reverse', () => {
  assert.deepEqual(computeColumns(1380, preferences({ preferredAuxiliary: 'project' })), {
    sidebar: 280,
    project: PROJECT_DEFAULT,
    conversation: 696,
    workbench: WORKBENCH_COLLAPSED_RAIL,
  })
  assert.deepEqual(computeColumns(1380, preferences({ preferredAuxiliary: 'workbench' })), {
    sidebar: 280,
    project: PROJECT_COLLAPSED_RAIL,
    conversation: CONVERSATION_MIN,
    workbench: 500,
  })
})

test('explicitly closed panels keep structural rails and never overlay Conversation', () => {
  assert.deepEqual(computeColumns(1380, preferences({ projectOpen: false })), {
    sidebar: 280,
    project: PROJECT_COLLAPSED_RAIL,
    conversation: CONVERSATION_MIN,
    workbench: 500,
  })
  assert.deepEqual(computeColumns(1920, preferences({ projectOpen: false, workbenchOpen: false })), {
    sidebar: 280,
    project: PROJECT_COLLAPSED_RAIL,
    conversation: 1556,
    workbench: WORKBENCH_COLLAPSED_RAIL,
  })
})

test('fullscreen spans the console rail and the whole conversation region', () => {
  assert.deepEqual(computeColumns(5120, preferences({ workbenchFullscreen: true })), {
    sidebar: 280,
    project: PROJECT_COLLAPSED_RAIL,
    conversation: 0,
    workbench: 5120 - 280 - PROJECT_COLLAPSED_RAIL,
  })
})

test('re-widening restores stored widths because concessions are pure', () => {
  const stored = preferences({
    projectWidth: 700,
    workbenchWidth: 800,
    preferredAuxiliary: 'workbench',
  })
  assert.equal(computeColumns(1500, stored).project, PROJECT_COLLAPSED_RAIL)
  assert.deepEqual(computeColumns(2400, stored), {
    sidebar: 280,
    project: 700,
    conversation: 620,
    workbench: 800,
  })
})

test('bounds stale widths and handles a tiny or invalid viewport without overlap math', () => {
  assert.equal(clampWidth(319.6, PROJECT_MIN, PROJECT_MAX), PROJECT_MIN)
  assert.equal(clampWidth(Number.NaN, WORKBENCH_MIN, WORKBENCH_MAX), WORKBENCH_MIN)
  assert.deepEqual(computeColumns(Number.NaN, preferences({ projectOpen: false, workbenchOpen: false })), {
    sidebar: 280,
    project: PROJECT_COLLAPSED_RAIL,
    conversation: 0,
    workbench: WORKBENCH_COLLAPSED_RAIL,
  })
})
