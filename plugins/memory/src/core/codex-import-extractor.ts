// P6-0C：Codex 历史候选提取（宿主侧，凭据经插件注入；试点批次有界）。
// 契约：只产出 candidate + llm_extracted；带 codex:// locator；成本/时段/重试/断点全部有界。
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ExtractorError, extractCandidates, type ExtractionCandidate } from './extractor.ts'

export const CODEX_IMPORT_CONTRACT = 'codex-session-import/v1'
export const CODEX_IMPORT_MODEL = 'deepseek-v4-flash'
// 官方空闲时段价（2026-08-17 定价页）：缓存命中 0.05 / 未命中 1.5 / 输出 4.5（元/百万 token）
export const CODEX_IMPORT_PRICES = Object.freeze({ cacheHitIn: 0.05, missIn: 1.5, out: 4.5 })
const CHARS_PER_CALL = 4000
const PROMPT_TOKENS = 800
const MIN_CANDIDATE_CHARS = 12
const MAX_OUTPUT_CANDIDATES = 5

export interface StagingTurn {
  locator: string
  session_id: string
  rollout_id: string
  role: string
  content_hash: string
  char_length: number
  /** 源消息时间戳（turn-index 自带；作为事实时间候选）。 */
  timestamp?: string | undefined
  project_label?: string
}

export interface StagingSession {
  rollout_id: string
  session_id: string
  project_label?: string
  source_file: string
  first_at: string | null
  last_at: string | null
  turn_count: number
}

export function readStagingPackage(packageDir: string): { sessions: StagingSession[]; turns: StagingTurn[] } {
  const read = (name: string) => readFileSync(join(packageDir, name), 'utf8').trim().split(String.fromCharCode(10)).filter(l => l !== '').map((l: string) => JSON.parse(l))
  if (!existsSync(join(packageDir, 'sessions.jsonl')) || !existsSync(join(packageDir, 'turn-index.jsonl'))) {
    throw new Error('staging 包不完整：需要 sessions.jsonl 与 turn-index.jsonl（先跑 codex-import-dryrun.mjs）')
  }
  return { sessions: read('sessions.jsonl'), turns: read('turn-index.jsonl') }
}

/** locator（codex://<rollout>#<line>）→ 消息原文。按 rollout 懒读源文件并缓存；绝不复制正文到状态/日志。 */
export function locatorTextReader(packageDir: string): (locator: string) => string {
  const manifest = JSON.parse(readFileSync(join(packageDir, 'manifest.json'), 'utf8'))
  const sessions = readFileSync(join(packageDir, 'sessions.jsonl'), 'utf8').trim().split(String.fromCharCode(10)).filter(l => l !== '').map((l: string) => JSON.parse(l))
  const fileByRollout = new Map(sessions.map((s) => [s.rollout_id, s.source_file] as const))
  const cache = new Map<string, string[]>()
  return (locator) => {
    const match = /^codex:\/\/([^#]+)#(\d+)$/u.exec(locator)
    if (match === null) return ''
    const rolloutId = match[1] ?? ''
    const lineSeq = Number(match[2] ?? '')
    const rel = fileByRollout.get(rolloutId)
    if (rel === undefined) return ''
    let lines = cache.get(rolloutId)
    if (lines === undefined) {
      const full = join(manifest.sessionsRoot, rel)
      if (!existsSync(full)) { cache.set(rolloutId, []); return '' }
      lines = readFileSync(full, 'utf8').split(String.fromCharCode(10))
      cache.set(rolloutId, lines)
    }
    const line = lines[lineSeq - 1]
    if (line === undefined || line.trim() === '') return ''
    try {
      const obj = JSON.parse(line)
      const content = obj.payload?.content
      if (!Array.isArray(content)) return ''
      const parts = []
      for (const block of content) {
        const text = block?.text ?? block?.output_text ?? block?.input_text
        if (typeof text === 'string' && text !== '') parts.push(text)
      }
      return parts.join(String.fromCharCode(10))
    } catch {
      return ''
    }
  }
}

/** 试点采样：指定项目标签 + 混合采样（最新/最老/最大），确定性（同 seed 同结果）。 */
export function sampleSessions(sessions: StagingSession[], options: { projectLabel: string; count: number; seed?: number }): StagingSession[] {
  const seed = options.seed ?? 42
  let state = seed >>> 0
  const rand = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296 }
  const pool = sessions.filter(s => s.project_label === options.projectLabel && s.turn_count > 0)
  if (pool.length <= options.count) return pool
  const byLast = [...pool].sort((a, b) => (b.last_at ?? '') > (a.last_at ?? '') ? 1 : -1)
  const byFirst = [...pool].sort((a, b) => (a.first_at ?? '') > (b.first_at ?? '') ? 1 : -1)
  const bySize = [...pool].sort((a, b) => b.turn_count - a.turn_count)
  const picked = new Map<string, StagingSession>()
  const sources = [byLast, byFirst, bySize]
  let cursor = 0
  while (picked.size < options.count && sources.some(s => s.length > 0)) {
    const source = sources[cursor % sources.length]
    if (source === undefined) break
    const index = Math.floor(rand() * Math.min(source.length, Math.max(3, options.count)))
    const item = source[index]
    if (item !== undefined && !picked.has(item.rollout_id)) picked.set(item.rollout_id, item)
    cursor += 1
    if (cursor > options.count * 12) break
  }
  return [...picked.values()].sort((a, b) => (a.rollout_id < b.rollout_id ? -1 : 1))
}

/** 预筛 + 切块：单会话源码按字符预算切批；每条消息 ≥MIN 长度且内容哈希去重（跨 fork 去重靠 dry-run 的 inherited 标记）。 */
export interface BatchMessage {
  locator: string
  role: string
  charLength: number
  /** 源消息时间戳（事实时间候选；批次取最后一条消息的时间）。 */
  timestamp?: string | undefined
}

export function buildBatches(sessions: StagingSession[], turns: StagingTurn[], options: { charsPerCall?: number } = {}): Array<{ rolloutId: string; sessionId: string; messages: BatchMessage[]; chars: number }> {
  const charsPerCall = options.charsPerCall ?? CHARS_PER_CALL
  const turnMap = new Map<string, StagingTurn[]>()
  for (const turn of turns) {
    if (turn.char_length < MIN_CANDIDATE_CHARS) continue
    const list = turnMap.get(turn.rollout_id) ?? []
    list.push(turn)
    turnMap.set(turn.rollout_id, list)
  }
  const batches: Array<{ rolloutId: string; sessionId: string; messages: BatchMessage[]; chars: number }> = []
  for (const session of sessions) {
    const list = turnMap.get(session.rollout_id) ?? []
    if (list.length === 0) continue
    let current: BatchMessage[] = []
    let chars = 0
    for (const turn of list) {
      if (chars > 0 && chars + turn.char_length > charsPerCall) {
        batches.push({ rolloutId: session.rollout_id, sessionId: session.session_id, messages: current, chars })
        current = []
        chars = 0
      }
      current.push({ locator: turn.locator, role: turn.role, charLength: turn.char_length, ...(turn.timestamp === undefined ? {} : { timestamp: turn.timestamp }) })
      chars += turn.char_length
    }
    if (current.length > 0) batches.push({ rolloutId: session.rollout_id, sessionId: session.session_id, messages: current, chars })
  }
  return batches
}

/** 空闲时段闸门：北京时 9-12、14-18 为高峰，其余空闲（官方价一半）。 */
export function isOffPeak(now = new Date()): boolean {
  const hour = now.getHours()
  return !((hour >= 9 && hour < 12) || (hour >= 14 && hour < 18))
}

/** 单调用成本（元）：按官方口径分缓存命中/未命中/输出。 */
export function callCostYuan(usage: { missIn?: number; hitIn?: number; out?: number }): number {
  const miss = usage.missIn ?? 0
  const hit = usage.hitIn ?? 0
  const out = usage.out ?? 0
  return (miss * CODEX_IMPORT_PRICES.missIn + hit * CODEX_IMPORT_PRICES.cacheHitIn + out * CODEX_IMPORT_PRICES.out) / 1e6
}

export const CODEX_EXTRACT_PROMPT = (
  '你是记忆提取助手。阅读下面这段来自「食溯项目」历史会话的摘录（可能含用户与助手消息），提取值得长期记住的内容：' + String.fromCharCode(10) +
  '只提取：明确决定、用户偏好与约束、事故与根因、被验证过的方法、未决事项。不要提取闲聊、纯代码片段、临时任务。' + String.fromCharCode(10) +
  '只输出一个 JSON 对象（无 Markdown 代码块、无多余文字）：{"candidates":[{"kind":"project_fact|event|pattern","text":"一句话中文陈述","confidence":0-100}]}' + String.fromCharCode(10) +
  '规则：最多 5 条；text 必须完整陈述、不含密钥/口令/敏感凭据；只能基于摘录内容，不得编造；没有值得记的内容就输出 {"candidates":[]}。'
)

export interface ExtractRunOptions {
  endpoint: string
  apiKey: string
  /** 目标项目 id：parseExtractionResult 只放行 scope=project 的候选（fail closed）。 */
  projectId?: string | undefined
  batches: Array<{ rolloutId: string; sessionId: string; messages: BatchMessage[]; chars: number }>
  /** 源文本供给器：按 locator 读原文（从源文件取，绝不把原文写进状态/日志）。 */
  readText: (locator: string) => string
  budgetYuan: number
  checkpointFile?: string
  offPeakOnly?: boolean
  onProgress?: (info: { done: number; total: number; spentYuan: number; candidates: number }) => void
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export interface ExtractRunResult {
  calls: number
  spentYuan: number
  candidates: Array<ExtractionCandidate & { locator: string; rolloutId: string; sessionId: string; factualAt: string | undefined }>
  stopped: 'completed' | 'budget' | 'off-peak' | 'error'
  error?: string
}

/** 批量提取（有界）：限速顺序执行、成本硬上限、时段闸门、断点续跑、重试≤3。 */
export async function runExtraction(options: ExtractRunOptions): Promise<ExtractRunResult> {
  const result: ExtractRunResult = { calls: 0, spentYuan: 0, candidates: [], stopped: 'completed' }
  let done = 0
  if (existsSync(options.checkpointFile ?? '')) {
    const cp = JSON.parse(readFileSync(options.checkpointFile ?? '', 'utf8'))
    done = Math.min(Number(cp.done ?? 0), options.batches.length)
    result.spentYuan = Number(cp.spentYuan ?? 0)
    result.candidates = cp.candidates ?? []
  }
  for (let i = done; i < options.batches.length; i += 1) {
    const batch = options.batches[i]
    if (batch === undefined) { result.stopped = 'error'; result.error = '批次缺失'; break }
    if (options.offPeakOnly !== false && !isOffPeak()) { result.stopped = 'off-peak'; break }
    if (result.spentYuan >= options.budgetYuan) { result.stopped = 'budget'; break }
    const excerpt = batch.messages
      .map(m => m.role + '(' + m.locator + '): ' + options.readText(m.locator))
      .join(String.fromCharCode(10))
    const context = '项目：食溯。摘录（' + String(batch.chars) + ' 字符，会话 ' + batch.sessionId + '）：' + String.fromCharCode(10) + excerpt
    let lastError: unknown = null
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const out = await extractCandidates(
          { endpoint: options.endpoint, apiKey: options.apiKey, model: CODEX_IMPORT_MODEL, context, projectId: options.projectId, disableThinking: true },
          { timeoutMs: options.timeoutMs ?? 60_000, ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }) },
        )
        result.calls += 1
        // 成本记账：优先供应商实际 usage；缺省时按估算（源码×0.6 + 提示词，输出 400）。
        const u = out.usage
        result.spentYuan += u !== undefined
          ? callCostYuan({ missIn: u.cacheMissTokens ?? u.promptTokens ?? 0, hitIn: u.cacheHitTokens ?? 0, out: u.completionTokens ?? 0 })
          : callCostYuan({ missIn: Math.round(batch.chars * 0.6) + PROMPT_TOKENS, out: 400 })
        // 事实时间：批次最后一条带时间戳的消息（该批候选对应的时间点）。
        let factualAt: string | undefined
        for (const message of batch.messages) {
          if (message.timestamp !== undefined && message.timestamp !== '') factualAt = message.timestamp
        }
        for (const candidate of out.candidates.slice(0, MAX_OUTPUT_CANDIDATES)) {
          result.candidates.push({ ...candidate, locator: batch.messages[0]?.locator ?? '', rolloutId: batch.rolloutId, sessionId: batch.sessionId, factualAt })
        }
        lastError = null
        break
      } catch (error) {
        lastError = error
        if (error instanceof ExtractorError && ['PROVIDER_AUTH_FAILED', 'PROVIDER_NOT_FOUND', 'INVALID_ENDPOINT'].includes(error.code)) break
        await new Promise(resolve => setTimeout(resolve, 2000 * attempt))
      }
    }
    if (lastError !== null) { result.stopped = 'error'; result.error = String(lastError instanceof Error ? lastError.message : lastError); break }
    done = i + 1
    options.onProgress?.({ done, total: options.batches.length, spentYuan: result.spentYuan, candidates: result.candidates.length })
    if (options.checkpointFile !== undefined) {
      writeFileSync(options.checkpointFile, JSON.stringify({ done, spentYuan: result.spentYuan, candidates: result.candidates }), 'utf8')
    }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  return result
}
