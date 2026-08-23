import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  ContextBreakdownProjection, ContextPressureProjection, PersonalProjectionReader,
  TokenUsageProjection,
} from './contracts.ts'
import { trajectoryOf } from './contracts.ts'
import {
  estimateCost, formatEstimatedMoney, PRICING_SNAPSHOT_DATE, PRICING_TABLE_VERSION,
  type BillingCurrency, usageBuckets,
} from '../pricing.ts'
import { openBillingCenter } from './bridge.ts'
import css from './UsageBalanceControl.module.css'

type Props = PropsRuntime<'conversation.input.right'>

interface BalanceInfo {
  currency: BillingCurrency
  total: string
  granted: string
  toppedUp: string
}

type BalanceStatus =
  | { status: 'idle' | 'loading' }
  | { status: 'ready'; available: boolean; balances: readonly BalanceInfo[]; checkedAt: string }
  | { status: 'unconfigured' | 'authentication-failed' | 'rate-limited' | 'unavailable'; checkedAt: string }

interface CostView {
  amount: number
  currency: BillingCurrency
  model: string
  approximate: boolean
}

function currentTurnEstimate(
  snapshot: ConversationSnapshot,
  pressure: ContextPressureProjection | undefined,
  breakdown: ContextBreakdownProjection | undefined,
  currency: BillingCurrency,
  now: number,
): CostView | undefined {
  const trajectory = trajectoryOf(snapshot)
  if (trajectory === undefined) return undefined
  const assistantRequests = trajectory.requests.filter(request => request.purpose === 'assistant')
  const turns = [
    ...snapshot.chat.timeline.turnOrder,
    ...assistantRequests.map(request => request.turn),
    ...trajectory.runningCalls.map(call => call.turn),
  ]
  if (turns.length === 0) return undefined
  const turn = Math.max(...turns)
  const requests = assistantRequests.filter(request => request.turn === turn)
  let amount = 0
  let model = ''
  let measured = false
  let approximate = false
  for (const request of requests) {
    const config = request.requestConfig ?? request.prompt?.config
    if (config?.provider !== 'deepseek-official') continue
    model = config.model
    const usage = usageBuckets(request.usage)
    if (usage !== undefined) {
      const cost = estimateCost(usage, model, currency, request.startedAt)
      if (cost !== undefined) {
        amount += cost.amount
        measured = true
      }
      continue
    }
    if (request.status === 'running') {
      const projected = pressure?.projectedTokens
        ?? pressure?.pressureTokens
        ?? (breakdown === undefined
          ? undefined
          : breakdown.systemTokens + breakdown.toolsTokens + breakdown.messageTokens)
      if (projected !== undefined) {
        const cost = estimateCost({
          uncachedInputTokens: projected,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        }, model, currency, now)
        if (cost !== undefined) {
          amount += cost.amount
          measured = true
          approximate = true
        }
      }
    }
  }
  return measured && model !== '' ? { amount, currency, model, approximate } : undefined
}

function sessionEstimate(
  usage: TokenUsageProjection | undefined,
  snapshot: ConversationSnapshot,
  currency: BillingCurrency,
  now: number,
): CostView | undefined {
  if (usage === undefined) return undefined
  const trajectory = trajectoryOf(snapshot)
  const latest = [...(trajectory?.requests ?? [])].reverse().find((request) => {
    const config = request.requestConfig ?? (request.purpose === 'assistant' ? request.prompt?.config : undefined)
    return config?.provider === 'deepseek-official'
  })
  const config = latest?.requestConfig ?? (latest?.purpose === 'assistant' ? latest.prompt?.config : undefined)
  if (config?.provider !== 'deepseek-official') return undefined
  const cost = estimateCost(usage, config.model, currency, now)
  return cost === undefined ? undefined : {
    amount: cost.amount,
    currency,
    model: config.model,
    // Full-log buckets do not retain per-request price/model history.
    approximate: true,
  }
}

function balanceCopy(status: BalanceStatus): string {
  switch (status.status) {
    case 'idle': return '打开后查询官方余额'
    case 'loading': return '正在查询官方余额…'
    case 'unconfigured': return '尚未配置 DEEPSEEK_API_KEY'
    case 'authentication-failed': return 'API Key 无法通过余额鉴权'
    case 'rate-limited': return '余额接口请求过于频繁'
    case 'unavailable': return '暂时无法查询官方余额'
    case 'ready': return status.available ? '官方余额可用' : '官方余额不足'
  }
}

function chooseCurrency(balance: BalanceStatus): BillingCurrency {
  if (balance.status === 'ready' && balance.balances.some(item => item.currency === 'CNY')) return 'CNY'
  if (balance.status === 'ready' && balance.balances.some(item => item.currency === 'USD')) return 'USD'
  return 'CNY'
}

export function UsageBalanceControl({ useSession, useProjection }: Props): ReactNode {
  const snapshot = useSession(value => value)
  const usePersonalProjection = useProjection as PersonalProjectionReader
  const usage = usePersonalProjection('tokenUsage')
  const pressure = usePersonalProjection('contextPressure')
  const breakdown = usePersonalProjection('contextBreakdown')
  const [open, setOpen] = useState(false)
  const [balance, setBalance] = useState<BalanceStatus>({ status: 'idle' })
  const [notice, setNotice] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [panelStyle, setPanelStyle] = useState<{ right: number; bottom: number }>({ right: 16, bottom: 64 })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const currency = chooseCurrency(balance)
  const turn = useMemo(
    () => currentTurnEstimate(snapshot, pressure, breakdown, currency, now),
    [snapshot, pressure, breakdown, currency],
  )
  const session = useMemo(
    () => sessionEstimate(usage, snapshot, currency, now),
    [usage, snapshot, currency],
  )

  const loadBalance = async (force = false): Promise<void> => {
    setBalance({ status: 'loading' })
    try {
      const response = await fetch(`/__personal/usage-balance${force ? '?refresh=1' : ''}`, {
        headers: { accept: 'application/json', 'x-dsh-personal-client': '1' },
        credentials: 'same-origin',
      })
      const envelope = await response.json() as { ok?: boolean; data?: BalanceStatus }
      if (!response.ok || envelope.ok !== true || envelope.data === undefined) throw new Error('balance request failed')
      setBalance(envelope.data)
    } catch {
      setBalance({ status: 'unavailable', checkedAt: new Date().toISOString() })
    }
  }

  const positionPanel = (): void => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (rect === undefined) return
    setPanelStyle({
      right: Math.max(12, window.innerWidth - rect.right),
      bottom: Math.max(12, window.innerHeight - rect.top + 8),
    })
  }

  useEffect(() => {
    if (!open) return
    positionPanel()
    const closeOutside = (event: PointerEvent): void => {
      if (!(event.target instanceof Node)) return
      if (triggerRef.current?.contains(event.target) || panelRef.current?.contains(event.target)) return
      setOpen(false)
    }
    window.addEventListener('resize', positionPanel)
    document.addEventListener('pointerdown', closeOutside)
    return () => {
      window.removeEventListener('resize', positionPanel)
      document.removeEventListener('pointerdown', closeOutside)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    setNow(Date.now())
    const timer = setInterval(() => { setNow(Date.now()) }, 60_000)
    return () => { clearInterval(timer) }
  }, [open])

  const changeOpen = (): void => {
    const next = !open
    setOpen(next)
    setNotice(null)
    if (next && balance.status === 'idle') void loadBalance()
  }

  const topUp = async (): Promise<void> => {
    setNotice('正在打开隔离的 DeepSeek 充值页…')
    const result = await openBillingCenter()
    if (!result.ok) {
      setNotice('充值页打开失败；桌面 bridge 尚未可用或外部打开也失败。')
      return
    }
    setNotice(result.mode === 'isolated' ? '充值页已关闭，正在刷新余额…' : '已交给系统浏览器；正在刷新余额…')
    await loadBalance(true)
  }

  const buttonText = turn === undefined
    ? '用量'
    : `预计 ${formatEstimatedMoney(turn.amount, turn.currency)}`

  return (
    <div className={css.root}>
      <button
        ref={triggerRef}
        type="button"
        className={css.trigger}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="DeepSeek 用量与余额（金额均为预计，官方余额除外）"
        onClick={changeOpen}
      >
        <span className={css.coin}>¥</span><span>{buttonText}</span>
      </button>
      {open ? (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="DeepSeek 用量与余额"
          className={css.panel}
          style={panelStyle}
        >
          <header className={css.header}>
            <div><strong>用量与余额</strong><span>所有成本数字均为预计</span></div>
            <button type="button" aria-label="关闭" onClick={() => { setOpen(false) }}>×</button>
          </header>

          <div className={css.costGrid}>
            <div><span>当前 Turn</span><strong>{turn === undefined ? '暂无可估数据' : `预计 ${formatEstimatedMoney(turn.amount, turn.currency)}`}</strong><small>{turn?.approximate === true ? '运行中输入按未命中缓存估算；输出待 usage' : turn?.model ?? '等待 DeepSeek usage'}</small></div>
            <div><span>Session 累计</span><strong>{session === undefined ? '暂无可估数据' : `预计 ${formatEstimatedMoney(session.amount, session.currency)}`}</strong><small>{session === undefined ? '仅支持官方 DeepSeek V4 价格' : `${session.model} · 当前价等值`}</small></div>
          </div>

          <section className={css.balance}>
            <div className={css.sectionHeading}><strong>官方余额</strong><button disabled={balance.status === 'loading'} type="button" onClick={() => { void loadBalance(true) }}>刷新</button></div>
            <p data-state={balance.status}>{balanceCopy(balance)}</p>
            {balance.status === 'ready' ? balance.balances.map(item => (
              <div className={css.balanceRow} key={item.currency}>
                <span>{item.currency}</span><strong>{item.currency === 'CNY' ? '¥' : '$'}{item.total}</strong><small>充值 {item.toppedUp} · 赠金 {item.granted}</small>
              </div>
            )) : null}
          </section>

          <div className={css.actions}>
            <button className={css.primary} type="button" onClick={() => { void topUp() }}>充值中心</button>
            <span>{notice ?? '隔离页失败时由桌面主进程尝试系统浏览器'}</span>
          </div>

          <footer>
            价格表 {PRICING_TABLE_VERSION} · 快照 {PRICING_SNAPSHOT_DATE}；价格变化需随客户端更新。估算不替代 DeepSeek 账单。
          </footer>
        </div>
      ) : null}
    </div>
  )
}
