import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { WorkbenchTabDescriptor } from './contracts.ts'
import { getActiveWorkbench } from './index.ts'
import { browserTabTitle, normalizeBrowserUrl } from './browser-url.ts'
import { openExternal } from './desktopReveal.ts'
import { IconButton } from './ui/controls.tsx'
import css from './WorkspaceViewers.module.css'

/**
 * 受限 Browser 使用主进程 WebContentsView 叠加（VS Code 式架构）：
 * 页面在本组件的占位 div 上量出矩形，经 preload 桥通知主进程把访客视图
 * 精确盖在上面。彻底绕开渲染进程内嵌 <webview>（本壳实测：访客一初始化
 * 就崩宿主渲染进程），也不受 X-Frame-Options / frame-ancestors 限制。
 * 安全边界：访客无 Node、独立持久会话；页内 window.open 由主进程拦截并
 * 转交系统默认浏览器；地址栏只放行 http(s)，拒绝 loopback 与应用自身源。
 */

interface BrowserViewBridge {
  create(url?: string): Promise<{ ok: boolean; id?: number }>
  dispose(id: number): Promise<{ ok: boolean }>
  setBounds(id: number, rect: { x: number; y: number; width: number; height: number; visible?: boolean }): Promise<{ ok: boolean }>
  navigate(id: number, url: string): Promise<{ ok: boolean }>
  goBack(id: number): Promise<{ ok: boolean }>
  goForward(id: number): Promise<{ ok: boolean }>
  reload(id: number): Promise<{ ok: boolean }>
  getState(id: number): Promise<{ ok: boolean; url?: string; title?: string; loading?: boolean; canBack?: boolean; canForward?: boolean }>
  capture(id: number): Promise<{ ok: boolean; width?: number; height?: number; renders?: boolean; darkSamples?: number }>
  onEvent(listener: (payload: BrowserViewEvent) => void): () => void
}

interface BrowserViewEvent {
  id: number
  type: 'navigate' | 'loading' | 'fail' | 'gone' | 'title'
  url?: string
  title?: string
  loading?: boolean
  error?: string
  code?: number
}

function bridge(): BrowserViewBridge | undefined {
  // desktopReveal.ts 已声明过 window.deepseekHarnessPersonal 的全局形状，
  // 这里用局部收窄的结构断言取 browserView 子桥，避免全局声明冲突。
  return (window as unknown as { deepseekHarnessPersonal?: { browserView?: BrowserViewBridge } })
    .deepseekHarnessPersonal?.browserView
}

/** 地址栏图标路径（公共组件 ui/controls 的 UiIcon/IconButton 负责渲染）。 */
const ICON_BACK = 'M15 18l-6-6 6-6'
const ICON_FORWARD = 'm9 18 6-6-6-6'
const ICON_RELOAD = 'M21 12a9 9 0 1 1-9-9c2.5 0 4.9 1 6.7 2.7L21 8M21 3v5h-5'
const ICON_GO = 'M5 12h14M13 6l6 6-6 6'
const ICON_EXTERNAL = 'M14 4h6v6M20 4 10 14M18 13v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'

export function WorkspaceBrowserViewer({ descriptor }: { descriptor: WorkbenchTabDescriptor }): ReactNode {
  const workbench = getActiveWorkbench()
  const initial = descriptor.resourceKey?.startsWith('browser:') === true
    ? decodeURIComponent(descriptor.resourceKey.slice('browser:'.length))
    : ''
  const initialNormalized = normalizeBrowserUrl(initial, window.location.origin)
  const [url, setUrl] = useState(initialNormalized.kind === 'ok' ? initialNormalized.url : '')
  const [input, setInput] = useState(initialNormalized.kind === 'ok' ? initialNormalized.url : initial)
  const [error, setError] = useState<string>()
  /** 主框架加载失败 / 访客进程退出的可见失败面板。 */
  const [failure, setFailure] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [canBack, setCanBack] = useState(false)
  const [canForward, setCanForward] = useState(false)
  const placeholderRef = useRef<HTMLDivElement | null>(null)
  const viewIdRef = useRef<number>()
  const [viewId, setViewId] = useState<number>()
  /** 上次上报的矩形：未变化不重复打 IPC。 */
  const lastRectRef = useRef('')

  // 占位区矩形 → 主进程视图 bounds。ResizeObserver 覆盖布局/显隐变化，
  // window resize/scroll 覆盖窗口与滚动，rAF 节流合并到每帧最多一次。
  useEffect(() => {
    if (url === '') return
    const placeholder = placeholderRef.current
    const api = bridge()
    if (placeholder === null || api === undefined) return
    let frame = 0
    const sync = (): void => {
      const id = viewIdRef.current
      if (id === undefined) return
      const rect = placeholder.getBoundingClientRect()
      const key = [rect.x, rect.y, rect.width, rect.height].map(v => Math.round(v)).join(',')
      if (key === lastRectRef.current) return
      lastRectRef.current = key
      void api.setBounds(id, { x: rect.x, y: rect.y, width: rect.width, height: rect.height }).catch(() => {})
    }
    const schedule = (): void => {
      if (frame !== 0) return
      frame = requestAnimationFrame(() => { frame = 0; sync() })
    }
    const observer = new ResizeObserver(schedule)
    observer.observe(placeholder)
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, true)
    schedule()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, true)
      if (frame !== 0) cancelAnimationFrame(frame)
    }
  }, [url])

  // 视图生命周期：url 首次非空时创建（创建即携带首航 URL），组件卸载销毁。
  useEffect(() => {
    if (url === '') return
    const api = bridge()
    if (api === undefined) return
    if (viewIdRef.current !== undefined) return
    let cancelled = false
    void api.create(url).then(result => {
      if (cancelled || result.ok !== true || typeof result.id !== 'number') return
      viewIdRef.current = result.id
      setViewId(result.id)
      lastRectRef.current = ''
      // 创建完成立刻补一次矩形同步（占位早已就位）。
      const placeholder = placeholderRef.current
      if (placeholder !== null) {
        const rect = placeholder.getBoundingClientRect()
        void api.setBounds(result.id, { x: rect.x, y: rect.y, width: rect.width, height: rect.height }).catch(() => {})
      }
    }).catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url !== ''])

  useEffect(() => () => {
    const id = viewIdRef.current
    if (id !== undefined) void bridge()?.dispose(id).catch(() => {})
    viewIdRef.current = undefined
  }, [])

  // 同一页签内地址变更：走 navigate（单视图实例，保住访客前进/后退历史）。
  const lastNavigatedRef = useRef(url)
  useEffect(() => {
    const id = viewIdRef.current
    const api = bridge()
    if (id === undefined || api === undefined || url === '' || url === lastNavigatedRef.current) return
    lastNavigatedRef.current = url
    void api.navigate(id, url).catch(() => {})
  }, [url])

  // 主进程事件回流：导航同步地址栏/持久化；失败给可见面板。
  useEffect(() => {
    const api = bridge()
    if (api === undefined) return
    return api.onEvent(event => {
      if (event.id !== viewIdRef.current) return
      if (event.type === 'navigate' && typeof event.url === 'string' && event.url !== '') {
        setFailure(undefined)
        setInput(event.url)
        lastNavigatedRef.current = event.url
        workbench?.updateTab(descriptor.id, {
          resourceKey: 'browser:' + encodeURIComponent(event.url),
          title: browserTabTitle(event.url),
        })
      } else if (event.type === 'loading') {
        setLoading(event.loading === true)
        const apiInner = bridge()
        const id = viewIdRef.current
        if (event.loading !== true && apiInner !== undefined && id !== undefined) {
          void apiInner.getState(id).then(state => {
            if (state.ok === true) {
              setCanBack(state.canBack === true)
              setCanForward(state.canForward === true)
            }
          }).catch(() => {})
        }
      } else if (event.type === 'fail') {
        setLoading(false)
        setFailure(`${event.url ?? url} 加载失败：${event.error ?? '未知错误'}（${String(event.code ?? '?')}）`)
      } else if (event.type === 'gone') {
        setLoading(false)
        setFailure('页面渲染进程异常退出（可能被系统回收或崩溃）。')
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const navigateTo = (raw: string): void => {
    const result = normalizeBrowserUrl(raw, window.location.origin)
    if (result.kind !== 'ok') {
      setError(result.kind === 'invalid'
        ? '地址无效。'
        : result.reason === 'scheme'
          ? '只允许 http(s) 地址。'
          : '不允许打开本机或应用内部地址。')
      return
    }
    setError(undefined)
    setFailure(undefined)
    setUrl(result.url)
    setInput(result.url)
    workbench?.updateTab(descriptor.id, {
      resourceKey: 'browser:' + encodeURIComponent(result.url),
      title: browserTabTitle(result.url),
    })
  }

  const withView = (action: (api: BrowserViewBridge, id: number) => void): void => {
    const api = bridge()
    const id = viewIdRef.current
    if (api === undefined || id === undefined) return
    try {
      action(api, id)
    } catch {
      // 视图销毁竞态：忽略即可。
    }
  }

  return (
    <div className={css.browser} data-personal-workbench-browser data-workspace-viewer="browser">
      <div className={css.browserBar}>
        <IconButton size="bar" icon={ICON_BACK} label="后退" disabled={!canBack} data={{ 'data-browser-back': '' }} onClick={() => { withView((api, id) => { void api.goBack(id).catch(() => {}) }) }} />
        <IconButton size="bar" icon={ICON_FORWARD} label="前进" disabled={!canForward} data={{ 'data-browser-forward': '' }} onClick={() => { withView((api, id) => { void api.goForward(id).catch(() => {}) }) }} />
        <IconButton size="bar" icon={ICON_RELOAD} label="刷新" disabled={url === ''} data={{ 'data-browser-reload': '' }} onClick={() => { withView((api, id) => { void api.reload(id).catch(() => {}) }) }} />
        <input
          type="text"
          placeholder="输入网址，可省略 https://"
          value={input}
          onChange={event => { setInput(event.target.value) }}
          onKeyDown={event => { if (event.key === 'Enter') navigateTo(input) }}
        />
        <IconButton size="bar" icon={ICON_GO} label="打开" data={{ 'data-browser-go': '' }} onClick={() => { navigateTo(input) }} />
        <IconButton
          size="bar"
          icon={ICON_EXTERNAL}
          label="在外部浏览器打开"
          disabled={url === ''}
          data={{ 'data-browser-open-external': '' }}
          onClick={() => { if (url !== '') void openExternal(input !== '' ? input : url) }}
        />
        {loading && <span className={css.viewerMeta} data-browser-loading>加载中…</span>}
      </div>
      {error !== undefined && <p className={css.viewerNotice} role="alert">{error}</p>}
      {url === '' ? (
        <p className={css.viewerNotice}>输入网址后回车打开（可省略 https://）。页面在独立访客进程中加载，与本应用数据完全隔离；页内弹窗一律转交系统默认浏览器。</p>
      ) : (
        <>
          {failure !== undefined && (
            <p className={css.viewerNotice} role="alert" data-browser-load-failed>
              {failure}
              <button className={css.viewerButton} type="button" data-browser-failed-open-external onClick={() => { void openExternal(input) }}>在外部浏览器打开</button>
              <button className={css.viewerButton} type="button" data-browser-failed-retry onClick={() => { setFailure(undefined); withView((api, id) => { void api.reload(id).catch(() => {}) }) }}>重试</button>
            </p>
          )}
          {bridge() === undefined ? (
            <p className={css.viewerNotice} role="alert">当前桌面壳版本过旧，不支持内置浏览器。请升级后重试，或点击右上角图标在外部浏览器打开。</p>
          ) : (
            <div
              ref={(node: HTMLDivElement | null) => { placeholderRef.current = node }}
              className={css.browserFrame}
              data-browser-view-placeholder
              data-browser-view-id={viewId ?? ''}
            />
          )}
        </>
      )}
    </div>
  )
}
