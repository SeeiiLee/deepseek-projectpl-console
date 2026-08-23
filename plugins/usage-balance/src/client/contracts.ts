import type {
  ConversationLocation, ConversationNode, ConversationPromptSnapshot,
  ConversationSnapshot, PartialAssistant, RequestView, RunningToolCall,
} from '@deepseek-ai/dsh-client-runtime/client'

/** rc.5 client projection contract contributed by the installed upstream trajectory plugin. */
export interface TrajectorySnapshot {
  readonly eventNodes: readonly ConversationNode[]
  readonly eventLocations: ReadonlyMap<number, ConversationLocation>
  readonly requests: readonly RequestView[]
  readonly callSchemas: ReadonlyMap<string, ConversationPromptSnapshot['tools'][number]>
  readonly partial: PartialAssistant | null
  readonly runningCalls: readonly RunningToolCall[]
}

export interface TokenUsageProjection {
  uncachedInputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

export interface ContextPressureProjection {
  pressureTokens?: number
  projectedTokens?: number
  contextWindow?: number
}

export interface ContextBreakdownProjection {
  systemTokens: number
  toolsTokens: number
  messageTokens: number
}

export interface PersonalProjectionMap {
  tokenUsage: TokenUsageProjection
  contextPressure: ContextPressureProjection
  contextBreakdown: ContextBreakdownProjection
}

export type PersonalProjectionReader = <Key extends keyof PersonalProjectionMap>(
  key: Key,
) => PersonalProjectionMap[Key] | undefined

export function trajectoryOf(snapshot: ConversationSnapshot): TrajectorySnapshot | undefined {
  const views = snapshot.views as unknown as { get(target: string): unknown }
  return views.get('trajectory') as TrajectorySnapshot | undefined
}
