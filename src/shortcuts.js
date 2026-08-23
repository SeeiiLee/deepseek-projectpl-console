import { existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'

export const DESKTOP_APP_ID = 'com.cyrus.deepseek-harness-personal'
export const SHORTCUT_NAME = 'DeepSeek Harness Personal.lnk'
export const MANAGED_SHORTCUT_DESCRIPTION = 'DeepSeek Harness Personal managed shortcut'

/**
 * electron-builder extracts a portable app to a temporary executable. Its
 * PORTABLE_EXECUTABLE_FILE value is the durable outer .exe the user moved or
 * launched, and is therefore the only valid shortcut target in portable mode.
 */
export function resolveLaunchTarget({ executablePath = process.execPath, env = process.env } = {}) {
  const portableExecutable = env.PORTABLE_EXECUTABLE_FILE?.trim()
  if (portableExecutable && isAbsolute(portableExecutable)) return resolve(portableExecutable)
  return resolve(executablePath)
}

/** @param {{desktopPath: string, appDataPath: string}} paths */
export function resolveShortcutPaths(paths, shortcutName = SHORTCUT_NAME) {
  return {
    desktop: join(paths.desktopPath, shortcutName),
    startMenu: join(paths.appDataPath, 'Microsoft', 'Windows', 'Start Menu', 'Programs', shortcutName),
  }
}

/** @param {Record<string, unknown>} details @param {string} appId */
export function isManagedShortcut(
  details,
  appId = DESKTOP_APP_ID,
  description = MANAGED_SHORTCUT_DESCRIPTION,
) {
  return details?.appUserModelId === appId
    || details?.description === description
}

/**
 * Create missing managed links and update only links carrying this app's
 * ownership marker. An unrelated .lnk with the same display name is preserved.
 * @param {{
 *   shellApi: {readShortcutLink(path: string): Record<string, unknown>, writeShortcutLink(path: string, operation: string, options: Record<string, unknown>): boolean},
 *   shortcutPaths: {desktop: string, startMenu: string},
 *   enabled: {desktop: boolean, startMenu: boolean},
 *   target: string,
 *   appId?: string,
 * }} options
 */
export function maintainShortcuts(options) {
  const appId = options.appId ?? DESKTOP_APP_ID
  const target = resolve(options.target)
  const desired = {
    target,
    cwd: dirname(target),
    args: '',
    description: options.shortcutDescription ?? MANAGED_SHORTCUT_DESCRIPTION,
    icon: target,
    iconIndex: 0,
    appUserModelId: appId,
  }
  const results = []
  for (const location of ['desktop', 'startMenu']) {
    if (!options.enabled?.[location]) {
      results.push({ location, status: 'disabled', path: options.shortcutPaths[location] })
      continue
    }
    const path = options.shortcutPaths[location]
    try {
      if (existsSync(path)) {
        const current = options.shellApi.readShortcutLink(path)
        // Adopt the installer-created link only when it already targets this
        // exact executable. Same-name links pointing elsewhere are untouched.
        if (!isManagedShortcut(current, appId, desired.description) && !sameWindowsPath(current?.target, desired.target)) {
          results.push({ location, status: 'preserved-unmanaged', path })
          continue
        }
        if (shortcutDetailsMatch(current, desired)) {
          results.push({ location, status: 'current', path })
          continue
        }
        if (!options.shellApi.writeShortcutLink(path, 'update', desired)) {
          throw new Error('Electron declined the shortcut update.')
        }
        results.push({ location, status: 'updated', path })
        continue
      }
      mkdirSync(dirname(path), { recursive: true })
      if (!options.shellApi.writeShortcutLink(path, 'create', desired)) {
        throw new Error('Electron declined the shortcut creation.')
      }
      results.push({ location, status: 'created', path })
    } catch (error) {
      results.push({
        location,
        status: 'error',
        path,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return results
}

function shortcutDetailsMatch(current, desired) {
  return sameWindowsPath(current?.target, desired.target)
    && sameWindowsPath(current?.cwd, desired.cwd)
    && (current?.args ?? '') === desired.args
    && current?.description === desired.description
    && sameWindowsPath(current?.icon, desired.icon)
    && Number(current?.iconIndex ?? 0) === desired.iconIndex
    && current?.appUserModelId === desired.appUserModelId
}

function sameWindowsPath(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false
  if (resolve(left).toLocaleLowerCase('en-US') === resolve(right).toLocaleLowerCase('en-US')) return true
  try {
    const leftStat = statSync(left, { bigint: true })
    const rightStat = statSync(right, { bigint: true })
    return leftStat.dev === rightStat.dev && leftStat.ino === rightStat.ino
  } catch {
    return false
  }
}
