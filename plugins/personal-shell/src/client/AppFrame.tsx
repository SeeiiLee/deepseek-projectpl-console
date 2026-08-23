import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { PanelErrorBoundary } from './ErrorBoundary.tsx'
import type { PropsRenderSlots, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import {
  computeColumns,
  PROJECT_COLLAPSED_RAIL,
  PROJECT_DEFAULT,
  PROJECT_MAX,
  PROJECT_MIN,
  SIDEBAR_AUTO_COLLAPSE,
  WORKBENCH_COLLAPSED_RAIL,
  WORKBENCH_DEFAULT,
  WORKBENCH_MAX,
  WORKBENCH_MIN,
} from './columns.ts'
import type { createLayoutStore } from './stores.ts'
import css from './AppFrame.module.css'

/** Complete root props derived from all Gate 1 child slots and layout store. */
export type AppFrameProps =
  & PropsRuntime<'root'>
  & PropsRenderSlots<'sidebar' | 'project.control' | 'conversation' | 'details' | 'workbench.panel' | 'shell.overlay'>
  & PropsStore<ReturnType<typeof createLayoutStore>>

function ProjectColumn(props: {
  children?: ReactNode
  collapsed: boolean
  onCollapse: () => void
  onExpand: () => void
}) {
  return (
    <section
      className={css.projectCol}
      data-personal-project-panel
      data-collapsed={props.collapsed || undefined}
    >
      <header className={css.panelHeader} data-personal-project-header data-collapsed={props.collapsed || undefined}>
        {props.collapsed ? (
          <button
            className={css.panelExpand}
            type="button"
            aria-label="展开项目控制台"
            title="展开项目控制台"
            onClick={props.onExpand}
          >
            <Chevron direction="right" />
          </button>
        ) : (
          <>
            <div className={css.panelHeading}>
              <span className={css.projectAccent} aria-hidden="true" />
              <span className={css.panelTitle}>项目控制台</span>
            </div>
            <button
              className={css.panelCollapse}
              type="button"
              aria-label="收起项目控制台"
              title="收起项目控制台"
              onClick={props.onCollapse}
            >
              <Chevron direction="left" />
            </button>
          </>
        )}
      </header>
      <div className={css.panelBody} data-collapsed={props.collapsed || undefined}>
        {props.children}
      </div>
    </section>
  )
}

function WorkbenchColumn(props: {
  children?: ReactNode
  collapsed: boolean
  onExpand: () => void
}) {
  return (
    <aside
      className={css.workbenchCol}
      data-personal-workbench-panel
      data-collapsed={props.collapsed || undefined}
    >
      {/* 展开态不再渲染外壳头部：页签/路径栏由工作台插件自己负责（收起按钮、布局菜单、全屏、文件开关都在页签栏）。 */}
      {props.collapsed && (
        <header className={css.panelHeader} data-personal-workbench-header data-collapsed={props.collapsed || undefined}>
          <button
            className={css.panelExpand}
            type="button"
            aria-label="展开工作台"
            title="展开工作台"
            onClick={props.onExpand}
          >
            <Chevron direction="left" />
          </button>
        </header>
      )}
      <div className={css.panelBody} data-collapsed={props.collapsed || undefined}>
        {props.children}
      </div>
    </aside>
  )
}

function Chevron({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d={direction === 'left' ? 'M12.5 4.5 7 10l5.5 5.5' : 'm7.5 4.5 5.5 5.5-5.5 5.5'} />
    </svg>
  )
}

function ConversationColumn(props: { children?: ReactNode }) {
  return <main className={css.conversationCol} data-personal-conversation-column>{props.children}</main>
}

type DividerProps = {
  side: 'project' | 'workbench'
  left: number
  value: number
  min: number
  max: number
  onStart: () => void
  onDrag: (dx: number) => void
  onEnd: () => void
  onSet: (px: number) => void
  onReset: () => void
  onToggle: () => void
}

const KEYBOARD_RESIZE_STEP = 16

/** Pointer, keyboard and reset affordance for one auxiliary-panel boundary. */
function Divider(props: DividerProps) {
  const [dragging, setDragging] = useState(false)
  const origin = useRef(0)
  const latest = useRef(0)
  const frame = useRef<number | null>(null)
  const callbacks = useRef({ onStart: props.onStart, onDrag: props.onDrag, onEnd: props.onEnd })
  callbacks.current = { onStart: props.onStart, onDrag: props.onDrag, onEnd: props.onEnd }

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    origin.current = event.clientX
    latest.current = event.clientX
    callbacks.current.onStart()
    setDragging(true)
  }, [])
  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    latest.current = event.clientX
    frame.current ??= requestAnimationFrame(() => {
      frame.current = null
      callbacks.current.onDrag(latest.current - origin.current)
    })
  }, [])
  const finishPointer = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current)
      frame.current = null
    }
    callbacks.current.onDrag(latest.current - origin.current)
    setDragging(false)
    callbacks.current.onEnd()
  }, [])

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    let next: number | undefined
    if (event.key === 'ArrowLeft') {
      next = props.value + (props.side === 'project' ? -KEYBOARD_RESIZE_STEP : KEYBOARD_RESIZE_STEP)
    } else if (event.key === 'ArrowRight') {
      next = props.value + (props.side === 'project' ? KEYBOARD_RESIZE_STEP : -KEYBOARD_RESIZE_STEP)
    } else if (event.key === 'Home') {
      event.preventDefault()
      props.onReset()
      return
    } else if (event.key === 'Enter') {
      event.preventDefault()
      props.onToggle()
      return
    }
    if (next !== undefined) {
      event.preventDefault()
      props.onSet(next)
    }
  }, [props])

  return (
    <div
      className={css.divider}
      style={{ left: props.left }}
      data-personal-divider={props.side}
      data-dragging={dragging || undefined}
      role="separator"
      tabIndex={0}
      aria-label={props.side === 'project' ? '调整项目控制台宽度' : '调整工作台宽度'}
      aria-orientation="vertical"
      aria-valuemin={props.min}
      aria-valuemax={props.max}
      aria-valuenow={Math.round(props.value)}
      onDoubleClick={props.onReset}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishPointer}
      onPointerCancel={finishPointer}
    />
  )
}

/** Four-track Personal Desktop shell formalised for Gate 1. */
export function AppFrame({ useStore, useSessions, actions, renderSlot }: AppFrameProps) {
  const panels = useStore(state => state)
  const detailsSession = useSessions((state) => {
    const current = state.current
    return current !== undefined && state.byId[current]?.blank === false ? current : undefined
  })
  const frameRef = useRef<HTMLDivElement | null>(null)
  const [viewport, setViewport] = useState(() => window.innerWidth)

  const lastSession = useRef(detailsSession)
  useLayoutEffect(() => {
    if (lastSession.current !== detailsSession) {
      actions.clearDetails()
    }
    lastSession.current = detailsSession
  }, [actions, detailsSession])

  useEffect(() => {
    const element = frameRef.current
    /* v8 ignore next -- the frame renders unconditionally before this effect. */
    if (element === null) return
    let pendingFrame: number | null = null
    const observer = new ResizeObserver(() => {
      pendingFrame ??= requestAnimationFrame(() => {
        pendingFrame = null
        const width = element.getBoundingClientRect().width
        if (width > 0) setViewport(width)
      })
    })
    observer.observe(element)
    return () => {
      observer.disconnect()
      if (pendingFrame !== null) cancelAnimationFrame(pendingFrame)
    }
  }, [])

  const narrow = viewport < SIDEBAR_AUTO_COLLAPSE
  useEffect(() => { actions.setNarrow(narrow) }, [actions, narrow])
  const sidebarCollapsed = narrow ? !panels.narrowExpanded : !panels.sidebarOpen
  const columns = computeColumns(viewport, {
    sidebarCollapsed,
    projectOpen: panels.projectOpen,
    projectWidth: panels.projectWidth,
    workbenchOpen: panels.workbenchOpen,
    workbenchWidth: panels.workbenchWidth,
    preferredAuxiliary: panels.preferredAuxiliary,
    workbenchFullscreen: panels.workbenchFullscreen,
  })
  const projectCollapsed = columns.project === PROJECT_COLLAPSED_RAIL
  const workbenchCollapsed = columns.workbench === WORKBENCH_COLLAPSED_RAIL
  const columnsRef = useRef(columns)
  columnsRef.current = columns

  const projectBase = useRef(PROJECT_DEFAULT)
  const workbenchBase = useRef(WORKBENCH_DEFAULT)
  const [dragging, setDragging] = useState(false)
  const finishProjectDrag = useCallback(() => {
    actions.commitProject()
    setDragging(false)
  }, [actions])
  const finishWorkbenchDrag = useCallback(() => {
    actions.commitWorkbench()
    setDragging(false)
  }, [actions])
  const startProjectDrag = useCallback(() => {
    projectBase.current = columnsRef.current.project
    setDragging(true)
  }, [])
  const startWorkbenchDrag = useCallback(() => {
    workbenchBase.current = columnsRef.current.workbench
    setDragging(true)
  }, [])
  const dragProject = useCallback((dx: number) => {
    actions.previewProject(projectBase.current + dx)
  }, [actions])
  const dragWorkbench = useCallback((dx: number) => {
    actions.previewWorkbench(workbenchBase.current - dx)
  }, [actions])
  const resetProject = useCallback(() => { actions.setProject(PROJECT_DEFAULT) }, [actions])
  const resetWorkbench = useCallback(() => { actions.setWorkbench(WORKBENCH_DEFAULT) }, [actions])

  const legacyDetails = renderSlot('details', {})

  return (
    <div
      ref={frameRef}
      className={css.frame}
      style={{
        gridTemplateColumns: `${columns.sidebar}px ${columns.project}px ${panels.workbenchFullscreen ? '0px' : 'minmax(0, 1fr)'} ${columns.workbench}px`,
      }}
      data-personal-shell="gate-1"
      data-sidebar-collapsed={sidebarCollapsed || undefined}
      data-project-collapsed={projectCollapsed || undefined}
      data-workbench-collapsed={workbenchCollapsed || undefined}
      data-workbench-fullscreen={panels.workbenchFullscreen || undefined}
      data-dragging={dragging || undefined}
    >
      <div className={css.sidebarCol} data-personal-sidebar-column>
        {renderSlot('sidebar', { collapsed: sidebarCollapsed, width: columns.sidebar })}
      </div>
      <ProjectColumn
        collapsed={projectCollapsed}
        onCollapse={actions.closeProject}
        onExpand={actions.openProject}
      >
        <PanelErrorBoundary>{renderSlot('project.control', {})}</PanelErrorBoundary>
      </ProjectColumn>
      <ConversationColumn>{renderSlot('conversation', {})}</ConversationColumn>
      <WorkbenchColumn
        collapsed={workbenchCollapsed}
        onExpand={actions.openWorkbench}
      >
        <PanelErrorBoundary>{renderSlot('workbench.panel', {
          legacyDetails,
          detailsCommand: panels.detailsCommand,
          fullscreen: panels.workbenchFullscreen,
        })}</PanelErrorBoundary>
      </WorkbenchColumn>
      <div className={css.overlayLayer} data-shell-overlay>
        {renderSlot('shell.overlay', {})}
      </div>
      {!projectCollapsed && (
        <Divider
          side="project"
          left={columns.sidebar + columns.project}
          value={columns.project}
          min={PROJECT_MIN}
          max={PROJECT_MAX}
          onStart={startProjectDrag}
          onDrag={dragProject}
          onEnd={finishProjectDrag}
          onSet={actions.setProject}
          onReset={resetProject}
          onToggle={actions.toggleProject}
        />
      )}
      {!workbenchCollapsed && !panels.workbenchFullscreen && (
        <Divider
          side="workbench"
          left={viewport - columns.workbench}
          value={columns.workbench}
          min={WORKBENCH_MIN}
          max={WORKBENCH_MAX}
          onStart={startWorkbenchDrag}
          onDrag={dragWorkbench}
          onEnd={finishWorkbenchDrag}
          onSet={actions.setWorkbench}
          onReset={resetWorkbench}
          onToggle={actions.toggleWorkbench}
        />
      )}
    </div>
  )
}
