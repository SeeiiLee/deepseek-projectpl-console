/**
 * R-ED Phase 2/Wolai：图片节点。
 * 块级 atom，编辑器内显示 `<img>`，序列化为标准 Markdown `![alt](src)`。
 * 依赖 tiptap-markdown 的 parseHTML 从 `<img>` 还原。
 * 序列化统一写真实路径（dataPath 优先），并解码 %20 保持可读；
 * 路径含空白/括号/尖括号时用 <...> 包裹。
 */
import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { canonicalLocalPath } from './desktopReveal.ts'
import { wrapMarkdownDestination } from './file-attachment.ts'
import { ImageView } from './ImageView.tsx'

export const Image = Node.create({
  name: 'image',

  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      src: { default: '' },
      alt: { default: '' },
      title: { default: null },
      /** 本地文件真实路径/相对路径，用于序列化；src 可能是临时 objectURL。 */
      dataPath: { default: null },
      /** 图片容器宽度（编辑器内可拖拽调整，视觉用；Markdown 不持久化宽度）。 */
      width: { default: null },
    }
  },

  parseHTML() {
    return [{
      tag: 'img[src]',
      getAttrs: (el: HTMLElement | string) => {
        if (typeof el === 'string') return {}
        const src = el.getAttribute('src') ?? ''
        return {
          src,
          alt: el.getAttribute('alt') ?? '',
          title: el.getAttribute('title'),
          // 让 Markdown 图片重新进入编辑器时也能按本地路径读取显示。
          dataPath: el.getAttribute('data-path') ?? src,
        }
      },
    }]
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      'img',
      mergeAttributes(HTMLAttributes, {
        src: node.attrs.src,
        alt: node.attrs.alt ?? '',
        ...(node.attrs.title == null ? {} : { title: node.attrs.title }),
        ...(node.attrs.dataPath == null ? {} : { 'data-path': node.attrs.dataPath }),
      }),
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageView)
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: { write(text: string): void; closeBlock(node: unknown): void }, node: { attrs: { src: string; alt: string; title?: string | null; dataPath?: string | null } }): void {
          const title = node.attrs.title == null ? '' : ` "${String(node.attrs.title)}"`
          const rawHref = node.attrs.dataPath ?? node.attrs.src ?? ''
          // 写盘用真实路径并解码 %20、统一正斜杠；含空白/括号时 <...> 包裹，保证下次解析不碎。
          const href = canonicalLocalPath(rawHref)
          const alt = String(node.attrs.alt ?? '').replace(/([\[\]])/gu, '\\$1')
          state.write(`![${alt}](${wrapMarkdownDestination(href)}${title})`)
          state.closeBlock(node)
        },
      },
    }
  },
})
