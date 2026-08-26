import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import test from 'node:test'

import { appendBootLogLine, resolveBootLogPath } from '../src/boot-log.js'

test('boot log path is isolated below the supplied absolute userData', () => {
  const userData = join(tmpdir(), 'dsh-boot-log-path')
  const path = resolveBootLogPath(userData)
  assert.equal(path, join(userData, 'logs', 'boot-error.log'))
  assert.equal(relative(userData, path).startsWith('..'), false)
  assert.throws(() => resolveBootLogPath('relative-user-data'), /absolute userData/u)
})

test('boot log writer creates the isolated log directory and appends UTF-8 lines', () => {
  const userData = mkdtempSync(join(tmpdir(), 'dsh-boot-log-'))
  try {
    const now = () => new Date('2026-08-25T00:00:00.000Z')
    const first = appendBootLogLine({ userDataPath: userData, line: 'start', now })
    const second = appendBootLogLine({ userDataPath: userData, line: 'ready', now })
    assert.equal(first, second)
    assert.equal(dirname(first), join(userData, 'logs'))
    assert.equal(existsSync(first), true)
    assert.equal(
      readFileSync(first, 'utf8'),
      '2026-08-25T00:00:00.000Z start\n2026-08-25T00:00:00.000Z ready\n',
    )
  } finally {
    rmSync(userData, { recursive: true, force: true })
  }
})
