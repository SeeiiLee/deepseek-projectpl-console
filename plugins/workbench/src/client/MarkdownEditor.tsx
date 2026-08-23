import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { EditorSelection, EditorState, Compartment } from '@codemirror/state'
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  keymap,
  lineNumbers,
  scrollPastEnd,
} from '@codemirror/view'
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { openSearchPanel, SearchQuery, searchKeymap, setSearchQuery } from '@codemirror/search'
import { syntaxHighlighting, defaultHighlightStyle, type LanguageSupport } from '@codemirror/language'
import { fenceAutoCloseInsert } from './markdown-format-tools.ts'

/**
 * R-ED：CodeMirror 6 直接 EditorView 适配器（§8.10.1）。
 * - 不使用 basicSetup 黑盒：显式组合 lineNumbers/highlightActiveLine/drawSelection/history/keymap。
 * - Compartment 动态切换 theme/wrap/语言/readOnly/行号，避免重建 EditorView。
 * - 主题读取 DSH CSS token（--dsw-*），Personal Theme 变化随 DOM 变量自动生效。
 * - 外部文档更新只在内容不同时 dispatch（§8.10.1），编辑循环安全。
 */
export interface MarkdownEditorProps {
  value: string
  onChange(text: string): void
  onSave(): void
  onSelectionChange?(selection: { anchor: number; head: number }): void
  readOnly?: boolean
  language?: 'markdown' | 'plain'
  lineWrapping?: boolean
  showLineNumbers?: boolean
}

/** DSH token 编辑器主题（暗色基调；语法高亮用默认 fallback，后续可按需细化）。 */
export const dshEditorTheme = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--dsw-alias-label-primary)',
    backgroundColor: 'transparent',
    fontSize: 'var(--wb-editor-font-size, 13.5px)',
  },
  '.cm-content': {
    caretColor: 'var(--dsw-alias-state-business-primary)',
    fontFamily: 'var(--wb-editor-font-family, var(--wb-code-font-family, ui-monospace, Consolas, monospace))',
    lineHeight: 'var(--wb-editor-line-height, 1.5)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--dsw-alias-state-business-primary)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground':
    { backgroundColor: 'var(--dsw-alias-interactive-bg-active)' },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'var(--dsw-alias-label-tertiary)',
    border: 'none',
  },
  '.cm-activeLine': { backgroundColor: 'var(--dsw-alias-interactive-bg-hover)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--dsw-alias-interactive-bg-hover)' },
}, { dark: true })

/** 每个 EditorView 实例独立的 Compartment 组（模块级单例会被多实例/重挂载复用而崩溃：
    "Duplicate use of compartment in extensions"）。 */
interface EditorCompartments {
  language: Compartment
  wrap: Compartment
  readOnly: Compartment
  gutter: Compartment
}

function createCompartments(): EditorCompartments {
  return {
    language: new Compartment(),
    wrap: new Compartment(),
    readOnly: new Compartment(),
    gutter: new Compartment(),
  }
}

function languageExtension(language: 'markdown' | 'plain'): LanguageSupport | [] {
  if (language === 'markdown') return markdown()
  return []
}

/** ``` 围栏自动补全：回车时若当前行是围栏起始行，补闭合围栏（VS Code/Obsidian 习惯）。 */
function fenceAutoClose() {
  return EditorView.inputHandler.of((view, from, to, text) => {
    if (text !== '\n') return false
    const line = view.state.doc.lineAt(from)
    const plan = fenceAutoCloseInsert(line.text)
    if (plan === null) return false
    view.dispatch({
      changes: { from, to, insert: plan.insert },
      selection: { anchor: from + plan.anchor },
      userEvent: 'input.type',
    })
    return true
  })
}

/** 语言内容（of 与 reconfigure 共用：reconfigure 不得传入 of() 包装，否则嵌套自身报
    "Duplicate use of compartment in extensions"）。 */
function languageContent(language: 'markdown' | 'plain') {
  return [
    languageExtension(language),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    ...(language === 'markdown' ? [fenceAutoClose()] : []),
  ]
}

function wrapContent(lineWrapping: boolean) {
  return lineWrapping ? EditorView.lineWrapping : []
}

function readOnlyContent(readOnly: boolean) {
  return EditorState.readOnly.of(readOnly)
}

function gutterContent(showLineNumbers: boolean) {
  return showLineNumbers ? [lineNumbers()] : []
}

/** 选中文本 toggle 包裹（B/I/S/行内代码/行内公式/双链共用）：再次点击解包。 */
function toggleMarker(view: EditorView, prefix: string, suffix: string = prefix): void {
  view.dispatch(view.state.changeByRange(range => {
    if (range.empty) {
      const insert = prefix + suffix
      return { changes: { from: range.from, insert }, range: EditorSelection.cursor(range.from + prefix.length) }
    }
    const text = view.state.sliceDoc(range.from, range.to)
    if (text.length >= prefix.length + suffix.length && text.startsWith(prefix) && text.endsWith(suffix)) {
      const inner = text.slice(prefix.length, text.length - suffix.length)
      const chained = (prefix.length > 0 && inner.startsWith(prefix)) || (suffix.length > 0 && inner.endsWith(suffix))
      if (!chained) {
        return {
          changes: [
            { from: range.from, to: range.from + prefix.length },
            { from: range.to - suffix.length, to: range.to },
          ],
          range: EditorSelection.range(range.from, range.to - prefix.length - suffix.length),
        }
      }
    }
    return {
      changes: [
        { from: range.from, insert: prefix },
        { from: range.to, insert: suffix },
      ],
      range: EditorSelection.range(range.from, range.to + prefix.length + suffix.length),
    }
  }))
}

/** 标题层级：选中行首加/换 # 前缀；同层级再点还原为正文。 */
function setHeadingLevel(view: EditorView, level: number): void {
  const line = view.state.doc.lineAt(view.state.selection.main.from)
  const match = /^(#{1,6})\s+/.exec(line.text)
  const prefixLength = match === null ? 0 : match[0].length
  const currentLevel = match === null ? 0 : (match[1]?.length ?? 0)
  const toggleOff = currentLevel === level && level !== 0
  const nextPrefix = toggleOff ? '' : level === 0 ? '' : '#'.repeat(level) + ' '
  view.dispatch({
    changes: { from: line.from, to: line.from + prefixLength, insert: nextPrefix },
    selection: { anchor: line.from + nextPrefix.length },
  })
}

/** 链接：选中文字作为链接文字，URL 处预置 https:// 并选中待输入。 */
function linkSelection(view: EditorView): void {
  const main = view.state.selection.main
  const text = view.state.sliceDoc(main.from, main.to)
  const label = text.length > 0 ? text : '链接'
  const insert = `[${label}](https://)`
  const urlFrom = main.from + label.length + 3
  view.dispatch({
    changes: { from: main.from, to: main.to, insert },
    selection: { anchor: urlFrom, head: urlFrom + 8 },
  })
}

/** 脚注：选中处追加 [^n]，文末追加 [^n]:  定义行，光标落在定义处。 */
function footnoteSelection(view: EditorView): void {
  const main = view.state.selection.main
  const doc = view.state.doc
  const text = doc.toString()
  const numbers = [...text.matchAll(/\[\^(\d+)\]/g)].map(m => Number(m[1]))
  const n = (numbers.length > 0 ? Math.max(...numbers) : 0) + 1
  const marker = `[^${n}]`
  const needsBreak = text.length > 0 && !text.endsWith('\n')
  const suffix = (needsBreak ? '\n' : '') + `[^${n}]: `
  view.dispatch({
    changes: [
      { from: main.to, insert: marker },
      { from: doc.length, insert: suffix },
    ],
    selection: { anchor: doc.length + marker.length + suffix.length },
  })
}

/** 代码块：选中行整体包 ``` 围栏；已包围栏则解包。 */
function codeBlockSelection(view: EditorView): void {
  const main = view.state.selection.main
  const startLine = view.state.doc.lineAt(main.from)
  const endLine = view.state.doc.lineAt(main.to)
  const block = view.state.sliceDoc(startLine.from, endLine.to)
  const firstBreak = block.indexOf('\n')
  const lastBreak = block.lastIndexOf('\n')
  if (block.startsWith('```') && block.endsWith('```') && firstBreak >= 0 && lastBreak > firstBreak) {
    const inner = block.slice(firstBreak + 1, lastBreak)
    view.dispatch({
      changes: { from: startLine.from, to: endLine.to, insert: inner },
      selection: { anchor: startLine.from, head: startLine.from + inner.length },
    })
    return
  }
  const wrapped = '```\n' + block + (block.endsWith('\n') ? '' : '\n') + '```'
  view.dispatch({
    changes: { from: startLine.from, to: endLine.to, insert: wrapped },
    selection: { anchor: startLine.from + 4, head: startLine.from + 4 + block.length },
  })
}

/** 搜索选中文字：打开搜索面板并预填关键词。 */
function searchSelection(view: EditorView): void {
  const main = view.state.selection.main
  const text = view.state.sliceDoc(main.from, main.to)
  openSearchPanel(view)
  if (text.length > 0) {
    view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: text })) })
  }
}

/** 浮动工具栏位置：选中起点上方；太靠顶部则放下方。 */
function toolbarPosition(view: EditorView): { x: number; y: number; placeBelow: boolean } | null {
  const main = view.state.selection.main
  if (main.empty) return null
  const host = view.dom.getBoundingClientRect()
  const start = view.coordsAtPos(main.from)
  if (start !== null) {
    return { x: start.left - host.left, y: start.top - host.top, placeBelow: start.top - host.top < 44 }
  }
  // 兜底：编辑器未布局/不可见时用选区层矩形
  const sel = view.dom.querySelector('.cm-selectionBackground')
  if (sel !== null) {
    const rect = sel.getBoundingClientRect()
    if (rect.width > 0 || rect.height > 0) {
      return { x: rect.left - host.left, y: rect.top - host.top, placeBelow: rect.top - host.top < 44 }
    }
  }
  return null
}
export function MarkdownEditor(props: MarkdownEditorProps): ReactNode {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const compartmentsRef = useRef<EditorCompartments | null>(null)
  const propsRef = useRef(props)
  propsRef.current = props
  const [toolbar, setToolbar] = useState<{ x: number; y: number; placeBelow: boolean } | null>(null)

  useLayoutEffect(() => {
    const host = hostRef.current
    if (host === null) return
    // 每次创建新建 compartments（StrictMode 双挂载/多实例安全）。
    const compartments = createCompartments()
    compartmentsRef.current = compartments
    const state = EditorState.create({
      doc: props.value,
      extensions: [
        dshEditorTheme,
        drawSelection(),
        highlightActiveLine(),
        scrollPastEnd(),
        history(),
        compartments.language.of(languageContent(props.language ?? 'markdown')),
        compartments.wrap.of(wrapContent(props.lineWrapping ?? false)),
        compartments.readOnly.of(readOnlyContent(props.readOnly ?? false)),
        compartments.gutter.of(gutterContent(props.showLineNumbers ?? true)),
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
          { key: 'Mod-s', run: () => { propsRef.current.onSave(); return true } },
          indentWithTab,
        ]),
        EditorView.updateListener.of(update => {
          const propsNow = propsRef.current
          if (update.docChanged) propsNow.onChange(update.state.doc.toString())
          if (update.selectionSet && propsNow.onSelectionChange !== undefined) {
            const { anchor, head } = update.state.selection.main
            propsNow.onSelectionChange({ anchor, head })
          }
          if (update.selectionSet || update.docChanged) {
            setToolbar(propsNow.readOnly === true ? null : toolbarPosition(update.view))
          }
        }),
      ],
    })
    const view = new EditorView({ state, parent: host })
    viewRef.current = view
    // smoke 探针钩子：暴露 EditorView 实例（脚本驱动选区/工具栏验证）
    if ((window as unknown as { __DSH_SMOKE__?: boolean }).__DSH_SMOKE__ === true) {
      const holder = window as unknown as { __wbEditorViews: EditorView[] | undefined }
      if (holder.__wbEditorViews === undefined) holder.__wbEditorViews = []
      holder.__wbEditorViews.push(view)
    }
    return () => {
      view.destroy()
      viewRef.current = null
      if ((window as unknown as { __DSH_SMOKE__?: boolean }).__DSH_SMOKE__ === true) {
        const holder = window as unknown as { __wbEditorViews: EditorView[] | undefined }
        holder.__wbEditorViews = holder.__wbEditorViews?.filter(item => item !== view)
      }
    }
    // 创建仅一次；后续 value 变化走 dispatch 路径。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 外部 value 变化（reload/外部更新/undo 边界）：内容不同才 dispatch。
  useLayoutEffect(() => {
    const view = viewRef.current
    if (view === null) return
    const current = view.state.doc.toString()
    if (current === props.value) return
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: props.value },
    })
  }, [props.value])

  // Compartment 动态切换（§8.10.1：不重建 EditorView）。
  useLayoutEffect(() => {
    const view = viewRef.current
    const compartments = compartmentsRef.current
    if (view === null || compartments === null) return
    view.dispatch({
      effects: [
        compartments.language.reconfigure(languageContent(props.language ?? 'markdown')),
        compartments.wrap.reconfigure(wrapContent(props.lineWrapping ?? false)),
        compartments.readOnly.reconfigure(readOnlyContent(props.readOnly ?? false)),
        compartments.gutter.reconfigure(gutterContent(props.showLineNumbers ?? true)),
      ],
    })
  }, [props.language, props.lineWrapping, props.readOnly, props.showLineNumbers])

  function runAction(action: (view: EditorView) => void): void {
    const view = viewRef.current
    if (view === null) return
    action(view)
    view.focus()
  }

  return (
    <div className="markdown-editor-wrap" style={{ position: 'relative', height: '100%', minHeight: 0 }}>
      <div
        className="markdown-editor-host"
        ref={hostRef}
        data-codemirror-editor
        style={{ height: '100%', minHeight: 0 } as React.CSSProperties}
      />
      {toolbar !== null && (
        <div
          className="markdown-format-toolbar"
          data-place-below={toolbar.placeBelow}
          style={{ left: toolbar.x, top: toolbar.y } as React.CSSProperties}
          onMouseDown={event => event.preventDefault()}
        >
          <select
            title="标题层级"
            defaultValue=""
            onChange={event => {
              const level = Number(event.currentTarget.value)
              event.currentTarget.value = ''
              if (Number.isFinite(level) && level >= 0 && level <= 6) runAction(view => setHeadingLevel(view, level))
            }}
          >
            <option value="" disabled>H</option>
            <option value="0">正文</option>
            <option value="1">H1</option>
            <option value="2">H2</option>
            <option value="3">H3</option>
            <option value="4">H4</option>
            <option value="5">H5</option>
            <option value="6">H6</option>
          </select>
          <button type="button" title="加粗" onClick={() => runAction(view => toggleMarker(view, '**'))}><b>B</b></button>
          <button type="button" title="斜体" onClick={() => runAction(view => toggleMarker(view, '*'))}><i>I</i></button>
          <button type="button" title="删除线" onClick={() => runAction(view => toggleMarker(view, '~~'))}><s>S</s></button>
          <button type="button" title="行内代码" onClick={() => runAction(view => toggleMarker(view, String.fromCharCode(96)))}>{'</>'}</button>
          <button type="button" title="行内公式" onClick={() => runAction(view => toggleMarker(view, '$'))}>ƒx</button>
          <button type="button" title="链接" onClick={() => runAction(linkSelection)}>🔗</button>
          <button type="button" title="双链引用" onClick={() => runAction(view => toggleMarker(view, '[[', ']]'))}>[[ ]]</button>
          <button type="button" title="脚注" onClick={() => runAction(footnoteSelection)}>[^1]</button>
          <button type="button" title="代码块" onClick={() => runAction(codeBlockSelection)}>{String.fromCharCode(96, 96, 96)}</button>
          <button type="button" title="搜索选中内容" onClick={() => runAction(searchSelection)}>🔍</button>
        </div>
      )}
    </div>
  )
}
