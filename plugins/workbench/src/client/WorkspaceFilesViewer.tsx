import { useEffect, useState, type ReactNode } from 'react'
import { openWorkspaceFile } from './index.ts'
import { useWorkspaceApi, type WorkspaceEntry } from './workspaceApi.ts'
import { revealInExplorer } from './desktopReveal.ts'
import { FileIcon, FolderIcon } from './ui/FileIcon.tsx'
import css from './WorkspaceViewers.module.css'

/**
 * P8 Files viewer: a lazy directory tree over the Host workspace remote.
 * File rows emit typed open intents into the preview viewer instead of
 * duplicating content rendering here.
 */
interface TreeContextMenu { x: number; y: number; relativePath: string }

export function WorkspaceFilesViewer(): ReactNode {
  const { api, boundProjectId } = useWorkspaceApi()
  const [root, setRoot] = useState<string>()
  const [rootError, setRootError] = useState<string>()
  const [menu, setMenu] = useState<TreeContextMenu>()
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<readonly { path: string; name: string }[]>()
  const [searchError, setSearchError] = useState<string>()

  useEffect(() => {
    const controller = new AbortController()
    setRoot(undefined)
    setRootError(undefined)
    api.status(controller.signal)
      .then(status => { if (!controller.signal.aborted) setRoot(status.workspaceRoot) })
      .catch(error => {
        if (!controller.signal.aborted) setRootError(error instanceof Error ? error.message : '工作区根目录读取失败。')
      })
    return () => { controller.abort() }
  }, [api])

  useEffect(() => {
    const needle = query.trim()
    if (needle === '') {
      setSearchResults(undefined)
      setSearchError(undefined)
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(() => {
      api.search(needle, controller.signal)
        .then(result => { if (!controller.signal.aborted) setSearchResults(result.results) })
        .catch(error => { if (!controller.signal.aborted) setSearchError(error instanceof Error ? error.message : '搜索失败。') })
    }, 180)
    return () => { clearTimeout(timer); controller.abort() }
  }, [query, api])

  useEffect(() => {
    if (menu === undefined) return
    const close = (): void => { setMenu(undefined) }
    window.addEventListener('click', close)
    window.addEventListener('blur', close)
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  const absolutePathFor = (relativePath: string): string => (
    root === undefined ? '' : root.replace(/[\\/]+$/u, '') + '\\' + relativePath.replace(/\//gu, '\\')
  )

  return (
    <div className={css.files} data-personal-workbench-files data-workspace-viewer="files" {...(root === undefined ? {} : { 'data-workspace-root': root })}>
      <div className={css.searchArea} data-files-search-area>
        <input
          className={css.searchBox}
          type="search"
          value={query}
          placeholder={root ?? '搜索文件…'}
          data-workspace-files-search
          aria-label="搜索文件"
          title={root}
          onChange={event => { setQuery(event.target.value) }}
        />
      </div>
      {query.trim() !== '' ? (
        <div className={css.searchResults} data-workspace-files-search-results>
          {searchError !== undefined && <p className={css.viewerNotice} role="alert">{searchError}</p>}
          {searchError === undefined && searchResults === undefined && <p className={css.viewerNotice} role="status">搜索中…</p>}
          {searchResults !== undefined && searchResults.length === 0 && <p className={css.viewerNotice}>没有匹配的文件</p>}
          {searchResults?.map(result => (
            <button
              key={result.path}
              className={css.searchResultRow}
              type="button"
              title={result.path}
              onClick={() => {
                openWorkspaceFile(result.path, result.name, boundProjectId)
              }}
            >
              <FileIcon name={result.name} />
              <span className={css.searchResultName}>{result.name}</span>
              <span className={css.searchResultPath}>{result.path}</span>
            </button>
          ))}
        </div>
      ) : rootError !== undefined ? (
        <p className={css.viewerNotice} role="alert">{rootError}</p>
      ) : (
        <DirectoryList
          key={boundProjectId ?? 'session-workspace'}
          path=""
          depth={0}
          api={api}
          workspaceProjectId={boundProjectId}
          onContextMenu={(event, relativePath) => {
            event.preventDefault()
            setMenu({ x: event.clientX, y: event.clientY, relativePath })
          }}
        />
      )}
      {menu !== undefined && (
        <div className={css.contextMenu} style={{ left: menu.x, top: menu.y }} role="menu" data-workspace-context-menu>
          <button type="button" role="menuitem" onClick={() => { void navigator.clipboard.writeText(menu.relativePath) }}>复制相对路径</button>
          <button type="button" role="menuitem" disabled={absolutePathFor(menu.relativePath) === ''} onClick={() => { void navigator.clipboard.writeText(absolutePathFor(menu.relativePath)) }}>复制完整路径</button>
          <button type="button" role="menuitem" disabled={absolutePathFor(menu.relativePath) === ''} onClick={() => { revealInExplorer(absolutePathFor(menu.relativePath)) }}>在资源管理器中显示</button>
        </div>
      )}
    </div>
  )
}

function DirectoryList({ path, depth, api, workspaceProjectId, onContextMenu }: { path: string; depth: number; api: import('./workspaceApi.ts').WorkspaceApi; workspaceProjectId: string | undefined; onContextMenu(event: import('react').MouseEvent, relativePath: string): void }): ReactNode {
  const [entries, setEntries] = useState<readonly WorkspaceEntry[]>()
  const [error, setError] = useState<string>()
  const [open, setOpen] = useState(depth < 1)

  useEffect(() => {
    if (!open || entries !== undefined) return
    const controller = new AbortController()
    api.tree(path, controller.signal)
      .then(tree => { if (!controller.signal.aborted) setEntries(tree.entries) })
      .catch(loadError => {
        if (!controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : '目录读取失败。')
      })
    return () => { controller.abort() }
  }, [path, open, entries])

  const toggle = (): void => { setOpen(value => !value) }
  const displayPath = path === '' ? '工作区根目录' : path.slice(path.lastIndexOf('/') + 1)
  return (
    <div className={css.treeNode} data-depth={depth}>
      <button className={css.treeRow} type="button" onClick={toggle} onContextMenu={event => { onContextMenu(event, path) }}>
        <span aria-hidden="true" className={css.treeChevron}>{open ? '▾' : '▸'}</span>
        <FolderIcon />
        <span className={css.treeLabel}>{displayPath}</span>
      </button>
      {open && error !== undefined && <p className={css.viewerNotice} role="alert">{error}</p>}
      {open && entries === undefined && <p className={css.viewerNotice} role="status">读取中…</p>}
      {open && entries !== undefined && entries.length === 0 && <p className={css.viewerNotice}>空目录</p>}
      {open && entries !== undefined && entries.length > 0 && (
        <div className={css.treeChildren}>
          {entries.map(entry => {
            const childPath = path === '' ? entry.name : path + '/' + entry.name
            return entry.kind === 'directory'
              ? <DirectoryList key={childPath} path={childPath} depth={depth + 1} api={api} workspaceProjectId={workspaceProjectId} onContextMenu={onContextMenu} />
              : (
                <button
                  key={childPath}
                  className={css.treeRow}
                  type="button"
                  onContextMenu={event => { onContextMenu(event, childPath) }}
                  onClick={() => {
                    openWorkspaceFile(childPath, entry.name, workspaceProjectId)
                  }}
                >
                  <span aria-hidden="true" className={css.treeChevron} />
                  <FileIcon name={entry.name} />
                  <span className={css.treeLabel}>{entry.name}</span>
                </button>
              )
          })}
        </div>
      )}
    </div>
  )
}