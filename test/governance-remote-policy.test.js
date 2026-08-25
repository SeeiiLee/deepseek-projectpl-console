import assert from 'node:assert/strict'
import test from 'node:test'
import {
  GOVERNANCE_PUSH_POLICY,
  validateGitRemotePolicy,
} from '../scripts/governance-remote-policy.js'

const url = 'https://github.com/SeeiiLee/deepseek-projectpl-console.git'
const approved = [{
  name: 'origin',
  fetchUrl: url,
  pushPolicy: GOVERNANCE_PUSH_POLICY,
}]

function origin(overrides = {}) {
  return {
    name: 'origin',
    fetchUrls: [url],
    effectivePushUrls: [url],
    explicitPushUrls: [],
    ...overrides,
  }
}

test('an exactly declared origin passes without granting push authority', () => {
  assert.deepEqual(validateGitRemotePolicy([origin()], approved), { ok: true, failures: [] })
})

test('an undeclared extra remote and a missing approved remote fail closed', () => {
  const extra = validateGitRemotePolicy([
    origin(),
    { ...origin(), name: 'backup' },
  ], approved)
  assert.equal(extra.ok, false)
  assert.equal(extra.failures.some(failure => failure.code === 'UNDECLARED_REMOTE'), true)

  const missing = validateGitRemotePolicy([], approved)
  assert.deepEqual(missing.failures, [{ code: 'APPROVED_REMOTE_MISSING', name: 'origin' }])
})

test('fetch URL drift and explicit push URL overrides fail closed', () => {
  const result = validateGitRemotePolicy([origin({
    fetchUrls: ['https://example.invalid/wrong.git'],
    explicitPushUrls: ['https://example.invalid/push.git'],
  })], approved)
  assert.equal(result.ok, false)
  assert.equal(result.failures.some(failure => failure.code === 'FETCH_URL_MISMATCH'), true)
  assert.equal(result.failures.some(failure => failure.code === 'EXPLICIT_PUSH_URL_FORBIDDEN'), true)
})

test('invalid or duplicate approved declarations fail closed', () => {
  const invalid = validateGitRemotePolicy([origin()], [{
    name: 'origin',
    fetchUrl: url,
    pushPolicy: 'always-allowed',
  }])
  assert.equal(invalid.failures[0].code, 'APPROVED_REMOTE_INVALID')

  const duplicate = validateGitRemotePolicy([origin()], [...approved, ...approved])
  assert.equal(duplicate.failures.some(failure => failure.code === 'APPROVED_REMOTE_DUPLICATE'), true)
})
