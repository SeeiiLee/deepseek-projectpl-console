import type { IncomingMessage, ServerResponse } from 'node:http'
import { createTerminalRequestHandler, TERMINAL_API_PREFIX } from './http.ts'
import { TerminalManager, type SessionsLike, type SubprocessLike } from './terminal-runtime.ts'
import { createWindowsTerminalSpawner } from './windows-terminal.ts'

interface WebServerLike {
  register(route: {
    kind: 'prefix'
    path: string
    handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
  }): () => void
}

interface HostContextLike {
  webServer: WebServerLike
  subprocess: SubprocessLike
  sessions: SessionsLike
  effect(factory: () => (() => void | Promise<void>) | void, label?: string): void
}

/** Required Harness services for the isolated PowerShell Host. */
export const inject = ['webServer', 'subprocess', 'sessions']

/** Register the terminal API and ensure every PTY is joined during plugin teardown. */
export function apply(ctx: HostContextLike): void {
  const manager = new TerminalManager({
    subprocess: ctx.subprocess,
    sessions: ctx.sessions,
    ...(process.platform === 'win32' ? { spawnTerminal: createWindowsTerminalSpawner() } : {}),
  })
  const handler = createTerminalRequestHandler(manager)
  ctx.effect(() => {
    const unregister = ctx.webServer.register({ kind: 'prefix', path: TERMINAL_API_PREFIX, handler })
    return async () => {
      unregister()
      await manager.dispose()
    }
  }, 'personal session terminal API and PTY lifecycle')
}

export { createTerminalRequestHandler, MAX_BODY_BYTES, TERMINAL_API_PREFIX } from './http.ts'
export {
  MAX_HISTORY_CHARS,
  MAX_HISTORY_ITEMS,
  MAX_INPUT_CHARS,
  MAX_OUTPUT_CHARS,
  MAX_TABS_PER_SESSION,
  MAX_TABS_TOTAL,
  OutputRing,
  PlainTerminalDecoder,
  TerminalManager,
  terminalError,
} from './terminal-runtime.ts'
export { createWindowsTerminalSpawner } from './windows-terminal.ts'
export type {
  SessionsLike,
  SubprocessLike,
  TerminalHandleLike,
  TerminalManagerOptions,
  TerminalReadResult,
  TerminalSnapshot,
  TerminalSpawnSpec,
  TerminalStatus,
} from './terminal-runtime.ts'
