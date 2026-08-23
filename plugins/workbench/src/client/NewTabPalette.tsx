/**
 * R-UX 新建页签面板（Codex 风格）：页签栏「＋」或快捷键唤出的居中浮层。
 * 菜单态四行（审阅 / 终端 / 浏览器 / 文件，各带快捷键徽章）；
 * 文件态退化为快速打开（搜索工作区文件，Enter/点击开页签）。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { openWorkbenchIntent, openWorkspaceFile } from './index.ts'
import { useWorkspaceApi, type WorkspaceSearchResult } from './workspaceApi.ts'
import css from './WorkbenchPanel.module.css'

export type NewTabPaletteMode = 'menu' | 'files'

/** 菜单动作（键盘快捷键与「＋」菜单共用）。 */
export type NewTabAction = 'diff' | 'terminal' | 'browser'

/** 直接打开某类新页签（快捷键走这里，不经过浮层）。 */
export function openNewTabAction(action: NewTabAction): void {
  if (action === 'diff') {
    openWorkbenchIntent({ family: 'diff', viewerId: 'workbench.workspace-diff', resourceKey: 'workspace-diff:', title: '审阅' })
  } else if (action === 'terminal') {
    openWorkbenchIntent({ family: 'terminal', viewerId: 'workbench.session-terminal', title: '终端' })
  } else {
    openWorkbenchIntent({ family: 'browser', viewerId: 'workbench.workspace-browser', title: '浏览器' })
  }
}

const MENU_ITEMS: ReadonlyArray<{
  key: NewTabAction | 'files'
  label: string
  shortcut: string
  hint: string
  icon: ReactNode
}> = [
  {
    key: 'diff',
    label: '审阅',
    shortcut: 'Ctrl+Shift+G',
    hint: '对比两个工作区文件',
    icon: (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M4 2.5h5l3 3V13a.5.5 0 0 1-.5.5h-7A.5.5 0 0 1 4 13Z" />
        <path d="M6 8h4M6 10.5h4M6 5.5h1.5" />
      </svg>
    ),
  },
  {
    key: 'terminal',
    label: '终端',
    shortcut: 'Ctrl+`',
    hint: '会话 PowerShell',
    icon: (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M2.5 3.5h11v9h-11z" />
        <path d="m5 6 2.5 2L5 10M8.5 10.5H11" />
      </svg>
    ),
  },
  {
    key: 'browser',
    label: '浏览器',
    shortcut: 'Ctrl+T',
    hint: '受限内嵌浏览',
    icon: (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="5.5" />
        <path d="M2.5 8h11M8 2.5c1.8 1.6 2.7 3.4 2.7 5.5s-.9 3.9-2.7 5.5c-1.8-1.6-2.7-3.4-2.7-5.5S6.2 4.1 8 2.5Z" />
      </svg>
    ),
  },
  {
    key: 'files',
    label: '文件',
    shortcut: 'Ctrl+P',
    hint: '搜索并打开工作区文件',
    icon: (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M2.5 4.5a1 1 0 0 1 1-1h3l1.5 2h5.5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1Z" />
      </svg>
    ),
  },
]

export function NewTabPalette(props: { initialMode: NewTabPaletteMode; onClose(): void }): ReactNode {
  const [mode, setMode] = useState<NewTabPaletteMode>(props.initialMode)
  const closeRef = useRef(props.onClose)
  closeRef.current = props.onClose
  // Escape 关闭（菜单态/文件态一致）；点击遮罩关闭。
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        closeRef.current()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('keydown', onKey, true) }
  }, [])
  return (
    <div
      className={css.paletteOverlay}
      data-workbench-new-tab-palette
      role="presentation"
      onClick={() => { closeRef.current() }}
    >
      <div
        className={css.paletteCard}
        role="dialog"
        aria-label="新建页签"
        onClick={event => { event.stopPropagation() }}
      >
        {mode === 'menu' ? (
          <div className={css.paletteMenu} role="menu">
            {MENU_ITEMS.map(item => (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                className={css.paletteRow}
                data-palette-action={item.key}
                title={item.hint}
                onClick={() => {
                  if (item.key === 'files') {
                    setMode('files')
                    return
                  }
                  closeRef.current()
                  openNewTabAction(item.key)
                }}
              >
                <span className={css.paletteIcon} aria-hidden="true">{item.icon}</span>
                <span className={css.paletteLabel}>{item.label}</span>
                <kbd className={css.paletteShortcut}>{item.shortcut}</kbd>
              </button>
            ))}
          </div>
        ) : (
          <FileQuickOpen onClose={() => { closeRef.current() }} />
        )}
      </div>
    </div>
  )
}

/** 文件快速打开：输入即搜（防抖），Enter 开第一个结果，↑↓ 选择。 */
function FileQuickOpen(props: { onClose(): void }): ReactNode {
  const { api, boundProjectId } = useWorkspaceApi()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<readonly WorkspaceSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string>()
  const [highlight, setHighlight] = useState(0)

  useEffect(() => {
    const needle = query.trim()
    if (needle === '') {
      setResults([])
      setSearching(false)
      setError(undefined)
      return
    }
    const controller = new AbortController()
    setSearching(true)
    const timer = setTimeout(() => {
      api.search(needle, controller.signal)
        .then(found => {
          if (controller.signal.aborted) return
          setResults(found.results.slice(0, 12))
          setHighlight(0)
          setSearching(false)
          setError(undefined)
        })
        .catch(searchError => {
          if (controller.signal.aborted) return
          setSearching(false)
          setError(searchError instanceof Error ? searchError.message : '搜索失败。')
        })
    }, 160)
    return () => { clearTimeout(timer); controller.abort() }
  }, [query, api])

  const openResult = (entry: WorkspaceSearchResult): void => {
    props.onClose()
    openWorkspaceFile(entry.path, entry.name, boundProjectId)
  }

  return (
    <div className={css.paletteFiles}>
      <input
        className={css.paletteInput}
        type="text"
        placeholder="输入文件名搜索工作区…"
        aria-label="搜索工作区文件"
        data-palette-file-input
        value={query}
        autoFocus
        onChange={event => { setQuery(event.target.value) }}
        onKeyDown={event => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setHighlight(index => Math.min(index + 1, results.length - 1))
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            setHighlight(index => Math.max(index - 1, 0))
          } else if (event.key === 'Enter') {
            event.preventDefault()
            const entry = results[highlight] ?? results[0]
            if (entry !== undefined) openResult(entry)
          }
        }}
      />
      {error !== undefined && <p className={css.paletteNotice} role="alert">{error}</p>}
      {error === undefined && searching && <p className={css.paletteNotice} role="status">搜索中…</p>}
      {error === undefined && !searching && query.trim() !== '' && results.length === 0 && (
        <p className={css.paletteNotice}>没有匹配的文件</p>
      )}
      {results.length > 0 && (
        <div className={css.paletteResults} role="listbox" aria-label="搜索结果">
          {results.map((entry, index) => (
            <button
              key={entry.path}
              type="button"
              role="option"
              aria-selected={index === highlight}
              className={css.paletteResultRow}
              data-highlight={index === highlight || undefined}
              data-palette-file-result={entry.path}
              onMouseEnter={() => { setHighlight(index) }}
              onClick={() => { openResult(entry) }}
            >
              <span className={css.paletteIcon} aria-hidden="true">
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M4 2.5h5l3 3V13a.5.5 0 0 1-.5.5h-7A.5.5 0 0 1 4 13Z" />
                </svg>
              </span>
              <span className={css.paletteFileName}>{entry.name}</span>
              <span className={css.paletteFilePath}>{entry.path}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
