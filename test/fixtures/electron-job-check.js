import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { appendFileSync } from 'node:fs'
import { app } from 'electron'
import { createWindowsJobGuard } from '../../src/windows-job.js'

const mark = message => {
  if (process.env.DSH_JOB_CHECK_LOG) appendFileSync(process.env.DSH_JOB_CHECK_LOG, `${message}\n`, 'utf8')
}
mark('module-loaded')
app.whenReady().then(async () => {
  mark('app-ready')
  const child = spawn(process.env.DSH_NODE_EXECUTABLE || 'node.exe', [
    '-e',
    'setInterval(() => {}, 1000)',
  ], {
    stdio: 'ignore',
    windowsHide: true,
  })
  mark(`child-spawned:${child.pid}`)
  const guard = createWindowsJobGuard(child.pid)
  mark(`guard-created:${guard.active}:${guard.error ?? ''}`)
  if (!guard.active) {
    child.kill()
    throw new Error(guard.error)
  }
  const childExit = once(child, 'exit')
  guard.close()
  mark('guard-closed')
  await withTimeout(childExit, 3_000, 'Guarded Electron child remained alive.')
  mark('child-exited')
  console.log('electron-job-guard-ok')
  mark('app-exit')
  app.exit(0)
}).catch(error => {
  mark(`error:${error instanceof Error ? error.stack : String(error)}`)
  console.error(error)
  app.exit(1)
})

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
