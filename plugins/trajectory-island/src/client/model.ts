export type IslandTurnStatus = 'running' | 'error' | 'complete' | 'unknown'
export type IslandSignalKind =
  | 'user' | 'assistant' | 'tool' | 'retry' | 'error' | 'compaction' | 'command' | 'context' | 'request'

export interface IslandNode {
  key: string
  kind: string
  visibility?: 'visible' | 'hidden'
  anchorSeq?: number
}

export interface IslandRequest {
  turn: number
  status: 'running' | 'complete' | 'error'
}

export interface TrajectoryIslandSource {
  turnOrder: readonly number[]
  turnStatus(turn: number): 'open' | 'closed' | 'unknown' | undefined
  nodeKeys(turn: number): readonly string[]
  node(key: string): IslandNode | undefined
  requests: readonly IslandRequest[]
  runningToolTurns: readonly number[]
}

export interface IslandSignal {
  kind: IslandSignalKind
  status: 'running' | 'error' | 'complete'
  label: string
}

export interface IslandTurn {
  turn: number
  status: IslandTurnStatus
  anchorKey?: string
  anchorSeq?: number
  signals: readonly IslandSignal[]
}

const SIGNALS: Record<string, { kind: IslandSignalKind; label: string }> = {
  user: { kind: 'user', label: '问' },
  steering: { kind: 'user', label: '续' },
  assistant: { kind: 'assistant', label: '答' },
  'tool-call': { kind: 'tool', label: '工' },
  'model-retry': { kind: 'retry', label: '重' },
  'turn-error': { kind: 'error', label: '错' },
  'turn-max-tokens': { kind: 'error', label: '限' },
  compaction: { kind: 'compaction', label: '压' },
  'manual-compaction': { kind: 'compaction', label: '压' },
  command: { kind: 'command', label: '令' },
  context: { kind: 'context', label: '境' },
}

function nodeSignal(node: IslandNode): IslandSignal | undefined {
  const signal = SIGNALS[node.kind]
  if (signal === undefined) return undefined
  return {
    ...signal,
    status: signal.kind === 'error' ? 'error' : 'complete',
  }
}

function distinctSignals(signals: readonly IslandSignal[]): IslandSignal[] {
  const seen = new Set<string>()
  return signals.filter((signal) => {
    const key = `${signal.kind}:${signal.status}:${signal.label}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Fold upstream chat anchors plus trajectory request state into one compact per-turn rail. */
export function deriveTrajectoryIsland(source: TrajectoryIslandSource): readonly IslandTurn[] {
  const order = [...source.turnOrder]
  const known = new Set(order)
  const extras = new Set<number>()
  for (const request of source.requests) if (!known.has(request.turn)) extras.add(request.turn)
  for (const turn of source.runningToolTurns) if (!known.has(turn)) extras.add(turn)
  order.push(...[...extras].sort((left, right) => left - right))

  return order.map((turn): IslandTurn => {
    const keys = source.nodeKeys(turn)
    const nodes = keys.flatMap((key) => {
      const value = source.node(key)
      return value === undefined ? [] : [value]
    })
    const visible = nodes.filter(node => node.visibility !== 'hidden')
    const preferred = visible.find(node => node.kind === 'user' || node.kind === 'steering') ?? visible[0]
    const requests = source.requests.filter(request => request.turn === turn)
    const toolRunning = source.runningToolTurns.includes(turn)
    const signals = distinctSignals([
      ...visible.flatMap(node => {
        const signal = nodeSignal(node)
        return signal === undefined ? [] : [signal]
      }),
      ...requests.filter(request => request.status === 'running').map((): IslandSignal => ({
        kind: 'request', status: 'running', label: '模',
      })),
      ...requests.filter(request => request.status === 'error').map((): IslandSignal => ({
        kind: 'error', status: 'error', label: '错',
      })),
      ...(toolRunning ? [{ kind: 'tool', status: 'running', label: '工' } as const] : []),
    ])
    const terminalRequest = requests.at(-1)
    const error = visible.some(node => node.kind === 'turn-error' || node.kind === 'turn-max-tokens')
      || terminalRequest?.status === 'error'
    const running = signals.some(signal => signal.status === 'running') || source.turnStatus(turn) === 'open'
    const status: IslandTurnStatus = error
      ? 'error'
      : running ? 'running'
        : source.turnStatus(turn) === 'closed' ? 'complete' : 'unknown'
    return {
      turn,
      status,
      ...(preferred === undefined ? {} : { anchorKey: preferred.key }),
      ...(preferred?.anchorSeq === undefined ? {} : { anchorSeq: preferred.anchorSeq }),
      signals,
    }
  })
}
