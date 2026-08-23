/**
 * R-ED Phase 2：脚注。
 * 行内脚注用 atom node 渲染为上标，序列化用 `state.write` 原样输出 `[^n]`，避免转义。
 * 文末定义用 FootnoteDefinition 块节点，渲染为 `1: 内容`，序列化为 `[^1]: 内容`。
 */
import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { FootnoteDefinitionView } from './FootnoteDefinitionView.tsx'

export interface FootnoteStorage {
  counter: number
  markdown: {
    serialize(state: { write(text: string): void }, node: { attrs: { id: number | string } }): void
    parse?: {
      updateDOM?(element: HTMLElement): void
    }
  }
}

export interface FootnoteDefinitionStorage {
  markdown: {
    serialize(state: { write(text: string): void; renderInline(node: unknown): void; closeBlock(node: unknown): void }, node: { attrs: { id: number | string } }): void
    parse?: {
      setup?(md: any): void
      updateDOM?(element: HTMLElement): void
    }
  }
}

export const Footnote = Node.create({
  name: 'footnote',

  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      id: { default: 1 },
    }
  },

  parseHTML() {
    return [{
      tag: 'span[data-footnote]',
      getAttrs: (el: HTMLElement | string) => {
        if (typeof el === 'string') return {}
        const id = el.getAttribute('data-footnote-id') ?? el.getAttribute('data-footnote') ?? '1'
        return { id }
      },
    }]
  },

  renderHTML({ HTMLAttributes, node }) {
    return ['a', mergeAttributes(HTMLAttributes, { 'data-footnote': '', class: 'footnote-ref', id: 'fnref-' + String(node.attrs.id) }), String(node.attrs.id)]
  },

  addStorage(): FootnoteStorage {
    return {
      counter: 1,
      markdown: {
        serialize(state, node) {
          state.write('[^' + String(node.attrs.id) + ']')
        },
        parse: {
          updateDOM(element) {
            convertFootnoteReferences(element)
          },
        },
      },
    }
  },
})

/** 脚注定义块：文末显示为 `1: 内容`，序列化为 `[^1]: 内容`。 */
export const FootnoteDefinition = Node.create({
  name: 'footnoteDefinition',

  group: 'block',
  content: 'inline*',

  addAttributes() {
    return {
      id: { default: 1 },
    }
  },

  parseHTML() {
    return [{
      tag: 'div[data-footnote-def]',
      getAttrs: (el: HTMLElement | string) => {
        if (typeof el === 'string') return {}
        const id = el.getAttribute('data-footnote-def-id') ?? '1'
        return { id }
      },
    }]
  },

  renderHTML({ HTMLAttributes, node }) {
    // ProseMirror 的 renderSpec 要求 content hole 必须是其父节点的唯一子节点；
    // 因此把内容洞放进独立的 `.footnote-def-content` 容器，而不是与编号 span 并列。
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-footnote-def': '', class: 'footnote-def' }),
      ['span', { class: 'footnote-def-id' }, String(node.attrs.id) + ':'],
      ['div', { class: 'footnote-def-content' }, 0],
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(FootnoteDefinitionView)
  },

  addStorage(): FootnoteDefinitionStorage {
    return {
      markdown: {
        serialize(state, node) {
          state.write('[^' + String(node.attrs.id) + ']: ')
          state.renderInline(node)
          // 块级节点必须 closeBlock，否则连续多个脚注定义会串成同一行。
          state.closeBlock(node)
        },
        parse: {
          setup(md) {
            // markdown-it 会把 `[^id]: ...` 误当成 link reference definition 并从输出中移除，
            // 导致 `[^id]` 变成链接、脚注定义行消失。这里在渲染前先把定义行替换成安全占位符。
            const originalRender = md.render.bind(md)
            md.render = (source: string, env?: unknown) => originalRender(protectFootnoteDefinitions(source), env)
          },
          updateDOM(element) {
            convertFootnoteDefinitions(element)
          },
        },
      },
    }
  },
})

/**
 * tiptap-markdown 的 markdown-it 默认不解析脚注语法。
 * 这里在渲染后的 DOM 上把 `[^id]` 文本改造成 Footnote 节点可识别的 span，
 * 把 `[^id]: ...` 段落改造成 FootnoteDefinition 节点可识别的 div。
 * 这样保存后的标准脚注语法重新进入编辑态时不会退化成纯文本/重复生成“脚注”标题。
 */
function convertFootnoteReferences(root: HTMLElement): void {
  const doc = root.ownerDocument
  if (doc === null) return
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const textNodes: Text[] = []
  while (walker.nextNode()) {
    textNodes.push(walker.currentNode as Text)
  }
  for (const textNode of textNodes) {
    const parent = textNode.parentElement
    if (parent === null || parent.closest('pre, code') !== null) continue
    // 脚注定义行（`[^id]: ...`）留给 convertFootnoteDefinitions 整体转换；
    // 这里如果先把 `[^id]` 换成 span，定义行就再也匹配不上 `[^id]:` 前缀了。
    const paragraph = parent.closest('p')
    if (paragraph !== null && /^\[\^[^\]]+\]:/.test(paragraph.textContent ?? '')) continue
    const text = textNode.textContent ?? ''
    if (!text.includes('[^')) continue
    const regex = /\[\^([^\]]+)\]/g
    let match: RegExpExecArray | null
    let last = 0
    let changed = false
    const fragment = doc.createDocumentFragment()
    while ((match = regex.exec(text)) !== null) {
      if (match.index > last) fragment.appendChild(doc.createTextNode(text.slice(last, match.index)))
      const id = match[1] ?? '1'
      const span = doc.createElement('span')
      span.setAttribute('data-footnote', '')
      span.setAttribute('data-footnote-id', id)
      span.textContent = id
      fragment.appendChild(span)
      last = match.index + match[0].length
      changed = true
    }
    if (changed) {
      if (last < text.length) fragment.appendChild(doc.createTextNode(text.slice(last)))
      parent.replaceChild(fragment, textNode)
    }
  }
}

function convertFootnoteDefinitions(root: HTMLElement): void {
  const doc = root.ownerDocument
  if (doc === null) return
  const paragraphs = Array.from(root.querySelectorAll('p'))
  for (const paragraph of paragraphs) {
    const text = paragraph.textContent ?? ''
    const placeholder = /^DHS_FN_DEF\s+(\S+)\s+([\s\S]*?)\s+DHS_FN_DEF_END$/.exec(text)
    const standard = /^\[\^([^\]]+)\]:\s*([\s\S]*)$/.exec(text)
    const malformed = /^\[(\d+):\]\(#fnref-\1\)\s*([\s\S]*)$/.exec(text)
    const match = placeholder ?? standard ?? malformed
    if (match === null) continue
    const id = match[1] ?? '1'
    const div = doc.createElement('div')
    div.setAttribute('data-footnote-def', '')
    div.setAttribute('data-footnote-def-id', id)
    const label = doc.createElement('span')
    label.className = 'footnote-def-id'
    label.textContent = id + ':'
    const content = doc.createElement('div')
    content.className = 'footnote-def-content'
    if (placeholder !== null) {
      content.innerHTML = paragraph.innerHTML
        .replace(/^DHS_FN_DEF\s+\S+\s+/, '')
        .replace(/\s+DHS_FN_DEF_END$/, '')
    } else {
      const prefixPattern = standard === null ? /^\[\d+:\]\(#fnref-\d+\)\s*/ : /^\[\^[^\]]+\]:\s*/
      content.innerHTML = paragraph.innerHTML.replace(prefixPattern, '')
    }
    div.appendChild(label)
    div.appendChild(content)
    paragraph.replaceWith(div)
  }
  cleanFootnoteHeadings(root)
}

/** 把 `[^id]: ...` 定义行替换成 markdown-it 不会当作 link reference definition 的安全占位符。 */
function protectFootnoteDefinitions(source: string): string {
  return source.split(/\r?\n/u).map(line => {
    const match = /^(\s*)\[\^([^\]]+)\]:\s*(.*)$/u.exec(line)
    if (match === null) return line
    const indent = match[1] ?? ''
    const id = match[2] ?? ''
    const content = match[3] ?? ''
    return `${indent}DHS_FN_DEF ${id} ${content} DHS_FN_DEF_END`
  }).join('\n')
}

/** 清理历史遗留的多个 `## 脚注` 标题：有脚注定义时只保留一个，并放到第一条例定义前。 */
function cleanFootnoteHeadings(root: HTMLElement): void {
  const doc = root.ownerDocument
  if (doc === null) return
  const definitions = Array.from(root.querySelectorAll('[data-footnote-def]'))
  if (definitions.length === 0) return
  for (const heading of Array.from(root.querySelectorAll('h2'))) {
    if ((heading.textContent ?? '').trim() === '脚注') heading.remove()
  }
  const heading = doc.createElement('h2')
  heading.textContent = '脚注'
  const firstDefinition = definitions[0]
  if (firstDefinition === undefined) return
  firstDefinition.parentNode?.insertBefore(heading, firstDefinition)
}
