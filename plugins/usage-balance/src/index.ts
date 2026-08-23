import type { IncomingMessage, ServerResponse } from 'node:http'

export {
  estimateCost, formatEstimatedMoney, normalizeDeepSeekModel,
  PRICING_SNAPSHOT_DATE, PRICING_SOURCE_URL, PRICING_TABLE_VERSION,
  priceAt, usageBuckets,
} from './pricing.ts'
export type { BillingCurrency, EstimatedCost, UnitPrice, UsageBuckets } from './pricing.ts'

const API_PATH = '/__personal/usage-balance'
const BALANCE_ENDPOINT = 'https://api.deepseek.com/user/balance'
const KEY_REF = 'DEEPSEEK_API_KEY'
const MAX_RESPONSE_BYTES = 64 * 1024

interface WebServerLike {
  register(route: {
    kind: 'prefix'
    path: string
    handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
  }): () => void
}

interface CredentialsLike {
  resolve(reference: string): Promise<{ value: string; source: string } | undefined>
}

interface HostContextLike {
  webServer: WebServerLike
  credentials: CredentialsLike
  effect(factory: () => (() => void) | void, label?: string): void
}

export interface BalanceInfo {
  currency: 'CNY' | 'USD'
  total: string
  granted: string
  toppedUp: string
}

export type BalanceStatus =
  | { status: 'ready'; available: boolean; balances: readonly BalanceInfo[]; checkedAt: string }
  | { status: 'unconfigured'; checkedAt: string }
  | { status: 'authentication-failed' | 'rate-limited' | 'unavailable'; checkedAt: string }

export interface BalanceRuntime {
  credentials: CredentialsLike
  fetcher?: typeof fetch
  now?: () => number
}

export const inject = ['webServer', 'credentials']

export function apply(ctx: HostContextLike): void {
  const handler = createBalanceRequestHandler({ credentials: ctx.credentials })
  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: API_PATH, handler }),
    'usage-balance: host-only DeepSeek balance route',
  )
}

/** Focused HTTP seam: the credential is resolved and consumed only inside this Host closure. */
export function createBalanceRequestHandler(runtime: BalanceRuntime) {
  let cache: { expiresAt: number; value: BalanceStatus } | undefined
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (request.headers['x-dsh-personal-client'] !== '1') {
      sendJson(response, 403, { ok: false, error: { code: 'PERSONAL_CLIENT_REQUIRED', message: '此接口只供个人桌面客户端使用。' } })
      return
    }
    const parsed = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (parsed.pathname !== API_PATH) {
      sendJson(response, 404, { ok: false, error: { code: 'NOT_FOUND', message: '余额接口不存在。' } })
      return
    }
    if (request.method !== 'GET') {
      sendJson(response, 405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: '余额接口只支持读取。' } })
      return
    }

    const now = runtime.now?.() ?? Date.now()
    const force = parsed.searchParams.get('refresh') === '1'
    if (!force && cache !== undefined && cache.expiresAt > now) {
      sendJson(response, 200, { ok: true, data: cache.value })
      return
    }

    const value = await queryOfficialBalance(runtime, now)
    // A short cache prevents accidental request storms; explicit refresh bypasses it after top-up.
    cache = { expiresAt: now + 15_000, value }
    sendJson(response, 200, { ok: true, data: value })
  }
}

async function queryOfficialBalance(runtime: BalanceRuntime, now: number): Promise<BalanceStatus> {
  const checkedAt = new Date(now).toISOString()
  let resolved: Awaited<ReturnType<CredentialsLike['resolve']>>
  try {
    resolved = await runtime.credentials.resolve(KEY_REF)
  } catch {
    return { status: 'unavailable', checkedAt }
  }
  if (resolved === undefined) return { status: 'unconfigured', checkedAt }
  const key = resolved.value.trim()
  if (key === '' || key.length > 65_536 || /[^\x20-\x7E]/u.test(key)) {
    return { status: 'authentication-failed', checkedAt }
  }

  let upstream: Response
  try {
    upstream = await (runtime.fetcher ?? fetch)(BALANCE_ENDPOINT, {
      method: 'GET',
      headers: { accept: 'application/json', authorization: `Bearer ${key}` },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    return { status: 'unavailable', checkedAt }
  }
  if (!upstream.ok) {
    if (upstream.status === 401 || upstream.status === 403) return { status: 'authentication-failed', checkedAt }
    if (upstream.status === 429) return { status: 'rate-limited', checkedAt }
    return { status: 'unavailable', checkedAt }
  }

  const declared = Number(upstream.headers.get('content-length') ?? 0)
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) return { status: 'unavailable', checkedAt }
  let text: string
  try {
    text = await upstream.text()
  } catch {
    return { status: 'unavailable', checkedAt }
  }
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) return { status: 'unavailable', checkedAt }
  try {
    const parsed = JSON.parse(text) as unknown
    const normalized = normalizeBalance(parsed)
    return normalized === undefined ? { status: 'unavailable', checkedAt } : { ...normalized, checkedAt }
  } catch {
    return { status: 'unavailable', checkedAt }
  }
}

function normalizeBalance(value: unknown): Omit<Extract<BalanceStatus, { status: 'ready' }>, 'checkedAt'> | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const root = value as Record<string, unknown>
  if (typeof root.is_available !== 'boolean' || !Array.isArray(root.balance_infos) || root.balance_infos.length > 4) {
    return undefined
  }
  const balances: BalanceInfo[] = []
  for (const candidate of root.balance_infos) {
    if (typeof candidate !== 'object' || candidate === null) return undefined
    const row = candidate as Record<string, unknown>
    if (row.currency !== 'CNY' && row.currency !== 'USD') return undefined
    const total = decimal(row.total_balance)
    const granted = decimal(row.granted_balance)
    const toppedUp = decimal(row.topped_up_balance)
    if (total === undefined || granted === undefined || toppedUp === undefined) return undefined
    balances.push({ currency: row.currency, total, granted, toppedUp })
  }
  return { status: 'ready', available: root.is_available, balances }
}

function decimal(value: unknown): string | undefined {
  return typeof value === 'string' && value.length <= 64 && /^\d+(?:\.\d+)?$/u.test(value)
    ? value
    : undefined
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  if (response.headersSent) return
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  response.end(JSON.stringify(value))
}
