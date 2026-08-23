import assert from 'node:assert/strict'
import test from 'node:test'
import { createBalanceRequestHandler } from '../src/index.ts'

function responseCapture() {
  return {
    headersSent: false,
    status: 0,
    headers: {},
    body: '',
    writeHead(status, headers) { this.status = status; this.headers = headers; this.headersSent = true },
    end(body) { this.body = String(body ?? '') },
  }
}

test('queries official balance with the Host credential and never returns the key', async () => {
  const secret = 'sk-super-secret'
  const handler = createBalanceRequestHandler({
    credentials: { resolve: async () => ({ value: secret, source: 'file' }) },
    fetcher: async (url, init) => {
      assert.equal(url, 'https://api.deepseek.com/user/balance')
      assert.equal(init.headers.authorization, `Bearer ${secret}`)
      return new Response(JSON.stringify({
        is_available: true,
        balance_infos: [{
          currency: 'CNY', total_balance: '12.34', granted_balance: '2.34', topped_up_balance: '10.00',
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    },
    now: () => Date.parse('2026-08-14T00:00:00Z'),
  })
  const response = responseCapture()
  await handler({ method: 'GET', url: '/__personal/usage-balance', headers: { 'x-dsh-personal-client': '1' } }, response)
  assert.equal(response.status, 200)
  assert.equal(response.body.includes(secret), false)
  assert.deepEqual(JSON.parse(response.body).data.balances[0], {
    currency: 'CNY', total: '12.34', granted: '2.34', toppedUp: '10.00',
  })
})

test('does not call the network when DEEPSEEK_API_KEY is absent', async () => {
  let fetched = false
  const handler = createBalanceRequestHandler({
    credentials: { resolve: async () => undefined },
    fetcher: async () => { fetched = true; throw new Error('must not fetch') },
  })
  const response = responseCapture()
  await handler({ method: 'GET', url: '/__personal/usage-balance', headers: { 'x-dsh-personal-client': '1' } }, response)
  assert.equal(fetched, false)
  assert.equal(JSON.parse(response.body).data.status, 'unconfigured')
})

test('rejects requests without the desktop-client marker', async () => {
  const handler = createBalanceRequestHandler({ credentials: { resolve: async () => undefined } })
  const response = responseCapture()
  await handler({ method: 'GET', url: '/__personal/usage-balance', headers: {} }, response)
  assert.equal(response.status, 403)
})
