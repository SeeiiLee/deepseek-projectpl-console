import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent, type ReactNode } from 'react'
import { headingsFromSource, hasRemoteImageHint } from './markdown-heading.ts'
import { renderMarkdownLines } from './markdown-lite.tsx'
import { isAbsoluteLocalPath, isRemoteImageSrc, openExternal, openPath, readFileAsDataURL, resolveLocalPath } from './desktopReveal.ts'
import { classifyWorkspaceLink, isMarkdownPath } from './open-in-workbench.ts'
import { tryOpenMarkdownInWorkbench } from './index.ts'
import {
  CODE_FONT_FAMILIES,
  getEditingPreferencesStore,
  READER_FONT_FAMILIES,
  resolveFontFamily,
} from './editing-preferences.ts'
import css from './WorkspaceMarkdownDocument.module.css'

/**
 * R-PV1 文档排版层（架构书 §8.9.2/§8.9.3）：复用平台 MarkdownText 的安全渲染
 * （GFM/KaTeX/Shiki/raw HTML 禁用/危险协议禁用），本组件只负责 scoped 排版、
 * 标题定位与「远程内容可能联网加载」提示。R-PV1 不向 MarkdownText 提供
 * fileMentions（无 N+1 探测）；R-PV2 接 Hub statMany 词表。
 */
export interface WorkspaceMarkdownDocumentProps {
  text: string
  /** 外部（如 Outline 联动）指定的当前章节 ordinal；变化时容器内滚动定位。 */
  activeHeadingOrdinal?: number
  /** 容器内 IntersectionObserver 计算出的当前章节 ordinal 变化回调。 */
  onActiveHeadingChange?: (ordinal: number | undefined) => void
  /** 文档页脚，渲染在正文右下角（随文档滚动）。 */
  footer?: ReactNode
  /** 文档所在目录（本地绝对路径）：用于解析预览里的相对图片/文件链接。 */
  baseDir?: string | undefined
}

export function WorkspaceMarkdownDocument(props: WorkspaceMarkdownDocumentProps): ReactNode {
  const { text, activeHeadingOrdinal, onActiveHeadingChange, footer, baseDir } = props
  const containerRef = useRef<HTMLDivElement>(null)
  const [remoteNoticeShown, setRemoteNoticeShown] = useState(false)
  const headings = useMemo(() => headingsFromSource(text), [text])
  const hasRemote = useMemo(() => hasRemoteImageHint(text), [text])
  // R-ED：编辑偏好（背景/字号/宽度/字体）即时生效。
  const preferencesStore = useMemo(() => getEditingPreferencesStore(), [])
  const preferences = useSyncExternalStore(preferencesStore.subscribe, preferencesStore.get, preferencesStore.get)
  // 背景与文字色作用域为整个审阅容器（由查看器设置）；文档只消费 CSS 变量。
  const readerWidth = preferences.readerWidth === 0 ? 'none' : preferences.readerWidth + 'px'
  const readerFontFamily = resolveFontFamily(READER_FONT_FAMILIES, preferences.readerFontFamily)
  const codeFontFamily = resolveFontFamily(CODE_FONT_FAMILIES, preferences.codeFontFamily)
  const readerStyle = {
    '--wb-reader-font-size': preferences.readerFontSize + 'px',
    '--wb-reader-width': readerWidth,
    ...(readerFontFamily === '' ? {} : { '--wb-reader-font-family': readerFontFamily }),
    ...(codeFontFamily === '' ? {} : { '--wb-code-font-family': codeFontFamily }),
  } as React.CSSProperties

  // 首次遇到远程媒体时在文档区显示一次状态提示（§8.9.4；仅提示，不阻断）。
  useEffect(() => {
    if (hasRemote && !remoteNoticeShown) setRemoteNoticeShown(true)
  }, [hasRemote, remoteNoticeShown])
  // 换文档后复位提示状态。
  useEffect(() => {
    setRemoteNoticeShown(false)
  }, [text])

  // 预览里的本地图片：markdown-lite 对本地图片只写 data-local-image 标记（不写原始 src，
  // 避免 Chromium 把 F:/x 重解释成 file:/// 并拦截）；这里按文档目录解析后经桌面桥读成
  // data URL 补上。baseDir 异步到达时重跑，保证相对路径图片也能补上；读取失败摘掉 src
  // 并加克制占位样式，绝不留下破图图标或控制台噪音。
  useEffect(() => {
    const container = containerRef.current
    if (container === null) return
    const markMissing = (img: Element, resolved: string): void => {
      img.removeAttribute('src')
      img.classList.add('md-image-missing')
      img.setAttribute('title', resolved === '' ? '图片不可用' : resolved)
    }
    const fill = (img: Element, raw: string): void => {
      const resolved = resolveLocalPath(raw.replace(/^<|>$/g, ''), baseDir)
      if (!isAbsoluteLocalPath(resolved)) {
        markMissing(img, raw)
        return
      }
      void readFileAsDataURL(resolved).then(dataUrl => {
        if (!img.isConnected) return
        if (dataUrl !== undefined) {
          img.setAttribute('src', dataUrl)
          img.removeAttribute('data-local-image')
          img.classList.remove('md-image-local', 'md-image-missing')
          img.removeAttribute('title')
        } else {
          markMissing(img, resolved)
        }
      })
    }
    for (const img of Array.from(container.querySelectorAll('img[data-local-image]'))) {
      fill(img, img.getAttribute('data-local-image') ?? '')
    }
    // 兼容仍带原始本地 src 的 <img>（存量渲染或其他来源）。
    for (const img of Array.from(container.querySelectorAll('img[src]'))) {
      const src = img.getAttribute('src') ?? ''
      if (isRemoteImageSrc(src)) continue
      fill(img, src)
    }
  }, [text, baseDir])

  // 预览里的链接点击：http(s) 外链经桌面桥调系统默认浏览器（宿主拦截了渲染进程
  // 的一切新窗口，target=_blank 是死的）；本地文件链接用系统默认应用打开，其中
  // Markdown 优先在工作台内开页签。所有分支都吃掉默认导航，防止 Electron 主框架
  // 跳转到无法处理的地址导致页面状态丢失。
  const handleLocalLinkClick = (event: MouseEvent<HTMLDivElement>): void => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    const anchor = target.closest('a')
    if (anchor === null) return
    const href = anchor.getAttribute('href') ?? ''
    const action = classifyWorkspaceLink(href, anchor.classList.contains('md-local-link'))
    if (action === 'passthrough' || action === 'ignore') return
    event.preventDefault()
    event.stopPropagation()
    if (action === 'external') {
      void openExternal(href)
      return
    }
    const resolved = resolveLocalPath(href, baseDir)
    if (!isAbsoluteLocalPath(resolved)) return
    if (isMarkdownPath(resolved)) {
      void tryOpenMarkdownInWorkbench(resolved).then(opened => { if (!opened) void openPath(resolved) })
      return
    }
    void openPath(resolved)
  }

  // 标题定位：只在 Viewer 容器内按 ordinal 滚动，不操作全局 DOM（§8.9.3）。
  useEffect(() => {
    if (activeHeadingOrdinal === undefined || containerRef.current === null) return
    const node = containerRef.current.querySelectorAll('h1, h2, h3, h4, h5, h6')[activeHeadingOrdinal]
    node?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [activeHeadingOrdinal])

  // 当前章节观察：只观察本容器标题（§8.9.3）。
  useEffect(() => {
    const container = containerRef.current
    if (container === null || onActiveHeadingChange === undefined) return
    const nodes = container.querySelectorAll('h1, h2, h3, h4, h5, h6')
    if (nodes.length === 0) return
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const ordinal = Array.prototype.indexOf.call(nodes, entry.target)
        onActiveHeadingChange(ordinal >= 0 ? ordinal : undefined)
        break
      }
    }, { root: container, rootMargin: '-10% 0px -80% 0px' })
    for (const node of nodes) observer.observe(node)
    return () => { observer.disconnect() }
  }, [onActiveHeadingChange])

  return (
    <div className={css.document} ref={containerRef} style={readerStyle} data-workspace-markdown-document data-heading-count={String(headings.length)} onClick={handleLocalLinkClick}>
      {remoteNoticeShown && hasRemote && preferences.remoteMediaNotice && (
        <p className={css.notice} role="status" data-remote-media-notice>该文档包含远程内容，可能联网加载。</p>
      )}
      {renderMarkdownLines(text)}
      {footer}
    </div>
  )
}
