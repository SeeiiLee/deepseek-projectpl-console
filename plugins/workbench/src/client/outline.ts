export interface OutlineHeading {
  level: number
  text: string
  line: number
  /** 符号种类（代码文件）：function/class/method/variable；Markdown 为 heading。 */
  kind?: 'heading' | 'class' | 'function' | 'method' | 'variable'
}

/** 代码文件扩展名 → 符号提取器。启发式（无 LSP），覆盖主流语言即可。 */
const CODE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'go', 'rs', 'java', 'kt',
  'c', 'h', 'cpp', 'hpp', 'cs', 'rb', 'php', 'swift', 'vue', 'svelte',
])

/**
 * 大纲提取（纯函数，可单测）：
 * - Markdown / 未识别类型：扫描 `#` 标题，但跳过围栏代码块（``` 与 ~~~）内的行；
 * - 代码文件（按扩展名）：启发式提取 class/function/method/variable 符号，
 *   level 1 = class/顶层符号，2 = 方法/嵌套符号（按缩进推断）。
 */
export function extractOutline(text: string, path?: string): readonly OutlineHeading[] {
  const extension = path === undefined ? '' : extensionOf(path)
  if (extension !== '' && CODE_EXTENSIONS.has(extension)) return extractCodeSymbols(text)
  return extractMarkdownHeadings(text)
}

function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase()
}

/** Markdown：标题扫描 + 围栏跳过（```/~~~，可带语言标识；缩进至多 3 空格）。 */
export function extractMarkdownHeadings(text: string): readonly OutlineHeading[] {
  const headings: OutlineHeading[] = []
  let fence: string | undefined
  for (const [index, line] of text.split(/\r?\n/u).entries()) {
    const fenceMatch = /^ {0,3}(```+|~~~+)/u.exec(line)
    if (fenceMatch !== null) {
      const marker = fenceMatch[1] ?? ''
      if (fence === undefined) fence = marker[0]
      else if (marker.startsWith(fence)) fence = undefined
      continue
    }
    if (fence !== undefined) continue
    const match = /^(#{1,6})\s+(.+)$/u.exec(line)
    if (match !== null) {
      headings.push({ level: match[1]?.length ?? 1, text: match[2] ?? '', line: index + 1, kind: 'heading' })
    }
  }
  return headings
}

const KEYWORD_BLOCKLIST = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'else', 'do'])

const SYMBOL_PATTERNS: ReadonlyArray<{ kind: NonNullable<OutlineHeading['kind']>; pattern: RegExp }> = [
  // class/interface/enum/struct/trait（可带 export/default/abstract 前缀）
  { kind: 'class', pattern: /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?(?:class|interface|enum|struct|trait)\s+([A-Za-z_$][\w$]*)/u },
  // function/def/func/fn 命名函数
  { kind: 'function', pattern: /^\s*(?:export\s+)?(?:async\s+)?(?:function\*?\s+|def\s+|func\s+|fn\s+)([A-Za-z_$][\w$]*)/u },
  // const/let/var 命名（值是函数或对象也常是要找的结构）
  { kind: 'variable', pattern: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/u },
  // 缩进的方法定义（TS/Java/C# 风格：name(...) { 或 name(...): T {）
  { kind: 'method', pattern: /^[ \t]+(?:async\s+)?(?:(?:public|private|protected|static|readonly|override)\s+)*([A-Za-z_$][\w$]*)\s*\([^;]*\)\s*[:{]/u },
]

/** 代码符号启发式提取：顶层符号 level 1，缩进的方法/嵌套符号 level 2。 */
export function extractCodeSymbols(text: string): readonly OutlineHeading[] {
  const symbols: OutlineHeading[] = []
  for (const [index, line] of text.split(/\r?\n/u).entries()) {
    const trimmed = line.trimStart()
    if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue
    for (const { kind, pattern } of SYMBOL_PATTERNS) {
      const match = pattern.exec(line)
      if (match === null) continue
      const name = match[1] ?? ''
      if (name === '' || KEYWORD_BLOCKLIST.has(name)) continue
      const indent = /^[\t ]*/u.exec(line)?.[0].length ?? 0
      const level = kind === 'method' || indent > 0 ? 2 : 1
      symbols.push({ level, text: name, line: index + 1, kind })
      break
    }
  }
  return symbols
}
