import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { prepareSmokeExecutable } from '../scripts/smoke-executable.js'

test('packaged verification runs a Smoke-named copy and cleans it up', t => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-smoke-exe-'))
  t.after(() => { rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) })
  const original = join(root, 'DeepSeek Harness Personal.exe')
  writeFileSync(original, 'fake-executable')

  const prepared = prepareSmokeExecutable(original)
  assert.notEqual(prepared, null)
  assert.equal(prepared.executable, join(root, 'DeepSeek Harness Personal-Smoke.exe'))
  assert.equal(existsSync(prepared.executable), true)
  assert.equal(existsSync(original), true, 'the real executable is never touched')

  prepared.cleanup()
  assert.equal(existsSync(prepared.executable), false)

  // already-Smoke names and non-exe stems need no copy
  assert.equal(prepareSmokeExecutable(join(root, 'DeepSeek Harness Personal-Smoke.exe')), null)
  assert.equal(prepareSmokeExecutable(join(root, 'missing.exe')), null)
})