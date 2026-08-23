import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { SessionMinimap, type SessionMinimapInjected } from './SessionMinimap.tsx'

export const inject = ['slots', 'sessions']

/** Register an additive root overlay; upstream layout, conversation and trajectory remain owners. */
export function apply(ctx: ClientContext): void {
  const injected = (): SessionMinimapInjected => ({
    resolveSession: (sessionId: SessionId) => ctx.sessions.binding(sessionId)?.session,
  })
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'personal-session-minimap',
    order: 60,
    inject: injected,
  }, SessionMinimap))
}

export { deriveTrajectoryIsland } from './model.ts'
export type {
  IslandSignal, IslandSignalKind, IslandTurn, IslandTurnStatus, TrajectoryIslandSource,
} from './model.ts'
