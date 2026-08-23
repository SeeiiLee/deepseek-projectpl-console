import {
  useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode,
} from 'react'
import type {
  ConversationSnapshot, SessionFace, SessionId,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { trajectoryOf } from './contracts.ts'
import { jumpToChatAnchor } from './jump.ts'
import { deriveTrajectoryIsland, type IslandTurn } from './model.ts'
import css from './SessionMinimap.module.css'

export interface SessionMinimapInjected {
  resolveSession(sessionId: SessionId): SessionFace | undefined
}

type Props = PropsRuntime<'shell.overlay'> & SessionMinimapInjected

const EMPTY_SUBSCRIBE = (): (() => void) => () => {}

interface RailGeometry { top: number; height: number; left: number }

function conversationScroller(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-conversation-scroll]')
}

function measureRail(): RailGeometry | undefined {
  const scroller = conversationScroller()
  if (scroller === null) return undefined
  const rect = scroller.getBoundingClientRect()
  if (rect.height < 120 || rect.width < 120) return undefined
  // 贴会话区右缘内侧（Codex 式 minimap 轨），给滚动条留 6px。
  return { top: rect.top + 8, height: rect.height - 16, left: rect.right - 20 }
}

/** 主刻度类型：该轮有用户消息记 user（长刻度），否则 assistant（短刻度）。 */
function tickKind(turn: IslandTurn): 'user' | 'assistant' {
  return turn.signals.some(signal => signal.kind === 'user') ? 'user' : 'assistant'
}

export function SessionMinimap({ useSessions, resolveSession }: Props): ReactNode {
  const current = useSessions(state => state.current)
  const session = current === undefined ? undefined : resolveSession(current)
  const subscribe = useCallback(
    (notify: () => void) => session?.subscribe(notify) ?? EMPTY_SUBSCRIBE(),
    [session],
  )
  const getSnapshot = useCallback(
    (): ConversationSnapshot | null => session?.getSnapshot() ?? null,
    [session],
  )
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const [geometry, setGeometry] = useState<RailGeometry | undefined>()
  const [activeIndex, setActiveIndex] = useState(-1)
  const [hoverIndex, setHoverIndex] = useState(-1)
  const [hoverTop, setHoverTop] = useState(0)

  const turns = useMemo(() => {
    if (snapshot === null) return [] as readonly IslandTurn[]
    const trajectory = trajectoryOf(snapshot)
    if (trajectory === undefined) return [] as readonly IslandTurn[]
    return deriveTrajectoryIsland({
      turnOrder: snapshot.chat.timeline.turnOrder,
      turnStatus: turn => snapshot.chat.timeline.turns.get(turn)?.status,
      nodeKeys: turn => snapshot.chat.locations.getTurn(turn),
      node: key => {
        const node = snapshot.chat.nodes.get(key)
        return node === undefined ? undefined : {
          key: node.key,
          kind: node.kind,
          visibility: node.visibility,
          anchorSeq: node.anchorSeq,
        }
      },
      requests: trajectory.requests.flatMap(request => request.purpose === 'assistant'
        ? [{ turn: request.turn, status: request.status }]
        : request.turn === null ? [] : [{ turn: request.turn, status: request.status }]),
      runningToolTurns: trajectory.runningCalls.map(call => call.turn),
    })
  }, [snapshot])

  const visible = useMemo(() => turns.slice(-64), [turns])
  const omitted = turns.length - visible.length

  // 轨道几何：跟随会话滚动容器的位置与尺寸（侧栏开合、窗口缩放都会改变它）。
  useEffect(() => {
    if (visible.length === 0) return
    let disposed = false
    const update = (): void => { if (!disposed) setGeometry(measureRail()) }
    update()
    const observer = new ResizeObserver(update)
    const scroller = conversationScroller()
    if (scroller !== null) observer.observe(scroller)
    window.addEventListener('resize', update)
    const poll = window.setInterval(update, 900)
    return () => {
      disposed = true
      observer.disconnect()
      window.removeEventListener('resize', update)
      window.clearInterval(poll)
    }
  }, [visible.length, current])

  // 当前位置：找最后一个锚点顶边越过视口上 1/3 线的轮次。
  useEffect(() => {
    const scroller = conversationScroller()
    if (scroller === null || visible.length === 0) return
    let frame = 0
    const onScroll = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const rect = scroller.getBoundingClientRect()
        const line = rect.top + rect.height * 0.35
        let active = -1
        for (let index = 0; index < visible.length; index += 1) {
          const key = visible[index]?.anchorKey
          if (key === undefined) continue
          const element = [...document.querySelectorAll<HTMLElement>('[data-chat-anchor-key]')]
            .find(candidate => candidate.dataset.chatAnchorKey === key)
          if (element !== undefined && element.getBoundingClientRect().top <= line) active = index
        }
        setActiveIndex(active)
      })
    }
    onScroll()
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      scroller.removeEventListener('scroll', onScroll)
    }
  }, [visible, current])

  if (visible.length === 0 || geometry === undefined) return null

  const jump = (index: number): void => {
    const turn = visible[index]
    if (turn === undefined) return
    void jumpToChatAnchor(turn.anchorKey, omitted + index, turns.length)
  }

  // 悬停缩略：直接读取聊天锚点已渲染的文本（前 180 字），不碰节点内部数据结构。
  const hoverTurn = hoverIndex >= 0 ? visible[hoverIndex] : undefined
  let hoverPreview: { title: string; snippet: string; top: number } | undefined
  if (hoverTurn !== undefined) {
    const anchor = hoverTurn.anchorKey === undefined
      ? undefined
      : [...document.querySelectorAll<HTMLElement>('[data-chat-anchor-key]')]
        .find(candidate => candidate.dataset.chatAnchorKey === hoverTurn.anchorKey)
    const snippet = (anchor?.textContent ?? '').replace(/\s+/gu, ' ').trim().slice(0, 180)
    const maxTop = window.innerHeight - 120
    hoverPreview = {
      title: `Turn ${String(hoverTurn.turn)}`,
      snippet: snippet === '' ? '该轮内容尚未渲染到聊天区' : snippet,
      top: Math.min(Math.max(hoverTop - 28, 8), maxTop),
    }
  }

  return (
    <nav
      className={css.rail}
      aria-label="会话导航轨"
      data-session-minimap
      style={{ top: geometry.top, height: geometry.height, left: geometry.left }}
      onMouseLeave={() => { setHoverIndex(-1) }}
    >
      <div className={css.track}>
        {visible.map((turn, index) => (
          <button
            key={turn.turn}
            type="button"
            className={css.tick}
            data-kind={tickKind(turn)}
            data-status={turn.status}
            data-active={index === activeIndex ? 'true' : undefined}
            title={`Turn ${String(turn.turn)} · 点击定位`}
            aria-label={`定位到第 ${String(turn.turn)} 轮`}
            onClick={() => { jump(index) }}
            onMouseEnter={event => {
              setHoverIndex(index)
              setHoverTop(event.currentTarget.getBoundingClientRect().top)
            }}
          >
            <i />
          </button>
        ))}
      </div>
      {hoverPreview !== undefined && (
        <div
          className={css.preview}
          style={{ top: hoverPreview.top - geometry.top }}
          role="tooltip"
          data-session-minimap-preview
        >
          <strong>{hoverPreview.title}</strong>
          <p>{hoverPreview.snippet}</p>
        </div>
      )}
    </nav>
  )
}
