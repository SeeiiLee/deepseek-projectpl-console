import assert from 'node:assert/strict'
import test from 'node:test'
import { createMinimalEnvironment, preflightHarnessRuntime } from '../src/runtime-preflight.js'

test('runtime preflight removes inherited credentials and uses isolated directories', async () => {
  let launchOptions
  await preflightHarnessRuntime('D:\\candidate', {
    environment: {
      PATH: 'kept',
      SystemRoot: 'C:\\Windows',
      DEEPSEEK_API_KEY: 'real',
      SERVICE_TOKEN: 'secret',
      GITHUB_PAT: 'github-secret',
      AWS_ACCESS_KEY_ID: 'aws-secret',
      SSH_AUTH_SOCK: 'agent-secret',
      NPM_CONFIG_USERCONFIG: 'C:\\Users\\real\\.npmrc',
    },
    launch(options) {
      launchOptions = options
      return {
        ready: Promise.resolve(new URL('http://127.0.0.1:12345/')),
        stop: async () => ({ graceful: true, forced: false, code: 0, signal: null }),
      }
    },
  })
  assert.equal(launchOptions.env.PATH, 'kept')
  assert.equal(launchOptions.env.SERVICE_TOKEN, undefined)
  assert.equal(launchOptions.env.DEEPSEEK_API_KEY, undefined)
  assert.equal(launchOptions.env.GITHUB_PAT, undefined)
  assert.equal(launchOptions.env.AWS_ACCESS_KEY_ID, undefined)
  assert.equal(launchOptions.env.SSH_AUTH_SOCK, undefined)
  assert.notEqual(launchOptions.env.NPM_CONFIG_USERCONFIG, 'C:\\Users\\real\\.npmrc')
  assert.match(launchOptions.env.NPM_CONFIG_USERCONFIG, /empty-npmrc$/u)
  assert.match(launchOptions.env.TEMP, /process-home[\\/]AppData[\\/]Local[\\/]Temp$/u)
  assert.match(launchOptions.env.COREPACK_HOME, /process-home[\\/]AppData[\\/]Local[\\/]Corepack$/u)
  assert.match(launchOptions.env.NPM_CONFIG_STORE_DIR, /process-home[\\/]AppData[\\/]Local[\\/]pnpm-store$/u)
  assert.equal(launchOptions.env.GIT_TERMINAL_PROMPT, '0')
  assert.notEqual(launchOptions.env.USERPROFILE, process.env.USERPROFILE)
  assert.notEqual(launchOptions.env.DSH_HOME, process.env.DSH_HOME)
  assert.match(launchOptions.env.PROJECT_CONTROL_HOME, /project-control$/u)
  assert.notEqual(launchOptions.env.PROJECT_CONTROL_HOME, process.env.PROJECT_CONTROL_HOME)
  assert.match(launchOptions.env.PROJECT_CONTROL_SELECTION_SECRET, /^[A-Za-z0-9_-]{43}$/u)
  assert.notEqual(
    launchOptions.env.PROJECT_CONTROL_SELECTION_SECRET,
    process.env.PROJECT_CONTROL_SELECTION_SECRET,
  )
})

test('minimal child environment keeps only process-launch and locale settings', () => {
  assert.deepEqual(createMinimalEnvironment({
    KEYBOARD_LAYOUT: 'zh-CN',
    PATH: 'x',
    SystemRoot: 'C:\\Windows',
    LANG: 'zh_CN.UTF-8',
    GITHUB_PAT: 'no',
    AWS_ACCESS_KEY_ID: 'no',
    SSH_AUTH_SOCK: 'no',
    NPM_CONFIG_USERCONFIG: 'no',
    NODE_OPTIONS: '--require attacker.js',
  }), {
    PATH: 'x',
    SystemRoot: 'C:\\Windows',
    LANG: 'zh_CN.UTF-8',
  })
})

test('runtime preflight propagates an unconfirmed supervisor cleanup', async () => {
  let registered
  let removed = false
  await assert.rejects(preflightHarnessRuntime('D:\\candidate', {
    environment: { PATH: 'kept' },
    launch() {
      return {
        ready: Promise.reject(new Error('boot failed')),
        stop: async () => { throw new Error('tree still alive') },
      }
    },
    onSupervisor(supervisor) { registered = supervisor },
    onSupervisorStopped() { removed = true },
  }), /无法确认 Harness 更新预检进程已经退出/u)
  assert.notEqual(registered, undefined)
  assert.equal(removed, false)
})
