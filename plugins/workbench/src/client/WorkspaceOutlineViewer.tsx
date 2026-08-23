import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { WorkbenchTabDescriptor } from './contracts.ts'
import { getActiveWorkbench } from './index.ts'
import { createWorkspaceApi, workspacePath } from './workspaceApi.ts'
import { extractOutline, type OutlineHeading } from './outline.ts'
import css from './WorkspaceViewers.module.css'

export { extractOutline } from './outline.ts'
export type { OutlineHeading } from './outline.ts'

/** Outline 点击跳转广播事件名（Preview/Code 查看器监听并滚动到对应行）。 */
export const REVEAL_LINE_EVENT = 'workbench:reveal-line'

const api = createWorkspaceApi()

/**
 * P8 Outline viewer 升级版：
 * - 跟随模式（resourceKey 缺省或 workspace-outline:follow）：跟随当前激活的
 *   preview 页签，活动文件切换自动重出大纲；
 * - 绑定模式（workspace-outline:<path>）：固定文件大纲；
 * - Markdown 跳过围栏代码块；代码文件出符号（class/function/method/variable）；
 * - 点击条目：已有该文件 preview 页签则激活并广播 reveal-line 滚动到行，
 *   否则打开带 #L<line> 的 preview 页签。
 */
export function WorkspaceOutlineViewer({ descriptor }: { descriptor: WorkbenchTabDescriptor }): ReactNode {
  const workbench = getActiveWorkbench()
  const boundPath = workspacePath(descriptor.resourceKey, 'workspace-outline:')
  const follow = boundPath === null || boundPath === 'follow'
  const snapshot = useSyncExternalStore(
    workbench?.subscribe ?? (() => () => {}),
    workbench?.getSnapshot ?? (() => null),
    workbench?.getSnapshot ?? (() => null),
  )
  // 跟随模式：当前激活的 preview 页签的文件路径（不含 #L 锚）。
  const followedPath = useMemo(() => {
    if (!follow || snapshot == null) return null
    const active = snapshot.tabs.find(tab => tab.active && tab.family === 'preview')
    const path = workspacePath(active?.resourceKey, 'workspace:')
    if (path === null) return null
    const anchor = path.indexOf('#L')
    return anchor > 0 ? path.slice(0, anchor) : path
  }, [follow, snapshot])
  const path = follow ? followedPath : boundPath

  const [headings, setHeadings] = useState<readonly OutlineHeading[]>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (path === null) {
      setHeadings(undefined)
      setError(undefined)
      return
    }
    const controller = new AbortController()
    api.file(path, controller.signal)
      .then(file => {
        if (controller.signal.aborted) return
        if (file.kind !== 'text') setError('该文件没有文本大纲。')
        else {
          setError(undefined)
          setHeadings(extractOutline(file.content, path))
        }
      })
      .catch(loadError => {
        if (!controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : '大纲读取失败。')
      })
    return () => { controller.abort() }
  }, [path])

  const jumpTo = (heading: OutlineHeading): void => {
    if (path === null || workbench == null) return
    const existing = snapshot?.tabs.find(tab =>
      tab.family === 'preview' && workspacePath(tab.resourceKey, 'workspace:')?.split('#L')[0] === path)
    if (existing !== undefined) {
      workbench.activateTab(existing.id)
      // 等目标查看器激活/挂载后再广播滚动。
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent(REVEAL_LINE_EVENT, { detail: { path, line: heading.line } }))
      }, 50)
      return
    }
    workbench.open({
      family: 'preview',
      title: path.slice(path.lastIndexOf('/') + 1),
      resourceKey: `workspace:${path}#L${String(heading.line)}`,
    })
  }

  return (
    <div className={css.outline} data-personal-workbench-outline data-workspace-viewer="outline">
      <div className={css.viewerHeader}>
        <strong>大纲</strong>
        <span>{follow ? (followedPath ?? '跟随活动文件') : (boundPath ?? '')}</span>
      </div>
      {error !== undefined && <p className={css.viewerNotice} role="alert">{error}</p>}
      {path === null && follow && <p className={css.viewerNotice}>激活一个文件预览页签后，这里显示它的大纲。</p>}
      {path !== null && headings === undefined && error === undefined && <p className={css.viewerNotice} role="status">解析中…</p>}
      {headings !== undefined && headings.length === 0 && <p className={css.viewerNotice}>没有找到标题或符号。</p>}
      {headings !== undefined && headings.length > 0 && (
        <ul className={css.outlineList}>
          {headings.map((heading, index) => (
            <li key={String(index)} data-level={heading.level} data-kind={heading.kind ?? 'heading'}>
              <button type="button" data-outline-line={heading.line} onClick={() => { jumpTo(heading) }} title={`跳转到第 ${String(heading.line)} 行`}>
                <span>{'L' + String(heading.line)}</span>
                {heading.text}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
