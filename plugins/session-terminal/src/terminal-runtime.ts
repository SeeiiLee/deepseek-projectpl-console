import { StringDecoder } from 'node:string_decoder'
import { isAbsolute, join } from 'node:path'
import { stat } from 'node:fs/promises'
import type { Readable } from 'node:stream'

export const MAX_TABS_PER_SESSION = 8
export const MAX_TABS_TOTAL = 32
export const MAX_OUTPUT_CHARS = 1_048_576
export const MAX_HISTORY_CHARS = 65_536
export const MAX_HISTORY_ITEMS = 200
export const MAX_INPUT_CHARS = 16_384

export type TerminalStatus =
  | { kind: 'running' }
  | { kind: 'exited'; exitCode: number | null; signal: string | null }
  | { kind: 'failed'; message: string }

export interface TerminalOutcome {
  exitCode: number | null
  signal: string | null
}

export interface TerminalHandleLike {
  readonly pid: number
  readonly output: Pick<Readable, 'on' | 'off'>
  readonly done: Promise<TerminalOutcome>
  write(data: string): Promise<void>
  signalForeground(signal: 'SIGINT'): Promise<number>
  terminate(): Promise<void>
}

export interface TerminalSpawnSpec {
  argv: readonly string[]
  cwd: string
  env: Record<string, string>
  rows: number
  cols: number
  graceMs: number
}

export interface SubprocessLike {
  resolveExecutable(command: string): Promise<string>
  spawnTerminal(spec: TerminalSpawnSpec): Promise<TerminalHandleLike>
}

export interface SessionLike {
  readonly id?: unknown
  readonly header: { readonly cwd?: unknown }
}

export interface SessionsLike {
  get(id: unknown): SessionLike | undefined
}

export interface TerminalManagerOptions {
  subprocess: SubprocessLike
  sessions: SessionsLike
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  now?: () => number
  makeId?: () => string
  /** Windows rc.5 fallback: upstream local PTY inspection rejects win32 before allocation. */
  spawnTerminal?: (spec: TerminalSpawnSpec) => Promise<TerminalHandleLike>
}

export interface TerminalSnapshot {
  terminalId: string
  sessionId: string
  name: string
  cwd: string
  pid?: number
  createdAt: number
  status: TerminalStatus
  cursor: number
  history: readonly string[]
}

export interface TerminalReadResult {
  terminal: TerminalSnapshot
  output: string
  cursor: number
  truncated: boolean
}

interface OutputChunk {
  cursor: number
  text: string
}

/** Bounded text log with monotonically increasing reconnect cursors. */
export class OutputRing {
  private readonly chunks: OutputChunk[] = []
  private totalChars = 0
  private nextCursor = 0
  private floorCursor = 0
  private partialCursor: number | undefined

  constructor(private readonly maxChars = MAX_OUTPUT_CHARS) {
    if (!Number.isInteger(maxChars) || maxChars < 1) throw new Error('output bound must be a positive integer')
  }

  get cursor(): number { return this.nextCursor }

  append(value: string): void {
    if (value.length === 0) return
    const oversized = value.length > this.maxChars
    const text = oversized ? value.slice(-this.maxChars) : value
    const cursor = ++this.nextCursor
    if (oversized) this.partialCursor = cursor
    this.chunks.push({ cursor, text })
    this.totalChars += text.length
    while (this.totalChars > this.maxChars && this.chunks.length > 0) {
      const removed = this.chunks.shift()!
      this.totalChars -= removed.text.length
      this.floorCursor = removed.cursor
      if (this.partialCursor === removed.cursor) this.partialCursor = undefined
    }
  }

  clear(): number {
    this.chunks.length = 0
    this.totalChars = 0
    this.floorCursor = this.nextCursor
    this.partialCursor = undefined
    return this.nextCursor
  }

  read(afterCursor: number): { output: string; cursor: number; truncated: boolean } {
    const requested = Number.isSafeInteger(afterCursor) && afterCursor >= 0 ? afterCursor : 0
    const truncated = requested < this.floorCursor
      || (this.partialCursor !== undefined && requested < this.partialCursor)
    const effective = truncated ? this.floorCursor : requested
    return {
      output: this.chunks.filter(chunk => chunk.cursor > effective).map(chunk => chunk.text).join(''),
      cursor: this.nextCursor,
      truncated,
    }
  }
}

/** Stateful VT-control remover that preserves split UTF-8 and CRLF boundaries. */
export class PlainTerminalDecoder {
  private readonly decoder = new StringDecoder('utf8')
  private mode: 'text' | 'escape' | 'csi' | 'osc' | 'osc-escape' = 'text'
  private pendingCarriageReturn = false

  write(chunk: string | Uint8Array): string {
    const text = typeof chunk === 'string' ? chunk : this.decoder.write(Buffer.from(chunk))
    return this.consume(text)
  }

  end(): string {
    const decoded = this.consume(this.decoder.end())
    if (!this.pendingCarriageReturn) return decoded
    this.pendingCarriageReturn = false
    return decoded + '\n'
  }

  private consume(text: string): string {
    let output = ''
    for (const character of text) {
      if (this.mode === 'escape') {
        if (character === '[') this.mode = 'csi'
        else if (character === ']') this.mode = 'osc'
        else this.mode = 'text'
        continue
      }
      if (this.mode === 'csi') {
        if (character >= '@' && character <= '~') this.mode = 'text'
        continue
      }
      if (this.mode === 'osc') {
        if (character === '\u0007') this.mode = 'text'
        else if (character === '\u001b') this.mode = 'osc-escape'
        continue
      }
      if (this.mode === 'osc-escape') {
        this.mode = character === '\\' ? 'text' : 'osc'
        continue
      }
      if (character === '\u001b') {
        this.mode = 'escape'
        continue
      }
      if (this.pendingCarriageReturn) {
        output += '\n'
        this.pendingCarriageReturn = false
        if (character === '\n') continue
      }
      if (character === '\r') {
        this.pendingCarriageReturn = true
        continue
      }
      if (character === '\n' || character === '\t' || character >= ' ') output += character
    }
    return output
  }
}

class BoundedHistory {
  private readonly values: string[] = []
  private totalChars = 0

  add(value: string): void {
    const normalized = value.trimEnd()
    if (normalized.trim().length === 0) return
    if (this.values.at(-1) === normalized) return
    const accepted = normalized.slice(0, MAX_INPUT_CHARS)
    this.values.push(accepted)
    this.totalChars += accepted.length
    while (this.values.length > MAX_HISTORY_ITEMS || this.totalChars > MAX_HISTORY_CHARS) {
      this.totalChars -= this.values.shift()!.length
    }
  }

  snapshot(): readonly string[] { return [...this.values] }
}

interface ManagedTerminal {
  readonly terminalId: string
  readonly sessionId: string
  readonly name: string
  readonly cwd: string
  readonly createdAt: number
  readonly history: BoundedHistory
  readonly output: OutputRing
  handle: TerminalHandleLike | undefined
  decoder: PlainTerminalDecoder | undefined
  status: TerminalStatus
  operation: Promise<void>
  generation: number
}

/** Owns PowerShell tabs independently from renderer mount and connection lifetimes. */
export class TerminalManager {
  private readonly terminals = new Map<string, ManagedTerminal>()
  private readonly openingBySession = new Map<string, number>()
  private openingTotal = 0
  private shellPath: Promise<string> | undefined
  private disposed = false
  private sequence = 0

  constructor(private readonly options: TerminalManagerOptions) {}

  list(sessionId: string): TerminalSnapshot[] {
    return [...this.terminals.values()]
      .filter(terminal => terminal.sessionId === sessionId)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(terminal => this.snapshot(terminal))
  }

  async open(sessionId: string, requestedName?: string): Promise<TerminalSnapshot> {
    this.assertActive()
    const cwd = await this.sessionCwd(sessionId)
    const count = this.list(sessionId).length + (this.openingBySession.get(sessionId) ?? 0)
    if (count >= MAX_TABS_PER_SESSION) throw terminalError('TAB_LIMIT', `每个会话最多打开 ${MAX_TABS_PER_SESSION} 个终端。`, 409)
    if (this.terminals.size + this.openingTotal >= MAX_TABS_TOTAL) throw terminalError('HOST_TAB_LIMIT', `当前应用最多打开 ${MAX_TABS_TOTAL} 个终端。`, 409)
    this.openingBySession.set(sessionId, (this.openingBySession.get(sessionId) ?? 0) + 1)
    this.openingTotal += 1
    try {
      const terminalId = this.nextId()
      const name = normalizeName(requestedName) ?? this.nextName(sessionId)
      const terminal: ManagedTerminal = {
        terminalId,
        sessionId,
        name,
        cwd,
        createdAt: (this.options.now ?? Date.now)(),
        history: new BoundedHistory(),
        output: new OutputRing(),
        handle: undefined,
        decoder: undefined,
        status: { kind: 'failed', message: 'PowerShell 尚未启动。' },
        operation: Promise.resolve(),
        generation: 0,
      }
      await this.spawnInto(terminal)
      if (this.disposed) {
        await terminal.handle?.terminate()
        throw terminalError('TERMINAL_DISPOSING', '终端服务正在关闭。', 503)
      }
      this.terminals.set(terminalId, terminal)
      return this.snapshot(terminal)
    } finally {
      this.openingTotal -= 1
      const remaining = (this.openingBySession.get(sessionId) ?? 1) - 1
      if (remaining === 0) this.openingBySession.delete(sessionId)
      else this.openingBySession.set(sessionId, remaining)
    }
  }

  read(sessionId: string, terminalId: string, cursor: number): TerminalReadResult {
    const terminal = this.owned(sessionId, terminalId)
    const page = terminal.output.read(cursor)
    return { terminal: this.snapshot(terminal), ...page }
  }

  async write(sessionId: string, terminalId: string, text: string, submit = true): Promise<TerminalSnapshot> {
    const terminal = this.owned(sessionId, terminalId)
    const input = normalizeInput(text)
    return this.serialized(terminal, async () => {
      const handle = this.runningHandle(terminal)
      if (submit) terminal.history.add(input)
      const terminalInput = input.replace(/\r\n|\n|\r/gu, '\r') + (submit ? '\r' : '')
      await handle.write(terminalInput)
      return this.snapshot(terminal)
    })
  }

  clear(sessionId: string, terminalId: string): { cursor: number } {
    const terminal = this.owned(sessionId, terminalId)
    return { cursor: terminal.output.clear() }
  }

  async interrupt(sessionId: string, terminalId: string): Promise<{ delivered: boolean }> {
    const terminal = this.owned(sessionId, terminalId)
    return this.serialized(terminal, async () => {
      const handle = this.runningHandle(terminal)
      await handle.signalForeground('SIGINT')
      return { delivered: true }
    })
  }

  async restart(sessionId: string, terminalId: string): Promise<TerminalSnapshot> {
    const terminal = this.owned(sessionId, terminalId)
    return this.serialized(terminal, async () => {
      const oldHandle = terminal.handle
      terminal.handle = undefined
      terminal.generation += 1
      if (oldHandle !== undefined) await oldHandle.terminate()
      terminal.output.clear()
      try {
        await this.spawnInto(terminal)
      } catch (error) {
        terminal.status = { kind: 'failed', message: safeFailure(error) }
        throw error
      }
      return this.snapshot(terminal)
    })
  }

  async close(sessionId: string, terminalId: string): Promise<{ closed: string }> {
    const terminal = this.owned(sessionId, terminalId)
    await this.serialized(terminal, async () => {
      const handle = terminal.handle
      terminal.handle = undefined
      terminal.generation += 1
      if (handle !== undefined) await handle.terminate()
      this.terminals.delete(terminalId)
    })
    return { closed: terminalId }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    const terminals = [...this.terminals.values()]
    this.terminals.clear()
    const outcomes = await Promise.allSettled(terminals.map(terminal => this.serialized(terminal, async () => {
      const handle = terminal.handle
      terminal.handle = undefined
      terminal.generation += 1
      if (handle !== undefined) await handle.terminate()
    })))
    const failures = outcomes.flatMap(outcome => outcome.status === 'rejected' ? [outcome.reason] : [])
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'session terminal cleanup failed')
  }

  private async spawnInto(terminal: ManagedTerminal): Promise<void> {
    this.assertActive()
    const executable = await (this.shellPath ??= this.resolvePowerShell())
    const generation = ++terminal.generation
    const spec: TerminalSpawnSpec = {
      argv: [executable, '-NoLogo', '-NoProfile', '-NoExit', '-Command', powerShellUtf8Bootstrap()],
      cwd: terminal.cwd,
      env: {
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
      },
      rows: 32,
      cols: 120,
      graceMs: 2_000,
    }
    const handle = this.options.spawnTerminal === undefined
      ? await this.options.subprocess.spawnTerminal(spec)
      : await this.options.spawnTerminal(spec)
    const decoder = new PlainTerminalDecoder()
    terminal.handle = handle
    terminal.decoder = decoder
    terminal.status = { kind: 'running' }
    const onData = (chunk: unknown): void => {
      if (terminal.generation !== generation || terminal.handle !== handle) return
      const plain = decoder.write(typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array))
      terminal.output.append(plain)
    }
    handle.output.on('data', onData)
    void handle.done.then(
      outcome => {
        handle.output.off('data', onData)
        if (terminal.generation !== generation || terminal.handle !== handle) return
        terminal.output.append(decoder.end())
        terminal.status = { kind: 'exited', exitCode: outcome.exitCode, signal: outcome.signal }
      },
      error => {
        handle.output.off('data', onData)
        if (terminal.generation !== generation || terminal.handle !== handle) return
        terminal.output.append(decoder.end())
        terminal.status = { kind: 'failed', message: safeFailure(error) }
      },
    )
  }

  private async sessionCwd(sessionId: string): Promise<string> {
    const session = this.options.sessions.get(sessionId)
    if (session === undefined) throw terminalError('SESSION_NOT_LIVE', '当前会话尚未在 Host 中就绪。', 409)
    const cwd = session.header.cwd
    if (typeof cwd !== 'string' || !isAbsolute(cwd)) {
      throw terminalError('SESSION_CWD_REQUIRED', '当前会话没有可用的绝对工作目录。', 409)
    }
    try {
      if (!(await stat(cwd)).isDirectory()) throw new Error('not a directory')
    } catch {
      throw terminalError('SESSION_CWD_UNAVAILABLE', '当前会话的工作目录不存在或不可访问。', 409)
    }
    return cwd
  }

  private async resolvePowerShell(): Promise<string> {
    const platform = this.options.platform ?? process.platform
    const env = this.options.env ?? process.env
    const candidates = platform === 'win32'
      ? [
          ...[env.ProgramW6432, env.ProgramFiles].filter((value): value is string => typeof value === 'string' && value !== '')
            .map(directory => join(directory, 'PowerShell', '7', 'pwsh.exe')),
          'pwsh.exe',
          'pwsh',
          ...(typeof env.SystemRoot === 'string' && env.SystemRoot !== ''
            ? [join(env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')]
            : []),
          'powershell.exe',
        ]
      : ['pwsh', 'powershell']
    for (const candidate of [...new Set(candidates)]) {
      try {
        return await this.options.subprocess.resolveExecutable(candidate)
      } catch (_candidateUnavailable) {
        // Continue through the explicit PowerShell candidate list.
      }
    }
    throw terminalError('POWERSHELL_NOT_FOUND', '没有找到可用的 PowerShell。请安装 PowerShell 7 或启用 Windows PowerShell。', 503)
  }

  private snapshot(terminal: ManagedTerminal): TerminalSnapshot {
    return {
      terminalId: terminal.terminalId,
      sessionId: terminal.sessionId,
      name: terminal.name,
      cwd: terminal.cwd,
      ...(terminal.handle === undefined ? {} : { pid: terminal.handle.pid }),
      createdAt: terminal.createdAt,
      status: terminal.status,
      cursor: terminal.output.cursor,
      history: terminal.history.snapshot(),
    }
  }

  private owned(sessionId: string, terminalId: string): ManagedTerminal {
    const terminal = this.terminals.get(terminalId)
    if (terminal === undefined || terminal.sessionId !== sessionId) {
      throw terminalError('TERMINAL_NOT_FOUND', '这个会话中不存在指定终端。', 404)
    }
    return terminal
  }

  private runningHandle(terminal: ManagedTerminal): TerminalHandleLike {
    if (terminal.handle === undefined || terminal.status.kind !== 'running') {
      throw terminalError('TERMINAL_NOT_RUNNING', 'PowerShell 当前未运行，请先重启终端。', 409)
    }
    return terminal.handle
  }

  private async serialized<T>(terminal: ManagedTerminal, operation: () => Promise<T>): Promise<T> {
    const previous = terminal.operation
    let release!: () => void
    terminal.operation = new Promise<void>(resolve => { release = resolve })
    await previous.catch(() => {})
    try {
      return await operation()
    } finally {
      release()
    }
  }

  private nextName(sessionId: string): string {
    const names = new Set(this.list(sessionId).map(terminal => terminal.name))
    let index = 1
    while (names.has(`PowerShell ${index}`)) index += 1
    return `PowerShell ${index}`
  }

  private nextId(): string {
    const generated = this.options.makeId?.()
    if (generated !== undefined && generated !== '') return generated
    return `pst-${Date.now().toString(36)}-${(++this.sequence).toString(36)}`
  }

  private assertActive(): void {
    if (this.disposed) throw terminalError('TERMINAL_DISPOSING', '终端服务正在关闭。', 503)
  }
}

export function terminalError(code: string, message: string, status = 400): Error & { code: string; status: number } {
  return Object.assign(new Error(message), { code, status })
}

function normalizeName(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const normalized = value.trim().replace(/\s+/gu, ' ')
  if (normalized.length === 0 || normalized.length > 80) throw terminalError('INVALID_TERMINAL_NAME', '终端名称长度必须为 1 到 80 个字符。')
  return normalized
}

function normalizeInput(value: string): string {
  if (typeof value !== 'string' || value.length > MAX_INPUT_CHARS || value.includes('\u0000')) {
    throw terminalError('INVALID_TERMINAL_INPUT', `终端输入必须是不含 NUL 的文本，且不超过 ${MAX_INPUT_CHARS} 个字符。`)
  }
  return value
}

function powerShellUtf8Bootstrap(): string {
  return '[Console]::InputEncoding = [Text.UTF8Encoding]::new($false); '
    + '[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); '
    + '$global:OutputEncoding = [Console]::OutputEncoding; '
    + "$ProgressPreference = 'SilentlyContinue'"
}

function safeFailure(error: unknown): string {
  return error instanceof Error && error.message.trim() !== '' ? error.message.slice(0, 300) : 'PowerShell 连接已断开。'
}
