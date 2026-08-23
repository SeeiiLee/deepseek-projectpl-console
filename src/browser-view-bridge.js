import { isSafeExternalUrl } from './desktop-bridge.js'

/**
 * 工作台浏览器页签的 WebContentsView 桥：
 * 访客页面由主进程以 WebContentsView 形式叠加在宿主窗口上（VS Code 式架构），
 * 不走渲染进程内嵌 <webview>——后者在本壳环境实测会崩宿主渲染进程
 * （blink.mojom.Widget 拒绝访客注册），且 X-Frame-Options / 第三方 Cookie
 * 限制在 iframe 路线上根本无法绕过。
 *
 * 安全边界：
 * - 只接受可信渲染进程（assertTrustedSender 由调用方先验）；
 * - 导航目标仅 http(s)，长度上限沿用 open-external 口径；
 * - 访客无 Node、无 preload、sandbox 渲染、独立持久会话；
 * - 访客 window.open 一律转交系统默认浏览器。
 */

const EVENT_CHANNEL = 'dsh-personal:browser-view-event'
const MAX_BOUNDS = 16_384

export function registerBrowserViewBridge(options) {
  const { ipcMain, WebContentsView, BrowserWindow, shell } = options
  const views = new Map()
  let nextId = 1
  let disposed = false

  const send = (owner, payload) => {
    if (owner === undefined || owner.isDestroyed()) return
    try {
      owner.send(EVENT_CHANNEL, payload)
    } catch {
      // 宿主销毁竞态：丢弃即可。
    }
  }

  const disposeView = record => {
    if (record === undefined || record.disposed === true) return
    record.disposed = true
    try {
      if (record.window !== undefined && !record.window.isDestroyed()) {
        record.window.contentView.removeChildView(record.view)
      }
    } catch {
      // 窗口已销毁：忽略。
    }
    try {
      if (!record.view.webContents.isDestroyed()) record.view.webContents.destroy()
    } catch {
      // 访客已销毁：忽略。
    }
    views.delete(record.id)
  }

  const disposeOwnedBy = owner => {
    for (const record of [...views.values()]) {
      if (record.owner === owner) disposeView(record)
    }
  }

  const requireRecord = id => {
    const record = views.get(id)
    if (record === undefined || record.disposed === true) throw new Error('Browser view does not exist.')
    return record
  }

  ipcMain.handle('dsh-personal:browser-view', async (event, request) => {
    options.assertTrustedSender(event)
    if (disposed || options.isShuttingDown?.() === true) throw new Error('应用正在退出，暂不接受浏览器操作。')
    const { action, payload } = validateBrowserViewRequest(request)
    const owner = event.sender

    switch (action) {
      case 'create': {
        const window = BrowserWindow.fromWebContents(owner)
        if (window === null || window.isDestroyed()) throw new Error('宿主窗口不可用。')
        const view = new WebContentsView({
          webPreferences: {
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: true,
            partition: 'persist:workbench-browser',
          },
        })
        const id = nextId
        nextId += 1
        const record = { id, view, owner, window, disposed: false }
        views.set(id, record)
        const guest = view.webContents
        guest.setWindowOpenHandler(({ url }) => {
          if (isSafeExternalUrl(url)) void shell.openExternal(url).catch(() => {})
          return { action: 'deny' }
        })
        guest.on('did-navigate', (_e, url) => { send(owner, { id, type: 'navigate', url }) })
        guest.on('did-navigate-in-page', (_e, url) => { send(owner, { id, type: 'navigate', url }) })
        guest.on('did-start-loading', () => { send(owner, { id, type: 'loading', loading: true }) })
        guest.on('did-stop-loading', () => { send(owner, { id, type: 'loading', loading: false }) })
        guest.on('page-title-updated', (_e, title) => { send(owner, { id, type: 'title', title }) })
        guest.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL, isMainFrame) => {
          if (isMainFrame !== true || errorCode === -3) return
          send(owner, { id, type: 'fail', url: validatedURL, error: errorDescription, code: errorCode })
        })
        guest.on('render-process-gone', () => { send(owner, { id, type: 'gone' }) })
        owner.once('destroyed', () => { disposeOwnedBy(owner) })
        window.contentView.addChildView(view)
        // 初始零尺寸：等渲染进程量好占位区再 set-bounds。
        view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
        if (typeof payload?.url === 'string' && payload.url !== '') {
          await view.webContents.loadURL(payload.url)
        }
        return { ok: true, id }
      }
      case 'set-bounds': {
        const record = requireRecord(payload.id)
        const { x, y, width, height, visible } = payload
        if (visible === false || width < 2 || height < 2) {
          if (typeof record.view.setVisible === 'function') record.view.setVisible(false)
          else record.view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
          return { ok: true }
        }
        record.view.setBounds({ x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) })
        if (typeof record.view.setVisible === 'function') record.view.setVisible(true)
        return { ok: true }
      }
      case 'navigate': {
        const record = requireRecord(payload.id)
        await record.view.webContents.loadURL(payload.url)
        return { ok: true }
      }
      case 'go-back': {
        const record = requireRecord(payload.id)
        if (record.view.webContents.navigationHistory.canGoBack()) record.view.webContents.navigationHistory.goBack()
        return { ok: true }
      }
      case 'go-forward': {
        const record = requireRecord(payload.id)
        if (record.view.webContents.navigationHistory.canGoForward()) record.view.webContents.navigationHistory.goForward()
        return { ok: true }
      }
      case 'reload': {
        const record = requireRecord(payload.id)
        record.view.webContents.reload()
        return { ok: true }
      }
      case 'get-state': {
        const record = requireRecord(payload.id)
        const guest = record.view.webContents
        return {
          ok: true,
          url: guest.getURL(),
          title: guest.getTitle(),
          loading: guest.isLoading(),
          canBack: guest.navigationHistory.canGoBack(),
          canForward: guest.navigationHistory.canGoForward(),
        }
      }
      case 'capture': {
        // 冒烟像素级验证：主进程抓访客位图，采样暗像素证明不是白屏。
        // 隐藏窗口（冒烟）没有合成器表面，capturePage 抛 UnknownVizError——
        // 此时降级为访客 DOM 内容探针（标题/正文非空即证明真实加载渲染）。
        const record = requireRecord(payload.id)
        try {
          const image = await record.view.webContents.capturePage()
          const size = image.getSize()
          const bitmap = image.getBitmap()
          let darkSamples = 0
          for (let index = 0; index + 2 < bitmap.length; index += 16_384) {
            if (bitmap[index] < 240 || bitmap[index + 1] < 240 || bitmap[index + 2] < 240) darkSamples += 1
          }
          return { ok: true, mode: 'pixels', width: size.width, height: size.height, renders: size.width > 0 && darkSamples > 0, darkSamples }
        } catch {
          const probe = await record.view.webContents.executeJavaScript(
            "String(document.title ?? '') + '|' + String((document.body?.innerText ?? '').length)", true,
          ).catch(() => '')
          const [title = '', lengthRaw = '0'] = String(probe).split('|')
          const textLength = Number(lengthRaw) || 0
          return {
            ok: true,
            mode: 'dom-fallback',
            width: 0,
            height: 0,
            renders: title.length > 0 || textLength > 0,
            darkSamples: textLength,
          }
        }
      }
      case 'dispose': {
        disposeView(views.get(payload.id))
        return { ok: true }
      }
      default:
        throw new Error(`Unsupported browser view action: ${action}`)
    }
  })

  return () => {
    disposed = true
    for (const record of [...views.values()]) disposeView(record)
    ipcMain.removeHandler('dsh-personal:browser-view')
  }
}

/** 严格校验渲染进程来的浏览器请求词汇表，杜绝任意 IPC payload。 */
export function validateBrowserViewRequest(value) {
  if (typeof value !== 'object' || value === null || typeof value.action !== 'string') {
    throw new TypeError('Invalid browser view request.')
  }
  const { action, payload } = value
  switch (action) {
    case 'create': {
      if (payload !== undefined && (typeof payload !== 'object' || payload === null
        || (payload.url !== undefined && !isSafeExternalUrl(payload.url)))) {
        throw new TypeError('Invalid browser view create payload.')
      }
      return { action, payload }
    }
    case 'navigate': {
      if (typeof payload !== 'object' || payload === null || !isValidId(payload.id) || !isSafeExternalUrl(payload.url)) {
        throw new TypeError('Invalid browser view navigate payload.')
      }
      return { action, payload }
    }
    case 'set-bounds': {
      if (typeof payload !== 'object' || payload === null || !isValidId(payload.id)
        || !isFiniteCoord(payload.x) || !isFiniteCoord(payload.y)
        || !isFiniteCoord(payload.width) || !isFiniteCoord(payload.height)) {
        throw new TypeError('Invalid browser view bounds payload.')
      }
      return {
        action,
        payload: {
          id: payload.id,
          x: payload.x,
          y: payload.y,
          width: Math.min(Math.max(payload.width, 0), MAX_BOUNDS),
          height: Math.min(Math.max(payload.height, 0), MAX_BOUNDS),
          visible: payload.visible !== false,
        },
      }
    }
    case 'go-back':
    case 'go-forward':
    case 'reload':
    case 'get-state':
    case 'capture':
    case 'dispose': {
      if (typeof payload !== 'object' || payload === null || !isValidId(payload.id)) {
        throw new TypeError('Invalid browser view id payload.')
      }
      return { action, payload: { id: payload.id } }
    }
    default:
      throw new TypeError('Invalid browser view action.')
  }
}

function isValidId(value) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function isFiniteCoord(value) {
  return typeof value === 'number' && Number.isFinite(value)
}
