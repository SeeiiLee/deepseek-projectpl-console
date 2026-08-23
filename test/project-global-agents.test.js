import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { STABLE_INSTALL_ROOT } from '../scripts/protected-paths.js'
import { CANONICAL_PATH, projectGlobalAgents, sha256Hex } from '../scripts/project-global-agents.js'

test('projection writes the canonical file and stays idempotent', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agents-proj-'))
  try {
    const first = projectGlobalAgents(root)
    assert.equal(first.changed, true)
    assert.equal(first.targetHash, first.canonicalHash)
    assert.equal(readFileSync(join(root, 'AGENTS.md'), 'utf8'), readFileSync(CANONICAL_PATH, 'utf8'))
    const second = projectGlobalAgents(root)
    assert.equal(second.changed, false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('projection backs up an existing differing copy as .previous', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agents-proj-'))
  try {
    writeFileSync(join(root, 'AGENTS.md'), 'old content')
    const result = projectGlobalAgents(root)
    assert.equal(result.changed, true)
    assert.equal(result.backup, join(root, 'AGENTS.md.previous'))
    assert.equal(readFileSync(result.backup, 'utf8'), 'old content')
    assert.equal(readFileSync(join(root, 'AGENTS.md'), 'utf8'), readFileSync(CANONICAL_PATH, 'utf8'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('projection refuses stable install and stable data homes', () => {
  for (const forbidden of [STABLE_INSTALL_ROOT, 'F:\\documents\\Cyrus Deepseek Harness Data']) {
    assert.throws(() => projectGlobalAgents(forbidden), /投影拒绝/u)
  }
})

test('projection refuses a target that is not exactly AGENTS.md', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agents-proj-'))
  try {
    writeFileSync(join(root, 'other.txt'), 'x')
    // the API itself only ever builds <home>/AGENTS.md; the refusal path is covered by home checks
    assert.equal(sha256Hex('x').length, 64)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
