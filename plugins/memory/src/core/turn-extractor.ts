// P3-2 轮末提取管线：订阅 session/event（user/message、assistant/message、turn/end），
// 轮末 fire-and-forget 提取候选。与 index.ts 解耦（结构类型 + 依赖注入），可独立单测。
// 红线：任何一步失败只吞错返回，绝不打断会话；子代理会话不提取（试点有界）；暂停态直接跳过。
import {
  EXTRACTOR_VERSION,
  buildExtractionContext,
  extractCandidates,
  extractionGate,
  type ExtractionConnection,
} from './extractor.ts'

export const MAX_TRACKED_SESSIONS = 64

/** 结构子集：MemoryService.record/isPaused（无需导入 service 实现）。 */
export interface RecordServiceLike {
  record(input: {
    kind: string
    text: string
    scope: string
    projectId?: string | undefined
    confirm?: boolean | undefined
    evidence?: string | undefined
    evidenceKind?: string | undefined
    idempotencyKey?: string | undefined
  }): string
  isPaused(): boolean
}

export interface ExtractionRuntimeLike {
  findConnection(): Promise<ExtractionConnection | null>
}

export interface TurnExtractorDeps {
  service: RecordServiceLike
  /** 懒加载运行时：首次轮末才 import personal-foundation 与读取连接。 */
  runtime(): Promise<ExtractionRuntimeLike>
  /** 会话 ↔ 项目绑定表（Project Control 控制台经桥写入）。 */
  bindings: ReadonlyMap<string, string | undefined>
  model: string
  maxContextChars: number
  timeoutMs: number
  /** 测试注入：把假 fetch 传进 extractCandidates。 */
  fetchImpl?: typeof fetch
  /** true = 提取请求显式关思考（官方最低强度）。 */
  disableThinking?: boolean
  /** 每轮提取结果回调（观测/诊断用；生产挂到 memory_status 统计与日志）。 */
  onOutcome?: (outcome: TurnExtractionOutcome) => void
}

/** 一轮轮末提取的最终去向（只报告，不改变行为）。 */
export interface TurnExtractionOutcome {
  kind: 'paused' | 'gate-skip' | 'no-connection' | 'ok' | 'failed'
  detail: string
}

/** 会话事件结构子集（真实类型见 core/session SessionEvent）。 */
export interface TurnEventLike {
  type?: string
  data?: {
    turn?: unknown
    reason?: { kind?: unknown }
    message?: { content?: unknown }
    source?: { kind?: unknown }
    content?: unknown
  }
}

export interface AgentSessionLike {
  header?: { id?: unknown; delegationDepth?: unknown }
}

interface TurnBuffer {
  userText: string
  assistantText: string
}

function blocksText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return ''
  const parts: string[] = []
  for (const block of blocks) {
    if (block === null || typeof block !== 'object') continue
    const record = block as { type?: unknown; text?: unknown }
    if (record.type === 'text' && typeof record.text === 'string') parts.push(record.text)
  }
  return parts.join('\n').trim()
}

function topLevelSession(session: AgentSessionLike): boolean {
  const depth = session.header?.delegationDepth
  return !(typeof depth === 'number' && depth > 0)
}

/**
 * 订阅适配器：把 (session, event) 流折叠成每轮一份 {userText, assistantText}，
 * 在 turn/end（reason=completed）触发一次有界提取。所有异步工作在后台完成。
 */
export function createTurnEndExtractor(deps: TurnExtractorDeps): {
  onEvent(session: AgentSessionLike, event: TurnEventLike): void
  /** 测试/关闭用：等待所有在途提取任务落定（生产不调用）。 */
  flush(): Promise<void>
} {
  const buffers = new Map<string, TurnBuffer>()
  const inflight = new Set<Promise<void>>()

  const onEvent = (session: AgentSessionLike, event: TurnEventLike): void => {
    const sessionId = typeof session.header?.id === 'string' && session.header.id !== '' ? session.header.id : ''
    if (sessionId === '' || !topLevelSession(session)) return
    if (event.type === 'user/message') {
      // 只收直接人类输入；quick-pass/skill 注入等 plugin 来源不入提取上下文。
      if (event.data?.source?.kind !== 'user') return
      const text = blocksText(event.data?.content)
      if (text === '') return
      const buffer = buffers.get(sessionId)
      if (buffer === undefined) {
        if (buffers.size >= MAX_TRACKED_SESSIONS) {
          const first = buffers.keys().next().value
          if (first !== undefined) buffers.delete(first)
        }
        buffers.set(sessionId, { userText: text, assistantText: '' })
      } else {
        buffer.userText = buffer.userText === '' ? text : buffer.userText + '\n' + text
      }
      return
    }
    if (event.type === 'assistant/message') {
      const text = blocksText(event.data?.message?.content)
      if (text === '') return
      const buffer = buffers.get(sessionId)
      if (buffer !== undefined) buffer.assistantText = text // 多步轮：最后一步的最终回复胜出
      return
    }
    if (event.type === 'turn/end') {
      const buffer = buffers.get(sessionId)
      if (buffer === undefined) return
      buffers.delete(sessionId)
      if (event.data?.reason?.kind !== 'completed') return // 报错/中止轮不提取
      const turn = Number(event.data?.turn ?? 0)
      const task = runTurnExtraction(sessionId, turn, buffer)
      inflight.add(task)
      void task.finally(() => { inflight.delete(task) })
    }
  }

  async function runTurnExtraction(sessionId: string, turn: number, buffer: TurnBuffer): Promise<void> {
    const outcome = (outcome: TurnExtractionOutcome): void => { deps.onOutcome?.(outcome) }
    try {
      if (deps.service.isPaused()) {
        outcome({ kind: 'paused', detail: 'memory_pause 暂停中' })
        return
      }
      if (!extractionGate(buffer.userText, buffer.assistantText)) {
        outcome({ kind: 'gate-skip', detail: '需求门未通过（回复过短或无教训/修复/约定信号）' })
        return
      }
      const projectId = deps.bindings.get(sessionId)
      const connection = await deps.runtime().then((runtime) => runtime.findConnection())
      if (connection === null) {
        outcome({ kind: 'no-connection', detail: '无「记忆提取」连接且无官方密钥回退（DEEPSEEK_API_KEY）' })
        return
      }
      const context = buildExtractionContext(buffer.userText, buffer.assistantText, deps.maxContextChars)
      const output = await extractCandidates(
        {
          endpoint: connection.endpoint,
          apiKey: connection.apiKey,
          model: deps.model,
          context,
          projectId,
          ...(deps.disableThinking === true ? { disableThinking: true } : {}),
        },
        { timeoutMs: deps.timeoutMs, ...(deps.fetchImpl === undefined ? {} : { fetchImpl: deps.fetchImpl }) },
      )
      let written = 0
      let index = 0
      for (const candidate of output.candidates) {
        index += 1
        const message = deps.service.record({
          kind: candidate.kind,
          text: candidate.text,
          scope: candidate.scope,
          projectId: candidate.scope === 'project' ? projectId : undefined,
          confirm: false,
          evidence: 'session://' + sessionId + '#' + String(turn),
          evidenceKind: 'session',
          // 幂等键 = project|session|turn|extractor_version|candidate_index（与手册 9.5-B 一致）
          idempotencyKey: [projectId ?? 'global', sessionId, String(turn), EXTRACTOR_VERSION, String(index)].join('|'),
        })
        if (!message.includes('幂等键已存在')) written += 1
      }
      outcome({ kind: 'ok', detail: '写入 ' + String(written) + ' 条候选（模型 ' + output.model + '，连接 ' + connection.label + '）' })
    } catch (error) {
      // 提取失败绝不打断会话；只留观测（宿主侧日志 + memory_status 统计）。
      outcome({ kind: 'failed', detail: '提取失败：' + (error instanceof Error && error.message !== '' ? error.message : String(error)) })
    }
  }

  const flush = async (): Promise<void> => {
    while (inflight.size > 0) {
      await Promise.allSettled([...inflight])
    }
  }

  return { onEvent, flush }
}
