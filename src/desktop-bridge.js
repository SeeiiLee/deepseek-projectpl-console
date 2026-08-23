import { isAbsolute, win32 } from 'node:path'
import { readFile, stat as fsStat } from 'node:fs/promises'
import { issueProjectControlSelectionTicket } from './project-control-selection-ticket.js'

export const DEFAULT_BILLING_URL = 'https://platform.deepseek.com/top_up'

/** read-file-as-data-url 单次读取上限：避免把超大文件拉进渲染进程内存（64 MiB）。 */
export const READ_FILE_AS_DATA_URL_MAX_BYTES = 64 * 1024 * 1024

/** open-external 的 URL 长度上限：足够真实链接，同时挡住异常巨型 payload。 */
export const OPEN_EXTERNAL_MAX_URL_LENGTH = 4096

/** data URL 的 MIME 推断表（本地图片/媒体内嵌显示用）。 */
const DATA_URL_MIME_BY_EXTENSION = Object.freeze({
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif',
})

const CANCELED_DIRECTORY_SELECTION = Object.freeze({ ok: true, canceled: true })
const DIRECTORY_DIALOG_PROPERTIES = Object.freeze(['openDirectory', 'dontAddToRecent'])

/** Register the narrow preload IPC surface used by desktop-only client plugins. */
export function registerDesktopBridge(options) {
  const { ipcMain, updateService } = options
  let billingWindow
  let billingClosed
  let activeDirectorySelection
  let disposed = false

  ipcMain.handle('dsh-personal:desktop', async (event, request) => {
    options.assertTrustedSender(event)
    assertBridgeAvailable(options.isShuttingDown)
    const { action, payload } = validateDesktopRequest(request)
    switch (action) {
      case 'get-state': return options.desktopController.getState()
      case 'configure': return options.desktopController.configure(payload)
      case 'repair-shortcuts': return options.desktopController.repairShortcuts()
      case 'reveal-in-explorer': {
        options.shell.showItemInFolder(payload)
        return { ok: true }
      }
      case 'open-path': {
        if (typeof payload !== 'string' || payload === '') throw new Error('Invalid path.')
        const error = await options.shell.openPath(payload)
        return { ok: error === '', error: error || undefined }
      }
      case 'open-external': {
        try {
          await options.shell.openExternal(payload)
          return { ok: true }
        } catch (externalError) {
          return { ok: false, error: externalError instanceof Error ? externalError.message : String(externalError) }
        }
      }
      case 'read-file-as-data-url': {
        if (typeof payload !== 'string' || payload === '') throw new Error('Invalid path.')
        let stat
        try {
          stat = await fsStat(payload)
        } catch {
          return { ok: false, error: 'not-found' }
        }
        if (!stat.isFile()) return { ok: false, error: 'not-found' }
        if (stat.size > READ_FILE_AS_DATA_URL_MAX_BYTES) return { ok: false, error: 'too-large' }
        const buffer = await readFile(payload)
        const extension = payload.slice(payload.lastIndexOf('.') + 1).toLowerCase()
        const mime = DATA_URL_MIME_BY_EXTENSION[extension] ?? 'application/octet-stream'
        return { ok: true, dataUrl: `data:${mime};base64,${buffer.toString('base64')}` }
      }
      default: throw new Error(`Unsupported desktop action: ${action}`)
    }
  })

  ipcMain.handle('dsh-personal:update', async (event, request) => {
    options.assertTrustedSender(event)
    assertBridgeAvailable(options.isShuttingDown)
    const { action, payload } = validateUpdateRequest(request)
    switch (action) {
      case 'get-state': return updateService.getState()
      case 'configure': return updateService.configure(payload)
      case 'check': return updateService.check()
      case 'download-desktop': return updateService.downloadDesktop()
      case 'install-desktop': return updateService.installDesktop()
      case 'rollback-desktop': return updateService.rollbackDesktop()
      case 'prepare-harness': return updateService.prepareHarness()
      case 'activate-harness': return updateService.activateHarness()
      case 'rollback-harness': return updateService.rollbackHarness()
      case 'prepare-plugin-generation': return updateService.preparePluginGeneration()
      case 'rollback-plugin-generation': return updateService.rollbackPluginGeneration()
      case 'remove-plugin-generation': return updateService.removePluginGeneration()
      case 'preview-plugin-purge': return updateService.previewPluginPurge()
      case 'purge-plugin-generation': return updateService.purgePluginGeneration(payload)
      case 'preview-plugin-gc': return updateService.previewPluginGC()
      case 'gc-plugin-generations': return updateService.gcPluginGenerations(payload)
      case 'open-release': return updateService.openRelease(payload)
      default: throw new Error(`Unsupported update action: ${action}`)
    }
  })

  ipcMain.handle('dsh-personal:billing', async (event, request) => {
    options.assertTrustedSender(event)
    assertBridgeAvailable(options.isShuttingDown)
    if (request?.action !== 'open') throw new Error('Unsupported billing action.')
    if (billingWindow !== undefined && !billingWindow.isDestroyed()) {
      billingWindow.show()
      billingWindow.focus()
      return billingClosed
    }
    const target = validatedBillingUrl(options.billingUrl ?? process.env.DSH_DEEPSEEK_BILLING_URL ?? DEFAULT_BILLING_URL)
    const parent = options.getMainWindow()
    const createdWindow = new options.BrowserWindow({
      width: 980,
      height: 780,
      minWidth: 760,
      minHeight: 600,
      show: false,
      parent: parent === undefined || parent.isDestroyed() ? undefined : parent,
      title: 'DeepSeek 充值中心',
      autoHideMenuBar: true,
      backgroundColor: '#f7f8fa',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        webviewTag: false,
        partition: 'persist:dsh-personal-billing',
      },
    })
    billingWindow = createdWindow
    let mode = 'isolated'
    configureBillingWindow(createdWindow, target, options.shell, () => { mode = 'external' })
    const closedPromise = new Promise(resolvePromise => {
      createdWindow.once('closed', () => {
        if (billingWindow === createdWindow) {
          billingWindow = undefined
          billingClosed = undefined
        }
        resolvePromise({ ok: true, mode })
      })
    })
    billingClosed = closedPromise
    try {
      await createdWindow.loadURL(target.href)
      if (!createdWindow.isDestroyed()) createdWindow.show()
    } catch {
      if (createdWindow.isDestroyed()) return closedPromise
      const alreadyFellBack = mode === 'external'
      mode = 'external'
      try {
        if (!alreadyFellBack) await options.shell.openExternal(target.href)
      } catch (externalError) {
        if (!createdWindow.isDestroyed()) createdWindow.destroy()
        return { ok: false, reason: externalError instanceof Error ? externalError.message : String(externalError) }
      }
      if (!createdWindow.isDestroyed()) createdWindow.destroy()
    }
    return closedPromise
  })

  ipcMain.handle('dsh-personal:project-control', async (event, request) => {
    options.assertTrustedSender(event)
    const { kind } = validateProjectControlDirectoryRequest(request)
    if (disposed || options.isShuttingDown?.()) return canceledDirectorySelection()

    const owner = getLiveMainWindow(options.getMainWindow)
    if (owner === undefined) return canceledDirectorySelection()

    if (activeDirectorySelection !== undefined) {
      if (activeDirectorySelection.owner === owner && activeDirectorySelection.kind === kind) {
        return activeDirectorySelection.promise
      }
      return { ok: false, reason: '已有目录选择窗口正在处理，请完成后重试。' }
    }

    const selection = { kind, owner, promise: undefined }
    selection.promise = safelySelectProjectDirectory(options, kind, owner, () => (
      disposed
      || options.isShuttingDown?.() === true
      || getLiveMainWindow(options.getMainWindow) !== owner
    ))
    activeDirectorySelection = selection
    try {
      return await selection.promise
    } finally {
      if (activeDirectorySelection === selection) activeDirectorySelection = undefined
    }
  })

  return () => {
    disposed = true
    ipcMain.removeHandler('dsh-personal:desktop')
    ipcMain.removeHandler('dsh-personal:update')
    ipcMain.removeHandler('dsh-personal:billing')
    ipcMain.removeHandler('dsh-personal:project-control')
    if (billingWindow !== undefined && !billingWindow.isDestroyed()) billingWindow.destroy()
  }
}

export function assertBridgeAvailable(isShuttingDown) {
  if (isShuttingDown?.()) throw new Error('应用正在退出，暂不接受新的桌面操作。')
}

/** Validate the settings-only desktop IPC vocabulary. */
export function validateDesktopRequest(value) {
  if (typeof value !== 'object' || value === null
    || !['get-state', 'configure', 'repair-shortcuts', 'reveal-in-explorer', 'open-path', 'read-file-as-data-url', 'open-external'].includes(value.action)) {
    throw new TypeError('Invalid desktop integration request.')
  }
  if ((value.action === 'reveal-in-explorer' || value.action === 'open-path' || value.action === 'read-file-as-data-url')
    && !isSafeLocalAbsoluteFile(value.payload)) {
    throw new TypeError('Invalid local file path.')
  }
  if (value.action === 'open-external' && !isSafeExternalUrl(value.payload)) {
    throw new TypeError('Invalid external URL.')
  }
  if (value.action === 'configure') {
    const payload = value.payload
    if (typeof payload !== 'object' || payload === null
      || typeof payload.closeToTray !== 'boolean'
      || typeof payload.maintainShortcuts !== 'object' || payload.maintainShortcuts === null
      || typeof payload.maintainShortcuts.desktop !== 'boolean'
      || typeof payload.maintainShortcuts.startMenu !== 'boolean') {
      throw new TypeError('Invalid desktop integration settings.')
    }
  }
  return { action: value.action, payload: value.payload }
}

/** Validate the context-bridge request before dispatching privileged operations. */
export function validateUpdateRequest(value) {
  if (typeof value !== 'object' || value === null || typeof value.action !== 'string') {
    throw new TypeError('Invalid update request.')
  }
  const allowed = new Set([
    'get-state',
    'configure',
    'check',
    'download-desktop',
    'install-desktop',
    'rollback-desktop',
    'prepare-harness',
    'activate-harness',
    'rollback-harness',
    'prepare-plugin-generation',
    'rollback-plugin-generation',
    'remove-plugin-generation',
    'preview-plugin-purge',
    'purge-plugin-generation',
    'preview-plugin-gc',
    'gc-plugin-generations',
    'open-release',
  ])
  if (!allowed.has(value.action)) throw new TypeError('Invalid update request action.')
  if (value.action === 'open-release' && !['desktop', 'harness'].includes(value.payload)) {
    throw new TypeError('Invalid release page kind.')
  }
  return { action: value.action, payload: value.payload }
}

/** Validate the only Project Control privilege exposed through the preload bridge. */
export function validateProjectControlDirectoryRequest(value) {
  if (typeof value !== 'object' || value === null
    || value.action !== 'select-directory'
    || !['source-root', 'project-root', 'create-parent'].includes(value.kind)) {
    throw new TypeError('Invalid Project Control directory request.')
  }
  return { kind: value.kind }
}

/** Accept only local absolute paths returned by the native directory picker. */
export function isSafeLocalAbsoluteDirectory(value) {
  if (typeof value !== 'string' || value.length === 0 || /[\u0000-\u001f\u007f]/u.test(value)) return false
  if (value.startsWith('\\\\') || value.startsWith('//')) return false
  if (/^[A-Za-z]:[\\/]/u.test(value)) return win32.isAbsolute(value)
  return isAbsolute(value)
}

/** Accept only local absolute file/directory paths for Explorer reveal requests. */
export function isSafeLocalAbsoluteFile(value) {
  if (typeof value !== 'string' || value.length === 0 || /[\u0000-\u001f\u007f]/u.test(value)) return false
  if (value.startsWith('\\\\') || value.startsWith('//')) return false
  if (/^[A-Za-z]:[\\/]/u.test(value)) return win32.isAbsolute(value)
  return isAbsolute(value)
}

/** open-external 只放行 http(s) URL：file:、javascript:、自定义协议一律拒绝。 */
export function isSafeExternalUrl(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > OPEN_EXTERNAL_MAX_URL_LENGTH) return false
  if (/[\u0000-\u001f\u007f]/u.test(value)) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

/** Permit the fixed DeepSeek account surface while diverting unrelated payment redirects. */
export function isAllowedBillingNavigation(target) {
  try {
    const url = new URL(target)
    return url.protocol === 'https:' && (url.hostname === 'platform.deepseek.com' || url.hostname.endsWith('.deepseek.com'))
  } catch {
    return false
  }
}

function validatedBillingUrl(value) {
  const url = new URL(value)
  if (!isAllowedBillingNavigation(url.href)) throw new Error('Billing URL must use an official DeepSeek HTTPS host.')
  return url
}

async function safelySelectProjectDirectory(options, kind, owner, shouldCancel) {
  if (typeof options.dialog?.showOpenDialog !== 'function') {
    return { ok: false, reason: '目录选择器暂时不可用。' }
  }
  try {
    const result = await options.dialog.showOpenDialog(owner, {
      properties: [...DIRECTORY_DIALOG_PROPERTIES],
    })
    if (shouldCancel() || result?.canceled === true) return canceledDirectorySelection()
    const path = Array.isArray(result?.filePaths) && result.filePaths.length === 1
      ? result.filePaths[0]
      : undefined
    if (!isSafeLocalAbsoluteDirectory(path)) {
      return { ok: false, reason: '目录选择器没有返回可用的本地绝对路径。' }
    }
    try {
      return {
        ok: true,
        canceled: false,
        path,
        authorization: issueProjectControlSelectionTicket({
          kind,
          path,
          secret: options.selectionSecret,
        }),
      }
    } catch {
      return { ok: false, reason: '无法为所选目录签发安全授权。' }
    }
  } catch {
    return shouldCancel()
      ? canceledDirectorySelection()
      : { ok: false, reason: '目录选择器暂时不可用。' }
  }
}

function getLiveMainWindow(getMainWindow) {
  try {
    const window = getMainWindow?.()
    if (window === undefined || window === null || typeof window.isDestroyed !== 'function' || window.isDestroyed()) {
      return undefined
    }
    return window
  } catch {
    return undefined
  }
}

function canceledDirectorySelection() {
  return { ...CANCELED_DIRECTORY_SELECTION }
}

function configureBillingWindow(window, initialUrl, shell, onExternal) {
  const webSession = window.webContents.session
  webSession.setPermissionCheckHandler(() => false)
  webSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedBillingNavigation(url)) {
      setImmediate(() => { if (!window.isDestroyed()) void safelyLoadBillingUrl(window, url) })
    } else if (isSafeExternalHttps(url)) {
      onExternal()
      setImmediate(() => { void safelyOpenExternal(shell, url) })
    }
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', event => {
    const target = event.url
    if (isAllowedBillingNavigation(target)) return
    event.preventDefault()
    if (isSafeExternalHttps(target)) {
      onExternal()
      void safelyOpenExternal(shell, target)
    }
  })
  window.webContents.on('will-redirect', event => {
    const target = event.url
    if (isAllowedBillingNavigation(target)) return
    event.preventDefault()
    if (isSafeExternalHttps(target)) {
      onExternal()
      void safelyOpenExternal(shell, target)
    }
  })
  window.webContents.on('render-process-gone', () => {
    if (!window.isDestroyed()) window.close()
  })
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
    if (!isMainFrame || errorCode === -3 || window.isDestroyed()) return
    const fallback = isSafeExternalHttps(validatedUrl) ? validatedUrl : initialUrl.href
    onExternal()
    void safelyOpenExternal(shell, fallback)
    window.close()
    console.error(`Billing page failed to load: ${errorDescription} (${String(errorCode)}).`)
  })
}

async function safelyLoadBillingUrl(window, target) {
  try {
    await window.loadURL(target)
  } catch (error) {
    if (!window.isDestroyed()) console.error(`Billing navigation failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function safelyOpenExternal(shell, target) {
  try {
    await shell.openExternal(target)
  } catch (error) {
    console.error(`External billing navigation failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function isSafeExternalHttps(value) {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}
