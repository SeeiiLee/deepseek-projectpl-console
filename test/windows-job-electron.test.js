import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'
import test from 'node:test'

test('Windows Job Object guard loads and works in the Electron runtime', {
  skip: process.platform !== 'win32',
  timeout: 15_000,
}, async () => {
  const fixture = fileURLToPath(new URL('./fixtures/electron-job-check.js', import.meta.url))
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'dsh-electron-job-'))
  const logPath = join(temporaryDirectory, 'steps.log')
  const child = spawn(electronPath, [fixture], {
    env: {
      ...process.env,
      DSH_NODE_EXECUTABLE: process.execPath,
      DSH_JOB_CHECK_LOG: logPath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const stdout = []
  const stderr = []
  child.stdout.on('data', chunk => stdout.push(String(chunk)))
  child.stderr.on('data', chunk => stderr.push(String(chunk)))
  try {
    const [code, signal] = child.exitCode === null
      ? await withTimeout(
        once(child, 'exit'),
        8_000,
        () => `Electron guard fixture timed out.\n${safeRead(logPath)}`,
      )
      : [child.exitCode, child.signalCode]
    assert.equal(signal, null)
    assert.equal(code, 0, `${stderr.join('')}\n${readFileSync(logPath, 'utf8')}`)
    assert.match(readFileSync(logPath, 'utf8'), /guard-created:true:/)
    assert.match(readFileSync(logPath, 'utf8'), /child-exited/)
  } finally {
    if (child.exitCode === null) child.kill()
    rmSync(temporaryDirectory, { recursive: true, force: true })
  }
})

function safeRead(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    return error?.code === 'ENOENT' ? '(no fixture log)' : String(error)
  }
}

function withTimeout(promise, timeoutMs, createMessage) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(createMessage())), timeoutMs)
    promise.then(
      value => {
        clearTimeout(timer)
        resolve(value)
      },
      error => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}
