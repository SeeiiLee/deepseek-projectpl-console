import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createWindowsTerminalSpawner, TerminalManager } from '../lib/index.js'

if (process.platform !== 'win32') {
  process.stdout.write('SKIP: real PowerShell smoke is Windows-only.\n')
  process.exit(0)
}

const sourceRoot = resolve(process.env.DSH_SOURCE_ROOT || 'D:\\Deepseek Harness')
const [{ Context }, { default: LocalSubprocessRuntime }] = await Promise.all([
  import(pathToFileURL(join(sourceRoot, 'vendor', 'cordis', 'lib', 'index.js')).href),
  import(pathToFileURL(join(sourceRoot, 'packages', 'subprocess', 'subprocess-local', 'lib', 'index.js')).href),
])
const workspace = await mkdtemp(join(tmpdir(), 'dsh-session-terminal-real-'))
const ctx = new Context()
const fiber = await ctx.plugin(LocalSubprocessRuntime)
const manager = new TerminalManager({
  subprocess: ctx.subprocess,
  sessions: { get: id => id === 'real-smoke' ? { header: { cwd: workspace } } : undefined },
  spawnTerminal: createWindowsTerminalSpawner({ ...process.env, DSH_SOURCE_ROOT: sourceRoot }),
})

try {
  const terminal = await manager.open('real-smoke')
  await manager.write('real-smoke', terminal.terminalId, "$global:PersonalTerminalProbe = '持久状态'")
  await manager.write('real-smoke', terminal.terminalId, 'Write-Output "中文-$global:PersonalTerminalProbe"')
  await manager.write(
    'real-smoke',
    terminal.terminalId,
    "if ($null -eq $env:DEEPSEEK_API_KEY -and $null -eq $env:DSH_SOURCE_ROOT) { Write-Output 'env-scrubbed' }",
  )
  const output = await waitForOutput(manager, terminal.terminalId, 'env-scrubbed')
  assert.match(output, /中文-持久状态/u)
  assert.equal(manager.list('real-smoke')[0]?.status.kind, 'running')
  process.stdout.write(`PASS: persistent PowerShell UTF-8 output (${terminal.pid}).\n`)
} finally {
  await manager.dispose()
  process.stdout.write('CLEANUP: terminal manager disposed.\n')
  await fiber.dispose()
  process.stdout.write('CLEANUP: subprocess provider disposed.\n')
  await rm(workspace, { recursive: true, force: true })
}

async function waitForOutput(manager, terminalId, expected) {
  const until = Date.now() + 10_000
  let cursor = 0
  let output = ''
  while (Date.now() < until) {
    const page = manager.read('real-smoke', terminalId, cursor)
    cursor = page.cursor
    output = page.truncated ? page.output : output + page.output
    if (output.includes(expected)) return output
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(`PowerShell output timeout; retained output: ${JSON.stringify(output)}`)
}
