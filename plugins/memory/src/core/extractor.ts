// P3-2 提取器：有界 OpenAI 兼容调用 + 严格 JSON 解析 + 本地敏感预筛。
// 设计红线：
//   - 纯函数 + 可注入 fetch：单测不依赖真实模型；
//   - 任何失败抛 ExtractorError，调用方（turn-extractor）吞错，绝不打断会话；
//   - 文本提取（决策①：不需要图像识别）；候选写入前先过 assertWritableContent 敏感硬拦截。
import { assertKindScopePairing } from './service.ts'
import { assertWritableContent, canonicalizeClaim, normalizedHash } from './gates.ts'

export const EXTRACTOR_ID = 'memory-extract'
export const EXTRACTOR_VERSION = 'v1'
export const MAX_EXTRACTION_CANDIDATES = 2
export const DEFAULT_EXTRACTION_TIMEOUT_MS = 30_000
export const MIN_CANDIDATE_CHARS = 12
export const MAX_CANDIDATE_CHARS = 4000
export const MAX_CONTEXT_CHARS_HARD = 8000
const USER_PART_MAX_CHARS = 400

export interface ExtractionCandidate {
  kind: string
  scope: 'global_user' | 'project'
  text: string
  confidence: number
}

/** 已解析的「记忆提取」连接（endpoint + 密钥，Host 侧已解析）。 */
export interface ExtractionConnection {
  endpoint: string
  apiKey: string
  label: string
}

export interface ExtractionInput {
  endpoint: string
  apiKey: string
  model: string
  context: string
  projectId?: string | undefined
  /** true = 请求体显式 thinking:{type:'disabled'}（官方规范的最低思考强度；提取任务不需要思考）。 */
  disableThinking?: boolean | undefined
}

export interface ExtractionOutput {
  candidates: ExtractionCandidate[]
  provider: string
  model: string
  /** 供应商用量（DeepSeek usage 口径；缺省时调用方可用估算）。 */
  usage?: {
    promptTokens?: number
    completionTokens?: number
    cacheHitTokens?: number
    cacheMissTokens?: number
  }
}

export class ExtractorError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'ExtractorError'
    this.code = code
  }
}

/** 提取提示词：绑定项目时开放 project 范围，否则只允许全局通用内容。 */
export function extractionPrompt(projectId: string | undefined): string {
  const bindingLine = projectId === undefined
    ? '当前未绑定项目：只允许 scope="global_user"（kind 限 pattern/global_fact/user_profile/skill）。'
    : '当前项目：' + projectId + '。项目专属事实/事件用 scope="project"（kind 限 project_fact/event）；跨项目通用教训用 scope="global_user" + kind="pattern"。'
  return [
    '你是记忆提取助手。请阅读对话并提取值得长期记住的内容（技术经验、已验证的修复、可复用方法、明确约定或决定、重要事实），只输出一个 JSON 对象（不要 Markdown 代码块、不要多余文字）：',
    '{"candidates":[{"kind":"pattern","scope":"global_user","text":"一句中文陈述","confidence":60}]}',
    '规则：',
    '- 最多 ' + String(MAX_EXTRACTION_CANDIDATES) + ' 条，按重要程度排序；没有值得记的内容就输出 {"candidates":[]}。',
    '- text 必须是完整陈述句（不含密钥/令牌/口令/身份证号/银行卡号等敏感信息），只提取对话中明确出现的内容，不要编造。',
    '- kind 白名单：pattern、global_fact、user_profile、skill、project_fact、event。',
    bindingLine,
  ].join('\n')
}

/** 轮末提取需求门：助手有实质回复，且对话含教训/约定/修复类信号或用户明确要求记住。 */
const EXTRACTION_SKIP = /^翻译[:：]|^改写|^润色|^复述|^总结一下/u
const EXTRACTION_LESSON = /坑|教训|根因|经验|修复|解决|错误|失败|注意|约定|决定|拍板|规范|方法|方案|以后|别再|再犯/u
const EXTRACTION_EXPLICIT = /记住|记一下|记下来/u
// 记忆管理轮不参与提取：助手会复述候选/评审结果，若再提取会形成「自反馈重复提取」
// （实测：拒绝 3 条后，助手复述拒绝结果又被提取出 1 条同内容候选）。
const EXTRACTION_ADMIN_TOOL = /memory_candidates|memory_review|memory_pause|memory_status|memory_list|memory_summary|memory_query|memory_record/u
const EXTRACTION_ADMIN_TALK = /候选|评审|记忆库|自动提取/u
const EXTRACTION_ADMIN_SHORT = /^(全部)?拒绝$|^确认$|^confirm$|^reject$|^看下候选$/u

export function extractionGate(userText: string, assistantText: string): boolean {
  const user = String(userText ?? '').trim()
  const assistant = String(assistantText ?? '').trim()
  if (assistant.length < 20) return false
  if (EXTRACTION_SKIP.test(user)) return false
  if (EXTRACTION_ADMIN_TOOL.test(user)) return false
  if (EXTRACTION_ADMIN_TALK.test(user)) return false
  if (user.length <= 12 && EXTRACTION_ADMIN_SHORT.test(user)) return false
  if (EXTRACTION_EXPLICIT.test(user)) return true
  const probe = (user + '\n' + assistant).slice(0, 4000)
  return EXTRACTION_LESSON.test(probe)
}

/** 有界上下文：用户意图留头、助手结论留尾，总长不超预算。 */
export function buildExtractionContext(userText: string, assistantText: string, maxChars: number): string {
  const cap = Math.min(Math.max(Number(maxChars) || 1500, 200), MAX_CONTEXT_CHARS_HARD)
  const user = canonicalizeClaim(userText)
  const assistant = canonicalizeClaim(assistantText)
  const userPart = user.length <= USER_PART_MAX_CHARS ? user : user.slice(0, USER_PART_MAX_CHARS - 1) + '…'
  const prefix = userPart === '' ? '助手：' : '用户：' + userPart + '\n助手：'
  const body = prefix + assistant
  if (body.length <= cap) return body
  const budget = cap - prefix.length
  if (budget < 60) return body.slice(0, cap)
  return prefix + '…' + assistant.slice(-(budget - 1))
}

/**
 * 解析模型输出为合法候选（有界）：剥离代码围栏 → JSON → 逐条校验
 * （kind×scope 配对、敏感硬拦截、长度、去重、≤2 条）。任何一条不合格只丢弃该条。
 */
export function parseExtractionResult(raw: string, projectId?: string | undefined): ExtractionCandidate[] {
  const text = String(raw ?? '').trim()
  if (text === '') return []
  const fenced = /```(?:json)?\s*([\s\S]*?)```/u.exec(text)
  const candidateText = (fenced?.[1] ?? text).trim()
  let payload: unknown
  // 优先整体解析（围栏内容或完整 JSON）；失败再退化到首尾花括号/方括号切片。
  if (candidateText.startsWith('{') || candidateText.startsWith('[')) {
    try { payload = JSON.parse(candidateText) } catch { payload = undefined }
  }
  if (payload === undefined) {
    const braceStart = candidateText.indexOf('{')
    const braceEnd = candidateText.lastIndexOf('}')
    if (braceStart >= 0 && braceEnd > braceStart) {
      try { payload = JSON.parse(candidateText.slice(braceStart, braceEnd + 1)) } catch { payload = undefined }
    }
  }
  if (payload === undefined) {
    const bracketStart = candidateText.indexOf('[')
    const bracketEnd = candidateText.lastIndexOf(']')
    if (bracketStart >= 0 && bracketEnd > bracketStart) {
      try { payload = JSON.parse(candidateText.slice(bracketStart, bracketEnd + 1)) } catch { payload = undefined }
    }
  }
  const list = Array.isArray(payload)
    ? payload
    : payload !== null && typeof payload === 'object' && Array.isArray((payload as { candidates?: unknown }).candidates)
      ? (payload as { candidates: unknown[] }).candidates
      : []
  const seen = new Set<string>()
  const out: ExtractionCandidate[] = []
  for (const item of list) {
    if (out.length >= MAX_EXTRACTION_CANDIDATES) break
    if (item === null || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const kind = typeof record.kind === 'string' ? record.kind.trim() : ''
    const scope = record.scope === 'project' ? 'project' : record.scope === 'global_user' ? 'global_user' : ''
    const rawText = typeof record.text === 'string' ? record.text.trim() : ''
    if (kind === '' || scope === '' || rawText === '') continue
    if (scope === 'project' && projectId === undefined) continue
    try { assertKindScopePairing(scope, kind) } catch { continue }
    try { assertWritableContent(rawText) } catch { continue }
    const canonical = canonicalizeClaim(rawText)
    if (canonical.length < MIN_CANDIDATE_CHARS || canonical.length > MAX_CANDIDATE_CHARS) continue
    const hash = normalizedHash(canonical)
    if (seen.has(hash)) continue
    seen.add(hash)
    const confidence = Math.min(Math.max(Number(record.confidence ?? 50) || 50, 0), 100)
    out.push({ kind, scope: scope as 'global_user' | 'project', text: canonical, confidence })
  }
  return out
}

interface ExtractOptions {
  fetchImpl?: typeof fetch
  signal?: AbortSignal
  timeoutMs?: number
}

/**
 * 一次有界 OpenAI 兼容提取调用：单个 user message 携带提示词 + 对话上下文。
 * 与 image-vision 同构（Host 侧发起，密钥/原始回复不进入渲染进程）。
 */
export async function extractCandidates(input: ExtractionInput, options: ExtractOptions = {}): Promise<ExtractionOutput> {
  const { endpoint, apiKey, model, context, projectId } = input
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? DEFAULT_EXTRACTION_TIMEOUT_MS
  let base: URL
  try {
    base = new URL(endpoint)
    if (base.protocol !== 'https:' && base.protocol !== 'http:') throw new Error('unsupported protocol')
  } catch {
    throw new ExtractorError('INVALID_ENDPOINT', '提取模型 API 地址无效。')
  }
  const target = new URL(base.pathname.replace(/\/$/u, '') + '/chat/completions', base)
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, timeoutMs)
  const abortFromCaller = (): void => { controller.abort() }
  options.signal?.addEventListener('abort', abortFromCaller)
  try {
    const response = await fetchImpl(target.toString(), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer ' + apiKey,
      },
      body: JSON.stringify({
        model,
        ...(input.disableThinking === true ? { thinking: { type: 'disabled' } } : {}),
        messages: [{ role: 'user', content: extractionPrompt(projectId) + '\n\n【对话】\n' + context }],
      }),
      signal: controller.signal,
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      if (response.status === 401 || response.status === 403) {
        throw new ExtractorError('PROVIDER_AUTH_FAILED', '提取模型服务拒绝了密钥。')
      }
      if (response.status === 404) throw new ExtractorError('PROVIDER_NOT_FOUND', '提取模型服务地址或模型名无效（404）。')
      throw new ExtractorError('PROVIDER_ERROR', '提取模型服务返回 HTTP ' + String(response.status) + '。' + detail.slice(0, 120))
    }
    const payload = await response.json() as {
      model?: unknown
      usage?: {
        prompt_tokens?: unknown
        completion_tokens?: unknown
        prompt_cache_hit_tokens?: unknown
        prompt_cache_miss_tokens?: unknown
      }
      choices?: readonly { message?: { content?: unknown } }[]
    }
    const usage = payload.usage
    const content = payload.choices?.[0]?.message?.content
    if (typeof content !== 'string' || content.trim() === '') {
      throw new ExtractorError('EMPTY_RESPONSE', '提取模型没有返回可用的文字内容。')
    }
    return {
      candidates: parseExtractionResult(content, projectId),
      provider: base.host,
      model: typeof payload.model === 'string' && payload.model !== '' ? payload.model : model,
      ...(usage === undefined ? {} : { usage: {
        ...(typeof usage.prompt_tokens === 'number' ? { promptTokens: usage.prompt_tokens } : {}),
        ...(typeof usage.completion_tokens === 'number' ? { completionTokens: usage.completion_tokens } : {}),
        ...(typeof usage.prompt_cache_hit_tokens === 'number' ? { cacheHitTokens: usage.prompt_cache_hit_tokens } : {}),
        ...(typeof usage.prompt_cache_miss_tokens === 'number' ? { cacheMissTokens: usage.prompt_cache_miss_tokens } : {}),
      } }),
    }
  } catch (error) {
    if (error instanceof ExtractorError) throw error
    if ((error as { name?: unknown })?.name === 'AbortError' || controller.signal.aborted) {
      throw new ExtractorError('PROVIDER_TIMEOUT', '提取模型服务响应超时。')
    }
    throw new ExtractorError('PROVIDER_UNREACHABLE', '无法连接提取模型服务。')
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', abortFromCaller)
  }
}
