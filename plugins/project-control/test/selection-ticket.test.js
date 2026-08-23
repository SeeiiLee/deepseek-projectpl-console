import assert from 'node:assert/strict'
import test from 'node:test'
import { issueProjectControlSelectionTicket } from '../../../src/project-control-selection-ticket.js'
import { verifyProjectControlSelectionTicket } from '../src/selection-ticket.ts'

test('Electron-issued directory capability verifies in the Harness Host boundary', () => {
  const secret = 'gate2c-cross-process-secret-that-is-long-enough'
  const nowMs = Date.parse('2026-08-15T00:00:00.000Z')
  const path = 'D:\\Projects\\Alpha'
  const authorization = issueProjectControlSelectionTicket({
    kind: 'project-root',
    path,
    secret,
    nowMs,
    nonce: '0198f4b2-7c3a-7d11-a5c6-6b6f39e34719',
  })
  assert.equal(verifyProjectControlSelectionTicket({
    kind: 'project-root',
    path,
    authorization,
    secret,
    nowMs: nowMs + 1000,
  }), true)
  assert.equal(verifyProjectControlSelectionTicket({
    kind: 'project-root',
    path: 'D:\\Projects\\Other',
    authorization,
    secret,
    nowMs: nowMs + 1000,
  }), false)
  assert.equal(verifyProjectControlSelectionTicket({
    kind: 'source-root',
    path,
    authorization,
    secret,
    nowMs: nowMs + 1000,
  }), false)
  assert.equal(verifyProjectControlSelectionTicket({
    kind: 'project-root',
    path,
    authorization,
    secret,
    nowMs: nowMs + (6 * 60 * 1000),
  }), false)
})
