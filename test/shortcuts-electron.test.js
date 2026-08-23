import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'
import test from 'node:test'

test('Electron repairs a real broken portable shortcut after the executable moves', {
  skip: process.platform !== 'win32',
  timeout: 15_000,
}, async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-electron-shortcut-'))
  const resultPath = join(root, 'result.json')
  const fixture = fileURLToPath(new URL('./fixtures/electron-shortcut-check.js', import.meta.url))
  const child = spawn(electronPath, [fixture], {
    env: {
      ...process.env,
      DSH_SHORTCUT_CHECK_ROOT: root,
      DSH_SHORTCUT_CHECK_RESULT: resultPath,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  })
  const stderr = []
  child.stderr.on('data', chunk => stderr.push(String(chunk)))
  try {
    const [code, signal] = await withTimeout(once(child, 'exit'), 8_000)
    const result = JSON.parse(readFileSync(resultPath, 'utf8'))
    assert.equal(signal, null)
    assert.equal(code, 0, result.error ?? stderr.join(''))
    assert.equal(result.created[0].status, 'created')
    assert.equal(result.repaired[0].status, 'updated')
    assert.equal(result.stable[0].status, 'current')
    assert.equal(
      statSync(result.details.target, { bigint: true }).ino,
      statSync(join(root, 'moved', 'portable.exe'), { bigint: true }).ino,
    )
  } finally {
    if (child.exitCode === null) child.kill()
    rmSync(root, { recursive: true, force: true })
  }
})

function withTimeout(promise, timeoutMs) {
  return new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => rejectPromise(new Error('Electron shortcut fixture timed out.')), timeoutMs)
    promise.then(
      value => {
        clearTimeout(timer)
        resolvePromise(value)
      },
      error => {
        clearTimeout(timer)
        rejectPromise(error)
      },
    )
  })
}
