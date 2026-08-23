/**
 * R-ED Wolai：文件附件 NodeView。
 * 点击文件卡片用系统默认应用打开（通过 desktop bridge openPath），
 * 不触发编辑器导航/退出编辑；相对路径按当前文档目录解析；
 * 打开失败给一次短暂的内联反馈，不再静默吞掉。
 */
import { useEffect, useRef, useState, type ReactNode, type MouseEvent } from 'react'
import { NodeViewWrapper } from '@tiptap/react'
import { isAbsoluteLocalPath, openPath, resolveLocalPath } from './desktopReveal.ts'
import { getLocalDocBaseDir } from './local-doc-context.ts'
import { isMarkdownPath } from './open-in-workbench.ts'
import { tryOpenMarkdownInWorkbench } from './index.ts'

export function FileAttachmentView(props: { node: { attrs: Record<string, unknown> } }): ReactNode {
  const name = String(props.node.attrs.name ?? '文件')
  const href = String(props.node.attrs.href ?? './path')
  const [failed, setFailed] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => { clearTimeout(timerRef.current) }, [])

  const flashFailure = (): void => {
    setFailed(true)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => { setFailed(false) }, 2600)
  }

  const handleClick = (event: MouseEvent<HTMLAnchorElement>): void => {
    // 彻底吃掉这次点击：不导航、不冒泡到页签/宿主逻辑、不退出编辑。
    event.preventDefault()
    event.stopPropagation()
    const resolved = resolveLocalPath(href, getLocalDocBaseDir())
    if (!isAbsoluteLocalPath(resolved)) {
      flashFailure()
      return
    }
    // Markdown 文件优先在工作台内开预览页签；根外/失败回落系统默认应用。
    if (isMarkdownPath(resolved)) {
      void tryOpenMarkdownInWorkbench(resolved).then(opened => {
        if (opened) return
        void openPath(resolved).then(ok => { if (!ok) flashFailure() })
      })
      return
    }
    void openPath(resolved).then(ok => { if (!ok) flashFailure() })
  }

  const resolved = resolveLocalPath(href, getLocalDocBaseDir())
  return (
    <NodeViewWrapper
      className={failed ? 'file-attachment file-attachment-failed' : 'file-attachment'}
      data-file-attachment
      data-open-error={failed ? '' : undefined}
    >
      <span className="file-attachment-icon" aria-hidden="true">{failed ? '⚠️' : '📎'}</span>
      <a
        className="file-attachment-link"
        href={href}
        draggable={false}
        title={failed ? `无法打开：${resolved}（文件不存在或不可用）` : resolved}
        onClick={handleClick}
      >{name}</a>
      {failed && <span className="file-attachment-error" role="status">打不开这个文件</span>}
    </NodeViewWrapper>
  )
}
