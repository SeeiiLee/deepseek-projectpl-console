import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { after, before, test } from 'node:test'
import {
  createTerminalRequestHandler,
  MAX_INPUT_CHARS,
  MAX_TABS_PER_SESSION,
  OutputRing,
  PlainTerminalDecoder,
  TerminalManager,
} from '../lib/index.js'

let workspace

before(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'dsh-session-terminal-'))
})

after(async () => {
  await rm(workspace, { recursive: true, force: true })
})

test('OutputRing reports dropped output and preserves monotonic cursors', () => {
  const ring = new OutputRing(4)
  ring.append('ab')
  ring.append('cde')
  assert.deepEqual(ring.read(0), { output: 'cde', cursor: 2, truncated: true })
  assert.deepEqual(ring.read(1), { output: 'cde', cursor: 2, truncated: false })
  ring.append('123456')
  assert.deepEqual(ring.read(2), { output: '3456', cursor: 3, truncated: true })
  assert.equal(ring.clear(), 3)
  assert.deepEqual(ring.read(2), { output: '', cursor: 3, truncated: true })
})

test('PlainTerminalDecoder keeps split UTF-8 and removes split terminal controls', () => {
  const decoder = new PlainTerminalDecoder()
  const chinese = Buffer.from('中文')
  assert.equal(decoder.write(chinese.subarray(0, 2)), '')
  const first = decoder.write(Buffer.concat([chinese.subarray(2), Buffer.from('\u001b[31')]))
  const second = decoder.write(Buffer.from('m红\u001b[0m\r'))
  const third = decoder.write(Buffer.from('\n完成'))
  assert.equal(first + second + third + decoder.end(), '中文红\n完成')
})

test('TerminalManager binds cwd to the Host session and preserves tabs, output, history, restart, and cleanup', async () => {
  const fake = new FakeSubprocess()
  let id = 0
  const manager = new TerminalManager({
    subprocess: fake,
    sessions: { get: sessionId => sessionId === 'session-a' ? { header: { cwd: workspace } } : undefined },
    platform: 'win32',
    env: {},
    now: () => 1234,
    makeId: () => `terminal-${++id}`,
  })

  const first = await manager.open('session-a')
  const second = await manager.open('session-a')
  assert.equal(first.name, 'PowerShell 1')
  assert.equal(second.name, 'PowerShell 2')
  assert.equal(first.cwd, workspace)
  assert.equal(fake.specs[0].cwd, workspace)
  assert.match(fake.specs[0].argv.at(-1), /UTF8Encoding/u)

  fake.handles[0].output.write(Buffer.from('\u001b[32m中文输出\u001b[0m\r\n'))
  await new Promise(resolve => setImmediate(resolve))
  const initial = manager.read('session-a', first.terminalId, 0)
  assert.equal(initial.output, '中文输出\n')
  const afterInitialCursor = initial.cursor
  assert.equal(manager.read('session-a', first.terminalId, afterInitialCursor).output, '')

  const written = await manager.write('session-a', first.terminalId, 'Get-Location')
  assert.deepEqual(written.history, ['Get-Location'])
  assert.deepEqual(fake.handles[0].writes, ['Get-Location\r'])
  await assert.rejects(
    manager.write('session-a', first.terminalId, 'x'.repeat(MAX_INPUT_CHARS + 1)),
    error => error.code === 'INVALID_TERMINAL_INPUT',
  )
  assert.throws(
    () => manager.read('session-b', first.terminalId, 0),
    error => error.code === 'TERMINAL_NOT_FOUND',
  )

  const cleared = manager.clear('session-a', first.terminalId)
  assert.equal(manager.read('session-a', first.terminalId, cleared.cursor).output, '')
  await manager.interrupt('session-a', first.terminalId)
  assert.equal(fake.handles[0].interrupts, 1)

  await manager.restart('session-a', first.terminalId)
  assert.equal(fake.handles[0].terminated, true)
  assert.equal(fake.handles.length, 3)
  assert.deepEqual(manager.list('session-a').map(tab => tab.terminalId), [first.terminalId, second.terminalId])

  await manager.close('session-a', second.terminalId)
  assert.equal(fake.handles[1].terminated, true)
  assert.equal(manager.list('session-a').length, 1)
  await manager.dispose()
  assert.equal(fake.handles[2].terminated, true)
})

test('TerminalManager enforces per-session tab bounds before spawning', async () => {
  const fake = new FakeSubprocess()
  let id = 0
  const manager = new TerminalManager({
    subprocess: fake,
    sessions: { get: () => ({ header: { cwd: workspace } }) },
    platform: 'win32',
    env: {},
    makeId: () => `bounded-${++id}`,
  })
  for (let index = 0; index < MAX_TABS_PER_SESSION; index += 1) await manager.open('bounded-session')
  await assert.rejects(manager.open('bounded-session'), error => error.code === 'TAB_LIMIT')
  assert.equal(fake.handles.length, MAX_TABS_PER_SESSION)
  await manager.dispose()
})

test('HTTP API requires its client header and supports cursor reconnect without accepting a cwd', async () => {
  const fake = new FakeSubprocess()
  const manager = new TerminalManager({
    subprocess: fake,
    sessions: { get: id => id === 'http-session' ? { header: { cwd: workspace } } : undefined },
    platform: 'win32',
    env: {},
    makeId: () => 'http-terminal',
  })
  const server = createServer(createTerminalRequestHandler(manager))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.notEqual(address, null)
  assert.equal(typeof address, 'object')
  const base = `http://127.0.0.1:${address.port}/__personal/terminal`

  try {
    const denied = await fetch(`${base}/tabs?sessionId=http-session`)
    assert.equal(denied.status, 403)

    const opened = await jsonFetch(`${base}/tabs`, {
      method: 'POST',
      body: JSON.stringify({ sessionId: 'http-session', cwd: 'C:\\untrusted' }),
    })
    assert.equal(opened.data.cwd, workspace)

    fake.handles[0].output.write(Buffer.from('ready\r\n'))
    await new Promise(resolve => setImmediate(resolve))
    const first = await jsonFetch(`${base}/output?sessionId=http-session&terminalId=http-terminal&cursor=0`)
    assert.equal(first.data.output, 'ready\n')
    const resumed = await jsonFetch(`${base}/output?sessionId=http-session&terminalId=http-terminal&cursor=${first.data.cursor}`)
    assert.equal(resumed.data.output, '')
    assert.equal(resumed.data.truncated, false)
  } finally {
    await manager.dispose()
    await new Promise((resolve, reject) => server.close(error => { if (error) reject(error); else resolve() }))
  }
})

async function jsonFetch(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      'x-dsh-personal-terminal': '1',
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...init.headers,
    },
  })
  const body = await response.json()
  assert.equal(response.status, 200, JSON.stringify(body))
  assert.equal(body.ok, true)
  return body
}

class FakeSubprocess {
  handles = []
  specs = []

  async resolveExecutable(candidate) {
    if (candidate === 'pwsh.exe') return 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'
    throw new Error('not found')
  }

  async spawnTerminal(spec) {
    this.specs.push(spec)
    const handle = new FakeTerminalHandle(10_000 + this.handles.length)
    this.handles.push(handle)
    return handle
  }
}

class FakeTerminalHandle {
  output = new PassThrough()
  writes = []
  interrupts = 0
  terminated = false
  #settled
  #resolve

  constructor(pid) {
    this.pid = pid
    this.#settled = new Promise(resolve => { this.#resolve = resolve })
    this.done = this.#settled
  }

  async write(value) {
    if (this.terminated) throw new Error('terminated')
    this.writes.push(value)
  }

  async signalForeground(signal) {
    assert.equal(signal, 'SIGINT')
    this.interrupts += 1
    return this.pid
  }

  async terminate() {
    if (this.terminated) return
    this.terminated = true
    this.output.end()
    this.#resolve({ exitCode: 0, signal: null })
  }
}
