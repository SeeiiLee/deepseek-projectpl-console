import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app, shell } from 'electron'
import { maintainShortcuts, resolveShortcutPaths } from '../../src/shortcuts.js'

app.whenReady().then(() => {
  const root = process.env.DSH_SHORTCUT_CHECK_ROOT
  const resultPath = process.env.DSH_SHORTCUT_CHECK_RESULT
  if (!root || !resultPath) throw new Error('Shortcut check paths are required.')
  const shortcutPaths = resolveShortcutPaths({
    desktopPath: join(root, 'Desktop'),
    appDataPath: join(root, 'AppData', 'Roaming'),
  })
  const firstTarget = join(root, 'first', 'portable.exe')
  const movedTarget = join(root, 'moved', 'portable.exe')
  mkdirSync(dirname(firstTarget), { recursive: true })
  mkdirSync(dirname(movedTarget), { recursive: true })
  writeFileSync(firstTarget, '')
  const created = maintainShortcuts({
    shellApi: shell,
    shortcutPaths,
    enabled: { desktop: true, startMenu: false },
    target: firstTarget,
  })
  renameSync(firstTarget, movedTarget)
  const repaired = maintainShortcuts({
    shellApi: shell,
    shortcutPaths,
    enabled: { desktop: true, startMenu: false },
    target: movedTarget,
  })
  const stable = maintainShortcuts({
    shellApi: shell,
    shortcutPaths,
    enabled: { desktop: true, startMenu: false },
    target: movedTarget,
  })
  const details = shell.readShortcutLink(shortcutPaths.desktop)
  writeFileSync(resultPath, JSON.stringify({ created, repaired, stable, details }), 'utf8')
  app.exit(0)
}).catch(error => {
  if (process.env.DSH_SHORTCUT_CHECK_RESULT) {
    writeFileSync(process.env.DSH_SHORTCUT_CHECK_RESULT, JSON.stringify({
      error: error instanceof Error ? error.stack : String(error),
    }), 'utf8')
  }
  app.exit(1)
})
