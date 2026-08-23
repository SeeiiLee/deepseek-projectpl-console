// Pure matcher for running personal-client processes. Process rows come
// from Win32_Process (pid/name/commandLine). The match happens HERE, never in
// the PowerShell query string, so a probe process can never match itself and
// unrelated node/powershell hosts (including the agent's own host) are never
// mistaken for a running client.

const CLIENT_EXE_NAMES = new Set([
  'deepseek harness personal.exe',
  'deepseek harness personal dev.exe',
])

function clientReference(commandLine) {
  const folded = String(commandLine ?? '').toLocaleLowerCase('en-US')
  return folded.includes('deepseek harness personal')
    || folded.includes('runtime-stable')
    || folded.includes('runtime-test')
}

/**
 * @param {Array<{pid?: number|string, name?: string, commandLine?: string}>} rows
 * @param {{excludePids?: number[]}} options PIDs to exclude (the caller's own
 *   process tree, e.g. the electron-as-node host running this very script).
 * @returns {number[]} PIDs of running personal desktop clients.
 */
export function findRunningClientPids(rows, options = {}) {
  if (!Array.isArray(rows)) return []
  const excluded = new Set((options.excludePids ?? []).map((pid) => Number(pid)))
  return rows
    .filter((row) => row !== null && typeof row === 'object')
    .filter((row) => {
      const name = String(row.name ?? '').toLocaleLowerCase('en-US')
      if (CLIENT_EXE_NAMES.has(name)) return true
      return name === 'electron.exe' && clientReference(row.commandLine)
    })
    .map((row) => Number(row.pid))
    .filter((pid) => Number.isSafeInteger(pid) && pid > 0)
    .filter((pid) => !excluded.has(pid))
}
