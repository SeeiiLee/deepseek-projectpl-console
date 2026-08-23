/** Versioned, client-safe DeepSeek price estimator. Never use this as an invoice. */

export type BillingCurrency = 'CNY' | 'USD'

export interface UsageBuckets {
  uncachedInputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

export interface UnitPrice {
  currency: BillingCurrency
  model: 'deepseek-v4-flash' | 'deepseek-v4-pro'
  cacheHitPerMillion: number
  cacheMissPerMillion: number
  outputPerMillion: number
  version: string
  effectiveAt: string
  period: 'flat'
}

export interface EstimatedCost {
  amount: number
  currency: BillingCurrency
  price: UnitPrice
}

export const PRICING_SOURCE_URL = 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/'
export const PRICING_SNAPSHOT_DATE = '2026-08-14'
export const PRICING_TABLE_VERSION = 'deepseek-v4-2026-08-14-r1'

type Model = UnitPrice['model']
type Rates = Pick<UnitPrice, 'cacheHitPerMillion' | 'cacheMissPerMillion' | 'outputPerMillion'>

const CURRENT: Record<BillingCurrency, Record<Model, Rates>> = {
  CNY: {
    'deepseek-v4-flash': { cacheHitPerMillion: 0.02, cacheMissPerMillion: 1, outputPerMillion: 2 },
    'deepseek-v4-pro': { cacheHitPerMillion: 0.025, cacheMissPerMillion: 3, outputPerMillion: 6 },
  },
  USD: {
    'deepseek-v4-flash': { cacheHitPerMillion: 0.0028, cacheMissPerMillion: 0.14, outputPerMillion: 0.28 },
    'deepseek-v4-pro': { cacheHitPerMillion: 0.003625, cacheMissPerMillion: 0.435, outputPerMillion: 0.87 },
  },
}

/** Deprecated ids are compatibility aliases of V4 Flash in the official table. */
export function normalizeDeepSeekModel(model: string): Model | undefined {
  if (model === 'deepseek-v4-flash' || model === 'deepseek-chat' || model === 'deepseek-reasoner') {
    return 'deepseek-v4-flash'
  }
  if (model === 'deepseek-v4-pro') return 'deepseek-v4-pro'
  return undefined
}

export function priceAt(
  modelId: string,
  currency: BillingCurrency,
  at: number,
): UnitPrice | undefined {
  const model = normalizeDeepSeekModel(modelId)
  if (model === undefined || !Number.isFinite(at)) return undefined
  return {
    currency,
    model,
    ...CURRENT[currency][model],
    version: 'deepseek-pricing-2026-08-14-flat',
    effectiveAt: PRICING_SNAPSHOT_DATE,
    period: 'flat',
  }
}

export function usageBuckets(value: unknown): UsageBuckets | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const row = value as Record<string, unknown>
  const pick = (key: string): number | undefined => {
    const candidate = row[key]
    return typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0
      ? candidate
      : undefined
  }
  const uncachedInputTokens = pick('uncachedInputTokens') ?? pick('inputTokens')
  const outputTokens = pick('outputTokens')
  if (uncachedInputTokens === undefined || outputTokens === undefined) return undefined
  return {
    uncachedInputTokens,
    outputTokens,
    cacheReadTokens: pick('cacheReadTokens') ?? 0,
    cacheWriteTokens: pick('cacheWriteTokens') ?? 0,
  }
}

/** Cache writes are conservatively priced as cache misses; DeepSeek direct usage currently emits none. */
export function estimateCost(
  usage: UsageBuckets,
  model: string,
  currency: BillingCurrency,
  at: number,
): EstimatedCost | undefined {
  const price = priceAt(model, currency, at)
  if (price === undefined) return undefined
  const miss = usage.uncachedInputTokens + usage.cacheWriteTokens
  const amount = (
    miss * price.cacheMissPerMillion
    + usage.cacheReadTokens * price.cacheHitPerMillion
    + usage.outputTokens * price.outputPerMillion
  ) / 1_000_000
  return { amount, currency, price }
}

export function formatEstimatedMoney(amount: number, currency: BillingCurrency): string {
  const symbol = currency === 'CNY' ? '¥' : '$'
  const digits = amount >= 1 ? 2 : amount >= 0.01 ? 4 : 6
  return `${symbol}${amount.toFixed(digits)}`
}
