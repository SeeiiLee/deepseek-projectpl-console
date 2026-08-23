import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, test } from 'node:test'
import {
  DESKTOP_APP_ID,
  maintainShortcuts,
  MANAGED_SHORTCUT_DESCRIPTION,
  resolveLaunchTarget,
  resolveShortcutPaths,
} from '../src/shortcuts.js'

const owned = []
afterEach(() => {
  for (const path of owned.splice(0)) rmSync(path, { recursive: true, force: true })
})

test('portable shortcuts target the durable outer executable', () => {
  assert.equal(resolveLaunchTarget({
    executablePath: 'C:\\Users\\Cyrus\\AppData\\Local\\Temp\\portable.exe',
    env: { PORTABLE_EXECUTABLE_FILE: 'D:\\Apps\\DeepSeek Harness Personal.exe' },
  }), resolve('D:\\Apps\\DeepSeek Harness Personal.exe'))
})

test('installed shortcuts target the running packaged executable', () => {
  assert.equal(resolveLaunchTarget({
    executablePath: 'C:\\Users\\Cyrus\\AppData\\Local\\Programs\\DeepSeek Harness Personal\\app.exe',
    env: {},
  }), resolve('C:\\Users\\Cyrus\\AppData\\Local\\Programs\\DeepSeek Harness Personal\\app.exe'))
})

test('managed shortcuts are created and repaired after a portable move', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-shortcuts-'))
  owned.push(root)
  const shortcutPaths = resolveShortcutPaths({
    desktopPath: join(root, 'Desktop'),
    appDataPath: join(root, 'AppData', 'Roaming'),
  })
  const details = new Map()
  const writes = []
  const shellApi = {
    readShortcutLink(path) {
      return details.get(path)
    },
    writeShortcutLink(path, operation, options) {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, 'owned')
      details.set(path, { ...options })
      writes.push({ path, operation, options })
      return true
    },
  }

  const created = maintainShortcuts({
    shellApi,
    shortcutPaths,
    enabled: { desktop: true, startMenu: true },
    target: join(root, 'first', 'portable.exe'),
  })
  assert.deepEqual(created.map(row => row.status), ['created', 'created'])
  assert.deepEqual(writes.map(row => row.operation), ['create', 'create'])
  assert.ok(writes.every(row => row.options.description === MANAGED_SHORTCUT_DESCRIPTION))
  assert.ok(writes.every(row => row.options.appUserModelId === DESKTOP_APP_ID))

  const updated = maintainShortcuts({
    shellApi,
    shortcutPaths,
    enabled: { desktop: true, startMenu: true },
    target: join(root, 'moved', 'portable.exe'),
  })
  assert.deepEqual(updated.map(row => row.status), ['updated', 'updated'])
  assert.deepEqual(writes.slice(2).map(row => row.operation), ['update', 'update'])
  assert.ok(writes.slice(2).every(row => row.options.target === resolve(join(root, 'moved', 'portable.exe'))))
})

test('an unrelated shortcut with the same display name is never overwritten', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-shortcuts-unmanaged-'))
  owned.push(root)
  const shortcutPaths = resolveShortcutPaths({
    desktopPath: join(root, 'Desktop'),
    appDataPath: join(root, 'AppData'),
  })
  mkdirSync(dirname(shortcutPaths.desktop), { recursive: true })
  writeFileSync(shortcutPaths.desktop, 'unmanaged')
  let writes = 0
  const results = maintainShortcuts({
    shellApi: {
      readShortcutLink: () => ({ target: 'C:\\Other\\app.exe', description: 'Another app' }),
      writeShortcutLink: () => {
        writes += 1
        return true
      },
    },
    shortcutPaths,
    enabled: { desktop: true, startMenu: false },
    target: join(root, 'portable.exe'),
  })
  assert.equal(results[0].status, 'preserved-unmanaged')
  assert.equal(results[1].status, 'disabled')
  assert.equal(writes, 0)
})

test('an installer shortcut targeting this executable is safely adopted', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-shortcuts-installer-'))
  owned.push(root)
  const target = join(root, 'installed', 'app.exe')
  const shortcutPaths = resolveShortcutPaths({
    desktopPath: join(root, 'Desktop'),
    appDataPath: join(root, 'AppData'),
  })
  mkdirSync(dirname(shortcutPaths.desktop), { recursive: true })
  writeFileSync(shortcutPaths.desktop, 'installer-created')
  const writes = []
  const results = maintainShortcuts({
    shellApi: {
      readShortcutLink: () => ({ target }),
      writeShortcutLink: (path, operation, options) => {
        writes.push({ path, operation, options })
        return true
      },
    },
    shortcutPaths,
    enabled: { desktop: true, startMenu: false },
    target,
  })
  assert.equal(results[0].status, 'updated')
  assert.equal(writes[0].operation, 'update')
  assert.equal(writes[0].options.appUserModelId, DESKTOP_APP_ID)
})
