import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionTerminalApi, TerminalSnapshot } from './terminalApi.ts'
import css from './SessionTerminalDock.module.css'

export interface SessionTerminalDockInjected {
  api: SessionTerminalApi
}

export type SessionTerminalDockProps = PropsRuntime<'shell.overlay'> & SessionTerminalDockInjected

interface OutputView {
  cursor: number
  text: string
  reconnecting: boolean
  truncated: boolean
}

const EMPTY_OUTPUT: OutputView = { cursor: 0, text: '', reconnecting: false, truncated: false }
const CLIENT_OUTPUT_LIMIT = 786_432

/** Floating bottom dock whose Host-side PTYs survive this component and its HTTP connection. */
export function SessionTerminalDock({ api, useSessions }: SessionTerminalDockProps): ReactNode {
  const sessionId = useSessions(state => state.current)
  const sessionCwd = useSessions(state => state.current === undefined ? undefined : state.byId[state.current]?.cwd)
  const [expanded, setExpanded] = useState(false)
  const [tabs, setTabs] = useState<readonly TerminalSnapshot[]>([])
  const [activeId, setActiveId] = useState<string | undefined>()
  const [outputs, setOutputs] = useState<Record<string, OutputView>>({})
  const [draft, setDraft] = useState('')
  const [historyIndex, setHistoryIndex] = useState<number | undefined>()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | undefined>()
  const outputRef = useRef<HTMLPreElement | null>(null)
  const shouldFollowOutput = useRef(true)
  const cursorRef = useRef<Record<string, number>>({})
  const active = useMemo(() => tabs.find(tab => tab.terminalId === activeId), [activeId, tabs])
  const output = activeId === undefined ? EMPTY_OUTPUT : outputs[activeId] ?? EMPTY_OUTPUT

  useEffect(() => {
    let cancelled = false
    setTabs([])
    setActiveId(undefined)
    setNotice(undefined)
    setDraft('')
    setHistoryIndex(undefined)
    if (sessionId === undefined) return () => { cancelled = true }
    void api.list(sessionId).then(items => {
      if (cancelled) return
      setTabs(items)
      setActiveId(current => items.some(item => item.terminalId === current) ? current : items[0]?.terminalId)
    }).catch(error => {
      if (!cancelled) setNotice(messageOf(error))
    })
    return () => { cancelled = true }
  }, [api, sessionId])

  useEffect(() => {
    if (sessionId === undefined || activeId === undefined) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async (): Promise<void> => {
      try {
        const result = await api.read(sessionId, activeId, cursorRef.current[activeId] ?? 0)
        if (cancelled) return
        cursorRef.current[activeId] = result.cursor
        setTabs(items => replaceTab(items, result.terminal))
        setOutputs(current => {
          const previous = current[activeId] ?? EMPTY_OUTPUT
          const nextText = result.truncated ? result.output : previous.text + result.output
          return {
            ...current,
            [activeId]: {
              cursor: result.cursor,
              text: tail(nextText, CLIENT_OUTPUT_LIMIT),
              reconnecting: false,
              truncated: previous.truncated || result.truncated,
            },
          }
        })
      } catch (_temporaryDisconnect) {
        if (!cancelled) {
          setOutputs(current => ({
            ...current,
            [activeId]: { ...(current[activeId] ?? EMPTY_OUTPUT), reconnecting: true },
          }))
        }
      } finally {
        if (!cancelled) timer = setTimeout(() => { void tick() }, expanded ? 350 : 1_500)
      }
    }
    void tick()
    return () => {
      cancelled = true
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [activeId, api, expanded, sessionId])

  useEffect(() => {
    const element = outputRef.current
    if (element !== null && shouldFollowOutput.current) element.scrollTop = element.scrollHeight
  }, [output.text])

  const run = async (operation: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setNotice(undefined)
    try {
      await operation()
    } catch (error) {
      setNotice(messageOf(error))
    } finally {
      setBusy(false)
    }
  }

  const createTab = (): void => {
    if (sessionId === undefined) return
    void run(async () => {
      const terminal = await api.open(sessionId)
      cursorRef.current[terminal.terminalId] = 0
      setTabs(items => [...items, terminal])
      setActiveId(terminal.terminalId)
      setExpanded(true)
    })
  }

  const toggle = (): void => {
    if (sessionId === undefined) return
    if (!expanded && tabs.length === 0) createTab()
    else setExpanded(value => !value)
  }

  const send = (): void => {
    if (sessionId === undefined || active === undefined || draft.length === 0 || active.status.kind !== 'running') return
    const command = draft
    setDraft('')
    setHistoryIndex(undefined)
    void run(async () => {
      const terminal = await api.write(sessionId, active.terminalId, command)
      setTabs(items => replaceTab(items, terminal))
    })
  }

  const onInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      send()
      return
    }
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    const history = active?.history ?? []
    if (history.length === 0) return
    event.preventDefault()
    const next = event.key === 'ArrowUp'
      ? Math.max(0, historyIndex === undefined ? history.length - 1 : historyIndex - 1)
      : historyIndex === undefined ? undefined : historyIndex + 1 >= history.length ? undefined : historyIndex + 1
    setHistoryIndex(next)
    setDraft(next === undefined ? '' : history[next] ?? '')
  }

  const clear = (): void => {
    if (sessionId === undefined || active === undefined) return
    void run(async () => {
      const result = await api.clear(sessionId, active.terminalId)
      cursorRef.current[active.terminalId] = result.cursor
      setOutputs(current => ({
        ...current,
        [active.terminalId]: { cursor: result.cursor, text: '', reconnecting: false, truncated: false },
      }))
    })
  }

  const restart = (): void => {
    if (sessionId === undefined || active === undefined) return
    if (!window.confirm(`确认重启“${active.name}”吗？正在运行的命令会结束。`)) return
    void run(async () => {
      const terminal = await api.restart(sessionId, active.terminalId)
      cursorRef.current[active.terminalId] = 0
      setOutputs(current => ({ ...current, [active.terminalId]: EMPTY_OUTPUT }))
      setTabs(items => replaceTab(items, terminal))
    })
  }

  const close = (terminal: TerminalSnapshot): void => {
    if (sessionId === undefined) return
    if (!window.confirm(`确认关闭“${terminal.name}”吗？其中的进程会一并结束。`)) return
    void run(async () => {
      await api.close(sessionId, terminal.terminalId)
      setTabs(items => {
        const next = items.filter(item => item.terminalId !== terminal.terminalId)
        setActiveId(current => current === terminal.terminalId ? next[0]?.terminalId : current)
        return next
      })
      setOutputs(current => {
        const next = { ...current }
        delete next[terminal.terminalId]
        return next
      })
      delete cursorRef.current[terminal.terminalId]
    })
  }

  return (
    <section className={expanded ? css.dockExpanded : css.dockCollapsed} aria-label="会话 PowerShell">
      {!expanded ? (
        <button className={css.collapsedButton} type="button" disabled={sessionId === undefined || busy} onClick={toggle}>
          <span className={css.promptMark}>&gt;_</span>
          <span>{sessionId === undefined ? '选择会话后使用终端' : tabs.length === 0 ? '打开 PowerShell' : `${tabs.length} 个 PowerShell`}</span>
          {tabs.some(tab => tab.status.kind === 'running') ? <i aria-label="终端正在运行" /> : null}
        </button>
      ) : (
        <div className={css.panel}>
          <header className={css.header}>
            <div className={css.tabs} role="tablist" aria-label="PowerShell 标签页">
              {tabs.map(tab => (
                <button
                  className={tab.terminalId === activeId ? css.activeTab : css.tab}
                  key={tab.terminalId}
                  type="button"
                  role="tab"
                  aria-selected={tab.terminalId === activeId}
                  title={tab.cwd}
                  onClick={() => { setActiveId(tab.terminalId); setHistoryIndex(undefined) }}
                >
                  <span>{tab.name}</span>
                  <i data-status={tab.status.kind} />
                </button>
              ))}
              <button className={css.addTab} type="button" disabled={busy || sessionId === undefined} aria-label="新建 PowerShell" onClick={createTab}>＋</button>
            </div>
            <div className={css.headerActions}>
              <span title={sessionCwd}>{shortPath(sessionCwd)}</span>
              <button type="button" disabled={busy || active?.status.kind !== 'running'} onClick={() => {
                if (sessionId !== undefined && active !== undefined) void run(async () => { await api.interrupt(sessionId, active.terminalId) })
              }}>中断</button>
              <button type="button" disabled={busy || active === undefined} onClick={clear}>清屏</button>
              <button type="button" disabled={busy || active === undefined} onClick={restart}>重启</button>
              <button type="button" disabled={busy || active === undefined} onClick={() => { if (active !== undefined) close(active) }}>关闭</button>
              <button type="button" aria-label="收起终端" onClick={() => { setExpanded(false) }}>⌄</button>
            </div>
          </header>

          {active === undefined ? (
            <div className={css.empty}><p>当前会话还没有终端。</p><button type="button" disabled={busy} onClick={createTab}>新建 PowerShell</button></div>
          ) : (
            <>
              <div className={css.outputWrap}>
                <pre
                  ref={outputRef}
                  className={css.output}
                  tabIndex={0}
                  onScroll={event => {
                    const element = event.currentTarget
                    shouldFollowOutput.current = element.scrollHeight - element.scrollTop - element.clientHeight < 36
                  }}
                >{output.text || 'PowerShell 已连接，输入命令后按 Enter。'}</pre>
                <div className={css.connectionState}>
                  {output.reconnecting ? <span data-kind="warning">连接中断，正在按游标重连…</span> : null}
                  {output.truncated ? <span data-kind="warning">较早输出已超出缓冲区。</span> : null}
                  {active.status.kind === 'exited' ? <span>进程已退出（{active.status.exitCode ?? active.status.signal ?? '未知状态'}）</span> : null}
                  {active.status.kind === 'failed' ? <span data-kind="error">{active.status.message}</span> : null}
                </div>
              </div>
              <div className={css.composer}>
                <span className={css.promptMark}>PS</span>
                <textarea
                  rows={1}
                  value={draft}
                  disabled={busy || active.status.kind !== 'running'}
                  aria-label="PowerShell 命令"
                  placeholder={active.status.kind === 'running' ? '输入命令；Shift+Enter 换行' : '终端未运行，请重启'}
                  onChange={event => { setDraft(event.target.value); setHistoryIndex(undefined) }}
                  onKeyDown={onInputKeyDown}
                />
                <button type="button" disabled={busy || draft.length === 0 || active.status.kind !== 'running'} onClick={send}>运行</button>
              </div>
            </>
          )}
          {notice !== undefined ? <p className={css.notice} role="status">{notice}</p> : null}
        </div>
      )}
    </section>
  )
}

function replaceTab(items: readonly TerminalSnapshot[], next: TerminalSnapshot): readonly TerminalSnapshot[] {
  return items.map(item => item.terminalId === next.terminalId ? next : item)
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message.trim() !== '' ? error.message : '终端操作失败。'
}

function tail(value: string, limit: number): string {
  return value.length <= limit ? value : value.slice(-limit)
}

function shortPath(value: string | undefined): string {
  if (value === undefined || value === '') return '无工作区'
  const parts = value.split(/[\\/]/u).filter(Boolean)
  return parts.length <= 2 ? value : `…\\${parts.slice(-2).join('\\')}`
}
