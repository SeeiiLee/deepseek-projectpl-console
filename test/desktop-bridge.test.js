import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import {
  assertBridgeAvailable,
  isAllowedBillingNavigation,
  isSafeExternalUrl,
  isSafeLocalAbsoluteDirectory,
  registerDesktopBridge,
  validateDesktopRequest,
  validateProjectControlDirectoryRequest,
  validateUpdateRequest,
} from '../src/desktop-bridge.js'
import {
  issueProjectControlSelectionTicket,
  verifyProjectControlSelectionTicket,
} from '../src/project-control-selection-ticket.js'

const TEST_SELECTION_SECRET = 'test-selection-secret-that-is-at-least-32-bytes'

test('desktop bridge rejects new privileged work while shutdown is in progress', () => {
  assert.doesNotThrow(() => assertBridgeAvailable(() => false))
  assert.throws(() => assertBridgeAvailable(() => true), /正在退出/u)
})

test('desktop integration IPC only accepts complete settings', () => {
  assert.deepEqual(validateDesktopRequest({ action: 'get-state' }), { action: 'get-state', payload: undefined })
  const payload = { closeToTray: true, maintainShortcuts: { desktop: true, startMenu: false } }
  assert.deepEqual(validateDesktopRequest({ action: 'configure', payload }), { action: 'configure', payload })
  assert.throws(() => validateDesktopRequest({ action: 'configure', payload: { closeToTray: true } }), /Invalid/u)
})

test('desktop file actions accept local absolute paths and reject anything else', () => {
  assert.deepEqual(validateDesktopRequest({ action: 'open-path', payload: 'D:\\Docs\\需求.md' }), { action: 'open-path', payload: 'D:\\Docs\\需求.md' })
  assert.deepEqual(validateDesktopRequest({ action: 'read-file-as-data-url', payload: 'D:/Docs/pic.png' }), { action: 'read-file-as-data-url', payload: 'D:/Docs/pic.png' })
  assert.throws(() => validateDesktopRequest({ action: 'open-path', payload: './docs/需求.md' }), /Invalid local file path/u)
  assert.throws(() => validateDesktopRequest({ action: 'open-path', payload: 'https://example.com/x.md' }), /Invalid local file path/u)
  assert.throws(() => validateDesktopRequest({ action: 'open-path', payload: '\\\\server\\share\\x.md' }), /Invalid local file path/u)
  assert.throws(() => validateDesktopRequest({ action: 'read-file-as-data-url', payload: 'relative/pic.png' }), /Invalid local file path/u)
  assert.throws(() => validateDesktopRequest({ action: 'read-file-as-data-url' }), /Invalid local file path/u)
  assert.throws(() => validateDesktopRequest({ action: 'read-file-as-data-url', payload: 'D:/bad\u0000name.png' }), /Invalid local file path/u)
})

test('open-path and read-file-as-data-url round-trip through the registered bridge', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const directory = mkdtempSync(join(tmpdir(), 'dsh-desktop-bridge-'))
  const pngPath = join(directory, 'pixel.png')
  // 1x1 透明 PNG
  writeFileSync(pngPath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'))

  const opened = []
  const { handlers, dispose } = createRegisteredBridge({
    shell: {
      openExternal: async () => {},
      openPath: async target => { opened.push(target); return target.endsWith('missing.md') ? 'No such file' : '' },
    },
  })
  const invoke = handlers.get('dsh-personal:desktop')

  const read = await invoke({}, { action: 'read-file-as-data-url', payload: pngPath })
  assert.equal(read.ok, true)
  assert.match(read.dataUrl, /^data:image\/png;base64,/u)

  const missing = await invoke({}, { action: 'read-file-as-data-url', payload: join(directory, 'missing.png') })
  assert.equal(missing.ok, false)
  assert.equal(missing.error, 'not-found')

  const openedOk = await invoke({}, { action: 'open-path', payload: pngPath })
  assert.deepEqual(openedOk, { ok: true, error: undefined })
  assert.deepEqual(opened, [pngPath])

  const openedMissing = await invoke({}, { action: 'open-path', payload: join(directory, 'missing.md') })
  assert.equal(openedMissing.ok, false)
  assert.equal(typeof openedMissing.error, 'string')

  await assert.rejects(() => invoke({}, { action: 'open-path', payload: './relative.md' }), /Invalid local file path/u)
  await assert.rejects(() => invoke({}, { action: 'read-file-as-data-url', payload: 'not-a-path' }), /Invalid local file path/u)
  dispose()
})

test('open-external accepts only http(s) URLs and round-trips through the bridge', async () => {
  assert.equal(isSafeExternalUrl('https://example.com/x?y=1'), true)
  assert.equal(isSafeExternalUrl('http://localhost:3000/preview'), true)
  assert.equal(isSafeExternalUrl('file:///D:/docs/a.md'), false)
  assert.equal(isSafeExternalUrl('javascript:alert(1)'), false)
  assert.equal(isSafeExternalUrl('dsh://internal'), false)
  assert.equal(isSafeExternalUrl('https://'), false)
  assert.equal(isSafeExternalUrl(''), false)
  assert.equal(isSafeExternalUrl('https://example.com/' + 'x'.repeat(4096)), false)
  assert.throws(() => validateDesktopRequest({ action: 'open-external', payload: 'file:///etc/passwd' }), /Invalid external URL/u)
  assert.throws(() => validateDesktopRequest({ action: 'open-external', payload: './docs/a.md' }), /Invalid external URL/u)
  assert.throws(() => validateDesktopRequest({ action: 'open-external' }), /Invalid external URL/u)

  const opened = []
  const { handlers, dispose } = createRegisteredBridge({
    shell: {
      openExternal: async target => { opened.push(target); if (target.includes('fail')) throw new Error('no browser') },
      openPath: async () => '',
    },
  })
  const invoke = handlers.get('dsh-personal:desktop')
  assert.deepEqual(await invoke({}, { action: 'open-external', payload: 'https://example.com/docs' }), { ok: true })
  assert.deepEqual(opened, ['https://example.com/docs'])
  const failed = await invoke({}, { action: 'open-external', payload: 'https://fail.example.com' })
  assert.equal(failed.ok, false)
  assert.equal(failed.error, 'no browser')
  await assert.rejects(() => invoke({}, { action: 'open-external', payload: 'javascript:alert(1)' }), /Invalid external URL/u)
  dispose()
})

test('desktop update IPC only accepts its fixed action vocabulary', () => {
  assert.deepEqual(validateUpdateRequest({ action: 'get-state' }), { action: 'get-state', payload: undefined })
  assert.deepEqual(validateUpdateRequest({ action: 'open-release', payload: 'harness' }), { action: 'open-release', payload: 'harness' })
  assert.throws(() => validateUpdateRequest({ action: 'spawn', payload: 'cmd.exe' }), /Invalid/u)
  assert.throws(() => validateUpdateRequest({ action: 'open-release', payload: 'https://example.com' }), /Invalid/u)
})

test('billing navigation stays on official DeepSeek HTTPS hosts', () => {
  assert.equal(isAllowedBillingNavigation('https://platform.deepseek.com/top_up'), true)
  assert.equal(isAllowedBillingNavigation('https://auth.deepseek.com/login'), true)
  assert.equal(isAllowedBillingNavigation('http://platform.deepseek.com/top_up'), false)
  assert.equal(isAllowedBillingNavigation('https://deepseek.com.example.org/top_up'), false)
})

test('preload exposes only the fixed Project Control directory picker contract', async () => {
  const invocations = []
  let exposed
  const source = readFileSync(new URL('../src/preload.cjs', import.meta.url), 'utf8')
  vm.runInNewContext(source, {
    require(specifier) {
      assert.equal(specifier, 'electron')
      return {
        contextBridge: {
          exposeInMainWorld(name, value) {
            assert.equal(name, 'deepseekHarnessPersonal')
            exposed = value
          },
        },
        ipcRenderer: {
          invoke(...args) {
            invocations.push(args)
            return Promise.resolve({ ok: true, canceled: true })
          },
        },
      }
    },
  })

  assert.equal(Object.isFrozen(exposed.projectControl), true)
  assert.deepEqual(await exposed.projectControl.selectDirectory('source-root'), { ok: true, canceled: true })
  assert.deepEqual(JSON.parse(JSON.stringify(invocations.at(-1))), [
    'dsh-personal:project-control',
    { action: 'select-directory', kind: 'source-root' },
  ])
  assert.equal(exposed.projectControl.openUrl, undefined)
  assert.equal(exposed.projectControl.runCommand, undefined)
})

test('Project Control picker rejects every kind outside its fixed vocabulary', () => {
  assert.deepEqual(
    validateProjectControlDirectoryRequest({ action: 'select-directory', kind: 'project-root' }),
    { kind: 'project-root' },
  )
  assert.throws(
    () => validateProjectControlDirectoryRequest({ action: 'select-directory', kind: 'docs-root' }),
    /Invalid Project Control/u,
  )
  assert.throws(
    () => validateProjectControlDirectoryRequest({ action: 'open-url', kind: 'project-root' }),
    /Invalid Project Control/u,
  )
})

test('Project Control picker accepts local absolute paths and rejects relative or UNC paths', () => {
  assert.equal(isSafeLocalAbsoluteDirectory('D:\\Projects\\Meal Tracker'), true)
  assert.equal(isSafeLocalAbsoluteDirectory('D:/Projects/Meal Tracker'), true)
  assert.equal(isSafeLocalAbsoluteDirectory('Projects\\Meal Tracker'), false)
  assert.equal(isSafeLocalAbsoluteDirectory('\\\\server\\share\\project'), false)
  assert.equal(isSafeLocalAbsoluteDirectory('\\\\?\\UNC\\server\\share\\project'), false)
  assert.equal(isSafeLocalAbsoluteDirectory("D:\\Projects\\bad\nname"), false)
})

test('Project Control selection tickets bind path, kind, expiry, and secret', () => {
  const authorization = issueProjectControlSelectionTicket({
    kind: 'project-root',
    path: 'D:\\Projects\\Meal Tracker',
    secret: TEST_SELECTION_SECRET,
    nowMs: 1_700_000_000_000,
    nonce: '018bcfe5-6800-7000-8000-000000000001',
  })
  const base = {
    kind: 'project-root',
    path: 'D:\\Projects\\Meal Tracker',
    secret: TEST_SELECTION_SECRET,
    authorization,
    nowMs: 1_700_000_000_001,
  }
  assert.equal(verifyProjectControlSelectionTicket(base), true)
  assert.equal(verifyProjectControlSelectionTicket({ ...base, path: 'D:\\Projects\\Other' }), false)
  assert.equal(verifyProjectControlSelectionTicket({ ...base, kind: 'source-root' }), false)
  assert.equal(verifyProjectControlSelectionTicket({ ...base, nowMs: Date.parse(authorization.expiresAt) + 1 }), false)
})

test('Project Control picker returns native cancellation and a validated local directory', async () => {
  const responses = [
    { canceled: true, filePaths: [] },
    { canceled: false, filePaths: ['D:\\Projects\\Meal Tracker'] },
  ]
  const { handlers, calls, dispose } = createRegisteredBridge({
    showOpenDialog: async (owner, dialogOptions) => {
      calls.push({ owner, dialogOptions })
      return responses.shift()
    },
  })
  const invoke = handlers.get('dsh-personal:project-control')

  assert.deepEqual(await invoke({}, directoryRequest('source-root')), { ok: true, canceled: true })
  const selected = await invoke({}, directoryRequest('project-root'))
  assert.equal(selected.ok, true)
  assert.equal(selected.canceled, false)
  assert.equal(selected.path, 'D:\\Projects\\Meal Tracker')
  assert.equal(selected.authorization.kind, 'project-root')
  assert.equal(verifyProjectControlSelectionTicket({
    kind: 'project-root',
    path: selected.path,
    authorization: selected.authorization,
    secret: TEST_SELECTION_SECRET,
  }), true)
  assert.deepEqual(calls[0].dialogOptions, { properties: ['openDirectory', 'dontAddToRecent'] })
  dispose()
})

test('Project Control picker coalesces duplicate calls and blocks a second dialog kind', async () => {
  const pending = deferred()
  let dialogCalls = 0
  const { handlers, dispose } = createRegisteredBridge({
    showOpenDialog() {
      dialogCalls += 1
      return pending.promise
    },
  })
  const invoke = handlers.get('dsh-personal:project-control')
  const first = invoke({}, directoryRequest('source-root'))
  const duplicate = invoke({}, directoryRequest('source-root'))
  const competing = await invoke({}, directoryRequest('project-root'))

  assert.equal(dialogCalls, 1)
  assert.equal(competing.ok, false)
  pending.resolve({ canceled: false, filePaths: ['D:\\Projects'] })
  const firstResult = await first
  const duplicateResult = await duplicate
  assert.equal(firstResult.path, 'D:\\Projects')
  assert.deepEqual(duplicateResult, firstResult)
  dispose()
})

test('Project Control picker converts shutdown, window races, disposal, and rejection into bounded results', async () => {
  let shuttingDown = true
  const initial = createRegisteredBridge({
    isShuttingDown: () => shuttingDown,
    showOpenDialog: async () => {
      assert.fail('shutdown must not open a native dialog')
    },
  })
  assert.deepEqual(
    await initial.handlers.get('dsh-personal:project-control')({}, directoryRequest('source-root')),
    { ok: true, canceled: true },
  )
  initial.dispose()

  shuttingDown = false
  const pending = deferred()
  let destroyed = false
  const closed = createRegisteredBridge({
    isShuttingDown: () => shuttingDown,
    isWindowDestroyed: () => destroyed,
    showOpenDialog: () => pending.promise,
  })
  const closedResult = closed.handlers.get('dsh-personal:project-control')({}, directoryRequest('project-root'))
  destroyed = true
  pending.resolve({ canceled: false, filePaths: ['D:\\Projects'] })
  assert.deepEqual(await closedResult, { ok: true, canceled: true })
  closed.dispose()

  const disposedPending = deferred()
  const disposed = createRegisteredBridge({ showOpenDialog: () => disposedPending.promise })
  const disposedResult = disposed.handlers.get('dsh-personal:project-control')({}, directoryRequest('project-root'))
  disposed.dispose()
  disposedPending.resolve({ canceled: false, filePaths: ['D:\\Projects'] })
  assert.deepEqual(await disposedResult, { ok: true, canceled: true })
  assert.equal(disposed.handlers.has('dsh-personal:project-control'), false)

  const rejected = createRegisteredBridge({
    showOpenDialog: async () => { throw new Error('sensitive native detail') },
  })
  const rejectionResult = await rejected.handlers.get('dsh-personal:project-control')(
    {},
    directoryRequest('project-root'),
  )
  assert.deepEqual(rejectionResult, { ok: false, reason: '目录选择器暂时不可用。' })
  assert.doesNotMatch(rejectionResult.reason, /sensitive/u)
  rejected.dispose()
})

test('Project Control picker rejects malformed native paths without reading them', async () => {
  const responses = [
    { canceled: false, filePaths: ['relative-project'] },
    { canceled: false, filePaths: ['\\\\server\\share\\project'] },
    { canceled: false, filePaths: [] },
  ]
  const bridge = createRegisteredBridge({ showOpenDialog: async () => responses.shift() })
  const invoke = bridge.handlers.get('dsh-personal:project-control')
  for (let index = 0; index < 3; index += 1) {
    const result = await invoke({}, directoryRequest('project-root'))
    assert.equal(result.ok, false)
    assert.match(result.reason, /本地绝对路径/u)
  }
  bridge.dispose()
})

function directoryRequest(kind) {
  return { action: 'select-directory', kind }
}

function deferred() {
  let resolve
  const promise = new Promise(resolvePromise => { resolve = resolvePromise })
  return { promise, resolve }
}

function createRegisteredBridge(overrides = {}) {
  const handlers = new Map()
  const calls = []
  const owner = {
    isDestroyed: () => overrides.isWindowDestroyed?.() ?? false,
  }
  const ipcMain = {
    handle(channel, handler) { handlers.set(channel, handler) },
    removeHandler(channel) { handlers.delete(channel) },
  }
  const dispose = registerDesktopBridge({
    ipcMain,
    dialog: { showOpenDialog: overrides.showOpenDialog },
    BrowserWindow: class {},
    shell: overrides.shell ?? { openExternal: async () => {} },
    updateService: {},
    desktopController: {},
    assertTrustedSender: () => {},
    isShuttingDown: overrides.isShuttingDown ?? (() => false),
    getMainWindow: () => owner,
    selectionSecret: TEST_SELECTION_SECRET,
  })
  return { handlers, calls, owner, dispose }
}
