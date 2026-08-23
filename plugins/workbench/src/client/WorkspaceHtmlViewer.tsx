import { useEffect, useState, type ReactNode } from 'react'
import type { WorkbenchTabDescriptor } from './contracts.ts'
import { useWorkspaceApiFor, workspacePath, type WorkspaceFile } from './workspaceApi.ts'
import { openPath } from './desktopReveal.ts'
import { IconButton } from './ui/controls.tsx'
import css from './WorkspaceViewers.module.css'

/**
 * 本地 HTML 预览查看器（.html / .htm）：
 * 读到文件文本后放进 sandbox iframe 渲染——allow-scripts 让架构图/报表里的
 * JS 交互可以跑；不给 allow-same-origin，页面处于 opaque origin，
 * 碰不到应用数据、也读不到其他本地文件。
 * 已知边界：srcDoc 模式下 HTML 里相对路径引用的本地资源（图片/外链 CSS/JS）
 * 不会加载——单文件自包含 HTML（本仓库图表的产出形态）不受影响；
 * 需要完整本地资源时，用右上角「在外部打开」交给系统浏览器。
 */

const ICON_RELOAD = 'M21 12a9 9 0 1 1-9-9c2.5 0 4.9 1 6.7 2.7L21 8M21 3v5h-5'
const ICON_EXTERNAL = 'M14 4h6v6M20 4 10 14M18 13v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'

export function WorkspaceHtmlViewer({ descriptor }: { descriptor: WorkbenchTabDescriptor }): ReactNode {
  const path = workspacePath(descriptor.resourceKey, 'workspace:')
  // 与 Markdown 预览同一套根解析：项目根 / 根外文件显式根。
  const { api } = useWorkspaceApiFor(descriptor.workspaceProjectId, descriptor.workspaceRoot)
  const [file, setFile] = useState<WorkspaceFile>()
  const [error, setError] = useState<string>()
  const [root, setRoot] = useState<string>()
  /** 刷新时改变 key 强制 iframe 重建。 */
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    api.status(controller.signal)
      .then(status => { if (!controller.signal.aborted) setRoot(status.workspaceRoot) })
      .catch(() => {})
    return () => { controller.abort() }
  }, [api])

  useEffect(() => {
    if (path === null) {
      setFile(undefined)
      setError('文件标识无效。')
      return
    }
    const controller = new AbortController()
    setFile(undefined)
    setError(undefined)
    api.file(path, controller.signal)
      .then(loaded => {
        if (controller.signal.aborted) return
        if (loaded.kind === 'text') setFile(loaded)
        else setError('这不是一个可预览的文本 HTML 文件。')
      })
      .catch((loadError: unknown) => {
        if (controller.signal.aborted) return
        setError(loadError instanceof Error ? loadError.message : String(loadError))
      })
    return () => { controller.abort() }
  }, [api, path, generation])

  return (
    <div className={css.browser} data-workspace-viewer="html">
      <div className={css.browserBar}>
        <span className={css.viewerMeta} data-html-preview-path>{path ?? ''}</span>
        <span style={{ flex: 1 }} />
        <IconButton size="bar" icon={ICON_RELOAD} label="刷新" data={{ 'data-html-reload': '' }} onClick={() => { setGeneration(value => value + 1) }} />
        <IconButton
          size="bar"
          icon={ICON_EXTERNAL}
          label="在外部打开"
          data={{ 'data-html-open-external': '' }}
          onClick={() => {
            if (root === undefined || path === null) return
            void openPath(root.replace(/[\\/]+$/u, '') + '\\' + path.replace(/\//gu, '\\'))
          }}
        />
      </div>
      {error !== undefined && <p className={css.viewerNotice} role="alert">{error}</p>}
      {file === undefined && error === undefined && <p className={css.viewerNotice}>加载中…</p>}
      {file !== undefined && file.kind === 'text' && (
        <iframe
          key={generation}
          className={css.browserFrame}
          sandbox="allow-scripts"
          srcDoc={file.content}
          title={path ?? 'HTML 预览'}
          data-html-preview-frame
        />
      )}
    </div>
  )
}
