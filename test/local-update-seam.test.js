import assert from 'node:assert/strict'
import test from 'node:test'

import { isLocalUpdateAllowed, resolveLocalUpdateBase } from '../src/update-service.js'

function withEnv(env, fn) {
  const saved = {}
  for (const [key, value] of Object.entries(env)) {
    saved[key] = process.env[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try {
    return fn()
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

test('Dev E2E local update seam is enabled only for immutable dev E2E build + explicit switch + loopback HTTP', () => {
  const env = {
    DSH_DESKTOP_E2E_LOCAL_UPDATE: '1',
    DSH_DESKTOP_E2E_UPDATE_BASE_URL: 'http://127.0.0.1:45678',
  }
  assert.equal(isLocalUpdateAllowed({ buildFlavor: 'dev', e2eBuild: true, env }), true)
})

test('normal dev build without E2E capability is rejected', () => {
  const env = {
    DSH_DESKTOP_E2E_LOCAL_UPDATE: '1',
    DSH_DESKTOP_E2E_UPDATE_BASE_URL: 'http://127.0.0.1:45678',
  }
  assert.equal(isLocalUpdateAllowed({ buildFlavor: 'dev', e2eBuild: false, env }), false)
})

test('stable build is rejected even with E2E capability and DSH_DESKTOP_FLAVOR=dev', () => {
  const env = {
    DSH_DESKTOP_FLAVOR: 'dev',
    DSH_DESKTOP_E2E_LOCAL_UPDATE: '1',
    DSH_DESKTOP_E2E_UPDATE_BASE_URL: 'http://127.0.0.1:45678',
  }
  assert.equal(isLocalUpdateAllowed({ buildFlavor: 'stable', e2eBuild: true, env }), false)
})

test('non-loopback addresses are rejected', () => {
  for (const url of ['http://localhost:45678', 'http://127.0.0.2:45678', 'https://127.0.0.1:45678']) {
    const env = {
      DSH_DESKTOP_E2E_LOCAL_UPDATE: '1',
      DSH_DESKTOP_E2E_UPDATE_BASE_URL: url,
    }
    assert.equal(isLocalUpdateAllowed({ buildFlavor: 'dev', e2eBuild: true, env }), false, `expected ${url} to be rejected`)
  }
})

test('local update base URL must be the exact raw http://127.0.0.1:<port> form', () => {
  const rejected = [
    'http://127.1:45678',
    'http://2130706433:45678',
    'http://0x7f000001:45678',
    'http://user:pass@127.0.0.1:45678',
    'http://127.0.0.1:45678?x=1',
    'http://127.0.0.1:45678#frag',
    'http://127.0.0.1:45678/path',
    'http://127.0.0.1:45678/',
    'http://127.0.0.1:45678.',
    'http://127.0.0.1:0',
    'http://127.0.0.1:65536',
    'http://127.0.0.1:',
    'http://127.0.0.1:45678/path/',
    'http://127.0.0.1:45678?x=1#frag',
    'http://127.0.0.1:45678 ',
    ' http://127.0.0.1:45678',
  ]
  for (const url of rejected) {
    const env = {
      DSH_DESKTOP_E2E_LOCAL_UPDATE: '1',
      DSH_DESKTOP_E2E_UPDATE_BASE_URL: url,
    }
    assert.equal(isLocalUpdateAllowed({ buildFlavor: 'dev', e2eBuild: true, env }), false, `expected ${JSON.stringify(url)} to be rejected`)
  }
  for (const port of [1, 80, 443, 65535]) {
    const env = {
      DSH_DESKTOP_E2E_LOCAL_UPDATE: '1',
      DSH_DESKTOP_E2E_UPDATE_BASE_URL: `http://127.0.0.1:${port}`,
    }
    assert.equal(isLocalUpdateAllowed({ buildFlavor: 'dev', e2eBuild: true, env }), true, `expected port ${port} to be accepted`)
  }
})

test('missing E2E switch disables the seam', () => {
  const env = { DSH_DESKTOP_E2E_UPDATE_BASE_URL: 'http://127.0.0.1:45678' }
  assert.equal(isLocalUpdateAllowed({ buildFlavor: 'dev', e2eBuild: true, env }), false)
})

test('current source tree (stable, non-E2E) always resolves local update base to null', () => {
  const result = withEnv({
    DSH_DESKTOP_FLAVOR: 'dev',
    DSH_DESKTOP_E2E_LOCAL_UPDATE: '1',
    DSH_DESKTOP_E2E_UPDATE_BASE_URL: 'http://127.0.0.1:45678',
  }, () => resolveLocalUpdateBase())
  assert.equal(result, null)
})
