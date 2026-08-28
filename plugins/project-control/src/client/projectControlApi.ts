import type { AuthorizedDirectorySelection } from './directoryBridge.ts'
import type {
  ProjectWorkspaceContinuity,
  ProjectWorkspaceContinuityLocation,
} from './nativeWorkspaceHistory.ts'

const API_PREFIX = '/__personal/project-control/v1alpha1'
export const PROJECT_CONTROL_MAX_JSON_BYTES = 262_144

export type ProjectStorageState =
  | 'ready'
  | 'read_only_newer_schema'
  | 'migration_failed'
  | 'unavailable'
export type IntakeScanMode = 'source-root' | 'project-root'
export type EvidenceLevel = 'high' | 'medium' | 'low' | 'unknown'
export type ProjectDocumentRole =
  | 'readme'
  | 'prd'
  | 'devlog'
  | 'progress'
  | 'next'
  | 'current_architecture'
  | 'decision'
  | 'other'

export const PROJECT_DOCUMENT_ROLES = [
  'readme', 'prd', 'devlog', 'progress', 'next', 'current_architecture', 'decision', 'other',
] as const satisfies readonly ProjectDocumentRole[]

export interface ProjectControlStatus {
  apiVersion: string
  protocolVersion: string
  storage: { state: ProjectStorageState; schemaVersion: number | null; writable: boolean }
  counts: { projects: number | null }
  capabilities: readonly string[]
}

export interface ProjectListItem {
  projectId: string
  name: string
  registrationMode: 'linked_legacy' | 'managed' | 'unknown'
  lifecycle: string
  revision: number
  archivedAt: string | null
  updatedAt: string
}

export interface ProjectList {
  projects: readonly ProjectListItem[]
  total: number
  nextCursor: string | null
}
export type ProjectListView = 'active' | 'archived'
export interface ProjectListOptions {
  view?: ProjectListView
  search?: string
  limit?: number
  afterProjectId?: string
}

export interface ProjectWorkspaceStatus { projectId: string; root: string }

export interface ProjectWorkspaceEntry { name: string; kind: 'directory' | 'file'; byteSize?: number }

export interface ProjectWorkspaceTree { entries: readonly ProjectWorkspaceEntry[]; truncated: boolean }

export type ProjectWorkspaceFile =
  | { kind: 'text'; content: string; truncated: boolean; byteSize: number; sha256: string }
  | { kind: 'binary'; byteSize: number; tooLarge?: boolean; mime: string }

export interface IntakeJob {
  jobId: string
  sourceRootId: string
  mode: IntakeScanMode
  status: string
  scannerVersion: string
  startedAt: string
  completedAt?: string
  summary: Readonly<Record<string, number>>
  issues: readonly IntakeJobIssue[]
}

export interface IntakeJobIssue {
  issueId: string
  code: string
  severity: 'info' | 'warning' | 'error' | 'blocking'
  status: 'open' | 'resolved'
  message: string
}

export interface IntakeSourceRoot {
  sourceRootId: string
  kind: IntakeScanMode
  path: string
  revision: number
  updatedAt: string
}

export interface CandidateValueSource { relativePath?: string; label?: string }

export interface CandidateDocument {
  documentId: string
  relativePath: string
  suggestedRole: ProjectDocumentRole | null
  contentHash?: string
  title?: string
  evidence: readonly string[]
  preview?: string
}

export interface CandidateIssue {
  issueId: string
  code: string
  severity: 'info' | 'warning' | 'error' | 'blocking'
  status: string
  message: string
  relativePath?: string
}

export interface ProjectCandidate {
  candidateId: string
  jobId: string
  revision: number
  rootPath: string
  suggestedName: string
  nameSource?: CandidateValueSource
  summary?: string
  summarySource?: CandidateValueSource
  evidenceLevel: EvidenceLevel
  evidence: readonly string[]
  status: string
  historyReason?: 'completed' | 'superseded'
  detectedMode: 'linked_legacy' | 'managed' | 'unknown'
  manifestProjectId?: string
  ignored: boolean
  documentCount: number
  issueCount: number
  documents: readonly CandidateDocument[]
  issues: readonly CandidateIssue[]
}

export type CandidateCenterView = 'review' | 'ignored' | 'history'

export interface CandidateCenterCounts {
  review: number
  ignored: number
  history: number
}

export interface CandidateListOptions {
  jobId?: string
  view?: CandidateCenterView
  search?: string
  limit?: number
  afterCandidateId?: string
}

export interface IntakeCandidateList {
  candidates: readonly ProjectCandidate[]
  total: number
  counts: CandidateCenterCounts
  nextCursor: string | null
  jobId?: string
}

export interface IntakeScanResult {
  sourceRoot: IntakeSourceRoot
  job: IntakeJob
  candidates: readonly ProjectCandidate[]
  summary: Readonly<Record<string, number>>
  issues: readonly IntakeJobIssue[]
}

export interface CandidatePrepareInput {
  registrationMode: 'linked_legacy' | 'managed'
  name: string
  documentBindings: readonly {
    role: ProjectDocumentRole
    relativePath: string
    contentHash: string
  }[]
  expectedRevision: number
}

export interface LifecycleCommandResult {
  status: 'accepted' | 'replayed' | 'rejected'
  projectId?: string
  aggregateRevision?: number
  error?: { code: string; message: string }
}

export interface ProjectTemplateSummary {
  templateId: string
  templateVersion: string
  displayName: string
  description: string | null
  protocolVersion: string
  templateHash: string
}

export interface ProjectTemplateList {
  templates: readonly ProjectTemplateSummary[]
  total: number
}

export interface PrepareCreateInput {
  selection: AuthorizedDirectorySelection
  directoryName: string
  name: string
  templateId: string
  templateVersion: string
}

export interface PrepareCreateResult {
  template: ProjectTemplateSummary
  projectId: string
  targetDisplayPath: string
  directoryName: string
  expiresAt: string
  writePlan: Record<string, unknown>
  command: Record<string, unknown>
}

export interface ProjectDocumentParseIssue {
  code: string
  severity: 'info' | 'warning' | 'error' | 'blocking'
  message: string
  line: number | null
}

export interface ProjectDocumentState {
  role: ProjectDocumentRole
  relativePath: string
  bindingSource: 'user_confirmed' | 'manifest'
  state: 'ok' | 'changed' | 'missing' | 'unreadable'
  contentHash: string | null
  byteSize: number | null
  parseIssues: readonly ProjectDocumentParseIssue[]
  revision: number
  firstSeenAt: string
  lastVerifiedAt: string
}

export interface ProjectDocumentRebindProposal {
  proposalId: string
  role: ProjectDocumentRole
  missingRelativePath: string
  contentHash: string
  candidateRelativePaths: readonly string[]
  candidateCount: number
  unambiguous: boolean
  status: 'proposed' | 'accepted' | 'rejected' | 'superseded'
  resolvedRelativePath: string | null
  revision: number
  createdAt: string
  updatedAt: string
  resolvedAt: string | null
  applicable: boolean
}

export interface ProjectDocumentIndex {
  projectId: string
  mode: 'linked_legacy' | 'managed'
  name: string
  revision: number
  locationDisplayPath: string | null
  documents: readonly ProjectDocumentState[]
  proposals: readonly ProjectDocumentRebindProposal[]
}

export interface RebindResolutionInput {
  expectedRevision: number
  decision: 'accept' | 'reject'
  candidateRelativePath?: string
}

export interface RebindResolutionResult {
  proposal: ProjectDocumentRebindProposal | null
  projectRevision: number
}


export type WorkItemExecutionStatus =
  | 'draft' | 'ready' | 'running' | 'paused' | 'blocked' | 'completed' | 'cancelled'
export type WorkItemReviewStatus =
  | 'not_requested' | 'pending' | 'changes_requested' | 'approved' | 'rejected'

export interface ProjectWorkItem {
  workItemId: string
  projectId: string
  title: string
  instruction: string | null
  acceptance: readonly string[]
  executionStatus: WorkItemExecutionStatus
  reviewStatus: WorkItemReviewStatus
  priority: number
  revision: number
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

export interface ProjectRun {
  runId: string
  projectId: string
  workItemId: string
  attemptNo: number
  status: 'queued' | 'running' | 'completed' | 'failed' | 'blocked' | 'orphaned' | 'cancelled'
  instructionSnapshot: string | null
  acceptanceSnapshot: unknown
  revision: number
  createdAt: string
  startedAt: string | null
  completedAt: string | null
  updatedAt: string
}

export interface ProjectProgressUpdate {
  progressUpdateId: string
  projectId: string
  workItemId: string
  runId: string
  kind: 'progress' | 'blocker' | 'completion_declared'
  summary: string
  needs: readonly string[]
  acceptanceClaims: readonly string[]
  evidence: readonly Record<string, unknown>[]
  completionPercent: number | null
  details: string | null
  threadId: string | null
  sourceEventId: string | null
  commandId: string
  aggregateType: 'work_item' | 'run'
  aggregateId: string
  aggregateRevision: number
  generatedBy: Record<string, unknown>
  createdAt: string
}

export interface ProjectReview {
  reviewId: string
  projectId: string
  workItemId: string | null
  reviewedWorkItemRevision: number | null
  artifactRefs: unknown
  status: 'requested' | 'in_review' | 'approved' | 'rejected' | 'superseded'
  risk: 'unrated' | 'low' | 'medium' | 'high' | null
  requestedBy: Record<string, unknown>
  decidedBy: Record<string, unknown> | null
  revision: number
  createdAt: string
  updatedAt: string
  decidedAt: string | null
}

export interface ProjectReviewAction {
  reviewActionId: string
  reviewId: string
  action: 'comment' | 'request_changes' | 'approve' | 'reject' | 'supersede'
  actor: Record<string, unknown>
  comment: string | null
  createdAt: string
}

export interface ProjectDecision {
  decisionId: string
  projectId: string
  workItemId: string | null
  title: string
  context: string | null
  options: unknown
  status: 'proposed' | 'accepted' | 'rejected' | 'superseded'
  rationale: string | null
  proposedBy: Record<string, unknown>
  decidedBy: Record<string, unknown> | null
  revision: number
  createdAt: string
  updatedAt: string
  decidedAt: string | null
}

export interface ProjectEvent {
  eventId: string
  sequence: number
  projectId: string
  aggregateType: 'project' | 'work_item' | 'run'
  aggregateId: string
  beforeRevision: number
  afterRevision: number
  eventType: string
  schemaVersion: string
  data: Record<string, unknown>
  actor: Record<string, unknown>
  provenance: Record<string, unknown>
  commandId: string
  correlationId: string | null
  causationId: string | null
  occurredAt: string
  recordedAt: string
}

export interface ProjectQuarantineItem {
  quarantineId: string
  projectId: string | null
  sourceKind: string
  sourceRef: string
  reasonCode: string
  payloadRef: string | null
  status: 'open' | 'resolved' | 'ignored'
  details: Record<string, unknown>
  revision: number
  createdAt: string
  updatedAt: string
  resolvedAt: string | null
}

export interface ProjectSessionBinding {
  bindingId: string
  projectId: string
  runId: string
  harnessInstanceRef: string
  sessionId: string
  threadId: string
  createdAt: string
}

export interface PagedItems<T> {
  items: readonly T[]
  total: number
}

export interface ProjectControlApi {
  getStatus(signal?: AbortSignal): Promise<ProjectControlStatus>
  /** Accepts the legacy listProjects(signal) call as well as filtered page options. */
  listProjects(optionsOrSignal?: ProjectListOptions | AbortSignal, signal?: AbortSignal): Promise<ProjectList>
  setProjectArchived(
    projectId: string,
    archived: boolean,
    expectedRevision: number,
    signal?: AbortSignal,
  ): Promise<ProjectListItem>
  workspaceStatus(projectId: string, signal?: AbortSignal): Promise<ProjectWorkspaceStatus>
  getProjectWorkspaceContinuity(projectId: string, signal?: AbortSignal): Promise<ProjectWorkspaceContinuity>
  workspaceTree(projectId: string, path: string, signal?: AbortSignal): Promise<ProjectWorkspaceTree>
  workspaceFile(projectId: string, path: string, signal?: AbortSignal): Promise<ProjectWorkspaceFile>
  scan(
    mode: IntakeScanMode,
    selection: AuthorizedDirectorySelection,
    options?: { maxDepth?: number; signal?: AbortSignal },
  ): Promise<IntakeScanResult>
  listCandidates(options?: CandidateListOptions, signal?: AbortSignal): Promise<IntakeCandidateList>
  getCandidate(candidateId: string, signal?: AbortSignal): Promise<ProjectCandidate>
  setCandidateIgnored(
    candidateId: string,
    ignored: boolean,
    expectedRevision: number,
    signal?: AbortSignal,
  ): Promise<ProjectCandidate>
  setCandidatesIgnored(
    candidates: readonly { candidateId: string; expectedRevision: number }[],
    ignored: boolean,
    signal?: AbortSignal,
  ): Promise<readonly ProjectCandidate[]>
  prepareCandidate(
    candidateId: string,
    input: CandidatePrepareInput,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>>
  listTemplates(signal?: AbortSignal): Promise<ProjectTemplateList>
  prepareCreate(input: PrepareCreateInput, signal?: AbortSignal): Promise<PrepareCreateResult>
  getProjectDocuments(projectId: string, signal?: AbortSignal): Promise<ProjectDocumentIndex>
  refreshProjectDocuments(projectId: string, signal?: AbortSignal): Promise<ProjectDocumentIndex>
  resolveDocumentRebind(
    projectId: string,
    proposalId: string,
    input: RebindResolutionInput,
    signal?: AbortSignal,
  ): Promise<RebindResolutionResult>
  submitLifecycle(command: Record<string, unknown>, signal?: AbortSignal): Promise<LifecycleCommandResult>
  listWorkItems(projectId: string, signal?: AbortSignal): Promise<PagedItems<ProjectWorkItem>>
  listRuns(projectId: string, workItemId?: string, signal?: AbortSignal): Promise<PagedItems<ProjectRun>>
  listProgressUpdates(projectId: string, signal?: AbortSignal): Promise<PagedItems<ProjectProgressUpdate>>
  listReviews(projectId: string, signal?: AbortSignal): Promise<PagedItems<ProjectReview>>
  listReviewActions(projectId: string, reviewId: string, signal?: AbortSignal): Promise<PagedItems<ProjectReviewAction>>
  listDecisions(projectId: string, signal?: AbortSignal): Promise<PagedItems<ProjectDecision>>
  listEvents(projectId: string, afterSequence?: number, signal?: AbortSignal): Promise<PagedItems<ProjectEvent>>
  listSessions(projectId: string, signal?: AbortSignal): Promise<PagedItems<ProjectSessionBinding>>
  listQuarantineItems(signal?: AbortSignal): Promise<PagedItems<ProjectQuarantineItem>>
  resolveQuarantineItem(
    quarantineId: string,
    decision: 'resolved' | 'ignored',
    expectedRevision: number,
    signal?: AbortSignal,
  ): Promise<ProjectQuarantineItem>
  createWorkItem(
    projectId: string,
    input: {
      title: string
      instruction?: string
      acceptance?: readonly string[]
      priority?: number
    },
    signal?: AbortSignal,
  ): Promise<ProjectWorkItem>
  setWorkItemStatus(
    projectId: string,
    workItemId: string,
    status: WorkItemExecutionStatus,
    expectedRevision: number,
    signal?: AbortSignal,
  ): Promise<ProjectWorkItem>
  startRun(projectId: string, runId: string, expectedRevision: number, signal?: AbortSignal): Promise<ProjectRun>
  requestReview(
    projectId: string,
    workItemId: string,
    expectedRevision: number,
    risk?: 'unrated' | 'low' | 'medium' | 'high',
    signal?: AbortSignal,
  ): Promise<ProjectReview>
  decideReview(
    projectId: string,
    reviewId: string,
    input: { expectedRevision: number; decision: 'approve' | 'reject' | 'request_changes'; rationale?: string },
    signal?: AbortSignal,
  ): Promise<ProjectReview>
  commentReview(
    projectId: string,
    reviewId: string,
    comment: string,
    signal?: AbortSignal,
  ): Promise<ProjectReviewAction>
}

interface SuccessEnvelope { ok: true; data: unknown }
interface ErrorEnvelope { ok: false; error: { code?: unknown; message?: unknown } }

export function createProjectControlApi(fetchImpl: typeof fetch = fetch): ProjectControlApi {
  const request = async (
    method: 'GET' | 'POST',
    resource: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> => {
    const serialized = body === undefined ? undefined : JSON.stringify(body)
    if (serialized !== undefined && utf8Bytes(serialized) > PROJECT_CONTROL_MAX_JSON_BYTES) {
      throw apiError('请求内容超过项目控制台 256 KiB 限制。', 'BODY_TOO_LARGE')
    }
    const response = await fetchImpl(`${API_PREFIX}${resource}`, {
      method,
      cache: 'no-store',
      credentials: 'same-origin',
      headers: {
        accept: 'application/json',
        'x-dsh-personal-client': '1',
        ...(serialized === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(serialized === undefined ? {} : { body: serialized }),
      ...(signal === undefined ? {} : { signal }),
    })
    const responseText = await response.text()
    if (utf8Bytes(responseText) > PROJECT_CONTROL_MAX_JSON_BYTES) {
      throw apiError('项目控制台响应超过 256 KiB 限制。', 'RESPONSE_TOO_LARGE', response.status)
    }
    let payload: SuccessEnvelope | ErrorEnvelope
    try {
      payload = JSON.parse(responseText) as SuccessEnvelope | ErrorEnvelope
    } catch {
      throw apiError('项目控制台返回了无法识别的响应。', 'INVALID_RESPONSE', response.status)
    }
    if (!isRecord(payload) || (payload.ok !== true && payload.ok !== false)) {
      throw apiError('项目控制台返回了无法识别的响应。', 'INVALID_RESPONSE', response.status)
    }
    if (!response.ok || payload.ok !== true) {
      const error = payload.ok === false && isRecord(payload.error) ? payload.error : undefined
      throw apiError(
        optionalBoundedText(error?.message, 400) ?? `项目控制台请求失败（HTTP ${String(response.status)}）。`,
        optionalBoundedText(error?.code, 100) ?? 'HTTP_ERROR',
        response.status,
      )
    }
    return payload.data
  }

  return {
    getStatus: async signal => normalizeStatus(await request('GET', '/status', undefined, signal)),
    listProjects: async (optionsOrSignal = {}, signal) => {
      let options: ProjectListOptions
      let requestSignal = signal
      if (isAbortSignal(optionsOrSignal)) {
        options = {}
        requestSignal = optionsOrSignal
      } else {
        options = optionsOrSignal
      }
      const view = options.view ?? 'active'
      if (view !== 'active' && view !== 'archived') throw apiError('项目列表视图无效。', 'INVALID_PROJECT_VIEW')
      const query = new URLSearchParams({ view })
      if (options.search !== undefined) query.set('search', validateProjectSearch(options.search))
      if (options.limit !== undefined) query.set('limit', String(validateProjectLimit(options.limit)))
      if (options.afterProjectId !== undefined) {
        query.set('afterProjectId', validateProjectId(options.afterProjectId))
      }
      return normalizeProjectList(await request(
        'GET',
        `/projects?${query.toString()}`,
        undefined,
        requestSignal,
      ))
    },
    setProjectArchived: async (projectId, archived, expectedRevision, signal) => normalizeProjectListItem(await request(
      'POST',
      `/projects/${encodeURIComponent(validateProjectId(projectId))}/${archived ? 'archive' : 'unarchive'}`,
      { expectedRevision: validateRevision(expectedRevision) },
      signal,
    )),
    workspaceStatus: async (projectId, signal) => normalizeProjectWorkspaceStatus(await request(
      'GET',
      `/projects/${encodeURIComponent(validateIdentifier(projectId, '项目'))}/workspace/status`,
      undefined,
      signal,
    )),
    getProjectWorkspaceContinuity: async (projectId, signal) => normalizeProjectWorkspaceContinuity(await request(
      'GET',
      `/projects/${encodeURIComponent(validateIdentifier(projectId, '项目'))}/workspace/continuity`,
      undefined,
      signal,
    )),
    workspaceTree: async (projectId, path, signal) => normalizeProjectWorkspaceTree(await request(
      'GET',
      `/projects/${encodeURIComponent(validateIdentifier(projectId, '项目'))}/workspace/tree?path=${encodeURIComponent(path)}`,
      undefined,
      signal,
    )),
    workspaceFile: async (projectId, path, signal) => normalizeProjectWorkspaceFile(await request(
      'GET',
      `/projects/${encodeURIComponent(validateIdentifier(projectId, '项目'))}/workspace/file?path=${encodeURIComponent(path)}`,
      undefined,
      signal,
    )),
    scan: async (mode, selection, options = {}) => normalizeScanResult(await request(
      'POST',
      '/intake/scan',
      { mode, selection, ...(options.maxDepth === undefined ? {} : { maxDepth: options.maxDepth }) },
      options.signal,
    )),
    listCandidates: async (options = {}, signal) => {
      const query = new URLSearchParams()
      if (options.jobId !== undefined) query.set('jobId', validateIdentifier(options.jobId, '扫描任务'))
      if (options.view !== undefined) query.set('view', validateCandidateView(options.view))
      if (options.search !== undefined) query.set('search', validateCandidateSearch(options.search))
      if (options.limit !== undefined) query.set('limit', String(validateCandidateLimit(options.limit)))
      if (options.afterCandidateId !== undefined) {
        query.set('afterCandidateId', validateCandidateId(options.afterCandidateId))
      }
      const suffix = query.size === 0 ? '' : `?${query.toString()}`
      return normalizeCandidateList(await request('GET', `/intake/candidates${suffix}`, undefined, signal))
    },
    getCandidate: async (candidateId, signal) => normalizeCandidate(await request(
      'GET',
      `/intake/candidates/${encodeURIComponent(validateCandidateId(candidateId))}`,
      undefined,
      signal,
    )),
    setCandidateIgnored: async (candidateId, ignored, expectedRevision, signal) => normalizeCandidate(await request(
      'POST',
      `/intake/candidates/${encodeURIComponent(validateCandidateId(candidateId))}/ignore`,
      { ignored, expectedRevision: validateRevision(expectedRevision) },
      signal,
    )),
    setCandidatesIgnored: async (candidates, ignored, signal) => normalizeCandidateMutationList(await request(
      'POST',
      '/intake/candidates/bulk-ignore',
      {
        ignored,
        candidates: validateCandidateBatch(candidates),
      },
      signal,
    )),
    prepareCandidate: async (candidateId, input, signal) => {
      const prepared = requiredRecord(await request(
        'POST',
        `/intake/candidates/${encodeURIComponent(validateCandidateId(candidateId))}/prepare`,
        input,
        signal,
      ), '候选注册预检')
      return requiredRecord(prepared.command, '候选注册指令')
    },
    listTemplates: async signal => normalizeTemplateList(await request(
      'GET', '/templates', undefined, signal,
    )),
    prepareCreate: async (input, signal) => normalizePrepareCreateResult(await request(
      'POST', '/intake/prepare-create', input, signal,
    )),
    getProjectDocuments: async (projectId, signal) => normalizeDocumentIndex(await request(
      'GET',
      `/projects/${encodeURIComponent(validateProjectId(projectId))}/documents`,
      undefined,
      signal,
    )),
    refreshProjectDocuments: async (projectId, signal) => normalizeDocumentIndex(await request(
      'POST',
      `/projects/${encodeURIComponent(validateProjectId(projectId))}/documents/refresh`,
      undefined,
      signal,
    )),
    resolveDocumentRebind: async (projectId, proposalId, input, signal) => normalizeRebindResolutionResult(await request(
      'POST',
      `/projects/${encodeURIComponent(validateProjectId(projectId))}/document-rebinds/${encodeURIComponent(validateProposalId(proposalId))}/resolve`,
      {
        expectedRevision: validateRevision(input.expectedRevision),
        decision: input.decision,
        ...(input.candidateRelativePath === undefined ? {} : { candidateRelativePath: input.candidateRelativePath }),
      },
      signal,
    )),
    submitLifecycle: async (command, signal) => normalizeLifecycleResult(await request(
      'POST', '/lifecycle', command, signal,
    )),
    listWorkItems: async (projectId, signal) => normalizePagedItems(
      await request('GET', `/projects/${encodeURIComponent(validateProjectId(projectId))}/work-items`, undefined, signal),
      '任务列表',
      normalizeWorkItem,
    ),
    listRuns: async (projectId, workItemId, signal) => normalizePagedItems(
      await request(
        'GET',
        `/projects/${encodeURIComponent(validateProjectId(projectId))}/runs${workItemId === undefined ? '' : `?workItemId=${encodeURIComponent(workItemId)}`}`,
        undefined,
        signal,
      ),
      '运行列表',
      normalizeRun,
    ),
    listProgressUpdates: async (projectId, signal) => normalizePagedItems(
      await request('GET', `/projects/${encodeURIComponent(validateProjectId(projectId))}/progress-updates`, undefined, signal),
      '进展更新列表',
      normalizeProgressUpdate,
    ),
    listReviews: async (projectId, signal) => normalizePagedItems(
      await request('GET', `/projects/${encodeURIComponent(validateProjectId(projectId))}/reviews`, undefined, signal),
      '审阅列表',
      normalizeReview,
    ),
    listReviewActions: async (projectId, reviewId, signal) => normalizePagedActions(
      await request(
        'GET',
        `/projects/${encodeURIComponent(validateProjectId(projectId))}/reviews/${encodeURIComponent(validateIdentifier(reviewId, '审阅'))}/actions`,
        undefined,
        signal,
      ),
      '审阅记录列表',
    ),
    listDecisions: async (projectId, signal) => normalizePagedItems(
      await request('GET', `/projects/${encodeURIComponent(validateProjectId(projectId))}/decisions`, undefined, signal),
      '决定列表',
      normalizeDecision,
    ),
    listEvents: async (projectId, afterSequence, signal) => normalizePagedItems(
      await request(
        'GET',
        `/projects/${encodeURIComponent(validateProjectId(projectId))}/events${afterSequence === undefined ? '' : `?afterSequence=${String(afterSequence)}`}`,
        undefined,
        signal,
      ),
      '事件列表',
      normalizeEvent,
    ),
    listSessions: async (projectId, signal) => normalizePagedItems(
      await request('GET', `/projects/${encodeURIComponent(validateProjectId(projectId))}/sessions`, undefined, signal),
      '会话绑定列表',
      normalizeSessionBinding,
    ),
    listQuarantineItems: async signal => {
      const payload = requiredRecord(await request('GET', '/quarantine', undefined, signal), '隔离列表')
      return {
        items: requiredArray(payload.quarantineItems, '隔离列表').map(normalizeQuarantineItem),
        total: requiredInteger(payload.total, '隔离总数', 0),
      }
    },
    resolveQuarantineItem: async (quarantineId, decision, expectedRevision, signal) => normalizeQuarantineItem(await request(
      'POST',
      `/quarantine/${encodeURIComponent(validateIdentifier(quarantineId, '隔离项'))}/resolve`,
      { expectedRevision: validateRevision(expectedRevision), decision },
      signal,
    )),
    createWorkItem: async (projectId, input, signal) => normalizeWorkItem(await request(
      'POST',
      `/projects/${encodeURIComponent(validateProjectId(projectId))}/work-items`,
      {
        title: requiredText(input.title, '任务标题', 500),
        ...(input.instruction === undefined ? {} : { instruction: input.instruction }),
        ...(input.acceptance === undefined ? {} : { acceptance: input.acceptance }),
        ...(input.priority === undefined ? {} : { priority: input.priority }),
      },
      signal,
    )),
    setWorkItemStatus: async (projectId, workItemId, status, expectedRevision, signal) => normalizeWorkItem(await request(
      'POST',
      `/projects/${encodeURIComponent(validateProjectId(projectId))}/work-items/${encodeURIComponent(validateIdentifier(workItemId, '任务'))}/status`,
      { expectedRevision: validateRevision(expectedRevision), status },
      signal,
    )),
    startRun: async (projectId, runId, expectedRevision, signal) => normalizeRun(await request(
      'POST',
      `/projects/${encodeURIComponent(validateProjectId(projectId))}/runs/${encodeURIComponent(validateIdentifier(runId, '运行'))}/start`,
      { expectedRevision: validateRevision(expectedRevision) },
      signal,
    )),
    requestReview: async (projectId, workItemId, expectedRevision, risk, signal) => normalizeReview(await request(
      'POST',
      `/projects/${encodeURIComponent(validateProjectId(projectId))}/work-items/${encodeURIComponent(validateIdentifier(workItemId, '任务'))}/review-request`,
      {
        expectedRevision: validateRevision(expectedRevision),
        ...(risk === undefined ? {} : { risk }),
      },
      signal,
    )),
    decideReview: async (projectId, reviewId, input, signal) => normalizeReview(await request(
      'POST',
      `/projects/${encodeURIComponent(validateProjectId(projectId))}/reviews/${encodeURIComponent(validateIdentifier(reviewId, '审阅'))}/decide`,
      {
        expectedRevision: validateRevision(input.expectedRevision),
        decision: input.decision,
        ...(input.rationale === undefined ? {} : { rationale: input.rationale }),
      },
      signal,
    )),
    commentReview: async (projectId, reviewId, comment, signal) => normalizeReviewAction(await request(
      'POST',
      `/projects/${encodeURIComponent(validateProjectId(projectId))}/reviews/${encodeURIComponent(validateIdentifier(reviewId, '审阅'))}/comment`,
      { comment: requiredText(comment, '评论内容', 4000) },
      signal,
    )),
  }
}

export function normalizeScanResult(value: unknown): IntakeScanResult {
  const object = requiredRecord(value, '扫描结果')
  const job = normalizeJob(object.job)
  return {
    sourceRoot: normalizeSourceRoot(object.sourceRoot),
    job,
    candidates: requiredArray(object.candidates, '扫描候选').map(normalizeCandidate),
    summary: object.summary === undefined ? job.summary : normalizeSummary(object.summary),
    issues: object.issues === undefined ? job.issues : normalizeJobIssues(object.issues),
  }
}

export function normalizeCandidateList(value: unknown): IntakeCandidateList {
  const object = requiredRecord(value, '候选列表')
  const candidates = requiredArray(object.candidates, '候选列表').map(normalizeCandidate)
  const countsObject = object.counts === undefined ? undefined : requiredRecord(object.counts, '候选计数')
  return {
    candidates,
    total: requiredInteger(object.total ?? candidates.length, '候选总数', candidates.length),
    counts: countsObject === undefined
      ? {
          review: candidates.filter(candidate => ['discovered', 'conflict', 'relocation_candidate'].includes(candidate.status)).length,
          ignored: candidates.filter(candidate => candidate.status === 'ignored').length,
          history: candidates.filter(candidate => candidate.status === 'imported').length,
        }
      : {
          review: requiredInteger(countsObject.review, '待审阅候选数量', 0),
          ignored: requiredInteger(countsObject.ignored, '已忽略候选数量', 0),
          history: requiredInteger(countsObject.history, '历史候选数量', 0),
        },
    nextCursor: object.nextCursor === undefined || object.nextCursor === null
      ? null
      : validateCandidateId(requiredText(object.nextCursor, '候选分页游标', 200)),
    ...(object.jobId === undefined ? {} : { jobId: requiredText(object.jobId, '扫描任务', 200) }),
  }
}

function normalizeCandidateMutationList(value: unknown): readonly ProjectCandidate[] {
  const object = requiredRecord(value, '候选批量操作结果')
  return requiredArray(object.candidates, '候选批量操作结果').map(normalizeCandidate)
}

/** Host DTO compatibility is deliberately centralized here instead of leaking into components. */
export function normalizeCandidate(value: unknown): ProjectCandidate {
  const object = requiredRecord(value, '项目候选')
  const status = requiredText(object.status, '候选状态', 80)
  const historyReason = object.historyReason
  if (historyReason !== undefined && historyReason !== 'completed' && historyReason !== 'superseded') {
    throw apiError('候选历史原因无效。', 'INVALID_CANDIDATE')
  }
  const confidence = isRecord(object.confidence) ? object.confidence : undefined
  const detectedMode = optionalBoundedText(object.detectedMode, 40)
  const nameSource = normalizeValueSource(object.nameSource, '名称来源')
  const summarySource = normalizeValueSource(object.summarySource, '摘要来源')
  const manifestProjectId = optionalBoundedText(object.manifestProjectId, 200)
  const documents = requiredArray(object.documents, '候选文档').map(normalizeDocument)
  const issues = requiredArray(object.issues, '候选问题').map(normalizeIssue)
  return {
    candidateId: validateCandidateId(requiredText(object.candidateId, '候选 ID', 200)),
    jobId: validateIdentifier(requiredText(object.jobId, '扫描任务 ID', 200), '扫描任务'),
    revision: requiredInteger(object.revision, '候选修订号', 0),
    rootPath: requiredText(object.rootPath, '项目根目录', 32_767),
    suggestedName: requiredText(object.suggestedName, '建议项目名称', 240),
    ...(nameSource === undefined ? {} : { nameSource }),
    ...(object.summary === undefined || object.summary === null
      ? {}
      : { summary: requiredText(object.summary, '项目摘要', 1_000) }),
    ...(summarySource === undefined ? {} : { summarySource }),
    evidenceLevel: normalizeEvidenceLevel(object.evidenceLevel ?? confidence?.level),
    evidence: normalizeStringList(object.evidence ?? confidence?.evidence, '候选证据', 100, 500),
    status,
    ...(historyReason === undefined ? {} : { historyReason }),
    detectedMode: detectedMode === 'managed' || detectedMode === 'linked_legacy' ? detectedMode : 'unknown',
    ...(manifestProjectId === undefined ? {} : { manifestProjectId }),
    ignored: object.ignored === undefined ? status === 'ignored' : requiredBoolean(object.ignored, '忽略状态'),
    documentCount: object.documentCount === undefined
      ? documents.length
      : requiredInteger(object.documentCount, '候选文档数量', 0),
    issueCount: object.issueCount === undefined
      ? issues.length
      : requiredInteger(object.issueCount, '候选问题数量', 0),
    documents,
    issues,
  }
}

export function isCandidateResourceKey(value: string | undefined): value is string {
  return value !== undefined && /^can_[A-Za-z0-9-]{8,180}$/.test(value)
}

export function documentRoleLabel(role: ProjectDocumentRole): string {
  switch (role) {
    case 'readme': return '项目说明'
    case 'prd': return '产品需求'
    case 'devlog': return '开发日志'
    case 'progress': return '进展记录'
    case 'next': return '下一步'
    case 'current_architecture': return '当前架构'
    case 'decision': return '架构决策'
    case 'other': return '附加资料'
  }
}

function normalizeStatus(value: unknown): ProjectControlStatus {
  const object = requiredRecord(value, '项目控制台状态')
  const storage = requiredRecord(object.storage, '存储状态')
  const counts = requiredRecord(object.counts, '项目数量')
  const state = requiredText(storage.state, '存储状态值', 80)
  if (!['ready', 'read_only_newer_schema', 'migration_failed', 'unavailable'].includes(state)) {
    throw invalidResponse('存储状态值')
  }
  return {
    apiVersion: requiredText(object.apiVersion, 'API 版本', 100),
    protocolVersion: requiredText(object.protocolVersion, '协议版本', 100),
    storage: {
      state: state as ProjectStorageState,
      schemaVersion: storage.schemaVersion === null ? null : requiredInteger(storage.schemaVersion, '数据库版本', 0),
      writable: requiredBoolean(storage.writable, '数据库写入状态'),
    },
    counts: {
      projects: counts.projects === null ? null : requiredInteger(counts.projects, '项目数量', 0),
    },
    capabilities: normalizeStringList(object.capabilities, 'Host 能力', 100, 160),
  }
}

function normalizeProjectList(value: unknown): ProjectList {
  const object = requiredRecord(value, '项目列表')
  const projects = requiredArray(object.projects, '项目列表').map(normalizeProjectListItem)
  const nextCursor = object.nextCursor === undefined || object.nextCursor === null
    ? null
    : validateProjectId(requiredText(object.nextCursor, '项目分页游标', 200))
  return { projects, total: requiredInteger(object.total, '项目总数', projects.length), nextCursor }
}

function normalizeProjectListItem(item: unknown): ProjectListItem {
  const project = requiredRecord(item, '登记项目')
  const mode = optionalBoundedText(project.registrationMode, 40)
  return {
    projectId: requiredText(project.projectId, '项目 ID', 200),
    name: requiredText(project.name, '项目名称', 240),
    registrationMode: mode === 'managed' || mode === 'linked_legacy' ? mode : 'unknown',
    lifecycle: requiredText(project.lifecycle, '项目生命周期', 80),
    revision: requiredInteger(project.revision, '项目修订', 1),
    archivedAt: project.archivedAt === null ? null : requiredText(project.archivedAt, '项目归档时间', 80),
    updatedAt: requiredText(project.updatedAt, '项目更新时间', 80),
  }
}

export function selectUserInitiatedRelocationCandidate(
  projectId: string,
  selectedPath: string,
  scan: IntakeScanResult,
): ProjectCandidate {
  const expectedProjectId = validateProjectId(projectId)
  const selectedPathKey = clientPathKey(requiredText(selectedPath, '目标工作区', 32_767))
  const matches = scan.candidates.filter(candidate =>
    candidate.status === 'relocation_candidate'
    && candidate.detectedMode === 'managed'
    && candidate.manifestProjectId === expectedProjectId
    && clientPathKey(candidate.rootPath) === selectedPathKey)
  if (matches.length > 1 || scan.candidates.length > 1) {
    throw apiError('目标目录产生了多个候选，已停止；请到候选中心人工核对。', 'RELOCATION_CANDIDATE_AMBIGUOUS')
  }
  if (matches.length !== 1) {
    throw apiError('目标目录没有形成与当前项目身份一致的位置候选，已停止；请到候选中心查看冲突。', 'RELOCATION_CANDIDATE_MISMATCH')
  }
  return matches[0]!
}

function clientPathKey(value: string): string {
  return value.replaceAll('/', '\\').replace(/[\\]+$/u, '').toLowerCase()
}

function normalizeProjectWorkspaceStatus(value: unknown): ProjectWorkspaceStatus {
  const object = requiredRecord(value, '项目工作区状态')
  return {
    projectId: validateIdentifier(requiredText(object.projectId, '项目 ID', 200), '项目'),
    root: requiredText(object.root, '工作区根路径', 2_048),
  }
}

function normalizeProjectWorkspaceContinuity(value: unknown): ProjectWorkspaceContinuity {
  const object = requiredRecord(value, '项目工作区历史')
  const activeRoot = requiredText(object.activeRoot, '活动工作区根路径', 32_767)
  const locations = requiredArray(object.locations, '工作区位置历史')
  if (locations.length < 1 || locations.length > 128) throw invalidResponse('工作区位置历史')
  const normalized = locations.map(locationValue => {
    const location = requiredRecord(locationValue, '工作区位置历史')
    const kindValue = requiredText(location.kind, '工作区位置类型', 20)
    if (kindValue !== 'primary' && kindValue !== 'mirror' && kindValue !== 'archive') {
      throw invalidResponse('工作区位置类型')
    }
    const kind: ProjectWorkspaceContinuityLocation['kind'] = kindValue
    return {
      locationId: requiredText(location.locationId, '位置 ID', 200),
      root: requiredText(location.root, '工作区位置', 32_767),
      kind,
      active: requiredBoolean(location.active, '活动位置标记'),
      revision: requiredInteger(location.revision, '位置修订号', 1),
      createdAt: requiredText(location.createdAt, '位置创建时间', 80),
      updatedAt: requiredText(location.updatedAt, '位置更新时间', 80),
    }
  })
  const active = normalized.filter(location => location.active)
  if (active.length !== 1 || clientPathKey(active[0]?.root ?? '') !== clientPathKey(activeRoot)) {
    throw invalidResponse('活动工作区位置')
  }
  return {
    projectId: validateProjectId(requiredText(object.projectId, '项目 ID', 200)),
    revision: requiredInteger(object.revision, '项目修订号', 1),
    activeRoot,
    locations: normalized,
  }
}

function normalizeProjectWorkspaceTree(value: unknown): ProjectWorkspaceTree {
  const object = requiredRecord(value, '项目工作区目录树')
  const entries = requiredArray(object.entries, '目录条目').map((item): ProjectWorkspaceEntry => {
    const entry = requiredRecord(item, '目录条目')
    const kind = requiredText(entry.kind, '条目类型', 20)
    if (kind !== 'directory' && kind !== 'file') throw invalidResponse('条目类型')
    return {
      name: requiredText(entry.name, '条目名称', 500),
      kind,
      ...(entry.byteSize === undefined ? {} : { byteSize: requiredInteger(entry.byteSize, '条目大小', 0) }),
    }
  })
  return { entries, truncated: optionalBoolean(object.truncated, '截断标记', false) }
}

function normalizeProjectWorkspaceFile(value: unknown): ProjectWorkspaceFile {
  const object = requiredRecord(value, '项目工作区文件')
  const kind = requiredText(object.kind, '文件类型', 20)
  const byteSize = requiredInteger(object.byteSize, '文件大小', 0)
  if (kind === 'text') {
    return {
      kind: 'text',
      content: requiredText(object.content, '文件内容', 262_144),
      truncated: optionalBoolean(object.truncated, '截断标记', false),
      byteSize,
      sha256: requiredText(object.sha256, '内容哈希', 80),
    }
  }
  if (kind === 'binary') {
    return {
      kind: 'binary',
      byteSize,
      ...(object.tooLarge === undefined ? {} : { tooLarge: optionalBoolean(object.tooLarge, '超大标记', false) }),
      mime: requiredText(object.mime, 'MIME 类型', 100),
    }
  }
  throw invalidResponse('文件类型')
}

function optionalBoolean(value: unknown, label: string, fallback: boolean): boolean {
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'boolean') throw invalidResponse(label)
  return value
}

function normalizeJob(value: unknown): IntakeJob {
  const object = requiredRecord(value, '扫描任务')
  const mode = requiredText(object.mode, '扫描模式', 40)
  if (mode !== 'source-root' && mode !== 'project-root') throw invalidResponse('扫描模式')
  return {
    jobId: validateIdentifier(requiredText(object.jobId, '扫描任务 ID', 200), '扫描任务'),
    sourceRootId: validateIdentifier(requiredText(object.sourceRootId, '来源目录 ID', 200), '来源目录'),
    mode,
    status: requiredText(object.status, '扫描任务状态', 80),
    scannerVersion: requiredText(object.scannerVersion, '扫描器版本', 100),
    startedAt: requiredText(object.startedAt, '扫描开始时间', 80),
    ...(object.completedAt === undefined || object.completedAt === null
      ? {}
      : { completedAt: requiredText(object.completedAt, '扫描完成时间', 80) }),
    summary: normalizeSummary(object.summary),
    issues: normalizeJobIssues(object.issues ?? []),
  }
}

function normalizeJobIssues(value: unknown): readonly IntakeJobIssue[] {
  return requiredArray(value, '扫描来源问题').map(raw => {
    const issue = requiredRecord(raw, '扫描来源问题')
    const severity = requiredText(issue.severity, '扫描来源问题等级', 20)
    const status = requiredText(issue.status, '扫描来源问题状态', 20)
    if (!['info', 'warning', 'error', 'blocking'].includes(severity)
      || (status !== 'open' && status !== 'resolved')) throw invalidResponse('扫描来源问题状态')
    return {
      issueId: requiredText(issue.issueId, '扫描来源问题 ID', 200),
      code: requiredText(issue.code, '扫描来源问题代码', 100),
      severity: severity as IntakeJobIssue['severity'],
      status,
      message: requiredText(issue.message, '扫描来源问题说明', 500),
    }
  })
}

function normalizeSourceRoot(value: unknown): IntakeSourceRoot {
  const object = requiredRecord(value, '扫描来源目录')
  const kind = requiredText(object.kind, '来源目录类型', 40)
  if (kind !== 'source-root' && kind !== 'project-root') throw invalidResponse('来源目录类型')
  return {
    sourceRootId: validateIdentifier(requiredText(object.sourceRootId, '来源目录 ID', 200), '来源目录'),
    kind,
    path: requiredText(object.path, '扫描来源目录', 32_767),
    revision: requiredInteger(object.revision, '来源目录修订号', 0),
    updatedAt: requiredText(object.updatedAt, '来源目录更新时间', 80),
  }
}

function normalizeDocument(value: unknown): CandidateDocument {
  const object = requiredRecord(value, '候选文档')
  const contentHash = optionalBoundedText(object.contentHash, 80)
  if (contentHash !== undefined && !/^sha256:[0-9a-f]{64}$/.test(contentHash)) {
    throw invalidResponse('文档内容哈希')
  }
  return {
    documentId: requiredText(object.documentId, '候选文档 ID', 200),
    relativePath: requiredText(object.relativePath, '文档相对路径', 2_048),
    suggestedRole: normalizeDocumentRole(object.suggestedRole),
    ...(contentHash === undefined ? {} : { contentHash }),
    ...(object.title === undefined || object.title === null
      ? {}
      : { title: requiredText(object.title, '文档标题', 500) }),
    evidence: normalizeStringList(object.evidence, '文档证据', 50, 500),
    ...(object.preview === undefined || object.preview === null
      ? {}
      : { preview: requiredText(object.preview, '文档预览', 4_000) }),
  }
}

function normalizeIssue(value: unknown): CandidateIssue {
  const object = requiredRecord(value, '候选问题')
  const severityValue = requiredText(object.severity, '问题级别', 40)
  const severity = severityValue === 'info'
    || severityValue === 'warning'
    || severityValue === 'error'
    || severityValue === 'blocking'
    ? severityValue
    : 'warning'
  const details = object.details
  const detailsObject = isRecord(details) ? details : undefined
  const message = typeof details === 'string'
    ? requiredText(details, '问题说明', 1_000)
    : optionalBoundedText(detailsObject?.message, 1_000)
      ?? optionalBoundedText(detailsObject?.detail, 1_000)
      ?? summarizeIssueDetails(detailsObject)
      ?? requiredText(object.code, '问题代码', 100)
  return {
    issueId: requiredText(object.issueId, '问题 ID', 200),
    code: requiredText(object.code, '问题代码', 100),
    severity,
    status: requiredText(object.status, '问题状态', 80),
    message,
    ...(detailsObject?.relativePath === undefined
      ? {}
      : { relativePath: requiredText(detailsObject.relativePath, '问题路径', 2_048) }),
  }
}

function summarizeIssueDetails(value: Record<string, unknown> | undefined): string | undefined {
  if (value === undefined) return undefined
  const parts = Object.entries(value).flatMap(([key, item]) => {
    if (key === 'relativePath' || key === 'message' || key === 'detail') return []
    if (typeof item !== 'string' && typeof item !== 'number' && typeof item !== 'boolean') return []
    const text = `${key}: ${String(item)}`
    return text.length <= 300 ? [text] : []
  }).slice(0, 4)
  return parts.length === 0 ? undefined : parts.join('；')
}

function normalizeLifecycleResult(value: unknown): LifecycleCommandResult {
  const object = requiredRecord(value, '生命周期结果')
  const status = requiredText(object.status, '生命周期状态', 40)
  if (status !== 'accepted' && status !== 'replayed' && status !== 'rejected') {
    throw invalidResponse('生命周期状态')
  }
  const error = object.error === undefined ? undefined : requiredRecord(object.error, '生命周期错误')
  if (status === 'rejected' && error === undefined) throw invalidResponse('生命周期错误')
  return {
    status,
    ...(object.projectId === undefined ? {} : { projectId: requiredText(object.projectId, '项目 ID', 200) }),
    ...(object.aggregateRevision === undefined
      ? {}
      : { aggregateRevision: requiredInteger(object.aggregateRevision, '项目修订号', 1) }),
    ...(error === undefined ? {} : {
      error: {
        code: requiredText(error.code, '错误代码', 100),
        message: requiredText(error.message, '错误说明', 500),
      },
    }),
  }
}

function normalizeValueSource(value: unknown, field: string): CandidateValueSource | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') return { relativePath: requiredText(value, field, 2_048) }
  const object = requiredRecord(value, field)
  const relativePath = object.relativePath === undefined
    ? undefined
    : requiredText(object.relativePath, field, 2_048)
  const label = object.label === undefined ? undefined : requiredText(object.label, field, 500)
  if (relativePath === undefined && label === undefined) throw invalidResponse(field)
  return {
    ...(relativePath === undefined ? {} : { relativePath }),
    ...(label === undefined ? {} : { label }),
  }
}

function normalizeEvidenceLevel(value: unknown): EvidenceLevel {
  if (typeof value !== 'string') return 'unknown'
  switch (value.toLowerCase()) {
    case 'high': return 'high'
    case 'medium': return 'medium'
    case 'low': return 'low'
    default: return 'unknown'
  }
}

function normalizeDocumentRole(value: unknown): ProjectDocumentRole | null {
  return typeof value === 'string' && (PROJECT_DOCUMENT_ROLES as readonly string[]).includes(value)
    ? value as ProjectDocumentRole
    : null
}

function normalizeSummary(value: unknown): Readonly<Record<string, number>> {
  const object = requiredRecord(value, '扫描摘要')
  const summary: Record<string, number> = {}
  for (const [key, item] of Object.entries(object)) {
    if (/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(key) && Number.isSafeInteger(item) && (item as number) >= 0) {
      summary[key] = item as number
    }
  }
  return summary
}

function normalizeStringList(
  value: unknown,
  field: string,
  maxItems: number,
  maxItemLength: number,
): readonly string[] {
  if (value === undefined || value === null) return []
  const list = requiredArray(value, field)
  if (list.length > maxItems) throw invalidResponse(field)
  return list.map(item => {
    if (typeof item === 'string') return requiredText(item, field, maxItemLength)
    const object = requiredRecord(item, field)
    return requiredText(object.message ?? object.label ?? object.code, field, maxItemLength)
  })
}

function normalizePagedItems<T>(
  value: unknown,
  field: string,
  normalize: (item: unknown) => T,
): PagedItems<T> {
  const object = requiredRecord(value, field)
  const items = requiredArray(object.items, field).map(normalize)
  return {
    items,
    total: requiredInteger(object.total ?? items.length, '总数', items.length),
  }
}

function normalizePagedActions(value: unknown, field: string): PagedItems<ProjectReviewAction> {
  const object = requiredRecord(value, field)
  const items = requiredArray(object.actions, field).map(normalizeReviewAction)
  return {
    items,
    total: requiredInteger(object.total ?? items.length, '总数', items.length),
  }
}

export function normalizeWorkItem(value: unknown): ProjectWorkItem {
  const object = requiredRecord(value, '任务')
  const executionStatus = requiredText(object.executionStatus, '执行状态', 40)
  const reviewStatus = requiredText(object.reviewStatus, '审核状态', 40)
  if (!['draft', 'ready', 'running', 'paused', 'blocked', 'completed', 'cancelled'].includes(executionStatus)
    || !['not_requested', 'pending', 'changes_requested', 'approved', 'rejected'].includes(reviewStatus)) {
    throw invalidResponse('任务状态')
  }
  return {
    workItemId: validateIdentifier(requiredText(object.workItemId, '任务 ID', 200), '任务'),
    projectId: validateProjectId(requiredText(object.projectId, '项目 ID', 200)),
    title: requiredText(object.title, '任务标题', 500),
    instruction: object.instruction === undefined || object.instruction === null
      ? null
      : requiredText(object.instruction, '任务说明', 20_000),
    acceptance: normalizeStringList(object.acceptance, '验收标准', 50, 1000),
    executionStatus: executionStatus as WorkItemExecutionStatus,
    reviewStatus: reviewStatus as WorkItemReviewStatus,
    priority: requiredInteger(object.priority, '优先级', 0),
    revision: requiredInteger(object.revision, '任务修订号', 1),
    createdAt: requiredText(object.createdAt, '任务创建时间', 80),
    updatedAt: requiredText(object.updatedAt, '任务更新时间', 80),
    archivedAt: object.archivedAt === undefined || object.archivedAt === null
      ? null
      : requiredText(object.archivedAt, '任务归档时间', 80),
  }
}

export function normalizeRun(value: unknown): ProjectRun {
  const object = requiredRecord(value, '运行')
  const status = requiredText(object.status, '运行状态', 40)
  if (!['queued', 'running', 'completed', 'failed', 'blocked', 'orphaned', 'cancelled'].includes(status)) {
    throw invalidResponse('运行状态')
  }
  return {
    runId: validateIdentifier(requiredText(object.runId, '运行 ID', 200), '运行'),
    projectId: validateProjectId(requiredText(object.projectId, '项目 ID', 200)),
    workItemId: validateIdentifier(requiredText(object.workItemId, '任务 ID', 200), '任务'),
    attemptNo: requiredInteger(object.attemptNo, '尝试序号', 1),
    status: status as ProjectRun['status'],
    instructionSnapshot: object.instructionSnapshot === undefined || object.instructionSnapshot === null
      ? null
      : requiredText(object.instructionSnapshot, '指令快照', 20_000),
    acceptanceSnapshot: object.acceptanceSnapshot ?? [],
    revision: requiredInteger(object.revision, '运行修订号', 1),
    createdAt: requiredText(object.createdAt, '运行创建时间', 80),
    startedAt: object.startedAt === undefined || object.startedAt === null
      ? null
      : requiredText(object.startedAt, '运行开始时间', 80),
    completedAt: object.completedAt === undefined || object.completedAt === null
      ? null
      : requiredText(object.completedAt, '运行完成时间', 80),
    updatedAt: requiredText(object.updatedAt, '运行更新时间', 80),
  }
}

export function normalizeProgressUpdate(value: unknown): ProjectProgressUpdate {
  const object = requiredRecord(value, '进展更新')
  const kind = requiredText(object.kind, '更新类型', 40)
  if (!['progress', 'blocker', 'completion_declared'].includes(kind)) throw invalidResponse('更新类型')
  const completionPercent = object.completionPercent === undefined || object.completionPercent === null
    ? null
    : requiredInteger(object.completionPercent, '完成百分比', 0)
  if (completionPercent !== null && completionPercent > 100) throw invalidResponse('完成百分比')
  return {
    progressUpdateId: validateIdentifier(requiredText(object.progressUpdateId, '更新 ID', 200), '进展更新'),
    projectId: validateProjectId(requiredText(object.projectId, '项目 ID', 200)),
    workItemId: validateIdentifier(requiredText(object.workItemId, '任务 ID', 200), '任务'),
    runId: validateIdentifier(requiredText(object.runId, '运行 ID', 200), '运行'),
    kind: kind as ProjectProgressUpdate['kind'],
    summary: requiredText(object.summary, '更新摘要', 1000),
    needs: normalizeStringList(object.needs, '所需协助', 50, 1000),
    acceptanceClaims: normalizeStringList(object.acceptanceClaims, '验收声明', 50, 1000),
    evidence: Array.isArray(object.evidence)
      ? object.evidence.filter(isRecord)
      : [],
    completionPercent,
    details: object.details === undefined || object.details === null
      ? null
      : requiredText(object.details, '更新详情', 20_000),
    threadId: object.threadId === undefined || object.threadId === null
      ? null
      : requiredText(object.threadId, '会话线程', 128),
    sourceEventId: object.sourceEventId === undefined || object.sourceEventId === null
      ? null
      : requiredText(object.sourceEventId, '来源事件', 80),
    commandId: requiredText(object.commandId, '指令 ID', 200),
    aggregateType: object.aggregateType === 'work_item' ? 'work_item' : 'run',
    aggregateId: requiredText(object.aggregateId, '聚合 ID', 200),
    aggregateRevision: requiredInteger(object.aggregateRevision, '聚合修订号', 1),
    generatedBy: isRecord(object.generatedBy) ? object.generatedBy : {},
    createdAt: requiredText(object.createdAt, '更新创建时间', 80),
  }
}

export function normalizeReview(value: unknown): ProjectReview {
  const object = requiredRecord(value, '审阅')
  const status = requiredText(object.status, '审阅状态', 40)
  if (!['requested', 'in_review', 'approved', 'rejected', 'superseded'].includes(status)) {
    throw invalidResponse('审阅状态')
  }
  const risk = object.risk === undefined || object.risk === null
    ? null
    : requiredText(object.risk, '风险等级', 40)
  if (risk !== null && !['unrated', 'low', 'medium', 'high'].includes(risk)) throw invalidResponse('风险等级')
  return {
    reviewId: validateIdentifier(requiredText(object.reviewId, '审阅 ID', 200), '审阅'),
    projectId: validateProjectId(requiredText(object.projectId, '项目 ID', 200)),
    workItemId: object.workItemId === undefined || object.workItemId === null
      ? null
      : validateIdentifier(requiredText(object.workItemId, '任务 ID', 200), '任务'),
    reviewedWorkItemRevision: object.reviewedWorkItemRevision === undefined || object.reviewedWorkItemRevision === null
      ? null
      : requiredInteger(object.reviewedWorkItemRevision, '被审任务修订号', 1),
    artifactRefs: object.artifactRefs ?? [],
    status: status as ProjectReview['status'],
    risk: risk as ProjectReview['risk'],
    requestedBy: isRecord(object.requestedBy) ? object.requestedBy : {},
    decidedBy: object.decidedBy === undefined || object.decidedBy === null
      ? null
      : isRecord(object.decidedBy) ? object.decidedBy : {},
    revision: requiredInteger(object.revision, '审阅修订号', 1),
    createdAt: requiredText(object.createdAt, '审阅创建时间', 80),
    updatedAt: requiredText(object.updatedAt, '审阅更新时间', 80),
    decidedAt: object.decidedAt === undefined || object.decidedAt === null
      ? null
      : requiredText(object.decidedAt, '审阅决定时间', 80),
  }
}

export function normalizeReviewAction(value: unknown): ProjectReviewAction {
  const object = requiredRecord(value, '审阅记录')
  const action = requiredText(object.action, '记录动作', 40)
  if (!['comment', 'request_changes', 'approve', 'reject', 'supersede'].includes(action)) {
    throw invalidResponse('记录动作')
  }
  return {
    reviewActionId: validateIdentifier(requiredText(object.reviewActionId, '记录 ID', 200), '审阅记录'),
    reviewId: validateIdentifier(requiredText(object.reviewId, '审阅 ID', 200), '审阅'),
    action: action as ProjectReviewAction['action'],
    actor: isRecord(object.actor) ? object.actor : {},
    comment: object.comment === undefined || object.comment === null
      ? null
      : requiredText(object.comment, '评论内容', 4000),
    createdAt: requiredText(object.createdAt, '记录创建时间', 80),
  }
}

export function normalizeDecision(value: unknown): ProjectDecision {
  const object = requiredRecord(value, '决定')
  const status = requiredText(object.status, '决定状态', 40)
  if (!['proposed', 'accepted', 'rejected', 'superseded'].includes(status)) throw invalidResponse('决定状态')
  return {
    decisionId: validateIdentifier(requiredText(object.decisionId, '决定 ID', 200), '决定'),
    projectId: validateProjectId(requiredText(object.projectId, '项目 ID', 200)),
    workItemId: object.workItemId === undefined || object.workItemId === null
      ? null
      : validateIdentifier(requiredText(object.workItemId, '任务 ID', 200), '任务'),
    title: requiredText(object.title, '决定标题', 300),
    context: object.context === undefined || object.context === null
      ? null
      : requiredText(object.context, '决定背景', 20_000),
    options: object.options ?? [],
    status: status as ProjectDecision['status'],
    rationale: object.rationale === undefined || object.rationale === null
      ? null
      : requiredText(object.rationale, '决定理由', 4000),
    proposedBy: isRecord(object.proposedBy) ? object.proposedBy : {},
    decidedBy: object.decidedBy === undefined || object.decidedBy === null
      ? null
      : isRecord(object.decidedBy) ? object.decidedBy : {},
    revision: requiredInteger(object.revision, '决定修订号', 1),
    createdAt: requiredText(object.createdAt, '决定创建时间', 80),
    updatedAt: requiredText(object.updatedAt, '决定更新时间', 80),
    decidedAt: object.decidedAt === undefined || object.decidedAt === null
      ? null
      : requiredText(object.decidedAt, '决定时间', 80),
  }
}

export function normalizeEvent(value: unknown): ProjectEvent {
  const object = requiredRecord(value, '事件')
  const aggregateType = requiredText(object.aggregateType, '聚合类型', 40)
  if (!['project', 'work_item', 'run'].includes(aggregateType)) throw invalidResponse('聚合类型')
  return {
    eventId: validateIdentifier(requiredText(object.eventId, '事件 ID', 200), '事件'),
    sequence: requiredInteger(object.sequence, '事件序号', 1),
    projectId: validateProjectId(requiredText(object.projectId, '项目 ID', 200)),
    aggregateType: aggregateType as ProjectEvent['aggregateType'],
    aggregateId: requiredText(object.aggregateId, '聚合 ID', 200),
    beforeRevision: requiredInteger(object.beforeRevision, '前修订号', 0),
    afterRevision: requiredInteger(object.afterRevision, '后修订号', 1),
    eventType: requiredText(object.eventType, '事件类型', 100),
    schemaVersion: requiredText(object.schemaVersion, '事件 Schema', 80),
    data: isRecord(object.data) ? object.data : {},
    actor: isRecord(object.actor) ? object.actor : {},
    provenance: isRecord(object.provenance) ? object.provenance : {},
    commandId: requiredText(object.commandId, '指令 ID', 200),
    correlationId: object.correlationId === undefined || object.correlationId === null
      ? null
      : requiredText(object.correlationId, '关联 ID', 200),
    causationId: object.causationId === undefined || object.causationId === null
      ? null
      : requiredText(object.causationId, '起因 ID', 200),
    occurredAt: requiredText(object.occurredAt, '发生时间', 80),
    recordedAt: requiredText(object.recordedAt, '记录时间', 80),
  }
}

export function normalizeQuarantineItem(value: unknown): ProjectQuarantineItem {
  const object = requiredRecord(value, '隔离项')
  const status = requiredText(object.status, '隔离状态', 40)
  if (!['open', 'resolved', 'ignored'].includes(status)) throw invalidResponse('隔离状态')
  return {
    quarantineId: validateIdentifier(requiredText(object.quarantineId, '隔离 ID', 200), '隔离项'),
    projectId: object.projectId === undefined || object.projectId === null
      ? null
      : validateProjectId(requiredText(object.projectId, '项目 ID', 200)),
    sourceKind: requiredText(object.sourceKind, '来源类型', 100),
    sourceRef: requiredText(object.sourceRef, '来源引用', 512),
    reasonCode: requiredText(object.reasonCode, '隔离原因', 100),
    payloadRef: object.payloadRef === undefined || object.payloadRef === null
      ? null
      : requiredText(object.payloadRef, '载荷引用', 512),
    status: status as ProjectQuarantineItem['status'],
    details: isRecord(object.details) ? object.details : {},
    revision: requiredInteger(object.revision, '隔离修订号', 1),
    createdAt: requiredText(object.createdAt, '隔离创建时间', 80),
    updatedAt: requiredText(object.updatedAt, '隔离更新时间', 80),
    resolvedAt: object.resolvedAt === undefined || object.resolvedAt === null
      ? null
      : requiredText(object.resolvedAt, '隔离处理时间', 80),
  }
}

export function normalizeSessionBinding(value: unknown): ProjectSessionBinding {
  const object = requiredRecord(value, '会话绑定')
  return {
    bindingId: validateIdentifier(requiredText(object.bindingId, '绑定 ID', 200), '会话绑定'),
    projectId: validateProjectId(requiredText(object.projectId, '项目 ID', 200)),
    runId: validateIdentifier(requiredText(object.runId, '运行 ID', 200), '运行'),
    harnessInstanceRef: requiredText(object.harnessInstanceRef, 'Harness 实例', 127),
    sessionId: requiredText(object.sessionId, '会话 ID', 200),
    threadId: requiredText(object.threadId, '线程 ID', 128),
    createdAt: requiredText(object.createdAt, '绑定时间', 80),
  }
}

function validateCandidateId(value: string): string {
  if (!isCandidateResourceKey(value)) throw apiError('候选项目标识无效。', 'INVALID_CANDIDATE_ID')
  return value
}

function validateCandidateView(value: CandidateCenterView): CandidateCenterView {
  if (!['review', 'ignored', 'history'].includes(value)) {
    throw apiError('候选中心视图无效。', 'INVALID_CANDIDATE_VIEW')
  }
  return value
}

function validateCandidateSearch(value: string): string {
  if (typeof value !== 'string' || value.length > 200 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw apiError('候选搜索条件无效。', 'INVALID_CANDIDATE_SEARCH')
  }
  return value
}

function validateCandidateLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 100) {
    throw apiError('候选分页大小无效。', 'INVALID_CANDIDATE_LIMIT')
  }
  return value
}

function validateCandidateBatch(
  candidates: readonly { candidateId: string; expectedRevision: number }[],
): Array<{ candidateId: string; expectedRevision: number }> {
  if (!Array.isArray(candidates) || candidates.length < 1 || candidates.length > 100) {
    throw apiError('候选批量操作必须包含 1 至 100 项。', 'INVALID_CANDIDATE_BATCH')
  }
  const normalized = candidates.map(candidate => ({
    candidateId: validateCandidateId(candidate.candidateId),
    expectedRevision: validateRevision(candidate.expectedRevision),
  }))
  if (new Set(normalized.map(candidate => candidate.candidateId)).size !== normalized.length) {
    throw apiError('候选批量操作不能包含重复项目。', 'INVALID_CANDIDATE_BATCH')
  }
  return normalized
}

function validateProjectId(value: string): string {
  if (!/^prj_[A-Za-z0-9-]{8,180}$/.test(value)) throw apiError('项目标识无效。', 'INVALID_PROJECT_ID')
  return value
}

function validateProjectSearch(value: string): string {
  if (typeof value !== 'string' || value.length > 200 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw apiError('项目搜索条件无效。', 'INVALID_PROJECT_SEARCH')
  }
  return value
}

function validateProjectLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 100) {
    throw apiError('项目分页大小无效。', 'INVALID_PROJECT_LIMIT')
  }
  return value
}

function validateProposalId(value: string): string {
  if (!/^rbd_[A-Za-z0-9-]{8,180}$/.test(value)) throw apiError('重绑提案标识无效。', 'INVALID_PROPOSAL_ID')
  return value
}

function validateIdentifier(value: string, label: string): string {
  if (!/^[A-Za-z][A-Za-z0-9_.:-]{2,199}$/.test(value)) throw apiError(`${label}标识无效。`, 'INVALID_IDENTIFIER')
  return value
}

function validateRevision(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw apiError('候选项目修订号无效。', 'INVALID_REVISION')
  return value
}

export function normalizeTemplateList(value: unknown): ProjectTemplateList {
  const object = requiredRecord(value, '模板列表')
  const templates = requiredArray(object.templates, '模板列表').map((raw, index) => {
    const template = requiredRecord(raw, `模板 ${String(index + 1)}`)
    return {
      templateId: requiredText(template.templateId, 'templateId', 128),
      templateVersion: requiredText(template.templateVersion, 'templateVersion', 64),
      displayName: requiredText(template.displayName, 'displayName', 120),
      description: optionalBoundedText(template.description, 2000) ?? null,
      protocolVersion: requiredText(template.protocolVersion, 'protocolVersion', 80),
      templateHash: requiredText(template.templateHash, 'templateHash', 80),
    }
  })
  return { templates, total: templates.length }
}

export function normalizePrepareCreateResult(value: unknown): PrepareCreateResult {
  const object = requiredRecord(value, '新建项目预检')
  const template = requiredRecord(object.template, '新建项目模板')
  return {
    template: {
      templateId: requiredText(template.templateId, 'templateId', 128),
      templateVersion: requiredText(template.templateVersion, 'templateVersion', 64),
      displayName: requiredText(template.displayName, 'displayName', 120),
      description: optionalBoundedText(template.description, 2000) ?? null,
      protocolVersion: 'project-control.dsh/v1alpha1',
      templateHash: requiredText(template.templateHash, 'templateHash', 80),
    },
    projectId: requiredText(object.projectId, 'projectId', 80),
    targetDisplayPath: requiredText(object.targetDisplayPath, 'targetDisplayPath', 2048),
    directoryName: requiredText(object.directoryName, 'directoryName', 120),
    expiresAt: requiredText(object.expiresAt, 'expiresAt', 80),
    writePlan: requiredRecord(object.writePlan, '写入计划'),
    command: requiredRecord(object.command, '新建指令'),
  }
}

export function normalizeDocumentIndex(value: unknown): ProjectDocumentIndex {
  const object = requiredRecord(value, '项目文档索引')
  const mode = requiredText(object.mode, '项目模式', 40)
  if (mode !== 'linked_legacy' && mode !== 'managed') throw invalidResponse('项目模式')
  return {
    projectId: requiredText(object.projectId, '项目 ID', 200),
    mode,
    name: requiredText(object.name, '项目名称', 240),
    revision: requiredInteger(object.revision, '项目修订号', 1),
    locationDisplayPath: optionalBoundedText(object.locationDisplayPath, 32_767) ?? null,
    documents: requiredArray(object.documents, '文档状态').map(normalizeDocumentState),
    proposals: requiredArray(object.proposals, '重绑提案').map(normalizeRebindProposal),
  }
}

function normalizeDocumentState(value: unknown): ProjectDocumentState {
  const object = requiredRecord(value, '文档状态')
  const state = requiredText(object.state, '文档状态', 40)
  const bindingSource = requiredText(object.bindingSource, '绑定来源', 40)
  if (!['ok', 'changed', 'missing', 'unreadable'].includes(state)
    || !['user_confirmed', 'manifest'].includes(bindingSource)) {
    throw invalidResponse('文档状态')
  }
  const contentHash = optionalBoundedText(object.contentHash, 80)
  if (contentHash !== undefined && !/^sha256:[0-9a-f]{64}$/.test(contentHash)) {
    throw invalidResponse('文档内容哈希')
  }
  return {
    role: normalizeDocumentRole(object.role) ?? 'other',
    relativePath: requiredText(object.relativePath, '文档相对路径', 2_048),
    bindingSource: bindingSource as ProjectDocumentState['bindingSource'],
    state: state as ProjectDocumentState['state'],
    contentHash: contentHash ?? null,
    byteSize: object.byteSize === null || object.byteSize === undefined
      ? null
      : requiredInteger(object.byteSize, '文档字节数', 0),
    parseIssues: requiredArray(object.parseIssues, '解析诊断').map((raw): ProjectDocumentParseIssue => {
      const issue = requiredRecord(raw, '解析诊断')
      const severity = requiredText(issue.severity, '诊断级别', 20)
      if (!['info', 'warning', 'error', 'blocking'].includes(severity)) throw invalidResponse('诊断级别')
      return {
        code: requiredText(issue.code, '诊断代码', 100),
        severity: severity as ProjectDocumentParseIssue['severity'],
        message: requiredText(issue.message, '诊断说明', 1_000),
        line: issue.line === null || issue.line === undefined
          ? null
          : requiredInteger(issue.line, '诊断行号', 1),
      }
    }),
    revision: requiredInteger(object.revision, '文档修订号', 1),
    firstSeenAt: requiredText(object.firstSeenAt, '首次发现时间', 80),
    lastVerifiedAt: requiredText(object.lastVerifiedAt, '上次核对时间', 80),
  }
}

function normalizeRebindProposal(value: unknown): ProjectDocumentRebindProposal {
  const object = requiredRecord(value, '重绑提案')
  const status = requiredText(object.status, '提案状态', 40)
  if (!['proposed', 'accepted', 'rejected', 'superseded'].includes(status)) throw invalidResponse('提案状态')
  const candidates = requiredArray(object.candidateRelativePaths, '重绑候选路径')
    .map((item, index) => requiredText(item, `重绑候选路径 ${String(index + 1)}`, 2_048))
  if (candidates.length === 0) throw invalidResponse('重绑候选路径')
  return {
    proposalId: requiredText(object.proposalId, '提案 ID', 200),
    role: normalizeDocumentRole(object.role) ?? 'other',
    missingRelativePath: requiredText(object.missingRelativePath, '缺失路径', 2_048),
    contentHash: requiredText(object.contentHash, '提案哈希', 80),
    candidateRelativePaths: candidates,
    candidateCount: requiredInteger(object.candidateCount, '候选数量', 1),
    unambiguous: requiredBoolean(object.unambiguous, '候选唯一性'),
    status: status as ProjectDocumentRebindProposal['status'],
    resolvedRelativePath: optionalBoundedText(object.resolvedRelativePath, 2_048) ?? null,
    revision: requiredInteger(object.revision, '提案修订号', 1),
    createdAt: requiredText(object.createdAt, '提案创建时间', 80),
    updatedAt: requiredText(object.updatedAt, '提案更新时间', 80),
    resolvedAt: optionalBoundedText(object.resolvedAt, 80) ?? null,
    applicable: requiredBoolean(object.applicable, '提案可应用性'),
  }
}

export function normalizeRebindResolutionResult(value: unknown): RebindResolutionResult {
  const object = requiredRecord(value, '重绑处理结果')
  const proposal = object.proposal === undefined || object.proposal === null
    ? null
    : normalizeRebindProposal(object.proposal)
  return {
    proposal,
    projectRevision: requiredInteger(object.projectRevision, '项目修订号', 1),
  }
}

function requiredRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) throw invalidResponse(field)
  return value
}

function requiredArray(value: unknown, field: string): readonly unknown[] {
  if (!Array.isArray(value)) throw invalidResponse(field)
  return value
}

function requiredText(value: unknown, field: string, maxLength: number): string {
  const text = optionalBoundedText(value, maxLength)
  if (text === undefined) throw invalidResponse(field)
  return text
}

function optionalBoundedText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized.length > 0 && normalized.length <= maxLength ? normalized : undefined
}

function requiredInteger(value: unknown, field: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) throw invalidResponse(field)
  return value as number
}

function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw invalidResponse(field)
  return value
}

function invalidResponse(field: string): Error {
  return apiError(`项目控制台返回的${field}无效。`, 'INVALID_RESPONSE')
}

function apiError(message: string, code: string, status?: number): Error {
  return Object.assign(new Error(message), { code, ...(status === undefined ? {} : { status }) })
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAbortSignal(value: unknown): value is AbortSignal {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<AbortSignal>
  return typeof candidate.aborted === 'boolean'
    && typeof candidate.addEventListener === 'function'
    && typeof candidate.removeEventListener === 'function'
}
