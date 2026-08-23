/**
 * R-ED Wolai：文件/附件块节点。
 * 编辑器内显示为带链接的文件卡片，序列化为 Markdown 链接；
 * 路径含空白/括号/尖括号时用 `<...>` 包裹，避免 Markdown 解析错乱。
 * 反序列化只把「独占一个段落的本地链接」还原为卡片，句子里的行内本地链接保持普通链接，
 * 避免块节点被从段落/列表中撕裂导致文档结构漂移。
 */
import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { canonicalLocalPath } from './desktopReveal.ts'
import { FileAttachmentView } from './FileAttachmentView.tsx'

/** Markdown 链接文本里转义方括号，避免文件名里的 [] 破坏链接语法。 */
function escapeLinkText(text: string): string {
  return text.replace(/([\[\]])/gu, '\\$1')
}

/** 本地路径写进 Markdown 目标位置：含空白/括号/尖括号时用 <...> 包裹。 */
export function wrapMarkdownDestination(href: string): string {
  return /[\s()<>]/u.test(href) ? `<${href}>` : href
}

export const FileAttachment = Node.create({
  name: 'fileAttachment',

  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      name: { default: '' },
      href: { default: '' },
    }
  },

  parseHTML() {
    return [{
      tag: 'div[data-file-attachment]',
      getAttrs: (el: HTMLElement | string) => {
        if (typeof el === 'string') return {}
        return {
          name: el.getAttribute('data-file-name') ?? '',
          href: el.getAttribute('data-file-href') ?? '',
        }
      },
    }]
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-file-attachment': '',
        'data-file-name': node.attrs.name,
        'data-file-href': node.attrs.href,
        class: 'file-attachment',
      }),
      ['span', { class: 'file-attachment-icon' }, '📎'],
      ['a', { href: node.attrs.href, class: 'file-attachment-link' }, node.attrs.name],
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(FileAttachmentView)
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: { write(text: string): void; closeBlock(node: unknown): void }, node: { attrs: { name: string; href: string } }): void {
          const name = escapeLinkText(node.attrs.name || '文件')
          // 写盘前解码 %20、统一正斜杠，保持 Markdown 人类可读、多次保存不漂移。
          const href = canonicalLocalPath(node.attrs.href || './path')
          state.write(`[${name}](${wrapMarkdownDestination(href)})`)
          state.closeBlock(node)
        },
        parse: {
          updateDOM(element: HTMLElement) {
            convertLocalLinksToFileAttachments(element)
          },
        },
      },
    }
  },
})

/**
 * 把「独占一个段落的 Markdown 本地文件链接」（非 http/mailto/锚点）转换回文件附件块节点。
 * 行内出现的本地链接（句子里、列表项里）保持原样，由链接点击逻辑负责打开。
 */
function convertLocalLinksToFileAttachments(root: HTMLElement): void {
  const doc = root.ownerDocument
  if (doc === null) return
  for (const anchor of Array.from(root.querySelectorAll('a[href]'))) {
    const href = anchor.getAttribute('href') ?? ''
    if (/^(https?:|mailto:|#|javascript:)/iu.test(href)) continue
    const parent = anchor.parentElement
    if (parent === null || parent.tagName !== 'P') continue
    const siblings = Array.from(parent.childNodes).filter(node =>
      node.nodeType === 1 || (node.textContent ?? '').trim() !== '',
    )
    if (siblings.length !== 1 || siblings[0] !== anchor) continue
    const name = anchor.textContent ?? '文件'
    const div = doc.createElement('div')
    div.setAttribute('data-file-attachment', '')
    div.setAttribute('data-file-name', name)
    div.setAttribute('data-file-href', href)
    anchor.replaceWith(div)
  }
}
