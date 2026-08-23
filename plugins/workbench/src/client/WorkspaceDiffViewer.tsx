import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { WorkbenchTabDescriptor } from './contracts.ts'
import { getActiveWorkbench } from './index.ts'
import { createWorkspaceApi } from './workspaceApi.ts'
import { buildHunks, diffLines, type DiffHunk } from './workspace-diff.ts'
import css from './WorkspaceViewers.module.css'

export { buildHunks, diffLines, isWorkspaceDiffResourceKey } from './workspace-diff.ts'
export type { DiffHunk, DiffLine, NumberedDiffLine } from './workspace-diff.ts'

const api = createWorkspaceApi()

/** 扁平渲染行数上限：超过则头/尾各半 + 中间展开按钮（参考 VSCode/参考仓库做法）。 */
const MAX_DIFF_ROWS = 500

/**
 * P8 Diff viewer 升级版：工作区两文件对比，Myers diff → hunk 化渲染
 * （@@ 头 + 左右行号 gutter + 未变区域不进 hunk）；resourceKey 缺右文件
 * 时提供按文件名搜索的选择入口。
 */
export function WorkspaceDiffViewer({ descriptor }: { descriptor: WorkbenchTabDescriptor }): ReactNode {
  const rawKey = descriptor.resourceKey ?? ''
  const body = rawKey.startsWith('workspace-diff:') ? rawKey.slice('workspace-diff:'.length) : ''
  const separator = body.indexOf('|')
  const leftPath = separator > 0 ? body.slice(0, separator) : (separator === -1 ? body : '')
  const [rightPath, setRightPath] = useState(separator > 0 ? body.slice(separator + 1) : '')
  const [hunks, setHunks] = useState<readonly DiffHunk[]>()
  const [identical, setIdentical] = useState(false)
  const [error, setError] = useState<string>()
  const workbench = getActiveWorkbench()

  /** 落地页/左文件选定：写回 resourceKey 持久化（重启后恢复到同一步骤）。 */
  const pickLeft = (path: string): void => {
    setRightPath('')
    workbench?.updateTab(descriptor.id, { resourceKey: 'workspace-diff:' + path, title: '审阅' })
  }
  const pickRight = (path: string): void => {
    setRightPath(path)
    workbench?.updateTab(descriptor.id, { resourceKey: 'workspace-diff:' + leftPath + '|' + path, title: '审阅' })
  }

  useEffect(() => {
    if (leftPath === '' || rightPath === '') {
      setHunks(undefined)
      setIdentical(false)
      return
    }
    const controller = new AbortController()
    Promise.all([api.file(leftPath, controller.signal), api.file(rightPath, controller.signal)])
      .then(([left, right]) => {
        if (controller.signal.aborted) return
        if (left.kind !== 'text' || right.kind !== 'text') {
          setError('Diff 只支持文本文件。')
          return
        }
        const lines = diffLines(left.content.split(/\r?\n/u), right.content.split(/\r?\n/u))
        setError(undefined)
        setIdentical(lines.every(line => line.kind === 'same'))
        setHunks(buildHunks(lines))
      })
      .catch(loadError => {
        if (!controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : 'Diff 读取失败。')
      })
    return () => { controller.abort() }
  }, [leftPath, rightPath])

  const counts = useMemo(() => {
    const list = hunks ?? []
    let added = 0
    let removed = 0
    for (const hunk of list) {
      for (const line of hunk.lines) {
        if (line.kind === 'added') added += 1
        else if (line.kind === 'removed') removed += 1
      }
    }
    return { added, removed }
  }, [hunks])

  return (
    <div className={css.diff} data-personal-workbench-diff data-workspace-viewer="diff">
      <div className={css.viewerHeader}>
        <strong>Diff</strong>
        <span>{'−' + String(counts.removed) + ' ＋' + String(counts.added)}</span>
      </div>
      {error !== undefined && <p className={css.viewerNotice} role="alert">{error}</p>}
      {leftPath === '' && (
        <DiffTargetPicker leftPath="" heading="选择左侧（旧）文件开始审阅：" onPick={pickLeft} />
      )}
      {leftPath !== '' && rightPath === '' && error === undefined && (
        <DiffTargetPicker leftPath={leftPath} onPick={pickRight} />
      )}
      {leftPath !== '' && rightPath !== '' && hunks === undefined && error === undefined && (
        <p className={css.viewerNotice} role="status">比较中…</p>
      )}
      {identical && <p className={css.viewerNotice}>两个文件内容相同。</p>}
      {hunks !== undefined && hunks.length > 0 && <DiffBody hunks={hunks} />}
    </div>
  )
}

/** 对比目标选择：按文件名搜索工作区，点击选定文件；leftPath 为空时是落地第一步。 */
function DiffTargetPicker({ leftPath, onPick, heading }: { leftPath: string; onPick: (path: string) => void; heading?: string }): ReactNode {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<readonly { path: string; name: string }[]>([])
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed === '') {
      setResults([])
      return
    }
    const controller = new AbortController()
    setSearching(true)
    api.search(trimmed, controller.signal)
      .then(found => {
        if (controller.signal.aborted) return
        setResults(found.results.filter(entry => entry.path !== leftPath).slice(0, 20))
        setSearching(false)
      })
      .catch(() => { if (!controller.signal.aborted) setSearching(false) })
    return () => { controller.abort() }
  }, [query, leftPath])

  return (
    <div data-diff-picker>
      <p className={css.viewerNotice}>{heading ?? (<>选择要与 <strong>{leftPath}</strong> 对比的文件：</>)}</p>
      <div className={css.diffPickRow}>
        <input
          type="text"
          placeholder="按文件名搜索…"
          value={query}
          autoFocus
          onChange={event => { setQuery(event.target.value) }}
        />
      </div>
      {searching && <p className={css.viewerNotice} role="status">搜索中…</p>}
      {results.length > 0 && (
        <ul className={css.diffPickList}>
          {results.map(entry => (
            <li key={entry.path}>
              <button type="button" data-diff-pick={entry.path} onClick={() => { onPick(entry.path) }}>{entry.path}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** hunk 列表渲染：@@ 头 + 双侧行号 + 增删配色；超上限头/尾折叠。 */
function DiffBody({ hunks }: { hunks: readonly DiffHunk[] }): ReactNode {
  const [expanded, setExpanded] = useState(false)
  const rows = useMemo(() => {
    const out: Array<{ key: string; hunk?: DiffHunk; type: 'hunk' | 'line'; line?: DiffHunk['lines'][number] }> = []
    hunks.forEach((hunk, hunkIndex) => {
      out.push({ key: `h${String(hunkIndex)}`, type: 'hunk', hunk })
      hunk.lines.forEach((line, lineIndex) => {
        out.push({ key: `h${String(hunkIndex)}l${String(lineIndex)}`, type: 'line', line })
      })
    })
    return out
  }, [hunks])

  const hidden = rows.length - MAX_DIFF_ROWS
  const capped = hidden > 0 && !expanded
  const headCount = Math.ceil(MAX_DIFF_ROWS / 2)
  const head = capped ? rows.slice(0, headCount) : rows
  const tail = capped ? rows.slice(rows.length - (MAX_DIFF_ROWS - headCount)) : []

  const renderRow = (row: (typeof rows)[number]): ReactNode => {
    if (row.type === 'hunk') {
      const hunk = row.hunk
      const oldCount = hunk?.lines.filter(line => line.oldNum !== null).length ?? 0
      const newCount = hunk?.lines.filter(line => line.newNum !== null).length ?? 0
      return (
        <div key={row.key} className={css.diffHunkHeader} data-diff-hunk>
          {'@@ -'}{String(hunk?.oldStart ?? 0)},{String(oldCount)}{' +'}{String(hunk?.newStart ?? 0)},{String(newCount)}{' @@'}
        </div>
      )
    }
    const line = row.line
    return (
      <div key={row.key} className={css.diffLine} data-diff={line?.kind ?? 'same'}>
        <span className={css.diffNum}>{line?.oldNum ?? ''}</span>
        <span className={css.diffNum}>{line?.newNum ?? ''}</span>
        <span className={css.diffCode}>{(line?.kind === 'added' ? '+' : line?.kind === 'removed' ? '-' : ' ') + (line?.text ?? '')}</span>
      </div>
    )
  }

  return (
    <pre className={css.diffBody} data-diff-body>
      {head.map(renderRow)}
      {hidden > 0 && (
        <button type="button" className={css.diffExpand} aria-expanded={expanded} onClick={() => { setExpanded(value => !value) }}>
          {expanded ? '收起' : `展开隐藏的 ${String(hidden)} 行`}
        </button>
      )}
      {tail.map(renderRow)}
    </pre>
  )
}
