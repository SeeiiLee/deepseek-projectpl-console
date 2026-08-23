// 安全的 Markdown 渲染器（只读预览用）：标题层级、强调、列表、引用、代码块、表格、任务清单、
// 本地链接与行内公式。
// 产出 React 节点，绝不注入原始 HTML；http(s) 外链新窗口打开，本地路径/锚点/mailto 显示为链接，
// javascript:/data: 等危险协议只保留标签文本。

import type { ReactNode } from 'react'
import { isRemoteImageSrc } from './desktopReveal.ts'

export function renderMarkdownLines(text: string): ReactNode {
  // 编辑器序列化可能把 [^ 转义成 \[^，这里归一化后再识别脚注
  const normalizedText = text.replace(/\\\[/gu, '[').replace(/\\\]/gu, ']')
  const lines = normalizedText.split(/\r?\n/u)
  const elements: ReactNode[] = []
  const footnoteDefs = new Map<string, string>()
  for (const line of lines) {
    const def = /^\s*\[\^([^\]]+)\]:\s+(.*)$/u.exec(line)
    if (def !== null) footnoteDefs.set(def[1] ?? '', def[2] ?? '')
  }
  let index = 0

  const push = (node: ReactNode): void => { elements.push(node) }

  while (index < lines.length) {
    const line = lines[index] ?? ''

    // 代码块 ```lang ... ```
    if (/^\s*```/u.test(line)) {
      const language = /^\s*```([\w.+#-]*)/u.exec(line)?.[1] ?? ''
      const buffer: string[] = []
      index += 1
      while (index < lines.length && !/^\s*```/u.test(lines[index] ?? '')) {
        buffer.push(lines[index] ?? '')
        index += 1
      }
      index += 1
      push(
        <pre key={'code' + String(elements.length)} className="md-code-block">
          {language !== '' && <span className="md-code-lang">{language}</span>}
          <code>{buffer.join('\n')}</code>
        </pre>,
      )
      continue
    }

    // 水平线
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/u.test(line)) {
      push(<hr key={'hr' + String(elements.length)} className="md-hr" />)
      index += 1
      continue
    }

    // 标题（保留层级，CSS 按层级给字号）
    const heading = /^(#{1,6})\s+(.*)$/u.exec(line)
    if (heading !== null) {
      const level = Math.min(4, (heading[1] ?? '').length)
      const contentText = (heading[2] ?? '').trim()
      // 脚注区标题由文末统一生成；正文里的多个 `## 脚注` 不再重复渲染成标题。
      if (contentText === '脚注' && footnoteDefs.size > 0) {
        index += 1
        continue
      }
      const HeadingTag = ('h' + String(level)) as 'h1'
      push(<HeadingTag key={'h' + String(elements.length)}>{renderInline(contentText)}</HeadingTag>)
      index += 1
      continue
    }

    // 脚注定义行：不渲染在正文，统一放到文末脚注区
    if (/^\s*\[\^[^\]]+\]:\s+/u.test(line)) {
      index += 1
      continue
    }

    // 旧版 NodeView 误序列化产生的 `[1:](#fnref-1) 11111` 行：当作脚注定义收集，不在正文重复显示。
    const malformedDef = /^\s*\[(\d+):\]\(#fnref-\1\)\s+(.*)$/u.exec(line)
    if (malformedDef !== null) {
      footnoteDefs.set(malformedDef[1] ?? '', malformedDef[2] ?? '')
      index += 1
      continue
    }

    // 引用块（连续 > 行合并）
    if (/^>\s?/u.test(line)) {
      const quoted: string[] = []
      while (index < lines.length && /^>\s?/u.test(lines[index] ?? '')) {
        quoted.push((lines[index] ?? '').replace(/^>\s?/u, ''))
        index += 1
      }
      push(
        <blockquote key={'q' + String(elements.length)} className="md-quote">
          {quoted.map((quoteLine, quoteIndex) => <p key={quoteIndex}>{renderInline(quoteLine)}</p>)}
        </blockquote>,
      )
      continue
    }

    // 任务清单 - [ ] / - [x]
    const task = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/u.exec(line)
    if (task !== null) {
      const items: ReactNode[] = []
      while (index < lines.length) {
        const taskLine = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/u.exec(lines[index] ?? '')
        if (taskLine === null) break
        const checked = (taskLine[1] ?? ' ').toLowerCase() === 'x'
        items.push(
          <li key={index} className="md-task" data-checked={checked || undefined}>
            <span className="md-task-mark" aria-hidden="true">{checked ? '☑' : '☐'}</span>
            <span>{renderInline((taskLine[2] ?? '').trim())}</span>
          </li>,
        )
        index += 1
      }
      push(<ul key={'t' + String(elements.length)} className="md-task-list">{items}</ul>)
      continue
    }

    // 无序列表
    if (/^\s*[-*+]\s+/u.test(line)) {
      const items: ReactNode[] = []
      while (index < lines.length && /^\s*[-*+]\s+/u.test(lines[index] ?? '')) {
        items.push(<li key={index}>{renderInline((lines[index] ?? '').replace(/^\s*[-*+]\s+/u, ''))}</li>)
        index += 1
      }
      push(<ul key={'ul' + String(elements.length)} className="md-list">{items}</ul>)
      continue
    }

    // 有序列表
    if (/^\s*\d+[.)]\s+/u.test(line)) {
      const items: ReactNode[] = []
      while (index < lines.length && /^\s*\d+[.)]\s+/u.test(lines[index] ?? '')) {
        items.push(<li key={index}>{renderInline((lines[index] ?? '').replace(/^\s*\d+[.)]\s+/u, ''))}</li>)
        index += 1
      }
      push(<ol key={'ol' + String(elements.length)} className="md-list">{items}</ol>)
      continue
    }

    // 表格（连续的 | 行；第二行为分隔行）
    if (/^\s*\|/u.test(line)) {
      const tableLines: string[] = []
      while (index < lines.length && /^\s*\|/u.test(lines[index] ?? '')) {
        tableLines.push((lines[index] ?? '').trim())
        index += 1
      }
      if (tableLines.length >= 2 && /^\|?[\s:|-]+\|?$/u.test(tableLines[1] ?? '')) {
        const splitRow = (row: string): string[] => row.replace(/^\|/u, '').replace(/\|$/u, '').split('|')
        const headers = splitRow(tableLines[0] ?? '').map(cell => cell.trim())
        const rows = tableLines.slice(2).map((row, rowIndex) => (
          <tr key={rowIndex}>{splitRow(row).map((cell, cellIndex) => <td key={cellIndex}>{renderInline(cell.trim())}</td>)}</tr>
        ))
        push(
          <div key={'table' + String(elements.length)} className="md-table-wrap">
            <table className="md-table">
              <thead><tr>{headers.map((cell, cellIndex) => <th key={cellIndex}>{renderInline(cell)}</th>)}</tr></thead>
              <tbody>{rows}</tbody>
            </table>
          </div>,
        )
        continue
      }
      push(<p key={'p' + String(elements.length)}>{renderInline(line)}</p>)
      continue
    }

    // 空行
    if (line.trim() === '') {
      index += 1
      continue
    }

    // 段落
    push(<p key={'p' + String(elements.length)}>{renderInline(line)}</p>)
    index += 1
  }
  if (footnoteDefs.size > 0) {
    push(
      <section key={'footnotes'} className="footnotes" data-footnotes>
        <h2>脚注</h2>
        {[...footnoteDefs.entries()].map(([id, content]) => (
          <p key={id} id={'fn-' + id} className="footnote-def">
            <a className="footnote-def-link" href={'#fnref-' + id}>{id}:</a>
            {' '}
            {renderInline(content)}
          </p>
        ))}
      </section>,
    )
  }
  return <div className="md-body">{elements}</div>
}

function renderInline(text: string): ReactNode {
  const parts: ReactNode[] = []
  const pattern = /(\$\$[^$\n]+\$\$|\$[^$\n]+\$|!\[[^\]]*\]\((?:<[^)>]+>|[^)\s]+)\)|\*\*[^*\n]+\*\*|`[^`\n]+`|~~[^~\n]+~~|\[\^[^\]]+\]|\[[^\]]+\]\((?:<[^)>]+>|[^)\s]+)\)|\*[^*\n]+\*|_[^_\n]+_)/gu
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index))
    const token = match[0] ?? ''
    if (token.startsWith('$$') && token.endsWith('$$')) {
      parts.push(<span key={String(parts.length)} className="math-inline">{token.slice(2, -2)}</span>)
    } else if (token.startsWith('$') && token.endsWith('$')) {
      parts.push(<span key={String(parts.length)} className="math-inline">{token.slice(1, -1)}</span>)
    } else if (token.startsWith('**') && token.endsWith('**')) {
      parts.push(<strong key={String(parts.length)}>{token.slice(2, -2)}</strong>)
    } else if (token.startsWith('~~') && token.endsWith('~~')) {
      parts.push(<s key={String(parts.length)}>{token.slice(2, -2)}</s>)
    } else if (token.startsWith('`')) {
      parts.push(<code key={String(parts.length)} className="md-inline-code">{token.slice(1, -1)}</code>)
    } else if (token.startsWith('[^') && token.endsWith(']')) {
      const id = token.slice(2, -1)
      parts.push(
        <sup key={String(parts.length)} id={'fnref-' + id} className="footnote-ref">
          <a href={'#fn-' + id}>{id}</a>
        </sup>,
      )
    } else if (token.startsWith('![')) {
      const close = token.indexOf('](')
      const alt = token.slice(2, close)
      const src = token.slice(close + 2, -1).replace(/^<|>$/g, '')
      if (isRemoteImageSrc(src)) {
        parts.push(<img key={String(parts.length)} src={src} alt={alt} className="md-image" />)
      } else {
        // 本地图片不写原始 src：Chromium 会把 F:/x 之类路径重解释成 file:/// 并拦截加载
        // （控制台噪音 + 破图闪烁）。改为 data-local-image 标记，由文档组件的效果
        // 经桌面桥读成 data URL 后补上；失败则显示克制的占位样式而不是破图。
        parts.push(<img key={String(parts.length)} alt={alt} className="md-image md-image-local" data-local-image={src} />)
      }
    } else if (token.startsWith('[')) {
      const open = token.indexOf('](')
      const label = token.slice(1, open)
      const href = token.slice(open + 2, -1).replace(/^<|>$/g, '')
      if (/^https?:\/\//iu.test(href)) {
        parts.push(<a key={String(parts.length)} href={href} target="_blank" rel="noreferrer">{label}</a>)
      } else if (/^(javascript|data):/iu.test(href)) {
        // 危险协议不渲染为可点击链接，仅保留标签文本。
        parts.push(label)
      } else {
        // 本地相对/绝对路径、锚点、mailto 等照常显示为链接。
        parts.push(<a key={String(parts.length)} href={href} className="md-local-link">{label}</a>)
      }
    } else if (token.startsWith('*') || token.startsWith('_')) {
      parts.push(<em key={String(parts.length)}>{token.slice(1, -1)}</em>)
    } else {
      parts.push(token)
    }
    lastIndex = match.index + token.length
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return parts.length === 0 ? text : parts
}
