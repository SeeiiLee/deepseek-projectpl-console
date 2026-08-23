/**
 * AnySearch web search provider for the DeepSeek Harness `ctx.web` seam.
 *
 * AnySearch exposes a JSON-RPC 2.0 endpoint (`tools/call`). Its `search`
 * tool returns one or more text blocks; this provider turns that payload into
 * the seam's normalized `WebSearchResult` vocabulary. Structured JSON payloads
 * and Markdown link lists are both tolerated.
 * @module @cyrus/dsh-anysearch/provider
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from '@deepseek-ai/dsh-web'

/** Stable id this provider registers under. */
export const ANYSEARCH_PROVIDER_ID = 'anysearch'

/** Default AnySearch JSON-RPC endpoint. */
export const ANYSEARCH_DEFAULT_ENDPOINT = 'https://api.anysearch.com/mcp'

/** AnySearch search API accepts 1-10 results. */
export const ANYSEARCH_DEFAULT_MAX_RESULTS = 5
export const ANYSEARCH_MAX_RESULTS = 10

/** Attribution header sent on every request. */
const USER_AGENT = 'deepseek-harness-personal/0.1.0-beta'

/** Resolved provider options (the plugin entry supplies credential and endpoint defaults). */
export interface AnySearchSearchProviderOptions {
  /** Literal API key; when present it wins over {@link resolveApiKey}. */
  apiKey?: string
  /** Resolve the current API key for one search operation. */
  resolveApiKey?: () => Promise<string | undefined>
  /** Credential reference named by missing-credential diagnostics. */
  apiKeyEnv?: string
  /** AnySearch JSON-RPC endpoint. */
  endpoint: string
}

interface AnySearchJsonRpcTextBlock {
  readonly type?: unknown
  readonly text?: unknown
}

interface AnySearchJsonRpcResult {
  readonly content?: readonly AnySearchJsonRpcTextBlock[]
}

interface AnySearchJsonRpcError {
  readonly message?: unknown
}

interface AnySearchJsonRpcResponse {
  readonly error?: AnySearchJsonRpcError | string
  readonly result?: AnySearchJsonRpcResult
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmptyText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/** Normalize one source candidate. Sources must always have a URL. */
function sourceFromRecord(value: Record<string, unknown>): WebSearchSource | undefined {
  const url = nonEmptyText(value.url ?? value.link ?? value.href)
  if (url === undefined) return undefined
  const title = nonEmptyText(value.title ?? value.name)
  const snippet = nonEmptyText(value.snippet ?? value.description ?? value.summary ?? value.content)
  const publishedAt = nonEmptyText(value.publishedAt ?? value.date ?? value.page_age)
  return {
    url,
    ...(title === undefined ? {} : { title }),
    ...(snippet === undefined ? {} : { snippet }),
    ...(publishedAt === undefined ? {} : { publishedAt }),
  }
}

/** Pull sources out of a parsed JSON payload when it already looks structured. */
function jsonSources(value: unknown): WebSearchSource[] | undefined {
  if (Array.isArray(value)) {
    const sources: WebSearchSource[] = []
    for (const entry of value) {
      if (typeof entry === 'string') {
        const parsed = tryJson(entry)
        if (isRecord(parsed)) {
          const source = sourceFromRecord(parsed)
          if (source !== undefined) sources.push(source)
        }
        continue
      }
      if (!isRecord(entry)) continue
      const source = sourceFromRecord(entry)
      if (source !== undefined) sources.push(source)
      for (const key of ['results', 'sources', 'data', 'items']) {
        const nested = jsonSources(entry[key])
        if (nested !== undefined) sources.push(...nested)
      }
    }
    return sources.length > 0 ? sources : undefined
  }

  if (!isRecord(value)) return undefined

  const direct = sourceFromRecord(value)
  const nestedSources: WebSearchSource[] = direct === undefined ? [] : [direct]
  for (const key of ['results', 'sources', 'data', 'items']) {
    const nested = jsonSources(value[key])
    if (nested !== undefined) nestedSources.push(...nested)
  }
  return nestedSources.length > 0 ? nestedSources : undefined
}

function tryJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

/** Extract Markdown `[title](url)` links and plain HTTP(S) URLs. */
function markdownSources(text: string): WebSearchSource[] {
  const sources: WebSearchSource[] = []
  const linkPattern = /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/gu
  for (const match of text.matchAll(linkPattern)) {
    const title = match[1]?.trim()
    const url = match[2]
    if (url === undefined || url.length === 0) continue
    const line = text.slice(0, match.index).split(/\r?\n/u).at(-1) ?? ''
    const snippet = line.split(/\s[-—]\s/u).at(-1)?.trim()
    sources.push({
      url,
      ...(title !== undefined && title.length > 0 ? { title } : {}),
      ...(snippet !== undefined && snippet.length > 0 ? { snippet } : {}),
    })
  }

  if (sources.length === 0) {
    const urlPattern = /https?:\/\/[^\s)\]"']+/gu
    for (const match of text.matchAll(urlPattern)) {
      const url = match[0]
      if (url !== undefined) sources.push({ url })
    }
  }

  return dedupeSources(sources)
}

function dedupeSources(sources: readonly WebSearchSource[]): WebSearchSource[] {
  const seen = new Set<string>()
  const result: WebSearchSource[] = []
  for (const source of sources) {
    if (seen.has(source.url)) continue
    seen.add(source.url)
    result.push(source)
  }
  return result
}

/**
 * Map an AnySearch text payload to the seam's normalized search result.
 * Structured JSON wins; otherwise Markdown links and plain URLs are extracted
 * so the model-facing `web_search` result still has citeable sources.
 */
export function parseAnySearchText(text: string): WebSearchResult {
  const content = text.trim()
  if (content.length === 0) return { content: '', sources: [], truncated: false }

  const parsed = tryJson(content)
  const structured = parsed === undefined ? undefined : jsonSources(parsed)
  if (structured !== undefined) {
    let answer: string | undefined
    if (isRecord(parsed)) {
      answer = nonEmptyText(parsed.answer ?? parsed.content ?? parsed.summary)
    }
    return {
      ...(answer === undefined ? {} : { content: answer }),
      sources: dedupeSources(structured),
      truncated: false,
    }
  }

  const sources = markdownSources(content)
  return {
    content,
    sources,
    truncated: false,
  }
}

/** The AnySearch-backed search provider registered into `ctx.web`. */
export class AnySearchSearchProvider implements WebSearchProvider {
  readonly id = ANYSEARCH_PROVIDER_ID

  constructor(private readonly resolveOptions: () => AnySearchSearchProviderOptions) {}

  available(): boolean {
    const options = this.resolveOptions()
    return (options.apiKey !== undefined && options.apiKey.length > 0 || options.resolveApiKey !== undefined)
      && URL.canParse(options.endpoint)
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const options = this.resolveOptions()
    throwIfAborted(signal)
    const apiKey = await this.resolveApiKey(options, signal)
    throwIfAborted(signal)

    const maxResults = request.maxResults === undefined
      ? ANYSEARCH_DEFAULT_MAX_RESULTS
      : Math.min(Math.max(request.maxResults, 1), ANYSEARCH_MAX_RESULTS)

    const payload = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'search',
        arguments: {
          query: request.query,
          max_results: maxResults,
        },
      },
    }

    let response: Response
    try {
      response = await fetch(options.endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: {
          ...(apiKey.length > 0 ? { authorization: `Bearer ${apiKey}` } : {}),
          'content-type': 'application/json',
          'accept': 'application/json',
          'user-agent': USER_AGENT,
        },
        body: JSON.stringify(payload),
        ...(signal === undefined ? {} : { signal }),
      })
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw aborted(signal, error)
      throw new WebError(`AnySearch search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }

    if (!response.ok) {
      let detail = ''
      try {
        const body = await response.json() as AnySearchJsonRpcResponse
        const message = body.error === undefined || typeof body.error === 'string'
          ? body.error
          : body.error.message
        if (typeof message === 'string') detail = message
      } catch {
        // The status code is already authoritative; a malformed error body is not fatal.
      }
      const suffix = detail.length > 0 ? `: ${detail}` : ''
      throw new WebError(`AnySearch API error (HTTP ${response.status})${suffix}`, 'WEB_PROVIDER_ERROR')
    }

    let data: AnySearchJsonRpcResponse
    try {
      data = await response.json() as AnySearchJsonRpcResponse
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw aborted(signal, error)
      throw new WebError(`AnySearch returned an unprocessable response body: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }

    const error = data.error
    if (error !== undefined) {
      const message = typeof error === 'string'
        ? error
        : nonEmptyText(error.message) ?? JSON.stringify(error)
      throw new WebError(`AnySearch API error: ${message}`, 'WEB_PROVIDER_ERROR')
    }

    const content = data.result?.content
    if (Array.isArray(content)) {
      const text = content
        .map((block) => block.type === 'text' && typeof block.text === 'string' ? block.text : '')
        .join('\n')
      return parseAnySearchText(text)
    }

    return parseAnySearchText(JSON.stringify(data.result ?? data))
  }

  private async resolveApiKey(
    options: AnySearchSearchProviderOptions,
    signal?: AbortSignal,
  ): Promise<string> {
    throwIfAborted(signal)
    if (options.apiKey !== undefined && options.apiKey.length > 0) return options.apiKey
    let resolved: string | undefined
    try {
      resolved = await options.resolveApiKey?.()
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw aborted(signal, error)
      throw new WebError(
        `AnySearch search credential resolution failed: ${String(error)}`,
        'WEB_PROVIDER_ERROR',
        { cause: error },
      )
    }
    if (resolved !== undefined && resolved.length > 0) return resolved
    const reference = options.apiKeyEnv ?? 'ANYSEARCH_API_KEY'
    throw new WebError(
      `AnySearch search has no API key for "${reference}"; save it in the AnySearch settings section, `
      + 'export ANYSEARCH_API_KEY in the launching environment, or set a literal "apiKey" in the plugin config',
      'WEB_PROVIDER_CREDENTIAL_MISSING',
    )
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw aborted(signal)
}

function aborted(_signal: AbortSignal | undefined, cause?: unknown): WebError {
  return new WebError('AnySearch search aborted', 'WEB_ABORTED', cause === undefined ? {} : { cause })
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || String(error.message).includes('aborted'))
}
