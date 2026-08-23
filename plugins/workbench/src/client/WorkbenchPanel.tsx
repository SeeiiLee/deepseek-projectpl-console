import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  WorkbenchContextProjection,
  WorkbenchDetailsCommand,
  WorkbenchFamily,
  WorkbenchService,
  WorkbenchTabDescriptor,
  WorkbenchTabModel,
} from './contracts.ts'
import { decideDetailsRoute } from './details-route.ts'
import { DEFAULT_VIEWER_IDS } from './viewers.ts'
import { openWorkspaceFile } from './index.ts'
import { revealInExplorer } from './desktopReveal.ts'
import { NewTabPalette, openNewTabAction, type NewTabPaletteMode } from './NewTabPalette.tsx'
import { getEditingPreferencesStore, PANEL_FONT_FAMILIES, resolveFontFamily } from './editing-preferences.ts'
import { createProjectWorkspaceApi, useWorkspaceApiFor, workspacePath } from './workspaceApi.ts'
import { FileIcon, FolderIcon } from './ui/FileIcon.tsx'
import css from './WorkbenchPanel.module.css'

export interface WorkbenchPanelOwnerProps {
  legacyDetails: ReactNode
  detailsCommand: WorkbenchDetailsCommand
  fullscreen: boolean
}

type WorkbenchPanelProps = PropsRuntime<'workbench.panel'> & {
  workbench: WorkbenchService
}

/** 固定页签只有 Details；文件审阅由右侧文件树打开预览页签。 */

const PLACEHOLDER_COPY: Readonly<Record<WorkbenchFamily, string>> = {
  file: 'Gate 1 已固定文件树入口；本阶段不会读取工作区文件。',
  preview: 'Gate 1 已固定代码查看入口；Monaco 与编辑能力将在后续接入。',
  outline: 'Gate 1 已固定文件结构入口；本阶段不会启动语言服务。',
  diff: 'Gate 1 已固定 Diff 与审核入口；本阶段不会读取或修改 Git 状态。',
  artifact: 'Gate 1 已固定产物查看入口；项目事实仍由 Project Control 管理。',
  browser: 'Gate 1 已固定浏览器入口；本阶段不会访问或导航任何 URL。',
  terminal: 'Gate 1 已固定终端入口；本阶段不会创建第二份 PTY。',
  details: 'Details 复用 Harness 原有详情内容，不维护第二份详情状态。',
}

/** Explicit Gate 1 surface: stable tabs and routing, no actual tool execution. */
export function WorkbenchPanel(props: WorkbenchPanelProps) {
  const { workbench } = props
  const currentSessionId = props.useSessions((state) => {
    const current = state.current
    return current !== undefined && state.byId[current]?.blank === false ? String(current) : undefined
  })
  const snapshot = useSyncExternalStore(workbench.subscribe, workbench.getSnapshot, workbench.getSnapshot)
  // 文件树 dock 宽度：可拖动分隔条调节，localStorage 记忆。
  const [filesDockWidth, setFilesDockWidth] = useState<number>(() => {
    const stored = window.localStorage.getItem('dsh-workbench-files-dock-width')
    const parsed = stored === null ? Number.NaN : Number(stored)
    return Number.isFinite(parsed) ? Math.min(560, Math.max(220, parsed)) : 352
  })
  const startDockResize = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = filesDockWidth
    const onMove = (move: PointerEvent): void => {
      setFilesDockWidth(Math.min(560, Math.max(220, startWidth + (startX - move.clientX))))
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setFilesDockWidth(width => {
        window.localStorage.setItem('dsh-workbench-files-dock-width', String(width))
        return width
      })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }
  // R-ED：面板字体偏好。
  const preferencesStore = useMemo(() => getEditingPreferencesStore(), [])
  const preferences = useSyncExternalStore(preferencesStore.subscribe, preferencesStore.get, preferencesStore.get)
  const panelFontFamily = resolveFontFamily(PANEL_FONT_FAMILIES, preferences.panelFontFamily)
  const active = snapshot.tabs.find(tab => tab.id === snapshot.activeTabId)
  const activeViewer = active === undefined ? undefined : workbench.viewers.get(active.viewerId)
  const renderedViewer = activeViewer?.render !== undefined ? activeViewer : undefined
  const mainTabs = snapshot.tabs.filter(tab => tab.id !== 'workbench:details')
  const detailsTab = snapshot.tabs.find(tab => tab.id === 'workbench:details')
  const filesViewer = workbench.viewers.get('workbench.workspace-files')
  const filesDockDescriptor: WorkbenchTabDescriptor = {
    id: 'workbench:files-dock',
    family: 'file',
    viewerId: 'workbench.workspace-files',
    title: 'Files',
    scope: snapshot.scope,
    ...(snapshot.sessionId === undefined ? {} : { sessionId: snapshot.sessionId }),
  }
  const handledDetailsRevision = useRef(-1)
  // R-UX：新建页签浮层（「＋」按钮 / Ctrl+P 文件快速打开）。
  const [palette, setPalette] = useState<NewTabPaletteMode>()

  useEffect(() => {
    workbench.setCurrentSession(currentSessionId)
  }, [currentSessionId, workbench])

  // R-UX 全局快捷键（与「＋」菜单徽章一一对应）：
  // Ctrl+P 文件快速打开 / Ctrl+T 浏览器 / Ctrl+` 终端 / Ctrl+Shift+G 审阅。
  // 富文本/代码编辑器与会话终端内部不劫持（Ctrl+P 在 PowerShell 是历史上一条）。
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.defaultPrevented) return
      const target = event.target
      if (target instanceof HTMLElement
        && target.closest('.ProseMirror, .cm-editor, [data-workspace-viewer="terminal"]') !== null) return
      if (event.key === '`' && !event.shiftKey) {
        event.preventDefault()
        openNewTabAction('terminal')
      } else if ((event.key === 't' || event.key === 'T') && !event.shiftKey) {
        event.preventDefault()
        openNewTabAction('browser')
      } else if ((event.key === 'g' || event.key === 'G') && event.shiftKey) {
        event.preventDefault()
        openNewTabAction('diff')
      } else if ((event.key === 'p' || event.key === 'P') && !event.shiftKey) {
        event.preventDefault()
        setPalette('files')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [])

  useEffect(() => {
    const decision = decideDetailsRoute(props.detailsCommand, handledDetailsRevision.current)
    handledDetailsRevision.current = decision.nextRevision
    if (decision.action === 'dismiss') {
      workbench.dismissDetails()
      return
    }
    if (decision.action === 'ignore') return
    workbench.selectDetails({
      source: 'legacy-details',
      requestId: props.detailsCommand.revision,
      ...(currentSessionId === undefined ? {} : { sessionId: currentSessionId }),
    })
  }, [currentSessionId, props.detailsCommand.kind, props.detailsCommand.revision, workbench])

  return (
    <section style={panelFontFamily === '' ? undefined : { fontFamily: panelFontFamily }}
      className={css.panel}
      data-personal-workbench="gate-1"
      data-personal-workbench-family={active?.family ?? 'empty'}
      data-personal-workbench-view={active?.viewerId ?? 'empty'}
      data-details-command={`${props.detailsCommand.kind}:${String(props.detailsCommand.revision)}`}
      aria-label="Workbench 工作台"
    >
      <div
        className={css.tabs}
        data-personal-workbench-tabs
        data-workbench-gate="1"
        role="tablist"
        aria-label="Workbench 工具页签"
      >
        <div className={css.tabList} data-workbench-tab-list>
          {mainTabs.map(tab => (
            <Tab key={tab.id} tab={tab} workbench={workbench} />
          ))}
          <button
            className={css.newTabButton}
            type="button"
            data-workbench-new-tab
            aria-label="新建页签"
            aria-haspopup="dialog"
            title="新建页签：文件 / 浏览器 / 终端 / 代码审阅"
            onClick={() => { setPalette('menu') }}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M8 3.5v9M3.5 8h9" />
            </svg>
          </button>
        </div>
        <div className={css.headerActions} data-workbench-header-actions>
          <button
            className={css.fullscreenToggle}
            type="button"
            data-personal-workbench-fullscreen-toggle
            aria-pressed={props.fullscreen}
            title={props.fullscreen ? '退出全屏' : '全屏：工作台占满控制台与会话区域'}
            onClick={() => { workbench.toggleFullscreen() }}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M10 2h4v4" />
              <path d="M6 14H2v-4" />
            </svg>
          </button>
          <button
            className={css.collapseButton}
            type="button"
            aria-label="收起工作台"
            title="收起工作台"
            onClick={() => { workbench.collapse() }}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="m7.5 4.5 5.5 5.5-5.5 5.5" />
            </svg>
          </button>
        </div>
      </div>
      <div className={css.pathRow}>
        <ContextBar snapshot={snapshot} workbench={workbench} />
        <PathBar active={active} snapshot={snapshot} workbench={workbench} />
        <div className={css.pathActions} data-workbench-path-actions>
          {detailsTab !== undefined && (
            <button
              className={css.detailsButton}
              type="button"
              role="tab"
              aria-selected={detailsTab.active}
              data-workbench-family="details"
              data-workbench-viewer={detailsTab.viewerId}
              data-active={detailsTab.active || undefined}
              title="工具详情：点击会话里的工具行后，在这里查看输入与输出"
              onClick={() => { workbench.activateTab(detailsTab.id) }}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
                <path d="M4.5 2.5v11M8 2.5v11M11.5 2.5v11" />
              </svg>
              <span className={css.detailsButtonLabel}>详情</span>
            </button>
          )}
          <LayoutMenu workbench={workbench} />
          <button
            className={css.filesDockCollapse}
            type="button"
            data-personal-workbench-files-toggle
            aria-label={snapshot.filesDockOpen ? '收起文件树' : '展开文件树'}
            title={snapshot.filesDockOpen ? '收起文件树' : '展开文件树'}
            onClick={() => { workbench.toggleFilesDock() }}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d={snapshot.filesDockOpen ? 'm5.5 3.5 5 4.5-5 4.5' : 'm10.5 3.5-5 4.5 5 4.5'} />
            </svg>
          </button>
        </div>
      </div>
      <div className={css.body}>
        <div
          className={css.view}
          data-personal-workbench-current-view={active?.viewerId ?? 'empty'}
          data-personal-workbench-current-family={active?.family ?? 'empty'}
          role="tabpanel"
        >
          {active?.viewerId === DEFAULT_VIEWER_IDS.details ? (
            snapshot.detailsSelection === undefined ? (
              <div className={css.detailsEmpty} data-workbench-details-empty>
                <svg viewBox="0 0 16 16" aria-hidden="true" className={css.detailsEmptyIcon}>
                  <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
                  <path d="M4.5 2.5v11M8 2.5v11M11.5 2.5v11" />
                </svg>
                <h2 className={css.detailsEmptyTitle}>这里显示工具调用的完整输入与输出</h2>
                <p className={css.detailsEmptyCopy}>
                  现在还没有选中任何工具调用。到左侧会话里点任意一条工具行（例如「读取文件」「运行命令」），
                  这里就会并排显示它的入参与返回结果；切去别的页签后，点上方「详情」可随时切回。
                  点页签栏的「＋」也可以新建文件预览、受限浏览器、会话终端或代码审阅页签。
                </p>
              </div>
            ) : (
              <div className={css.details} data-personal-workbench-legacy-details>
                {props.legacyDetails}
              </div>
            )
          ) : active !== undefined && renderedViewer?.render !== undefined ? (
            <div className={css.details + ' ' + css.viewHost} data-personal-workbench-plugin-view={renderedViewer.id}>
              {renderedViewer.render(active)}
            </div>
          ) : active === undefined ? (
            <Placeholder title="No view" copy="当前没有可显示的 Workbench 标签。" />
          ) : (
            <Placeholder title={active.title} copy={PLACEHOLDER_COPY[active.family]} />
          )}
        </div>
        {snapshot.filesDockOpen && (
          <div
            className={css.filesDockHandle}
            role="separator"
            aria-orientation="vertical"
            aria-label="拖动调整文件树宽度"
            title="拖动调整文件树宽度"
            onPointerDown={startDockResize}
          />
        )}
        {snapshot.filesDockOpen && (
          <aside className={css.filesDock} style={{ width: filesDockWidth }} data-personal-workbench-files-dock aria-label="工作区文件树">
            {filesViewer?.render !== undefined
              ? filesViewer.render(filesDockDescriptor)
              : <Placeholder title="Files" copy="文件树查看器尚未注册。" />}
          </aside>
        )}
      </div>
      {palette !== undefined && (
        <NewTabPalette initialMode={palette} onClose={() => { setPalette(undefined) }} />
      )}
    </section>
  )
}

function Tab(props: { tab: WorkbenchTabModel; workbench: WorkbenchService }) {
  return (
    <span className={css.tabWrap} data-active={props.tab.active || undefined}>
      <button
        className={css.tab}
        type="button"
        role="tab"
        aria-selected={props.tab.active}
        data-workbench-family={props.tab.family}
        data-workbench-viewer={props.tab.viewerId}
        title={props.tab.dirty ? `${props.tab.title}（未保存）` : props.tab.title}
        onClick={() => { props.workbench.activateTab(props.tab.id) }}
      >
        {props.tab.dirty ? '● ' : ''}{props.tab.title}
      </button>
      {!props.tab.pinned && (
        <button
          className={css.close}
          type="button"
          aria-label={`关闭 ${props.tab.title}`}
          title={props.tab.dirty ? '存在未保存更改，需先确认' : `关闭 ${props.tab.title}`}
          onClick={() => { props.workbench.closeTab(props.tab.id) }}
        >
          ×
        </button>
      )}
    </span>
  )
}

function LayoutMenu(props: { workbench: WorkbenchService }) {
  const menu = useRef<HTMLDetailsElement | null>(null)
  const invoke = (action: () => void): void => {
    menu.current?.removeAttribute('open')
    action()
  }
  return (
    <details ref={menu} className={css.layoutMenu} data-personal-layout-menu>
      <summary className={css.layoutMenuSummary} aria-label="布局选项" title="布局选项：专注会话 / 重置布局">
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="10" cy="4.5" r="1" />
          <circle cx="10" cy="10" r="1" />
          <circle cx="10" cy="15.5" r="1" />
        </svg>
      </summary>
      <div className={css.layoutMenuPopup} role="menu" aria-label="布局选项">
        <button
          type="button"
          role="menuitem"
          data-personal-layout-action="focus-conversation"
          onClick={() => { invoke(() => { props.workbench.focusConversation() }) }}
        >
          专注会话
        </button>
        <button
          type="button"
          role="menuitem"
          data-personal-layout-action="reset-layout"
          onClick={() => { invoke(() => { props.workbench.resetLayout() }) }}
        >
          重置布局
        </button>
      </div>
    </details>
  )
}

interface PathPopupState { x: number; y: number; dirPath: string }

const CONTEXT_STATUS_LABELS: Readonly<Record<NonNullable<WorkbenchContextProjection['status']>, string>> = {
  ready: '就绪',
  unbound: '未绑定',
  missing: '根缺失',
  conflict: '冲突',
  untrusted: '未信任',
  degraded: '降级',
}

/** W1 Context 条：图钉（固定/跟随切换）+ 浏览目标标签 + 异常状态。 */
function ContextBar(props: { snapshot: ReturnType<WorkbenchService['getSnapshot']>; workbench: WorkbenchService }): ReactNode {
  const context = props.snapshot.context
  if (context === undefined) return null // Hub 缺失时保持旧路径，不显示
  const pinned = context.mode === 'pinned'
  return (
    <div className={css.contextBar} data-workspace-context-bar>
      <button
        className={css.contextPin}
        type="button"
        data-workspace-context-pin
        aria-pressed={pinned}
        aria-label={pinned ? '跟随（取消固定）' : '固定当前浏览目标'}
        title={pinned ? '跟随（取消固定，恢复跟随会话/控制台）' : '固定当前浏览目标（切换会话/项目不再改变）'}
        onClick={() => { props.workbench.toggleWorkbenchPin() }}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true" className={css.contextPinIcon}>
          <path d="M9.5 1.5 14.5 6.5 12 7.2 9.8 9.4 11 13.8 9.7 15.1 6.4 11.8 1.9 13.2 1.9 11.4 4.6 8.7 3.5 5.7Z" />
        </svg>
      </button>
      <button
        className={css.contextTarget}
        type="button"
        data-workspace-context-target
        title={context.primaryPath === undefined ? (context.primaryLabel ?? '工作区') : '在资源管理器中打开：' + context.primaryPath}
        aria-label={context.primaryPath === undefined ? '当前浏览目标' : '在资源管理器中打开：' + context.primaryPath}
        disabled={context.primaryPath === undefined}
        onClick={event => {
          event.stopPropagation()
          if (context.primaryPath !== undefined) revealInExplorer(context.primaryPath)
        }}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" className={css.contextTargetIcon}>
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        </svg>
      </button>
      {context.status !== 'ready' && (
        <span className={css.contextStatus} data-workspace-context-status>{CONTEXT_STATUS_LABELS[context.status]}</span>
      )}
    </div>
  )
}

function PathBar(props: { active: WorkbenchTabModel | undefined; snapshot: ReturnType<WorkbenchService['getSnapshot']>; workbench: WorkbenchService }) {
  const [popup, setPopup] = useState<PathPopupState>()
  const relativePath = props.active?.family === 'preview'
    ? workspacePath(props.active.resourceKey, 'workspace:')
    : null
  // 激活页签自带项目绑定优先于环境绑定（审阅不随控制台导航漂移）。
  const bindingProjectId = props.active?.workspaceProjectId ?? props.snapshot.projectWorkspace?.projectId
  const [boundRoot, setBoundRoot] = useState<string>()
  useEffect(() => {
    if (bindingProjectId === undefined) {
      setBoundRoot(undefined)
      return
    }
    const controller = new AbortController()
    createProjectWorkspaceApi(bindingProjectId).status(controller.signal)
      .then(status => { if (!controller.signal.aborted) setBoundRoot(status.workspaceRoot) })
      .catch(() => {})
    return () => { controller.abort() }
  }, [bindingProjectId])
  useEffect(() => {
    if (popup === undefined) return
    const close = (): void => { setPopup(undefined) }
    window.addEventListener('click', close)
    window.addEventListener('blur', close)
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [popup])
  const parts = relativePath === null ? [] : relativePath.split('/')
  const ambientRoot = props.snapshot.projectWorkspace?.root
  const effectiveRoot = boundRoot ?? ambientRoot
  const rootLabel = effectiveRoot === undefined
    ? '工作区'
    : (effectiveRoot.replace(/[\\/]+$/u, '').split(/[\\/]/u).pop() ?? '项目')
  const segmentOf = (index: number): string => parts.slice(0, index).join('/')
  const openPopup = (event: React.MouseEvent<HTMLButtonElement>, dirPath: string): void => {
    // 阻断本次点击冒泡：否则同一事件会命中「点击外部关闭」监听器，悬浮窗开屏即关。
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    setPopup({ x: rect.left, y: rect.bottom + 4, dirPath })
  }
  return (
    <div className={css.pathBar} data-personal-workbench-pathbar>
      <button className={css.pathSegment} type="button" data-workspace-path-segment onClick={event => { openPopup(event, '') }}>{rootLabel}</button>
      {parts.map((part, index) => {
        const isLast = index === parts.length - 1
        return (
          <span key={index} className={css.pathSegmentWrap}>
            <span className={css.pathSlash} aria-hidden="true">›</span>
            {isLast ? (
              <span className={css.pathLeaf}>{part}</span>
            ) : (
              <button className={css.pathSegment} type="button" data-workspace-path-segment title={segmentOf(index + 1)} onClick={event => { openPopup(event, segmentOf(index + 1)) }}>{part}</button>
            )}
          </span>
        )
      })}
      {popup !== undefined && <PathPopup state={popup} workbench={props.workbench} bindingProjectId={bindingProjectId} />}
    </div>
  )
}

function PathPopup(props: { state: PathPopupState; workbench: WorkbenchService; bindingProjectId: string | undefined }) {
  const { api } = useWorkspaceApiFor(props.bindingProjectId)
  const [entries, setEntries] = useState<readonly { name: string; kind: 'directory' | 'file' }[]>()
  const [error, setError] = useState<string>()
  const [filter, setFilter] = useState('')
  const [dirPath, setDirPath] = useState(props.state.dirPath)
  useEffect(() => {
    const controller = new AbortController()
    setEntries(undefined)
    setError(undefined)
    api.tree(dirPath, controller.signal)
      .then(tree => { if (!controller.signal.aborted) setEntries(tree.entries) })
      .catch(loadError => { if (!controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : '目录读取失败。') })
    return () => { controller.abort() }
  }, [api, dirPath])
  const needle = filter.trim().toLowerCase()
  const visible = (entries ?? []).filter(entry => needle === '' || entry.name.toLowerCase().includes(needle))
  return (
    <div
      className={css.pathPopup}
      style={{ left: props.state.x, top: props.state.y }}
      role="menu"
      data-workspace-path-popup
      onClick={event => { event.stopPropagation() }}
    >
      <input
        className={css.pathPopupFilter}
        value={filter}
        placeholder={'筛选 ' + (dirPath === '' ? '根目录' : dirPath)}
        onChange={event => { setFilter(event.target.value) }}
        autoFocus
      />
      {error !== undefined && <p className={css.pathPopupNotice} role="alert">{error}</p>}
      {entries === undefined && error === undefined && <p className={css.pathPopupNotice} role="status">读取中…</p>}
      {entries !== undefined && visible.length === 0 && <p className={css.pathPopupNotice}>没有匹配项</p>}
      <div className={css.pathPopupList}>
        {visible.map(entry => {
          const child = dirPath === '' ? entry.name : dirPath + '/' + entry.name
          return entry.kind === 'directory' ? (
            <button key={child} className={css.pathPopupRow} type="button" onClick={() => { setDirPath(child) }}>
              <FolderIcon /><span className={css.pathPopupRowLabel}>{entry.name}</span>
            </button>
          ) : (
            <button key={child} className={css.pathPopupRow} type="button" onClick={() => {
              openWorkspaceFile(child, entry.name)
            }}>
              <FileIcon name={entry.name} /><span className={css.pathPopupRowLabel}>{entry.name}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function Placeholder(props: { title: string; copy: string }) {
  return (
    <div className={css.placeholder} data-workbench-placeholder>
      <h2 className={css.placeholderTitle}>{props.title}</h2>
      <p className={css.placeholderCopy}>{props.copy}</p>
    </div>
  )
}
