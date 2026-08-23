/**
 * R-ED 浮动工具栏 / 围栏自动补全的纯逻辑（无 JSX，Node 可单测）。
 */

/** ``` 围栏自动补全核心（纯函数）：
 * 在 ```lang 行按回车 → 自动补闭合围栏 + 空行，光标落在两栏之间。 */
export function fenceAutoCloseInsert(lineText: string): { insert: string; anchor: number } | null {
  const match = /^(\s*)`{3}[a-zA-Z+]*$/.exec(lineText)
  if (match === null) return null
  const indent = match[1] ?? ''
  return { insert: '\n' + indent + '```\n', anchor: 1 }
}
