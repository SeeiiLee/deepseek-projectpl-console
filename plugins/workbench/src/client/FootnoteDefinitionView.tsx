/**
 * R-ED Phase 2：脚注定义 NodeView。
 * 用 React 渲染 `1: 内容`，内容区可编辑；序列化仍由节点 markdown 规则输出 `[^1]: 内容`。
 */
import type { ReactNode } from 'react'
import { NodeViewContent, NodeViewWrapper } from '@tiptap/react'

export function FootnoteDefinitionView(props: { node: { attrs: Record<string, unknown> } }): ReactNode {
  const id = props.node.attrs.id ?? 1
  return (
    <NodeViewWrapper className="footnote-def" data-footnote-def>
      <a className="footnote-def-link" href={'#fnref-' + String(id)}>{String(id)}:</a>
      <NodeViewContent className="footnote-def-content" />
    </NodeViewWrapper>
  )
}
