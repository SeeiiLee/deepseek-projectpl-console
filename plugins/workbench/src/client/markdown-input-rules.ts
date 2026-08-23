/**
 * R-ED Phase 1：补充 Markdown 原生快捷键输入规则。
 * StarterKit 已覆盖带空格的标题、无序/有序列表；这里补：
 * - 无空格标题：`#1` / `##2` / `###3`
 * - 无空格无序列表：`-1`
 * - 引用、代码块、分割线（如已生效也保留，幂等）。
 */
import { Extension, InputRule, markInputRule, nodeInputRule, wrappingInputRule } from '@tiptap/core'

export const MarkdownInputRules = Extension.create({
  name: 'markdownInputRules',

  addInputRules() {
    const schema = this.editor.schema
    return [
      // 无空格标题：#1 -> H1「1」，##2 -> H2「2」
      // 只有 # 后面紧跟非 # 非空白字符时才触发，避免输入 ## / ### 时被提前转换
      new InputRule({
        find: /^(#{1,6})(?=[^#\s])/u,
        handler: ({ state, range, match }) => {
          const hashes = match[1]
          if (hashes === undefined) return
          const content = state.doc.textBetween(range.from + hashes.length, range.to, '\n')
          const level = hashes.length
          const headingType = schema.nodes.heading
          if (headingType === undefined) return
          state.tr
            .delete(range.from, range.to)
            .replaceWith(range.from, range.from, headingType.create({ level }, schema.text(content)))
        },
      }),
      // 无空格无序列表：-1 -> 无序列表项「1」
      new InputRule({
        find: /^(\s*)([-*+])(?=\S)/u,
        handler: ({ state, range, match, commands }) => {
          const marker = match[2]
          if (marker === undefined) return
          state.tr.delete(range.from, range.from + marker.length)
          commands.toggleBulletList()
        },
      }),
      markInputRule({ find: /\$([^$\s][^$]*?)\$$/u, type: schema.marks.inlineMath! }),
      wrappingInputRule({ find: /^\s*>\s$/u, type: schema.nodes.blockquote! }),
      nodeInputRule({ find: /^```$/u, type: schema.nodes.codeBlock! }),
      nodeInputRule({ find: /^(?:---|\*\*\*|___)\s$/u, type: schema.nodes.horizontalRule! }),
    ]
  },
})
