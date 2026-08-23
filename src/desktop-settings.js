import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const DESKTOP_SETTINGS_VERSION = 1
export const DESKTOP_SETTINGS_FILENAME = 'desktop-shell.json'

export const DEFAULT_DESKTOP_SETTINGS = Object.freeze({
  version: DESKTOP_SETTINGS_VERSION,
  closeToTray: true,
  maintainShortcuts: Object.freeze({
    desktop: true,
    startMenu: true,
  }),
})

/** 首次启动的默认窗口尺寸（记忆化之外的回退）。 */
export const DEFAULT_WINDOW_BOUNDS = Object.freeze({ width: 1880, height: 1000 })

/** @param {unknown} value */
export function normalizeDesktopSettings(value) {
  const candidate = value !== null && typeof value === 'object' ? value : {}
  const shortcuts = candidate.maintainShortcuts !== null
    && typeof candidate.maintainShortcuts === 'object'
    ? candidate.maintainShortcuts
    : {}
  const bounds = candidate.windowBounds !== null
    && typeof candidate.windowBounds === 'object'
    ? candidate.windowBounds
    : {}
  const finiteNumber = (field) => (
    typeof bounds[field] === 'number' && Number.isFinite(bounds[field])
      ? Math.round(bounds[field])
      : undefined
  )
  const savedWidth = finiteNumber('width')
  const savedHeight = finiteNumber('height')
  const savedX = finiteNumber('x')
  const savedY = finiteNumber('y')
  const windowBounds = savedWidth === undefined || savedHeight === undefined
    ? undefined
    : {
        width: savedWidth,
        height: savedHeight,
        ...(savedX === undefined ? {} : { x: savedX }),
        ...(savedY === undefined ? {} : { y: savedY }),
        maximized: typeof bounds.maximized === 'boolean' ? bounds.maximized : false,
      }
  return {
    version: DESKTOP_SETTINGS_VERSION,
    closeToTray: typeof candidate.closeToTray === 'boolean'
      ? candidate.closeToTray
      : DEFAULT_DESKTOP_SETTINGS.closeToTray,
    maintainShortcuts: {
      desktop: typeof shortcuts.desktop === 'boolean'
        ? shortcuts.desktop
        : DEFAULT_DESKTOP_SETTINGS.maintainShortcuts.desktop,
      startMenu: typeof shortcuts.startMenu === 'boolean'
        ? shortcuts.startMenu
        : DEFAULT_DESKTOP_SETTINGS.maintainShortcuts.startMenu,
    },
    ...(windowBounds === undefined ? {} : { windowBounds }),
  }
}

/** @param {string} userDataPath */
export function resolveDesktopSettingsPath(userDataPath) {
  return join(userDataPath, DESKTOP_SETTINGS_FILENAME)
}

/**
 * Load desktop-only preferences. Invalid or future-shaped content is reduced to
 * the known safe fields; malformed files do not prevent the application boot.
 * @param {string} userDataPath
 */
export function loadDesktopSettings(userDataPath) {
  const path = resolveDesktopSettingsPath(userDataPath)
  try {
    return normalizeDesktopSettings(JSON.parse(readFileSync(path, 'utf8')))
  } catch (error) {
    if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
    return normalizeDesktopSettings(undefined)
  }
}

/** @param {string} userDataPath @param {unknown} value */
export function saveDesktopSettings(userDataPath, value) {
  const settings = normalizeDesktopSettings(value)
  const path = resolveDesktopSettingsPath(userDataPath)
  const temporaryPath = path + '.' + process.pid + '.tmp'
  mkdirSync(dirname(path), { recursive: true })
  try {
    writeFileSync(temporaryPath, JSON.stringify(settings, null, 2) + '\n', 'utf8')
    renameSync(temporaryPath, path)
  } catch (error) {
    try {
      unlinkSync(temporaryPath)
    } catch (cleanupError) {
      if (cleanupError?.code !== 'ENOENT') console.error(cleanupError)
    }
    throw error
  }
  return settings
}
