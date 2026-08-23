import assert from 'node:assert/strict'
import test from 'node:test'
import { restoreWindowBounds, WINDOW_MIN_BOUNDS } from '../src/window-bounds.js'

const primary = { x: 0, y: 0, width: 2560, height: 1400 }
const displays = { primary, all: [primary, { x: 2560, y: 0, width: 1920, height: 1080 }] }

test('无存档时回落到默认尺寸且不带位置', () => {
  assert.deepEqual(restoreWindowBounds(undefined, displays), { width: 1880, height: 1000, maximized: false })
  assert.deepEqual(restoreWindowBounds({}, displays), { width: 1880, height: 1000, maximized: false })
})

test('存档合法时恢复尺寸、位置与最大化标记', () => {
  assert.deepEqual(restoreWindowBounds({ x: 100, y: 60, width: 1600, height: 980, maximized: true }, displays), {
    x: 100, y: 60, width: 1600, height: 980, maximized: true,
  })
})

test('超界尺寸钳制到主显示器工作区', () => {
  assert.deepEqual(restoreWindowBounds({ x: 10, y: 10, width: 4000, height: 3000 }, displays), {
    x: 10, y: 10, width: 2560, height: 1400, maximized: false,
  })
  assert.deepEqual(restoreWindowBounds({ width: 500, height: 400 }, displays), {
    width: WINDOW_MIN_BOUNDS.width, height: WINDOW_MIN_BOUNDS.height, maximized: false,
  })
})

test('位置完全离屏时丢弃位置但保留尺寸', () => {
  const restored = restoreWindowBounds({ x: -3000, y: -3000, width: 1600, height: 980 }, displays)
  assert.equal(restored.x, undefined)
  assert.equal(restored.y, undefined)
  assert.equal(restored.width, 1600)
  assert.equal(restored.height, 980)
})

test('副显示器上的位置保持可见', () => {
  assert.deepEqual(restoreWindowBounds({ x: 2700, y: 100, width: 1200, height: 800 }, displays), {
    x: 2700, y: 100, width: 1200, height: 800, maximized: false,
  })
})

test('非有限数值回落到默认', () => {
  assert.deepEqual(restoreWindowBounds({ x: Number.NaN, y: 20, width: 'wide', height: Infinity }, displays), {
    width: 1880, height: 1000, maximized: false,
  })
})
