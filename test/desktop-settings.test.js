import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import {
  DEFAULT_DESKTOP_SETTINGS,
  loadDesktopSettings,
  normalizeDesktopSettings,
  resolveDesktopSettingsPath,
  saveDesktopSettings,
} from '../src/desktop-settings.js'

const owned = []
afterEach(() => {
  for (const path of owned.splice(0)) rmSync(path, { recursive: true, force: true })
})

test('desktop settings default to close-to-tray and managed shortcuts', () => {
  assert.deepEqual(normalizeDesktopSettings(undefined), DEFAULT_DESKTOP_SETTINGS)
})

test('desktop settings preserve only known boolean fields', () => {
  assert.deepEqual(normalizeDesktopSettings({
    version: 99,
    closeToTray: false,
    maintainShortcuts: { desktop: false, startMenu: 'yes', unexpected: true },
    unexpected: 'discarded',
  }), {
    version: 1,
    closeToTray: false,
    maintainShortcuts: { desktop: false, startMenu: true },
  })
})

test('desktop settings keep sane window bounds and drop partial ones', () => {
  assert.deepEqual(normalizeDesktopSettings({
    closeToTray: true,
    windowBounds: { x: 12.6, y: 30.4, width: 1880.4, height: 1000.6, maximized: true },
  }), {
    version: 1,
    closeToTray: true,
    maintainShortcuts: { desktop: true, startMenu: true },
    windowBounds: { x: 13, y: 30, width: 1880, height: 1001, maximized: true },
  })
  // 缺 width/height 或非数字 → 整段丢弃
  assert.deepEqual(normalizeDesktopSettings({
    closeToTray: false,
    windowBounds: { x: 10, y: 20, width: 'wide', height: 900 },
  }), {
    version: 1,
    closeToTray: false,
    maintainShortcuts: { desktop: true, startMenu: true },
  })
  assert.deepEqual(normalizeDesktopSettings({
    closeToTray: false,
    windowBounds: { width: 100, height: Number.NaN },
  }), {
    version: 1,
    closeToTray: false,
    maintainShortcuts: { desktop: true, startMenu: true },
  })
})

test('desktop settings save and load from an isolated userData directory', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-settings-'))
  owned.push(root)
  saveDesktopSettings(root, {
    closeToTray: false,
    maintainShortcuts: { desktop: true, startMenu: false },
  })
  assert.deepEqual(loadDesktopSettings(root), {
    version: 1,
    closeToTray: false,
    maintainShortcuts: { desktop: true, startMenu: false },
  })
  assert.equal(JSON.parse(readFileSync(resolveDesktopSettingsPath(root), 'utf8')).version, 1)
})

test('a malformed desktop settings file falls back without touching it', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-settings-malformed-'))
  owned.push(root)
  const path = resolveDesktopSettingsPath(root)
  writeFileSync(path, '{not json', 'utf8')
  assert.deepEqual(loadDesktopSettings(root), DEFAULT_DESKTOP_SETTINGS)
  assert.equal(readFileSync(path, 'utf8'), '{not json')
})
