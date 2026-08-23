export interface DiffLine {
  kind: 'same' | 'added' | 'removed'
  text: string
}

export interface DiffHunk {
  /** 旧侧起始行（1 起）。 */
  oldStart: number
  /** 新侧起始行（1 起）。 */
  newStart: number
  lines: readonly NumberedDiffLine[]
}

export interface NumberedDiffLine extends DiffLine {
  /** 旧侧行号（纯新增为 null）。 */
  oldNum: number | null
  /** 新侧行号（纯删除为 null）。 */
  newNum: number | null
}

/** 超过该总行数退化为「公共前后缀 + 中段整换」，保证有界（不做 O(ND) 追踪）。 */
const MAX_Myers_LINES = 20_000

/**
 * 行级 diff（Myers O(ND) 最短编辑脚本）。输出形状保持 { kind, text }
 * 纯数据，兼容既有调用方与测试；行号由 buildHunks 步行计算。
 */
export function diffLines(left: readonly string[], right: readonly string[]): readonly DiffLine[] {
  if (left.length + right.length > MAX_Myers_LINES) return coarseDiff(left, right)
  return myersDiff(left, right)
}

function myersDiff(a: readonly string[], b: readonly string[]): readonly DiffLine[] {
  const n = a.length
  const m = b.length
  if (n === 0) return b.map(text => ({ kind: 'added' as const, text }))
  if (m === 0) return a.map(text => ({ kind: 'removed' as const, text }))
  const max = n + m
  const offset = max
  let v = new Array<number>(2 * max + 1).fill(0)
  const trace: number[][] = []
  let found = -1
  for (let d = 0; d <= max; d += 1) {
    trace.push(v)
    for (let k = -d; k <= d; k += 2) {
      const goDown = k === -d || (k !== d && (v[k - 1 + offset] ?? 0) < (v[k + 1 + offset] ?? 0))
      let x = goDown ? (v[k + 1 + offset] ?? 0) : (v[k - 1 + offset] ?? 0) + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) { x += 1; y += 1 }
      v[k + offset] = x
      if (x >= n && y >= m) { found = d; break }
    }
    if (found >= 0) break
    v = [...v]
  }
  // 回溯：从 (n, m) 走回 (0, 0)。
  const result: DiffLine[] = []
  let x = n
  let y = m
  for (let d = found; d > 0; d -= 1) {
    const previous = trace[d - 1] ?? []
    const k = x - y
    const goDown = k === -d || (k !== d && (previous[k - 1 + offset] ?? 0) < (previous[k + 1 + offset] ?? 0))
    const prevX = goDown ? (previous[k + 1 + offset] ?? 0) : (previous[k - 1 + offset] ?? 0) + 1
    const prevY = prevX - (goDown ? k + 1 : k - 1)
    while (x > prevX && y > prevY) {
      result.push({ kind: 'same', text: a[x - 1] ?? '' })
      x -= 1
      y -= 1
    }
    if (goDown) {
      result.push({ kind: 'added', text: b[y - 1] ?? '' })
      y -= 1
    } else {
      result.push({ kind: 'removed', text: a[x - 1] ?? '' })
      x -= 1
    }
  }
  while (x > 0 && y > 0) { result.push({ kind: 'same', text: a[x - 1] ?? '' }); x -= 1; y -= 1 }
  while (x > 0) { result.push({ kind: 'removed', text: a[x - 1] ?? '' }); x -= 1 }
  while (y > 0) { result.push({ kind: 'added', text: b[y - 1] ?? '' }); y -= 1 }
  return result.reverse()
}

/** 大输入退化：公共前后缀对齐，中段整段删除+新增。 */
function coarseDiff(a: readonly string[], b: readonly string[]): readonly DiffLine[] {
  let prefix = 0
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix += 1
  let suffix = 0
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix += 1
  const result: DiffLine[] = []
  for (let i = 0; i < prefix; i += 1) result.push({ kind: 'same', text: a[i] ?? '' })
  for (let i = prefix; i < a.length - suffix; i += 1) result.push({ kind: 'removed', text: a[i] ?? '' })
  for (let j = prefix; j < b.length - suffix; j += 1) result.push({ kind: 'added', text: b[j] ?? '' })
  for (let i = a.length - suffix; i < a.length; i += 1) result.push({ kind: 'same', text: a[i] ?? '' })
  return result
}

/**
 * 把扁平 diff 折叠为 hunk（上下文 contextLines 行；纯相同的长段不进 hunk）。
 * 行号在步行时计算：same 双侧递增，removed 仅旧侧，added 仅新侧。
 * 全部相同（无改动）返回空数组。
 */
export function buildHunks(lines: readonly DiffLine[], contextLines = 3): readonly DiffHunk[] {
  const numbered: NumberedDiffLine[] = []
  let oldNum = 1
  let newNum = 1
  for (const line of lines) {
    if (line.kind === 'same') {
      numbered.push({ ...line, oldNum, newNum })
      oldNum += 1
      newNum += 1
    } else if (line.kind === 'removed') {
      numbered.push({ ...line, oldNum, newNum: null })
      oldNum += 1
    } else {
      numbered.push({ ...line, oldNum: null, newNum })
      newNum += 1
    }
  }
  // 标记保留窗口：每个变更行前后 contextLines 行。
  const keep = new Array<boolean>(numbered.length).fill(false)
  numbered.forEach((line, index) => {
    if (line.kind === 'same') return
    const from = Math.max(0, index - contextLines)
    const to = Math.min(numbered.length - 1, index + contextLines)
    for (let i = from; i <= to; i += 1) keep[i] = true
  })
  const hunks: DiffHunk[] = []
  let current: NumberedDiffLine[] = []
  const flush = (): void => {
    if (current.length === 0) return
    const first = current[0]
    if (first !== undefined) {
      hunks.push({
        oldStart: first.oldNum ?? first.newNum ?? 1,
        newStart: first.newNum ?? first.oldNum ?? 1,
        lines: current,
      })
    }
    current = []
  }
  numbered.forEach((line, index) => {
    if (keep[index] === true) current.push(line)
    else flush()
  })
  flush()
  return hunks
}

export function isWorkspaceDiffResourceKey(value: unknown): value is string {
  if (typeof value !== 'string' || !value.startsWith('workspace-diff:')) return false
  const body = value.slice('workspace-diff:'.length)
  // 裸前缀 'workspace-diff:' 是合法落地态：查看器渲染「先选左文件、再选右文件」两步选择器。
  if (body === '') return true
  const separator = body.indexOf('|')
  // 只有左文件（无分隔符）也是合法中间态：查看器渲染右侧选择器。
  if (separator === -1) return !body.includes('\u0000') && body.trim() !== ''
  return separator > 0 && separator < body.length - 1
}
