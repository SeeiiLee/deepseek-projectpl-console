import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createConnection } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, screen, shell, Tray, WebContentsView } from 'electron'
import { BUILD_FLAVOR, E2E_BUILD } from './build-flavor.js'
import { runDevE2EDriver } from './dev-e2e-driver.js'
import { registerDesktopBridge } from './desktop-bridge.js'
import { registerBrowserViewBridge } from './browser-view-bridge.js'
import { DEFAULT_WINDOW_BOUNDS, loadDesktopSettings, saveDesktopSettings } from './desktop-settings.js'
import { DEFAULT_SOURCE_ROOT, launchHarness } from './harness-process.js'
import { abortActivatingGeneration, commitActivatingGeneration, PERSONAL_PLUGIN_PACKAGES } from './personal-plugins.js'
import { getPluginStatus, loadCurrentGeneration, resolveExternalRoot } from './personal-plugin-validation.js'
import { resolveProjectControlHome } from './project-control-home.js'
import { createProjectControlSelectionSecret } from './project-control-selection-ticket.js'
import { preflightHarnessRuntime } from './runtime-preflight.js'
import {
  isManagedShortcut,
  maintainShortcuts,
  resolveLaunchTarget,
  resolveShortcutPaths,
} from './shortcuts.js'
import { resolveActiveHarnessRoot, UpdateService } from './update-service.js'
import { loadAppFlavor, resolveHarnessHomeOverride, resolveUserDataOverride } from './app-flavor.js'

const smokeMode = process.env.DSH_DESKTOP_SMOKE === '1'
// Windows 原生遮挡检测会把隐藏/被遮窗口标记为 occluded：webview 访客
// 在里面永远无法初始化（dom-ready 不发），且合成器 WidgetHost 拒绝访客
// 注册消息直接崩掉渲染进程（冒烟实测）。禁用遮挡检测让窗口状态计算
// 退化回「可见」，webview 在冒烟隐藏窗口里也能正常建访客、跑导航。
if (smokeMode) {
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
}
const smokeResultPath = process.env.DSH_DESKTOP_SMOKE_RESULT
const PAGE_LOAD_TIMEOUT_MS = 60_000
const UI_SETTLE_TIMEOUT_MS = 60_000
const APP_ICON_PATH = fileURLToPath(new URL(
  process.platform === 'win32' ? '../assets/app-icon.ico' : '../assets/app-icon.png',
  import.meta.url,
))
const PRELOAD_PATH = fileURLToPath(new URL('./preload.cjs', import.meta.url))
const PROJECT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
// 已安装包的身份由构建期 BUILD_FLAVOR 决定，不允许用户用 DSH_DESKTOP_FLAVOR
// 把 Stable 伪装成 Dev 绕过外部插件激活；源码/冒烟（未打包）仍允许显式覆盖。
const appFlavor = loadAppFlavor(app.isPackaged ? undefined : (process.env.DSH_DESKTOP_FLAVOR?.trim() || undefined))
const explicitUserData = process.env.DSH_DESKTOP_USER_DATA?.trim()
const userDataOverride = resolveUserDataOverride({ flavor: appFlavor, isPackaged: app.isPackaged })
if (explicitUserData !== undefined && explicitUserData !== '') {
  // Launchers and smoke runs own their userData fully (isolated instance lock
  // and settings); the flavor override must yield to this explicit choice.
  app.setPath('userData', resolve(explicitUserData))
} else if (userDataOverride !== null) {
  app.setPath('userData', resolve(userDataOverride))
}
const harnessHomeOverride = resolveHarnessHomeOverride({ flavor: appFlavor, isPackaged: app.isPackaged, env: process.env })
if (harnessHomeOverride !== null) {
  // Set before the plugin junctions and the Harness helper are created so the
  // installed stable keeps its sessions on the F: drive. Smoke runs pass an
  // explicit DSH_HOME and must never touch the real F: harness home.
  process.env.DSH_HOME = harnessHomeOverride
}
app.setName(appFlavor.name)
if (process.platform === 'win32') app.setAppUserModelId(appFlavor.appId)
app.enableSandbox()

let mainWindow
let tray
let supervisor
let trustedUrl
let shutdownPromise
let shuttingDown = false
let allowWindowDestroy = false
let pageLoaded = false
let fatalMessage
let electronMetrics = []
let personalState
let desktopSettings
let shortcutPaths
let activeSourceRoot
let updateService
let disposeDesktopBridge
let disposeBrowserViewBridge
let pendingInstallerPath
let relaunchAfterShutdown = false
let bootFallbackAttempted = false
let bootCssKey

if (!app.requestSingleInstanceLock()) {
  if (!smokeMode) {
    dialog.showErrorBox(
      appFlavor.name,
      '另一个 DeepSeek Harness 实例正在运行，本次启动已退出。\n请先退出已有实例（托盘“退出并清理后台进程”，或在任务管理器中结束 electron.exe），再重新启动。',
    )
  }
  app.quit()
} else {
  app.on('second-instance', () => {
    showMainWindow()
  })
  app.on('activate', showMainWindow)
  app.on('before-quit', event => {
    if (shuttingDown) return
    event.preventDefault()
    void shutdownAndExit(0, 'before-quit')
  })
  app.on('window-all-closed', () => {
    if (!shuttingDown) void shutdownAndExit(0, 'window-all-closed')
  })
  // 工作台浏览器页签使用 <webview> 访客进程加载外网页面：访客的 window.open
  // 一律拦截并转交系统默认浏览器，绝不在应用内弹出不受控的原生窗口。
  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() !== 'webview') return
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//iu.test(url)) void shell.openExternal(url).catch(() => {})
      return { action: 'deny' }
    })
  })
  app.whenReady().then(start).catch(error => { if (!shuttingDown) void handleStartFailure(error) })
}

async function start() {
  const bootClock = Date.now()
  const mark = (label) => { appendBootLog('boot:' + label + ' +' + (Date.now() - bootClock) + 'ms') }
  const projectControlSelectionSecret = createProjectControlSelectionSecret()
  desktopSettings = loadDesktopSettings(app.getPath('userData'))
  shortcutPaths = resolveShortcutPaths({
    desktopPath: app.getPath('desktop'),
    appDataPath: app.getPath('appData'),
  }, appFlavor.shortcutName)
  activeSourceRoot = await resolveActiveHarnessRoot(
    app.getPath('userData'),
    resolve(process.env.DSH_SOURCE_ROOT || DEFAULT_SOURCE_ROOT),
  )
  appendBootLog(`start: userData=${app.getPath('userData')} sourceRoot=${activeSourceRoot}`)
  updateService = new UpdateService({
    app,
    shell,
    userDataPath: app.getPath('userData'),
    projectRoot: PROJECT_ROOT,
    getCurrentSourceRoot: () => activeSourceRoot,
    preflightHarness: (sourceRoot, options) => preflightHarnessRuntime(sourceRoot, options),
    onInstallDesktop: path => {
      pendingInstallerPath = path
      setImmediate(() => { void shutdownAndExit(0, 'desktop-update') })
    },
    onRelaunch: reason => {
      relaunchAfterShutdown = true
      setImmediate(() => { void shutdownAndExit(0, reason) })
    },
  })
  disposeDesktopBridge = registerDesktopBridge({
    ipcMain,
    BrowserWindow,
    dialog: smokeMode
      ? { showOpenDialog: async () => ({ canceled: false, filePaths: [process.env.DSH_WORKSPACE_ROOT ?? projectRoot] }) }
      : dialog,
    selectionSecret: projectControlSelectionSecret,
    shell,
    updateService,
    getMainWindow: () => mainWindow,
    isShuttingDown: () => shuttingDown,
    assertTrustedSender: assertTrustedDesktopSender,
    desktopController: {
      getState: getDesktopIntegrationState,
      configure: configureDesktopIntegration,
      repairShortcuts: repairDesktopShortcuts,
    },
  })
  disposeBrowserViewBridge = registerBrowserViewBridge({
    ipcMain,
    WebContentsView,
    BrowserWindow,
    shell,
    isShuttingDown: () => shuttingDown,
    assertTrustedSender: assertTrustedDesktopSender,
  })
  if (!smokeMode) {
    createTray()
    refreshManagedShortcuts()
  }

  // 引导等待窗：应用启动即显示（深色加载页），harness 引导的约 8 秒不再是无窗口等待。
  if (!smokeMode) {
    mainWindow = createShellWindow()
  }
  mark('harness-launch')
  supervisor = launchHarness({
    sourceRoot: activeSourceRoot,
    // Trusted main -> helper injection: actual Electron userData is the only
    // source for the stable external plugin root; the helper never sees a
    // user-supplied DSH_PERSONAL_PLUGINS_EXTERNAL or DSH_DESKTOP_FLAVOR.
    desktopFlavor: appFlavor.flavor,
    externalPluginsRoot: join(app.getPath('userData'), 'plugins-external'),
    startupTimeoutMs: process.env.DSH_DESKTOP_STARTUP_TIMEOUT_MS
      ? Number(process.env.DSH_DESKTOP_STARTUP_TIMEOUT_MS)
      : undefined,
    env: {
      ...process.env,
      PROJECT_CONTROL_HOME: resolveProjectControlHome(app.getPath('userData')),
      PROJECT_CONTROL_SELECTION_SECRET: projectControlSelectionSecret,
      // 记忆库按 flavor 落在各自数据目录（smoke 用显式临时 userData 自动隔离）：
      // 稳定版 → F 盘数据主目录/memory-live；开发版 → %APPDATA%\DeepSeek Harness Personal Dev\memory-live
      DSH_MEMORY_ROOT: join(app.getPath('userData'), 'memory-live'),
      // quick-pass 仅在开发版默认开启（真实会话验证用）；稳定版保持关闭，验证后按项目启用
      DSH_MEMORY_QUICKPASS: !smokeMode && appFlavor.flavor === 'dev' ? '1' : '',
      // P3-2 自动候选提取：开发版默认开启（试点全项目、新增项目自动适配）；稳定版默认关闭，可用 DSH_MEMORY_EXTRACTION=1 显式开启。
      DSH_MEMORY_EXTRACTION: process.env.DSH_MEMORY_EXTRACTION !== undefined
        ? process.env.DSH_MEMORY_EXTRACTION
        : (!smokeMode && appFlavor.flavor === 'dev' ? '1' : ''),
      // P4-2 向量嵌入：模型目录按 flavor 解析（Cyrus 拍板 2026-08-17）——
      // 环境变量 DSH_MEMORY_EMBEDDING_MODEL_DIR 显式覆盖优先；否则：
      // 开发版 → F:\Cyrus Dev Harness Data\models\bge-m3-onnx；稳定版 → F:\documents\Cyrus Deepseek Harness Data\models\bge-m3-onnx。
      // 模型目录存在才默认开启嵌入（懒加载、零感知）；不写死任何单一路径。
      DSH_MEMORY_EMBEDDING_MODEL_DIR: process.env.DSH_MEMORY_EMBEDDING_MODEL_DIR !== undefined
        ? process.env.DSH_MEMORY_EMBEDDING_MODEL_DIR
        : (appFlavor.flavor === 'dev'
          ? 'F:\\Cyrus Dev Harness Data\\models\\bge-m3-onnx'
          : 'F:\\documents\\Cyrus Deepseek Harness Data\\models\\bge-m3-onnx'),
      DSH_MEMORY_EMBEDDING: process.env.DSH_MEMORY_EMBEDDING !== undefined
        ? process.env.DSH_MEMORY_EMBEDDING
        : (!smokeMode && existsSync(process.env.DSH_MEMORY_EMBEDDING_MODEL_DIR !== undefined ? process.env.DSH_MEMORY_EMBEDDING_MODEL_DIR : (appFlavor.flavor === 'dev' ? 'F:\\Cyrus Dev Harness Data\\models\\bge-m3-onnx' : 'F:\\documents\\Cyrus Deepseek Harness Data\\models\\bge-m3-onnx')) ? '1' : ''),
      // 加密启动自检：启动即初始化加密（生成主密钥/恢复口令文件/明文库升级），
      // 开发版与稳定版一致；显式环境变量优先（冒烟由 scripts/smoke.js 注入）。
      DSH_MEMORY_SELF_TEST: process.env.DSH_MEMORY_SELF_TEST !== undefined
        ? process.env.DSH_MEMORY_SELF_TEST
        : '1',
      // 固定 Web 端口：origin 稳定 → localStorage（会话选择/布局偏好/工作台页签/
      // 控制台偏好等）跨启动持久，不再因随机端口每次清零。冒烟保留 0（完全隔离）。
      DSH_DESKTOP_WEB_PORT: smokeMode
        ? '0'
        : (appFlavor.flavor === 'dev' ? '50681' : '50682'),
    },
    onOutput({ stream, text }) {
      if (stream === 'stderr') process.stderr.write(`[Harness] ${text}`)
    },
  })
  supervisor.exited.then(({ code, signal }) => {
    if (shuttingDown || !pageLoaded) return
    void failAndExit(new Error(`Harness stopped unexpectedly (code ${String(code)}, signal ${String(signal)}).`))
  })

  trustedUrl = await supervisor.ready
  mark('harness-ready')
  if (shuttingDown) return
  const bootWindow = smokeMode ? undefined : mainWindow
  mainWindow = createWindow(trustedUrl)
  await withTimeout(
    mainWindow.loadURL(trustedUrl.href),
    PAGE_LOAD_TIMEOUT_MS,
    'Harness page did not finish loading in time.',
  )
  mark('page-loaded')
  await waitForHarnessUi(mainWindow, UI_SETTLE_TIMEOUT_MS)
  mark('ui-settled')
  if (shuttingDown) return
  // 冒烟探针会点击控制台/工作台并弹出目录选择框：只在烟测模式执行，绝不干扰真实会话。
  personalState = smokeMode ? await inspectPersonalFeatures(mainWindow) : undefined
  pageLoaded = true
  mark('page-ready')
  // A1: commit a pending plugin generation only after the live fiber doctor
  // reports every external package active. A failed fiber doctor aborts the
  // activation, restores the fallback, quarantines the candidate, and blocks
  // this boot instead of silently continuing on an unverified generation.
  if (!await verifyExternalPluginFiber()) {
    const externalRoot = resolveExternalRoot({ env: process.env, userData: app.getPath('userData') })
    if (externalRoot !== null) {
      abortActivatingGeneration({ externalRoot, dshHome: process.env.DSH_HOME, reason: 'fiber doctor failed' })
    }
    await failAndExit(new Error('A1 fiber doctor failed: 外部插件未全部进入 active，已回退并隔离候选。'))
    return
  }
  const externalRoot = resolveExternalRoot({ env: process.env, userData: app.getPath('userData') })
  if (externalRoot !== null && existsSync(join(externalRoot, 'activating.json'))) {
    const committed = commitActivatingGeneration({ externalRoot, pluginRoot: PROJECT_ROOT, dshHome: process.env.DSH_HOME, fiberOk: true })
    if (committed === null) {
      await failAndExit(new Error('A1 post-boot doctor failed after fiber check；已回退并隔离候选。'))
      return
    }
  }
  await updateService.recordHarnessBoot(activeSourceRoot, true)
  await updateService.confirmDesktopLifecycle()
  // Dev-E2E-only driver: runs only after readiness, fiber/doctor and
  // confirmDesktopLifecycle, and only when the immutable Dev-E2E build, the
  // explicit switch and a valid orchestration config are all present.
  if (!smokeMode && BUILD_FLAVOR === 'dev' && E2E_BUILD === true) {
    try {
      await runDevE2EDriver(updateService, { buildFlavor: BUILD_FLAVOR, e2eBuild: E2E_BUILD, app, env: process.env })
    } catch (error) {
      await failAndExit(error)
      return
    }
  }
  if (smokeMode) {
    setImmediate(() => mainWindow?.close())
  } else {
    // 引导窗无缝切换：真实窗口在 UI 就绪且主题应用后才显示，先显示真实窗再关引导窗，
    // 保证任何时刻都有已绘制的窗口面（无白闪、无桌面间隙）。
    await waitForThemeApplied(mainWindow, 3_000)
    if (!shuttingDown) {
      // 移除引导期兜底样式（主题已接管），并强制渲染器产出「当前 UI」的新帧，
      // 避免 show() 呈现隐藏期间残留的旧帧（白底 HARNESS 加载卡）。
      if (bootCssKey !== undefined) {
        try { mainWindow.webContents.removeInsertedCSS(bootCssKey) } catch {}
        bootCssKey = undefined
      }
      try {
        await mainWindow.webContents.executeJavaScript(
          "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
          true,
        )
      } catch {}
      try { mainWindow.webContents.invalidate() } catch {}
    }
    if (!shuttingDown) showMainWindow()
    if (!shuttingDown && bootWindow !== undefined && !bootWindow.isDestroyed()) {
      bootWindow.close()
    }
  }
  updateTrayMenu()
  if (!smokeMode && await updateService.shouldAutoCheck()) {
    setImmediate(() => {
      if (shuttingDown) return
      void updateService.check().catch(error => {
        console.error(`Automatic update check failed: ${error instanceof Error ? error.message : String(error)}`)
      })
    })
  }
}

/** 启动等待页：与最终主题一致的深色底 + 加载指示，避免白屏/空窗等待。 */
function loadingPageUrl() {
  const html = [
    '<!doctype html><html><head><meta charset="utf-8"><style>',
    'html,body{height:100%;margin:0;background:#111318;color:#81858c;',
    'display:grid;place-items:center;font:14px/1.5 system-ui,"Segoe UI",sans-serif}',
    '.wrap{display:flex;flex-direction:column;align-items:center;gap:16px}',
    '.spinner{width:20px;height:20px;border-radius:50%;border:2px solid #2a2e35;',
    'border-top-color:#3964fe;animation:spin .8s linear infinite}',
    '@keyframes spin{to{transform:rotate(360deg)}}',
    '</style></head><body><div class="wrap"><div class="spinner"></div>',
    '<div>正在启动 DeepSeek Harness…</div></div></body></html>',
  ].join('')
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html)
}

/** 引导等待窗：应用启动即显示（深色加载页），harness 就绪后无缝切换到真实窗口。 */
function createShellWindow() {
  const restored = resolveWindowBounds()
  const window = new BrowserWindow({
    width: restored.width,
    height: restored.height,
    ...(restored.x === undefined ? {} : { x: restored.x, y: restored.y }),
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#111318',
    autoHideMenuBar: true,
    title: 'DeepSeek Harness',
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: true,
      devTools: process.env.DSH_DESKTOP_DEVTOOLS === '1',
    },
  })
  void window.loadURL(loadingPageUrl()).catch(() => {})
  window.on('closed', () => { if (mainWindow === window) mainWindow = undefined })
  // 等首帧真正渲染完成再显示：直接 show() 在 Windows 上可能先呈现白色原生面
  //（渲染器尚未交出第一帧），这正是启动白闪的常见来源。
  let shellShown = false
  const showShell = () => {
    if (shellShown || window.isDestroyed()) return
    shellShown = true
    window.show()
  }
  window.once('ready-to-show', showShell)
  // 兜底：极端情况下 ready-to-show 不来也不至于长时间无窗口。
  setTimeout(showShell, 1_500).unref?.()
  return window
}

/** 记忆上次窗口状态：有合法存档则恢复并钳制到可见显示器；烟测固定 1380x900。 */
function resolveWindowBounds() {
  if (smokeMode) return { width: 1380, height: 900, maximized: false }
  const saved = desktopSettings?.windowBounds
  const width = typeof saved?.width === 'number' && Number.isFinite(saved.width)
    ? Math.round(saved.width)
    : DEFAULT_WINDOW_BOUNDS.width
  const height = typeof saved?.height === 'number' && Number.isFinite(saved.height)
    ? Math.round(saved.height)
    : DEFAULT_WINDOW_BOUNDS.height
  const primary = screen.getPrimaryDisplay().workArea
  const bounded = {
    width: Math.min(Math.max(width, 960), primary.width),
    height: Math.min(Math.max(height, 640), primary.height),
    maximized: saved?.maximized === true,
  }
  const x = typeof saved?.x === 'number' && Number.isFinite(saved.x) ? Math.round(saved.x) : undefined
  const y = typeof saved?.y === 'number' && Number.isFinite(saved.y) ? Math.round(saved.y) : undefined
  const visible = x !== undefined && y !== undefined && screen.getAllDisplays().some(display => {
    const work = display.workArea
    return x >= work.x - 40 && y >= work.y - 40
      && x + bounded.width > work.x + 80 && y + bounded.height > work.y + 80
  })
  if (visible) return { ...bounded, x, y }
  return bounded
}

/** 防抖落盘当前窗口边界（含最大化前的正常边界）。 */
function persistWindowBounds(window) {
  const settings = desktopSettings ?? {}
  const bounds = window.isMaximized() ? window.getNormalBounds() : window.getBounds()
  const next = { ...settings, windowBounds: { ...bounds, maximized: window.isMaximized() } }
  desktopSettings = saveDesktopSettings(app.getPath('userData'), next)
}

/** @param {URL} url */
function createWindow(url) {
  const trustedOrigin = url.origin
  const restored = resolveWindowBounds()
  const window = new BrowserWindow({
    width: restored.width,
    height: restored.height,
    ...(restored.x === undefined ? {} : { x: restored.x, y: restored.y }),
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#111318',
    icon: APP_ICON_PATH,
    autoHideMenuBar: true,
    title: 'DeepSeek Harness',
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: true,
      // 隐藏加载期间持续绘制首帧：show() 时直接呈现真实 UI，而不是白色空面。
      // 冒烟窗口虽全程隐藏，但必须保持绘制：webview 访客进程要向合成器
      // 注册 Widget，宿主完全不绘制时 Mojo WidgetHost 接口拒绝消息并直接
      // 崩掉渲染进程（冒烟实测），因此冒烟模式也要 paintWhenInitiallyHidden。
      paintWhenInitiallyHidden: true,
      backgroundThrottling: false,
      devTools: process.env.DSH_DESKTOP_DEVTOOLS === '1',
    },
  })

  configurePermissions(window, trustedOrigin)
  if (!smokeMode && restored.maximized) window.maximize()
  if (!smokeMode) {
    // Harness 引导期兜底深色：主题变量注入前其加载卡背景是白色兜底值，
    // 隐藏窗口若把这张旧帧带到 show() 会出现「白底 + HARNESS 转圈」的闪。
    // 结构选择器避开哈希类名，仅覆盖引导卡；UI 就绪后移除，不影响主题。
    window.webContents.on('dom-ready', () => {
      if (shuttingDown || window.isDestroyed()) return
      try {
        const current = window.webContents.getURL()
        if (!current.startsWith('http')) return
        void window.webContents.insertCSS([
          'html,body{margin:0;height:100%;background:#111318!important}',
          '#root>div{background-color:#111318!important}',
          '#root>div>div>div{color:#e6e8eb!important}',
        ].join('')).then(key => { bootCssKey = key }).catch(() => {})
      } catch {}
    })
  }
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-frame-navigate', details => {
    if (isTrustedTarget(details.url, trustedOrigin)) return
    details.preventDefault()
  })
  window.webContents.on('will-redirect', details => {
    if (isTrustedTarget(details.url, trustedOrigin)) return
    details.preventDefault()
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    if (shuttingDown) return
    void failAndExit(new Error(`Desktop renderer stopped unexpectedly (${details.reason}).`))
  })
  if (smokeMode) {
    // Smoke diagnostics: forward renderer console errors to the captured output.
    window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      process.stderr.write(`[renderer:${String(level)}] ${message} (${sourceId}:${String(line)})\n`)
    })
  }
  window.on('close', event => {
    if (allowWindowDestroy) return
    event.preventDefault()
    if (!smokeMode) persistWindowBounds(window)
    if (!smokeMode && tray !== undefined && !tray.isDestroyed() && desktopSettings?.closeToTray) {
      window.hide()
      updateTrayMenu()
      return
    }
    void shutdownAndExit(0, 'window-close')
  })
  if (!smokeMode) {
    let boundsTimer
    const scheduleBoundsSave = () => {
      clearTimeout(boundsTimer)
      boundsTimer = setTimeout(() => {
        if (!window.isDestroyed() && !shuttingDown) persistWindowBounds(window)
      }, 400)
    }
    window.on('resize', scheduleBoundsSave)
    window.on('move', scheduleBoundsSave)
    window.on('maximize', scheduleBoundsSave)
    window.on('unmaximize', scheduleBoundsSave)
  }
  window.on('show', updateTrayMenu)
  window.on('hide', updateTrayMenu)
  window.on('session-end', () => {
    if (!shuttingDown) void shutdownAndExit(0, 'session-end')
  })
  window.on('closed', () => {
    mainWindow = undefined
  })
  return window
}

function createTray() {
  try {
    const image = nativeImage.createFromPath(APP_ICON_PATH).resize({ width: 20, height: 20 })
    if (image.isEmpty()) throw new Error(`Tray icon could not be loaded: ${APP_ICON_PATH}`)
    tray = new Tray(image)
    tray.setToolTip(appFlavor.name)
    tray.on('click', showMainWindow)
    tray.on('double-click', showMainWindow)
    updateTrayMenu()
  } catch (error) {
    tray = undefined
    console.error(`Unable to create the desktop tray: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function updateTrayMenu() {
  if (tray === undefined || tray.isDestroyed()) return
  const visible = mainWindow !== undefined && !mainWindow.isDestroyed() && mainWindow.isVisible()
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: visible ? '隐藏主窗口' : '显示主窗口',
      enabled: pageLoaded,
      click: visible ? hideMainWindow : showMainWindow,
    },
    {
      label: '打开当前工作区',
      enabled: supervisor?.workspaceRoot !== undefined,
      click: () => void openDirectory(supervisor?.workspaceRoot),
    },
    {
      label: '打开桌面设置目录',
      click: () => void openDirectory(app.getPath('userData')),
    },
    {
      label: '检查 GitHub 更新',
      enabled: pageLoaded && updateService !== undefined && !shuttingDown,
      click: () => void checkUpdatesFromTray(),
    },
    { type: 'separator' },
    {
      label: '关闭窗口时最小化到托盘',
      type: 'checkbox',
      checked: desktopSettings?.closeToTray === true,
      click: item => updateDesktopSettings({ closeToTray: item.checked }),
    },
    {
      label: '自动维护桌面快捷方式',
      type: 'checkbox',
      checked: desktopSettings?.maintainShortcuts.desktop === true,
      click: item => updateShortcutSetting('desktop', item.checked),
    },
    {
      label: '自动维护开始菜单快捷方式',
      type: 'checkbox',
      checked: desktopSettings?.maintainShortcuts.startMenu === true,
      click: item => updateShortcutSetting('startMenu', item.checked),
    },
    {
      label: '立即维护快捷方式',
      enabled: app.isPackaged && process.platform === 'win32',
      click: () => refreshManagedShortcuts(true),
    },
    { type: 'separator' },
    {
      label: '退出并清理后台进程',
      click: () => void shutdownAndExit(0, 'tray-exit'),
    },
  ]))
}

/** 等待主题呈现器写入 colorScheme（表示首帧已带主题底色），超时仍返回以避免卡住启动。 */
async function waitForThemeApplied(window, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline && !shuttingDown && !window.isDestroyed()) {
    try {
      const applied = await window.webContents.executeJavaScript(
        "document.documentElement.style.colorScheme === 'light' || document.documentElement.style.colorScheme === 'dark'",
        true,
      )
      if (applied === true) return true
    } catch {
      // 页面尚未就绪时读取失败，继续等待。
    }
    await delay(60)
  }
  return false
}

function showMainWindow() {
  if (!pageLoaded || mainWindow === undefined || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  // 强制重绘一帧，确保 show() 呈现的是当前 UI 而非隐藏期间的空白面。
  try {
    mainWindow.webContents.invalidate()
  } catch {}
  mainWindow.show()
  mainWindow.focus()
  updateTrayMenu()
}

function hideMainWindow() {
  if (mainWindow === undefined || mainWindow.isDestroyed()) return
  mainWindow.hide()
  updateTrayMenu()
}

/** @param {string | undefined} path */
async function openDirectory(path) {
  if (!path) return
  const error = await shell.openPath(path)
  if (error) dialog.showErrorBox('无法打开目录', error)
}

/** @param {Record<string, unknown>} patch */
function updateDesktopSettings(patch) {
  try {
    desktopSettings = saveDesktopSettings(app.getPath('userData'), {
      ...desktopSettings,
      ...patch,
    })
    updateTrayMenu()
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`Unable to save desktop settings: ${message}`)
    dialog.showErrorBox('桌面设置保存失败', message)
    updateTrayMenu()
    return false
  }
}

/** @param {'desktop' | 'startMenu'} location @param {boolean} enabled */
function updateShortcutSetting(location, enabled) {
  const saved = updateDesktopSettings({
    maintainShortcuts: {
      ...desktopSettings.maintainShortcuts,
      [location]: enabled,
    },
  })
  if (saved && enabled) refreshManagedShortcuts()
}

function refreshManagedShortcuts(showResult = false) {
  if (smokeMode || !app.isPackaged || process.platform !== 'win32') return []
  const results = maintainShortcuts({
    shellApi: shell,
    shortcutPaths,
    enabled: desktopSettings.maintainShortcuts,
    target: resolveLaunchTarget(),
    appId: appFlavor.appId,
    shortcutDescription: appFlavor.shortcutDescription,
  })
  const errors = results.filter(result => result.status === 'error')
  for (const result of errors) console.error(`Shortcut maintenance failed for ${result.path}: ${result.error}`)
  if (showResult) {
    const changed = results.filter(result => ['created', 'updated'].includes(result.status)).length
    const protectedCount = results.filter(result => result.status === 'preserved-unmanaged').length
    const detail = [
      `已创建或修复：${changed}`,
      `无需修改：${results.filter(result => result.status === 'current').length}`,
      `已停用：${results.filter(result => result.status === 'disabled').length}`,
      `为保护非本应用快捷方式而跳过：${protectedCount}`,
      `失败：${errors.length}`,
    ].join('\n')
    void dialog.showMessageBox({ type: errors.length ? 'warning' : 'info', title: '快捷方式维护', message: '快捷方式检查完成', detail })
  }
  return results
}

async function checkUpdatesFromTray() {
  if (updateService === undefined || shuttingDown) return
  try {
    const state = await updateService.check()
    const available = []
    if (state.desktop.status === 'available') available.push(`Personal ${state.desktop.latestVersion ?? ''}`.trim())
    if (state.harness.status === 'available' || state.harness.status === 'ready') {
      available.push(`Harness ${state.harness.remoteCommit?.slice(0, 10) ?? ''}`.trim())
    }
    await dialog.showMessageBox({
      type: 'info',
      title: 'GitHub 更新检查',
      message: available.length === 0 ? '当前没有可用更新' : `发现 ${available.length} 项更新`,
      detail: available.length === 0 ? '可以在设置中的“更新中心”查看各组件状态。' : available.join('\n'),
    })
  } catch (error) {
    dialog.showErrorBox('更新检查失败', error instanceof Error ? error.message : String(error))
  }
}

function getDesktopIntegrationState() {
  const shortcuts = Object.entries(shortcutPaths).map(([location, path]) => {
    const exists = existsSync(path)
    let managed = false
    if (exists) {
      try {
        managed = isManagedShortcut(shell.readShortcutLink(path), appFlavor.appId, appFlavor.shortcutDescription)
      } catch {
        managed = false
      }
    }
    return { location, path, exists, managed }
  })
  const jobActive = supervisor?.processProtection?.active === true
  return {
    appName: app.getName(),
    appVersion: app.getVersion(),
    packaging: !app.isPackaged ? 'development' : process.env.PORTABLE_EXECUTABLE_FILE ? 'portable' : 'nsis',
    trayAvailable: tray !== undefined && !tray.isDestroyed(),
    closeToTray: desktopSettings.closeToTray,
    maintainShortcuts: { ...desktopSettings.maintainShortcuts },
    shortcuts,
    processGuardian: {
      active: supervisor !== undefined,
      strategy: jobActive ? 'windows-job-object' : 'graceful-and-tree-fallback',
      helperAssigned: jobActive,
    },
  }
}

function configureDesktopIntegration(settings) {
  desktopSettings = saveDesktopSettings(app.getPath('userData'), settings)
  refreshManagedShortcuts()
  updateTrayMenu()
  return getDesktopIntegrationState()
}

function repairDesktopShortcuts() {
  refreshManagedShortcuts()
  return getDesktopIntegrationState()
}

/** @param {BrowserWindow} window @param {string} trustedOrigin */
function configurePermissions(window, trustedOrigin) {
  const webSession = window.webContents.session
  const isAllowedClipboardWrite = (permission, candidateUrl) => {
    return permission === 'clipboard-sanitized-write'
      && safeOrigin(candidateUrl) === trustedOrigin
  }
  webSession.setPermissionCheckHandler((_contents, permission, requestingOrigin) => {
    return isAllowedClipboardWrite(permission, requestingOrigin)
  })
  webSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    const requestingUrl = details?.requestingUrl ?? contents.getURL()
    callback(isAllowedClipboardWrite(permission, requestingUrl))
  })
}

/** @param {string} target @param {string} trustedOrigin */
function isTrustedTarget(target, trustedOrigin) {
  try {
    const parsed = new URL(target)
    return parsed.protocol === 'http:' && parsed.origin === trustedOrigin
  } catch {
    return false
  }
}

/** @param {string | undefined} value */
function safeOrigin(value) {
  if (!value) return undefined
  try {
    return new URL(value).origin
  } catch {
    return undefined
  }
}

function assertTrustedDesktopSender(event) {
  const senderUrl = event.senderFrame?.url ?? event.sender?.getURL?.()
  if (shuttingDown
    || mainWindow === undefined || mainWindow.isDestroyed()
    || event.sender !== mainWindow.webContents
    || trustedUrl === undefined
    || safeOrigin(senderUrl) !== trustedUrl.origin) {
    throw new Error('Desktop bridge rejected an untrusted renderer.')
  }
}

async function handleStartFailure(error) {
  if (updateService !== undefined && activeSourceRoot !== undefined && !bootFallbackAttempted) {
    bootFallbackAttempted = true
    try {
      if (await updateService.recordHarnessBoot(activeSourceRoot, false)) {
        appendBootLog('handleStartFailure: auto-rollback triggered; relaunching with previous runtime')
        relaunchAfterShutdown = true
        await shutdownAndExit(0, 'harness-update-auto-rollback')
        return
      }
    } catch (rollbackError) {
      console.error(`Harness update rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`)
    }
  }
  if (!shuttingDown) await failAndExit(error)
}

/** @param {unknown} error */
function appendBootLog(line) {
  try {
    appendFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'boot-error.log'),
      new Date().toISOString() + ' ' + String(line) + '\n',
    )
  } catch {}
}

process.on('uncaughtException', error => {
  appendBootLog(`uncaughtException: ${error?.stack ?? String(error)}`)
})
process.on('unhandledRejection', reason => {
  appendBootLog(`unhandledRejection: ${reason?.stack ?? String(reason)}`)
})

async function failAndExit(error) {
  if (shuttingDown) return
  fatalMessage = error instanceof Error ? error.message : String(error)
  const visibleMessage = fatalMessage.slice(-4_000)
  console.error(visibleMessage)
  appendBootLog(`fatal: ${fatalMessage}`)
  if (!smokeMode) dialog.showErrorBox('DeepSeek Harness 启动失败', visibleMessage)
  await shutdownAndExit(1, 'fatal-error')
}

/** @param {number} requestedCode @param {string} reason */
function shutdownAndExit(requestedCode, reason) {
  shutdownPromise ??= (async () => {
    shuttingDown = true
    updateTrayMenu()
    let stopResult = { graceful: supervisor === undefined, forced: false, code: null, signal: null }
    let stopError
    if (updateService !== undefined) {
      try {
        await updateService.quiesce()
      } catch (error) {
        stopError = error instanceof Error ? error.message : String(error)
        console.error(stopError)
        shuttingDown = false
        shutdownPromise = undefined
        updateTrayMenu()
        const message = `无法确认更新任务的后台进程已经退出。应用与 Harness 将继续运行。\n\n${stopError}`
        if (!smokeMode) dialog.showErrorBox('DeepSeek Harness 关闭失败', message)
        return
      }
    }
    if (supervisor !== undefined) {
      try {
        stopResult = await supervisor.stop()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        stopError = stopError === undefined ? message : `${stopError}\n${message}`
        console.error(message)
      }
    }

    if (stopError !== undefined) {
      shuttingDown = false
      shutdownPromise = undefined
      updateTrayMenu()
      const message = `无法确认 Harness 后台进程已经退出。桌面监督进程将保持运行。\n\n${stopError}`
      if (!smokeMode) dialog.showErrorBox('DeepSeek Harness 关闭失败', message)
      return
    }

    if (updateService !== undefined) await updateService.dispose()
    disposeBrowserViewBridge?.()
    disposeBrowserViewBridge = undefined
    disposeDesktopBridge?.()
    disposeDesktopBridge = undefined

    const portClosed = trustedUrl === undefined ? true : await waitForPortClosed(trustedUrl)
    if (!stopResult.graceful) console.error('Harness did not acknowledge graceful shutdown.')
    if (!portClosed) console.error(`Harness port ${trustedUrl?.port ?? 'unknown'} remained reachable.`)

    electronMetrics = app.getAppMetrics().map(metric => ({
      pid: metric.pid,
      creationTime: metric.creationTime,
      type: metric.type,
    }))
    // 退出路径兜底保存窗口边界（托盘退出时窗口可能已隐藏、不再触发 close 事件）。
    if (!smokeMode && mainWindow !== undefined && !mainWindow.isDestroyed()) {
      try {
        persistWindowBounds(mainWindow)
      } catch (error) {
        console.error('Unable to persist window bounds on shutdown: ' + (error instanceof Error ? error.message : String(error)))
      }
    }
    allowWindowDestroy = true
    if (mainWindow !== undefined && !mainWindow.isDestroyed()) mainWindow.destroy()
    if (tray !== undefined && !tray.isDestroyed()) tray.destroy()
    tray = undefined

    const smokePassed = requestedCode === 0
      && pageLoaded
      && stopResult.graceful
      && !stopResult.forced
      && portClosed
      && stopError === undefined
      && fatalMessage === undefined
      && personalState?.passed === true
    if (smokeMode && smokeResultPath) {
      writeFileSync(smokeResultPath, `${JSON.stringify({
        reason,
        pageLoaded,
        url: trustedUrl?.href,
        helperPid: supervisor?.child.pid,
        processProtection: supervisor?.processProtection,
        electronMetrics,
        stop: stopResult,
        portClosed,
        fatalMessage,
        stopError,
        personalState,
        passed: smokePassed,
      }, null, 2)}\n`, 'utf8')
    }
    if (!smokeMode && pendingInstallerPath !== undefined) launchInstaller(pendingInstallerPath)
    else if (!smokeMode && relaunchAfterShutdown) scheduleApplicationRelaunch()
    app.exit(smokeMode ? (smokePassed ? 0 : 1) : requestedCode)
  })()
  return shutdownPromise
}

function launchInstaller(path) {
  // The immutable Dev-E2E package may pass /S so the Windows Sandbox can run
  // unattended. Stable and normal Dev keep the exact interactive behavior.
  const installerArgs = BUILD_FLAVOR === 'dev' && E2E_BUILD === true ? ['/S'] : []
  const devE2E = BUILD_FLAVOR === 'dev' && E2E_BUILD === true
  if (devE2E && process.env.DSH_DESKTOP_E2E_INSTALLER_CANCEL === '1') {
    // E2E-only negative: simulate the user cancelling before the installer
    // process starts. installPending/previousDesktop are already persisted.
    console.error('Desktop installer launch cancelled by Dev-E2E scenario.')
    return
  }
  const failInstaller = devE2E && process.env.DSH_DESKTOP_E2E_INSTALLER_FAIL === '1'
  const installerPath = failInstaller ? join(dirname(path), 'dsh-e2e-missing-installer.exe') : path
  const child = spawn(installerPath, installerArgs, {
    cwd: dirname(path),
    detached: true,
    shell: false,
    stdio: 'ignore',
    windowsHide: false,
  })
  child.once('error', error => {
    console.error(`Desktop installer could not be launched: ${error instanceof Error ? error.message : String(error)}`)
  })
  child.unref()
}

function scheduleApplicationRelaunch() {
  const portableExecutable = process.env.PORTABLE_EXECUTABLE_FILE
  if (portableExecutable) app.relaunch({ execPath: portableExecutable, args: [] })
  else app.relaunch()
}

/**
 * A1 fiber doctor: when a plugin generation is activating, verify every
 * external package in that candidate batch reports `fiberPhase=active` from
 * the live Harness plugin inventory. Returns true when no activation is in
 * progress or when all external packages are active.
 */
async function verifyExternalPluginFiber() {
  const externalRoot = resolveExternalRoot({ env: process.env, userData: app.getPath('userData') })
  if (externalRoot === null) return true
  const activatingPath = join(externalRoot, 'activating.json')
  if (!existsSync(activatingPath)) return true
  let activating
  try {
    activating = JSON.parse(readFileSync(activatingPath, 'utf8'))
  } catch {
    return false
  }
  const generationDir = join(externalRoot, 'generations', activating?.candidateId ?? '')
  const batchPath = join(generationDir, 'batch.json')
  if (!existsSync(batchPath)) return false
  let batch
  try {
    batch = JSON.parse(readFileSync(batchPath, 'utf8'))
  } catch {
    return false
  }
  const externalNames = Object.entries(batch?.packages ?? {})
    .filter(([, info]) => info?.source === 'external')
    .map(([name]) => name)
  if (externalNames.length === 0) return true
  if (mainWindow === undefined || mainWindow.isDestroyed()) return false
  let observed
  try {
    observed = await mainWindow.webContents.executeJavaScript(`(async () => {
      const response = await fetch('/__personal/api/plugins', {
        headers: { 'x-dsh-personal-client': '1' },
      })
      const payload = await response.json()
      const plugins = Array.isArray(payload?.data?.plugins)
        ? payload.data.plugins
        : Array.isArray(payload?.plugins)
          ? payload.plugins
          : []
      return Object.fromEntries(plugins
        .map(plugin => [plugin?.packageName ?? plugin?.name, plugin?.fiberPhase])
        .filter(([name]) => typeof name === 'string' && name.length > 0))
    })()`, true)
  } catch (error) {
    appendBootLog(`fiber doctor query failed: ${error instanceof Error ? error.message : String(error)}`)
    return false
  }
  return externalNames.every(name => observed[name] === 'active')
}

/** @param {BrowserWindow} window */
async function inspectPersonalFeatures(window) {
  const expected = [...PERSONAL_PLUGIN_PACKAGES]
  const forbidden = ['@deepseek-ai/dsh-client-ui-layout']
  const observed = await window.webContents.executeJavaScript(`(async () => {
    const entries = Array.isArray(window.__DSH_BOOT__?.entries)
      ? window.__DSH_BOOT__.entries.map(entry => entry?.id).filter(id => typeof id === 'string')
      : []
    let api
    try {
      const resources = ['theme', 'skills', 'plugins', 'connections']
      const checks = await Promise.all(resources.map(async resource => {
        const response = await fetch('/__personal/api/' + resource, {
          headers: { 'x-dsh-personal-client': '1' },
        })
        const payload = await response.json()
        if (resource === 'plugins') {
          const plugins = Array.isArray(payload?.data?.plugins)
            ? payload.data.plugins
            : Array.isArray(payload?.plugins)
              ? payload.plugins
              : []
          const fiber = Object.fromEntries(plugins
            .map(plugin => [plugin?.packageName ?? plugin?.name, plugin?.fiberPhase])
            .filter(([name]) => typeof name === 'string' && name.length > 0))
          return [resource, { status: response.status, ok: payload?.ok === true, fiber }]
        }
        return [resource, { status: response.status, ok: payload?.ok === true }]
      }))
      api = Object.fromEntries(checks)
      const balanceResponse = await fetch('/__personal/usage-balance', {
        headers: { 'x-dsh-personal-client': '1' },
      })
      const balancePayload = await balanceResponse.json()
      api.usageBalance = {
        status: balanceResponse.status,
        ok: balancePayload?.ok === true,
        state: balancePayload?.data?.status,
      }
      const terminalResponse = await fetch('/__personal/terminal/tabs?sessionId=smoke-readonly', {
        headers: { 'x-dsh-personal-terminal': '1' },
      })
      const terminalPayload = await terminalResponse.json()
      api.sessionTerminal = {
        status: terminalResponse.status,
        ok: terminalPayload?.ok === true,
        tabCount: terminalPayload?.data?.terminals?.length,
      }
      const projectControlResponse = await fetch('/__personal/project-control/v1alpha1/status', {
        headers: { 'x-dsh-personal-client': '1' },
      })
      const projectControlPayload = await projectControlResponse.json()
      const projectCandidatesResponse = await fetch('/__personal/project-control/v1alpha1/intake/candidates', {
        headers: { 'x-dsh-personal-client': '1' },
      })
      const projectCandidatesPayload = await projectCandidatesResponse.json()
      const templatesResponse = await fetch('/__personal/project-control/v1alpha1/templates', {
        headers: { 'x-dsh-personal-client': '1' },
      })
      const templatesPayload = await templatesResponse.json()
      api.projectControl = {
        status: projectControlResponse.status,
        ok: projectControlPayload?.ok === true,
        storageState: projectControlPayload?.data?.storage?.state,
        schemaVersion: projectControlPayload?.data?.storage?.schemaVersion,
        projectCount: projectControlPayload?.data?.counts?.projects,
        candidateStatus: projectCandidatesResponse.status,
        candidateCount: projectCandidatesPayload?.data?.total,
        templateStatus: templatesResponse.status,
        templateCount: templatesPayload?.data?.total,
        intakeCapabilities: ['intake.directory.scan', 'intake.candidates.read', 'intake.candidates.review']
          .every(capability => projectControlPayload?.data?.capabilities?.includes(capability)),
        documentCapabilities: ['project.documents.read', 'project.documents.refresh', 'project.document-rebind.resolve']
          .every(capability => projectControlPayload?.data?.capabilities?.includes(capability)),
      }
    } catch (error) {
      api = { status: 0, ok: false, error: error instanceof Error ? error.message : String(error) }
    }
    let desktopBridge
    try {
      const bridge = window.deepseekHarnessPersonal
      const methodsPresent = typeof bridge?.desktop?.getState === 'function'
        && typeof bridge?.updates?.getState === 'function'
        && typeof bridge?.billing?.open === 'function'
        && typeof bridge?.projectControl?.selectDirectory === 'function'
      const [desktop, updates] = methodsPresent
        ? await Promise.all([bridge.desktop.getState(), bridge.updates.getState()])
        : [undefined, undefined]
      desktopBridge = {
        methodsPresent,
        desktopStateOk: desktop?.appName === ${JSON.stringify(appFlavor.name)},
        updateStateOk: Array.isArray(updates?.plugins),
      }
    } catch (error) {
      desktopBridge = { methodsPresent: false, desktopStateOk: false, updateStateOk: false,
        error: error instanceof Error ? error.message : String(error) }
    }
    let gate1Shell
    try {
      const frame = document.querySelector('[data-personal-shell="gate-1"]')
      const sidebarColumn = document.querySelector('[data-personal-sidebar-column]')
      const projectPanel = document.querySelector('[data-personal-project-panel]')
      let projectControl = document.querySelector('[data-personal-project-control="gate-2c"]')
      for (let attempt = 0; attempt < 40
        && projectControl?.getAttribute('data-project-storage-state') !== 'ready'; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 50))
        projectControl = document.querySelector('[data-personal-project-control="gate-2c"]')
      }
      const projectControlButtons = projectControl instanceof HTMLElement
        ? [...projectControl.querySelectorAll('button')]
        : []
      const sourceScanPresent = projectControlButtons.some(button => button.textContent?.includes('扫描来源目录'))
      const projectImportPresent = projectControlButtons.some(button => button.textContent?.includes('导入单个项目'))
      const projectCreatePresent = projectControlButtons.some(button => button.textContent?.includes('快速新建标准项目'))
      const workbenchPanel = document.querySelector('[data-personal-workbench-panel]')
      const workbench = document.querySelector('[data-personal-workbench="gate-1"]')
      const workbenchTabs = [...document.querySelectorAll('[data-personal-workbench="gate-1"] [role="tab"]')]
      const projectEntry = document.querySelector('button[aria-label="切换项目控制台"]')
      const projectCollapse = document.querySelector('button[aria-label="收起项目控制台"]')
      const projectFooterSeat = projectEntry?.closest('[data-slot="sidebar.footer.action"]')
      const projectDivider = document.querySelector('[data-personal-divider="project"]')
      const initialInlineGrid = frame instanceof HTMLElement ? frame.style.gridTemplateColumns : ''
      const initialComputedGrid = frame instanceof HTMLElement ? getComputedStyle(frame).gridTemplateColumns : ''
      const initialFrameWidth = frame instanceof HTMLElement ? frame.getBoundingClientRect().width : 0
      const initialTracks = initialComputedGrid
        .split(/\\s+/u)
        .filter(Boolean)
        .map(value => Number.parseFloat(value))
      const initialProjectWidth = initialTracks[1] ?? 0
      const initialConversationWidth = initialTracks[2] ?? 0
      const initialWorkbenchWidth = initialTracks[3] ?? 0
      const initialNoHorizontalOverflow = frame instanceof HTMLElement
        && frame.scrollWidth <= frame.clientWidth + 1
      const sidebarToggle = [...document.querySelectorAll('button')].find(button =>
        ['打开侧边栏', '收起侧边栏', 'Open sidebar', 'Collapse sidebar'].includes(button.getAttribute('aria-label') ?? ''))
      const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => resolve()))
      let projectArrowPresent = false
      let projectArrowInPanel = false
      let projectArrowRailWidth = 0
      let projectArrowCollapsed = false
      let projectArrowRestored = false
      let projectArrowRestoredWidth = 0
      let projectSidebarCollapsed = false
      let projectSidebarRestored = false
      let projectSidebarRestoredWidth = 0
      const projectCollapseInPanel = projectPanel instanceof HTMLElement
        && projectCollapse instanceof HTMLButtonElement
        && projectPanel.contains(projectCollapse)
      if (frame instanceof HTMLElement
        && projectEntry instanceof HTMLButtonElement
        && projectCollapse instanceof HTMLButtonElement) {
        const before = frame.hasAttribute('data-project-collapsed')
        projectCollapse.click()
        await nextFrame()
        const projectExpand = document.querySelector('button[aria-label="展开项目控制台"]')
        projectArrowPresent = projectExpand instanceof HTMLButtonElement
        projectArrowInPanel = projectPanel instanceof HTMLElement
          && projectExpand instanceof HTMLButtonElement
          && projectPanel.contains(projectExpand)
        projectArrowRailWidth = Number.parseFloat(frame.style.gridTemplateColumns.split(/\\s+/u)[1] ?? '0')
        projectArrowCollapsed = frame.hasAttribute('data-project-collapsed') !== before
          && frame.hasAttribute('data-project-collapsed')
        projectExpand?.click()
        await nextFrame()
        projectArrowRestored = frame.hasAttribute('data-project-collapsed') === before
        projectArrowRestoredWidth = Number.parseFloat(frame.style.gridTemplateColumns.split(/\\s+/u)[1] ?? '0')

        projectEntry.click()
        await nextFrame()
        projectSidebarCollapsed = frame.hasAttribute('data-project-collapsed') !== before
          && frame.hasAttribute('data-project-collapsed')
        projectEntry.click()
        await nextFrame()
        projectSidebarRestored = frame.hasAttribute('data-project-collapsed') === before
        projectSidebarRestoredWidth = Number.parseFloat(frame.style.gridTemplateColumns.split(/\\s+/u)[1] ?? '0')
      }
      const renderedTracks = () => frame instanceof HTMLElement
        ? getComputedStyle(frame).gridTemplateColumns.split(/\\s+/u).filter(Boolean)
        : []
      let workbenchExpandPresent = false
      let workbenchExpanded = false
      let workbenchExpandedWidth = 0
      let workbenchExpandedProjectWidth = 0
      let workbenchExpandedConversationWidth = 0
      let workbenchNoHorizontalOverflow = false
      let projectYieldedToWorkbench = false
      let workbenchCollapsePresent = false
      let workbenchCollapsed = false
      let workbenchRailWidth = 0
      let workbenchRestored = false
      let workbenchDividerPresent = false
      let detailsTabActivated = false
      let layoutMenuPresent = false
      let focusConversationWorked = false
      let resetLayoutWorked = false
      if (frame instanceof HTMLElement && workbenchPanel instanceof HTMLElement) {
        const expandWorkbench = document.querySelector('button[aria-label="展开工作台"]')
        workbenchExpandPresent = expandWorkbench instanceof HTMLButtonElement
          && workbenchPanel.contains(expandWorkbench)
        expandWorkbench?.click()
        await nextFrame()
        workbenchExpanded = !frame.hasAttribute('data-workbench-collapsed')
        const expandedTracks = renderedTracks()
        workbenchExpandedWidth = Number.parseFloat(expandedTracks.at(-1) ?? '0')
        workbenchExpandedProjectWidth = Number.parseFloat(expandedTracks[1] ?? '0')
        workbenchExpandedConversationWidth = Number.parseFloat(expandedTracks[2] ?? '0')
        workbenchNoHorizontalOverflow = frame.scrollWidth <= frame.clientWidth + 1
        projectYieldedToWorkbench = frame.hasAttribute('data-project-collapsed')
        workbenchCollapsePresent = document.querySelector('button[aria-label="收起工作台"]') instanceof HTMLButtonElement
        workbenchDividerPresent = document.querySelector('[data-personal-divider="workbench"]') instanceof HTMLElement

        const detailsTab = workbenchTabs.find(tab => tab.getAttribute('data-workbench-family') === 'details')
        detailsTab?.click()
        await nextFrame()
        detailsTabActivated = workbench?.getAttribute('data-personal-workbench-family') === 'details'

        const collapseWorkbench = document.querySelector('button[aria-label="收起工作台"]')
        collapseWorkbench?.click()
        await nextFrame()
        workbenchCollapsed = frame.hasAttribute('data-workbench-collapsed')
        workbenchRailWidth = Number.parseFloat(renderedTracks().at(-1) ?? '0')
        document.querySelector('button[aria-label="展开工作台"]')?.click()
        await nextFrame()
        workbenchRestored = !frame.hasAttribute('data-workbench-collapsed')

        const layoutMenu = document.querySelector('[data-personal-layout-menu]')
        layoutMenuPresent = layoutMenu instanceof HTMLDetailsElement
        layoutMenu?.querySelector('summary')?.click()
        layoutMenu?.querySelector('[data-personal-layout-action="focus-conversation"]')?.click()
        await nextFrame()
        focusConversationWorked = frame.hasAttribute('data-project-collapsed')
          && frame.hasAttribute('data-workbench-collapsed')

        document.querySelector('button[aria-label="展开工作台"]')?.click()
        await nextFrame()
        const resetMenu = document.querySelector('[data-personal-layout-menu]')
        resetMenu?.querySelector('summary')?.click()
        resetMenu?.querySelector('[data-personal-layout-action="reset-layout"]')?.click()
        await nextFrame()
        resetLayoutWorked = !frame.hasAttribute('data-project-collapsed')
          && frame.hasAttribute('data-workbench-collapsed')
      }
      let sidebarToggled = false
      let sidebarRestored = false
      if (frame instanceof HTMLElement && sidebarToggle instanceof HTMLButtonElement) {
        const before = frame.hasAttribute('data-sidebar-collapsed')
        sidebarToggle.click()
        await nextFrame()
        sidebarToggled = frame.hasAttribute('data-sidebar-collapsed') !== before
        sidebarToggle.click()
        await nextFrame()
        sidebarRestored = frame.hasAttribute('data-sidebar-collapsed') === before
      }
      const themeColorMeta = document.head.querySelectorAll('meta[name="theme-color"]')
      gate1Shell = {
        rootPresent: frame instanceof HTMLElement,
        projectPanelPresent: projectPanel instanceof HTMLElement,
        projectControlPresent: projectControl instanceof HTMLElement,
        projectControlStorageReady: projectControl?.getAttribute('data-project-storage-state') === 'ready',
        projectControlProjectCount: Number(projectControl?.getAttribute('data-project-count')),
        sourceScanPresent,
        projectImportPresent,
        projectCreatePresent,
        projectEntryPresent: projectEntry instanceof HTMLButtonElement,
        projectEntryInSidebar: sidebarColumn instanceof HTMLElement
          && projectEntry instanceof HTMLButtonElement
          && sidebarColumn.contains(projectEntry),
        projectFooterStacked: projectFooterSeat instanceof HTMLElement
          && getComputedStyle(projectFooterSeat).display === 'flex'
          && getComputedStyle(projectFooterSeat).flexDirection === 'column',
        projectCollapsePresent: projectCollapse instanceof HTMLButtonElement,
        projectCollapseInPanel,
        floatingProjectControlAbsent: frame instanceof HTMLElement
          && frame.querySelector(':scope > button[aria-label*="项目控制台"]') === null,
        projectDividerPresent: projectDivider instanceof HTMLElement,
        initialInlineGrid,
        initialComputedGrid,
        initialFrameWidth,
        initialWindowWidth: window.innerWidth,
        initialProjectWidth,
        initialConversationWidth,
        initialWorkbenchWidth,
        initialNoHorizontalOverflow,
        projectArrowPresent,
        projectArrowInPanel,
        projectArrowRailWidth,
        projectArrowCollapsed,
        projectArrowRestored,
        projectArrowRestoredWidth,
        projectSidebarCollapsed,
        projectSidebarRestored,
        projectSidebarRestoredWidth,
        workbenchPanelPresent: workbenchPanel instanceof HTMLElement,
        workbenchPresent: workbench instanceof HTMLElement,
        workbenchTabCount: workbenchTabs.length,
        workbenchExpandPresent,
        workbenchExpanded,
        workbenchExpandedWidth,
        workbenchExpandedProjectWidth,
        workbenchExpandedConversationWidth,
        workbenchNoHorizontalOverflow,
        projectYieldedToWorkbench,
        workbenchCollapsePresent,
        workbenchCollapsed,
        workbenchRailWidth,
        workbenchRestored,
        workbenchDividerPresent,
        detailsTabActivated,
        layoutMenuPresent,
        focusConversationWorked,
        resetLayoutWorked,
        sidebarTogglePresent: sidebarToggle instanceof HTMLButtonElement,
        sidebarToggled,
        sidebarRestored,
        gridTrackCount: frame instanceof HTMLElement
          ? getComputedStyle(frame).gridTemplateColumns.split(/\\s+/u).filter(Boolean).length
          : 0,
        themePresenterPresent: ['light', 'dark'].includes(document.documentElement.style.colorScheme)
          && themeColorMeta.length === 1
          && themeColorMeta[0]?.getAttribute('content') !== '',
      }
    } catch (error) {
      gate1Shell = { rootPresent: false, error: error instanceof Error ? error.message : String(error) }
    }
    // Gate 2C intake e2e：先把工作台收成轨道（模拟真实使用），再扫描 → 候选点击 → 断言工作台自动展开并出现 details 视图 → 只关联登记
    let gate2cIntake
    try {
      const collapseWorkbenchButton = document.querySelector('button[aria-label="收起工作台"]')
      collapseWorkbenchButton?.click()
      await new Promise(resolve => requestAnimationFrame(() => resolve()))
      const shellFrame = document.querySelector('[data-personal-shell="gate-1"]')
      const workbenchCollapsedBeforeClick = shellFrame?.hasAttribute('data-workbench-collapsed') === true
      const scanSourceButton = [...document.querySelectorAll('button')]
        .find(button => button.textContent?.includes('扫描来源目录'))
      scanSourceButton?.click()
      let candidateRowButton = null
      for (let attempt = 0; attempt < 100; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 100))
        candidateRowButton = [...document.querySelectorAll('[data-personal-project-control="gate-2c"] button')]
          .find(button => button.textContent?.includes('synthetic-food-project'))
        if (candidateRowButton !== null) break
      }
      candidateRowButton?.click()
      let detailsViewer = null
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 100))
        detailsViewer = document.querySelector('[data-personal-workbench-plugin-view="project-control.candidate-details"]')
        if (detailsViewer !== null) break
      }
      const confirmButton = detailsViewer === null ? null : [...detailsViewer.querySelectorAll('button')]
        .find(button => (button.textContent ?? '').includes('只关联') || (button.textContent ?? '').includes('登记现有受管理项目'))
      confirmButton?.click()
      let projectRegistered = false
      let registeredProjectId
      for (let attempt = 0; attempt < 60; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 100))
        const response = await fetch('/__personal/project-control/v1alpha1/projects', { headers: { 'x-dsh-personal-client': '1' } })
        const payload = await response.json()
        const projects = payload?.ok === true && Array.isArray(payload?.data?.projects) ? payload.data.projects : []
        if (projects.length > 0) {
          projectRegistered = true
          registeredProjectId = projects[0]?.projectId
          break
        }
      }
      // 冲突候选：断言 details 视图出现、只关联按钮存在但被禁用且有可见原因
      let conflictCandidate
      try {
        const conflictRowButton = [...document.querySelectorAll('[data-personal-project-control="gate-2c"] button')]
          .find(button => button.textContent?.includes('synthetic-conflict-project'))
        conflictRowButton?.click()
        let conflictDetails = null
        let conflictMatched = false
        for (let attempt = 0; attempt < 50; attempt += 1) {
          await new Promise(resolve => setTimeout(resolve, 100))
          conflictDetails = document.querySelector('[data-personal-workbench-plugin-view="project-control.candidate-details"]')
          if (conflictDetails?.textContent?.includes('synthetic-conflict-project')) { conflictMatched = true; break }
          // 点击可能落在控制台刷新前的旧行上：周期性重新找行再点一次
          if (attempt === 10 || attempt === 25 || attempt === 40) {
            const row = [...document.querySelectorAll('[data-personal-project-control="gate-2c"] button')]
              .find(button => button.textContent?.includes('synthetic-conflict-project'))
            row?.click()
          }
        }
        if (!conflictMatched) conflictDetails = null
        const conflictConfirm = conflictDetails === null ? null : [...conflictDetails.querySelectorAll('button')]
          .find(button => (button.textContent ?? '').includes('只关联') || (button.textContent ?? '').includes('登记现有受管理项目'))
        const conflictSelects = conflictDetails === null ? [] : [...conflictDetails.querySelectorAll('select')]
        const conflictReasonBefore = conflictDetails?.querySelector('[role="alert"]')?.textContent ?? ''
        const conflictBadgesBefore = conflictDetails === null ? 0 : conflictDetails.querySelectorAll('[data-project-control-role-conflict]').length
        const disabledBefore = conflictConfirm instanceof HTMLButtonElement ? conflictConfirm.disabled : null
        // 一键解决：点「自动处理重复角色」，断言只关联按钮变可用且每角色只留一份
        const conflictAuto = conflictDetails?.querySelector('[data-project-control-auto-resolve-roles]')
        if (conflictAuto instanceof HTMLButtonElement && !conflictAuto.disabled) {
          conflictAuto.click()
          await new Promise(resolve => setTimeout(resolve, 200))
          await new Promise(resolve => requestAnimationFrame(() => resolve()))
        }
        const conflictConfirmAfter = conflictDetails === null ? null : [...conflictDetails.querySelectorAll('button')]
          .find(button => (button.textContent ?? '').includes('只关联') || (button.textContent ?? '').includes('登记现有受管理项目'))
        conflictCandidate = {
          rowPresent: conflictRowButton !== null,
          detailsMatched: conflictMatched,
          detailsViewerPresent: conflictDetails !== null,
          confirmPresent: conflictConfirm !== null,
          confirmDisabled: disabledBefore,
          reasonBefore: conflictReasonBefore,
          selectsFound: conflictSelects.length,
          autoResolvePresent: conflictAuto != null,
          conflictBadgesBefore: conflictBadgesBefore,
          confirmDisabledAfterResolve: conflictConfirmAfter instanceof HTMLButtonElement ? conflictConfirmAfter.disabled : null,
          roleValuesAfterResolve: conflictDetails === null ? [] : [...conflictDetails.querySelectorAll('select')].map(select => select.value),
          conflictBadgesAfter: conflictDetails === null ? 0 : conflictDetails.querySelectorAll('[data-project-control-role-conflict]').length,
          reasonAfter: conflictDetails?.querySelector('[role="alert"]')?.textContent ?? '',
        }
      } catch (error) {
        conflictCandidate = { error: error instanceof Error ? error.message : String(error) }
      }
      // 下拉框变更存活探针：在候选详情里改文档角色 select，断言工作台与面板不消失
      let selectChangeSurvival
      try {
        const foodRow = [...document.querySelectorAll('[data-personal-project-control="gate-2c"] button')]
          .find(button => button.textContent?.includes('synthetic-food-project') && !button.textContent?.includes('冲突'))
        foodRow?.click()
        let foodDetails = null
        for (let attempt = 0; attempt < 20; attempt += 1) {
          await new Promise(resolve => setTimeout(resolve, 100))
          foodDetails = document.querySelector('[data-personal-workbench-plugin-view="project-control.candidate-details"]')
          if (foodDetails?.textContent?.includes('synthetic-food-project')) break
        }
        window.__smokeCapturedError = null
        window.__smokeConsoleErrors = []
        const originalConsoleError = console.error.bind(console)
        console.error = (...args) => {
          window.__smokeConsoleErrors.push(args.map(value => String(value?.stack ?? value?.message ?? value)).join(' | '))
          originalConsoleError(...args)
        }
        window.addEventListener('error', event => {
          window.__smokeCapturedError = String(event?.error?.stack ?? event?.error ?? event?.message ?? 'unknown')
        })
        const select = foodDetails?.querySelector('select')
        if (select !== null && select !== undefined) {
          const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
          setter?.call(select, 'ignore')
          select.dispatchEvent(new Event('change', { bubbles: true }))
          await new Promise(resolve => setTimeout(resolve, 150))
          await new Promise(resolve => requestAnimationFrame(() => resolve()))
        }
        selectChangeSurvival = {
          selectFound: select !== null && select !== undefined,
          shellPresent: document.querySelector('[data-personal-shell="gate-1"]') !== null,
          workbenchPanelPresent: document.querySelector('[data-personal-workbench-panel]') !== null,
          detailsViewerStillPresent: document.querySelector('[data-personal-workbench-plugin-view="project-control.candidate-details"]') !== null,
          boundaryFallbackAppeared: document.querySelector('[data-personal-boundary-fallback]') !== null,
          capturedError: window.__smokeCapturedError,
          consoleErrors: (window.__smokeConsoleErrors ?? []).slice(-4),
        }
      } catch (error) {
        selectChangeSurvival = { error: error instanceof Error ? error.message : String(error) }
      }      // 文件树停靠探针：默认展开 → 点「文件」收起（同一位置图标翻转为展开态）→ 再点展开
      let filesDock
      try {
        const panel = document.querySelector('[data-personal-workbench="gate-1"]')
        const dockBefore = panel?.querySelector('[data-personal-workbench-files-dock]') ?? null
        const treeViewerCountOpen = panel === null ? 0 : panel.querySelectorAll('[data-workspace-viewer="files"]').length
        const filesTabPresent = panel?.querySelector('[data-workbench-family="file"]') !== null
        const toggle = panel?.querySelector('[data-personal-workbench-files-toggle]') ?? null
        if (toggle instanceof HTMLButtonElement) {
          toggle.click()
          await new Promise(resolve => setTimeout(resolve, 200))
          await new Promise(resolve => requestAnimationFrame(() => resolve()))
        }
        const dockAfterCollapse = panel?.querySelector('[data-personal-workbench-files-dock]') ?? null
        const toggleCollapsed = panel?.querySelector('[data-personal-workbench-files-toggle]') ?? null
        const railAfterCollapse = toggleCollapsed !== null && toggleCollapsed.getAttribute('aria-label') === '展开文件树'
        const treeViewerCountCollapsed = panel === null ? 0 : panel.querySelectorAll('[data-workspace-viewer="files"]').length
        if (toggleCollapsed instanceof HTMLButtonElement) {
          toggleCollapsed.click()
          await new Promise(resolve => setTimeout(resolve, 200))
          await new Promise(resolve => requestAnimationFrame(() => resolve()))
        }
        const dockAfterReopen = panel?.querySelector('[data-personal-workbench-files-dock]') ?? null
        filesDock = {
          dockOpenBefore: dockBefore !== null,
          treeViewerCountOpen: treeViewerCountOpen,
          filesTabPresent: filesTabPresent,
          dockAfterCollapse: dockAfterCollapse !== null,
          railAfterCollapse: railAfterCollapse !== null,
          treeViewerCountCollapsed: treeViewerCountCollapsed,
          dockAfterReopen: dockAfterReopen !== null,
        }
      } catch (error) {
        filesDock = { error: error instanceof Error ? error.message : String(error) }
      }      // 全屏探针：点全屏 → 外壳进入 fullscreen 且会话轨道为 0px → 再点退出
      let fullscreenProbe
      try {
        const frame = document.querySelector('[data-personal-shell="gate-1"]')
        const fsButton = document.querySelector('[data-personal-workbench-fullscreen-toggle]')
        if (fsButton instanceof HTMLButtonElement) {
          fsButton.click()
          await new Promise(resolve => setTimeout(resolve, 250))
          await new Promise(resolve => requestAnimationFrame(() => resolve()))
        }
        const frameAfter = document.querySelector('[data-personal-shell="gate-1"]')
        const fullscreenOn = frameAfter?.hasAttribute('data-workbench-fullscreen') === true
        // 读内联样式：computed 值会被 grid 过渡插值
        const gridAfter = frameAfter === null ? '' : frameAfter.style.gridTemplateColumns
        const fsButtonAfter = document.querySelector('[data-personal-workbench-fullscreen-toggle]')
        if (fsButtonAfter instanceof HTMLButtonElement) {
          fsButtonAfter.click()
          await new Promise(resolve => setTimeout(resolve, 250))
          await new Promise(resolve => requestAnimationFrame(() => resolve()))
        }
        const frameFinal = document.querySelector('[data-personal-shell="gate-1"]')
        const conversationRect = frameAfter?.querySelector('[data-personal-conversation-column]')?.getBoundingClientRect()
        fullscreenProbe = {
          togglePresent: fsButton !== null,
          fullscreenOn,
          inlineGrid: gridAfter,
          conversationWidth: conversationRect === undefined ? null : Math.round(conversationRect.width),
          conversationTrackZero: gridAfter.split(/ +/).includes('0px'),
          fullscreenOffAfterToggle: frameFinal?.hasAttribute('data-workbench-fullscreen') === false,
        }
      } catch (error) {
        fullscreenProbe = { error: error instanceof Error ? error.message : String(error) }
      }      // 项目工作区绑定探针：点击控制台项目行「打开控制台」→ 文件树绑定项目根
      let projectWorkspaceBinding
      try {
        const hostStatus = registeredProjectId === undefined
          ? null
          : await fetch('/__personal/project-control/v1alpha1/projects/' + encodeURIComponent(registeredProjectId) + '/workspace/status', { headers: { 'x-dsh-personal-client': '1' } }).then(r => r.json()).catch(() => null)
        const hostRoot = hostStatus?.ok === true ? String(hostStatus?.data?.root ?? '') : ''
        const consoleSection = document.querySelector('[data-personal-project-control="gate-2c"]')
        const openConsoleButtons = [...document.querySelectorAll('[data-personal-project-control="gate-2c"] [data-open-console]')]
        const openConsoleButton = openConsoleButtons
          .find(button => registeredProjectId !== undefined && button.closest('li')?.textContent?.includes(registeredProjectId))
        const consoleSample = consoleSection?.textContent?.slice(0, 400) ?? ''
        const openConsoleLiText = openConsoleButtons[0]?.closest('li')?.textContent ?? ''
        if (openConsoleButton instanceof HTMLButtonElement) {
          openConsoleButton.click()
          await new Promise(resolve => setTimeout(resolve, 700))
          await new Promise(resolve => requestAnimationFrame(() => resolve()))
        }
        const filesViewer = document.querySelector('[data-personal-workbench-files-dock] [data-workspace-viewer="files"]')
        const dockRoot = filesViewer?.getAttribute('data-workspace-root') ?? ''
        const dockText = filesViewer?.textContent ?? ''
        const readmeRow = filesViewer === null ? null : [...filesViewer.querySelectorAll('button')]
          .find(button => (button.textContent ?? '').includes('README.md'))
        if (readmeRow instanceof HTMLButtonElement) {
          readmeRow.click()
          await new Promise(resolve => setTimeout(resolve, 700))
          await new Promise(resolve => requestAnimationFrame(() => resolve()))
        }
        const previewViewer = document.querySelector('[data-workspace-viewer="preview"]')
        const previewText = previewViewer?.textContent ?? ''
        // 路径栏悬浮窗探针：点击路径栏第一个目录段 → 悬浮窗出现并列出根目录条目
        const pathBarPresentEarly = document.querySelector('[data-personal-workbench-pathbar]') !== null
        const pathRootSegment = [...document.querySelectorAll('[data-personal-workbench-pathbar] [data-workspace-path-segment]')][0]
        if (pathRootSegment instanceof HTMLButtonElement) {
          pathRootSegment.click()
          await new Promise(resolve => setTimeout(resolve, 500))
          await new Promise(resolve => requestAnimationFrame(() => resolve()))
        }
        const pathPopup = document.querySelector('[data-workspace-path-popup]')
        const pathPopupText = pathPopup?.textContent ?? ''
        // 文件树搜索框探针：输入 README → 结果出现且路径底色条隐藏
        const searchBox = document.querySelector('[data-workspace-files-search]')
        if (searchBox instanceof HTMLInputElement) {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
          setter?.call(searchBox, 'README')
          searchBox.dispatchEvent(new Event('input', { bubbles: true }))
          await new Promise(resolve => setTimeout(resolve, 700))
          await new Promise(resolve => requestAnimationFrame(() => resolve()))
        }
        const searchResultsText = document.querySelector('[data-workspace-files-search-results]')?.textContent ?? ''
        const pathChip = document.querySelector('[data-workspace-viewer="files"] .pathChip')
        // 预览/代码切换探针：md 预览视图有切换器，点「代码」出现纯代码视图
        const viewSwitch = previewViewer?.querySelector('[data-view-switch]')
        const codeTab = viewSwitch?.querySelector('[data-view-switch-code]') ?? null
        if (codeTab instanceof HTMLButtonElement) {
          codeTab.click()
          await new Promise(resolve => setTimeout(resolve, 250))
          await new Promise(resolve => requestAnimationFrame(() => resolve()))
        }
        const codeViewPresent = document.querySelector('[data-workspace-viewer="preview"] [data-code-view]') !== null
        // R-ED 偏好探针 B：设置卡片同款 update 路径（__wbPreferencesStore.update）
        let updatePathApplied = false
        let updatePathDetail = ''
        try {
          window.__DSH_SMOKE__ = true
          // 确保预览视图（文档节点存在）
          const switchToPreview = document.querySelector('[data-view-switch] button[role="tab"]')
          if (switchToPreview instanceof HTMLButtonElement) {
            switchToPreview.click()
            await new Promise(resolve => setTimeout(resolve, 300))
            await new Promise(resolve => requestAnimationFrame(() => resolve()))
          }
          const store = window.__wbPreferencesStore
          if (store !== undefined && typeof store.update === 'function') {
            store.update(draft => {
              draft.readerFontSize = 17.2
              draft.readerTextColor = 'dark'
              draft.readerBackground = 'paper'
            })
            await new Promise(resolve => setTimeout(resolve, 400))
            await new Promise(resolve => requestAnimationFrame(() => resolve()))
            const docNode = document.querySelector('[data-workspace-markdown-document]')
            if (docNode !== null) {
              const computed = window.getComputedStyle(docNode)
              updatePathDetail = computed.fontSize + '|' + computed.color
              updatePathApplied = computed.fontSize === '17.2px'
            } else {
              updatePathDetail = 'no-document-node'
            }
          } else {
            updatePathDetail = 'no-store-hook'
          }
        } catch (error) {
          updatePathDetail = error instanceof Error ? error.message : String(error)
        }
        // R-ED 面板字体探针：设置 panelFontFamily → 断言 section computed fontFamily
        let panelFontApplied = false
        try {
          const prefKey2 = '@cyrus/dsh-workbench:v1:editing-preferences'
          const panelStore = window.__wbPreferencesStore
          if (panelStore !== undefined && typeof panelStore.update === 'function') {
            panelStore.update(draft => { draft.panelFontFamily = 'yahei' })
            await new Promise(resolve => setTimeout(resolve, 300))
            await new Promise(resolve => requestAnimationFrame(() => resolve()))
            const panel = document.querySelector('[data-personal-workbench]')
            if (panel !== null) {
              const computed = window.getComputedStyle(panel)
              panelFontApplied = computed.fontFamily.includes('YaHei')
            }
          }
        } catch { /* 面板字体探针失败不影响主流程 */ }
        // R-ED 偏好生效探针：注入偏好（storage 事件）→ 断言阅读器 computed style
        let preferenceApplied = false
        let preferenceDetail = ''
        try {
          const prefKey = '@cyrus/dsh-workbench:v1:editing-preferences'
          const current = JSON.parse(localStorage.getItem(prefKey) ?? '{}')
          current.readerFontSize = 17.2
          current.readerTextColor = 'dark'
          current.readerBackground = 'paper'
          current.readerFontFamily = 'system'
          localStorage.setItem(prefKey, JSON.stringify(current))
          window.dispatchEvent(new StorageEvent('storage', { key: prefKey }))
          await new Promise(resolve => setTimeout(resolve, 500))
          await new Promise(resolve => requestAnimationFrame(() => resolve()))
          // viewSwitch 探针此前切到了「代码」视图：先切回「预览」再断言排版偏好
          const switchBack = document.querySelector('[data-view-switch] button[role="tab"]')
          if (switchBack instanceof HTMLButtonElement) {
            switchBack.click()
            await new Promise(resolve => setTimeout(resolve, 400))
            await new Promise(resolve => requestAnimationFrame(() => resolve()))
          }
          const documentNode = document.querySelector('[data-workspace-markdown-document]')
          if (documentNode !== null) {
            const computed = window.getComputedStyle(documentNode)
            const bodyNode = documentNode.querySelector(':scope > div')
            const bodyComputed = bodyNode === null ? null : window.getComputedStyle(bodyNode)
            preferenceDetail = computed.fontSize + '|' + computed.color + '|body=' + String(bodyComputed?.fontSize ?? 'none') + '|' + String(bodyComputed?.color ?? 'none')
            preferenceApplied = computed.fontSize === '17.2px' && bodyComputed !== null && bodyComputed.fontSize === '17.2px' && bodyComputed.color === computed.color
          } else {
            preferenceDetail = 'no-document-node'
          }
        } catch (error) {
          preferenceDetail = error instanceof Error ? error.message : String(error)
        }
        // R-ED 用户环境复现：套用用户真实偏好后点编辑（排除偏好差异致装饰失效）
        let userPrefsApplied = 'not-run'
        try {
          const storeU = window.__wbPreferencesStore
          if (storeU !== undefined && typeof storeU.update === 'function') {
            storeU.update(d => {
              d.readerBackground = 'custom'
              d.customBackground = '#a08546'
              d.readerTextColor = 'dark'
              d.customTextColor = '#ad1414'
              d.customBackgroundOpacity = 60
              d.readerFontSize = 16.8
              d.readerWidth = 1080
              d.readerFontFamily = 'georgia'
              d.codeFontFamily = 'cascadia'
              d.remoteMediaNotice = true
              d.lineWrapping = true
              d.showLineNumbers = true
              d.panelFontFamily = 'pingfang'
            })
            userPrefsApplied = 'ok'
            await new Promise(resolve => setTimeout(resolve, 500))
            await new Promise(resolve => requestAnimationFrame(() => resolve()))
          } else {
            userPrefsApplied = 'no-hook'
          }
        } catch (error) {
          userPrefsApplied = error instanceof Error ? error.message : String(error)
        }
        // R-ED 探针：点击「编辑」→ TipTap 富文本编辑器挂载；同时捕获渲染错误
        let editorPresent = false
        let editCrash = ''
        const editStart = document.querySelector('[data-edit-start]')
        if (editStart instanceof HTMLButtonElement) {
          try {
            editStart.click()
            await new Promise(resolve => setTimeout(resolve, 900))
            await new Promise(resolve => requestAnimationFrame(() => resolve()))
            editorPresent = document.querySelector('[data-rich-markdown-editor]') !== null
          } catch (error) {
            editCrash = error instanceof Error ? error.message : String(error)
          }
        }
        // R-ED WYSIWYG 探针：编辑态下 ProseMirror 渲染语义节点，不再显示 # / > 标记
        let livePreviewHiddenMarkers = false
        let livePreviewDetail = ''
        try {
          const pm = document.querySelector('[data-rich-markdown-editor] .ProseMirror')
          if (pm !== null) {
            const text = pm.textContent ?? ''
            const headingStyled = pm.querySelector('h1') !== null
            const blockquoteStyled = pm.querySelector('blockquote') !== null
            livePreviewDetail = 'heading=' + String(headingStyled) + '|blockquote=' + String(blockquoteStyled) + '|text=' + text.slice(0, 50)
            // README 以 # Synthetic Food Project 开头：富文本下 # 与 > 都不可见
            livePreviewHiddenMarkers = headingStyled && !text.includes('# Synthetic') && text.includes('Synthetic Food Project') && !text.includes('> 状态')
          } else {
            livePreviewDetail = 'no-rich-editor'
          }
        } catch (error) {
          livePreviewDetail = error instanceof Error ? error.message : String(error)
        }
        // R-ED 工具栏探针：富文本静态工具栏存在，且包含「加粗」按钮
        let toolbarShown = false
        let toolbarDetail = ''
        let sourceModeProbe = 'not-run'
        let outlineProbe = 'not-run'
        let diffProbe = 'not-run'
        let browserProbe = 'not-run'
        let codeProbe = 'not-run'
        try {
          const toolbarEl = document.querySelector('[data-rich-markdown-toolbar]')
          toolbarShown = toolbarEl !== null
          toolbarDetail = 'toolbar=' + String(toolbarShown)
          if (toolbarEl !== null) {
            const bold = [...toolbarEl.querySelectorAll('button')].find(button => button.getAttribute('title') === '加粗')
            toolbarDetail += '|boldButton=' + String(bold !== null)
          }
        } catch (error) {
          toolbarDetail = error instanceof Error ? error.message : String(error)
        }
        // R-ED Phase3 源码模式探针：切换后出现 textarea，切回后恢复富文本。
        try {
          const sourceToggle = document.querySelector('[data-rich-markdown-source-toggle]')
          if (sourceToggle instanceof HTMLButtonElement) {
            sourceToggle.click()
            await new Promise(resolve => setTimeout(resolve, 200))
            await new Promise(resolve => requestAnimationFrame(() => resolve()))
            const sourceArea = document.querySelector('[data-rich-markdown-source]')
            const sourceVisible = sourceArea instanceof HTMLTextAreaElement && sourceArea.value.length > 0
            sourceToggle.click()
            await new Promise(resolve => setTimeout(resolve, 200))
            await new Promise(resolve => requestAnimationFrame(() => resolve()))
            const richVisible = document.querySelector('[data-rich-markdown-editor] .ProseMirror') !== null
            sourceModeProbe = sourceVisible && richVisible ? 'ok' : 'source=' + String(sourceVisible) + '|rich=' + String(richVisible)
          } else {
            sourceModeProbe = 'no-toggle'
          }
        } catch (error) {
          sourceModeProbe = error instanceof Error ? error.message : String(error)
        }
        // R-ED 真实文件复现探针：打开 docs/M9_DESIGN.md → 编辑 → 语义节点必须存在
        let realFileProbe = 'not-run'
        try {
          const dockTree2 = document.querySelector('[data-personal-workbench-files-dock]')
          if (dockTree2 !== null) {
            // 前面的搜索探针在树里留了 README 过滤器——先清空
            const searchBox2 = document.querySelector('[data-workspace-files-search]')
            if (searchBox2 instanceof HTMLInputElement) {
              const setter2 = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
              if (setter2 !== undefined) {
                setter2.call(searchBox2, '')
                searchBox2.dispatchEvent(new Event('input', { bubbles: true }))
                await new Promise(resolve => setTimeout(resolve, 400))
                await new Promise(resolve => requestAnimationFrame(() => resolve()))
              }
            }
            const docsRow = [...dockTree2.querySelectorAll('button')].find(button => (button.textContent ?? '').includes('docs'))
            if (docsRow instanceof HTMLButtonElement) {
              docsRow.click()
              await new Promise(resolve => setTimeout(resolve, 600))
              await new Promise(resolve => requestAnimationFrame(() => resolve()))
            }
            const m9Row = [...dockTree2.querySelectorAll('button')].find(button => (button.textContent ?? '').includes('M9_DESIGN.md'))
            if (m9Row instanceof HTMLButtonElement) {
              m9Row.click()
              await new Promise(resolve => setTimeout(resolve, 900))
              await new Promise(resolve => requestAnimationFrame(() => resolve()))
              const editBtn2 = document.querySelector('[data-edit-start]')
              if (editBtn2 instanceof HTMLButtonElement) {
                editBtn2.click()
                await new Promise(resolve => setTimeout(resolve, 900))
                await new Promise(resolve => requestAnimationFrame(() => resolve()))
                const pm2 = document.querySelector('[data-rich-markdown-editor] .ProseMirror')
                const heading2 = pm2?.querySelector('h2') !== null
                const blockquote2 = pm2?.querySelector('blockquote') !== null
                const list2 = pm2?.querySelector('ul li, ol li') !== null
                const code2 = pm2?.querySelector('pre') !== null
                const quoteHidden = !String(pm2?.textContent ?? '').includes('> 状态')
                const contentScroller2 = document.querySelector('[data-rich-markdown-content]')
                const scrollable2 = contentScroller2 !== null && contentScroller2.scrollHeight > contentScroller2.clientHeight
                const footerInside2 = document.querySelector('[data-rich-markdown-editor] [data-document-footer]') !== null
                const footerEl2 = document.querySelector('[data-rich-markdown-editor] [data-document-footer]')
                const pmRect2 = pm2?.getBoundingClientRect()
                const footerRect2 = footerEl2?.getBoundingClientRect()
                const footerRightAligned2 = footerEl2 !== null && pmRect2 !== undefined && footerRect2 !== undefined && Math.abs(footerRect2.right - pmRect2.right) < 4
                realFileProbe = 'heading=' + String(heading2) + '|blockquote=' + String(blockquote2) + '|list=' + String(list2) + '|code=' + String(code2) + '|quoteHidden=' + String(quoteHidden) + '|scrollable=' + String(scrollable2) + '|footerInside=' + String(footerInside2) + '|footerRightAligned=' + String(footerRightAligned2) + '|text=' + String(pm2?.textContent ?? 'no-editor').slice(0, 40)
              } else {
                realFileProbe = 'no-edit-button'
              }
            } else {
              realFileProbe = 'no-m9-row|tree=' + String(dockTree2.textContent ?? '').slice(0, 100)
            }
          } else {
            realFileProbe = 'no-dock'
          }
        } catch (error) {
          realFileProbe = error instanceof Error ? error.message : String(error)
        }
        // R-ED 编辑态排版探针：17.2 + 楷体 → 富文本编辑器 computed style（编辑=阅读排版）
        let editorReaderStyleApplied = false
        let editorReaderStyleDetail = ''
        try {
          const store3 = window.__wbPreferencesStore
          if (store3 !== undefined && typeof store3.update === 'function') {
            store3.update(d => { d.readerFontSize = 17.2; d.readerFontFamily = 'kai' })
            await new Promise(resolve => setTimeout(resolve, 500))
            await new Promise(resolve => requestAnimationFrame(() => resolve()))
            const editPm = document.querySelector('[data-document-editor] [data-rich-markdown-editor] .ProseMirror')
            if (editPm !== null) {
              const computed = window.getComputedStyle(editPm)
              editorReaderStyleDetail = computed.fontSize + '|' + computed.fontFamily
              editorReaderStyleApplied = computed.fontSize === '17.2px' && /KaiTi|STKaiti|Kaiti|楷/i.test(computed.fontFamily)
            } else {
              editorReaderStyleDetail = 'no-edit-pm'
            }
          } else {
            editorReaderStyleDetail = 'no-store-hook'
          }
        } catch (error) {
          editorReaderStyleDetail = error instanceof Error ? error.message : String(error)
        }
        // R-ED 保存探针：M9 编辑态点击保存，必须不再出现「项目文件只读」
        let saveProbe = 'not-run'
        try {
          const saveBtn = document.querySelector('[data-save-document]')
          if (saveBtn instanceof HTMLButtonElement) {
            saveBtn.click()
            await new Promise(resolve => setTimeout(resolve, 900))
            await new Promise(resolve => requestAnimationFrame(() => resolve()))
            const bodyText = document.body.textContent ?? ''
            if (bodyText.includes('项目文件只读')) {
              saveProbe = 'readonly-error'
            } else if (bodyText.includes('已保存')) {
              saveProbe = 'saved'
            } else {
              saveProbe = bodyText.slice(0, 80)
            }
          } else {
            saveProbe = 'no-save-button'
          }
        } catch (error) {
          saveProbe = error instanceof Error ? error.message : String(error)
        }
        // 预览模式探针：待办/脚注应在 MarkdownText 预览中可见
        let previewFeatureProbe = 'not-run'
        try {
          const previewDoc = document.querySelector('[data-workspace-markdown-document]')
          const taskList = previewDoc?.querySelector('.md-task, .md-task-list') !== null
          const footnoteSection = previewDoc?.querySelector('[data-footnotes]') !== null
          const localLink = previewDoc?.querySelector('a.md-local-link, a[href^="./"], a[href^="../"], a[href^="/"]') !== null
          const mathInline = previewDoc?.querySelector('.math-inline') !== null
          const footnoteHeadingCount = [...(previewDoc?.querySelectorAll('h2') ?? [])].filter(node => (node.textContent ?? '').trim() === '脚注').length
          const previewText = previewDoc?.textContent ?? ''
          previewFeatureProbe = 'task=' + String(taskList) + '|footnotes=' + String(footnoteSection) + '|localLink=' + String(localLink) + '|math=' + String(mathInline) + '|footnoteHeadingCount=' + String(footnoteHeadingCount) + '|hasTask=' + String(previewText.includes('待办 A')) + '|hasTaskMarker=' + String(previewText.includes('[ ]')) + '|hasFootnote=' + String(previewText.includes('脚注内容') || previewText.includes('demo')) + '|hasFootnoteMarker=' + String(previewText.includes('[^')) + '|text=' + previewText.slice(0, 80)
        } catch (error) {
          previewFeatureProbe = error instanceof Error ? error.message : String(error)
        }
        // 保存后重新进入编辑态，供后续浮动/脚注/公式探针使用
        const editStartAfterSave = document.querySelector('[data-edit-start]')
        if (editStartAfterSave instanceof HTMLButtonElement) {
          editStartAfterSave.click()
          await new Promise(resolve => setTimeout(resolve, 900))
          await new Promise(resolve => requestAnimationFrame(() => resolve()))
        }
        // R-ED 浮动工具栏探针：选中文字后 BubbleMenu 应出现
        let bubbleShown = false
        let bubbleDetail = 'no-rich-editor'
        try {
          const richEditors = window.__wbRichEditors ?? []
          const richEditor = richEditors.find(editor => editor.options.element?.closest('[data-rich-markdown-editor]') !== null)
          if (richEditor !== undefined) {
            richEditor.commands.focus()
            richEditor.commands.setTextSelection({ from: 0, to: 5 })
            await new Promise(resolve => setTimeout(resolve, 250))
            await new Promise(resolve => requestAnimationFrame(() => resolve()))
            bubbleShown = document.querySelector('[data-rich-markdown-bubble]') !== null
            bubbleDetail = 'bubble=' + String(bubbleShown) + '|empty=' + String(richEditor.state.selection.empty) + '|focused=' + String(richEditor.isFocused)
          }
        } catch (error) {
          bubbleDetail = error instanceof Error ? error.message : String(error)
        }
        // R-ED 行内公式/脚注探针：点击工具栏按钮后应生成对应 DOM（先公式后脚注，避免脚注滚动影响公式可见性）
        let footnoteProbe = 'not-run'
        let mathProbe = 'not-run'
        let footnoteHtmlProbe = 'not-run'
        let saveAfterFootnoteProbe = 'not-run'
        let multiFootnoteProbe = 'not-run'
        try {
          const mathBtn = [...document.querySelectorAll('[data-rich-markdown-toolbar] button')].find(button => button.getAttribute('title') === '行内公式')
          if (mathBtn instanceof HTMLButtonElement) {
            mathBtn.click()
            await new Promise(resolve => setTimeout(resolve, 250))
            await new Promise(resolve => requestAnimationFrame(() => resolve()))
            mathProbe = document.querySelector('.math-inline') !== null ? 'ok' : 'no-math|dataMath=' + String(document.querySelector('[data-math]') !== null)
          } else {
            mathProbe = 'no-button'
          }
          const footnoteBtn = [...document.querySelectorAll('[data-rich-markdown-toolbar] button')].find(button => button.getAttribute('title') === '脚注')
          if (footnoteBtn instanceof HTMLButtonElement) {
            const footnoteIdsBefore = []
            const richEditorBeforeFn = (window.__wbRichEditors ?? []).find(editor => editor.options.element?.closest('[data-rich-markdown-editor]') !== null)
            richEditorBeforeFn?.state.doc.descendants(node => {
              if (node.type.name === 'footnote' || node.type.name === 'footnoteDefinition') footnoteIdsBefore.push(node.type.name + ':' + String(node.attrs.id))
              return true
            })
            footnoteBtn.click()
            await new Promise(resolve => setTimeout(resolve, 250))
            await new Promise(resolve => requestAnimationFrame(() => resolve()))
            const richEditorForFn = (window.__wbRichEditors ?? []).find(editor => editor.options.element?.closest('[data-rich-markdown-editor]') !== null)
            const stateText = richEditorForFn === undefined ? 'no-editor' : richEditorForFn.state.doc.textContent.slice(0, 40)
            const firstType = richEditorForFn?.state.doc.firstChild?.type.name ?? 'none'
            const childType = richEditorForFn?.state.doc.firstChild?.child(0)?.type.name ?? 'none'
            const schemaFootnoteNode = richEditorForFn?.schema.nodes.footnote !== undefined
            let hasFootnoteNode = false
            richEditorForFn?.state.doc.descendants(node => {
              if (node.type.name === 'footnote') { hasFootnoteNode = true; return false }
              return true
            })
            const defPresent = document.querySelector('.footnote-def') !== null
            const defHeadingPresent = [...document.querySelectorAll('[data-rich-markdown-editor] .ProseMirror h2')].some(node => (node.textContent ?? '').includes('脚注'))
            let hasDefNode = false
            richEditorForFn?.state.doc.descendants(node => {
              if (node.type.name === 'footnoteDefinition') { hasDefNode = true; return false }
              return true
            })
            const dataDefPresent = document.querySelector('[data-footnote-def]') !== null
            if (richEditorForFn !== undefined) {
              richEditorForFn.chain().focus().setTextSelection({ from: richEditorForFn.state.doc.content.size, to: richEditorForFn.state.doc.content.size }).scrollIntoView().run()
              await new Promise(resolve => setTimeout(resolve, 250))
              await new Promise(resolve => requestAnimationFrame(() => resolve()))
            }
            const defTextVisible = document.querySelector('.ProseMirror')?.textContent.includes('脚注内容') ?? false
            const pmText = document.querySelector('.ProseMirror')?.textContent ?? ''
            footnoteProbe = document.querySelector('.footnote-ref') !== null && defTextVisible
              ? 'ok'
              : 'no-ref|def=' + String(defPresent) + '|dataDef=' + String(dataDefPresent) + '|defTextVisible=' + String(defTextVisible) + '|hasDefNode=' + String(hasDefNode) + '|defHeading=' + String(defHeadingPresent) + '|dataFootnote=' + String(document.querySelector('[data-footnote]') !== null) + '|schemaFootnoteNode=' + String(schemaFootnoteNode) + '|hasFootnoteNode=' + String(hasFootnoteNode) + '|firstType=' + firstType + '|childType=' + childType + '|state=' + stateText + '|idsBefore=' + footnoteIdsBefore.join(',') + '|pmText=' + pmText.slice(-120)
            // 防止回归：脚注节点存在时 getHTML()（DOMSerializer/renderSpec）不得抛 Content hole 错误。
            try {
              const html = richEditorForFn?.getHTML()
              footnoteHtmlProbe = typeof html === 'string' && html.includes('footnote-def') ? 'ok' : 'no-html|' + String(html).slice(0, 60)
            } catch (htmlError) {
              footnoteHtmlProbe = htmlError instanceof Error ? htmlError.message : String(htmlError)
            }
            // 防止回归：连续插入多个脚注时，序列化必须分成独立的 [^n]: 行，不能串成一行。
            try {
              const footnoteBtn2 = [...document.querySelectorAll('[data-rich-markdown-toolbar] button')].find(button => button.getAttribute('title') === '脚注')
              if (footnoteBtn2 instanceof HTMLButtonElement) {
                footnoteBtn2.click()
                await new Promise(resolve => setTimeout(resolve, 250))
                await new Promise(resolve => requestAnimationFrame(() => resolve()))
                const richEditorForMulti = (window.__wbRichEditors ?? []).find(editor => editor.options.element?.closest('[data-rich-markdown-editor]') !== null)
                const multiMd = richEditorForMulti?.storage.markdown.getMarkdown() ?? ''
                const multiDefLines = multiMd.split('\\n').filter(line => /^\\s*\\[\\^[^\\]]+\\]:/.test(line))
                multiFootnoteProbe = multiDefLines.length >= 2 ? 'ok' : 'bad|defLines=' + String(multiDefLines.length) + '|md=' + multiMd.slice(-200)
              } else {
                multiFootnoteProbe = 'no-button'
              }
            } catch (multiError) {
              multiFootnoteProbe = multiError instanceof Error ? multiError.message : String(multiError)
            }
            // 防止回归：插入新脚注后直接保存，保存后预览渲染不得崩溃。
            const saveBtnAfterFn = document.querySelector('[data-save-document]')
            if (saveBtnAfterFn instanceof HTMLButtonElement) {
              saveBtnAfterFn.click()
              await new Promise(resolve => setTimeout(resolve, 900))
              await new Promise(resolve => requestAnimationFrame(() => resolve()))
              const bodyTextAfterFn = document.body.textContent ?? ''
              const previewDocAfterFn = document.querySelector('[data-workspace-markdown-document]')
              if (bodyTextAfterFn.includes('已保存')) {
                saveAfterFootnoteProbe = previewDocAfterFn !== null ? 'saved-preview-ok' : 'saved-no-preview'
              } else if (bodyTextAfterFn.includes('项目文件只读')) {
                saveAfterFootnoteProbe = 'readonly-error'
              } else if (previewDocAfterFn !== null) {
                saveAfterFootnoteProbe = 'preview-ok|' + bodyTextAfterFn.slice(0, 80)
              } else {
                saveAfterFootnoteProbe = bodyTextAfterFn.slice(0, 80)
              }
            } else {
              saveAfterFootnoteProbe = 'no-save-button'
            }
          } else {
            footnoteProbe = 'no-button'
          }
        } catch (error) {
          footnoteProbe = error instanceof Error ? error.message : String(error)
          mathProbe = error instanceof Error ? error.message : String(error)
          if (footnoteHtmlProbe === 'not-run') footnoteHtmlProbe = error instanceof Error ? error.message : String(error)
          if (saveAfterFootnoteProbe === 'not-run') saveAfterFootnoteProbe = error instanceof Error ? error.message : String(error)
        }
        // Workbench 四页签探针：通过 smoke hook 打开 Outline/Diff/Browser/Code，检查核心结构在场。
        try {
          const opener = window.__wbOpenWorkbenchIntent
          if (typeof opener !== 'function') {
            outlineProbe = 'no-hook'
          } else {
            opener({ family: 'outline', viewerId: 'workbench.workspace-outline', resourceKey: 'workspace-outline:follow', title: '大纲' })
            await new Promise(resolve => setTimeout(resolve, 300))
            await new Promise(resolve => requestAnimationFrame(() => resolve()))
            outlineProbe = document.querySelector('[data-personal-workbench-outline]') !== null ? 'ok' : 'no-outline'

            opener({ family: 'diff', viewerId: 'workbench.workspace-diff', resourceKey: 'workspace-diff:docs/README.md|docs/PRD.md', title: 'Diff' })
            await new Promise(resolve => setTimeout(resolve, 300))
            await new Promise(resolve => requestAnimationFrame(() => resolve()))
            diffProbe = document.querySelector('[data-personal-workbench-diff]') !== null ? 'ok' : 'no-diff'

            opener({ family: 'browser', viewerId: 'workbench.workspace-browser', title: 'Browser' })
            await new Promise(resolve => setTimeout(resolve, 300))
            await new Promise(resolve => requestAnimationFrame(() => resolve()))
            browserProbe = document.querySelector('[data-personal-workbench-browser]') !== null ? 'ok' : 'no-browser'

            opener({ family: 'preview', viewerId: 'workbench.workspace-code', resourceKey: 'workspace:docs/sample.txt', title: 'sample.txt' })
            await new Promise(resolve => setTimeout(resolve, 300))
            await new Promise(resolve => requestAnimationFrame(() => resolve()))
            codeProbe = document.querySelector('[data-personal-workbench-preview] [data-code-view]') !== null ? 'ok' : 'no-code'
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          outlineProbe = message
          diffProbe = message
          browserProbe = message
          codeProbe = message
        }
        // R-ED 本地文件/图片全链路探针：附件卡片与本地图片的 插入→序列化→保存→预览→再编辑→点击打开
        let localFileImageProbe = 'not-run'
        try {
          const workspaceStatusResp = await fetch('/__personal/project-control/v1alpha1/projects/' + encodeURIComponent(String(registeredProjectId)) + '/workspace/status', { headers: { 'x-dsh-personal-client': '1' } })
          const workspaceStatusPayload = await workspaceStatusResp.json()
          const projectRootAbs = String(workspaceStatusPayload?.data?.root ?? '').split(String.fromCharCode(92)).join('/')
          const dockTree3 = document.querySelector('[data-personal-workbench-files-dock]')
          let fixtureRow = dockTree3 === null ? undefined : [...dockTree3.querySelectorAll('button')].find(button => (button.textContent ?? '').includes('附件测试.md'))
          if (fixtureRow === undefined && dockTree3 !== null) {
            const docsRow3 = [...dockTree3.querySelectorAll('button')].find(button => (button.textContent ?? '').trim() === 'docs')
            if (docsRow3 instanceof HTMLButtonElement) {
              docsRow3.click()
              await new Promise(resolve => setTimeout(resolve, 600))
              await new Promise(resolve => requestAnimationFrame(() => resolve()))
              fixtureRow = [...dockTree3.querySelectorAll('button')].find(button => (button.textContent ?? '').includes('附件测试.md'))
            }
          }
          if (fixtureRow === undefined || projectRootAbs === '') {
            localFileImageProbe = 'no-fixture-row|root=' + projectRootAbs
          } else {
            fixtureRow.click()
            await new Promise(resolve => setTimeout(resolve, 900))
            await new Promise(resolve => requestAnimationFrame(() => resolve()))
            const editBtn3 = document.querySelector('[data-edit-start]')
            if (editBtn3 instanceof HTMLButtonElement) {
              editBtn3.click()
              await new Promise(resolve => setTimeout(resolve, 900))
              await new Promise(resolve => requestAnimationFrame(() => resolve()))
            }
            const richEditor3 = (window.__wbRichEditors ?? []).find(editor => editor.options.element?.closest('[data-rich-markdown-editor]') !== null)
            if (richEditor3 === undefined) {
              localFileImageProbe = 'no-rich-editor'
            } else {
              const absTarget = projectRootAbs + '/docs/子 目录/目 标 文件.md'
              const absPng = projectRootAbs + '/docs/测试图片.png'
              const absMissing = projectRootAbs + '/docs/不存在.txt'
              richEditor3.chain().focus().insertContent([
                { type: 'fileAttachment', attrs: { name: '目 标 文件.md', href: absTarget } },
                { type: 'image', attrs: { src: '', alt: '测试图片', dataPath: './测试图片.png' } },
                { type: 'fileAttachment', attrs: { name: '不存在.txt', href: './不存在.txt' } },
              ]).run()
              await new Promise(resolve => setTimeout(resolve, 400))
              await new Promise(resolve => requestAnimationFrame(() => resolve()))
              const mdOut = String(richEditor3.storage.markdown.getMarkdown())
              const serLinkOk = mdOut.includes('[目 标 文件.md](<' + absTarget + '>)')
              const serImgOk = mdOut.includes('![测试图片](./测试图片.png)')
              const serMissingOk = mdOut.includes('[不存在.txt](./不存在.txt)')
              const saveBtn3 = document.querySelector('[data-save-document]')
              if (saveBtn3 instanceof HTMLButtonElement) {
                saveBtn3.click()
                await new Promise(resolve => setTimeout(resolve, 1200))
                await new Promise(resolve => requestAnimationFrame(() => resolve()))
              }
              const rereadResp = await fetch('/__personal/project-control/v1alpha1/projects/' + encodeURIComponent(String(registeredProjectId)) + '/workspace/file?path=' + encodeURIComponent('docs/附件测试.md'), { headers: { 'x-dsh-personal-client': '1' } })
              const rereadPayload = await rereadResp.json()
              const diskText = String(rereadPayload?.data?.content ?? '')
              const diskLinkOk = diskText.includes('[目 标 文件.md](<' + absTarget + '>)')
              const diskImgOk = diskText.includes('![测试图片](./测试图片.png)')
              let previewImgData = false
              let previewLinkOk = false
              for (let attempt = 0; attempt < 20; attempt += 1) {
                await new Promise(resolve => setTimeout(resolve, 150))
                const previewDoc2 = document.querySelector('[data-workspace-markdown-document]')
                if (previewDoc2 !== null) {
                  const previewImg = previewDoc2.querySelector('img')
                  previewImgData = previewImg !== null && String(previewImg.getAttribute('src') ?? '').startsWith('data:image/png')
                  previewLinkOk = [...previewDoc2.querySelectorAll('a.md-local-link')].some(anchor => (anchor.textContent ?? '').includes('目 标 文件.md'))
                  if (previewImgData && previewLinkOk) break
                }
              }
              const editBtn4 = document.querySelector('[data-edit-start]')
              if (editBtn4 instanceof HTMLButtonElement) {
                editBtn4.click()
                await new Promise(resolve => setTimeout(resolve, 900))
                await new Promise(resolve => requestAnimationFrame(() => resolve()))
              }
              const richEditor4 = (window.__wbRichEditors ?? []).find(editor => editor.options.element?.closest('[data-rich-markdown-editor]') !== null)
              let restoredAttachment = 0
              let restoredImage = 0
              let attachmentHrefOk = false
              let imageHrefOk = false
              richEditor4?.state.doc.descendants(node => {
                if (node.type.name === 'fileAttachment') {
                  restoredAttachment += 1
                  const decodedHref = String(node.attrs.href ?? '')
                  let plain = decodedHref
                  try { plain = decodeURIComponent(decodedHref) } catch {}
                  if (plain.includes('目 标 文件.md') || decodedHref.includes('目 标 文件.md')) attachmentHrefOk = true
                }
                if (node.type.name === 'image') {
                  restoredImage += 1
                  const imagePath = String(node.attrs.dataPath ?? node.attrs.src ?? '')
                  let plainImagePath = imagePath
                  try { plainImagePath = decodeURIComponent(imagePath) } catch {}
                  if (plainImagePath.includes('测试图片.png') || imagePath.includes('测试图片.png')) imageHrefOk = true
                }
                return true
              })
              let editorImgData = false
              let editorImgFailed = false
              for (let attempt = 0; attempt < 20; attempt += 1) {
                await new Promise(resolve => setTimeout(resolve, 150))
                const editorImg = document.querySelector('[data-rich-markdown-editor] .image-container img')
                if (editorImg !== null && String(editorImg.getAttribute('src') ?? '').startsWith('data:image/png')) { editorImgData = true; break }
                if (document.querySelector('[data-image-load-failed]') !== null) { editorImgFailed = true; break }
              }
              // 点击打开探针：点「不存在.txt」卡片 → 不退出编辑、不导航、出现失败反馈
              let clickDefaultPrevented = false
              let stillEditing = false
              let urlSame = false
              let openErrorShown = false
              const missingCard = [...document.querySelectorAll('.file-attachment')].find(el => (el.textContent ?? '').includes('不存在'))
              const missingAnchor = missingCard?.querySelector('a.file-attachment-link')
              if (missingAnchor instanceof HTMLAnchorElement) {
                const urlBefore2 = location.href
                // dispatchEvent 返回 false 即事件被 preventDefault（卡片点击被彻底消费）。
                // 不能靠 window 冒泡观察：组件同时调了 stopPropagation，事件本就到不了 window。
                const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true })
                clickDefaultPrevented = missingAnchor.dispatchEvent(clickEvent) === false
                await new Promise(resolve => setTimeout(resolve, 1200))
                await new Promise(resolve => requestAnimationFrame(() => resolve()))
                stillEditing = document.querySelector('[data-document-editor]') !== null
                urlSame = location.href === urlBefore2
                openErrorShown = missingCard.hasAttribute('data-open-error') || missingCard.querySelector('.file-attachment-error') !== null
              }
              // 桌面桥探针：readFileAsDataURL 读真实 PNG；openPath 缺失文件返回 ok:false；相对路径被校验拒绝
              let bridgeReadOk = false
              let bridgeOpenMissingOk = false
              let bridgeRejectsRelative = false
              const bridge3 = window.deepseekHarnessPersonal?.desktop
              try {
                const readResult = await bridge3?.readFileAsDataURL(absPng)
                bridgeReadOk = readResult?.ok === true && String(readResult?.dataUrl ?? '').startsWith('data:image/png;base64,')
              } catch { bridgeReadOk = false }
              try {
                const openMissingResult = await bridge3?.openPath(absMissing)
                bridgeOpenMissingOk = openMissingResult?.ok === false
              } catch { bridgeOpenMissingOk = false }
              try {
                await bridge3?.openPath('./相对路径.md')
                bridgeRejectsRelative = false
              } catch { bridgeRejectsRelative = true }
              // 拖拽探针：合成 drop 事件只插入一份附件节点（单一路径，无双份插入）
              let dropInserted = 'not-run'
              try {
                const countCards = () => {
                  let count = 0
                  richEditor4?.state.doc.descendants(node => {
                    if (node.type.name === 'fileAttachment') count += 1
                    return true
                  })
                  return count
                }
                const beforeDrop = countCards()
                const transfer = new DataTransfer()
                transfer.items.add(new File(['# 拖拽\\n'], '拖拽文档.md', { type: 'text/markdown' }))
                const dropCoords = richEditor4?.view.coordsAtPos(1) ?? { left: 200, top: 200 }
                const dropEvent = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: dropCoords.left + 5, clientY: dropCoords.top + 5 })
                const pmEl3 = document.querySelector('[data-rich-markdown-editor] .ProseMirror')
                pmEl3?.dispatchEvent(dropEvent)
                await new Promise(resolve => setTimeout(resolve, 400))
                const afterDrop = countCards()
                dropInserted = afterDrop === beforeDrop + 1 ? 'ok' : 'bad|before=' + String(beforeDrop) + '|after=' + String(afterDrop)
                richEditor4?.commands.undo()
              } catch (dropError) {
                dropInserted = dropError instanceof Error ? dropError.message : String(dropError)
              }
              localFileImageProbe = {
                serLinkOk,
                serImgOk,
                serMissingOk,
                diskLinkOk,
                diskImgOk,
                previewImgData,
                previewLinkOk,
                restoredAttachment,
                restoredImage,
                attachmentHrefOk,
                imageHrefOk,
                editorImgData,
                editorImgFailed,
                clickDefaultPrevented,
                stillEditing,
                urlSame,
                openErrorShown,
                bridgeReadOk,
                bridgeOpenMissingOk,
                bridgeRejectsRelative,
                dropInserted,
                mdSample: mdOut.slice(0, 160),
              }
            }
          }
        } catch (error) {
          localFileImageProbe = { error: error instanceof Error ? error.message : String(error) }
        }
        // R-UX 探针：「＋」浮层 / 快捷键徽章 / .md 工作台内开页签 / 外链桥门禁 / Details 空态
        let newTabUxProbe = 'not-run'
        try {
          const uxSleep = ms => new Promise(resolve => setTimeout(resolve, ms))
          const wbRoot = () => document.querySelector('[data-personal-workbench="gate-1"]')
          const activeFamily = () => String(wbRoot()?.getAttribute('data-personal-workbench-family') ?? '')
          const activeTabTitle = () => String(document.querySelector('[data-workbench-tab-list] [role="tab"][aria-selected="true"]')?.textContent ?? '')
          const tabWithText = text => [...document.querySelectorAll('[data-workbench-tab-list] [role="tab"]')].find(tab => (tab.textContent ?? '').includes(text))
          const until = async (check, tries = 40, gap = 160) => {
            for (let attempt = 0; attempt < tries; attempt += 1) {
              const value = check()
              if (value) return value
              await uxSleep(gap)
            }
            return check()
          }
          const ux = {}
          const snapUx = window.__wbWorkbench?.getSnapshot?.()
          ux.debugSnap = JSON.stringify({
            projectWorkspace: snapUx?.projectWorkspace ?? null,
            contextPrimary: snapUx?.context?.primaryPath ?? null,
            contextMode: snapUx?.context?.mode ?? null,
            detailsSelected: (snapUx?.detailsSelection ?? undefined) !== undefined,
          })

          // A) 编辑器附件卡片点 .md → 工作台内开预览页签（不调系统外部应用）
          const mdCard = [...document.querySelectorAll('.file-attachment')].find(el => (el.textContent ?? '').includes('目 标 文件'))
          const mdCardAnchor = mdCard?.querySelector('a.file-attachment-link')
          ux.debugCardHref = String(mdCardAnchor?.getAttribute('href') ?? '')
          if (mdCardAnchor instanceof HTMLAnchorElement) {
            mdCardAnchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
            ux.mdCardOpensTab = (await until(() => activeFamily() === 'preview' && activeTabTitle().includes('目 标 文件'))) === true
            ux.debugTabsAfter = [...document.querySelectorAll('[data-workbench-tab-list] [role="tab"]')].map(tab => (tab.textContent ?? '').slice(0, 20)).join(' | ')
          } else {
            ux.mdCardOpensTab = 'no-card-anchor'
          }

          // B) 预览里的 .md 本地链接 → 同样在工作台内开页签
          // （先切去 Details 再切回，强制页签重挂载到阅读态，避免停留在编辑态没有渲染链接）
          const detailsTabFirst = document.querySelector('[data-workbench-path-actions] [role="tab"][data-workbench-family="details"]')
          if (detailsTabFirst instanceof HTMLButtonElement) {
            detailsTabFirst.click()
            await uxSleep(240)
          }
          const fixtureTab = tabWithText('附件测试')
          if (fixtureTab instanceof HTMLButtonElement) {
            fixtureTab.click()
            const mdLink = await until(() => {
              const doc = document.querySelector('[data-workspace-markdown-document]')
              if (doc === null) return null
              return [...doc.querySelectorAll('a.md-local-link')].find(a => (a.textContent ?? '').includes('目 标 文件')) ?? null
            })
            if (mdLink instanceof HTMLAnchorElement) {
              mdLink.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
              ux.mdPreviewLinkOpensTab = (await until(() => activeFamily() === 'preview' && activeTabTitle().includes('目 标 文件'))) === true
            } else {
              ux.mdPreviewLinkOpensTab = 'no-md-local-link'
            }
          } else {
            ux.mdPreviewLinkOpensTab = 'no-fixture-tab'
          }

          // C) Details 空态：先 dismiss 可能存在的工具选中，再断言引导面板渲染
          // （详情激活按钮在 pathActions 而非页签列表里，用面板级选择器）
          window.__wbWorkbench?.dismissDetails?.()
          await uxSleep(200)
          const detailsTabNode = document.querySelector('[data-workbench-path-actions] [role="tab"][data-workbench-family="details"]')
          ux.debugDetailsButtonFound = detailsTabNode instanceof HTMLButtonElement
          if (detailsTabNode instanceof HTMLButtonElement) {
            detailsTabNode.click()
            ux.debugActiveAfterClick = String(window.__wbWorkbench?.getSnapshot?.()?.activeTabId ?? '')
            ux.detailsEmptyPresent = (await until(() => document.querySelector('[data-workbench-details-empty]') !== null)) === true
            ux.debugDetailsState = 'family=' + activeFamily()
              + '|legacy=' + String(document.querySelector('[data-personal-workbench-legacy-details]') !== null)
              + '|selected=' + String((window.__wbWorkbench?.getSnapshot?.()?.detailsSelection ?? undefined) !== undefined)
            ux.debugDetailsView = String(document.querySelector('[data-personal-workbench-current-view]')?.getAttribute('data-personal-workbench-current-view') ?? '')
            ux.debugDetailsTabViewer = String(window.__wbWorkbench?.getSnapshot?.()?.tabs?.find(tab => tab.id === 'workbench:details')?.viewerId ?? '')
            ux.debugDetailsViewText = String(document.querySelector('[data-personal-workbench-current-view]')?.textContent ?? '').slice(0, 90)
          } else {
            ux.detailsEmptyPresent = 'no-details-tab'
          }

          // D) Ctrl+P 唤出文件快速打开；Escape 关闭浮层
          document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true, cancelable: true }))
          ux.ctrlPOpensFiles = (await until(() => document.querySelector('[data-workbench-new-tab-palette] [data-palette-file-input]') !== null)) === true
          document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
          ux.escapeClosesPalette = (await until(() => document.querySelector('[data-workbench-new-tab-palette]') === null)) === true

          // E) 「＋」按钮 → 菜单态四行 + 快捷键徽章文字
          const openPaletteMenu = async () => {
            const button = document.querySelector('[data-workbench-new-tab]')
            if (!(button instanceof HTMLButtonElement)) return []
            button.click()
            const rows = await until(() => {
              const found = [...document.querySelectorAll('[data-workbench-new-tab-palette] [data-palette-action]')]
              return found.length === 4 ? found : null
            })
            return Array.isArray(rows) ? rows : []
          }
          ux.newTabButtonPresent = document.querySelector('[data-workbench-new-tab]') instanceof HTMLButtonElement
          const menuRows = await openPaletteMenu()
          ux.menuActionsOk = ['diff', 'terminal', 'browser', 'files'].every(key => menuRows.some(row => row.getAttribute('data-palette-action') === key))
          const backtickShortcut = 'Ctrl+' + String.fromCharCode(96)
          ux.menuShortcutsOk = ['Ctrl+Shift+G', backtickShortcut, 'Ctrl+T', 'Ctrl+P'].every(text => menuRows.some(row => (row.textContent ?? '').includes(text)))

          // F) 菜单点「浏览器」→ 受限浏览器页签打开并激活
          console.log('[ux-probe] step F begin')
          const browserRow = menuRows.find(row => row.getAttribute('data-palette-action') === 'browser')
          if (browserRow instanceof HTMLButtonElement) {
            browserRow.click()
            ux.paletteOpensBrowser = (await until(() => document.querySelector('[data-personal-workbench-browser]') !== null && activeFamily() === 'browser')) === true
          }

          // G) Ctrl+T 快捷键唤回浏览器页签（先切去 Details 再按，证明是快捷键起作用）
          const detailsTabNode2 = document.querySelector('[data-workbench-path-actions] [role="tab"][data-workbench-family="details"]')
          if (detailsTabNode2 instanceof HTMLButtonElement) {
            detailsTabNode2.click()
            await uxSleep(240)
            document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 't', ctrlKey: true, bubbles: true, cancelable: true }))
            ux.ctrlTActivatesBrowser = (await until(() => activeFamily() === 'browser')) === true
          }

          // M) 浏览器地址栏裸域名自动补 https://（输入 example.com 归一化为 https://example.com/）
          const browserBarInput = document.querySelector('[data-personal-workbench-browser] input')
          if (browserBarInput instanceof HTMLInputElement) {
            const urlSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
            if (urlSetter !== undefined) urlSetter.call(browserBarInput, 'example.com')
            browserBarInput.dispatchEvent(new Event('input', { bubbles: true }))
            await uxSleep(120)
            browserBarInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
            ux.browserBareDomainNormalized = (await until(() => browserBarInput.value === 'https://example.com/')) === true
            console.log('[ux-probe] step M done')
            ux.browserNoErrorShown = document.querySelector('[data-personal-workbench-browser] [role="alert"]') === null
          } else {
            ux.browserBareDomainNormalized = 'no-browser-input'
          }

          // N) WebContentsView 访客真实渲染验证：经 preload 桥等 get-state 到达目标，
          // 再由主进程 capturePage 采样暗像素，证明不是白屏。
          const viewPlaceholder = document.querySelector('[data-personal-workbench-browser] [data-browser-view-placeholder]')
          const viewApi = window.deepseekHarnessPersonal?.browserView
          if (viewPlaceholder === null || viewApi === undefined) {
            ux.browserGuestRenders = 'no-view-placeholder-or-bridge'
          } else {
            const readViewId = () => {
              const raw = viewPlaceholder.getAttribute('data-browser-view-id') ?? ''
              const parsed = Number(raw)
              return Number.isInteger(parsed) && parsed > 0 ? parsed : null
            }
            console.log('[ux-probe] step N waiting guest')
            let lastState = null
            const reached = await until(() => {
              const id = readViewId()
              if (id === null) return null
              viewApi.getState(id).then(state => { lastState = state }).catch(() => {})
              return lastState !== null && lastState.ok === true && typeof lastState.url === 'string'
                && lastState.url.startsWith('https://example.com') && lastState.loading !== true ? true : null
            }, 80, 250)
            ux.browserGuestReached = reached === true
            const finalId = readViewId()
            if (finalId !== null) {
              try {
                const finalState = await viewApi.getState(finalId)
                ux.debugGuestUrl = String(finalState.url ?? '')
              } catch {
                ux.debugGuestUrl = ''
              }
            }
            if (reached === true && finalId !== null) {
              try {
                const shot = await viewApi.capture(finalId)
                ux.browserGuestRenders = shot.ok === true && shot.renders === true
                ux.debugGuestPixels = String(shot.mode) + '|' + String(shot.width) + 'x' + String(shot.height) + '|dark=' + String(shot.darkSamples)
              } catch (captureError) {
                ux.browserGuestRenders = 'capture-failed:' + (captureError instanceof Error ? captureError.message : String(captureError))
              }
            } else {
              ux.browserGuestRenders = 'never-loaded'
            }
          }

          // H) 菜单点「终端」→ 会话终端页签（HTTP 中继复用 dock PTY，不抢 dock DOM）
          const terminalRow = (await openPaletteMenu()).find(row => row.getAttribute('data-palette-action') === 'terminal')
          if (terminalRow instanceof HTMLButtonElement) {
            terminalRow.click()
            ux.paletteOpensTerminal = (await until(() => document.querySelector('[data-personal-workbench-terminal]') !== null)) === true
          }

          // I) 菜单点「审阅」→ Diff 落地态渲染两步文件选择器
          const diffRow = (await openPaletteMenu()).find(row => row.getAttribute('data-palette-action') === 'diff')
          if (diffRow instanceof HTMLButtonElement) {
            diffRow.click()
            ux.paletteDiffLandingPicker = (await until(() => document.querySelector('[data-personal-workbench-diff] [data-diff-picker]') !== null)) === true
          }

          // J) 菜单点「文件」→ 输入 README → 搜索结果 → 点击开预览页签
          const filesRow = (await openPaletteMenu()).find(row => row.getAttribute('data-palette-action') === 'files')
          if (filesRow instanceof HTMLButtonElement) {
            filesRow.click()
            const fileInput = await until(() => document.querySelector('[data-palette-file-input]'))
            if (fileInput instanceof HTMLInputElement) {
              const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
              if (valueSetter !== undefined) valueSetter.call(fileInput, 'README')
              fileInput.dispatchEvent(new Event('input', { bubbles: true }))
              const resultRow = await until(() => document.querySelector('[data-palette-file-result]'), 30, 200)
              if (resultRow instanceof HTMLButtonElement) {
                resultRow.click()
                ux.paletteFilesOpenReadme = (await until(() => document.querySelector('[data-workbench-new-tab-palette]') === null && activeFamily() === 'preview' && activeTabTitle().includes('README'))) === true
              } else {
                ux.paletteFilesOpenReadme = 'no-result-row'
              }
            } else {
              ux.paletteFilesOpenReadme = 'no-file-input'
            }
          }

          // K) 外链桥门禁：file:/javascript: 在主进程侧一律拒绝（不点合法 http，避免真开浏览器）
          const bridgeUx = window.deepseekHarnessPersonal?.desktop
          ux.openExternalPresent = typeof bridgeUx?.openExternal === 'function'
          if (ux.openExternalPresent) {
            try {
              const fileResult = await bridgeUx.openExternal('file:///C:/Windows/notepad.exe')
              ux.openExternalRejectsFile = fileResult?.ok === false
            } catch { ux.openExternalRejectsFile = true }
            try {
              const jsResult = await bridgeUx.openExternal('javascript:alert(1)')
              ux.openExternalRejectsJs = jsResult?.ok === false
            } catch { ux.openExternalRejectsJs = true }
          }

          // L) 根外 .md（项目/会话/环境根之外）→ ad-hoc 显式根兜底，仍在工作台内开页签
          // 准备：在项目根的父目录落一个 .md，再在项目内写一个指向它的跳板文档，
          // 点预览里的本地链接验证全链路（与 Cyrus 点 CyrusNotes 里文件的场景同构）。
          try {
            const statusRespL = await fetch('/__personal/project-control/v1alpha1/projects/' + encodeURIComponent(String(registeredProjectId)) + '/workspace/status', { headers: { 'x-dsh-personal-client': '1' } })
            const statusPayloadL = await statusRespL.json()
            const projRootL = String(statusPayloadL?.data?.root ?? '').split(String.fromCharCode(92)).join('/')
            const parentRootL = projRootL.slice(0, projRootL.lastIndexOf('/'))
            if (projRootL === '' || parentRootL === '' || parentRootL === projRootL) {
              ux.externalMdOpensTab = 'no-parent-root|' + projRootL
            } else {
              const saveExt = await fetch('/__personal/workspace/save?root=' + encodeURIComponent(parentRootL), {
                method: 'POST',
                headers: { 'x-dsh-personal-workspace': '1', 'content-type': 'application/json' },
                body: JSON.stringify({ path: '根外测试.md', content: ['# 根外标题', '', '这是根外文件正文。', ''].join(String.fromCharCode(10)) }),
              })
              ux.externalMdSaveOk = saveExt.ok
              const saveJump = await fetch('/__personal/workspace/save?root=' + encodeURIComponent(projRootL), {
                method: 'POST',
                headers: { 'x-dsh-personal-workspace': '1', 'content-type': 'application/json' },
                body: JSON.stringify({ path: 'docs/外链跳板.md', content: ['# 跳板', '', '[根外测试](<' + parentRootL + '/根外测试.md' + '>)', ''].join(String.fromCharCode(10)) }),
              })
              ux.externalMdJumpSaveOk = saveJump.ok
              window.__wbWorkbench?.reveal?.()
              await uxSleep(300)
              window.__wbWorkbench?.open?.({
                family: 'preview',
                viewerId: 'workbench.workspace-preview',
                resourceKey: 'workspace:docs/外链跳板.md',
                title: '外链跳板',
                workspaceProjectId: String(registeredProjectId),
              })
              const extLink = await until(() => {
                const doc = document.querySelector('[data-workspace-markdown-document]')
                if (doc === null) return null
                return [...doc.querySelectorAll('a.md-local-link')].find(a => (a.textContent ?? '').includes('根外测试')) ?? null
              })
              if (extLink instanceof HTMLAnchorElement) {
                extLink.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
                ux.externalMdOpensTab = (await until(() => activeFamily() === 'preview' && activeTabTitle().includes('根外测试'))) === true
                const extTab = window.__wbWorkbench?.getSnapshot?.()?.tabs?.find(tab => (tab.title ?? '').includes('根外测试'))
                ux.externalMdCarriesRoot = typeof extTab?.workspaceRoot === 'string' && extTab.workspaceRoot.length > 0
                ux.externalMdContentLoaded = (await until(() => String(document.querySelector('[data-workspace-markdown-document]')?.textContent ?? '').includes('根外标题'))) === true
              } else {
                ux.externalMdOpensTab = 'no-jump-link'
                ux.debugJumpActive = activeFamily() + '|' + activeTabTitle()
                ux.debugJumpDoc = String(document.querySelector('[data-workspace-markdown-document]')?.textContent ?? 'no-doc').slice(0, 140)
                ux.debugJumpPreview = String(document.querySelector('[data-personal-workbench-preview]')?.textContent ?? 'no-preview').slice(0, 200)
                ux.debugJumpLinks = [...document.querySelectorAll('[data-workspace-markdown-document] a')].map(a => (a.textContent ?? '') + '=>' + String(a.getAttribute('href') ?? '').slice(0, 60) + '|' + a.className).join(' ; ').slice(0, 240)
              }
            }
          } catch (extError) {
            ux.externalMdOpensTab = 'error:' + (extError instanceof Error ? extError.message : String(extError))
          }

          newTabUxProbe = ux
        } catch (error) {
          newTabUxProbe = { error: error instanceof Error ? error.message : String(error) }
        }
        await new Promise(resolve => setTimeout(resolve, 200))
        projectWorkspaceBinding = {
          registeredProjectId: registeredProjectId ?? '',
          hostStatusOk: hostStatus?.ok === true,
          hostRootContainsProject: hostRoot.includes('synthetic-food-project'),
          openConsoleButtonCount: openConsoleButtons.length,
          consoleSample,
          openConsoleLiText,
          openConsoleButtonPresent: openConsoleButton instanceof HTMLButtonElement,
          dockRootContainsProject: dockRoot.includes('synthetic-food-project'),
          dockTreeShowsDocs: dockText.includes('docs'),
          dockTreeShowsWorkspaceOnly: !dockText.includes('synthetic-conflict-project'),
          readmeRowPresent: readmeRow instanceof HTMLButtonElement,
          previewOpened: previewViewer !== null,
          previewShowsContent: previewText.includes('Synthetic Food Project'),
          pathBarPresent: pathBarPresentEarly,
          pathPopupOpened: pathPopup !== null,
          pathPopupShowsEntries: pathPopupText.includes('docs') || pathPopupText.includes('README.md'),
          searchBoxPresent: searchBox instanceof HTMLInputElement,
          searchResultsShowReadme: searchResultsText.includes('README.md'),
          pathChipHiddenDuringSearch: pathChip === null,
          viewSwitchPresent: viewSwitch !== null,
          codeViewShownAfterToggle: codeViewPresent,
          editorPresent,
          editCrash,
          userPrefsApplied,
          preferenceApplied,
          preferenceDetail,
          updatePathApplied,
          updatePathDetail,
          panelFontApplied: panelFontApplied,
          editorReaderStyleApplied,
          editorReaderStyleDetail,
          livePreviewHiddenMarkers,
          livePreviewDetail,
          toolbarShown,
          toolbarDetail,
          sourceModeProbe,
          outlineProbe,
          diffProbe,
          browserProbe,
          codeProbe,
          realFileProbe,
          saveProbe,
          bubbleShown,
          bubbleDetail,
          footnoteProbe,
          mathProbe,
          footnoteHtmlProbe,
          saveAfterFootnoteProbe,
          multiFootnoteProbe,
          previewFeatureProbe,
          localFileImageProbe,
          newTabUxProbe,
        }
      } catch (error) {
        projectWorkspaceBinding = { error: error instanceof Error ? error.message : String(error) }
      }
      gate2cIntake = {
        scanButtonPresent: scanSourceButton instanceof HTMLButtonElement,
        candidateRowPresent: candidateRowButton !== null,
        detailsViewerPresent: detailsViewer !== null,
        confirmButtonPresent: confirmButton !== null,
        projectRegistered,
        workbenchCollapsedBeforeClick,
        workbenchExpandedAfterClick: !document.querySelector('[data-personal-shell="gate-1"]')?.hasAttribute('data-workbench-collapsed'),
        conflictCandidate,
        selectChangeSurvival,
        filesDock,
        fullscreenProbe,
        projectWorkspaceBinding,
      }
    } catch (error) {
      gate2cIntake = { error: error instanceof Error ? error.message : String(error) }
    }
    return {
      entries,
      api,
      desktopBridge,
      gate1Shell,
      gate2cIntake,
      terminalDockPresent: document.querySelector('[aria-label="会话 PowerShell"]') !== null,
      rootFontFamily: document.documentElement.style.getPropertyValue('--dsh-personal-font-family'),
      rootFontSize: document.documentElement.style.fontSize,
    }
  })()`, true)
  const externalDoctor = (() => {
    const externalRoot = resolveExternalRoot({ env: process.env, userData: app.getPath('userData') })
    if (externalRoot === null) return null
    const generation = loadCurrentGeneration(externalRoot)
    if (generation === null) return { active: false, reason: 'no-current-generation' }
    return {
      active: true,
      generationId: generation.generationId,
      packages: getPluginStatus(externalRoot),
    }
  })()
  const missingEntries = expected.filter(id => !observed.entries.includes(id))
  const unexpectedEntries = forbidden.filter(id => observed.entries.includes(id))
  return {
    ...observed,
    externalDoctor,
    expected,
    missingEntries,
    forbidden,
    unexpectedEntries,
    passed: missingEntries.length === 0
      && unexpectedEntries.length === 0
      && observed.gate1Shell?.rootPresent === true
      && observed.gate1Shell?.projectPanelPresent === true
      && observed.gate1Shell?.projectControlPresent === true
      && observed.gate1Shell?.projectControlStorageReady === true
      && observed.gate1Shell?.projectControlProjectCount === 0
      && observed.gate1Shell?.sourceScanPresent === true
      && observed.gate1Shell?.projectImportPresent === true
      && observed.gate1Shell?.projectCreatePresent === true
      && observed.gate1Shell?.projectEntryPresent === true
      && observed.gate1Shell?.projectEntryInSidebar === true
      && observed.gate1Shell?.projectFooterStacked === true
      && observed.gate1Shell?.projectCollapsePresent === true
      && observed.gate1Shell?.projectCollapseInPanel === true
      && observed.gate1Shell?.floatingProjectControlAbsent === true
      && observed.gate1Shell?.projectDividerPresent === true
      && observed.gate1Shell?.initialProjectWidth >= 320
      && observed.gate1Shell?.initialConversationWidth >= 560
      && observed.gate1Shell?.initialWorkbenchWidth === 44
      && observed.gate1Shell?.initialNoHorizontalOverflow === true
      && observed.gate1Shell?.projectArrowPresent === true
      && observed.gate1Shell?.projectArrowInPanel === true
      && observed.gate1Shell?.projectArrowRailWidth === 40
      && observed.gate1Shell?.projectArrowCollapsed === true
      && observed.gate1Shell?.projectArrowRestored === true
      && observed.gate1Shell?.projectArrowRestoredWidth >= 320
      && observed.gate1Shell?.projectSidebarCollapsed === true
      && observed.gate1Shell?.projectSidebarRestored === true
      && observed.gate1Shell?.projectSidebarRestoredWidth >= 320
      && observed.gate1Shell?.workbenchPanelPresent === true
      && observed.gate1Shell?.workbenchPresent === true
      && observed.gate1Shell?.workbenchTabCount === 1
      && observed.gate1Shell?.workbenchExpandPresent === true
      && observed.gate1Shell?.workbenchExpanded === true
      && observed.gate1Shell?.workbenchExpandedWidth >= 360
      && observed.gate1Shell?.workbenchExpandedProjectWidth === 40
      && observed.gate1Shell?.workbenchExpandedConversationWidth >= 560
      && observed.gate1Shell?.workbenchNoHorizontalOverflow === true
      && observed.gate1Shell?.projectYieldedToWorkbench === true
      && observed.gate1Shell?.workbenchCollapsePresent === true
      && observed.gate1Shell?.workbenchCollapsed === true
      && observed.gate1Shell?.workbenchRailWidth === 44
      && observed.gate1Shell?.workbenchRestored === true
      && observed.gate1Shell?.workbenchDividerPresent === true
      && observed.gate1Shell?.detailsTabActivated === true

      && observed.gate1Shell?.layoutMenuPresent === true
      && observed.gate1Shell?.focusConversationWorked === true
      && observed.gate1Shell?.resetLayoutWorked === true
      && observed.gate1Shell?.sidebarTogglePresent === true
      && observed.gate1Shell?.sidebarToggled === true
      && observed.gate1Shell?.sidebarRestored === true
      && observed.gate1Shell?.gridTrackCount === 4
      && observed.gate1Shell?.themePresenterPresent === true
      && ['theme', 'skills', 'plugins', 'connections'].every(resource => observed.api?.[resource]?.ok === true)
      && observed.api?.usageBalance?.ok === true
      && observed.api?.usageBalance?.state === 'unconfigured'
      && observed.api?.sessionTerminal?.ok === true
      && observed.api?.sessionTerminal?.tabCount === 0
      && observed.api?.projectControl?.ok === true
      && observed.api?.projectControl?.storageState === 'ready'
      && observed.api?.projectControl?.schemaVersion === 9
      && observed.api?.projectControl?.projectCount === 0
      && observed.api?.projectControl?.candidateStatus === 200
      && observed.api?.projectControl?.candidateCount === 0
      && observed.api?.projectControl?.templateStatus === 200
      && observed.api?.projectControl?.templateCount >= 3
      && observed.api?.projectControl?.intakeCapabilities === true
      && observed.api?.projectControl?.documentCapabilities === true
      && observed.terminalDockPresent === true
      && observed.desktopBridge?.methodsPresent === true
      && observed.desktopBridge?.desktopStateOk === true
      && observed.desktopBridge?.updateStateOk === true,
  }
}

/** @param {BrowserWindow} window @param {number} timeoutMs */
async function waitForHarnessUi(window, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const state = await window.webContents.executeJavaScript(`(() => {
      const root = document.getElementById('root')
      const text = root?.textContent ?? ''
      return {
        hasContent: (root?.childElementCount ?? 0) > 0,
        loading: text.includes('Loading plugins…'),
        failed: text.includes('Failed to load plugins'),
        excerpt: text.slice(0, 500),
      }
    })()`, true)
    if (state.failed) throw new Error(`Harness client plugins failed to load: ${state.excerpt}`)
    if (state.hasContent && !state.loading) return
    await delay(100)
  }
  throw new Error(`Harness client plugins did not settle within ${timeoutMs} ms.`)
}

/** @template T @param {Promise<T>} promise @param {number} timeoutMs @param {string} message */
function withTimeout(promise, timeoutMs, message) {
  return new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => rejectPromise(new Error(message)), timeoutMs)
    promise.then(
      value => {
        clearTimeout(timer)
        resolvePromise(value)
      },
      error => {
        clearTimeout(timer)
        rejectPromise(error)
      },
    )
  })
}

/** @param {URL} url */
async function waitForPortClosed(url) {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    if (!await canConnect(url.hostname, Number(url.port))) return true
    await delay(100)
  }
  return !await canConnect(url.hostname, Number(url.port))
}

/** @param {string} host @param {number} port */
function canConnect(host, port) {
  return new Promise(resolvePromise => {
    const socket = createConnection({ host, port })
    let settled = false
    const finish = value => {
      if (settled) return
      settled = true
      socket.destroy()
      resolvePromise(value)
    }
    socket.setTimeout(300, () => finish(false))
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
  })
}
