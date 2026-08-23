import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { WorkbenchService } from '@cyrus/dsh-workbench/client'
import {
  createProjectControlApi,
  documentRoleLabel,
  type PagedItems,
  type ProjectDecision,
  type ProjectEvent,
  type ProjectProgressUpdate,
  type ProjectReview,
  type ProjectReviewAction,
  type ProjectRun,
  type ProjectSessionBinding,
  type ProjectWorkItem,
  type WorkItemExecutionStatus,
} from './projectControlApi.ts'
import type { ProjectListItem } from './projectControlApi.ts'
import css from './ProjectConsole.module.css'

const api = createProjectControlApi()

const PREFS_KEY = '@cyrus/dsh-project-control:console-preferences:v1'

export interface ConsolePreferences {
  pinnedProjectIds: readonly string[]
  followSession: boolean
  /** 上次打开的项目控制台项目：重启后恢复该项目的控制台视图（undefined = 总览）。 */
  consoleProjectId: string | undefined
}

export function loadConsolePreferences(): ConsolePreferences {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(PREFS_KEY)
    if (raw === null) return { pinnedProjectIds: [], followSession: true, consoleProjectId: undefined }
    const parsed = JSON.parse(raw) as Partial<ConsolePreferences>
    return {
      pinnedProjectIds: Array.isArray(parsed.pinnedProjectIds)
        ? parsed.pinnedProjectIds.filter((item): item is string => typeof item === 'string').slice(0, 50)
        : [],
      followSession: parsed.followSession !== false,
      consoleProjectId: typeof parsed.consoleProjectId === 'string'
        && parsed.consoleProjectId.length > 0
        && parsed.consoleProjectId.length <= 200
        ? parsed.consoleProjectId
        : undefined,
    }
  } catch {
    return { pinnedProjectIds: [], followSession: true, consoleProjectId: undefined }
  }
}

export function saveConsolePreferences(preferences: ConsolePreferences): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(PREFS_KEY, JSON.stringify({
      pinnedProjectIds: [...preferences.pinnedProjectIds],
      followSession: preferences.followSession,
      consoleProjectId: preferences.consoleProjectId,
    }))
  } catch {
    // Storage denial/quota never breaks the console.
  }
}

type ConsoleTab =
  | 'overview'
  | 'checklist'
  | 'reviews'
  | 'runs'
  | 'activity'
  | 'documents'
  | 'sessions'

const TABS: ReadonlyArray<{ id: ConsoleTab; label: string }> = [
  { id: 'overview', label: '总览' },
  { id: 'checklist', label: '清单' },
  { id: 'reviews', label: '审阅' },
  { id: 'runs', label: '运行' },
  { id: 'activity', label: '动态' },
  { id: 'documents', label: '文档' },
  { id: 'sessions', label: '会话' },
]

interface TabData {
  workItems?: PagedItems<ProjectWorkItem>
  runs?: PagedItems<ProjectRun>
  updates?: PagedItems<ProjectProgressUpdate>
  reviews?: PagedItems<ProjectReview>
  decisions?: PagedItems<ProjectDecision>
  events?: PagedItems<ProjectEvent>
  bindings?: PagedItems<ProjectSessionBinding>
}

export function ProjectConsole({
  project,
  workbench,
  currentSessionId,
  pinned,
  onTogglePin,
  onBack,
}: {
  project: ProjectListItem
  workbench: WorkbenchService
  currentSessionId: string | undefined
  pinned: boolean
  onTogglePin(): void
  onBack(): void
}): ReactNode {
  const [tab, setTab] = useState<ConsoleTab>('overview')
  const [data, setData] = useState<TabData>({})
  const [error, setError] = useState<string>()
  const [mutation, setMutation] = useState<string>()
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setError(undefined)
    const loaders: Partial<Record<ConsoleTab, () => Promise<void>>> = {
      overview: async () => {
        const [workItems, runs, updates, reviews, decisions] = await Promise.all([
          api.listWorkItems(project.projectId, controller.signal),
          api.listRuns(project.projectId, undefined, controller.signal),
          api.listProgressUpdates(project.projectId, controller.signal),
          api.listReviews(project.projectId, controller.signal),
          api.listDecisions(project.projectId, controller.signal),
        ])
        if (controller.signal.aborted) return
        setData(current => ({ ...current, workItems, runs, updates, reviews, decisions }))
      },
      checklist: async () => {
        const workItems = await api.listWorkItems(project.projectId, controller.signal)
        if (controller.signal.aborted) return
        setData(current => ({ ...current, workItems }))
      },
      reviews: async () => {
        const reviews = await api.listReviews(project.projectId, controller.signal)
        if (controller.signal.aborted) return
        setData(current => ({ ...current, reviews }))
      },
      runs: async () => {
        const [runs, updates, workItems] = await Promise.all([
          api.listRuns(project.projectId, undefined, controller.signal),
          api.listProgressUpdates(project.projectId, controller.signal),
          api.listWorkItems(project.projectId, controller.signal),
        ])
        if (controller.signal.aborted) return
        setData(current => ({ ...current, runs, updates, workItems }))
      },
      activity: async () => {
        const events = await api.listEvents(project.projectId, undefined, controller.signal)
        if (controller.signal.aborted) return
        setData(current => ({ ...current, events }))
      },
      sessions: async () => {
        const bindings = await api.listSessions(project.projectId, controller.signal)
        if (controller.signal.aborted) return
        setData(current => ({ ...current, bindings }))
      },
    }
    const loader = loaders[tab]
    if (loader !== undefined) {
      void loader().catch(loadError => {
        if (controller.signal.aborted) return
        setError(errorMessage(loadError, '项目数据暂时无法读取。'))
      })
    }
    return () => { controller.abort() }
  }, [project.projectId, tab, reloadKey])

  const reload = useCallback(() => { setReloadKey(value => value + 1) }, [])

  const mutate = async (label: string, operation: () => Promise<unknown>): Promise<boolean> => {
    if (mutation !== undefined) return false
    setMutation(label)
    try {
      await operation()
      setReloadKey(value => value + 1)
      return true
    } catch (operationError) {
      setError(errorMessage(operationError, label + '没有完成。'))
      return false
    } finally {
      setMutation(undefined)
    }
  }

  return (
    <section
      className={css.console}
      aria-label={'项目控制台：' + project.name}
      data-personal-project-console
      data-console-tab={tab}
      data-project-console-project={project.projectId}
    >
      <header className={css.header}>
        <div className={css.headerMain}>
          <button className={css.backButton} type="button" onClick={onBack}>← 项目总览</button>
          <div>
            <h2>{project.name}</h2>
            <p className={css.projectId} title={project.projectId}>
              {project.projectId} · {registrationLabel(project.registrationMode)} · {project.lifecycle}
            </p>
          </div>
        </div>
        <div className={css.headerActions}>
          <button
            className={css.smallButton}
            type="button"
            data-browse-in-workbench
            title="在右侧工作台浏览该项目文件（切换为「跟随控制台」）"
            onClick={() => {
              // W1 Step D：显式命令——控制台项目成为 Workbench 浏览目标（Hub 在场转译为 follow-console）。
              workbench.setProjectWorkspace(project.projectId, '')
              workbench.reveal()
            }}
          >
            在工作台浏览
          </button>
          <button
            className={css.smallButton}
            type="button"
            data-pinned={pinned || undefined}
            aria-pressed={pinned}
            onClick={onTogglePin}
          >
            {pinned ? '📌 已置顶' : '置顶项目'}
          </button>
          <button className={css.iconButton} type="button" aria-label="刷新项目控制台" title="刷新" onClick={reload}>
            ↻
          </button>
        </div>
      </header>

      <nav className={css.tabs} role="tablist" aria-label="项目页面">
        {TABS.map(item => (
          <button
            key={item.id}
            className={css.tab}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            data-tab-id={item.id}
            onClick={() => { setTab(item.id) }}
          >
            {item.label}
            {item.id === 'checklist' && data.workItems !== undefined && <CountBadge value={data.workItems.total} />}
            {item.id === 'reviews' && data.reviews !== undefined && <CountBadge value={data.reviews.total} />}
            {item.id === 'runs' && data.runs !== undefined && <CountBadge value={data.runs.total} />}
          </button>
        ))}
      </nav>

      {error !== undefined && (
        <div className={css.errorBanner} role="alert">
          <span>{error}</span>
          <button className={css.smallButton} type="button" onClick={() => { setError(undefined); reload() }}>重试</button>
        </div>
      )}

      <div className={css.tabPanel} role="tabpanel">
        {tab === 'overview' && <OverviewTab data={data} project={project} onReload={reload} />}
        {tab === 'checklist' && <ChecklistTab data={data} project={project} mutation={mutation} onMutate={mutate} />}
        {tab === 'reviews' && <ReviewsTab data={data} project={project} mutation={mutation} onMutate={mutate} />}
        {tab === 'runs' && <RunsTab data={data} project={project} workbench={workbench} mutation={mutation} onMutate={mutate} />}
        {tab === 'activity' && <ActivityTab data={data} project={project} />}
        {tab === 'documents' && <DocumentsTab project={project} />}
        {tab === 'sessions' && (
          <SessionsTab
            data={data}
            currentSessionId={currentSessionId}
            followSession={loadConsolePreferences().followSession}
          />
        )}
      </div>
    </section>
  )
}
function CountBadge({ value }: { value: number }): ReactNode {
  return <span className={css.countBadge}>{value > 99 ? '99+' : String(value)}</span>
}

function OverviewTab({ data, project, onReload }: {
  data: TabData
  project: ProjectListItem
  onReload(): void
}): ReactNode {
  const workItems = data.workItems
  if (workItems === undefined || data.runs === undefined) {
    return <TabNotice kind="loading" copy="正在汇总项目概览…" />
  }
  const running = workItems.items.filter(item => item.executionStatus === 'running').length
  const blocked = workItems.items.filter(item => item.executionStatus === 'blocked').length
  const pendingReviews = workItems.items.filter(item => item.reviewStatus === 'pending').length
  const openRuns = data.runs.items.filter(run => run.status === 'running').length
  return (
    <div className={css.overview}>
      <div className={css.statGrid}>
        <StatCard label="任务" value={workItems.total} detail={String(running) + ' 执行中 · ' + String(blocked) + ' 阻塞'} />
        <StatCard label="运行" value={data.runs.total} detail={String(openRuns) + ' 运行中'} />
        <StatCard label="待审" value={pendingReviews} detail={pendingReviews === 0 ? '没有待处理审阅' : '需要你决定'} />
        <StatCard label="更新" value={data.updates?.total ?? 0} detail="来自 Agent 的标准日志" />
        <StatCard label="决定" value={data.decisions?.total ?? 0} detail="项目决策记录" />
      </div>
      <div className={css.overviewFacts}>
        <h3>登记信息</h3>
        <dl>
          <div><dt>关联模式</dt><dd>{registrationLabel(project.registrationMode)}</dd></div>
          <div><dt>生命周期</dt><dd>{project.lifecycle}</dd></div>
          <div><dt>最后更新</dt><dd>{project.updatedAt}</dd></div>
        </dl>
        <button className={css.smallButton} type="button" onClick={onReload}>刷新概览</button>
      </div>
    </div>
  )
}

function StatCard({ label, value, detail }: { label: string; value: number; detail: string }): ReactNode {
  return (
    <div className={css.statCard}>
      <strong>{String(value)}</strong>
      <span>{label}</span>
      <small>{detail}</small>
    </div>
  )
}

function ChecklistTab({ data, project, mutation, onMutate }: {
  data: TabData
  project: ProjectListItem
  mutation: string | undefined
  onMutate(label: string, operation: () => Promise<unknown>): Promise<boolean>
}): ReactNode {
  const workItems = data.workItems
  const [formOpen, setFormOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [instruction, setInstruction] = useState('')
  const [priority, setPriority] = useState('50')
  const [acceptance, setAcceptance] = useState('')

  if (workItems === undefined) return <TabNotice kind="loading" copy="正在读取任务清单…" />

  const submitCreate = async (): Promise<void> => {
    const trimmed = title.trim()
    if (trimmed.length === 0) return
    const acceptanceLines = acceptance.split(/\n/u).map(line => line.trim()).filter(line => line.length > 0)
    const ok = await onMutate('新建任务', () => api.createWorkItem(project.projectId, {
      title: trimmed,
      ...(instruction.trim() === '' ? {} : { instruction: instruction.trim() }),
      ...(acceptanceLines.length === 0 ? {} : { acceptance: acceptanceLines }),
      priority: Number(priority) || 50,
    }))
    if (ok) {
      setFormOpen(false)
      setTitle('')
      setInstruction('')
      setAcceptance('')
      setPriority('50')
    }
  }

  return (
    <div className={css.checklist}>
      <div className={css.sectionBar}>
        <h3>任务清单</h3>
        <button className={css.smallButton} type="button" onClick={() => { setFormOpen(value => !value) }}>
          {formOpen ? '收起表单' : '＋ 新建任务'}
        </button>
      </div>
      {formOpen && (
        <div className={css.createItemForm}>
          <label>
            <span>标题</span>
            <input type="text" maxLength={500} value={title} onChange={event => { setTitle(event.target.value) }} />
          </label>
          <label>
            <span>说明</span>
            <textarea maxLength={20_000} rows={2} value={instruction} onChange={event => { setInstruction(event.target.value) }} />
          </label>
          <label>
            <span>验收标准（每行一条）</span>
            <textarea rows={2} value={acceptance} onChange={event => { setAcceptance(event.target.value) }} />
          </label>
          <label>
            <span>优先级（0–100）</span>
            <input type="number" min={0} max={100} value={priority} onChange={event => { setPriority(event.target.value) }} />
          </label>
          <div className={css.formActions}>
            <button className={css.confirmButton} type="button" disabled={mutation !== undefined || title.trim() === ''} onClick={() => { void submitCreate() }}>
              {mutation === '新建任务' ? '正在创建…' : '创建'}
            </button>
          </div>
        </div>
      )}
      {workItems.items.length === 0 ? (
        <TabNotice kind="empty" copy="还没有任务。新建任务或等待 Agent 提交外部运行更新。" />
      ) : (
        <ul className={css.itemList}>
          {workItems.items.map(item => (
            <li className={css.itemCard} key={item.workItemId} data-execution={item.executionStatus} data-review={item.reviewStatus}>
              <div className={css.itemMain}>
                <span className={css.itemTopline}>
                  <strong>{item.title}</strong>
                  <span className={css.priorityBadge}>{'P' + String(item.priority)}</span>
                </span>
                {item.instruction !== null && <p className={css.itemInstruction}>{item.instruction}</p>}
                {item.acceptance.length > 0 && (
                  <ul className={css.acceptanceList}>
                    {item.acceptance.map((line, index) => <li key={String(index)}>✓ {line}</li>)}
                  </ul>
                )}
                <span className={css.itemMeta}>
                  <StatusBadge kind="execution" value={item.executionStatus} />
                  <StatusBadge kind="review" value={item.reviewStatus} />
                  <span>{'修订 ' + String(item.revision)}</span>
                </span>
              </div>
              <div className={css.itemActions}>
                {workItemCommands(item).map(command => (
                  <button
                    key={command.status}
                    className={css.smallButton}
                    type="button"
                    disabled={mutation !== undefined}
                    onClick={() => {
                      void onMutate(command.label, () => api.setWorkItemStatus(
                        project.projectId,
                        item.workItemId,
                        command.status,
                        item.revision,
                      ))
                    }}
                  >
                    {command.label}
                  </button>
                ))}
                {(item.reviewStatus === 'not_requested' || item.reviewStatus === 'changes_requested' || item.reviewStatus === 'rejected') && (
                  <button
                    className={css.confirmButton}
                    type="button"
                    disabled={mutation !== undefined}
                    onClick={() => { void onMutate('请求审阅', () => api.requestReview(project.projectId, item.workItemId, item.revision)) }}
                  >
                    请求审阅
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function workItemCommands(item: ProjectWorkItem): ReadonlyArray<{ status: WorkItemExecutionStatus; label: string }> {
  switch (item.executionStatus) {
    case 'draft': return [{ status: 'ready', label: '备好' }, { status: 'cancelled', label: '取消' }]
    case 'ready': return [{ status: 'running', label: '开始执行' }, { status: 'cancelled', label: '取消' }]
    case 'running': return [{ status: 'paused', label: '暂停' }, { status: 'cancelled', label: '取消' }]
    case 'paused': return [{ status: 'ready', label: '恢复待命' }, { status: 'running', label: '继续执行' }, { status: 'cancelled', label: '取消' }]
    case 'blocked': return [{ status: 'ready', label: '解除阻塞' }]
    default: return []
  }
}
function ReviewsTab({ data, project, mutation, onMutate }: {
  data: TabData
  project: ProjectListItem
  mutation: string | undefined
  onMutate(label: string, operation: () => Promise<unknown>): Promise<boolean>
}): ReactNode {
  const reviews = data.reviews
  const [openReviewId, setOpenReviewId] = useState<string>()
  const [comment, setComment] = useState('')
  const [rationale, setRationale] = useState('')
  const [actions, setActions] = useState<Record<string, PagedItems<ProjectReviewAction>>>({})

  useEffect(() => {
    if (openReviewId === undefined || reviews === undefined) return
    const controller = new AbortController()
    api.listReviewActions(project.projectId, openReviewId, controller.signal)
      .then(result => { if (!controller.signal.aborted) setActions(current => ({ ...current, [openReviewId]: result })) })
      .catch(() => {})
    return () => { controller.abort() }
  }, [project.projectId, openReviewId, reviews])

  if (reviews === undefined) return <TabNotice kind="loading" copy="正在读取审阅记录…" />
  if (reviews.items.length === 0) {
    return <TabNotice kind="empty" copy="还没有审阅。在清单页对任务发起“请求审阅”，通过、驳回和评论都会出现在这里。" />
  }
  return (
    <ul className={css.itemList}>
      {reviews.items.map(review => (
        <li className={css.itemCard} key={review.reviewId} data-review-status={review.status}>
          <button
            className={css.itemMain}
            type="button"
            onClick={() => { setOpenReviewId(current => current === review.reviewId ? undefined : review.reviewId) }}
          >
            <span className={css.itemTopline}>
              <strong>{workItemTitle(data, review.workItemId)}</strong>
              <StatusBadge kind="review-status" value={review.status} />
            </span>
            <span className={css.itemMeta}>
              <span>{'风险：' + review.risk}</span>
              <span>{'被审修订：' + (review.reviewedWorkItemRevision ?? '—')}</span>
              <span>{'审阅修订 ' + String(review.revision)}</span>
            </span>
          </button>
          {openReviewId === review.reviewId && (
            <div className={css.reviewDetail}>
              <ul className={css.actionList}>
                {(actions[review.reviewId]?.items ?? []).map(action => (
                  <li key={action.reviewActionId} data-action={action.action}>
                    <strong>{reviewActionLabel(action.action)}</strong>
                    <span>{action.comment ?? ''}</span>
                    <small>{action.createdAt}</small>
                  </li>
                ))}
                {(actions[review.reviewId]?.items.length ?? 0) === 0 && (
                  <li className={css.emptyCopy}>暂无审阅记录。</li>
                )}
              </ul>
              {review.status === 'requested' || review.status === 'in_review' ? (
                <div className={css.reviewDecide}>
                  <textarea
                    rows={2}
                    placeholder="决定理由（可选）"
                    value={rationale}
                    onChange={event => { setRationale(event.target.value) }}
                  />
                  <div className={css.formActions}>
                    <button
                      className={css.confirmButton}
                      type="button"
                      disabled={mutation !== undefined}
                      onClick={() => {
                        void onMutate('通过审阅', () => api.decideReview(project.projectId, review.reviewId, {
                          expectedRevision: review.revision,
                          decision: 'approve',
                          ...(rationale.trim() === '' ? {} : { rationale: rationale.trim() }),
                        })).then(ok => { if (ok) setRationale('') })
                      }}
                    >
                      通过
                    </button>
                    <button
                      className={css.smallButton}
                      type="button"
                      disabled={mutation !== undefined}
                      onClick={() => {
                        void onMutate('要求修改', () => api.decideReview(project.projectId, review.reviewId, {
                          expectedRevision: review.revision,
                          decision: 'request_changes',
                          ...(rationale.trim() === '' ? {} : { rationale: rationale.trim() }),
                        })).then(ok => { if (ok) setRationale('') })
                      }}
                    >
                      要求修改
                    </button>
                    <button
                      className={css.smallButton}
                      type="button"
                      disabled={mutation !== undefined}
                      onClick={() => {
                        void onMutate('驳回审阅', () => api.decideReview(project.projectId, review.reviewId, {
                          expectedRevision: review.revision,
                          decision: 'reject',
                          ...(rationale.trim() === '' ? {} : { rationale: rationale.trim() }),
                        })).then(ok => { if (ok) setRationale('') })
                      }}
                    >
                      驳回
                    </button>
                  </div>
                </div>
              ) : (
                <div className={css.reviewDecide}>
                  <textarea
                    rows={2}
                    placeholder="追加评论"
                    value={comment}
                    onChange={event => { setComment(event.target.value) }}
                  />
                  <div className={css.formActions}>
                    <button
                      className={css.smallButton}
                      type="button"
                      disabled={mutation !== undefined || comment.trim() === ''}
                      onClick={() => {
                        void onMutate('评论审阅', () => api.commentReview(project.projectId, review.reviewId, comment.trim()))
                          .then(ok => { if (ok) setComment('') })
                      }}
                    >
                      评论
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}

function workItemTitle(data: TabData, workItemId: string | null): string {
  if (workItemId === null) return '（无关联任务）'
  return data.workItems?.items.find(item => item.workItemId === workItemId)?.title ?? workItemId
}

function reviewActionLabel(action: string): string {
  switch (action) {
    case 'comment': return '评论'
    case 'request_changes': return '要求修改'
    case 'approve': return '通过'
    case 'reject': return '驳回'
    case 'supersede': return '已替代'
    default: return action
  }
}
function RunsTab({ data, project, workbench, mutation, onMutate }: {
  data: TabData
  project: ProjectListItem
  workbench: WorkbenchService
  mutation: string | undefined
  onMutate(label: string, operation: () => Promise<unknown>): Promise<boolean>
}): ReactNode {
  const runs = data.runs
  if (runs === undefined) return <TabNotice kind="loading" copy="正在读取运行记录…" />
  if (runs.items.length === 0) {
    return <TabNotice kind="empty" copy="还没有运行。外部 Agent 管线绑定线程后会在这里出现运行与进展更新。" />
  }
  const updates = data.updates?.items ?? []
  return (
    <div className={css.runs}>
      <ul className={css.itemList}>
        {runs.items.map(run => {
          const runUpdates = updates.filter(update => update.runId === run.runId)
          const workItem = data.workItems?.items.find(item => item.workItemId === run.workItemId)
          return (
            <li className={css.itemCard} key={run.runId} data-run-status={run.status}>
              <div className={css.itemMain}>
                <span className={css.itemTopline}>
                  <strong>{(workItem?.title ?? run.workItemId) + ' · 第 ' + String(run.attemptNo) + ' 次'}</strong>
                  <StatusBadge kind="run" value={run.status} />
                </span>
                <span className={css.itemMeta}>
                  <span title={run.runId}>{run.runId}</span>
                  <span>{'修订 ' + String(run.revision)}</span>
                  {run.startedAt !== null && <span>{'开始于 ' + run.startedAt}</span>}
                  {run.completedAt !== null && <span>{'完成于 ' + run.completedAt}</span>}
                </span>
              </div>
              <div className={css.itemActions}>
                {run.status === 'queued' && (
                  <button
                    className={css.confirmButton}
                    type="button"
                    disabled={mutation !== undefined}
                    onClick={() => { void onMutate('启动运行', () => api.startRun(project.projectId, run.runId, run.revision)) }}
                  >
                    启动
                  </button>
                )}
              </div>
              {runUpdates.length > 0 && (
                <ul className={css.updateList}>
                  {runUpdates.map(update => (
                    <li key={update.progressUpdateId} data-kind={update.kind}>
                      <button
                        className={css.updateMain}
                        type="button"
                        onClick={() => { openUpdate(workbench, project.projectId, update) }}
                      >
                        <span className={css.itemTopline}>
                          <strong>{update.summary}</strong>
                          {update.completionPercent !== null && <span>{String(update.completionPercent) + '%'}</span>}
                        </span>
                        <span className={css.itemMeta}>
                          <UpdateKindBadge kind={update.kind} />
                          <span>{update.createdAt}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function openUpdate(workbench: WorkbenchService, projectId: string, update: ProjectProgressUpdate): void {
  workbench.open({
    family: 'artifact',
    viewerId: 'project-control.progress-update',
    resourceKey: projectId + ':upd:' + update.progressUpdateId,
    title: update.summary.slice(0, 40),
  })
}

function UpdateKindBadge({ kind }: { kind: ProjectProgressUpdate['kind'] }): ReactNode {
  return <span className={css.updateKindBadge} data-kind={kind}>{progressKindLabel(kind)}</span>
}

function progressKindLabel(kind: ProjectProgressUpdate['kind']): string {
  switch (kind) {
    case 'progress': return '进展'
    case 'blocker': return '阻塞'
    case 'completion_declared': return '完成声明'
  }
}
function ActivityTab({ data, project }: { data: TabData; project: ProjectListItem }): ReactNode {
  const events = data.events
  const [tail, setTail] = useState<readonly ProjectEvent[]>([])
  if (events === undefined) return <TabNotice kind="loading" copy="正在读取项目动态…" />
  const items = [...events.items, ...tail]
  const lastSequence = items.length === 0 ? undefined : items[items.length - 1]?.sequence
  return (
    <div className={css.activity}>
      <p className={css.emptyCopy}>
        {'项目领域事件流（注册、任务、运行、审阅与外部更新），共 ' + String(events.total) + ' 条。'}
      </p>
      {items.length === 0 ? (
        <TabNotice kind="empty" copy="还没有事件。" />
      ) : (
        <ul className={css.eventList}>
          {items.map(event => (
            <li key={event.eventId} data-aggregate={event.aggregateType}>
              <span className={css.eventDot} aria-hidden="true" />
              <div className={css.eventMain}>
                <strong>{event.eventType}</strong>
                <span className={css.eventAggregate}>
                  {event.aggregateType + ' ' + event.aggregateId.slice(0, 18) + '… · rev ' + String(event.beforeRevision) + '→' + String(event.afterRevision)}
                </span>
                {Object.keys(event.data).length > 0 && (
                  <code className={css.eventData}>{JSON.stringify(event.data).slice(0, 240)}</code>
                )}
              </div>
              <span className={css.eventTime}>{event.recordedAt}</span>
            </li>
          ))}
        </ul>
      )}
      {lastSequence !== undefined && items.length < events.total && (
        <button
          className={css.smallButton}
          type="button"
          onClick={() => {
            void api.listEvents(project.projectId, lastSequence).then(page => {
              setTail(current => [...current, ...page.items])
            }).catch(() => {})
          }}
        >
          加载更多
        </button>
      )}
    </div>
  )
}

function DocumentsTab({ project }: { project: ProjectListItem }): ReactNode {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [index, setIndex] = useState<Awaited<ReturnType<typeof api.getProjectDocuments>>>()
  const [message, setMessage] = useState<string>()

  useEffect(() => {
    const controller = new AbortController()
    setState('loading')
    setMessage(undefined)
    api.getProjectDocuments(project.projectId, controller.signal)
      .then(result => { if (!controller.signal.aborted) { setIndex(result); setState('ready') } })
      .catch(loadError => {
        if (controller.signal.aborted) return
        setState('error')
        setMessage(errorMessage(loadError, '文档索引暂时无法读取。'))
      })
    return () => { controller.abort() }
  }, [project.projectId])

  if (state === 'loading') return <TabNotice kind="loading" copy="正在核对项目文档…" />
  if (state === 'error') return <TabNotice kind="error" copy={message ?? '文档索引暂时无法读取。'} />
  if (index === undefined) return <TabNotice kind="empty" copy="没有文档索引。" />
  return (
    <div className={css.documents}>
      <p className={css.emptyCopy}>
        {'来源：' + (index.mode === 'managed' ? 'manifest 绑定（受管理）' : '已确认绑定（只关联）')}
        {index.locationDisplayPath !== null && <span title={index.locationDisplayPath}>{' · ' + index.locationDisplayPath}</span>}
      </p>
      {index.documents.length === 0 ? (
        <TabNotice kind="empty" copy="该项目没有文档绑定。" />
      ) : (
        <ul className={css.itemList}>
          {index.documents.map(document => (
            <li className={css.itemCard} key={document.role + '\u0000' + document.relativePath} data-document-state={document.state}>
              <div className={css.itemMain}>
                <span className={css.itemTopline}>
                  <strong>{documentRoleLabel(document.role)}</strong>
                  <span className={css.documentPath} title={document.relativePath}>{document.relativePath}</span>
                </span>
                <span className={css.itemMeta}>
                  <span>{documentStateLabel(document.state)}</span>
                  {document.contentHash !== null && <span title={document.contentHash}>{document.contentHash.slice(0, 18)}</span>}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function SessionsTab({ data, currentSessionId, followSession }: {
  data: TabData
  currentSessionId: string | undefined
  followSession: boolean
}): ReactNode {
  const bindings = data.bindings
  if (bindings === undefined) return <TabNotice kind="loading" copy="正在读取会话绑定…" />
  if (bindings.items.length === 0) {
    return <TabNotice kind="empty" copy="还没有会话绑定。Agent 管线绑定 run→thread 后会出现这里。" />
  }
  const current = bindings.items.filter(binding => binding.sessionId === currentSessionId)
  return (
    <div className={css.sessions}>
      {followSession && currentSessionId !== undefined && (
        <p className={css.followBanner} role="status">
          {current.length === 0
            ? '跟随当前会话：该项目还没有绑定当前会话。'
            : '跟随当前会话：' + String(current.length) + ' 个绑定与当前会话一致。'}
        </p>
      )}
      <ul className={css.itemList}>
        {bindings.items.map(binding => (
          <li
            className={css.itemCard}
            key={binding.bindingId}
            data-current-session={binding.sessionId === currentSessionId || undefined}
          >
            <div className={css.itemMain}>
              <span className={css.itemTopline}>
                <strong>{'线程 ' + binding.threadId}</strong>
                {binding.sessionId === currentSessionId && <span className={css.currentBadge}>当前会话</span>}
              </span>
              <span className={css.itemMeta}>
                <span title={binding.runId}>{'run ' + binding.runId.slice(0, 18) + '…'}</span>
                <span>{'session ' + binding.sessionId}</span>
                <span>{binding.harnessInstanceRef}</span>
              </span>
            </div>
            <span className={css.eventTime}>{binding.createdAt}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function StatusBadge({ kind, value }: { kind: 'execution' | 'review' | 'review-status' | 'run'; value: string }): ReactNode {
  return <span className={css.statusBadge} data-kind={kind} data-value={value}>{statusLabel(value)}</span>
}

function statusLabel(value: string): string {
  switch (value) {
    case 'draft': return '草稿'
    case 'ready': return '待命'
    case 'running': return '执行中'
    case 'paused': return '已暂停'
    case 'blocked': return '阻塞'
    case 'completed': return '已完成'
    case 'cancelled': return '已取消'
    case 'not_requested': return '未请求审阅'
    case 'pending': return '待审'
    case 'changes_requested': return '要求修改'
    case 'approved': return '已通过'
    case 'rejected': return '已驳回'
    case 'requested': return '审阅中'
    case 'in_review': return '复核中'
    case 'superseded': return '已替代'
    case 'queued': return '排队'
    case 'failed': return '失败'
    case 'orphaned': return '失联'
    default: return value
  }
}

function documentStateLabel(state: string): string {
  switch (state) {
    case 'ok': return '一致'
    case 'changed': return '内容已变化'
    case 'missing': return '缺失'
    case 'unreadable': return '无法读取'
    default: return state
  }
}

function TabNotice({ kind, copy }: { kind: 'loading' | 'empty' | 'error'; copy: string }): ReactNode {
  return (
    <div className={css.tabNotice} role={kind === 'error' ? 'alert' : 'status'} data-kind={kind}>
      {copy}
    </div>
  )
}

function registrationLabel(mode: ProjectListItem['registrationMode']): string {
  if (mode === 'managed') return '受管理'
  if (mode === 'linked_legacy') return '只关联'
  return '状态未知'
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback
}