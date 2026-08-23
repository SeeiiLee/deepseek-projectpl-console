import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { PROTECTED_ROOTS } from './protected-paths.js'

/**
 * Identify smoke-run processes by OBSERVED MARKERS ONLY — the renamed
 * "-Smoke.exe" image name or a command line carrying the smoke temp
 * user-data marker. Real client processes never carry either marker, so
 * the name-based wildcard mistake that killed a live client is impossible
 * here; kills themselves remain PID-based (taskkill /T /F on each match).
 * @param {readonly {pid?: unknown, name?: unknown, commandLine?: unknown}[]} rows
 * @returns {number[]} PIDs belonging to smoke instances.
 */
export function selectSmokePids(rows) {
  const pids = []
  for (const row of rows) {
    const pid = row?.pid
    if (!Number.isSafeInteger(pid) || pid <= 0) continue
    const name = typeof row?.name === 'string' ? row.name : ''
    const commandLine = typeof row?.commandLine === 'string' ? row.commandLine : ''
    // Cyrus 红线：命令行一旦引用稳定版/用户数据路径，无论标记如何都绝不选中。
    const touchesProtectedRoot = PROTECTED_ROOTS.some(root =>
      commandLine.toLowerCase().includes(root.toLowerCase()))
    if (touchesProtectedRoot) continue
    if (name.endsWith('-Smoke.exe') || commandLine.includes('dsh-desktop-smoke-')) {
      pids.push(pid)
    }
  }
  return pids
}

export function collectProcessRows() {
  const probe = spawnSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    'Get-CimInstance Win32_Process | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress',
  ], { encoding: 'utf8', windowsHide: true, timeout: 20_000 })
  if (probe.status !== 0) return null
  try {
    const parsed = JSON.parse(String(probe.stdout ?? '').trim() || '[]')
    const list = Array.isArray(parsed) ? parsed : parsed === null ? [] : [parsed]
    return list.map((row) => ({ pid: row?.ProcessId, name: row?.Name, commandLine: row?.CommandLine }))
  } catch {
    return null
  }
}

export function terminatePidTrees(pids) {
  const results = []
  for (const pid of pids) {
    const kill = spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true, encoding: 'utf8', timeout: 10_000,
    })
    results.push({ pid, status: kill.status, output: String(kill.stdout ?? kill.stderr ?? '').trim().split(/\r?\n/u)[0] ?? '' })
  }
  return results
}

if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const rows = collectProcessRows()
  if (rows === null) {
    process.stderr.write('smoke orphan cleanup: process probe failed; nothing was killed.\n')
    process.exit(3)
  }
  const pids = selectSmokePids(rows)
  if (pids.length === 0) {
    process.stdout.write('smoke orphan cleanup: no smoke-marked processes found; nothing was killed.\n')
    process.exit(0)
  }
  const results = terminatePidTrees(pids)
  for (const result of results) {
    process.stdout.write(`killed smoke PID ${String(result.pid)} (status ${String(result.status)}): ${result.output}\n`)
  }
  process.exit(0)
}