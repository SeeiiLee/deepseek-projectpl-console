import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  DEV_APP_FLAVOR,
  STABLE_APP_FLAVOR,
  STABLE_PACKAGED_HARNESS_HOME,
  STABLE_PACKAGED_USER_DATA_PATH,
  loadAppFlavor,
  resolveHarnessHomeOverride,
  resolveUserDataOverride,
} from '../src/app-flavor.js'
import { BUILD_FLAVOR } from '../src/build-flavor.js'
import {
  isManagedShortcut,
  maintainShortcuts,
  resolveShortcutPaths,
} from '../src/shortcuts.js'

test('the source tree defaults to the stable flavor', () => {
  assert.equal(BUILD_FLAVOR, 'stable')
  assert.equal(loadAppFlavor().flavor, 'stable')
})

test('the two flavors keep completely separate identities', () => {
  assert.equal(loadAppFlavor('dev'), DEV_APP_FLAVOR)
  assert.equal(loadAppFlavor('stable'), STABLE_APP_FLAVOR)
  assert.equal(loadAppFlavor('unknown'), STABLE_APP_FLAVOR, 'unknown flavors fall back to stable')

  assert.notEqual(STABLE_APP_FLAVOR.name, DEV_APP_FLAVOR.name)
  assert.notEqual(STABLE_APP_FLAVOR.appId, DEV_APP_FLAVOR.appId)
  assert.notEqual(STABLE_APP_FLAVOR.shortcutName, DEV_APP_FLAVOR.shortcutName)
  assert.notEqual(STABLE_APP_FLAVOR.shortcutDescription, DEV_APP_FLAVOR.shortcutDescription)
  assert.match(DEV_APP_FLAVOR.appId, /^com\.cyrus\.deepseek-harness-personal-dev$/u)
})

test('flavor-aware shortcut paths and ownership never cross between packages', () => {
  const paths = {
    desktopPath: 'C:\\Users\\Cyrus\\Desktop',
    appDataPath: 'C:\\Users\\Cyrus\\AppData\\Roaming',
  }
  const stable = resolveShortcutPaths(paths, STABLE_APP_FLAVOR.shortcutName)
  const dev = resolveShortcutPaths(paths, DEV_APP_FLAVOR.shortcutName)
  assert.notEqual(stable.desktop, dev.desktop)
  assert.notEqual(stable.startMenu, dev.startMenu)
  assert.match(stable.desktop, /DeepSeek Harness Personal\.lnk$/u)
  assert.match(dev.desktop, /DeepSeek Harness Personal Dev\.lnk$/u)

  const stableLink = {
    appUserModelId: STABLE_APP_FLAVOR.appId,
    description: STABLE_APP_FLAVOR.shortcutDescription,
    target: 'C:\\Program Files\\DeepSeek\\app.exe',
  }
  const devLink = {
    appUserModelId: DEV_APP_FLAVOR.appId,
    description: DEV_APP_FLAVOR.shortcutDescription,
    target: 'C:\\Program Files\\DeepSeek\\dev.exe',
  }
  assert.equal(
    isManagedShortcut(stableLink, STABLE_APP_FLAVOR.appId, STABLE_APP_FLAVOR.shortcutDescription),
    true,
  )
  assert.equal(
    isManagedShortcut(stableLink, DEV_APP_FLAVOR.appId, DEV_APP_FLAVOR.shortcutDescription),
    false,
    'the dev package must not claim the stable shortcut',
  )
  assert.equal(
    isManagedShortcut(devLink, DEV_APP_FLAVOR.appId, DEV_APP_FLAVOR.shortcutDescription),
    true,
  )
})

test('only the packaged stable build moves its data home to the F: directory', () => {
  assert.equal(STABLE_PACKAGED_USER_DATA_PATH, 'F:\\documents\\Cyrus Deepseek Harness Data')

  // Installed stable: fixed F: data home.
  assert.equal(
    resolveUserDataOverride({ flavor: 'stable', isPackaged: true }),
    STABLE_PACKAGED_USER_DATA_PATH,
  )
  assert.equal(
    resolveUserDataOverride({ flavor: STABLE_APP_FLAVOR, isPackaged: true }),
    STABLE_PACKAGED_USER_DATA_PATH,
  )

  // Explicit launcher/smoke override always wins.
  assert.equal(
    resolveUserDataOverride({ flavor: 'stable', isPackaged: true, env: { DSH_DESKTOP_USER_DATA: 'C:\\Temp\\Smoke' } }),
    null,
  )

  // The directory-run stable copy keeps its historic location during the transition.
  assert.equal(resolveUserDataOverride({ flavor: 'stable', isPackaged: false }), null)

  // The dev flavor never moves its data home.
  assert.equal(resolveUserDataOverride({ flavor: 'dev', isPackaged: true }), null)
  assert.equal(resolveUserDataOverride({ flavor: 'dev', isPackaged: false }), null)
})

test('only the packaged stable build moves its Harness home to the F: directory', () => {
  assert.equal(STABLE_PACKAGED_HARNESS_HOME, 'F:\\documents\\Cyrus Deepseek Harness Data\\harness-home')

  assert.equal(
    resolveHarnessHomeOverride({ flavor: 'stable', isPackaged: true }),
    STABLE_PACKAGED_HARNESS_HOME,
  )
  assert.equal(
    resolveHarnessHomeOverride({ flavor: STABLE_APP_FLAVOR, isPackaged: true }),
    STABLE_PACKAGED_HARNESS_HOME,
  )

  // Explicit DSH_HOME (launchers/smoke) always wins.
  assert.equal(
    resolveHarnessHomeOverride({ flavor: 'stable', isPackaged: true, env: { DSH_HOME: 'C:\\Temp\\Smoke' } }),
    null,
  )

  // The directory-run stable copy keeps %USERPROFILE%\.dsh during the transition.
  assert.equal(resolveHarnessHomeOverride({ flavor: 'stable', isPackaged: false }), null)

  // The dev flavor never moves its Harness home.
  assert.equal(resolveHarnessHomeOverride({ flavor: 'dev', isPackaged: true }), null)
  assert.equal(resolveHarnessHomeOverride({ flavor: 'dev', isPackaged: false }), null)
})

test('main.js applies explicit user-data and honors explicit DSH_HOME in smoke runs', () => {
  const mainSource = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
  // DSH_DESKTOP_USER_DATA must reach app.setPath so smoke/launchers own their data.
  assert.match(mainSource, /DSH_DESKTOP_USER_DATA\?\.trim\(\)/)
  assert.match(mainSource, /app\.setPath\('userData', resolve\(explicitUserData\)\)/)
  // The harness-home override must see process.env so an explicit DSH_HOME wins
  // and smoke runs never re-junction the real F: harness home.
  assert.match(mainSource, /resolveHarnessHomeOverride\(\{ flavor: appFlavor, isPackaged: app\.isPackaged, env: process\.env \}\)/)
})

test('dev shortcut maintenance writes the dev identity and preserves stable links', () => {
  const writes = []
  const shellApi = {
    readShortcutLink(path) {
      if (path.includes('Dev')) return null
      return {
        target: 'C:\\Program Files\\DeepSeek\\app.exe',
        description: STABLE_APP_FLAVOR.shortcutDescription,
        appUserModelId: STABLE_APP_FLAVOR.appId,
      }
    },
    writeShortcutLink(path, operation, options) {
      writes.push({ path, operation, options })
      return true
    },
  }
  const paths = resolveShortcutPaths({
    desktopPath: 'C:\\Users\\Cyrus\\Desktop',
    appDataPath: 'C:\\Users\\Cyrus\\AppData\\Roaming',
  }, DEV_APP_FLAVOR.shortcutName)
  const results = maintainShortcuts({
    shellApi,
    shortcutPaths: paths,
    enabled: { desktop: true, startMenu: true },
    target: 'C:\\Tools\\DeepSeek Harness Personal Dev.exe',
    appId: DEV_APP_FLAVOR.appId,
    shortcutDescription: DEV_APP_FLAVOR.shortcutDescription,
  })
  assert.equal(results.filter(result => result.status === 'created').length, 2)
  assert.equal(writes.length, 2)
  for (const write of writes) {
    assert.equal(write.options.appUserModelId, DEV_APP_FLAVOR.appId)
    assert.equal(write.options.description, DEV_APP_FLAVOR.shortcutDescription)
  }
})
