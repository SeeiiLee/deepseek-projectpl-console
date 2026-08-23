// Run the AnySearch beta gate with live console output AND a UTF-8 log.
import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const log = createWriteStream(resolve(root, 'anysearch-build.log'), { encoding: 'utf8' })
const steps = [
  ['check:plugins', 'npx pnpm@11.19.0 run check:plugins'],
  ['pack:dev:portable', 'npx pnpm@11.19.0 run pack:dev:portable'],
  ['stage dev release', 'node scripts/stage-releases.js dev'],
]

function now() {
  return new Date().toISOString()
}

for (const [label, command] of steps) {
  const header = `\n=== ${label} (${command}) ===\n`
  process.stdout.write(header)
  log.write(header)

  const child = spawn(command, { cwd: root, shell: true, windowsHide: false })
  child.stdout.on('data', (chunk) => {
    process.stdout.write(chunk)
    log.write(chunk)
  })
  child.stderr.on('data', (chunk) => {
    process.stderr.write(chunk)
    log.write(chunk)
  })

  const code = await new Promise((resolveClose) => {
    child.on('error', (error) => {
      const text = `spawn error: ${String(error)}\n`
      process.stderr.write(text)
      log.write(text)
      resolveClose(127)
    })
    child.on('close', resolveClose)
  })

  const footer = `\nstep_exit=${String(code)} at ${now()}\n`
  process.stdout.write(footer)
  log.write(footer)
  if (code !== 0) {
    process.exitCode = code
    break
  }
}

log.end()
