/**
 * 纯窗口边界恢复逻辑：从存档恢复窗口尺寸/位置，钳制到可见显示器。
 * 与 Electron 解耦（输入为 display workArea 形状），可在 node --test 下验证。
 */
import { DEFAULT_WINDOW_BOUNDS } from './desktop-settings.js'

export const WINDOW_MIN_BOUNDS = Object.freeze({ width: 960, height: 640 })

/** 窗口至少保留这些像素落在某块显示器内，才认为位置可见。 */
const VISIBILITY_MARGIN_X = 40
const VISIBILITY_MARGIN_Y = 40
const VISIBILITY_STRIP_X = 80
const VISIBILITY_STRIP_Y = 80

/**
 * @param {unknown} saved 存档的 windowBounds（已归一化或未定义）
 * @param {{ primary: {width: number, height: number}, all: readonly {x: number, y: number, width: number, height: number}[] }} displays
 * @returns {{ width: number, height: number, x?: number, y?: number, maximized: boolean }}
 */
export function restoreWindowBounds(saved, displays) {
  const width = typeof saved?.width === 'number' && Number.isFinite(saved.width)
    ? Math.round(saved.width)
    : DEFAULT_WINDOW_BOUNDS.width
  const height = typeof saved?.height === 'number' && Number.isFinite(saved.height)
    ? Math.round(saved.height)
    : DEFAULT_WINDOW_BOUNDS.height
  const primary = displays.primary
  const restored = {
    width: Math.min(Math.max(width, WINDOW_MIN_BOUNDS.width), primary.width),
    height: Math.min(Math.max(height, WINDOW_MIN_BOUNDS.height), primary.height),
    maximized: saved?.maximized === true,
  }
  const x = typeof saved?.x === 'number' && Number.isFinite(saved.x) ? Math.round(saved.x) : undefined
  const y = typeof saved?.y === 'number' && Number.isFinite(saved.y) ? Math.round(saved.y) : undefined
  const visible = x !== undefined && y !== undefined && displays.all.some(work => (
    x >= work.x - VISIBILITY_MARGIN_X
    && y >= work.y - VISIBILITY_MARGIN_Y
    && x + restored.width > work.x + VISIBILITY_STRIP_X
    && y + restored.height > work.y + VISIBILITY_STRIP_Y
  ))
  if (visible) {
    restored.x = x
    restored.y = y
  }
  return restored
}
