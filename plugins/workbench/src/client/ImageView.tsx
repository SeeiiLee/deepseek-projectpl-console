/**
 * R-ED Wolai：图片 NodeView。
 * 用块级容器包裹图片，支持 CSS resize 拖拽调整大小，并默认居中。
 * 本地路径（含相对路径，按当前文档目录解析）通过 desktop bridge 读取为 data URL 显示，
 * 保存仍写真实路径；读取失败显示占位卡片而不是破图图标。
 */
import { useEffect, useState, type ReactNode, type MouseEvent } from 'react'
import { NodeViewWrapper } from '@tiptap/react'
import { isAbsoluteLocalPath, isRemoteImageSrc, readFileAsDataURL, resolveLocalPath } from './desktopReveal.ts'
import { getLocalDocBaseDir } from './local-doc-context.ts'

export function ImageView(props: {
  node: { attrs: Record<string, unknown> }
  updateAttributes(attrs: Record<string, unknown>): void
}): ReactNode {
  const { node, updateAttributes } = props
  const src = String(node.attrs.src ?? '')
  const dataPath = node.attrs.dataPath == null ? undefined : String(node.attrs.dataPath)
  const alt = String(node.attrs.alt ?? '')
  const width = node.attrs.width == null ? undefined : String(node.attrs.width)
  // 本地图片初始 displaySrc 为空：原始本地路径（F:/x 之类）直接进 <img src> 会被
  // Chromium 重解释成 file:/// 并拦截（控制台噪音 + 破图闪烁）。效果钩子会读成
  // data URL 补上，或落入失败占位。
  const [displaySrc, setDisplaySrc] = useState<string>(() => (isRemoteImageSrc(src) ? src : ''))
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (isRemoteImageSrc(src)) {
      setDisplaySrc(src)
      setFailed(false)
      return
    }
    const rawPath = dataPath ?? src
    if (rawPath === '') {
      setDisplaySrc('')
      setFailed(true)
      return
    }
    const resolved = resolveLocalPath(rawPath, getLocalDocBaseDir())
    if (!isAbsoluteLocalPath(resolved)) {
      setDisplaySrc('')
      setFailed(true)
      return
    }
    let cancelled = false
    setFailed(false)
    void readFileAsDataURL(resolved).then(dataUrl => {
      if (cancelled) return
      if (dataUrl !== undefined) {
        setDisplaySrc(dataUrl)
        setFailed(false)
      } else {
        setDisplaySrc('')
        setFailed(true)
      }
    })
    return () => { cancelled = true }
  }, [src, dataPath])

  const handleResizeEnd = (event: MouseEvent<HTMLImageElement>): void => {
    const wrapper = event.currentTarget.parentElement
    if (wrapper === null) return
    const nextWidth = Math.round(wrapper.getBoundingClientRect().width)
    if (nextWidth > 0) updateAttributes({ width: String(nextWidth) + 'px' })
  }

  const shownPath = dataPath ?? src
  return (
    <NodeViewWrapper
      className="image-container"
      style={{
        width: width ?? '100%',
        maxWidth: '100%',
        display: 'block',
        margin: '0 auto',
        resize: 'both',
        overflow: 'hidden',
      }}
    >
      {failed ? (
        <div className="image-load-failed" data-image-load-failed title={shownPath}>
          <span aria-hidden="true">🖼️</span>
          <span>图片加载失败：{alt === '' ? shownPath : alt}</span>
        </div>
      ) : displaySrc === '' ? (
        <div className="image-loading" aria-hidden="true" />
      ) : (
        <img src={displaySrc} alt={alt} style={{ display: 'block', width: '100%' }} onMouseUp={handleResizeEnd} />
      )}
    </NodeViewWrapper>
  )
}
