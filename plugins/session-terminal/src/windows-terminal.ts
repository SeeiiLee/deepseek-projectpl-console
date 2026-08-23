import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { PassThrough } from 'node:stream'
import type { TerminalHandleLike, TerminalOutcome, TerminalSpawnSpec } from './terminal-runtime.ts'

interface NodePtyDisposable { dispose(): void }
interface NodePtyProcess {
  readonly pid: number
  onData(listener: (data: string) => void): NodePtyDisposable
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): NodePtyDisposable
  write(data: string): void
  kill(signal?: string): void
}
interface NodePtyModule {
  spawn(file: string, args: string[], options: {
    name: string
    rows: number
    cols: number
    cwd: string
    env: Record<string, string>
  }): NodePtyProcess
}

/** Create the Windows-only ConPTY adapter used while the upstream inspector rejects win32. */
export function createWindowsTerminalSpawner(env: NodeJS.ProcessEnv = process.env) {
  let nodePty: NodePtyModule | undefined
  return async (spec: TerminalSpawnSpec): Promise<TerminalHandleLike> => {
    if (process.platform !== 'win32') throw new Error('the personal Windows terminal adapter requires win32')
    const file = spec.argv[0]
    if (file === undefined || file === '') throw new Error('terminal argv must contain PowerShell')
    nodePty ??= loadNodePty(env)
    const terminal = nodePty.spawn(file, [...spec.argv.slice(1)], {
      name: 'xterm-256color',
      rows: spec.rows,
      cols: spec.cols,
      cwd: spec.cwd,
      env: scrubbedChildEnv(spec.env, env),
    })
    return new WindowsTerminalHandle(terminal, spec.graceMs)
  }
}

/** node-pty handle with bounded-wait, exact-tree termination for one owned tab. */
class WindowsTerminalHandle implements TerminalHandleLike {
  readonly pid: number
  readonly output = new PassThrough()
  readonly done: Promise<TerminalOutcome>
  private readonly completion = Promise.withResolvers<TerminalOutcome>()
  private readonly dataDisposable: NodePtyDisposable
  private readonly exitDisposable: NodePtyDisposable
  private cleanup: Promise<void> | undefined
  private exited = false

  constructor(private readonly terminal: NodePtyProcess, private readonly graceMs: number) {
    this.pid = terminal.pid
    this.done = this.completion.promise
    this.dataDisposable = terminal.onData(data => { this.output.write(Buffer.from(data, 'utf8')) })
    this.exitDisposable = terminal.onExit(({ exitCode, signal }) => {
      if (this.exited) return
      this.exited = true
      this.output.end()
      this.completion.resolve({ exitCode: signal === undefined || signal === 0 ? exitCode : null, signal: signalName(signal) })
    })
  }

  async write(data: string): Promise<void> {
    if (this.exited) throw new Error('terminal process has exited')
    this.terminal.write(data)
  }

  async signalForeground(signal: 'SIGINT'): Promise<number> {
    if (signal !== 'SIGINT') throw new Error(`unsupported Windows terminal signal: ${signal}`)
    if (this.exited) throw new Error('terminal process has exited')
    this.terminal.write('\u0003')
    return this.pid
  }

  terminate(): Promise<void> {
    this.cleanup ??= this.closeOnce()
    return this.cleanup
  }

  private async closeOnce(): Promise<void> {
    if (!this.exited) {
      try {
        // node-pty closes the ConPTY handles and kills its console process
        // list while the shell identity is still valid.
        this.terminal.kill()
      } catch (_ptyAlreadyExited) {
        // The exit callback remains authoritative for a close race.
      }
      await Promise.race([this.done.then(() => undefined), delay(this.graceMs)])
    }
    if (!this.exited) {
      await taskkillTree(this.pid)
      await Promise.race([this.done.then(() => undefined), delay(this.graceMs)])
    }
    if (!this.exited) throw new Error(`PowerShell cleanup failed; surviving pid: ${this.pid}`)
    this.dataDisposable.dispose()
    this.exitDisposable.dispose()
  }
}

function loadNodePty(env: NodeJS.ProcessEnv): NodePtyModule {
  const dshHome = resolve(env.DSH_HOME || join(homedir(), '.dsh'))
  const profileRequire = createRequire(join(dshHome, 'profiles', 'web', 'package.json'))
  const manifests: string[] = []
  try {
    manifests.push(profileRequire.resolve('@deepseek-ai/dsh-subprocess-local/package.json'))
  } catch (_profilePackageUnavailable) {
    // Source-root resolution below covers development before profile linking.
  }
  if (typeof env.DSH_SOURCE_ROOT === 'string' && env.DSH_SOURCE_ROOT !== '') {
    manifests.push(join(resolve(env.DSH_SOURCE_ROOT), 'packages', 'subprocess', 'subprocess-local', 'package.json'))
  }
  manifests.push('D:\\Deepseek Harness\\packages\\subprocess\\subprocess-local\\package.json')
  for (const manifest of [...new Set(manifests)]) {
    try {
      return createRequire(manifest)('node-pty') as NodePtyModule
    } catch (_nodePtyUnavailableAtCandidate) {
      // Continue through profile, configured source, and the personal default checkout.
    }
  }
  throw new Error('Harness subprocess-local 的 node-pty 依赖不可用；请先在上游目录执行 pnpm install。')
}

/** Mirror the upstream subprocess environment scrub without importing a second runtime instance. */
function scrubbedChildEnv(extra: Record<string, string>, parent: NodeJS.ProcessEnv): Record<string, string> {
  const entries: Array<[string, string]> = []
  for (const [key, value] of Object.entries(parent)) {
    if (value === undefined || /KEY|PASSWORD|SECRET|TOKEN/iu.test(key) || key.toUpperCase().startsWith('DSH_')) continue
    entries.push([key, value])
  }
  for (const [key, value] of Object.entries(extra)) {
    const normalized = key.toUpperCase()
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      if (entries[index]?.[0].toUpperCase() === normalized) entries.splice(index, 1)
    }
    entries.push([key, value])
  }
  return Object.fromEntries(entries)
}

function taskkillTree(pid: number): Promise<void> {
  if (!Number.isSafeInteger(pid) || pid <= 0) return Promise.reject(new Error('invalid PowerShell pid'))
  return new Promise(resolvePromise => {
    execFile('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => { resolvePromise() })
  })
}

function signalName(signal: number | undefined): string | null {
  return signal === undefined || signal === 0 ? null : `SIGNAL_${signal}`
}

function delay(ms: number): Promise<void> {
  return new Promise(resolvePromise => setTimeout(resolvePromise, ms))
}
