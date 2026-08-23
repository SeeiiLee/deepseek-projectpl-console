import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import test from 'node:test'
import { createWindowsJobGuard } from '../src/windows-job.js'

test('invalid process IDs do not create an active guard', () => {
  const guard = createWindowsJobGuard(0)
  assert.equal(guard.active, false)
  assert.match(guard.error, /valid process ID/i)
  guard.close()
})

test('closing a Windows Job Object kills the owned process tree', {
  skip: process.platform !== 'win32',
  timeout: 10_000,
}, async () => {
  const childScript = [
    "const { spawn } = require('node:child_process')",
    "const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true })",
    'console.log(grandchild.pid)',
    'setInterval(() => {}, 1000)',
  ].join(';')
  const child = spawn(process.execPath, ['-e', childScript], {
    stdio: ['ignore', 'pipe', 'ignore'],
    windowsHide: true,
  })
  let grandchildPid
  try {
    const [chunk] = await once(child.stdout, 'data')
    grandchildPid = Number(String(chunk).trim())
    assert.ok(Number.isSafeInteger(grandchildPid) && grandchildPid > 0)
    const guard = createWindowsJobGuard(child.pid)
    assert.equal(guard.active, true, guard.error)
    const childExit = once(child, 'exit')
    guard.close()
    await withTimeout(childExit, 3_000, 'guarded child remained alive')
    await waitUntilNotAlive(grandchildPid)
  } finally {
    if (isAlive(child.pid)) {
      spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
        windowsHide: true,
        stdio: 'ignore',
      })
    } else if (isAlive(grandchildPid)) {
      spawnSync('taskkill.exe', ['/pid', String(grandchildPid), '/f'], {
        windowsHide: true,
        stdio: 'ignore',
      })
    }
  }
})

async function waitUntilNotAlive(pid) {
  const deadline = Date.now() + 3_000
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  assert.equal(isAlive(pid), false, `process ${pid} remained alive`)
}

function isAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code !== 'ESRCH'
  }
}

function withTimeout(promise, timeoutMs, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs)
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
