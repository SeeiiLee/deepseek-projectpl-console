import { copyFileSync, unlinkSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

/**
 * Copy a packaged executable next to itself under a "-Smoke" process name.
 * The renamed copy shares the same resources directory, so Electron boots
 * unchanged; the process tree then shows the Smoke name instead of the real
 * product name. Returns null when no copy is needed or the copy fails — the
 * caller then falls back to the original executable with PID-based cleanup.
 * @param {string} executablePath
 * @returns {{ executable: string, cleanup: () => void } | null}
 */
export function prepareSmokeExecutable(executablePath) {
  const stem = basename(executablePath).replace(/\.exe$/iu, '')
  if (stem === '' || stem.endsWith('-Smoke')) return null
  const renamed = join(dirname(executablePath), `${stem}-Smoke.exe`)
  try {
    copyFileSync(executablePath, renamed)
  } catch {
    return null
  }
  return {
    executable: renamed,
    cleanup: () => {
      try { unlinkSync(renamed) } catch { /* a later run may reuse the copy */ }
    },
  }
}