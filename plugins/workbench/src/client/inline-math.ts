/**
 * R-ED Phase 2：行内公式 mark。
 * 编辑态用 span[data-math] 渲染，序列化为 Markdown 行内公式 `$...$`。
 * 真正的 KaTeX 渲染可在预览层/后续版本接入。
 */
import { Mark, mergeAttributes } from '@tiptap/core'

export interface InlineMathStorage {
  markdown: {
    serialize: { open: string; close: string; mixable: boolean }
  }
}

export const InlineMath = Mark.create({
  name: 'inlineMath',

  parseHTML() {
    return [{ tag: 'span[data-math]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-math': '', class: 'math-inline' }), 0]
  },

  addStorage(): InlineMathStorage {
    return {
      markdown: {
        serialize: { open: '$', close: '$', mixable: false },
      },
    }
  },
})
