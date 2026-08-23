import { useEffect, useSyncExternalStore, useState, type ReactNode } from 'react'
import { getActiveWorkbench } from './index.ts'
import { createSessionTerminalBridge, type TerminalSnapshot } from './sessionTerminalBridge.ts'
import css from './WorkspaceViewers.module.css'

const terminalApi = createSessionTerminalBridge()

/**
 * P8 terminal placement: reuses the existing session-terminal PTY ids
 * instead of creating a second terminal system. Read/write are relayed
 * through the same Host API the floating dock uses.
 */
export function SessionTerminalViewer(): ReactNode {
  const workbench = getActiveWorkbench()
  const snapshot = useSyncExternalStore(
    workbench === undefined ? () => () => {} : workbench.subscribe,
    () => workbench?.getSnapshot() ?? null,
    () => null,
  )
  const sessionId = snapshot?.sessionId
  const [tabs, setTabs] = useState<readonly TerminalSnapshot[]>([])
  const [activeId, setActiveId] = useState<string>()
  const [output, setOutput] = useState<string>('')
  const [cursor, setCursor] = useState(0)
  const [draft, setDraft] = useState('')
  const [notice, setNotice] = useState<string>()

  useEffect(() => {
    if (sessionId === undefined) {
      setTabs([])
      setNotice('当前没有活动会话，终端不可用。')
      return
    }
    const controller = new AbortController()
    setNotice(undefined)
    terminalApi.list(sessionId)
      .then(items => {
        if (controller.signal.aborted) return
        setTabs(items)
        setActiveId(current => items.some(item => item.terminalId === current) ? current : items[0]?.terminalId)
      })
      .catch(() => { if (!controller.signal.aborted) setNotice('终端列表读取失败。') })
    return () => { controller.abort() }
  }, [sessionId])

  useEffect(() => {
    if (sessionId === undefined || activeId === undefined) return
    let cancelled = false
    const poll = async (): Promise<void> => {
      try {
        const result = await terminalApi.read(sessionId, activeId, cursor)
        if (!cancelled) {
          setOutput(current => current + result.output)
          setCursor(result.cursor)
        }
      } catch {
        // transient read errors are tolerated; the next poll retries
      }
    }
    void poll()
    const timer = setInterval(() => { void poll() }, 750)
    return () => { cancelled = true; clearInterval(timer) }
  }, [sessionId, activeId, cursor])

  const submit = async (): Promise<void> => {
    if (sessionId === undefined || activeId === undefined || draft === '') return
    const text = draft
    setDraft('')
    try {
      await terminalApi.write(sessionId, activeId, text)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '终端输入失败。')
    }
  }

  return (
    <div className={css.terminal} data-personal-workbench-terminal data-workspace-viewer="terminal">
      <div className={css.viewerHeader}><strong>会话终端</strong><span>{sessionId ?? '无活动会话'}</span></div>
      {notice !== undefined && <p className={css.viewerNotice} role="alert">{notice}</p>}
      {tabs.length > 1 && (
        <div className={css.terminalTabs}>
          {tabs.map(tab => (
            <button
              key={tab.terminalId}
              type="button"
              data-active={tab.terminalId === activeId || undefined}
              onClick={() => { setActiveId(tab.terminalId); setOutput(''); setCursor(0) }}
            >
              {tab.name || tab.terminalId}
            </button>
          ))}
        </div>
      )}
      <pre className={css.terminalOutput} aria-live="polite">{output}</pre>
      <div className={css.terminalInputRow}>
        <input
          type="text"
          value={draft}
          placeholder="输入命令后回车（只复用现有终端）"
          disabled={sessionId === undefined || activeId === undefined}
          onChange={event => { setDraft(event.target.value) }}
          onKeyDown={event => { if (event.key === 'Enter') void submit() }}
        />
      </div>
    </div>
  )
}