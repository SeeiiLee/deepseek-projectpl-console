import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { SessionTerminalDock, type SessionTerminalDockInjected } from './SessionTerminalDock.tsx'
import { createSessionTerminalApi } from './terminalApi.ts'

export const inject = ['slots']

/** Register the session terminal as an additive frame overlay. */
export function apply(ctx: ClientContext): void {
  const api = createSessionTerminalApi()
  const injected = (): SessionTerminalDockInjected => ({ api })
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'personal-session-terminal',
    order: 80,
    inject: injected,
  }, SessionTerminalDock))
}

export type { SessionTerminalApi, TerminalReadResult, TerminalSnapshot, TerminalStatus } from './terminalApi.ts'
