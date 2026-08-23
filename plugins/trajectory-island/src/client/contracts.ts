import type {
  ConversationLocation, ConversationNode, ConversationPromptSnapshot,
  ConversationSnapshot, PartialAssistant, RequestView, RunningToolCall,
} from '@deepseek-ai/dsh-client-runtime/client'

/** rc.5 view projection populated by the installed upstream ui-trajectory plugin. */
export interface TrajectorySnapshot {
  readonly eventNodes: readonly ConversationNode[]
  readonly eventLocations: ReadonlyMap<number, ConversationLocation>
  readonly requests: readonly RequestView[]
  readonly callSchemas: ReadonlyMap<string, ConversationPromptSnapshot['tools'][number]>
  readonly partial: PartialAssistant | null
  readonly runningCalls: readonly RunningToolCall[]
}

export function trajectoryOf(snapshot: ConversationSnapshot): TrajectorySnapshot | undefined {
  const views = snapshot.views as unknown as { get(target: string): unknown }
  return views.get('trajectory') as TrajectorySnapshot | undefined
}
