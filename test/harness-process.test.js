import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { launchHarness } from '../src/harness-process.js'

const sourceRoot = process.env.DSH_SOURCE_ROOT ?? 'D:\\Deepseek Harness'
const helperPath = fileURLToPath(new URL('../fixtures/fake-harness-helper.js', import.meta.url))

function launchFake(mode, options = {}) {
  return launchHarness({
    sourceRoot,
    workspaceRoot: process.cwd(),
    helperPath,
    importTsx: false,
    startupTimeoutMs: options.startupTimeoutMs ?? 2_000,
    shutdownTimeoutMs: options.shutdownTimeoutMs ?? 2_000,
    forceExitTimeoutMs: options.forceExitTimeoutMs,
    processGuardFactory: options.processGuardFactory,
    terminateProcessTree: options.terminateProcessTree,
    externalPluginsRoot: options.externalPluginsRoot,
    desktopFlavor: options.desktopFlavor,
    env: { ...process.env, FAKE_HARNESS_MODE: mode },
  })
}

test('supervisor reaches readiness and acknowledges one idempotent stop', async () => {
  const supervisor = launchFake('ready')
  assert.equal((await supervisor.ready).href, 'http://127.0.0.1:54321/')
  const [first, second] = await Promise.all([supervisor.stop(), supervisor.stop()])
  assert.deepEqual(first, second)
  assert.equal(first.graceful, true)
  assert.equal(first.forced, false)
  assert.equal(first.code, 0)
})

test('launchHarness injects the trusted external root and flavor into the helper env', async () => {
  const supervisor = launchFake('echo-env', {
    externalPluginsRoot: 'C:\\ext\\plugins-external',
    desktopFlavor: 'stable',
  })
  await supervisor.ready
  const output = supervisor.recentOutput()
  assert.match(output, /ENV:C:\\ext\\plugins-external:stable/u)
  const result = await supervisor.stop()
  assert.equal(result.graceful, true)
})

test('supervisor rejects an invalid readiness line and cleans up', async () => {
  const supervisor = launchFake('invalid-ready')
  await assert.rejects(supervisor.ready, /untrusted readiness/i)
  const result = await supervisor.stop()
  assert.equal(result.graceful, true)
})

test('supervisor times out and still cleans up the helper', async () => {
  const supervisor = launchFake('silent', { startupTimeoutMs: 200 })
  await assert.rejects(supervisor.ready, /did not become ready/i)
  const result = await supervisor.stop()
  assert.equal(result.graceful, true)
})

test('supervisor reports an early helper exit', async () => {
  const supervisor = launchFake('early-exit')
  await assert.rejects(supervisor.ready, /exited before readiness/i)
  const result = await supervisor.stop()
  assert.equal(result.graceful, false)
  assert.equal(result.code, 7)
})

test('readiness waits for both the URL and the booted acknowledgement', async () => {
  const supervisor = launchFake('delayed-booted')
  const premature = await Promise.race([
    supervisor.ready.then(() => true),
    new Promise(resolvePromise => setTimeout(() => resolvePromise(false), 50)),
  ])
  assert.equal(premature, false)
  assert.equal((await supervisor.ready).href, 'http://127.0.0.1:54321/')
  await supervisor.stop()
})

test('an immediate stop cancels readiness and exits the helper', async () => {
  const supervisor = launchFake('silent')
  const stopping = supervisor.stop()
  await assert.rejects(supervisor.ready, error => error?.name === 'AbortError')
  assert.equal((await stopping).graceful, true)
})

test('a stopped acknowledgement followed by exit 1 is not graceful', async () => {
  const supervisor = launchFake('ack-exit-one')
  await supervisor.ready
  const result = await supervisor.stop()
  assert.equal(result.graceful, false)
  assert.equal(result.code, 1)
})

test('an unresponsive helper is forcibly terminated', async () => {
  const supervisor = launchFake('ignore-shutdown', { shutdownTimeoutMs: 100 })
  await supervisor.ready
  const result = await supervisor.stop()
  assert.equal(result.graceful, false)
  assert.equal(result.forced, true)
})

test('a failed forced stop can be retried until the helper exit is confirmed', async () => {
  let terminationAttempts = 0
  const supervisor = launchFake('ignore-shutdown', {
    shutdownTimeoutMs: 100,
    forceExitTimeoutMs: 1_000,
    processGuardFactory: () => ({ active: false, error: 'disabled by test', close() {} }),
    async terminateProcessTree(pid) {
      terminationAttempts += 1
      if (terminationAttempts === 1) throw new Error('simulated taskkill failure')
      process.kill(pid, 'SIGKILL')
    },
  })
  await supervisor.ready
  await assert.rejects(supervisor.stop(), /did not exit after forced termination/u)
  await Promise.resolve()
  const result = await supervisor.stop()
  assert.equal(terminationAttempts, 2)
  assert.equal(result.forced, true)
})
