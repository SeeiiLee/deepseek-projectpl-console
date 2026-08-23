/**
 * R-ED Phase 1：TipTap / ProseMirror 块级富文本 Markdown 编辑器。
 * 替代 document 模式下的 CodeMirror live preview 装饰方案。
 * Markdown 通过 tiptap-markdown 扩展解析/序列化；保存时接受格式规范化。
 */
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import type { EditorView } from '@tiptap/pm/view'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Table from '@tiptap/extension-table'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import TableRow from '@tiptap/extension-table-row'
import TaskItem from '@tiptap/extension-task-item'
import TaskList from '@tiptap/extension-task-list'
import { Markdown } from 'tiptap-markdown'
import { CellSelection, deleteColumn, deleteRow } from 'prosemirror-tables'
import { Fragment, type Node as PMNode } from '@tiptap/pm/model'
import { SlashCommand } from './slash-command.ts'
import { UiIcon, PopupMenu, PopupMenuItem } from './ui/controls.tsx'
import { MarkdownInputRules } from './markdown-input-rules.ts'
import { Footnote, FootnoteDefinition } from './footnote.ts'
import { InlineMath } from './inline-math.ts'
import { Image } from './image.ts'
import { FileAttachment } from './file-attachment.ts'
import css from './RichMarkdownEditor.module.css'

export interface RichMarkdownEditorProps {
  value: string
  onChange(text: string): void
  onSave?(): void
  readOnly?: boolean
  /** 文档页脚内容，渲染在正文右下角（随内容滚动）。 */
  footer?: ReactNode
}

function markdownOf(editor: Editor): string {
  return editor.storage.markdown.getMarkdown() as string
}

function insertInlineMath(editor: Editor): void {
  if (!editor.state.selection.empty) {
    const { from, to } = editor.state.selection
    const selected = editor.state.doc.textBetween(from, to, '\n')
    if (selected.startsWith('$') && selected.endsWith('$') && selected.length >= 2) {
      editor.chain().focus()
        .deleteRange({ from, to })
        .insertContent([{ type: 'text', text: selected.slice(1, -1), marks: [{ type: 'inlineMath' }] }])
        .run()
      return
    }
    editor.chain().focus().toggleMark('inlineMath').run()
    return
  }
  editor.chain().focus().insertContent([{ type: 'text', text: ' ', marks: [{ type: 'inlineMath' }] }]).run()
  const after = editor.state.selection.from
  editor.commands.setTextSelection({ from: after - 1, to: after - 1 })
}

function searchSelection(editor: Editor): void {
  const { from, to } = editor.state.selection
  const query = editor.state.doc.textBetween(from, to, '\n')
  if (query.trim() === '') return
  const pieces: Array<{ text: string; from: number }> = []
  editor.state.doc.descendants((node, pos) => {
    if (node.isText) pieces.push({ text: node.text ?? '', from: pos })
    return true
  })
  const starts: number[] = []
  let full = ''
  for (const piece of pieces) {
    starts.push(full.length)
    full += piece.text
  }
  const docPosToIndex = (pos: number): number => {
    for (let index = 0; index < pieces.length; index += 1) {
      const piece = pieces[index]
      const start = starts[index]
      if (piece !== undefined && start !== undefined && pos >= piece.from && pos <= piece.from + piece.text.length) {
        return start + (pos - piece.from)
      }
    }
    return 0
  }
  const startIndex = docPosToIndex(to)
  let found = full.indexOf(query, startIndex)
  if (found < 0) found = full.indexOf(query)
  if (found < 0) return
  const indexToDocPos = (index: number): number => {
    for (let i = pieces.length - 1; i >= 0; i -= 1) {
      const piece = pieces[i]
      const start = starts[i]
      if (piece !== undefined && start !== undefined && index >= start) return piece.from + (index - start)
    }
    return 0
  }
  const foundFrom = indexToDocPos(found)
  const foundTo = indexToDocPos(found + query.length)
  editor.chain().focus().setTextSelection({ from: foundFrom, to: foundTo }).scrollIntoView().run()
}

/** 从拖放的 File 对象尽力取本地路径（优先用 preload 暴露的 webUtils.getPathForFile）。 */
function filePathOf(file: File): string {
  try {
    const bridge = (window as unknown as { deepseekHarnessPersonal?: { desktop?: { getPathForFile?: (f: File) => string } } }).deepseekHarnessPersonal?.desktop
    const resolved = bridge?.getPathForFile?.(file)
    if (typeof resolved === 'string' && resolved !== '') return resolved.replace(/\\/gu, '/')
  } catch {
    // ignore
  }
  const withPath = file as File & { path?: string }
  if (typeof withPath.path === 'string' && withPath.path !== '') {
    return withPath.path.replace(/\\/gu, '/')
  }
  return './' + file.name
}

/**
 * 拖放本地文件到编辑器：图片插入 Image 节点，其他文件插入文件附件节点。
 * 只拦截「带文件」的拖拽（dataTransfer.files 非空）；编辑器内部的节点拖动
 * （files 为空）原样交还 ProseMirror 默认逻辑。一次拖入多个文件按顺序一次事务插入，
 * 全文只有这一条插入路径，杜绝双份插入。
 */
function handleFileDrop(view: EditorView, event: DragEvent): boolean {
  const files = event.dataTransfer?.files
  if (files === undefined || files.length === 0) return false
  event.preventDefault()
  event.stopPropagation()
  const coords = view.posAtCoords({ left: event.clientX, top: event.clientY })
  if (coords === null) return false
  const nodes: PMNode[] = []
  for (const file of Array.from(files)) {
    const path = filePathOf(file)
    if (file.type.startsWith('image/')) {
      const imageType = view.state.schema.nodes.image
      if (imageType === undefined) continue
      // 用 objectURL 立即在编辑器内显示，dataPath 保存真实路径用于序列化。
      nodes.push(imageType.create({ src: URL.createObjectURL(file), alt: file.name, dataPath: path }))
      continue
    }
    const attachmentType = view.state.schema.nodes.fileAttachment
    if (attachmentType === undefined) continue
    nodes.push(attachmentType.create({ name: file.name, href: path }))
  }
  if (nodes.length === 0) return false
  view.dispatch(view.state.tr.insert(coords.pos, Fragment.fromArray(nodes)))
  return true
}

function nextFootnoteId(editor: Editor): number {
  const used = new Set<number>()
  editor.state.doc.descendants(node => {
    if (node.type.name === 'footnote' || node.type.name === 'footnoteDefinition') {
      const value = Number(node.attrs.id)
      if (Number.isFinite(value)) used.add(value)
    }
    return true
  })
  const storage = editor.storage.footnote as { counter: number }
  let id = storage.counter
  while (used.has(id)) id += 1
  storage.counter = id + 1
  return id
}

function insertFootnote(editor: Editor): void {
  const id = nextFootnoteId(editor)
  const { to } = editor.state.selection
  const insertAt = Math.max(1, to)
  const footnoteNode = editor.schema.nodes.footnote?.create({ id })
  if (footnoteNode !== undefined) {
    editor.view.dispatch(editor.state.tr.replaceWith(insertAt, insertAt, footnoteNode))
  }
  let hasDefinition = false
  editor.state.doc.descendants(node => {
    if (node.type.name === 'footnoteDefinition') {
      hasDefinition = true
      return false
    }
    return true
  })
  let end = editor.state.doc.content.size
  if (!hasDefinition) {
    editor.chain().focus().insertContentAt(end, { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '脚注' }] }).run()
    end = editor.state.doc.content.size
  }
  const defNode = editor.schema.nodes.footnoteDefinition?.create({ id }, editor.schema.text(' 脚注内容'))
  if (defNode !== undefined) {
    editor.view.dispatch(editor.state.tr.replaceWith(end, end, defNode))
  }
  const docEnd = editor.state.doc.content.size
  editor.chain().focus().setTextSelection({ from: docEnd, to: docEnd }).scrollIntoView().run()
}

const categoryItems: Array<{ icon: string; label: string; action: (editor: Editor) => void }> = [
  { icon: '•', label: '列表', action: editor => { editor.chain().focus().toggleBulletList().run() } },
  { icon: '☑', label: '待办', action: editor => { editor.chain().focus().toggleTaskList().run() } },
  { icon: '1.', label: '数字列表', action: editor => { editor.chain().focus().toggleOrderedList().run() } },
  { icon: 'H', label: 'H1', action: editor => { editor.chain().focus().toggleHeading({ level: 1 }).run() } },
  { icon: 'H', label: 'H2', action: editor => { editor.chain().focus().toggleHeading({ level: 2 }).run() } },
  { icon: 'H', label: 'H3', action: editor => { editor.chain().focus().toggleHeading({ level: 3 }).run() } },
  { icon: 'H', label: 'H4', action: editor => { editor.chain().focus().toggleHeading({ level: 4 }).run() } },
  { icon: '⊞', label: '表格', action: editor => { editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() } },
  { icon: '</>', label: '代码块', action: editor => { editor.chain().focus().toggleCodeBlock().run() } },
]

const PARAGRAPH_OPTIONS = [
  { level: 0, label: '正文' },
  { level: 1, label: '标题 1' },
  { level: 2, label: '标题 2' },
  { level: 3, label: '标题 3' },
  { level: 4, label: '标题 4' },
  { level: 5, label: '标题 5' },
  { level: 6, label: '标题 6' },
] as const

const TB_ICONS = {
  code: 'm16 18 6-6-6-6M8 6l-6 6 6 6',
  bulletList: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  orderedList: 'M10 6h11M10 12h11M10 18h11M4 6h1v4M4 10h2M6 18H4c0-1 2-2 2-3s-1-1.5-2-1',
  quote: 'M8 6C5.8 7.2 4.5 9.3 4.5 12v5h5v-6H6.2c.1-1.6.9-2.8 1.8-3.5zM18 6c-2.2 1.2-3.5 3.3-3.5 6v5h5v-6h-3.3c.1-1.6.9-2.8 1.8-3.5z',
  codeBlock: 'M10 9.5 8 12l2 2.5M14 9.5l2 2.5-2 2.5M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z',
  link: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
  table: 'M3 5h18v14H3zM3 10h18M3 15h18M9 5v14M15 5v14',
  footnote: 'M12 4v16M5 8l14 8M19 8 5 16',
  math: 'M18 7V4H6l6 8-6 8h12v-3',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3',
  source: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6',
  richText: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  convert: 'M7 16V4m0 0L3 8m4-4 4 4M17 8v12m0 0 4-4m-4 4-4-4',
} as const

export function RichMarkdownEditor(props: RichMarkdownEditorProps): ReactNode {
  const { value, onChange, onSave, readOnly = false, footer } = props
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onSaveRef = useRef(onSave)
  onSaveRef.current = onSave
  const valueRef = useRef(value)
  valueRef.current = value
  const skipNextValueRef = useRef(false)
  const [bubble, setBubble] = useState<{ x: number; y: number } | null>(null)
  const [tableInsert, setTableInsert] = useState<{ kind: 'row' | 'column'; x: number; y: number } | null>(null)
  const [categoryOpen, setCategoryOpen] = useState(false)
  const [paragraphOpen, setParagraphOpen] = useState(false)
  const [paragraphKind, setParagraphKind] = useState(0)
  const [sourceMode, setSourceMode] = useState(false)
  const [sourceText, setSourceText] = useState('')

  const editor = useEditor({
    content: value,
    extensions: [
      StarterKit,
      TaskList,
      TaskItem,
      Link.configure({
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        HTMLAttributes: { rel: 'noopener noreferrer nofollow' },
      }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      Footnote,
      FootnoteDefinition,
      InlineMath,
      Image,
      FileAttachment,
      SlashCommand,
      MarkdownInputRules,
      Markdown.configure({
        html: false,
        tightLists: true,
        bulletListMarker: '-',
        linkify: false,
        breaks: false,
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
    editable: !readOnly,
    editorProps: {
      handleKeyDown: (view, event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
          event.preventDefault()
          onSaveRef.current?.()
          return true
        }
        if ((event.key === 'Delete' || event.key === 'Backspace') && view.state.selection instanceof CellSelection) {
          if (view.state.selection.isRowSelection()) {
            deleteRow(view.state, view.dispatch)
            return true
          }
          if (view.state.selection.isColSelection()) {
            deleteColumn(view.state, view.dispatch)
            return true
          }
        }
        return false
      },
      handleDrop: (view, event) => {
        if (!(event instanceof DragEvent)) return false
        return handleFileDrop(view, event)
      },
      // 文件卡片内的点击由 FileAttachmentView 消费（打开文件、不导航）；
      // 这里向 ProseMirror 标记已处理，挡住更上层的链接/导航类处理。
      handleClick: (_view, _pos, event) => {
        const target = event.target
        return target instanceof HTMLElement && target.closest('.file-attachment') !== null
      },
    },
    onUpdate: ({ editor: current }) => {
      skipNextValueRef.current = true
      onChangeRef.current(markdownOf(current))
    },
  })

  // 外部 value 变化（reload/外部更新/放弃草稿）：内容不同才替换，且不触发 onChange。
  // 源码模式下由 textarea 接管，不同步回 TipTap；退出源码模式时再统一 setContent。
  useEffect(() => {
    if (editor === null || sourceMode) return
    if (skipNextValueRef.current) {
      skipNextValueRef.current = false
      return
    }
    const current = markdownOf(editor)
    if (current === valueRef.current) return
    editor.commands.setContent(valueRef.current, false)
  }, [editor, value, sourceMode])

  // smoke 探针钩子：暴露 TipTap Editor 实例。
  useEffect(() => {
    if (editor === null) return
    const holder = window as unknown as { __wbRichEditors?: Editor[] }
    if (holder.__wbRichEditors === undefined) holder.__wbRichEditors = []
    holder.__wbRichEditors.push(editor)
    return () => {
      const next = holder.__wbRichEditors?.filter(item => item !== editor)
      if (next !== undefined && next.length > 0) holder.__wbRichEditors = next
      else delete holder.__wbRichEditors
    }
  }, [editor])

  // 只读状态动态切换。
  useEffect(() => {
    if (editor === null) return
    editor.setEditable(!readOnly)
  }, [editor, readOnly])

  // 抑制 DSH 原生“图片拖动到此处即可添加”的全屏遮盖层。
  useEffect(() => {
    const hideOverlay = (): void => {
      document.querySelectorAll('body *').forEach(el => {
        if (el.children.length === 0 && (el.textContent ?? '').includes('图片拖动到此处即可添加')) {
          (el as HTMLElement).style.display = 'none'
        }
      })
    }
    const observer = new MutationObserver(hideOverlay)
    observer.observe(document.body, { childList: true, subtree: true })
    hideOverlay()
    return () => { observer.disconnect() }
  }, [])

  // 浮动选中工具栏：非空选区时根据光标位置显示；同时跟踪当前段落类型供工具栏下拉回显。
  useEffect(() => {
    if (editor === null) return
    const update = (): void => {
      setCategoryOpen(false)
      let kind = 0
      for (let level = 1; level <= 6; level += 1) {
        if (editor.isActive('heading', { level })) kind = level
      }
      setParagraphKind(kind)
      const { empty, from } = editor.state.selection
      if (empty) {
        setBubble(null)
        return
      }
      const coords = editor.view.coordsAtPos(from)
      if (coords !== null) setBubble({ x: coords.left, y: coords.top })
    }
    editor.on('selectionUpdate', update)
    editor.on('focus', update)
    return () => {
      editor.off('selectionUpdate', update)
      editor.off('focus', update)
    }
  }, [editor])

  // 段落下拉打开时，点击菜单外任意处收起。
  useEffect(() => {
    if (!paragraphOpen) return
    const onPointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Element && event.target.closest('[data-rich-markdown-paragraph]') !== null) return
      setParagraphOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => { document.removeEventListener('pointerdown', onPointerDown) }
  }, [paragraphOpen])

  if (editor === null) {
    return <div className={css.editor} data-rich-markdown-editor data-loading="true" />
  }

  const run = (action: (current: Editor) => void): void => {
    action(editor)
    editor.view.focus()
  }

  const handleTableMouseMove = (event: MouseEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement
    const cell = target.closest('th, td')
    if (!(cell instanceof HTMLElement)) {
      setTableInsert(null)
      return
    }
    const rect = cell.getBoundingClientRect()
    const offsetX = event.clientX - rect.left
    const offsetY = event.clientY - rect.top
    if (offsetX < 12) {
      setTableInsert({ kind: 'column', x: rect.left, y: rect.top + rect.height / 2 })
    } else if (offsetY < 12) {
      setTableInsert({ kind: 'row', x: rect.left + rect.width / 2, y: rect.top })
    } else {
      setTableInsert(null)
    }
  }

  return (
    <div className={css.editor} data-rich-markdown-editor>
      <div className={css.toolbar} data-rich-markdown-toolbar role="toolbar" aria-label="富文本格式">
        {!sourceMode && (
          <>
            <div className={css.toolbarGroup}>
              <div className={css.paragraphWrap} data-rich-markdown-paragraph>
                <button
                  type="button"
                  className={css.paragraphButton}
                  title="段落类型"
                  aria-label="段落类型"
                  aria-expanded={paragraphOpen}
                  onClick={() => setParagraphOpen(open => !open)}
                >
                  <span>{PARAGRAPH_OPTIONS[paragraphKind]?.label ?? '正文'}</span>
                  <UiIcon d="m6 9 6 6 6-6" />
                </button>
                {paragraphOpen && (
                  <PopupMenu data={{ 'data-rich-markdown-paragraph-menu': '' }}>
                    {PARAGRAPH_OPTIONS.map(option => (
                      <PopupMenuItem
                        key={option.label}
                        label={option.label}
                        checked={paragraphKind === option.level}
                        onSelect={() => {
                          run(current => {
                            if (option.level === 0) current.chain().focus().setParagraph().run()
                            else current.chain().focus().toggleHeading({ level: option.level as 1 | 2 | 3 | 4 | 5 | 6 }).run()
                          })
                          setParagraphKind(option.level)
                          setParagraphOpen(false)
                        }}
                      />
                    ))}
                  </PopupMenu>
                )}
              </div>
            </div>
            <span className={css.toolbarDivider} />
            <div className={css.toolbarGroup}>
              <button type="button" title="加粗" aria-label="加粗" onClick={() => run(current => current.chain().focus().toggleBold().run())}><span className={css.glyph} data-glyph="bold">B</span></button>
              <button type="button" title="斜体" aria-label="斜体" onClick={() => run(current => current.chain().focus().toggleItalic().run())}><span className={css.glyph} data-glyph="italic">I</span></button>
              <button type="button" title="删除线" aria-label="删除线" onClick={() => run(current => current.chain().focus().toggleStrike().run())}><span className={css.glyph} data-glyph="strike">S</span></button>
              <button type="button" title="行内代码" aria-label="行内代码" onClick={() => run(current => current.chain().focus().toggleCode().run())}><UiIcon d={TB_ICONS.code} /></button>
              <button type="button" title="行内公式" aria-label="行内公式" onClick={() => run(insertInlineMath)}><UiIcon d={TB_ICONS.math} /></button>
            </div>
            <span className={css.toolbarDivider} />
            <div className={css.toolbarGroup}>
              <button type="button" title="无序列表" aria-label="无序列表" onClick={() => run(current => current.chain().focus().toggleBulletList().run())}><UiIcon d={TB_ICONS.bulletList} /></button>
              <button type="button" title="有序列表" aria-label="有序列表" onClick={() => run(current => current.chain().focus().toggleOrderedList().run())}><UiIcon d={TB_ICONS.orderedList} /></button>
              <button type="button" title="引用" aria-label="引用" onClick={() => run(current => current.chain().focus().toggleBlockquote().run())}><UiIcon d={TB_ICONS.quote} /></button>
              <button type="button" title="代码块" aria-label="代码块" onClick={() => run(current => current.chain().focus().toggleCodeBlock().run())}><UiIcon d={TB_ICONS.codeBlock} /></button>
            </div>
            <span className={css.toolbarDivider} />
            <div className={css.toolbarGroup}>
              <button type="button" title="链接" aria-label="链接" onClick={() => run(current => {
                const url = window.prompt('链接地址（http/https/mailto）')
                if (url !== null && url.trim() !== '') current.chain().focus().setLink({ href: url.trim() }).run()
              })}><UiIcon d={TB_ICONS.link} /></button>
              <button type="button" title="表格" aria-label="表格" onClick={() => run(current => current.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }))}><UiIcon d={TB_ICONS.table} /></button>
              <button type="button" title="脚注" aria-label="脚注" onClick={() => run(insertFootnote)}><UiIcon d={TB_ICONS.footnote} /></button>
              <button type="button" title="搜索选中" aria-label="搜索选中" onClick={() => run(searchSelection)}><UiIcon d={TB_ICONS.search} /></button>
            </div>
            <span className={css.toolbarDivider} />
          </>
        )}
        <div className={css.toolbarGroup}>
          <button
            type="button"
            title={sourceMode ? '返回富文本' : '源码模式'}
            aria-label={sourceMode ? '返回富文本' : '源码模式'}
            data-rich-markdown-source-toggle
            onClick={() => {
              if (sourceMode) {
                setSourceMode(false)
              } else {
                setSourceText(markdownOf(editor))
                setSourceMode(true)
              }
            }}
          >
            <UiIcon d={sourceMode ? TB_ICONS.richText : TB_ICONS.source} />
          </button>
        </div>
      </div>
      {bubble !== null && (
        <div className={css.bubbleMenu} data-rich-markdown-bubble style={{ position: 'fixed', left: bubble.x, top: bubble.y - 36, zIndex: 1000 }}>
          <button type="button" title="转换为…" aria-label="转换为…" onClick={() => setCategoryOpen(open => !open)}><UiIcon d={TB_ICONS.convert} /></button>
          {categoryOpen && (
            <PopupMenu data={{ 'data-rich-markdown-category': '' }}>
              {categoryItems.map(item => (
                <PopupMenuItem
                  key={item.label}
                  label={item.label}
                  icon={item.icon}
                  onSelect={() => {
                    run(item.action)
                    setCategoryOpen(false)
                  }}
                />
              ))}
            </PopupMenu>
          )}
          <span className={css.bubbleDivider} />
          <button type="button" title="加粗" aria-label="加粗" onClick={() => run(current => current.chain().focus().toggleBold().run())}><span className={css.glyph} data-glyph="bold">B</span></button>
          <button type="button" title="斜体" aria-label="斜体" onClick={() => run(current => current.chain().focus().toggleItalic().run())}><span className={css.glyph} data-glyph="italic">I</span></button>
          <button type="button" title="删除线" aria-label="删除线" onClick={() => run(current => current.chain().focus().toggleStrike().run())}><span className={css.glyph} data-glyph="strike">S</span></button>
          <button type="button" title="行内代码" aria-label="行内代码" onClick={() => run(current => current.chain().focus().toggleCode().run())}><UiIcon d={TB_ICONS.code} /></button>
          <button type="button" title="行内公式" aria-label="行内公式" onClick={() => run(insertInlineMath)}><UiIcon d={TB_ICONS.math} /></button>
          <span className={css.bubbleDivider} />
          <button type="button" title="脚注" aria-label="脚注" onClick={() => run(insertFootnote)}><UiIcon d={TB_ICONS.footnote} /></button>
          <button type="button" title="搜索选中" aria-label="搜索选中" onClick={() => run(searchSelection)}><UiIcon d={TB_ICONS.search} /></button>
        </div>
      )}
      {tableInsert !== null && (
        <button
          type="button"
          className={css.tableInsertButton}
          data-table-insert={tableInsert.kind}
          style={{ position: 'fixed', left: tableInsert.x - 8, top: tableInsert.y - 8, zIndex: 1000 }}
          onMouseDown={event => event.preventDefault()}
          onClick={() => {
            const action = tableInsert.kind === 'row'
              ? (current: Editor) => current.chain().focus().addRowBefore().run()
              : (current: Editor) => current.chain().focus().addColumnBefore().run()
            run(action)
            setTableInsert(null)
          }}
        >+</button>
      )}
      <div
        className={css.content}
        data-rich-markdown-content
        onMouseMove={handleTableMouseMove}
        onDragEnter={event => {
          event.preventDefault()
          event.stopPropagation()
        }}
        onDragOver={event => {
          event.preventDefault()
          event.stopPropagation()
        }}
      >
        <div className={css.documentColumn}>
          {sourceMode ? (
            <textarea
              className={css.sourceEditor}
              data-rich-markdown-source
              value={sourceText}
              onChange={event => {
                const next = event.currentTarget.value
                setSourceText(next)
                onChangeRef.current(next)
              }}
              spellCheck={false}
            />
          ) : (
            <EditorContent editor={editor} />
          )}
          {footer === undefined ? null : <div className={css.footer}>{footer}</div>}
        </div>
      </div>
    </div>
  )
}
