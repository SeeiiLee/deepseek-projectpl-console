export const MAX_IMAGE_BYTES = 15 * 1024 * 1024
export const OMNIBUS_PROMPT = [
  '你是识图助手。请仔细分析这张图片并只输出一个 JSON 对象（不要 Markdown 代码块、不要多余文字），字段如下：',
  '{"summary":"用一句话概括图片内容","ocr":"图片中可识别的文字内容，没有则为空字符串","uiAnalysis":"如果是界面截图或 UI：说明布局与功能要点；否则写 不适用"}',
].join('\n')

export interface AnalyzeInput {
  endpoint: string
  apiKey: string
  model: string
  mimeType: string
  base64: string
}

export interface AnalyzeOutput {
  summary: string
  ocr: string
  uiAnalysis: string
  provider: string
  model: string
}

export class ImageVisionError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'ImageVisionError'
    this.code = code
  }
}

function boundedText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return ''
  const normalized = value.trim()
  return normalized.slice(0, maxLength)
}

/**
 * Parse a model answer into the omnibus result shape. Models that return
 * clean JSON pass through; fenced or verbose answers degrade to a summary
 * of the raw text instead of failing the whole request.
 */
export function parseOmnibusResult(raw: string): Pick<AnalyzeOutput, 'summary' | 'ocr' | 'uiAnalysis'> {
  const text = raw.trim()
  const fenced = /```(?:json)?\s*([\s\S]*?)```/u.exec(text)
  const candidate = fenced?.[1] ?? text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>
      const summary = boundedText(parsed.summary, 2000)
      const ocr = boundedText(parsed.ocr, 20000)
      const uiAnalysis = boundedText(parsed.uiAnalysis, 20000)
      if (summary !== '' || ocr !== '' || uiAnalysis !== '') {
        return { summary: summary || '（模型没有给出概括）', ocr, uiAnalysis: uiAnalysis || '不适用' }
      }
    } catch {
      // fall through to the raw-text summary
    }
  }
  return { summary: boundedText(text, 2000) || '（模型返回为空）', ocr: '', uiAnalysis: '不适用' }
}

interface AnalyzeOptions {
  fetchImpl?: typeof fetch
  signal?: AbortSignal
  timeoutMs?: number
}

/**
 * One OpenAI-compatible vision call: a single user message carrying the
 * omnibus prompt plus the image as a data URL. Host-bounded: no renderer
 * code ever touches the provider key or the raw model response.
 */
export async function analyzeImage(input: AnalyzeInput, options: AnalyzeOptions = {}): Promise<AnalyzeOutput> {
  const { endpoint, apiKey, model, mimeType, base64 } = input
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? 60_000
  let base: URL
  try {
    base = new URL(endpoint)
    if (base.protocol !== 'https:' && base.protocol !== 'http:') throw new Error('unsupported protocol')
  } catch {
    throw new ImageVisionError('INVALID_ENDPOINT', '模型 API 地址无效。')
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
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: OMNIBUS_PROMPT },
            { type: 'image_url', image_url: { url: 'data:' + mimeType + ';base64,' + base64 } },
          ],
        }],
      }),
      signal: controller.signal,
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      if (response.status === 401 || response.status === 403) {
        throw new ImageVisionError('PROVIDER_AUTH_FAILED', '模型服务拒绝了密钥。')
      }
      if (response.status === 404) throw new ImageVisionError('PROVIDER_NOT_FOUND', '模型服务地址或模型名无效（404）。')
      throw new ImageVisionError('PROVIDER_ERROR', `模型服务返回 HTTP ${String(response.status)}。${detail.slice(0, 120)}`)
    }
    const payload = await response.json() as {
      model?: unknown
      choices?: readonly { message?: { content?: unknown } }[]
    }
    const content = payload.choices?.[0]?.message?.content
    if (typeof content !== 'string' || content.trim() === '') {
      throw new ImageVisionError('EMPTY_RESPONSE', '模型没有返回可用的文字内容。')
    }
    const parsed = parseOmnibusResult(content)
    return {
      ...parsed,
      provider: base.host,
      model: typeof payload.model === 'string' && payload.model !== '' ? payload.model : model,
    }
  } catch (error) {
    if (error instanceof ImageVisionError) throw error
    if ((error as { name?: unknown })?.name === 'AbortError' || controller.signal.aborted) {
      throw new ImageVisionError('PROVIDER_TIMEOUT', '模型服务响应超时。')
    }
    throw new ImageVisionError('PROVIDER_UNREACHABLE', '无法连接模型服务。')
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', abortFromCaller)
  }
}