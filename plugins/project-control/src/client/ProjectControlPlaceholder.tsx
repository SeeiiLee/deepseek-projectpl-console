import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { WorkbenchService } from '@cyrus/dsh-workbench/client'
import type { ProjectControlPlaceholderProps } from './contract.ts'
import {
  createProjectControlApi,
  documentRoleLabel,
  selectUserInitiatedRelocationCandidate,
  type CandidateCenterView,
  type IntakeCandidateList,
  type IntakeScanResult,
  type IntakeScanMode,
  type PrepareCreateResult,
  type ProjectCandidate,
  type ProjectControlStatus,
  type ProjectDocumentIndex,
  type ProjectDocumentRebindProposal,
  type ProjectDocumentState,
  type ProjectList,
  type ProjectListItem,
  type ProjectListView,
  type ProjectStorageState,
  type ProjectTemplateSummary,
} from './projectControlApi.ts'
import {
  hasProjectControlDirectoryBridge,
  selectProjectDirectory,
  type AuthorizedDirectorySelection,
} from './directoryBridge.ts'
import { subscribeProjectControlChanges } from './projectControlEvents.ts'
import {
  assessNativeRebindPreflight,
  nativeRebindPreflightMessage,
  type NativeWorkspaceHistoryBridge,
} from './nativeWorkspaceHistory.ts'
import {
  loadConsolePreferences,
  ProjectConsole,
  saveConsolePreferences,
} from './ProjectConsole.tsx'
import css from './ProjectControlPlaceholder.module.css'

const api = createProjectControlApi()

const MEMORY_CONTEXT_ENDPOINT = '/__personal/memory/context'

/**
 * 通知记忆插件「当前会话 ↔ 项目」绑定（P3-2 自动提取的项目归属桥）。
 * 失败静默：记忆插件可能未加载或未开启提取，绝不影响控制台主流程。
 */
function notifyMemoryProjectBinding(projectId: string | undefined, sessionId: string | undefined): void {
  if (sessionId === undefined) return
  void fetch(MEMORY_CONTEXT_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-dsh-console': '1' },
    body: JSON.stringify({ sessionId, projectId: projectId ?? null }),
  }).catch(() => {})
}

interface ReadyLoadState {
  kind: 'ready'
  status: ProjectControlStatus
  activeList?: ProjectList
  activeListError?: string
  archivedList?: ProjectList
  archivedListError?: string
  consoleProject?: ProjectListItem
  candidatePage: IntakeCandidateList
  candidateError?: string
}

type LoadState =
  | { kind: 'loading' }
  | ReadyLoadState
  | { kind: 'error'; message: string }

type ScanState =
  | { kind: 'idle' }
  | { kind: 'selecting'; mode: IntakeScanMode }
  | { kind: 'scanning'; mode: IntakeScanMode; path: string }
  | { kind: 'success'; message: string; path: string }
  | { kind: 'error'; message: string }

interface CreateForm {
  parent: AuthorizedDirectorySelection
  directoryName: string
  name: string
  templates: readonly ProjectTemplateSummary[]
  templatesError?: string
  templateId: string
}

type CreateState =
  | { kind: 'idle' }
  | { kind: 'picking' }
  | { kind: 'form'; form: CreateForm }
  | { kind: 'preparing'; form: CreateForm }
  | { kind: 'preview'; form: CreateForm; preview: PrepareCreateResult }
  | { kind: 'submitting'; form: CreateForm; preview: PrepareCreateResult }
  | { kind: 'success'; message: string; projectId: string }
  | { kind: 'error'; message: string; form?: CreateForm; preview?: PrepareCreateResult }

type ProjectMutation =
  | { projectId: string; action: 'archive' | 'unarchive' | 'relocate' }

interface ProjectNotice {
  kind: 'success' | 'error'
  message: string
}

type Props = ProjectControlPlaceholderProps & {
  workbench: WorkbenchService
  nativeHistory: NativeWorkspaceHistoryBridge
}

type DocumentPanelState =
  | { kind: 'idle' }
  | { kind: 'loading'; projectId: string }
  | { kind: 'ready'; index: ProjectDocumentIndex; error?: string }
  | { kind: 'error'; message: string }

export function ProjectControlPlaceholder(props: Props): ReactNode {
  const { nativeHistory, workbench } = props
  const currentSessionId = props.useSessions((state) => {
    const current = state.current
    return current !== undefined && state.byId[current]?.blank === false ? String(current) : undefined
  })
  const [reloadKey, setReloadKey] = useState(0)
  const [loadState, setLoadState] = useState<LoadState>({ kind: 'loading' })
  const [scanState, setScanState] = useState<ScanState>({ kind: 'idle' })
  const [createState, setCreateState] = useState<CreateState>({ kind: 'idle' })
  const [candidateMutation, setCandidateMutation] = useState<string | undefined>()
  const [candidateView, setCandidateView] = useState<CandidateCenterView | 'projects'>('projects')
  const [candidateSearchInput, setCandidateSearchInput] = useState('')
  const [candidateSearch, setCandidateSearch] = useState('')
  const [candidateCursor, setCandidateCursor] = useState<string | undefined>()
  const [candidateCursorHistory, setCandidateCursorHistory] = useState<Array<string | undefined>>([])
  const [selectedCandidates, setSelectedCandidates] = useState<Record<string, number>>({})
  const [projectListView, setProjectListView] = useState<ProjectListView>('active')
  const [projectSearchInput, setProjectSearchInput] = useState('')
  const [projectSearch, setProjectSearch] = useState('')
  const [projectCursor, setProjectCursor] = useState<string | undefined>()
  const [projectCursorHistory, setProjectCursorHistory] = useState<Array<string | undefined>>([])
  const [projectMutation, setProjectMutation] = useState<ProjectMutation | undefined>()
  const [projectNotice, setProjectNotice] = useState<ProjectNotice | undefined>()
  const [documentPanel, setDocumentPanel] = useState<DocumentPanelState>({ kind: 'idle' })
  const [documentMutation, setDocumentMutation] = useState<string | undefined>()
  const [rebindChoices, setRebindChoices] = useState<Record<string, string>>({})
  // 重启后恢复上次打开的项目控制台（项目已删除时回落到总览）。
  const [consoleProjectId, setConsoleProjectId] = useState<string | undefined>(() => loadConsolePreferences().consoleProjectId)
  const [preferences, setPreferences] = useState(() => loadConsolePreferences())

  // 打开控制台项目或切换会话时，把当前会话↔项目绑定同步给记忆插件。
  useEffect(() => {
    if (consoleProjectId === undefined) return
    notifyMemoryProjectBinding(consoleProjectId, currentSessionId)
  }, [consoleProjectId, currentSessionId])

  useEffect(() => subscribeProjectControlChanges(() => {
    setReloadKey(value => value + 1)
  }), [])

  useEffect(() => {
    const controller = new AbortController()
    setLoadState({ kind: 'loading' })
    api.getStatus(controller.signal).then(async status => {
      const projectOptions = (view: ProjectListView) => ({
        view,
        limit: view === projectListView ? 25 : 1,
        ...(projectSearch === '' ? {} : { search: projectSearch }),
        ...(view !== projectListView || projectCursor === undefined ? {} : { afterProjectId: projectCursor }),
      })
      const consoleProjectRequest = consoleProjectId === undefined
        ? Promise.resolve(undefined)
        : api.listProjects({ view: 'active', search: consoleProjectId, limit: 1 }, controller.signal)
            .then(list => list.projects.find(project => project.projectId === consoleProjectId))
      const [activeListResult, archivedListResult, candidateResult, consoleProjectResult] = await Promise.allSettled([
        api.listProjects(projectOptions('active'), controller.signal),
        api.listProjects(projectOptions('archived'), controller.signal),
        api.listCandidates({
          view: candidateView === 'projects' ? 'review' : candidateView,
          limit: 25,
          ...(candidateView === 'projects' || candidateSearch === '' ? {} : { search: candidateSearch }),
          ...(candidateCursor === undefined ? {} : { afterCandidateId: candidateCursor }),
        }, controller.signal),
        consoleProjectRequest,
      ])
      if (controller.signal.aborted) return
      setLoadState({
        kind: 'ready',
        status,
        ...(activeListResult.status === 'fulfilled'
          ? { activeList: activeListResult.value }
          : { activeListError: errorMessage(activeListResult.reason, '使用中的项目暂时无法读取。') }),
        ...(archivedListResult.status === 'fulfilled'
          ? { archivedList: archivedListResult.value }
          : { archivedListError: errorMessage(archivedListResult.reason, '已归档项目暂时无法读取。') }),
        ...(consoleProjectResult.status === 'fulfilled' && consoleProjectResult.value !== undefined
          ? { consoleProject: consoleProjectResult.value }
          : {}),
        candidatePage: candidateResult.status === 'fulfilled'
          ? candidateResult.value
          : { candidates: [], total: 0, counts: { review: 0, ignored: 0, history: 0 }, nextCursor: null },
        ...(candidateResult.status === 'fulfilled'
          ? {}
          : { candidateError: errorMessage(candidateResult.reason, '扫描候选暂时无法读取。') }),
      })
    }, error => {
      if (controller.signal.aborted) return
      setLoadState({ kind: 'error', message: errorMessage(error, '项目控制台状态读取失败。') })
    })
    return () => { controller.abort() }
  }, [candidateCursor, candidateSearch, candidateView, projectCursor, projectListView, projectSearch, reloadKey])

  const reload = useCallback(() => { setReloadKey(value => value + 1) }, [])

  const beginScan = async (mode: IntakeScanMode): Promise<void> => {
    if (scanState.kind === 'selecting' || scanState.kind === 'scanning') return
    setScanState({ kind: 'selecting', mode })
    const outcome = await selectProjectDirectory(mode)
    if (outcome.kind === 'cancelled') {
      setScanState({ kind: 'idle' })
      return
    }
    if (outcome.kind === 'error') {
      setScanState({ kind: 'error', message: outcome.message })
      return
    }
    setScanState({ kind: 'scanning', mode, path: outcome.selection.path })
    try {
      const result = await api.scan(mode, outcome.selection)
      setCandidateView('review')
      setCandidateCursor(undefined)
      setCandidateCursorHistory([])
      setSelectedCandidates({})
      reload()
      setScanState({
        kind: 'success',
        path: result.sourceRoot.path,
        message: (result.candidates.length === 0
          ? '扫描完成，没有发现新的项目候选。'
          : `扫描完成，发现 ${String(result.candidates.length)} 个项目候选。`)
          + scanIssueMessage(result.issues),
      })
    } catch (error) {
      setScanState({ kind: 'error', message: errorMessage(error, '目录扫描没有完成。') })
    }
  }

  const toggleIgnored = async (candidate: ProjectCandidate): Promise<void> => {
    if (candidateMutation !== undefined) return
    setCandidateMutation(candidate.candidateId)
    try {
      const updated = await api.setCandidateIgnored(
        candidate.candidateId,
        !candidate.ignored,
        candidate.revision,
      )
      if (updated.candidateId === candidate.candidateId) reload()
    } catch (error) {
      setScanState({ kind: 'error', message: errorMessage(error, '候选状态没有更新。') })
    } finally {
      setCandidateMutation(undefined)
    }
  }

  const chooseCandidateView = (view: CandidateCenterView | 'projects'): void => {
    setCandidateView(view)
    setCandidateCursor(undefined)
    setCandidateCursorHistory([])
    setSelectedCandidates({})
  }

  const applyCandidateSearch = (): void => {
    setCandidateSearch(candidateSearchInput.trim())
    setCandidateCursor(undefined)
    setCandidateCursorHistory([])
    setSelectedCandidates({})
  }

  const chooseProjectListView = (view: ProjectListView): void => {
    setProjectListView(view)
    setProjectCursor(undefined)
    setProjectCursorHistory([])
  }

  const applyProjectSearch = (): void => {
    setProjectSearch(projectSearchInput.trim())
    setProjectCursor(undefined)
    setProjectCursorHistory([])
  }

  const nextProjectPage = (): void => {
    if (loadState.kind !== 'ready') return
    const list = projectListView === 'active' ? loadState.activeList : loadState.archivedList
    if (list?.nextCursor === null || list?.nextCursor === undefined) return
    setProjectCursorHistory(current => [...current, projectCursor])
    setProjectCursor(list.nextCursor)
  }

  const previousProjectPage = (): void => {
    if (projectCursorHistory.length === 0) return
    const previous = projectCursorHistory[projectCursorHistory.length - 1]
    setProjectCursorHistory(current => current.slice(0, -1))
    setProjectCursor(previous)
  }

  const selectCandidate = (candidate: ProjectCandidate, selected: boolean): void => {
    setSelectedCandidates(current => {
      const next = { ...current }
      if (selected) next[candidate.candidateId] = candidate.revision
      else delete next[candidate.candidateId]
      return next
    })
  }

  const selectCandidatePage = (candidates: readonly ProjectCandidate[], selected: boolean): void => {
    setSelectedCandidates(current => {
      const next = { ...current }
      for (const candidate of candidates) {
        if (selected) next[candidate.candidateId] = candidate.revision
        else delete next[candidate.candidateId]
      }
      return next
    })
  }

  const mutateSelectedCandidates = async (): Promise<void> => {
    if (loadState.kind !== 'ready' || !['review', 'ignored'].includes(candidateView)) return
    const selectedCandidatesOnPage = loadState.candidatePage.candidates
      .filter(candidate => selectedCandidates[candidate.candidateId] === candidate.revision)
    const selected = selectedCandidatesOnPage
      .map(candidate => ({ candidateId: candidate.candidateId, expectedRevision: candidate.revision }))
    if (selected.length === 0 || candidateMutation !== undefined) return
    const ignored = candidateView === 'review'
    const action = ignored ? '忽略' : '恢复'
    const preview = selectedCandidatesOnPage.slice(0, 10)
      .map(candidate => `- ${statusLabel(candidate.status)}：${candidatePathPreview(candidate.rootPath)}`)
      .join('\n')
    const remaining = selectedCandidatesOnPage.length > 10
      ? `\n- 另有 ${String(selectedCandidatesOnPage.length - 10)} 项未展开`
      : ''
    if (!globalThis.confirm(
      `即将${action}当前页选中的 ${String(selected.length)} 个候选。\n\n${preview}${remaining}\n\n该操作保留历史且可恢复，是否继续？`,
    )) return
    setCandidateMutation('batch')
    try {
      await api.setCandidatesIgnored(selected, ignored)
      setSelectedCandidates({})
      reload()
    } catch (error) {
      setScanState({ kind: 'error', message: errorMessage(error, `批量${action}没有完成；本批次未部分生效。`) })
    } finally {
      setCandidateMutation(undefined)
    }
  }

  const nextCandidatePage = (): void => {
    if (loadState.kind !== 'ready' || loadState.candidatePage.nextCursor === null) return
    setCandidateCursorHistory(current => [...current, candidateCursor])
    setCandidateCursor(loadState.candidatePage.nextCursor)
    setSelectedCandidates({})
  }

  const previousCandidatePage = (): void => {
    if (candidateCursorHistory.length === 0) return
    const previous = candidateCursorHistory[candidateCursorHistory.length - 1]
    setCandidateCursorHistory(current => current.slice(0, -1))
    setCandidateCursor(previous)
    setSelectedCandidates({})
  }

  const openCandidate = (candidate: ProjectCandidate): void => {
    workbench.open({
      family: 'details',
      viewerId: 'project-control.candidate-details',
      resourceKey: candidate.candidateId,
      title: candidate.suggestedName,
    })
  }

  const setProjectArchived = async (project: ProjectListItem, archived: boolean): Promise<void> => {
    if (projectMutation !== undefined) return
    const action = archived ? '归档' : '恢复'
    if (archived && !globalThis.confirm(
      `即将归档“${project.name}”。\n\n归档后项目会从使用中列表隐藏，并禁止新会话绑定；项目身份、位置历史和审计记录都会保留，之后可恢复。是否继续？`,
    )) return
    setProjectMutation({ projectId: project.projectId, action: archived ? 'archive' : 'unarchive' })
    setProjectNotice(undefined)
    try {
      await api.setProjectArchived(project.projectId, archived, project.revision)
      setProjectNotice({
        kind: 'success',
        message: archived
          ? `“${project.name}”已归档，可在“已归档”中恢复。`
          : `“${project.name}”已恢复到使用中项目。`,
      })
      setProjectListView(archived ? 'archived' : 'active')
      setProjectCursor(undefined)
      setProjectCursorHistory([])
      reload()
    } catch (error) {
      setProjectNotice({ kind: 'error', message: errorMessage(error, `${action}项目没有完成。`) })
    } finally {
      setProjectMutation(undefined)
    }
  }

  const beginWorkspaceChange = async (project: ProjectListItem): Promise<void> => {
    if (projectMutation !== undefined) return
    setProjectMutation({ projectId: project.projectId, action: 'relocate' })
    setProjectNotice(undefined)
    try {
      const outcome = await selectProjectDirectory('project-root')
      if (outcome.kind === 'cancelled') return
      if (outcome.kind === 'error') throw new Error(outcome.message)
      const continuity = await api.getProjectWorkspaceContinuity(project.projectId)
      const nativePreflight = assessNativeRebindPreflight(
        continuity,
        nativeHistory.snapshot(),
        outcome.selection.path,
      )
      if (nativePreflight.status === 'blocked') {
        throw new Error(nativeRebindPreflightMessage(nativePreflight))
      }
      if (nativePreflight.status === 'warning'
        && !globalThis.confirm(nativeRebindPreflightMessage(nativePreflight))) return
      const result = await api.scan('project-root', outcome.selection)
      const candidate = selectUserInitiatedRelocationCandidate(project.projectId, outcome.selection.path, result)
      setCandidateView('review')
      setCandidateSearchInput('')
      setCandidateSearch('')
      setCandidateCursor(undefined)
      setCandidateCursorHistory([])
      setSelectedCandidates({})
      setProjectNotice({
        kind: 'success',
        message: `已生成“${project.name}”的位置变更候选；请在详情中核对后确认重新绑定。`,
      })
      reload()
      openCandidate(candidate)
    } catch (error) {
      setProjectNotice({
        kind: 'error',
        message: errorMessage(error, '目标目录未形成可安全确认的位置变更候选，已停止。'),
      })
    } finally {
      setProjectMutation(undefined)
    }
  }

  const beginCreate = async (): Promise<void> => {
    if (createState.kind === 'picking') return
    setCreateState({ kind: 'picking' })
    const outcome = await selectProjectDirectory('create-parent')
    if (outcome.kind !== 'selected') {
      setCreateState(outcome.kind === 'error'
        ? { kind: 'error', message: outcome.message }
        : { kind: 'idle' })
      return
    }
    let templates: readonly ProjectTemplateSummary[] = []
    let templatesError: string | undefined
    try {
      templates = (await api.listTemplates()).templates
    } catch (error) {
      templatesError = errorMessage(error, '模板列表暂时无法读取，请点击右上角刷新后重试。')
    }
    if (templates.length === 0 && templatesError === undefined) {
      setCreateState({ kind: 'error', message: '当前没有可用的项目模板。' })
      return
    }
    setCreateState({
      kind: 'form',
      form: {
        parent: outcome.selection,
        directoryName: '',
        name: '',
        templates,
        ...(templatesError === undefined ? {} : { templatesError }),
        templateId: templates[0]?.templateId ?? '',
      },
    })
  }

  const updateCreateForm = (patch: Partial<CreateForm>): void => {
    setCreateState(current => current.kind === 'form'
      ? { kind: 'form', form: { ...current.form, ...patch } }
      : current)
  }

  const prepareCreate = async (form: CreateForm): Promise<void> => {
    const template = form.templates.find(item => item.templateId === form.templateId)
    if (template === undefined) {
      setCreateState({ kind: 'error', message: '请先选择项目模板。', form })
      return
    }
    setCreateState({ kind: 'preparing', form })
    try {
      const preview = await api.prepareCreate({
        selection: form.parent,
        directoryName: form.directoryName,
        name: form.name,
        templateId: template.templateId,
        templateVersion: template.templateVersion,
      })
      setCreateState({ kind: 'preview', form, preview })
    } catch (error) {
      setCreateState({ kind: 'error', message: errorMessage(error, '新建项目预检没有完成。'), form })
    }
  }

  const submitCreate = async (form: CreateForm, preview: PrepareCreateResult): Promise<void> => {
    setCreateState({ kind: 'submitting', form, preview })
    try {
      const result = await api.submitLifecycle(preview.command)
      if (result.status === 'accepted' || result.status === 'replayed') {
        setCreateState({ kind: 'success', message: '项目已创建并登记为受管理项目。', projectId: preview.projectId })
        setReloadKey(value => value + 1)
      } else {
        setCreateState({
          kind: 'error',
          message: result.error?.message ?? '新建项目没有完成。',
          form,
          preview,
        })
      }
    } catch (error) {
      setCreateState({ kind: 'error', message: errorMessage(error, '新建项目没有完成。'), form, preview })
    }
  }

  const openDocuments = async (project: ProjectListItem): Promise<void> => {
    if (documentPanel.kind === 'loading') return
    if (documentPanel.kind === 'ready' && documentPanel.index.projectId === project.projectId) {
      setDocumentPanel({ kind: 'idle' })
      return
    }
    setDocumentPanel({ kind: 'loading', projectId: project.projectId })
    try {
      const index = await api.getProjectDocuments(project.projectId)
      setDocumentPanel({ kind: 'ready', index })
    } catch (error) {
      setDocumentPanel({ kind: 'error', message: errorMessage(error, '文档索引暂时无法读取。') })
    }
  }

  const refreshDocuments = async (): Promise<void> => {
    if (documentPanel.kind !== 'ready' || documentMutation !== undefined) return
    const projectId = documentPanel.index.projectId
    setDocumentPanel({ kind: 'loading', projectId })
    try {
      const index = await api.refreshProjectDocuments(projectId)
      setDocumentPanel({ kind: 'ready', index })
    } catch (error) {
      setDocumentPanel({ kind: 'error', message: errorMessage(error, '文档索引刷新没有完成。') })
    }
  }

  const resolveRebind = async (
    proposal: ProjectDocumentRebindProposal,
    decision: 'accept' | 'reject',
  ): Promise<void> => {
    if (documentPanel.kind !== 'ready' || documentMutation !== undefined) return
    const index = documentPanel.index
    const candidateRelativePath = proposal.unambiguous
      ? undefined
      : rebindChoices[proposal.proposalId] ?? proposal.candidateRelativePaths[0]
    setDocumentMutation(proposal.proposalId)
    try {
      await api.resolveDocumentRebind(index.projectId, proposal.proposalId, {
        expectedRevision: proposal.revision,
        decision,
        ...(candidateRelativePath === undefined ? {} : { candidateRelativePath }),
      })
      const refreshed = await api.refreshProjectDocuments(index.projectId)
      setDocumentPanel({ kind: 'ready', index: refreshed })
      setReloadKey(value => value + 1)
    } catch (error) {
      setDocumentPanel({
        kind: 'ready',
        index,
        error: errorMessage(error, '重绑提案没有处理成功。'),
      })
    } finally {
      setDocumentMutation(undefined)
    }
  }

  const storageState = loadState.kind === 'ready' ? loadState.status.storage.state : undefined
  const projectCount = loadState.kind === 'ready' ? loadState.status.counts.projects ?? undefined : undefined

  const consoleProject = loadState.kind === 'ready' && consoleProjectId !== undefined
    ? loadState.consoleProject
      ?? loadState.activeList?.projects.find(project => project.projectId === consoleProjectId)
    : undefined

  const togglePin = (projectId: string): void => {
    setPreferences(current => {
      const next: typeof current = current.pinnedProjectIds.includes(projectId)
        ? { ...current, pinnedProjectIds: current.pinnedProjectIds.filter(id => id !== projectId) }
        : { ...current, pinnedProjectIds: [projectId, ...current.pinnedProjectIds] }
      saveConsolePreferences(next)
      return next
    })
  }

  /** 记住当前打开的项目控制台，供重启恢复。 */
  const rememberConsoleProject = (projectId: string | undefined): void => {
    setPreferences(current => {
      const next: typeof current = { ...current, consoleProjectId: projectId }
      saveConsolePreferences(next)
      return next
    })
  }

  return (
    <section
      className={css.console}
      aria-label="项目控制台"
      data-personal-project-placeholder
      data-personal-project-control="gate-2c"
      data-project-control-gate="2c"
      data-project-storage-state={storageState}
      data-project-count={projectCount}
    >
      <header className={css.consoleHeader}>
        <div>
          <span className={css.gateBadge}>Gate 2D</span>
          <h1>项目控制台</h1>
          <p>发现、只读关联现有项目并快速新建标准项目</p>
        </div>
        <button className={css.iconButton} type="button" aria-label="刷新项目控制台" title="刷新" onClick={reload}>
          ↻
        </button>
      </header>

      <main className={css.content}>
        {loadState.kind === 'loading' && <LoadingState />}
        {loadState.kind === 'error' && <ErrorState message={loadState.message} onRetry={reload} />}
        {loadState.kind === 'ready' && consoleProject === undefined && (
          <ReadyState
            state={loadState}
            scanState={scanState}
            createState={createState}
            bridgeAvailable={hasProjectControlDirectoryBridge()}
            candidateMutation={candidateMutation}
            candidateView={candidateView}
            projectListView={projectListView}
            projectSearchInput={projectSearchInput}
            projectMutation={projectMutation}
            projectNotice={projectNotice}
            candidateSearchInput={candidateSearchInput}
            selectedCandidates={selectedCandidates}
            hasPreviousCandidatePage={candidateCursorHistory.length > 0}
            hasPreviousProjectPage={projectCursorHistory.length > 0}
            onChooseCandidateView={chooseCandidateView}
            onChooseProjectListView={chooseProjectListView}
            onProjectSearchInput={setProjectSearchInput}
            onApplyProjectSearch={applyProjectSearch}
            onCandidateSearchInput={setCandidateSearchInput}
            onApplyCandidateSearch={applyCandidateSearch}
            onSelectCandidate={selectCandidate}
            onSelectCandidatePage={selectCandidatePage}
            onMutateSelectedCandidates={() => { void mutateSelectedCandidates() }}
            onNextCandidatePage={nextCandidatePage}
            onPreviousCandidatePage={previousCandidatePage}
            onNextProjectPage={nextProjectPage}
            onPreviousProjectPage={previousProjectPage}
            onScan={mode => { void beginScan(mode) }}
            onOpenCandidate={openCandidate}
            onToggleIgnored={candidate => { void toggleIgnored(candidate) }}
            onBeginCreate={() => { void beginCreate() }}
            onUpdateCreateForm={updateCreateForm}
            onPrepareCreate={form => { void prepareCreate(form) }}
            onSubmitCreate={(form, preview) => { void submitCreate(form, preview) }}
            onEditCreate={form => { setCreateState({ kind: 'form', form }) }}
            onCancelCreate={() => { setCreateState({ kind: 'idle' }) }}
            documentPanel={documentPanel}
            documentMutation={documentMutation}
            rebindChoices={rebindChoices}
            onOpenDocuments={project => { void openDocuments(project) }}
            onRefreshDocuments={() => { void refreshDocuments() }}
            onResolveRebind={(proposal, decision) => { void resolveRebind(proposal, decision) }}
            onChooseRebindCandidate={(proposalId, path) => {
              setRebindChoices(current => ({ ...current, [proposalId]: path }))
            }}
            onCloseDocuments={() => { setDocumentPanel({ kind: 'idle' }) }}
            pinnedProjectIds={preferences.pinnedProjectIds}
            onOpenConsole={project => {
              setConsoleProjectId(project.projectId)
              rememberConsoleProject(project.projectId)
              // 工作台文件树/预览绑定到选中项目的工作区根（Host 只对已登记项目提供）
              void api.workspaceStatus(project.projectId).then(status => {
                workbench.setProjectWorkspace(project.projectId, status.root)
              }).catch(() => {
                workbench.clearProjectWorkspace()
              })
            }}
            onTogglePin={togglePin}
            onSetProjectArchived={(project, archived) => { void setProjectArchived(project, archived) }}
            onChangeWorkspace={project => { void beginWorkspaceChange(project) }}
          />
        )}
        {consoleProject !== undefined && loadState.kind === 'ready' && (
          <ProjectConsole
            key={consoleProject.projectId}
            project={consoleProject}
            workbench={workbench}
            nativeHistory={nativeHistory}
            currentSessionId={currentSessionId}
            pinned={preferences.pinnedProjectIds.includes(consoleProject.projectId)}
            onTogglePin={() => { togglePin(consoleProject.projectId) }}
            onBack={() => {
              setConsoleProjectId(undefined)
              rememberConsoleProject(undefined)
              notifyMemoryProjectBinding(undefined, currentSessionId)
              workbench.clearProjectWorkspace()
            }}
          />
        )}
      </main>
    </section>
  )
}

function LoadingState(): ReactNode {
  return (
    <div className={css.statePanel} role="status" aria-live="polite">
      <div className={css.emptyIcon} aria-hidden="true"><DatabaseIcon /></div>
      <h2>正在读取项目控制面</h2>
      <p>项目和扫描候选均来自本机 Host，不会用示例数据代替。</p>
    </div>
  )
}

function ErrorState({ message, onRetry }: { message: string; onRetry(): void }): ReactNode {
  return (
    <div className={css.statePanel} role="alert">
      <div className={css.emptyIcon} aria-hidden="true"><DatabaseIcon /></div>
      <h2>无法读取项目控制台</h2>
      <p>{message}</p>
      <button className={css.secondaryButton} type="button" onClick={onRetry}>重试</button>
    </div>
  )
}

function ReadyState({
  state,
  scanState,
  createState,
  bridgeAvailable,
  candidateMutation,
  candidateView,
  projectListView,
  projectSearchInput,
  projectMutation,
  projectNotice,
  candidateSearchInput,
  selectedCandidates,
  hasPreviousCandidatePage,
  hasPreviousProjectPage,
  onChooseCandidateView,
  onChooseProjectListView,
  onProjectSearchInput,
  onApplyProjectSearch,
  onCandidateSearchInput,
  onApplyCandidateSearch,
  onSelectCandidate,
  onSelectCandidatePage,
  onMutateSelectedCandidates,
  onNextCandidatePage,
  onPreviousCandidatePage,
  onNextProjectPage,
  onPreviousProjectPage,
  onScan,
  onOpenCandidate,
  onToggleIgnored,
  onBeginCreate,
  onUpdateCreateForm,
  onPrepareCreate,
  onSubmitCreate,
  onEditCreate,
  onCancelCreate,
  documentPanel,
  documentMutation,
  rebindChoices,
  onOpenDocuments,
  onRefreshDocuments,
  onResolveRebind,
  onChooseRebindCandidate,
  onCloseDocuments,
  pinnedProjectIds,
  onOpenConsole,
  onTogglePin,
  onSetProjectArchived,
  onChangeWorkspace,
}: {
  state: ReadyLoadState
  scanState: ScanState
  createState: CreateState
  bridgeAvailable: boolean
  candidateMutation: string | undefined
  candidateView: CandidateCenterView | 'projects'
  projectListView: ProjectListView
  projectSearchInput: string
  projectMutation: ProjectMutation | undefined
  projectNotice: ProjectNotice | undefined
  candidateSearchInput: string
  selectedCandidates: Readonly<Record<string, number>>
  hasPreviousCandidatePage: boolean
  hasPreviousProjectPage: boolean
  onChooseCandidateView(view: CandidateCenterView | 'projects'): void
  onChooseProjectListView(view: ProjectListView): void
  onProjectSearchInput(value: string): void
  onApplyProjectSearch(): void
  onCandidateSearchInput(value: string): void
  onApplyCandidateSearch(): void
  onSelectCandidate(candidate: ProjectCandidate, selected: boolean): void
  onSelectCandidatePage(candidates: readonly ProjectCandidate[], selected: boolean): void
  onMutateSelectedCandidates(): void
  onNextCandidatePage(): void
  onPreviousCandidatePage(): void
  onNextProjectPage(): void
  onPreviousProjectPage(): void
  onScan(mode: IntakeScanMode): void
  onOpenCandidate(candidate: ProjectCandidate): void
  onToggleIgnored(candidate: ProjectCandidate): void
  onBeginCreate(): void
  onUpdateCreateForm(patch: Partial<CreateForm>): void
  onPrepareCreate(form: CreateForm): void
  onSubmitCreate(form: CreateForm, preview: PrepareCreateResult): void
  onEditCreate(form: CreateForm): void
  onCancelCreate(): void
  documentPanel: DocumentPanelState
  documentMutation: string | undefined
  rebindChoices: Record<string, string>
  onOpenDocuments(project: ProjectListItem): void
  onRefreshDocuments(): void
  onResolveRebind(proposal: ProjectDocumentRebindProposal, decision: 'accept' | 'reject'): void
  onChooseRebindCandidate(proposalId: string, path: string): void
  onCloseDocuments(): void
  pinnedProjectIds: readonly string[]
  onOpenConsole(project: ProjectListItem): void
  onTogglePin(projectId: string): void
  onSetProjectArchived(project: ProjectListItem, archived: boolean): void
  onChangeWorkspace(project: ProjectListItem): void
}): ReactNode {
  const descriptor = storageDescriptor(state.status.storage.state)
  const scanning = scanState.kind === 'selecting' || scanState.kind === 'scanning'
  const activeDocumentsProjectId = documentPanel.kind === 'loading' || documentPanel.kind === 'ready'
    ? documentPanel.kind === 'loading' ? documentPanel.projectId : documentPanel.index.projectId
    : undefined
  return (
    <div className={css.readyState}>
      <section className={css.statusCard} aria-label="项目数据库状态">
        <div className={css.statusIcon} aria-hidden="true"><DatabaseIcon /></div>
        <div>
          <h2>{descriptor.title}</h2>
          <p>{descriptor.detail}</p>
        </div>
        <span className={css.countBadge}>
          {state.status.counts.projects === null ? '项目数未知' : `${String(state.status.counts.projects)} 个项目`}
        </span>
      </section>

      <section className={css.intakeSection} aria-labelledby="project-intake-heading">
        <div className={css.sectionHeading}>
          <div>
            <h2 id="project-intake-heading">添加现有项目</h2>
            <p>扫描只读取授权目录；确认前不会登记，也不会写入项目文件。</p>
          </div>
        </div>
        <div className={css.actionGrid}>
          <button
            className={css.primaryAction}
            type="button"
            disabled={!bridgeAvailable || scanning || state.status.storage.state !== 'ready'}
            onClick={() => { onScan('source-root') }}
          >
            <span aria-hidden="true">⌕</span>
            <span><strong>扫描来源目录</strong><small>发现直接子目录中的多个项目</small></span>
          </button>
          <button
            className={css.primaryAction}
            type="button"
            disabled={!bridgeAvailable || scanning || state.status.storage.state !== 'ready'}
            onClick={() => { onScan('project-root') }}
          >
            <span aria-hidden="true">＋</span>
            <span><strong>导入单个项目</strong><small>选择一个确定的项目根目录</small></span>
          </button>
          <button
            className={css.primaryAction}
            type="button"
            disabled={!bridgeAvailable || scanning || state.status.storage.state !== 'ready' || createState.kind !== 'idle'}
            onClick={onBeginCreate}
          >
            <span aria-hidden="true">⚡</span>
            <span><strong>快速新建标准项目</strong><small>从版本化模板创建受管理项目</small></span>
          </button>
        </div>
        {!bridgeAvailable && (
          <p className={css.bridgeNotice} role="note">
            目录选择桥不可用。请从 DeepSeek Harness Personal 桌面客户端打开此页面。
          </p>
        )}
        <ScanNotice state={scanState} />
      </section>

      <CreateFlow
        state={createState}
        bridgeAvailable={bridgeAvailable}
        onPickParent={() => { onBeginCreate() }}
        onUpdateForm={onUpdateCreateForm}
        onPrepare={onPrepareCreate}
        onSubmit={onSubmitCreate}
        onEdit={onEditCreate}
        onCancel={onCancelCreate}
      />

      <CandidateCenterNavigation
        activeView={candidateView}
        projectCount={state.status.counts.projects ?? state.activeList?.total ?? 0}
        counts={state.candidatePage.counts}
        {...(state.candidateError === undefined ? {} : { candidateError: state.candidateError })}
        searchInput={candidateSearchInput}
        onChooseView={onChooseCandidateView}
        onSearchInput={onCandidateSearchInput}
        onApplySearch={onApplyCandidateSearch}
      />

      {candidateView === 'projects' ? (
        <ProjectSection
          view={projectListView}
          activeTotal={state.activeList?.total ?? 0}
          archivedTotal={state.archivedList?.total ?? 0}
          {...(projectListView === 'active'
            ? state.activeList === undefined ? {} : { list: state.activeList }
            : state.archivedList === undefined ? {} : { list: state.archivedList })}
          {...(projectListView === 'active'
            ? state.activeListError === undefined ? {} : { error: state.activeListError }
            : state.archivedListError === undefined ? {} : { error: state.archivedListError })}
          {...(activeDocumentsProjectId === undefined ? {} : { documentsProjectId: activeDocumentsProjectId })}
          bridgeAvailable={bridgeAvailable}
          mutation={projectMutation}
          notice={projectNotice}
          searchInput={projectSearchInput}
          hasPreviousPage={hasPreviousProjectPage}
          onChooseView={onChooseProjectListView}
          onSearchInput={onProjectSearchInput}
          onApplySearch={onApplyProjectSearch}
          onNextPage={onNextProjectPage}
          onPreviousPage={onPreviousProjectPage}
          onOpenDocuments={onOpenDocuments}
          pinnedProjectIds={pinnedProjectIds}
          onOpenConsole={onOpenConsole}
          onTogglePin={onTogglePin}
          onSetArchived={onSetProjectArchived}
          onChangeWorkspace={onChangeWorkspace}
        />
      ) : (
        <CandidateSection
          view={candidateView}
          candidates={state.candidatePage.candidates}
          total={state.candidatePage.total}
          nextCursor={state.candidatePage.nextCursor}
          hasPreviousPage={hasPreviousCandidatePage}
          selectedCandidates={selectedCandidates}
          {...(state.candidateError === undefined ? {} : { error: state.candidateError })}
          candidateMutation={candidateMutation}
          onOpen={onOpenCandidate}
          onToggleIgnored={onToggleIgnored}
          onSelect={onSelectCandidate}
          onSelectPage={onSelectCandidatePage}
          onMutateSelected={onMutateSelectedCandidates}
          onNextPage={onNextCandidatePage}
          onPreviousPage={onPreviousCandidatePage}
        />
      )}

      <DocumentIndexPanel
        panel={documentPanel}
        mutation={documentMutation}
        choices={rebindChoices}
        onRefresh={onRefreshDocuments}
        onResolve={onResolveRebind}
        onChoose={onChooseRebindCandidate}
        onClose={onCloseDocuments}
      />

      <dl className={css.statusFacts}>
        <div><dt>数据库 Schema</dt><dd>{state.status.storage.schemaVersion ?? '未建立'}</dd></div>
        <div><dt>数据库访问</dt><dd>{storageAccessLabel(state.status.storage)}</dd></div>
        <div><dt>协议</dt><dd>{state.status.protocolVersion}</dd></div>
      </dl>
    </div>
  )
}

function CreateFlow({
  state,
  bridgeAvailable,
  onPickParent,
  onUpdateForm,
  onPrepare,
  onSubmit,
  onEdit,
  onCancel,
}: {
  state: CreateState
  bridgeAvailable: boolean
  onPickParent(): void
  onUpdateForm(patch: Partial<CreateForm>): void
  onPrepare(form: CreateForm): void
  onSubmit(form: CreateForm, preview: PrepareCreateResult): void
  onEdit(form: CreateForm): void
  onCancel(): void
}): ReactNode {
  if (state.kind === 'idle') return null
  return (
    <section
      className={css.createSection}
      aria-labelledby="project-create-heading"
      data-personal-project-create
      data-create-flow-state={state.kind}
    >
      <div className={css.sectionHeading}>
        <div>
          <h2 id="project-create-heading">快速新建标准项目</h2>
          <p>从版本化模板创建；登记为受管理项目，不会切换当前会话。</p>
        </div>
      </div>
      {state.kind === 'picking' && (
        <p className={css.scanNotice} role="status">正在等待你选择父目录…</p>
      )}
      {(state.kind === 'form' || state.kind === 'preparing') && (
        <CreateFormFields
          form={state.form}
          busy={state.kind === 'preparing'}
          bridgeAvailable={bridgeAvailable}
          onPickParent={onPickParent}
          onUpdateForm={onUpdateForm}
          onPrepare={() => { onPrepare(state.form) }}
          onCancel={onCancel}
        />
      )}
      {(state.kind === 'preview' || state.kind === 'submitting') && (
        <CreatePreview
          preview={state.preview}
          submitting={state.kind === 'submitting'}
          onSubmit={() => { onSubmit(state.form, state.preview) }}
          onEdit={() => { onEdit(state.form) }}
          onCancel={onCancel}
        />
      )}
      {state.kind === 'success' && (
        <div className={css.createSuccess} role="status">
          <strong>✓ {state.message}</strong>
          <span className={css.operationPath}>{state.projectId}</span>
          <button className={css.confirmButton} type="button" onClick={onCancel}>完成</button>
        </div>
      )}
      {state.kind === 'error' && (
        <div className={css.createError} role="alert">
          <strong>{state.message}</strong>
          <div className={css.createActions}>
            <button
              className={css.secondaryButton}
              type="button"
              onClick={() => {
                if (state.form !== undefined) onEdit(state.form)
                else onCancel()
              }}
            >
              {state.form !== undefined ? '返回修改' : '关闭'}
            </button>
            <button className={css.secondaryButton} type="button" onClick={onCancel}>取消</button>
          </div>
        </div>
      )}
    </section>
  )
}

function CreateFormFields({
  form,
  busy,
  bridgeAvailable,
  onPickParent,
  onUpdateForm,
  onPrepare,
  onCancel,
}: {
  form: CreateForm
  busy: boolean
  bridgeAvailable: boolean
  onPickParent(): void
  onUpdateForm(patch: Partial<CreateForm>): void
  onPrepare(): void
  onCancel(): void
}): ReactNode {
  const template = form.templates.find(item => item.templateId === form.templateId)
  const canPrepare = form.directoryName.trim().length > 0
    && form.name.trim().length > 0
    && template !== undefined
    && !busy
  return (
    <div className={css.createForm}>
      <div className={css.createField}>
        <span className={css.fieldLabel}>父目录</span>
        <div className={css.parentRow}>
          <span className={css.pathText} title={form.parent.path}>{form.parent.path}</span>
          <button
            className={css.smallButton}
            type="button"
            disabled={busy || !bridgeAvailable}
            onClick={onPickParent}
          >
            重新选择
          </button>
        </div>
      </div>
      <label className={css.createField}>
        <span className={css.fieldLabel}>目录名（文件夹名）</span>
        <input
          className={css.textInput}
          type="text"
          value={form.directoryName}
          maxLength={120}
          placeholder="例如 meal-tracker"
          disabled={busy}
          onChange={event => { onUpdateForm({ directoryName: event.target.value }) }}
        />
      </label>
      <label className={css.createField}>
        <span className={css.fieldLabel}>项目名称</span>
        <input
          className={css.textInput}
          type="text"
          value={form.name}
          maxLength={120}
          placeholder="显示在项目列表中的名称"
          disabled={busy}
          onChange={event => { onUpdateForm({ name: event.target.value }) }}
        />
      </label>
      <label className={css.createField}>
        <span className={css.fieldLabel}>模板</span>
        <select
          className={css.selectInput}
          value={form.templateId}
          disabled={busy || form.templates.length === 0}
          onChange={event => { onUpdateForm({ templateId: event.target.value }) }}
        >
          {form.templates.map(item => (
            <option key={`${item.templateId}@${item.templateVersion}`} value={item.templateId}>
              {item.displayName} · {item.templateVersion}
            </option>
          ))}
        </select>
      </label>
      {template?.description != null && (
        <p className={css.templateDescription}>{template.description}</p>
      )}
      {form.templatesError !== undefined && (
        <p className={css.createError} role="alert">{form.templatesError}</p>
      )}
      <div className={css.createActions}>
        <button className={css.secondaryButton} type="button" disabled={busy} onClick={onCancel}>取消</button>
        <button className={css.confirmButton} type="button" disabled={!canPrepare} onClick={onPrepare}>
          {busy ? '正在准备…' : '预览新建内容'}
        </button>
      </div>
    </div>
  )
}

function CreatePreview({
  preview,
  submitting,
  onSubmit,
  onEdit,
  onCancel,
}: {
  preview: PrepareCreateResult
  submitting: boolean
  onSubmit(): void
  onEdit(): void
  onCancel(): void
}): ReactNode {
  const operations = Array.isArray(preview.writePlan.operations)
    ? preview.writePlan.operations as Array<Record<string, unknown>>
    : []
  return (
    <div className={css.createForm}>
      <div className={css.previewCard}>
        <div className={css.previewTopline}>
          <strong>{preview.template.displayName}</strong>
          <span>{preview.template.templateId}@{preview.template.templateVersion}</span>
        </div>
        <dl className={css.previewFacts}>
          <div><dt>projectId</dt><dd title={preview.projectId}>{preview.projectId}</dd></div>
          <div><dt>目标目录</dt><dd title={preview.targetDisplayPath}>{preview.targetDisplayPath}</dd></div>
          <div><dt>模板哈希</dt><dd>{preview.template.templateHash.slice(0, 18)}…</dd></div>
        </dl>
        <p className={css.previewNote}>
          将创建 {String(operations.length)} 个项目内路径；已存在的路径会阻止创建，不会覆盖任何文件。
        </p>
        <ul className={css.operationList}>
          {operations.map((operation, index) => (
            <li className={css.operationItem} key={String(index)} data-kind={operation.kind}>
              <span aria-hidden="true">{operation.kind === 'create_directory' ? '📁' : '📄'}</span>
              <span className={css.operationPath}>{String(operation.relativePath)}</span>
              {operation.kind === 'create_file' && (
                <span className={css.hashText}>{String(operation.contentHash).slice(0, 18)}…</span>
              )}
            </li>
          ))}
        </ul>
      </div>
      <div className={css.createActions}>
        <button className={css.secondaryButton} type="button" disabled={submitting} onClick={onCancel}>取消</button>
        <button className={css.secondaryButton} type="button" disabled={submitting} onClick={onEdit}>返回修改</button>
        <button className={css.confirmButton} type="button" disabled={submitting} onClick={onSubmit}>
          {submitting ? '正在创建…' : '确认创建'}
        </button>
      </div>
    </div>
  )
}

function ScanNotice({ state }: { state: ScanState }): ReactNode {
  if (state.kind === 'idle') return null
  if (state.kind === 'selecting') {
    return <p className={css.scanNotice} role="status">正在等待你选择目录…</p>
  }
  if (state.kind === 'scanning') {
    return (
      <div className={css.scanNotice} role="status" aria-live="polite">
        <strong>正在只读扫描</strong><span title={state.path}>{state.path}</span>
      </div>
    )
  }
  return (
    <div className={state.kind === 'error' ? css.scanError : css.scanNotice} role={state.kind === 'error' ? 'alert' : 'status'}>
      <strong>{state.kind === 'error' ? '扫描未完成' : state.message}</strong>
      {state.kind === 'success' && <span title={state.path}>{state.path}</span>}
      {state.kind === 'error' && <span>{state.message}</span>}
    </div>
  )
}

function CandidateCenterNavigation({
  activeView,
  projectCount,
  counts,
  candidateError,
  searchInput,
  onChooseView,
  onSearchInput,
  onApplySearch,
}: {
  activeView: CandidateCenterView | 'projects'
  projectCount: number
  counts: IntakeCandidateList['counts']
  candidateError?: string
  searchInput: string
  onChooseView(view: CandidateCenterView | 'projects'): void
  onSearchInput(value: string): void
  onApplySearch(): void
}): ReactNode {
  const views: Array<{ id: CandidateCenterView | 'projects'; label: string; count: number }> = [
    { id: 'projects', label: '项目', count: projectCount },
    { id: 'review', label: '待审阅', count: counts.review },
    { id: 'ignored', label: '已忽略', count: counts.ignored },
    { id: 'history', label: '历史记录', count: counts.history },
  ]
  return (
    <section className={css.candidateCenter} aria-labelledby="candidate-center-heading" data-candidate-center-view={activeView}>
      <div className={css.sectionHeading}>
        <div>
          <h2 id="candidate-center-heading">候选中心</h2>
          <p>正式项目、待处理项、已忽略项和历史证据彼此分开。</p>
        </div>
      </div>
      <div className={css.candidateTabs} role="tablist" aria-label="候选中心视图">
        {views.map(view => (
          <button
            key={view.id}
            className={css.candidateTab}
            type="button"
            role="tab"
            aria-selected={activeView === view.id}
            onClick={() => { onChooseView(view.id) }}
          >
            <span>{view.label}</span><strong>{String(view.count)}</strong>
          </button>
        ))}
      </div>
      {activeView === 'projects' && candidateError !== undefined && (
        <p className={css.scanError} role="alert">候选计数暂时无法读取：{candidateError}</p>
      )}
      {activeView !== 'projects' && (
        <form
          className={css.candidateSearch}
          role="search"
          onSubmit={event => { event.preventDefault(); onApplySearch() }}
        >
          <input
            type="search"
            value={searchInput}
            maxLength={200}
            placeholder="搜索名称、路径、候选 ID 或项目 ID"
            aria-label="搜索候选"
            onChange={event => { onSearchInput(event.currentTarget.value) }}
          />
          <button className={css.smallButton} type="submit">搜索</button>
        </form>
      )}
    </section>
  )
}

function CandidateSection({
  view,
  candidates,
  total,
  nextCursor,
  hasPreviousPage,
  selectedCandidates,
  error,
  candidateMutation,
  onOpen,
  onToggleIgnored,
  onSelect,
  onSelectPage,
  onMutateSelected,
  onNextPage,
  onPreviousPage,
}: {
  view: CandidateCenterView
  candidates: readonly ProjectCandidate[]
  total: number
  nextCursor: string | null
  hasPreviousPage: boolean
  selectedCandidates: Readonly<Record<string, number>>
  error?: string
  candidateMutation: string | undefined
  onOpen(candidate: ProjectCandidate): void
  onToggleIgnored(candidate: ProjectCandidate): void
  onSelect(candidate: ProjectCandidate, selected: boolean): void
  onSelectPage(candidates: readonly ProjectCandidate[], selected: boolean): void
  onMutateSelected(): void
  onNextPage(): void
  onPreviousPage(): void
}): ReactNode {
  const title = view === 'review' ? '待审阅候选' : view === 'ignored' ? '已忽略' : '历史记录'
  const selectable = view !== 'history'
  const selectedCount = candidates.filter(candidate => selectedCandidates[candidate.candidateId] === candidate.revision).length
  const allSelected = selectable && candidates.length > 0 && selectedCount === candidates.length
  const emptyMessage = view === 'review'
    ? '当前没有需要处理的候选。已登记、已忽略和旧扫描不会占用这里的位置。'
    : view === 'ignored'
      ? '当前没有已忽略候选。'
      : '当前没有候选历史记录。'
  return (
    <section className={css.candidateSection} aria-labelledby={`candidate-section-${view}`}>
      <div className={css.sectionHeading}>
        <div><h2 id={`candidate-section-${view}`}>{title}</h2></div>
        <span>本页 {String(candidates.length)} / 共 {String(total)} 项</span>
      </div>
      {selectable && candidates.length > 0 && (
        <div className={css.candidateBatchBar}>
          <label>
            <input
              type="checkbox"
              checked={allSelected}
              onChange={event => { onSelectPage(candidates, event.currentTarget.checked) }}
            />
            选择本页
          </label>
          <span>已选 {String(selectedCount)} 项</span>
          <button
            className={css.smallButton}
            type="button"
            disabled={selectedCount === 0 || candidateMutation !== undefined}
            onClick={onMutateSelected}
          >
            {candidateMutation === 'batch' ? '处理中…' : view === 'review' ? '批量忽略' : '批量恢复'}
          </button>
        </div>
      )}
      {error !== undefined ? (
        <p className={css.emptyCopy} role="alert">{error}</p>
      ) : candidates.length === 0 ? (
        <p className={css.emptyCopy}>{emptyMessage}</p>
      ) : (
        <ul className={css.candidateList}>
          {candidates.map(candidate => (
            <li
              className={css.candidateCard}
              key={candidate.candidateId}
              data-ignored={candidate.ignored || undefined}
              data-selectable={selectable || undefined}
            >
              {selectable && (
                <label className={css.candidateSelect} aria-label={`选择 ${candidate.suggestedName}`}>
                  <input
                    type="checkbox"
                    checked={selectedCandidates[candidate.candidateId] === candidate.revision}
                    onChange={event => { onSelect(candidate, event.currentTarget.checked) }}
                  />
                </label>
              )}
              <button className={css.candidateMain} type="button" onClick={() => { onOpen(candidate) }}>
                <span className={css.candidateTopline}>
                  <strong>{candidate.suggestedName}</strong>
                  <span data-level={candidate.evidenceLevel}>{evidenceLabel(candidate.evidenceLevel)}</span>
                </span>
                <span className={css.candidatePath} title={candidate.rootPath}>{candidate.rootPath}</span>
                <span className={css.candidateMeta}>
                  <span>{candidateStatusLabel(view, candidate)}</span>
                  <span>{candidate.documentCount} 份文档</span>
                  {candidate.issueCount > 0 && <span>{candidate.issueCount} 个问题</span>}
                </span>
              </button>
              {selectable && (
                <button
                  className={css.ignoreButton}
                  type="button"
                  disabled={candidateMutation !== undefined}
                  aria-label={candidate.ignored ? `恢复 ${candidate.suggestedName}` : `忽略 ${candidate.suggestedName}`}
                  onClick={() => { onToggleIgnored(candidate) }}
                >
                  {candidateMutation === candidate.candidateId
                    ? '处理中…'
                    : candidate.ignored ? '恢复' : '忽略'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {(hasPreviousPage || nextCursor !== null) && (
        <div className={css.candidatePagination} aria-label="候选分页">
          <button className={css.smallButton} type="button" disabled={!hasPreviousPage} onClick={onPreviousPage}>上一页</button>
          <button className={css.smallButton} type="button" disabled={nextCursor === null} onClick={onNextPage}>下一页</button>
        </div>
      )}
    </section>
  )
}

function ProjectSection({
  view,
  activeTotal,
  archivedTotal,
  list,
  error,
  documentsProjectId,
  bridgeAvailable,
  mutation,
  notice,
  searchInput,
  hasPreviousPage,
  onChooseView,
  onSearchInput,
  onApplySearch,
  onNextPage,
  onPreviousPage,
  onOpenDocuments,
  pinnedProjectIds,
  onOpenConsole,
  onTogglePin,
  onSetArchived,
  onChangeWorkspace,
}: {
  view: ProjectListView
  activeTotal: number
  archivedTotal: number
  list?: ProjectList
  error?: string
  documentsProjectId?: string
  bridgeAvailable: boolean
  mutation: ProjectMutation | undefined
  notice: ProjectNotice | undefined
  searchInput: string
  hasPreviousPage: boolean
  onChooseView(view: ProjectListView): void
  onSearchInput(value: string): void
  onApplySearch(): void
  onNextPage(): void
  onPreviousPage(): void
  onOpenDocuments(project: ProjectListItem): void
  pinnedProjectIds: readonly string[]
  onOpenConsole(project: ProjectListItem): void
  onTogglePin(projectId: string): void
  onSetArchived(project: ProjectListItem, archived: boolean): void
  onChangeWorkspace(project: ProjectListItem): void
}): ReactNode {
  const ordered = list === undefined
    ? undefined
    : [...list.projects].sort((left, right) => {
        const leftPinned = pinnedProjectIds.includes(left.projectId) ? 1 : 0
        const rightPinned = pinnedProjectIds.includes(right.projectId) ? 1 : 0
        if (leftPinned !== rightPinned) return rightPinned - leftPinned
        return left.name.localeCompare(right.name, 'zh-Hans-CN')
      })
  return (
    <section className={css.projectSection} aria-labelledby="project-control-list-heading">
      <div className={css.sectionHeading}>
        <div><h2 id="project-control-list-heading">已登记项目</h2></div>
        <span>{list === undefined ? '不可用' : String(list.total) + ' 项'}</span>
      </div>
      <div className={css.candidatePagination} aria-label="项目归档视图">
        <button
          className={css.smallButton}
          type="button"
          aria-pressed={view === 'active'}
          data-project-list-view="active"
          onClick={() => { onChooseView('active') }}
        >
          使用中（{String(activeTotal)}）
        </button>
        <button
          className={css.smallButton}
          type="button"
          aria-pressed={view === 'archived'}
          data-project-list-view="archived"
          onClick={() => { onChooseView('archived') }}
        >
          已归档（{String(archivedTotal)}）
        </button>
      </div>
      <form
        className={css.candidateSearch}
        data-project-search
        onSubmit={event => { event.preventDefault(); onApplySearch() }}
      >
        <input
          type="search"
          value={searchInput}
          maxLength={200}
          aria-label="搜索已登记项目"
          placeholder="按项目名称或项目 ID 搜索"
          onChange={event => { onSearchInput(event.currentTarget.value) }}
        />
        <button className={css.smallButton} type="submit">搜索</button>
      </form>
      {notice !== undefined && (
        <p className={css.bridgeNotice} role={notice.kind === 'error' ? 'alert' : 'status'}>
          {notice.message}
        </p>
      )}
      {ordered === undefined ? (
        <p className={css.emptyCopy}>{error ?? '项目列表暂时无法读取。'}</p>
      ) : ordered.length === 0 ? (
        <p className={css.emptyCopy}>{view === 'active' ? '当前没有使用中的项目。' : '当前没有已归档项目。'}</p>
      ) : (
        <ul className={css.projectList}>
          {ordered.map(project => {
            const pinned = pinnedProjectIds.includes(project.projectId)
            return (
              <li className={css.projectItem} key={project.projectId} data-project-pinned={pinned || undefined}>
                <div><strong>{project.name}</strong><small>{project.projectId}</small></div>
                <div className={css.projectItemActions}>
                  <span>{view === 'archived' ? '已归档' : registrationLabel(project.registrationMode)}</span>
                  {view === 'archived' ? (
                    <button
                      className={css.confirmButton}
                      type="button"
                      data-project-unarchive
                      disabled={mutation !== undefined}
                      onClick={() => { onSetArchived(project, false) }}
                    >
                      {mutation?.projectId === project.projectId && mutation.action === 'unarchive' ? '恢复中…' : '恢复项目'}
                    </button>
                  ) : (
                    <>
                      <button
                        className={css.smallButton}
                        type="button"
                        data-project-workspace-change
                        disabled={!bridgeAvailable || mutation !== undefined}
                        onClick={() => { onChangeWorkspace(project) }}
                      >
                        {mutation?.projectId === project.projectId && mutation.action === 'relocate' ? '核对中…' : '更换工作区'}
                      </button>
                      <button
                        className={css.smallButton}
                        type="button"
                        data-project-archive
                        disabled={mutation !== undefined}
                        onClick={() => { onSetArchived(project, true) }}
                      >
                        {mutation?.projectId === project.projectId && mutation.action === 'archive' ? '归档中…' : '归档项目'}
                      </button>
                      <button
                        className={css.smallButton}
                        type="button"
                        data-documents-open={documentsProjectId === project.projectId || undefined}
                        onClick={() => { onOpenDocuments(project) }}
                      >
                        {documentsProjectId === project.projectId ? '收起文档' : '文档索引'}
                      </button>
                      <button
                        className={css.smallButton}
                        type="button"
                        aria-pressed={pinned}
                        aria-label={pinned ? '取消置顶 ' + project.name : '置顶 ' + project.name}
                        onClick={() => { onTogglePin(project.projectId) }}
                      >
                        {pinned ? '📌' : '置顶'}
                      </button>
                      <button
                        className={css.confirmButton}
                        type="button"
                        data-open-console
                        onClick={() => { onOpenConsole(project) }}
                      >
                        打开控制台
                      </button>
                    </>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {list !== undefined && (hasPreviousPage || list.nextCursor !== null) && (
        <div className={css.candidatePagination} aria-label="项目分页">
          <button
            className={css.smallButton}
            type="button"
            data-project-page-previous
            disabled={!hasPreviousPage}
            onClick={onPreviousPage}
          >
            上一页
          </button>
          <button
            className={css.smallButton}
            type="button"
            data-project-page-next
            disabled={list.nextCursor === null}
            onClick={onNextPage}
          >
            下一页
          </button>
        </div>
      )}
    </section>
  )
}

function DocumentIndexPanel({
  panel,
  mutation,
  choices,
  onRefresh,
  onResolve,
  onChoose,
  onClose,
}: {
  panel: DocumentPanelState
  mutation: string | undefined
  choices: Record<string, string>
  onRefresh(): void
  onResolve(proposal: ProjectDocumentRebindProposal, decision: 'accept' | 'reject'): void
  onChoose(proposalId: string, path: string): void
  onClose(): void
}): ReactNode {
  if (panel.kind === 'idle') return null
  return (
    <section
      className={css.documentPanel}
      aria-labelledby="project-documents-heading"
      data-personal-project-documents
    >
      <div className={css.documentPanelHeader}>
        <div>
          <strong id="project-documents-heading">文档索引</strong>
          {panel.kind === 'ready' && (
            <p>{panel.index.name} · 修订 {String(panel.index.revision)}</p>
          )}
        </div>
        <div className={css.documentPanelActions}>
          {panel.kind === 'ready' && (
            <button
              className={css.smallButton}
              type="button"
              disabled={mutation !== undefined}
              onClick={onRefresh}
            >
              {mutation !== undefined ? '处理中…' : '刷新核对'}
            </button>
          )}
          <button className={css.smallButton} type="button" onClick={onClose}>关闭</button>
        </div>
      </div>
      {panel.kind === 'loading' && (
        <p className={css.documentPanelEmpty} role="status">正在核对项目文档…</p>
      )}
      {panel.kind === 'error' && (
        <p className={css.documentPanelEmpty} role="alert">{panel.message}</p>
      )}
      {panel.kind === 'ready' && (
        <>
          {panel.error !== undefined && (
            <p className={css.createError} role="alert">{panel.error}</p>
          )}
          <p className={css.documentPanelEmpty}>
            来源：{panel.index.mode === 'managed' ? 'manifest 绑定（受管理）' : '已确认绑定（只关联）'}
            {panel.index.locationDisplayPath !== null && (
              <span className={css.documentLocation} title={panel.index.locationDisplayPath}> · {panel.index.locationDisplayPath}</span>
            )}
          </p>
          {panel.index.documents.length === 0 ? (
            <p className={css.documentPanelEmpty}>该项目没有文档绑定。点击“刷新核对”后这里会显示每份文档的哈希与解析诊断。</p>
          ) : (
            <ul className={css.documentList}>
              {panel.index.documents.map(document => (
                <li
                  className={css.documentRow}
                  key={document.role + '\u0000' + document.relativePath}
                  data-document-state={document.state}
                >
                  <div className={css.documentRowMain}>
                    <span className={css.documentRole}>{documentRoleLabel(document.role)}</span>
                    <span className={css.documentPath} title={document.relativePath}>{document.relativePath}</span>
                  </div>
                  <div className={css.documentRowSide}>
                    <span className={css.documentStateBadge} data-state={document.state}>
                      {documentStateLabel(document)}
                    </span>
                    <span className={css.documentHash} title={document.contentHash ?? undefined}>
                      {document.contentHash === null ? '—' : document.contentHash.slice(0, 18)}
                    </span>
                  </div>
                  {document.parseIssues.length > 0 && (
                    <div className={css.documentIssues}>
                      {document.parseIssues.map((issue, index) => (
                        <span className={css.documentIssue} key={issue.code + '-' + String(index)}>
                          ⚠ {issue.message}
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {panel.index.proposals.length > 0 && (
            <div className={css.proposalGroup}>
              <strong className={css.proposalGroupTitle}>重命名重绑提案（需人工确认）</strong>
              {panel.index.proposals.map(proposal => (
                <div
                  className={css.proposalCard}
                  key={proposal.proposalId}
                  data-rebind-proposal={proposal.proposalId}
                  data-rebind-status={proposal.status}
                >
                  <div className={css.proposalLine}>
                    <span className={css.documentRole}>{documentRoleLabel(proposal.role)}</span>
                    <span className={css.proposalPath}>{proposal.missingRelativePath}</span>
                    <span aria-hidden="true">→</span>
                  </div>
                  {proposal.status === 'proposed' ? (
                    <>
                      <div className={css.proposalActions}>
                        {proposal.unambiguous ? (
                          <span className={css.proposalPath} title={proposal.candidateRelativePaths[0]}>
                            {proposal.candidateRelativePaths[0]}
                          </span>
                        ) : (
                          <>
                            <label className={css.documentPanelEmpty}>候选（{String(proposal.candidateCount)} 处，内容哈希一致）：</label>
                            <select
                              value={choices[proposal.proposalId] ?? proposal.candidateRelativePaths[0]}
                              onChange={event => { onChoose(proposal.proposalId, event.target.value) }}
                            >
                              {proposal.candidateRelativePaths.map(path => (
                                <option key={path} value={path}>{path}</option>
                              ))}
                            </select>
                          </>
                        )}
                      </div>
                      <div className={css.proposalActions}>
                        {proposal.applicable ? (
                          <>
                            <button
                              className={css.confirmButton}
                              type="button"
                              disabled={mutation !== undefined}
                              onClick={() => { onResolve(proposal, 'accept') }}
                            >
                              应用重绑
                            </button>
                            <button
                              className={css.smallButton}
                              type="button"
                              disabled={mutation !== undefined}
                              onClick={() => { onResolve(proposal, 'reject') }}
                            >
                              忽略
                            </button>
                          </>
                        ) : (
                          <span className={css.proposalHint}>
                            受管理项目以 manifest 为准：请先在项目 manifest 中更新路径，再重新核对。
                          </span>
                        )}
                      </div>
                    </>
                  ) : (
                    <span className={css.proposalHint}>
                      {proposal.status === 'accepted' && ('已重绑到 ' + (proposal.resolvedRelativePath ?? ''))}
                      {proposal.status === 'rejected' && '已忽略'}
                      {proposal.status === 'superseded' && '已被新状态替代'}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  )
}

function documentStateLabel(document: ProjectDocumentState): string {
  switch (document.state) {
    case 'ok': return '一致'
    case 'changed': return '内容已变化'
    case 'missing': return '缺失'
    case 'unreadable': return '无法读取'
  }
}

function storageDescriptor(state: ProjectStorageState): { title: string; detail: string } {
  switch (state) {
    case 'ready': return { title: '项目数据库已就绪', detail: '当前显示真实登记状态与扫描候选。' }
    case 'read_only_newer_schema': return { title: '项目数据库受版本保护', detail: '检测到更高版本；当前 Host 未打开数据库。' }
    case 'migration_failed': return { title: '项目数据库迁移需要处理', detail: '当前不会继续写入，请先处理迁移问题。' }
    case 'unavailable': return { title: '项目数据库暂不可用', detail: '当前 Host 未打开数据库，也不会生成替代数据。' }
  }
}

function storageAccessLabel(storage: ProjectControlStatus['storage']): string {
  if (storage.state === 'ready') return storage.writable ? '可读写' : '只读'
  if (storage.state === 'read_only_newer_schema') return '未打开（版本保护）'
  return '未打开'
}

function registrationLabel(mode: ProjectList['projects'][number]['registrationMode']): string {
  if (mode === 'managed') return '受管理'
  if (mode === 'linked_legacy') return '只关联'
  return '状态未知'
}

function evidenceLabel(level: ProjectCandidate['evidenceLevel']): string {
  if (level === 'high') return '高证据'
  if (level === 'medium') return '中证据'
  if (level === 'low') return '低证据'
  return '证据未知'
}

function statusLabel(status: string): string {
  if (status === 'discovered') return '待确认'
  if (status === 'ignored') return '已忽略'
  if (status === 'conflict') return '需要处理'
  if (status === 'registered') return '已登记'
  if (status === 'imported') return '已登记'
  if (status === 'relocation_candidate') return '位置待重绑'
  return status
}

function candidateStatusLabel(view: CandidateCenterView, candidate: ProjectCandidate): string {
  if (view === 'history' && candidate.historyReason === 'superseded') return '已被新扫描取代'
  return statusLabel(candidate.status)
}

function candidatePathPreview(path: string): string {
  return path.length <= 160 ? path : `${path.slice(0, 157)}…`
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback
}

function scanIssueMessage(issues: IntakeScanResult['issues']): string {
  const open = issues.filter(issue => issue.status === 'open')
  if (open.length === 0) return ''
  const serious = open.filter(issue => issue.severity === 'error' || issue.severity === 'blocking').length
  const first = open.slice(0, 2).map(issue => issue.message).join('；')
  return ` 来源扫描${serious > 0 ? '不完整' : '有提醒'}（${String(open.length)} 项）：${first}`
}

function DatabaseIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24">
      <ellipse cx="12" cy="6" rx="7" ry="3" />
      <path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6" />
      <path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />
    </svg>
  )
}
