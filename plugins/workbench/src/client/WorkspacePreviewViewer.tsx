import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { WorkbenchTabDescriptor } from './contracts.ts'
import { getActiveWorkbench } from './index.ts'
import { useWorkspaceApiFor, workspacePath, type WorkspaceFile } from './workspaceApi.ts'
import { WorkspaceMarkdownDocument } from './WorkspaceMarkdownDocument.tsx'
import { MarkdownEditor } from './MarkdownEditor.tsx'
import { RichMarkdownEditor } from './RichMarkdownEditor.tsx'
import { createWorkspaceResourceAdapter, DocumentSessionStore } from './document-session.ts'
import { baseDirOfDocument, getLocalDocBaseDir, setLocalDocBaseDir } from './local-doc-context.ts'
import {
  CODE_FONT_FAMILIES,
  READER_FONT_FAMILIES,
  getEditingPreferencesStore,
  readerBackgroundCss,
  readerTextColorCss,
  resolveFontFamily,
} from './editing-preferences.ts'
import css from './WorkspaceViewers.module.css'

/**
 * P8 preview viewer: read-only code/markdown/image/pdf over the workspace
 * remote, plus a bounded text editor with dirty/version/conflict handling.
 */
export function WorkspacePreviewViewer({ descriptor }: { descriptor: WorkbenchTabDescriptor }): ReactNode {
  const rawPath = workspacePath(descriptor.resourceKey, 'workspace:')
  // 大纲跳转锚：resourceKey 可带 #L<line> 后缀；加载与渲染用去锚路径。
  const anchorIndex = rawPath?.indexOf('#L') ?? -1
  const anchorLine = rawPath !== null && anchorIndex > 0
    ? Number(rawPath.slice(anchorIndex + 2))
    : undefined
  const path = rawPath !== null && anchorIndex > 0 ? rawPath.slice(0, anchorIndex) : rawPath
  const rootRef = useRef<HTMLDivElement | null>(null)
  // 打开自项目工作区的预览按自己的项目根解析：控制台绑定/会话切换不影响已打开的审阅；
  // 根外文件（descriptor.workspaceRoot）按显式根解析，优先级最高。
  const { api } = useWorkspaceApiFor(descriptor.workspaceProjectId, descriptor.workspaceRoot)
  const workbench = getActiveWorkbench()
  const [file, setFile] = useState<WorkspaceFile>()
  // 大纲点击跳转：监听 reveal-line 广播，滚动到对应行（按行号比例近似）。
  useEffect(() => {
    const totalLines = file?.kind === 'text' ? file.content.split('\n').length : 0
    const scrollToLine = (line: number): void => {
      const root = rootRef.current
      if (root === null || totalLines === 0 || !Number.isFinite(line)) return
      const target = root.querySelector('[data-code-view], [data-preview-body]')
      const scroller = target instanceof HTMLElement ? target : root
      const fraction = Math.max(0, Math.min(1, (line - 1) / Math.max(1, totalLines)))
      scroller.scrollTop = fraction * Math.max(0, scroller.scrollHeight - scroller.clientHeight)
    }
    if (anchorLine !== undefined && file !== undefined) scrollToLine(anchorLine)
    const listener = (event: Event): void => {
      const detail = (event as CustomEvent<{ path?: string; line?: number }>).detail
      if (detail?.path === path && typeof detail.line === 'number') scrollToLine(detail.line)
    }
    window.addEventListener('workbench:reveal-line', listener)
    return () => { window.removeEventListener('workbench:reveal-line', listener) }
  }, [path, anchorLine, file])
  const [error, setError] = useState<string>()
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string>()
  const [hint, setHint] = useState<string>()
  const [viewMode, setViewModeState] = useState<'preview' | 'code'>('preview')
  // W1：预览/代码选择按 Tab 内存记忆（不落持久化；切换文档/会话/项目保持用户选择）。
  const viewModes = useRef(new Map<string, 'preview' | 'code'>())
  const setViewMode = (mode: 'preview' | 'code'): void => {
    viewModes.current.set(descriptor.id, mode)
    setViewModeState(mode)
  }
  const [blobUrl, setBlobUrl] = useState<string>()
  // R-ED：Document Session（内存态草稿/冲突/选择）——Tab 只引用 documentId。
  const sessionsRef = useRef<DocumentSessionStore>(new DocumentSessionStore())
  const adapterRef = useRef(createWorkspaceResourceAdapter(api))
  adapterRef.current = createWorkspaceResourceAdapter(api)
  const session = useSyncExternalStore(
    sessionsRef.current.subscribe,
    () => sessionsRef.current.get(descriptor.id),
    () => sessionsRef.current.get(descriptor.id),
  )
  // R-ED：编辑布局偏好（自动 / 始终单面板 / 始终分屏）。
  const preferencesStore = useMemo(() => getEditingPreferencesStore(), [])
  const preferences = useSyncExternalStore(preferencesStore.subscribe, preferencesStore.get, preferencesStore.get)
  // 审阅容器背景与文字色（整个审阅区生效，不只阅读列）。
  const readerFontFamily = resolveFontFamily(READER_FONT_FAMILIES, preferences.readerFontFamily)
  const readerBackground = useMemo(() => readerBackgroundCss(preferences), [preferences])
  const readerTextColor = useMemo(() => readerTextColorCss(preferences, readerBackground), [preferences, readerBackground])
  const reviewerStyle = {
    '--wb-reader-font-size': preferences.readerFontSize + 'px',
    ...(resolveFontFamily(CODE_FONT_FAMILIES, preferences.codeFontFamily) === '' ? {} : { '--wb-code-font-family': resolveFontFamily(CODE_FONT_FAMILIES, preferences.codeFontFamily) }),
    ...(readerBackground === 'transparent' ? {} : { background: readerBackground }),
    ...(readerTextColor === '' ? {} : { '--wb-reader-color': readerTextColor }),
  } as React.CSSProperties
  const extension = path === null ? '' : path.slice(path.lastIndexOf('.')).toLowerCase()
  const isMarkdown = isMarkdownExtension(extension)

  // R-ED 本地文件/图片：文档所在目录（绝对路径）——预览相对路径图片与编辑器内
  // 文件卡片/图片 NodeView 都靠它把相对路径解析成可打开的绝对路径。
  const [docBaseDir, setDocBaseDir] = useState<string>()
  useEffect(() => {
    setDocBaseDir(undefined)
    if (path === null) return
    let cancelled = false
    api.status()
      .then(status => { if (!cancelled) setDocBaseDir(baseDirOfDocument(status.workspaceRoot, path)) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [api, path])
  // 同步到模块级上下文（NodeView 无法走 React props 逐层传递）。
  useEffect(() => {
    setLocalDocBaseDir(docBaseDir)
    return () => { if (getLocalDocBaseDir() === docBaseDir) setLocalDocBaseDir(undefined) }
  }, [docBaseDir])

  // W1：预览/代码选择按 Tab 单独记忆（内存态）。切换 Tab/文档/会话/项目恢复该 Tab 自己的选择；
  // 无记忆时 md 默认预览、其他默认代码。
  useEffect(() => {
    const remembered = viewModes.current.get(descriptor.id)
    setViewModeState(remembered ?? (isMarkdownExtension(extension) ? 'preview' : 'code'))
  }, [descriptor.id, extension])

  useEffect(() => {
    if (path === null) {
      setError(undefined)
      setFile(undefined)
      setHint('从右侧文件树点击文件，即可在这里预览。')
      return
    }
    const controller = new AbortController()
    setFile(undefined)
    setError(undefined)
    setHint(undefined)
    // 不重置 viewMode：加载/切会话/切项目不得改变用户选择（per-tab 记忆见下）。
    setEditing(false)
    api.file(path, controller.signal)
      .then(loaded => {
        if (controller.signal.aborted) return
        setFile(loaded)
        if (loaded.kind === 'text') {
          // R-ED：文本文件进入 Document Session（重复 open 视为重载）。
          sessionsRef.current.open(descriptor.id, path, { text: loaded.content, etag: loaded.sha256 })
        }
        if (loaded.kind === 'binary' && (extension === '.png' || extension === '.jpg' || extension === '.jpeg' || extension === '.webp' || extension === '.gif')) {
          void api.blob(path, controller.signal).then(blob => {
            if (controller.signal.aborted) return
            const url = URL.createObjectURL(blob)
            setBlobUrl(current => { if (current !== undefined) URL.revokeObjectURL(current); return url })
          }).catch(() => {})
        }
      })
      .catch(loadError => {
        if (!controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : '文件读取失败。')
      })
    return () => { controller.abort() }
  }, [path, extension, api])

  const startEditing = (): void => {
    if (file === undefined || file.kind !== 'text') return
    // 编辑态 = 所见即所得文档编辑器（无预览/无分屏——用户裁决：编辑不需要预览）。
    setEditing(true)
    setNotice(undefined)
    workbench?.markDirty(descriptor.id, sessionsRef.current.get(descriptor.id)?.dirty === true)
  }

  const save = async (): Promise<void> => {
    if (path === null || file === undefined || file.kind !== 'text' || saving) return
    if (session?.saveState === 'conflict') {
      setNotice('文件存在冲突，请先选择处理方式。')
      return
    }
    setSaving(true)
    try {
      const result = await sessionsRef.current.save(descriptor.id, adapterRef.current)
      if (result.saveState === 'saved') {
        setFile(current => current === undefined || current.kind !== 'text'
          ? current
          : { kind: 'text', content: result.draftText, truncated: current.truncated, byteSize: byteLength(result.draftText), sha256: result.baseEtag })
        setEditing(false)
        setNotice('已保存。')
        workbench?.markDirty(descriptor.id, false)
      } else if (result.saveState === 'conflict') {
        setNotice(result.errorMessage ?? '保存冲突。')
      } else {
        setNotice(result.errorMessage ?? '保存失败。')
      }
    } finally {
      setSaving(false)
    }
  }

  /** 放弃更改：丢弃草稿回到磁盘版本。 */
  const cancelEditing = (): void => {
    sessionsRef.current.discardDraft(descriptor.id)
    setEditing(false)
    setNotice(undefined)
    workbench?.markDirty(descriptor.id, false)
  }

  /** 冲突：保留草稿继续编辑。 */
  const resolveKeepDraft = (): void => {
    sessionsRef.current.resolveConflict(descriptor.id, { kind: 'keep-draft' })
    setNotice(undefined)
  }

  /** 冲突：重新加载外部版本（丢弃草稿）。 */
  const resolveReloadExternal = (): void => {
    sessionsRef.current.resolveConflict(descriptor.id, { kind: 'reload' })
    setEditing(false)
    setNotice('已重新加载外部版本。')
    workbench?.markDirty(descriptor.id, false)
  }


  return (
    <div className={css.preview} data-personal-workbench-preview data-workspace-viewer="preview" style={reviewerStyle} ref={rootRef}>
      <div className={css.viewerHeader}>
        <strong title={path ?? ''}>{path === null ? '预览' : path.slice(path.lastIndexOf('/') + 1)}</strong>
        <span className={css.viewerHeaderActions}>
          {file?.kind === 'text' && !editing && isMarkdown && (
            <div className={css.viewSwitch} role="tablist" aria-label="显示模式" data-view-switch>
              <button className={css.viewSwitchButton} type="button" role="tab" aria-selected={viewMode === 'preview'} data-active={viewMode === 'preview' || undefined} onClick={() => { setViewMode('preview') }} title="预览" aria-label="预览">
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.6 8S4.1 3.6 8 3.6 14.4 8 14.4 8 11.9 12.4 8 12.4 1.6 8 1.6 8Z" /><circle cx="8" cy="8" r="2" /></svg>
              </button>
              <button className={css.viewSwitchButton} type="button" role="tab" aria-selected={viewMode === 'code'} data-active={viewMode === 'code' || undefined} data-view-switch-code onClick={() => { setViewMode('code') }} title="代码" aria-label="代码">
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m5.6 4.6-4 3.4 4 3.4M10.4 4.6l4 3.4-4 3.4" /></svg>
              </button>
            </div>
          )}
          {file?.kind === 'text' && !editing && (
            <button className={css.iconButton} type="button" data-edit-start onClick={startEditing} title="编辑" aria-label="编辑">
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M11.5 2.5l2 2L5 13l-2.7.7L3 11Z" /><path d="M10 4l2 2" /></svg>
            </button>
          )}
          {file?.kind === 'text' && editing && (
            <>
              <button className={css.saveButton} type="button" data-save-document disabled={saving} onClick={() => { void save() }} title="保存（Ctrl+S）">
                <svg viewBox="0 0 16 16" aria-hidden="true" className={css.saveIcon}>
                  <path d="M3 1.5h8l2 2V14a.5.5 0 0 1-.5.5h-9A.5.5 0 0 1 3 14Zm1 0v3h7v-3M4.5 1.5v5h7V3.5M5.5 12.5v-4h5v4" />
                </svg>
              </button>
              <button className={css.discardButton} type="button" disabled={saving} onClick={cancelEditing} title="放弃更改">
                <svg viewBox="0 0 16 16" aria-hidden="true" className={css.discardIcon}>
                  <path d="M3 3l10 10M13 3L3 13" />
                </svg>
              </button>
            </>
          )}
        </span>
      </div>
      {error !== undefined && <p className={css.viewerNotice} role="alert">{error}</p>}
      {notice !== undefined && <p className={css.viewerNotice} role="status">{notice}</p>}
      {hint !== undefined && <p className={css.viewerNotice} role="status">{hint}</p>}
      {file === undefined && error === undefined && hint === undefined && <p className={css.viewerNotice} role="status">读取中…</p>}
      {file?.kind === 'text' && !isMarkdown && (
        <div className={css.viewerFooter} data-workspace-viewer-footer>
          <span className={css.viewerMeta} title={file.sha256}>版本 {file.sha256.slice(0, 12)}…</span>
          <span className={css.viewerMeta}>{String(file.byteSize)} 字节</span>
        </div>
      )}
      {file?.kind === 'binary' && !blobUrl && extension === '.pdf' && (
        <PdfPreview path={path} api={api} />
      )}
      {file?.kind === 'binary' && !blobUrl && extension !== '.pdf' && (
        <p className={css.viewerNotice}>{file.tooLarge === true ? '文件超过预览上限（5 MiB）。' : '二进制文件暂不支持内嵌预览。'}</p>
      )}
      {blobUrl !== undefined && <img className={css.imagePreview} src={blobUrl} alt={path ?? '图片预览'} />}
      {file?.kind === 'text' && !editing && (
        <>
          {file.truncated && <p className={css.viewerNotice}>文件超过 256 KiB，仅显示开头部分。</p>}
          {isMarkdown && viewMode === 'preview' ? (
            <div className={css.textBody} data-extension={extension} data-preview-body>
              <WorkspaceMarkdownDocument
                text={file.content}
                baseDir={docBaseDir}
                footer={
                  <div className={css.viewerMeta} data-document-footer>
                    <span title={file.sha256}>版本 {file.sha256.slice(0, 12)}…</span>
                    <span>{String(file.byteSize)} 字节</span>
                  </div>
                }
              />
            </div>
          ) : (
            <pre className={css.codeBlock} data-code-view>{file.content}</pre>
          )}
        </>
      )}
      {file?.kind === 'text' && editing && (
        <>
          {session?.saveState === 'conflict' && (
            <div className={css.conflictBar} data-document-conflict role="alert">
              <span>文件已在外部被修改，存在保存冲突。</span>
              <button className={css.viewerButton} type="button" onClick={resolveKeepDraft}>保留草稿继续编辑</button>
              <button className={css.viewerButton} type="button" onClick={resolveReloadExternal}>重新加载外部版本</button>
            </div>
          )}
          <div className={css.editorHost} style={{ '--wb-editor-font-size': preferences.readerFontSize + 'px', '--wb-code-font-family': resolveFontFamily(CODE_FONT_FAMILIES, preferences.codeFontFamily), '--wb-reader-width': preferences.readerWidth === 0 ? 'none' : preferences.readerWidth + 'px', ...(readerFontFamily === '' ? {} : { '--wb-reader-font-family': readerFontFamily }) } as React.CSSProperties} data-document-editor>
            {isMarkdown ? (
              <RichMarkdownEditor
                value={session?.draftText ?? file.content}
                onChange={text => {
                  sessionsRef.current.updateDraft(descriptor.id, text)
                  workbench?.markDirty(descriptor.id, sessionsRef.current.get(descriptor.id)?.dirty === true)
                }}
                onSave={() => { void save() }}
                readOnly={false}
                footer={
                  file?.kind === 'text' ? (
                    <div className={css.viewerMeta} data-document-footer>
                      <span title={file.sha256}>版本 {file.sha256.slice(0, 12)}…</span>
                      <span>{String(file.byteSize)} 字节</span>
                    </div>
                  ) : undefined
                }
              />
            ) : (
              <MarkdownEditor
                value={session?.draftText ?? file.content}
                onChange={text => {
                  sessionsRef.current.updateDraft(descriptor.id, text)
                  workbench?.markDirty(descriptor.id, sessionsRef.current.get(descriptor.id)?.dirty === true)
                }}
                onSave={() => { void save() }}
                onSelectionChange={selection => { sessionsRef.current.setSelection(descriptor.id, selection) }}
                language="plain"
                lineWrapping={preferences.lineWrapping}
                showLineNumbers={preferences.showLineNumbers}
              />
            )}
          </div>
        </>
      )}
    </div>
  )
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

function isMarkdownExtension(extension: string): boolean {
  return extension === '.md' || extension === '.markdown' || extension === '.mdx'
}

function PdfPreview({ path, api }: { path: string | null; api: import('./workspaceApi.ts').WorkspaceApi }): ReactNode {
  const [blobUrl, setBlobUrl] = useState<string>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    if (path === null) return
    const controller = new AbortController()
    api.blob(path, controller.signal)
      .then(blob => {
        if (controller.signal.aborted) return
        setBlobUrl(URL.createObjectURL(blob))
      })
      .catch(() => { if (!controller.signal.aborted) setError('PDF 预览加载失败。') })
    return () => { controller.abort() }
  }, [path, api])
  if (error !== undefined) return <p className={css.viewerNotice} role="alert">{error}</p>
  if (blobUrl === undefined) return <p className={css.viewerNotice} role="status">PDF 读取中…</p>
  return <iframe className={css.pdfPreview} src={blobUrl} title="PDF 预览" />
}