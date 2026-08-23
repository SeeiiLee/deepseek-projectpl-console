import type { WorkbenchDetailsCommand } from './contracts.ts'

export type DetailsRouteDecision =
  | { action: 'dismiss'; nextRevision: number }
  | { action: 'ignore'; nextRevision: number }
  | { action: 'select'; nextRevision: number }

/** Interpret Personal Shell's monotonic Details command stream exactly once. */
export function decideDetailsRoute(command: WorkbenchDetailsCommand, lastRevision: number): DetailsRouteDecision {
  if (!Number.isSafeInteger(command.revision) || command.revision < 0) {
    return { action: 'dismiss', nextRevision: lastRevision }
  }
  if (command.revision === lastRevision) return { action: 'ignore', nextRevision: lastRevision }
  return {
    action: command.kind === 'open' ? 'select' : 'dismiss',
    nextRevision: command.revision,
  }
}
