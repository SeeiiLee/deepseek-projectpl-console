import assert from 'node:assert/strict'
import test from 'node:test'
import { estimateCost, priceAt, usageBuckets } from '../src/pricing.ts'

test('uses the dated official flat CNY snapshot', () => {
  const price = priceAt('deepseek-v4-flash', 'CNY', Date.parse('2026-08-14T12:00:00+08:00'))
  assert.equal(price?.version, 'deepseek-pricing-2026-08-14-flat')
  assert.equal(price?.cacheHitPerMillion, 0.02)
  assert.equal(price?.cacheMissPerMillion, 1)
  assert.equal(price?.outputPerMillion, 2)
})

test('prices disjoint usage buckets without double-counting cache reads', () => {
  const usage = usageBuckets({ inputTokens: 1_000_000, outputTokens: 500_000, cacheReadTokens: 2_000_000 })
  assert.deepEqual(usage, {
    uncachedInputTokens: 1_000_000,
    outputTokens: 500_000,
    cacheReadTokens: 2_000_000,
    cacheWriteTokens: 0,
  })
  const cost = estimateCost(usage, 'deepseek-v4-flash', 'CNY', Date.parse('2026-08-14T00:00:00Z'))
  assert.equal(cost?.amount, 2.04)
})
