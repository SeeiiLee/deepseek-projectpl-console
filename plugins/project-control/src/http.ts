import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  validateLifecycleCommand,
  validateLifecycleResult,
  type LifecycleCommand,
} from './lifecycle-validator.ts'
import type { ProjectDocumentBindingInput } from './host/index.js'
import { validateExternalUpdateCommand } from './external-update-validator.ts'

export const PROJECT_CONTROL_API_PREFIX = '/__personal/project-control/v1alpha1'
import { listProjectWorkspaceTree, readProjectWorkspaceFile, searchProjectWorkspaceFiles, streamProjectWorkspaceBlob } from './project-workspace.ts'
export const PROJECT_CONTROL_CLIENT_HEADER = 'x-dsh-personal-client'
export const MAX_BODY_BYTES = 262_144
export const PROJECT_CONTROL_API_VERSION = 'project-control-host/v1alpha1'
export const PROJECT_PROTOCOL_VERSION = 'project-control.dsh/v1alpha1'

export type ProjectControlStorageState =
  | 'ready'
  | 'read_only_newer_schema'
  | 'migration_failed'
  | 'unavailable'

export interface ProjectControlStorageStatus {
  state: ProjectControlStorageState
  schemaVersion: number | null
  writable: boolean
  projectCount: number | null
}

export interface ProjectControlProjectItem {
  projectId: string
  name: string
  registrationMode: 'linked_legacy' | 'managed' | 'unknown'
  lifecycle: string
  revision: number
  archivedAt: string | null
  updatedAt: string
}

export interface ProjectControlProjectList {
  projects: readonly ProjectControlProjectItem[]
  total: number
  /** Older read-service implementations may omit this; HTTP normalizes omission to null. */
  nextCursor?: string | null
}

/** Narrow boundary implemented by the Host adapter in index.ts. HTTP never imports storage directly. */
export interface ProjectControlReadService {
  getStatus(): ProjectControlStorageStatus | Promise<ProjectControlStorageStatus>
  listProjects(options?: {
    view: 'active' | 'archived'
    search?: string
    limit?: number
    afterProjectId?: string
  }): ProjectControlProjectList | Promise<ProjectControlProjectList>
  /** 已登记项目的活动工作区根（null = 项目不存在或无活动位置）。 */
  getProjectWorkspace(projectId: string): { projectId: string; root: string } | null | Promise<{ projectId: string; root: string } | null>
  /** W1 Task D：一次返回全部已登记项目的工作区索引（消除 Client N+1）。 */
  listProjectWorkspaces(): Promise<{ projectId: string; root: string; updatedAt: string }[]> | { projectId: string; root: string; updatedAt: string }[]
}

export interface WorkspaceLocationResolution {
  locationId: string
  kind?: 'primary' | 'mirror' | 'archive'
  displayPath: string
  normalizedPath: string
  verifiedAt?: string
}

interface ProjectRegistrationResolutionBase {
  location: WorkspaceLocationResolution
  manifestName?: string
  manifestHash?: string
  manifestDocumentBindings?: ProjectDocumentBindingInput[]
  origin?: {
    kind: 'imported' | 'template' | 'fork'
    templateId?: string
    templateVersion?: string
    forkedFromProjectId?: string
  }
}

export type ProjectRegistrationResolution = ProjectRegistrationResolutionBase & (
  | { candidateId: string; candidateRevision: number }
  | { candidateId?: never; candidateRevision?: never }
)

interface ProjectRebindResolutionBase {
  newLocation: WorkspaceLocationResolution
}

export type ProjectRebindResolution = ProjectRebindResolutionBase & (
  | { candidateId: string; candidateRevision: number }
  | { candidateId?: never; candidateRevision?: never }
)

export interface ProjectCreateResolution {
  plan: Readonly<Record<string, any>>
  refs: {
    location: WorkspaceLocationResolution & { kind: 'primary'; expiresAt: string }
    sourceRoot: {
      sourceRootId: string
      displayPath: string
      normalizedPath: string
      expiresAt: string
    }
  }
  template: { templateId: string; templateVersion: string; templateHash: string }
  contents: Map<string, Buffer>
  manifestName: string
  manifestHash: string
  manifestDocumentBindings: Array<ProjectDocumentBindingInput>
}

export interface ProjectUpgradeResolution {
  plan: Readonly<Record<string, any>>
  refs: {
    location: WorkspaceLocationResolution & { kind: 'primary'; revision: number }
    sourceRoot: {
      sourceRootId: string
      displayPath: string
      normalizedPath: string
      expiresAt: string
    }
  }
  contents: Map<string, Buffer>
  manifestName: string
  manifestHash: string
  fingerprintHash: string
}

/** Gate 2C can provide this resolver after it has issued stable loc_/srt_ references. */
export interface ProjectControlReferenceResolver {
  /**
   * Verifies the Host-issued intake signature before an existing receipt may
   * short-circuit mutable candidate/ref resolution. The receipt's full request
   * hash still decides whether the command is an exact replay.
   */
  authorizeStoredReplay?(command: LifecycleCommand): boolean | Promise<boolean>
  resolveRegistration(
    command: LifecycleCommand,
  ): ProjectRegistrationResolution | null | Promise<ProjectRegistrationResolution | null>
  resolveRebind(
    command: LifecycleCommand,
  ): ProjectRebindResolution | null | Promise<ProjectRebindResolution | null>
  resolveCreate(
    command: LifecycleCommand,
  ): ProjectCreateResolution | null | Promise<ProjectCreateResolution | null>
  resolveUpgrade(
    command: LifecycleCommand,
  ): ProjectUpgradeResolution | null | Promise<ProjectUpgradeResolution | null>
}

/** Narrow lifecycle boundary; only index.ts adapts the concrete storage implementation. */
export interface ProjectControlLifecycleService {
  replayCommandReceipt?(command: LifecycleCommand): unknown | null | Promise<unknown | null>
  recordRejectedCommand(command: LifecycleCommand, result: LifecycleRejectedResult): unknown | Promise<unknown>
  registerProject(command: LifecycleCommand, trusted: ProjectRegistrationResolution): unknown | Promise<unknown>
  rebindProject(command: LifecycleCommand, trusted: ProjectRebindResolution): unknown | Promise<unknown>
  createProject(command: LifecycleCommand, trusted: ProjectCreateResolution): unknown | Promise<unknown>
  upgradeProject(command: LifecycleCommand, trusted: ProjectUpgradeResolution): unknown | Promise<unknown>
}

export interface ProjectControlHandlerOptions {
  lifecycle?: ProjectControlLifecycleService
  referenceResolver?: ProjectControlReferenceResolver
  intake?: ProjectControlIntakeService
  external?: ProjectControlExternalService
  console?: ProjectControlConsoleService
  now?: () => string
}

/** Gate 2E: capability handshake + external runtime updates + P6 projections. */
export interface ProjectControlExternalService {
  handshake(input: {
    instanceId: string
    appVersion: string
    protocolVersions: readonly string[]
    capabilities: readonly string[]
  }): unknown | Promise<unknown>
  submitExternalUpdate(command: unknown): unknown | Promise<unknown>
  listWorkItems(projectId: string): unknown | Promise<unknown>
  listRuns(projectId: string, workItemId?: string): unknown | Promise<unknown>
  listProgressUpdates(projectId: string): unknown | Promise<unknown>
  listReviews(projectId: string): unknown | Promise<unknown>
  listDecisions(projectId: string): unknown | Promise<unknown>
  listQuarantineItems(): unknown | Promise<unknown>
  resolveQuarantineItem(
    quarantineId: string,
    input: { expectedRevision: number; decision: 'resolved' | 'ignored' },
  ): unknown | Promise<unknown>
  listEvents(projectId: string, afterSequence?: number): unknown | Promise<unknown>
  listReviewActions(reviewId: string): unknown | Promise<unknown>
  listSessions(projectId: string): unknown | Promise<unknown>
}

/** P7 console commands issued by the trusted local desktop UI. */
export interface ProjectControlConsoleService {
  setProjectArchived(
    projectId: string,
    input: { expectedRevision: number; archived: boolean },
  ): unknown | Promise<unknown>
  createWorkItem(projectId: string, input: Record<string, unknown>): unknown | Promise<unknown>
  setWorkItemStatus(
    projectId: string,
    workItemId: string,
    input: Record<string, unknown>,
  ): unknown | Promise<unknown>
  startRun(
    projectId: string,
    runId: string,
    input: Record<string, unknown>,
  ): unknown | Promise<unknown>
  requestReview(
    projectId: string,
    workItemId: string,
    input: Record<string, unknown>,
  ): unknown | Promise<unknown>
  decideReview(
    projectId: string,
    reviewId: string,
    input: Record<string, unknown>,
  ): unknown | Promise<unknown>
  commentReview(
    projectId: string,
    reviewId: string,
    input: Record<string, unknown>,
  ): unknown | Promise<unknown>
}

export type ProjectControlIntakeMode = 'source-root' | 'project-root'

export interface ProjectControlSelectionAuthorization {
  version: 1
  kind: ProjectControlIntakeMode
  expiresAt: string
  nonce: string
  signature: string
}

export interface ProjectControlIntakeScanRequest {
  mode: ProjectControlIntakeMode
  selection: {
    path: string
    authorization: ProjectControlSelectionAuthorization
  }
  maxDepth?: number
}

export interface ProjectControlCandidatePreparation {
  registrationMode: 'linked_legacy' | 'managed'
  name: string
  expectedRevision: number
  documentBindings: Array<{
    role: 'readme' | 'prd' | 'devlog' | 'progress' | 'next' | 'current_architecture' | 'decision' | 'other'
    relativePath: string
    contentHash: string
  }>
}

export interface ProjectControlCreatePreparation {
  selection: {
    path: string
    authorization: {
      version: 1
      kind: 'create-parent'
      expiresAt: string
      nonce: string
      signature: string
    }
  }
  directoryName: string
  name: string
  templateId: string
  templateVersion: string
}

/** Gate 2C Host boundary. Scanner and storage remain outside the HTTP module. */
export interface ProjectControlIntakeService {
  scan(input: ProjectControlIntakeScanRequest): unknown | Promise<unknown>
  listSourceRoots(): unknown | Promise<unknown>
  listCandidates(filter: {
    jobId?: string
    view?: 'review' | 'ignored' | 'history'
    search?: string
    limit?: number
    afterCandidateId?: string
  }): unknown | Promise<unknown>
  getCandidate(candidateId: string): unknown | Promise<unknown>
  setCandidateIgnored(
    candidateId: string,
    input: { ignored: boolean; expectedRevision: number },
  ): unknown | Promise<unknown>
  setCandidatesIgnored(input: {
    ignored: boolean
    candidates: Array<{ candidateId: string; expectedRevision: number }>
  }): unknown | Promise<unknown>
  prepareCandidate(candidateId: string, input: ProjectControlCandidatePreparation): unknown | Promise<unknown>
  listTemplates(): unknown | Promise<unknown>
  prepareCreate(input: ProjectControlCreatePreparation): unknown | Promise<unknown>
  prepareUpgrade(projectId: string, input: { expectedRevision: number }): unknown | Promise<unknown>
  getProjectDocuments(projectId: string): unknown | Promise<unknown>
  refreshProjectDocuments(projectId: string): unknown | Promise<unknown>
  resolveDocumentRebind(
    projectId: string,
    proposalId: string,
    input: {
      expectedRevision: number
      decision: 'accept' | 'reject'
      candidateRelativePath?: string
    },
  ): unknown | Promise<unknown>
}

interface PublicSourceRoot {
  sourceRootId: string
  kind: 'source-root' | 'project-root'
  path: string
  revision: number
  updatedAt: string
}

interface PublicImportJob {
  jobId: string
  sourceRootId: string
  mode: 'source-root' | 'project-root'
  status: 'completed' | 'failed' | 'cancelled'
  scannerVersion: string
  startedAt: string
  completedAt: string
  summary: Record<string, unknown>
  issues: PublicImportJobIssue[]
}

interface PublicImportJobIssue {
  issueId: string
  code: string
  severity: 'info' | 'warning' | 'error' | 'blocking'
  status: 'open' | 'resolved'
  message: string
}

interface PublicValueSource {
  relativePath?: string
  label?: string
}

interface PublicImportCandidate {
  candidateId: string
  jobId: string
  revision: number
  rootPath: string
  suggestedName: string
  nameSource: PublicValueSource | null
  summary: string | null
  summarySource: PublicValueSource | null
  evidenceLevel: 'high' | 'medium' | 'low'
  status: 'discovered' | 'conflict' | 'relocation_candidate' | 'ignored' | 'imported'
  historyReason?: 'completed' | 'superseded'
  detectedMode: 'unknown' | 'linked_legacy' | 'managed'
  manifestProjectId: string | null
  documentCount: number
  issueCount: number
  evidence: string[]
  documents: Array<Record<string, unknown>>
  issues: Array<Record<string, unknown>>
}

export interface LifecycleRejectedResult {
  protocolVersion: 'project-control.dsh/v1alpha1'
  schemaVersion: 'lifecycle-command-result/v1alpha1'
  commandId: string
  correlationId: string
  kind: LifecycleCommand['kind']
  status: 'rejected'
  recordedAt: string
  currentRevision?: number
  error: {
    code: LifecycleErrorCode
    message: string
  }
  fileSync?: {
    status: 'planned'
    planId: string
    planHash: string
    manifestHash: string
  }
}

export type LifecycleErrorCode =
  | 'PROTOCOL_VERSION_UNSUPPORTED'
  | 'SCHEMA_INVALID'
  | 'CAPABILITY_NOT_NEGOTIATED'
  | 'REFERENCE_UNRESOLVED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'REVISION_CONFLICT'
  | 'PATH_OUTSIDE_WORKSPACE'
  | 'CREDENTIAL_DATA_REJECTED'
  | 'QUARANTINED'
  | 'PROJECT_ALREADY_EXISTS'
  | 'LOCATION_CONFLICT'
  | 'MODE_CONFLICT'
  | 'MANIFEST_INVALID'
  | 'MANIFEST_HASH_MISMATCH'
  | 'WRITE_PLAN_STALE'
  | 'TARGET_NOT_EMPTY'
  | 'FILE_SYNC_FAILED'

interface HttpError extends Error {
  code: string
  status: number
  expose: true
  headers?: Readonly<Record<string, string>>
}

/** Create a deliberately public HTTP error; arbitrary storage errors remain private. */
export function projectControlHttpError(
  code: string,
  message: string,
  status = 400,
  headers?: Readonly<Record<string, string>>,
): HttpError {
  return Object.assign(new Error(message), {
    code,
    status,
    expose: true as const,
    ...(headers === undefined ? {} : { headers }),
  })
}

/** Standalone loopback JSON handler used by the Harness Host route and focused tests. */
export function createProjectControlRequestHandler(
  service: ProjectControlReadService,
  options: ProjectControlHandlerOptions = {},
) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    try {
      if (request.headers[PROJECT_CONTROL_CLIENT_HEADER] !== '1') {
        throw projectControlHttpError(
          'PROJECT_CONTROL_CLIENT_REQUIRED',
          '此接口只供个人桌面项目控制台使用。',
          403,
        )
      }

      const parsed = new URL(request.url ?? '/', 'http://127.0.0.1')
      if (parsed.pathname !== PROJECT_CONTROL_API_PREFIX
        && !parsed.pathname.startsWith(`${PROJECT_CONTROL_API_PREFIX}/`)) {
        throw projectControlHttpError('NOT_FOUND', '项目控制台接口不存在。', 404)
      }
      const resource = parsed.pathname.slice(PROJECT_CONTROL_API_PREFIX.length)

      if (resource === '/status') {
        requireGetWithoutBody(request)
        const status = normalizeStatus(await service.getStatus())
        sendJson(response, 200, {
          ok: true,
          data: {
            apiVersion: PROJECT_CONTROL_API_VERSION,
            protocolVersion: PROJECT_PROTOCOL_VERSION,
            storage: {
              state: status.state,
              schemaVersion: status.schemaVersion,
              writable: status.writable,
            },
            counts: { projects: status.projectCount },
            capabilities: [
              'status.read',
              'projects.read',
              ...(options.lifecycle === undefined ? [] : ['lifecycle.command.submit']),
              ...(options.intake === undefined ? [] : [
                'intake.directory.scan',
                'intake.candidates.read',
                'intake.candidates.review',
                'intake.candidates.views',
                'intake.candidates.bulk-review',
                'project.documents.read',
                'project.workspace.read',
                'project.documents.refresh',
                'project.document-rebind.resolve',
              ]),
              ...(options.external === undefined ? [] : [
                'external.handshake',
                'external.update.submit',
                'workitems.read',
                'runs.read',
                'progress.read',
                'reviews.read',
                'review-actions.read',
                'decisions.read',
                'quarantine.read',
                'quarantine.resolve',
                'events.read',
              ]),
              ...(options.console === undefined ? [] : [
                'projects.archive',
                'projects.unarchive',
                'workitems.write',
                'workitems.status.write',
                'reviews.request',
                'reviews.decide',
                'reviews.comment',
                'runs.start',
              ]),
            ],
          },
        })
        return
      }

      if (resource === '/projects') {
        requireGetWithoutBody(request)
        const view = optionalSingleQuery(parsed, 'view', /^(?:active|archived)$/u) ?? 'active'
        const search = optionalBoundedQuery(parsed, 'search', 200)
        const limit = optionalIntegerQuery(parsed, 'limit', 1, 100)
        const afterProjectId = optionalSingleQuery(parsed, 'afterProjectId', PROJECT_ID)
        rejectUnexpectedQuery(parsed, new Set(['view', 'search', 'limit', 'afterProjectId']))
        const list = normalizeProjectList(await service.listProjects({
          view: view as 'active' | 'archived',
          ...(search === undefined ? {} : { search }),
          ...(limit === undefined ? {} : { limit }),
          ...(afterProjectId === undefined ? {} : { afterProjectId }),
        }))
        sendJson(response, 200, {
          ok: true,
          data: list,
        })
        return
      }

      const projectArchiveRoute = /^\/projects\/(prj_[0-9a-f-]+)\/(archive|unarchive)$/u.exec(resource)
      if (projectArchiveRoute !== null) {
        requireMethod(request, 'POST')
        const consoleService = requireConsole(options)
        const projectId = projectArchiveRoute[1]
        const action = projectArchiveRoute[2]
        if (projectId === undefined || !PROJECT_ID.test(projectId)) {
          throw projectControlHttpError('NOT_FOUND', '项目不存在。', 404)
        }
        rejectUnexpectedQuery(parsed, new Set())
        const input = normalizeProjectLifecycleRequest(await readJsonBody(request))
        const result = normalizeProjectList({
          projects: [await consoleService.setProjectArchived(projectId, {
            expectedRevision: input.expectedRevision,
            archived: action === 'archive',
          }) as ProjectControlProjectItem],
          total: 1,
          nextCursor: null,
        }).projects[0]
        sendJson(response, 200, { ok: true, data: result })
        return
      }

      if (resource === '/lifecycle') {
        requireMethod(request, 'POST')
        const validation = validateLifecycleCommand(await readJsonBody(request))
        if (!validation.ok) {
          if (validation.reason === 'validation_unavailable') {
            throw projectControlHttpError(
              'COMMAND_VALIDATION_UNAVAILABLE',
              '生命周期合同校验器暂不可用；只读项目状态仍可使用。',
              503,
            )
          }
          throw projectControlHttpError(
            'SCHEMA_INVALID',
            '生命周期指令不符合 project-control.dsh/v1alpha1 合同。',
            400,
          )
        }
        const result = await executeLifecycleCommand(validation.value, options)
        const resultValidation = validateLifecycleResult(result)
        if (!resultValidation.ok) {
          if (resultValidation.reason === 'validation_unavailable') {
            throw projectControlHttpError(
              'RESULT_VALIDATION_UNAVAILABLE',
              '生命周期结果校验器暂不可用；只读项目状态仍可使用。',
              503,
            )
          }
          throw new TypeError('lifecycle service returned a result outside the canonical contract')
        }
        sendJson(response, 200, {
          ok: true,
          data: normalizeLifecycleResult(resultValidation.value),
        })
        return
      }

      if (resource === '/intake/source-roots') {
        requireGetWithoutBody(request)
        const intake = requireIntake(options)
        const sourceRoots = normalizeSourceRoots(await intake.listSourceRoots())
        sendJson(response, 200, {
          ok: true,
          data: { sourceRoots, total: sourceRoots.length },
        })
        return
      }

      if (resource === '/intake/scan') {
        requireMethod(request, 'POST')
        const intake = requireIntake(options)
        const input = normalizeIntakeScanRequest(await readJsonBody(request))
        const result = normalizeImportScan(await intake.scan(input))
        sendJson(response, 200, { ok: true, data: result })
        return
      }

      if (resource === '/intake/candidates') {
        requireGetWithoutBody(request)
        const intake = requireIntake(options)
        const jobId = optionalSingleQuery(parsed, 'jobId', IMPORT_JOB_ID)
        const view = optionalSingleQuery(parsed, 'view', /^(?:review|ignored|history)$/u) as
          | 'review' | 'ignored' | 'history' | undefined
        const search = optionalBoundedQuery(parsed, 'search', 200)
        const limit = optionalIntegerQuery(parsed, 'limit', 1, 100)
        const afterCandidateId = optionalSingleQuery(parsed, 'afterCandidateId', IMPORT_CANDIDATE_ID)
        rejectUnexpectedQuery(parsed, new Set(['jobId', 'view', 'search', 'limit', 'afterCandidateId']))
        const page = normalizeCandidatePage(await intake.listCandidates({
          ...(jobId === undefined ? {} : { jobId }),
          ...(view === undefined ? {} : { view }),
          ...(search === undefined ? {} : { search }),
          ...(limit === undefined ? {} : { limit }),
          ...(afterCandidateId === undefined ? {} : { afterCandidateId }),
        }))
        sendJson(response, 200, {
          ok: true,
          data: page,
        })
        return
      }

      if (resource === '/intake/candidates/bulk-ignore') {
        requireMethod(request, 'POST')
        const intake = requireIntake(options)
        rejectUnexpectedQuery(parsed, new Set())
        const input = normalizeBulkIgnoreRequest(await readJsonBody(request))
        const candidates = normalizeCandidateList(await intake.setCandidatesIgnored(input))
        sendJson(response, 200, {
          ok: true,
          data: { candidates, total: candidates.length },
        })
        return
      }

      if (resource === '/handshake') {
        requireMethod(request, 'POST')
        const external = requireExternal(options)
        const input = normalizeHandshakeRequest(await readJsonBody(request))
        const result = normalizeHandshakeResult(await external.handshake(input))
        sendJson(response, 200, { ok: true, data: result })
        return
      }

      if (resource === '/external-updates') {
        requireMethod(request, 'POST')
        const external = requireExternal(options)
        const validation = validateExternalUpdateCommand(await readJsonBody(request))
        if (!validation.ok) {
          if (validation.reason === 'validation_unavailable') {
            throw projectControlHttpError(
              'COMMAND_VALIDATION_UNAVAILABLE',
              '外部更新合同校验器暂不可用；只读状态仍可使用。',
              503,
            )
          }
          throw projectControlHttpError(
            'SCHEMA_INVALID',
            '外部运行更新不符合 command-envelope/v1alpha1 合同。',
            400,
          )
        }
        const result = normalizeExternalResult(await external.submitExternalUpdate(validation.value))
        sendJson(response, 200, { ok: true, data: result })
        return
      }

      if (resource === '/quarantine') {
        requireGetWithoutBody(request)
        const external = requireExternal(options)
        rejectUnexpectedQuery(parsed, new Set())
        const result = normalizeQuarantineList(await external.listQuarantineItems())
        sendJson(response, 200, { ok: true, data: { quarantineItems: result, total: result.length } })
        return
      }

      const quarantineResolveRoute = /^\/quarantine\/(qtn_[0-9a-f-]+)\/resolve$/u.exec(resource)
      if (quarantineResolveRoute !== null) {
        requireMethod(request, 'POST')
        const external = requireExternal(options)
        const quarantineId = quarantineResolveRoute[1]
        if (quarantineId === undefined || !QUARANTINE_ID.test(quarantineId)) {
          throw projectControlHttpError('NOT_FOUND', '隔离项不存在。', 404)
        }
        rejectUnexpectedQuery(parsed, new Set())
        const input = normalizeQuarantineResolveRequest(await readJsonBody(request))
        const result = normalizeQuarantineItem(await external.resolveQuarantineItem(quarantineId, input))
        sendJson(response, 200, { ok: true, data: result })
        return
      }

      const consoleWorkItemsRoute = /^\/projects\/(prj_[0-9a-f-]+)\/work-items$/u.exec(resource)
      const consoleWorkItemsPost = consoleWorkItemsRoute !== null
        && (request.method ?? 'GET').toUpperCase() === 'POST'
      if (consoleWorkItemsPost) {
        requireMethod(request, 'POST')
        const consoleService = requireConsole(options)
        const projectId = consoleWorkItemsRoute[1]
        if (projectId === undefined || !PROJECT_ID.test(projectId)) {
          throw projectControlHttpError('NOT_FOUND', '项目不存在。', 404)
        }
        rejectUnexpectedQuery(parsed, new Set())
        const input = normalizeCreateWorkItemRequest(await readJsonBody(request))
        const result = normalizeWorkItem(await consoleService.createWorkItem(projectId, input))
        sendJson(response, 200, { ok: true, data: result })
        return
      }

      const workItemStatusRoute = /^\/projects\/(prj_[0-9a-f-]+)\/work-items\/(wrk_[0-9a-f-]+)\/status$/u.exec(resource)
      if (workItemStatusRoute !== null) {
        requireMethod(request, 'POST')
        const consoleService = requireConsole(options)
        const projectId = workItemStatusRoute[1]
        const workItemId = workItemStatusRoute[2]
        if (projectId === undefined || workItemId === undefined
          || !PROJECT_ID.test(projectId) || !WORK_ITEM_ID.test(workItemId)) {
          throw projectControlHttpError('NOT_FOUND', '任务不存在。', 404)
        }
        rejectUnexpectedQuery(parsed, new Set())
        const input = normalizeWorkItemStatusRequest(await readJsonBody(request))
        const result = normalizeWorkItem(await consoleService.setWorkItemStatus(projectId, workItemId, input))
        sendJson(response, 200, { ok: true, data: result })
        return
      }

      const reviewRequestRoute = /^\/projects\/(prj_[0-9a-f-]+)\/work-items\/(wrk_[0-9a-f-]+)\/review-request$/u.exec(resource)
      if (reviewRequestRoute !== null) {
        requireMethod(request, 'POST')
        const consoleService = requireConsole(options)
        const projectId = reviewRequestRoute[1]
        const workItemId = reviewRequestRoute[2]
        if (projectId === undefined || workItemId === undefined
          || !PROJECT_ID.test(projectId) || !WORK_ITEM_ID.test(workItemId)) {
          throw projectControlHttpError('NOT_FOUND', '任务不存在。', 404)
        }
        rejectUnexpectedQuery(parsed, new Set())
        const input = normalizeReviewRequestRequest(await readJsonBody(request))
        const result = normalizeReview(await consoleService.requestReview(projectId, workItemId, input))
        sendJson(response, 200, { ok: true, data: result })
        return
      }

      const reviewDecideRoute = /^\/projects\/(prj_[0-9a-f-]+)\/reviews\/(rev_[0-9a-f-]+)\/decide$/u.exec(resource)
      if (reviewDecideRoute !== null) {
        requireMethod(request, 'POST')
        const consoleService = requireConsole(options)
        const projectId = reviewDecideRoute[1]
        const reviewId = reviewDecideRoute[2]
        if (projectId === undefined || reviewId === undefined
          || !PROJECT_ID.test(projectId) || !REVIEW_ID.test(reviewId)) {
          throw projectControlHttpError('NOT_FOUND', '审阅不存在。', 404)
        }
        rejectUnexpectedQuery(parsed, new Set())
        const input = normalizeReviewDecisionRequest(await readJsonBody(request))
        const result = normalizeReview(await consoleService.decideReview(projectId, reviewId, input))
        sendJson(response, 200, { ok: true, data: result })
        return
      }

      const reviewCommentRoute = /^\/projects\/(prj_[0-9a-f-]+)\/reviews\/(rev_[0-9a-f-]+)\/comment$/u.exec(resource)
      if (reviewCommentRoute !== null) {
        requireMethod(request, 'POST')
        const consoleService = requireConsole(options)
        const projectId = reviewCommentRoute[1]
        const reviewId = reviewCommentRoute[2]
        if (projectId === undefined || reviewId === undefined
          || !PROJECT_ID.test(projectId) || !REVIEW_ID.test(reviewId)) {
          throw projectControlHttpError('NOT_FOUND', '审阅不存在。', 404)
        }
        rejectUnexpectedQuery(parsed, new Set())
        const input = normalizeReviewCommentRequest(await readJsonBody(request))
        const result = normalizeReviewAction(await consoleService.commentReview(projectId, reviewId, input))
        sendJson(response, 200, { ok: true, data: result })
        return
      }

      const reviewActionsRoute = /^\/projects\/(prj_[0-9a-f-]+)\/reviews\/(rev_[0-9a-f-]+)\/actions$/u.exec(resource)
      if (reviewActionsRoute !== null) {
        requireGetWithoutBody(request)
        const external = requireExternal(options)
        const reviewId = reviewActionsRoute[2]
        if (reviewId === undefined || !REVIEW_ID.test(reviewId)) {
          throw projectControlHttpError('NOT_FOUND', '审阅不存在。', 404)
        }
        rejectUnexpectedQuery(parsed, new Set())
        const result = normalizeReviewActionList(await external.listReviewActions(reviewId))
        sendJson(response, 200, { ok: true, data: { actions: result, total: result.length } })
        return
      }

      const runStartRoute = /^\/projects\/(prj_[0-9a-f-]+)\/runs\/(run_[0-9a-f-]+)\/start$/u.exec(resource)
      if (runStartRoute !== null) {
        requireMethod(request, 'POST')
        const consoleService = requireConsole(options)
        const projectId = runStartRoute[1]
        const runId = runStartRoute[2]
        if (projectId === undefined || runId === undefined
          || !PROJECT_ID.test(projectId) || !RUN_ID.test(runId)) {
          throw projectControlHttpError('NOT_FOUND', '运行不存在。', 404)
        }
        rejectUnexpectedQuery(parsed, new Set())
        const input = normalizeRunStartRequest(await readJsonBody(request))
        const result = normalizeRun(await consoleService.startRun(projectId, runId, input))
        sendJson(response, 200, { ok: true, data: result })
        return
      }

      const projectExternalRoute = /^\/projects\/(prj_[0-9a-f-]+)\/(work-items|runs|progress-updates|reviews|decisions|events|sessions)$/u.exec(resource)
      if (projectExternalRoute !== null) {
        requireGetWithoutBody(request)
        const external = requireExternal(options)
        const projectId = projectExternalRoute[1]
        const kind = projectExternalRoute[2]
        if (projectId === undefined || !PROJECT_ID.test(projectId)) {
          throw projectControlHttpError('NOT_FOUND', '项目不存在。', 404)
        }
        const workItemId = optionalSingleQuery(parsed, 'workItemId', /^wrk_[0-9a-f-]{36}$/u)
        const afterSequence = kind === 'events'
          ? optionalSingleQuery(parsed, 'afterSequence', /^(?:0|[1-9]\d{0,9})$/u)
          : undefined
        rejectUnexpectedQuery(parsed, new Set(
          kind === 'runs' ? ['workItemId'] : kind === 'events' ? ['afterSequence'] : [],
        ))
        const items = kind === 'work-items'
          ? normalizeWorkItemList(await external.listWorkItems(projectId))
          : kind === 'runs'
            ? normalizeRunList(await external.listRuns(projectId, workItemId))
            : kind === 'progress-updates'
              ? normalizeProgressList(await external.listProgressUpdates(projectId))
              : kind === 'reviews'
                ? normalizeReviewList(await external.listReviews(projectId))
                : kind === 'events'
                  ? normalizeEventList(await external.listEvents(
                      projectId,
                      afterSequence === undefined ? undefined : Number(afterSequence),
                    ))
                  : kind === 'sessions'
                    ? normalizeSessionList(await external.listSessions(projectId))
                    : normalizeDecisionList(await external.listDecisions(projectId))
        sendJson(response, 200, { ok: true, data: { items, total: items.length } })
        return
      }

      if (resource === '/templates') {
        requireGetWithoutBody(request)
        const intake = requireIntake(options)
        const templates = normalizeTemplateList(await intake.listTemplates())
        sendJson(response, 200, {
          ok: true,
          data: { templates, total: templates.length },
        })
        return
      }

      if (resource === '/intake/prepare-create') {
        requireMethod(request, 'POST')
        const intake = requireIntake(options)
        const input = normalizeCreatePreparation(await readJsonBody(request))
        const result = normalizeCreatePreparationResult(await intake.prepareCreate(input))
        sendJson(response, 200, { ok: true, data: result })
        return
      }

      const documentsRefreshRoute = /^\/projects\/(prj_[0-9a-f-]+)\/documents\/refresh$/u.exec(resource)
      if (documentsRefreshRoute !== null) {
        requireMethod(request, 'POST')
        const intake = requireIntake(options)
        const projectId = documentsRefreshRoute[1]
        if (projectId === undefined || !PROJECT_ID.test(projectId)) {
          throw projectControlHttpError('NOT_FOUND', '项目不存在。', 404)
        }
        rejectUnexpectedQuery(parsed, new Set())
        requireEmptyBody(request)
        const result = normalizeDocumentIndex(await intake.refreshProjectDocuments(projectId))
        sendJson(response, 200, { ok: true, data: result })
        return
      }

      const rebindResolveRoute = /^\/projects\/(prj_[0-9a-f-]+)\/document-rebinds\/(rbd_[0-9a-f-]+)\/resolve$/u.exec(resource)
      if (rebindResolveRoute !== null) {
        requireMethod(request, 'POST')
        const intake = requireIntake(options)
        const projectId = rebindResolveRoute[1]
        const proposalId = rebindResolveRoute[2]
        if (projectId === undefined || !PROJECT_ID.test(projectId)
          || proposalId === undefined || !REBIND_PROPOSAL_ID.test(proposalId)) {
          throw projectControlHttpError('NOT_FOUND', '重绑提案不存在。', 404)
        }
        rejectUnexpectedQuery(parsed, new Set())
        const input = normalizeRebindResolution(await readJsonBody(request))
        const result = normalizeRebindResolutionResult(await intake.resolveDocumentRebind(
          projectId,
          proposalId,
          input,
        ))
        sendJson(response, 200, { ok: true, data: result })
        return
      }

      const workspaceIndexRoute = /^\/projects\/workspace-index$/u.exec(resource)
      if (workspaceIndexRoute !== null) {
        requireGetWithoutBody(request)
        rejectUnexpectedQuery(parsed, new Set())
        const projects = await service.listProjectWorkspaces()
        const fingerprint = projects.map(item => item.projectId + '@' + item.updatedAt).join('|')
        const etag = '"wsidx-' + fingerprint + '"'
        if (request.headers['if-none-match'] === etag) {
          response.writeHead(304)
          response.end()
          return
        }
        response.setHeader('etag', etag)
        sendJson(response, 200, { ok: true, data: { projects } })
        return
      }

      const workspaceStatusRoute = /^\/projects\/(prj_[0-9a-f-]+)\/workspace\/status$/u.exec(resource)
      if (workspaceStatusRoute !== null) {
        requireGetWithoutBody(request)
        const projectId = workspaceStatusRoute[1]
        if (projectId === undefined || !PROJECT_ID.test(projectId)) {
          throw projectControlHttpError('NOT_FOUND', '项目不存在。', 404)
        }
        rejectUnexpectedQuery(parsed, new Set())
        const workspace = await service.getProjectWorkspace(projectId)
        if (workspace === null) {
          throw projectControlHttpError('PROJECT_WORKSPACE_UNAVAILABLE', '项目没有可用的活动工作区位置。', 404)
        }
        sendJson(response, 200, { ok: true, data: { projectId: workspace.projectId, root: workspace.root } })
        return
      }

      const workspaceSearchRoute = /^\/projects\/(prj_[0-9a-f-]+)\/workspace\/search$/u.exec(resource)
      if (workspaceSearchRoute !== null) {
        requireGetWithoutBody(request)
        const projectId = workspaceSearchRoute[1]
        if (projectId === undefined || !PROJECT_ID.test(projectId)) {
          throw projectControlHttpError('NOT_FOUND', '项目不存在。', 404)
        }
        rejectUnexpectedQuery(parsed, new Set(['q']))
        const query = (parsed.searchParams.get('q') ?? '').trim().toLowerCase()
        if (query === '' || query.length > 200) {
          throw projectControlHttpError('INVALID_QUERY', '搜索词无效。', 400)
        }
        const workspace = await service.getProjectWorkspace(projectId)
        if (workspace === null) {
          throw projectControlHttpError('PROJECT_WORKSPACE_UNAVAILABLE', '项目没有可用的活动工作区位置。', 404)
        }
        const results = await searchProjectWorkspaceFiles(workspace.root, query)
        sendJson(response, 200, { ok: true, data: { results, truncated: results.length >= 100 } })
        return
      }

      const workspaceTreeRoute = /^\/projects\/(prj_[0-9a-f-]+)\/workspace\/tree$/u.exec(resource)
      if (workspaceTreeRoute !== null) {
        requireGetWithoutBody(request)
        const projectId = workspaceTreeRoute[1]
        if (projectId === undefined || !PROJECT_ID.test(projectId)) {
          throw projectControlHttpError('NOT_FOUND', '项目不存在。', 404)
        }
        rejectUnexpectedQuery(parsed, new Set(['path']))
        const workspace = await service.getProjectWorkspace(projectId)
        if (workspace === null) {
          throw projectControlHttpError('PROJECT_WORKSPACE_UNAVAILABLE', '项目没有可用的活动工作区位置。', 404)
        }
        const tree = await listProjectWorkspaceTree(workspace.root, parsed.searchParams.get('path') ?? '')
        sendJson(response, 200, { ok: true, data: tree })
        return
      }

      const workspaceBlobRoute = /^\/projects\/(prj_[0-9a-f-]+)\/workspace\/blob$/u.exec(resource)
      if (workspaceBlobRoute !== null) {
        requireGetWithoutBody(request)
        const projectId = workspaceBlobRoute[1]
        if (projectId === undefined || !PROJECT_ID.test(projectId)) {
          throw projectControlHttpError('NOT_FOUND', '项目不存在。', 404)
        }
        rejectUnexpectedQuery(parsed, new Set(['path']))
        const workspace = await service.getProjectWorkspace(projectId)
        if (workspace === null) {
          throw projectControlHttpError('PROJECT_WORKSPACE_UNAVAILABLE', '项目没有可用的活动工作区位置。', 404)
        }
        await streamProjectWorkspaceBlob(response, workspace.root, parsed.searchParams.get('path') ?? '')
        return
      }

      const workspaceFileRoute = /^\/projects\/(prj_[0-9a-f-]+)\/workspace\/file$/u.exec(resource)
      if (workspaceFileRoute !== null) {
        requireGetWithoutBody(request)
        const projectId = workspaceFileRoute[1]
        if (projectId === undefined || !PROJECT_ID.test(projectId)) {
          throw projectControlHttpError('NOT_FOUND', '项目不存在。', 404)
        }
        rejectUnexpectedQuery(parsed, new Set(['path']))
        const workspace = await service.getProjectWorkspace(projectId)
        if (workspace === null) {
          throw projectControlHttpError('PROJECT_WORKSPACE_UNAVAILABLE', '项目没有可用的活动工作区位置。', 404)
        }
        const file = await readProjectWorkspaceFile(workspace.root, parsed.searchParams.get('path') ?? '')
        // 文本内容上限 256KB（UTF-8）+ JSON 包裹，响应预算 512KB
        sendJson(response, 200, { ok: true, data: file }, {}, 512 * 1024)
        return
      }

      const documentsRoute = /^\/projects\/(prj_[0-9a-f-]+)\/documents$/u.exec(resource)
      if (documentsRoute !== null) {
        requireGetWithoutBody(request)
        const intake = requireIntake(options)
        const projectId = documentsRoute[1]
        if (projectId === undefined || !PROJECT_ID.test(projectId)) {
          throw projectControlHttpError('NOT_FOUND', '项目不存在。', 404)
        }
        rejectUnexpectedQuery(parsed, new Set())
        const result = normalizeDocumentIndex(await intake.getProjectDocuments(projectId))
        sendJson(response, 200, { ok: true, data: result })
        return
      }

      const upgradeRoute = /^\/intake\/projects\/(prj_[0-9a-f-]+)\/prepare-upgrade$/u.exec(resource)
      if (upgradeRoute !== null) {
        requireMethod(request, 'POST')
        const intake = requireIntake(options)
        const projectId = upgradeRoute[1]
        if (projectId === undefined || !PROJECT_ID.test(projectId)) {
          throw projectControlHttpError('NOT_FOUND', '项目不存在。', 404)
        }
        const input = normalizeUpgradePreparation(await readJsonBody(request))
        const result = normalizeUpgradePreparationResult(await intake.prepareUpgrade(projectId, input))
        sendJson(response, 200, { ok: true, data: result })
        return
      }

      const candidateRoute = /^\/intake\/candidates\/(can_[0-9a-f-]+)(?:\/(ignore|prepare))?$/u.exec(resource)
      if (candidateRoute !== null) {
        const candidateId = candidateRoute[1]
        if (candidateId === undefined || !IMPORT_CANDIDATE_ID.test(candidateId)) {
          throw projectControlHttpError('NOT_FOUND', '项目候选不存在。', 404)
        }
        rejectUnexpectedQuery(parsed, new Set())
        const action = candidateRoute[2]
        const intake = requireIntake(options)
        if (action === undefined) {
          requireGetWithoutBody(request)
          const candidate = normalizeCandidate(await intake.getCandidate(candidateId))
          sendJson(response, 200, { ok: true, data: candidate })
          return
        }
        requireMethod(request, 'POST')
        if (action === 'ignore') {
          const input = normalizeIgnoreRequest(await readJsonBody(request))
          const candidate = normalizeCandidate(await intake.setCandidateIgnored(candidateId, input))
          sendJson(response, 200, { ok: true, data: candidate })
          return
        }
        const input = normalizeCandidatePreparation(await readJsonBody(request))
        const prepared = await intake.prepareCandidate(candidateId, input)
        const validation = validateLifecycleCommand(prepared)
        if (!validation.ok) {
          throw new TypeError('intake service returned a lifecycle command outside the canonical contract')
        }
        sendJson(response, 200, { ok: true, data: { command: validation.value } })
        return
      }

      throw projectControlHttpError('NOT_FOUND', '项目控制台接口不存在。', 404)
    } catch (error) {
      const exposed = exposedError(error)
      sendJson(response, exposed.status, {
        ok: false,
        error: {
          code: exposed.code,
          message: exposed.message,
        },
      }, exposed.headers)
    }
  }
}

function requireGetWithoutBody(request: IncomingMessage): void {
  requireMethod(request, 'GET')

  const rawLength = request.headers['content-length']
  if (rawLength !== undefined) {
    const declared = Number(rawLength)
    if (!Number.isSafeInteger(declared) || declared < 0) {
      throw projectControlHttpError('INVALID_CONTENT_LENGTH', '请求长度无效。')
    }
    if (declared > MAX_BODY_BYTES) {
      throw projectControlHttpError('BODY_TOO_LARGE', '项目控制台请求内容过大。', 413)
    }
    if (declared !== 0) {
      throw projectControlHttpError('BODY_NOT_ALLOWED', '读取接口不接受请求正文。')
    }
  }
  if (request.headers['transfer-encoding'] !== undefined) {
    throw projectControlHttpError('BODY_NOT_ALLOWED', '读取接口不接受请求正文。')
  }
}

function requireEmptyBody(request: IncomingMessage): void {
  const rawLength = request.headers['content-length']
  if (rawLength !== undefined) {
    const declared = Number(rawLength)
    if (!Number.isSafeInteger(declared) || declared < 0) {
      throw projectControlHttpError('INVALID_CONTENT_LENGTH', '请求长度无效。')
    }
    if (declared > MAX_BODY_BYTES) {
      throw projectControlHttpError('BODY_TOO_LARGE', '项目控制台请求内容过大。', 413)
    }
    if (declared !== 0) {
      throw projectControlHttpError('BODY_NOT_ALLOWED', '该接口不接受请求正文。')
    }
  }
  if (request.headers['transfer-encoding'] !== undefined) {
    throw projectControlHttpError('BODY_NOT_ALLOWED', '该接口不接受请求正文。')
  }
}

function requireMethod(request: IncomingMessage, expected: 'GET' | 'POST'): void {
  if ((request.method ?? 'GET').toUpperCase() === expected) return
  throw projectControlHttpError(
    'METHOD_NOT_ALLOWED',
    expected === 'GET' ? '此项目控制台接口只支持读取。' : '此项目控制台接口只接受指令提交。',
    405,
    { allow: expected },
  )
}

function requireConsole(options: ProjectControlHandlerOptions): ProjectControlConsoleService {
  if (options.console === undefined) {
    throw projectControlHttpError('CONSOLE_UNAVAILABLE', '项目控制台指令服务暂不可用。', 503)
  }
  return options.console
}

function requireExternal(options: ProjectControlHandlerOptions): ProjectControlExternalService {
  if (options.external === undefined) {
    throw projectControlHttpError('EXTERNAL_UNAVAILABLE', '外部运行更新服务暂不可用。', 503)
  }
  return options.external
}

function requireIntake(options: ProjectControlHandlerOptions): ProjectControlIntakeService {
  if (options.intake === undefined) {
    throw projectControlHttpError('INTAKE_UNAVAILABLE', '项目扫描与导入服务暂不可用。', 503)
  }
  return options.intake
}

function normalizeIntakeScanRequest(value: unknown): ProjectControlIntakeScanRequest {
  const candidate = requestObject(value, '扫描请求')
  requireExactKeys(candidate, new Set(['mode', 'selection', 'maxDepth']), '扫描请求')
  if (!['source-root', 'project-root'].includes(String(candidate.mode))) {
    throw projectControlHttpError('INVALID_BODY', '扫描模式无效。')
  }
  const mode = candidate.mode as ProjectControlIntakeMode
  const selection = requestObject(candidate.selection, '目录选择结果')
  requireExactKeys(selection, new Set(['path', 'authorization']), '目录选择结果')
  const path = requestText(selection.path, '目录路径', 32_767)
  if (!/^[A-Za-z]:[\\/]/u.test(path)
    || path.startsWith('\\\\')
    || path.startsWith('//')
    || /[\u0000-\u001f\u007f]/u.test(path)) {
    throw projectControlHttpError('INVALID_BODY', '目录选择结果不是可用的本地绝对路径。')
  }
  const authorization = requestObject(selection.authorization, '目录授权')
  requireExactKeys(
    authorization,
    new Set(['version', 'kind', 'expiresAt', 'nonce', 'signature']),
    '目录授权',
  )
  if (authorization.version !== 1
    || authorization.kind !== mode
    || typeof authorization.expiresAt !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(authorization.expiresAt)
    || typeof authorization.nonce !== 'string'
    || !UUID.test(authorization.nonce)
    || typeof authorization.signature !== 'string'
    || !/^[A-Za-z0-9_-]{43}$/u.test(authorization.signature)) {
    throw projectControlHttpError('INVALID_BODY', '目录授权无效。')
  }
  let maxDepth: number | undefined
  if (candidate.maxDepth !== undefined) {
    maxDepth = requestRevision(candidate.maxDepth, '扫描深度', 1)
    if (maxDepth > 3) throw projectControlHttpError('INVALID_BODY', '扫描深度超出允许范围。')
  }
  return {
    mode,
    selection: {
      path,
      authorization: {
        version: 1,
        kind: mode,
        expiresAt: authorization.expiresAt,
        nonce: authorization.nonce,
        signature: authorization.signature,
      },
    },
    ...(maxDepth === undefined ? {} : { maxDepth }),
  }
}

function normalizeIgnoreRequest(value: unknown): { ignored: boolean; expectedRevision: number } {
  const candidate = requestObject(value, '候选忽略请求')
  requireExactKeys(candidate, new Set(['ignored', 'expectedRevision']), '候选忽略请求')
  if (typeof candidate.ignored !== 'boolean') {
    throw projectControlHttpError('INVALID_BODY', '候选忽略状态无效。')
  }
  return {
    ignored: candidate.ignored,
    expectedRevision: requestRevision(candidate.expectedRevision, '候选修订', 1),
  }
}

function normalizeBulkIgnoreRequest(value: unknown): {
  ignored: boolean
  candidates: Array<{ candidateId: string; expectedRevision: number }>
} {
  const candidate = requestObject(value, '候选批量忽略请求')
  requireExactKeys(candidate, new Set(['ignored', 'candidates']), '候选批量忽略请求')
  if (typeof candidate.ignored !== 'boolean'
    || !Array.isArray(candidate.candidates)
    || candidate.candidates.length < 1
    || candidate.candidates.length > 100) {
    throw projectControlHttpError('INVALID_BODY', '候选批量忽略请求无效。')
  }
  const seen = new Set<string>()
  const candidates = candidate.candidates.map((raw, index) => {
    const entry = requestObject(raw, `候选批量项 ${String(index + 1)}`)
    requireExactKeys(entry, new Set(['candidateId', 'expectedRevision']), `候选批量项 ${String(index + 1)}`)
    const candidateId = requestText(entry.candidateId, '候选 ID', 80)
    if (!IMPORT_CANDIDATE_ID.test(candidateId) || seen.has(candidateId)) {
      throw projectControlHttpError('INVALID_BODY', '候选批量项包含无效或重复的候选 ID。')
    }
    seen.add(candidateId)
    return {
      candidateId,
      expectedRevision: requestRevision(entry.expectedRevision, '候选修订', 1),
    }
  })
  return { ignored: candidate.ignored, candidates }
}

function normalizeCandidatePreparation(value: unknown): ProjectControlCandidatePreparation {
  const candidate = requestObject(value, '候选确认请求')
  requireExactKeys(
    candidate,
    new Set(['registrationMode', 'name', 'expectedRevision', 'documentBindings']),
    '候选确认请求',
  )
  if (!['linked_legacy', 'managed'].includes(String(candidate.registrationMode))) {
    throw projectControlHttpError('INVALID_BODY', '项目关联模式无效。')
  }
  const name = requestText(candidate.name, '项目名称', 120).trim()
  if (/\p{Cc}/u.test(name)) throw projectControlHttpError('INVALID_BODY', '项目名称包含无效字符。')
  if (!Array.isArray(candidate.documentBindings) || candidate.documentBindings.length > 64) {
    throw projectControlHttpError('INVALID_BODY', '文档映射数量无效。')
  }
  const seenRoles = new Set<string>()
  const seenPaths = new Set<string>()
  const documentBindings = candidate.documentBindings.map((raw, index) => {
    const binding = requestObject(raw, `文档映射 ${String(index + 1)}`)
    requireExactKeys(binding, new Set(['role', 'relativePath', 'contentHash']), '文档映射')
    if (typeof binding.role !== 'string' || !DOCUMENT_ROLES.has(binding.role)) {
      throw projectControlHttpError('INVALID_BODY', '文档角色无效。')
    }
    const relativePath = requestText(binding.relativePath, '文档相对路径', 512)
    if (!isCanonicalRelativePath(relativePath)) {
      throw projectControlHttpError('INVALID_BODY', '文档相对路径必须是规范化的项目内 POSIX 路径。')
    }
    if (typeof binding.contentHash !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(binding.contentHash)) {
      throw projectControlHttpError('INVALID_BODY', '文档内容哈希无效。')
    }
    if (seenRoles.has(binding.role) || seenPaths.has(relativePath.toLowerCase())) {
      throw projectControlHttpError('INVALID_BODY', '文档角色或路径不能重复。')
    }
    seenRoles.add(binding.role)
    seenPaths.add(relativePath.toLowerCase())
    return {
      role: binding.role as ProjectControlCandidatePreparation['documentBindings'][number]['role'],
      relativePath,
      contentHash: binding.contentHash,
    }
  })
  return {
    registrationMode: candidate.registrationMode as 'linked_legacy' | 'managed',
    name,
    expectedRevision: requestRevision(candidate.expectedRevision, '候选修订', 1),
    documentBindings,
  }
}

const DIRECTORY_NAME = /^(?!\.{1,2}$)(?!.*[ .]$)[^<>:"/\\|?*\u0000-\u001F]+$/u
const TEMPLATE_ID = /^[a-z][a-z0-9.-]{1,127}$/u
const TEMPLATE_VERSION = /^[0-9]+\.[0-9]+\.[0-9]+$/u

function normalizeCreatePreparation(value: unknown): ProjectControlCreatePreparation {
  const candidate = requestObject(value, '新建项目请求')
  requireExactKeys(candidate, new Set(['selection', 'directoryName', 'name', 'templateId', 'templateVersion']), '新建项目请求')
  const selection = requestObject(candidate.selection, '目录选择结果')
  requireExactKeys(selection, new Set(['path', 'authorization']), '目录选择结果')
  const path = requestText(selection.path, '目录路径', 32_767)
  if (!/^[A-Za-z]:[\\/]/u.test(path)
    || path.startsWith('\\\\')
    || path.startsWith('//')
    || /[\u0000-\u001f\u007f]/u.test(path)) {
    throw projectControlHttpError('INVALID_BODY', '目录选择结果不是可用的本地绝对路径。')
  }
  const authorization = requestObject(selection.authorization, '目录授权')
  requireExactKeys(
    authorization,
    new Set(['version', 'kind', 'expiresAt', 'nonce', 'signature']),
    '目录授权',
  )
  if (authorization.version !== 1
    || authorization.kind !== 'create-parent'
    || typeof authorization.expiresAt !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(authorization.expiresAt)
    || typeof authorization.nonce !== 'string'
    || !UUID.test(authorization.nonce)
    || typeof authorization.signature !== 'string'
    || !/^[A-Za-z0-9_-]{43}$/u.test(authorization.signature)) {
    throw projectControlHttpError('INVALID_BODY', '目录授权无效。')
  }
  const directoryName = requestText(candidate.directoryName, '目录名', 120)
  if (!DIRECTORY_NAME.test(directoryName)) {
    throw projectControlHttpError('INVALID_BODY', '目录名包含不允许的字符。')
  }
  const name = requestText(candidate.name, '项目名称', 120).trim()
  if (/\p{Cc}/u.test(name)) throw projectControlHttpError('INVALID_BODY', '项目名称包含无效字符。')
  const templateId = requestText(candidate.templateId, '模板标识', 128)
  const templateVersion = requestText(candidate.templateVersion, '模板版本', 64)
  if (!TEMPLATE_ID.test(templateId) || !TEMPLATE_VERSION.test(templateVersion)) {
    throw projectControlHttpError('INVALID_BODY', '模板身份或版本无效。')
  }
  return {
    selection: {
      path,
      authorization: {
        version: 1,
        kind: 'create-parent',
        expiresAt: authorization.expiresAt,
        nonce: authorization.nonce,
        signature: authorization.signature,
      },
    },
    directoryName,
    name,
    templateId,
    templateVersion,
  }
}

function normalizeTemplateList(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value) || value.length > 50) {
    throw new TypeError('intake service returned an invalid template list')
  }
  return value.map((raw, index) => {
    const candidate = responseObject(raw, `template ${String(index)}`)
    return {
      templateId: boundedText(candidate.templateId, 'templateId', 128),
      templateVersion: boundedText(candidate.templateVersion, 'templateVersion', 64),
      displayName: boundedText(candidate.displayName, 'displayName', 120),
      description: candidate.description === null ? null : boundedText(candidate.description, 'description', 2000),
      protocolVersion: boundedText(candidate.protocolVersion, 'protocolVersion', 80),
      templateHash: boundedText(candidate.templateHash, 'templateHash', 80),
    }
  })
}

const INSTANCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,126}$/u
const WORK_ITEM_ID = /^wrk_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const RUN_ID = /^run_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const PROGRESS_UPDATE_ID = /^upd_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const REVIEW_ID = /^rev_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const DECISION_ID = /^dec_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const QUARANTINE_ID = /^qtn_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const REVIEW_ACTION_ID = /^rva_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const EVENT_ID = /^evt_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

export interface ProjectControlHandshakeInput {
  instanceId: string
  appVersion: string
  protocolVersions: readonly string[]
  capabilities: readonly string[]
}

function normalizeHandshakeRequest(value: unknown): ProjectControlHandshakeInput {
  const candidate = requestObject(value, '能力握手请求')
  requireExactKeys(candidate, new Set(['instanceId', 'appVersion', 'protocolVersions', 'capabilities']), '能力握手请求')
  const instanceId = requestText(candidate.instanceId, '实例标识', 127)
  if (!INSTANCE_ID_PATTERN.test(instanceId)) {
    throw projectControlHttpError('INVALID_BODY', '实例标识无效。')
  }
  const protocolVersions = requestTextList(candidate.protocolVersions, '协议版本', 50, 127)
  if (protocolVersions.length < 1) {
    throw projectControlHttpError('INVALID_BODY', '协议版本至少需要一项。')
  }
  return {
    instanceId,
    appVersion: requestText(candidate.appVersion, '应用版本', 64),
    protocolVersions,
    capabilities: requestTextList(candidate.capabilities, '能力列表', 100, 127),
  }
}

function normalizeHandshakeResult(value: unknown): Record<string, unknown> {
  const candidate = responseObject(value, 'handshake result')
  const protocolVersions = candidate.protocolVersions
  const capabilities = candidate.capabilities
  if (!Array.isArray(protocolVersions) || protocolVersions.length > 50
    || protocolVersions.some((item) => typeof item !== 'string' || item.length < 1 || item.length > 127)
    || !Array.isArray(capabilities) || capabilities.length > 100
    || capabilities.some((item) => typeof item !== 'string' || item.length < 1 || item.length > 127)) {
    throw new TypeError('external service returned an invalid handshake result')
  }
  return {
    instanceId: boundedText(candidate.instanceId, 'instanceId', 127),
    appVersion: boundedText(candidate.appVersion, 'appVersion', 64),
    protocolVersions,
    capabilities,
    heartbeatAt: responseTimestamp(candidate.heartbeatAt, 'heartbeatAt'),
    startedAt: responseTimestamp(candidate.startedAt, 'startedAt'),
    revision: requiredRevision(candidate.revision, 'revision', 1),
    createdAt: responseTimestamp(candidate.createdAt, 'createdAt'),
    updatedAt: responseTimestamp(candidate.updatedAt, 'updatedAt'),
  }
}

function normalizeExternalResult(value: unknown): Record<string, unknown> {
  const candidate = responseObject(value, 'external update result')
  const status = boundedText(candidate.status, 'status', 40)
  if (!['accepted', 'replayed', 'rejected'].includes(status)) {
    throw new TypeError('external service returned an invalid update result')
  }
  const base = {
    protocolVersion: boundedText(candidate.protocolVersion, 'protocolVersion', 80),
    schemaVersion: boundedText(candidate.schemaVersion, 'schemaVersion', 80),
    commandId: boundedText(candidate.commandId, 'commandId', 200),
    correlationId: boundedNullableText(candidate.correlationId, 'correlationId', 200),
    kind: boundedText(candidate.kind, 'kind', 100),
    status,
    recordedAt: responseTimestamp(candidate.recordedAt, 'recordedAt'),
  }
  if (status === 'rejected') {
    const error = responseObject(candidate.error, 'error')
    return {
      ...base,
      ...(candidate.currentRevision === undefined
        ? {}
        : { currentRevision: requiredRevision(candidate.currentRevision, 'currentRevision', 0) }),
      error: {
        code: boundedText(error.code, 'error.code', 100),
        message: boundedText(error.message, 'error.message', 500),
      },
    }
  }
  return {
    ...base,
    aggregateType: boundedText(candidate.aggregateType, 'aggregateType', 40),
    aggregateId: boundedText(candidate.aggregateId, 'aggregateId', 100),
    aggregateRevision: requiredRevision(candidate.aggregateRevision, 'aggregateRevision', 1),
    eventId: responseId(candidate.eventId, EVENT_ID, 'eventId'),
  }
}

function normalizeWorkItem(value: unknown): Record<string, unknown> {
  const item = responseObject(value, 'work item')
  const executionStatus = boundedText(item.executionStatus, 'executionStatus', 40)
  const reviewStatus = boundedText(item.reviewStatus, 'reviewStatus', 40)
  if (!['draft', 'ready', 'running', 'paused', 'blocked', 'completed', 'cancelled'].includes(executionStatus)
    || !['not_requested', 'pending', 'changes_requested', 'approved', 'rejected'].includes(reviewStatus)) {
    throw new TypeError('external service returned an invalid work item status')
  }
  const acceptance = item.acceptance
  if (!Array.isArray(acceptance) || acceptance.length > 50
    || acceptance.some((entry) => typeof entry !== 'string' || entry.length < 1 || entry.length > 1000)) {
    throw new TypeError('external service returned invalid work item acceptance')
  }
  const priority = requiredRevision(item.priority, 'priority', 0)
  if (priority > 100) throw new TypeError('external service returned an invalid work item priority')
  return {
    workItemId: responseId(item.workItemId, WORK_ITEM_ID, 'workItemId'),
    projectId: responseId(item.projectId, PROJECT_ID, 'projectId'),
    title: boundedText(item.title, 'title', 500),
    instruction: boundedNullableText(item.instruction, 'instruction', 20_000),
    acceptance,
    executionStatus,
    reviewStatus,
    priority,
    revision: requiredRevision(item.revision, 'revision', 1),
    createdAt: responseTimestamp(item.createdAt, 'createdAt'),
    updatedAt: responseTimestamp(item.updatedAt, 'updatedAt'),
    archivedAt: item.archivedAt === null || item.archivedAt === undefined
      ? null
      : responseTimestamp(item.archivedAt, 'archivedAt'),
  }
}

function normalizeWorkItemList(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value) || value.length > 500) {
    throw new TypeError('external service returned an invalid work item list')
  }
  return value.map((raw) => normalizeWorkItem(raw))
}

function normalizeRun(value: unknown): Record<string, unknown> {
  const run = responseObject(value, 'run')
  const status = boundedText(run.status, 'status', 40)
  if (!['queued', 'running', 'completed', 'blocked', 'failed', 'cancelled'].includes(status)) {
    throw new TypeError('external service returned an invalid run status')
  }
  return {
    runId: responseId(run.runId, RUN_ID, 'runId'),
    projectId: responseId(run.projectId, PROJECT_ID, 'projectId'),
    workItemId: responseId(run.workItemId, WORK_ITEM_ID, 'workItemId'),
    attemptNo: requiredRevision(run.attemptNo, 'attemptNo', 1),
    status,
    instructionSnapshot: boundedNullableText(run.instructionSnapshot, 'instructionSnapshot', 20_000),
    acceptanceSnapshot: run.acceptanceSnapshot,
    revision: requiredRevision(run.revision, 'revision', 1),
    createdAt: responseTimestamp(run.createdAt, 'createdAt'),
    startedAt: run.startedAt === null || run.startedAt === undefined
      ? null
      : responseTimestamp(run.startedAt, 'startedAt'),
    completedAt: run.completedAt === null || run.completedAt === undefined
      ? null
      : responseTimestamp(run.completedAt, 'completedAt'),
    updatedAt: responseTimestamp(run.updatedAt, 'updatedAt'),
  }
}

function normalizeRunList(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value) || value.length > 500) {
    throw new TypeError('external service returned an invalid run list')
  }
  return value.map((raw) => normalizeRun(raw))
}

function normalizeProgressList(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value) || value.length > 500) {
    throw new TypeError('external service returned an invalid progress update list')
  }
  return value.map((raw, index) => {
    const update = responseObject(raw, `progress update ${String(index)}`)
    const kind = boundedText(update.kind, 'kind', 40)
    const aggregateType = boundedText(update.aggregateType, 'aggregateType', 40)
    if (!['progress', 'blocker', 'completion_declared'].includes(kind)
      || !['work_item', 'run'].includes(aggregateType)) {
      throw new TypeError('external service returned an invalid progress update')
    }
    return {
      progressUpdateId: responseId(update.progressUpdateId, PROGRESS_UPDATE_ID, 'progressUpdateId'),
      projectId: responseId(update.projectId, PROJECT_ID, 'projectId'),
      workItemId: responseId(update.workItemId, WORK_ITEM_ID, 'workItemId'),
      runId: responseId(update.runId, RUN_ID, 'runId'),
      kind,
      summary: boundedText(update.summary, 'summary', 500),
      needs: update.needs,
      acceptanceClaims: update.acceptanceClaims,
      evidence: update.evidence,
      completionPercent: update.completionPercent === null || update.completionPercent === undefined
        ? null
        : requiredRevision(update.completionPercent, 'completionPercent', 0),
      details: boundedNullableText(update.details, 'details', 20_000),
      threadId: boundedText(update.threadId, 'threadId', 127),
      sourceEventId: update.sourceEventId === null || update.sourceEventId === undefined
        ? null
        : responseId(update.sourceEventId, EVENT_ID, 'sourceEventId'),
      commandId: boundedText(update.commandId, 'commandId', 200),
      aggregateType,
      aggregateId: boundedText(update.aggregateId, 'aggregateId', 100),
      aggregateRevision: requiredRevision(update.aggregateRevision, 'aggregateRevision', 1),
      generatedBy: update.generatedBy,
      createdAt: responseTimestamp(update.createdAt, 'createdAt'),
    }
  })
}

function normalizeReview(value: unknown): Record<string, unknown> {
  const review = responseObject(value, 'review')
  const status = boundedText(review.status, 'status', 40)
  if (!['requested', 'in_review', 'approved', 'rejected', 'superseded'].includes(status)) {
    throw new TypeError('external service returned an invalid review status')
  }
  return {
    reviewId: responseId(review.reviewId, REVIEW_ID, 'reviewId'),
    projectId: responseId(review.projectId, PROJECT_ID, 'projectId'),
    workItemId: review.workItemId === null || review.workItemId === undefined
      ? null
      : responseId(review.workItemId, WORK_ITEM_ID, 'workItemId'),
    reviewedWorkItemRevision: review.reviewedWorkItemRevision === null || review.reviewedWorkItemRevision === undefined
      ? null
      : requiredRevision(review.reviewedWorkItemRevision, 'reviewedWorkItemRevision', 1),
    artifactRefs: review.artifactRefs,
    status,
    risk: boundedNullableText(review.risk, 'risk', 100),
    requestedBy: review.requestedBy,
    decidedBy: review.decidedBy === null || review.decidedBy === undefined ? null : review.decidedBy,
    revision: requiredRevision(review.revision, 'revision', 1),
    createdAt: responseTimestamp(review.createdAt, 'createdAt'),
    updatedAt: responseTimestamp(review.updatedAt, 'updatedAt'),
    decidedAt: review.decidedAt === null || review.decidedAt === undefined
      ? null
      : responseTimestamp(review.decidedAt, 'decidedAt'),
  }
}

function normalizeReviewList(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value) || value.length > 500) {
    throw new TypeError('external service returned an invalid review list')
  }
  return value.map((raw) => normalizeReview(raw))
}

function normalizeDecisionList(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value) || value.length > 500) {
    throw new TypeError('external service returned an invalid decision list')
  }
  return value.map((raw, index) => {
    const decision = responseObject(raw, `decision ${String(index)}`)
    const status = boundedText(decision.status, 'status', 40)
    if (!['open', 'decided', 'voided'].includes(status)) {
      throw new TypeError('external service returned an invalid decision status')
    }
    return {
      decisionId: responseId(decision.decisionId, DECISION_ID, 'decisionId'),
      projectId: responseId(decision.projectId, PROJECT_ID, 'projectId'),
      workItemId: responseId(decision.workItemId, WORK_ITEM_ID, 'workItemId'),
      title: boundedText(decision.title, 'title', 500),
      context: boundedNullableText(decision.context, 'context', 20_000),
      options: decision.options,
      status,
      rationale: boundedNullableText(decision.rationale, 'rationale', 20_000),
      proposedBy: decision.proposedBy,
      decidedBy: decision.decidedBy === null || decision.decidedBy === undefined ? null : decision.decidedBy,
      revision: requiredRevision(decision.revision, 'revision', 1),
      createdAt: responseTimestamp(decision.createdAt, 'createdAt'),
      updatedAt: responseTimestamp(decision.updatedAt, 'updatedAt'),
      decidedAt: decision.decidedAt === null || decision.decidedAt === undefined
        ? null
        : responseTimestamp(decision.decidedAt, 'decidedAt'),
    }
  })
}

function normalizeQuarantineItem(value: unknown): Record<string, unknown> {
  const item = responseObject(value, 'quarantine item')
  const status = boundedText(item.status, 'status', 40)
  if (!['open', 'resolved', 'ignored'].includes(status)) {
    throw new TypeError('external service returned an invalid quarantine status')
  }
  return {
    quarantineId: responseId(item.quarantineId, QUARANTINE_ID, 'quarantineId'),
    projectId: item.projectId === null || item.projectId === undefined
      ? null
      : responseId(item.projectId, PROJECT_ID, 'projectId'),
    sourceKind: boundedText(item.sourceKind, 'sourceKind', 100),
    sourceRef: boundedText(item.sourceRef, 'sourceRef', 512),
    reasonCode: boundedText(item.reasonCode, 'reasonCode', 100),
    payloadRef: boundedNullableText(item.payloadRef, 'payloadRef', 512),
    status,
    details: item.details,
    revision: requiredRevision(item.revision, 'revision', 1),
    createdAt: responseTimestamp(item.createdAt, 'createdAt'),
    updatedAt: responseTimestamp(item.updatedAt, 'updatedAt'),
    resolvedAt: item.resolvedAt === null || item.resolvedAt === undefined
      ? null
      : responseTimestamp(item.resolvedAt, 'resolvedAt'),
  }
}

function normalizeQuarantineResolveRequest(value: unknown): {
  expectedRevision: number
  decision: 'resolved' | 'ignored'
} {
  const candidate = requestObject(value, '隔离处置请求')
  requireExactKeys(candidate, new Set(['expectedRevision', 'decision']), '隔离处置请求')
  const decision = candidate.decision
  if (decision !== 'resolved' && decision !== 'ignored') {
    throw projectControlHttpError('INVALID_BODY', '隔离处置决定无效。')
  }
  return {
    expectedRevision: requestRevision(candidate.expectedRevision, '隔离修订', 1),
    decision,
  }
}

function normalizeQuarantineList(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value) || value.length > 500) {
    throw new TypeError('external service returned an invalid quarantine list')
  }
  return value.map((raw) => normalizeQuarantineItem(raw))
}

function normalizeEventList(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value) || value.length > 500) {
    throw new TypeError('external service returned an invalid event list')
  }
  return value.map((raw, index) => {
    const event = responseObject(raw, `event ${String(index)}`)
    const aggregateType = boundedText(event.aggregateType, 'aggregateType', 40)
    if (!['project', 'work_item', 'run'].includes(aggregateType)) {
      throw new TypeError('external service returned an invalid event aggregate')
    }
    return {
      eventId: responseId(event.eventId, EVENT_ID, 'eventId'),
      sequence: requiredRevision(event.sequence, 'sequence', 1),
      projectId: responseId(event.projectId, PROJECT_ID, 'projectId'),
      aggregateType,
      aggregateId: boundedText(event.aggregateId, 'aggregateId', 100),
      beforeRevision: requiredRevision(event.beforeRevision, 'beforeRevision', 0),
      afterRevision: requiredRevision(event.afterRevision, 'afterRevision', 1),
      eventType: boundedText(event.eventType, 'eventType', 100),
      schemaVersion: boundedText(event.schemaVersion, 'schemaVersion', 80),
      data: event.data,
      actor: event.actor,
      provenance: event.provenance,
      commandId: boundedText(event.commandId, 'commandId', 200),
      correlationId: boundedNullableText(event.correlationId, 'correlationId', 200),
      causationId: boundedNullableText(event.causationId, 'causationId', 200),
      occurredAt: responseTimestamp(event.occurredAt, 'occurredAt'),
      recordedAt: responseTimestamp(event.recordedAt, 'recordedAt'),
    }
  })
}

function normalizeCreateWorkItemRequest(value: unknown): Record<string, unknown> {
  const candidate = requestObject(value, '新建任务请求')
  rejectUnknownKeys(
    candidate,
    new Set(['title', 'instruction', 'acceptance', 'executionStatus', 'reviewStatus', 'priority']),
    '新建任务请求',
  )
  const title = requestText(candidate.title, '任务标题', 500)
  const instruction = candidate.instruction === undefined || candidate.instruction === null
    ? undefined
    : requestText(candidate.instruction, '任务说明', 20_000)
  const acceptance = candidate.acceptance === undefined
    ? undefined
    : requestTextList(candidate.acceptance, '验收标准', 50, 1000)
  const executionStatus = candidate.executionStatus === undefined
    ? undefined
    : requestText(candidate.executionStatus, '执行状态', 40)
  if (executionStatus !== undefined && !['draft', 'ready', 'running', 'paused', 'blocked', 'completed', 'cancelled'].includes(executionStatus)) {
    throw projectControlHttpError('INVALID_BODY', '执行状态无效。')
  }
  const reviewStatus = candidate.reviewStatus === undefined
    ? undefined
    : requestText(candidate.reviewStatus, '审核状态', 40)
  if (reviewStatus !== undefined && !['not_requested', 'pending', 'changes_requested', 'approved', 'rejected'].includes(reviewStatus)) {
    throw projectControlHttpError('INVALID_BODY', '审核状态无效。')
  }
  const priority = candidate.priority === undefined
    ? undefined
    : requestRevision(candidate.priority, '优先级', 0)
  if (priority !== undefined && priority > 100) throw projectControlHttpError('INVALID_BODY', '优先级无效。')
  return {
    title,
    ...(instruction === undefined ? {} : { instruction }),
    ...(acceptance === undefined ? {} : { acceptance }),
    ...(executionStatus === undefined ? {} : { executionStatus }),
    ...(reviewStatus === undefined ? {} : { reviewStatus }),
    ...(priority === undefined ? {} : { priority }),
  }
}

function normalizeWorkItemStatusRequest(value: unknown): { expectedRevision: number; status: string } {
  const candidate = requestObject(value, '任务状态请求')
  requireExactKeys(candidate, new Set(['expectedRevision', 'status']), '任务状态请求')
  const status = requestText(candidate.status, '目标状态', 40)
  if (!['draft', 'ready', 'running', 'paused', 'blocked', 'completed', 'cancelled'].includes(status)) {
    throw projectControlHttpError('INVALID_BODY', '目标状态无效。')
  }
  return {
    expectedRevision: requestRevision(candidate.expectedRevision, '任务修订', 1),
    status,
  }
}

function normalizeReviewRequestRequest(value: unknown): {
  expectedRevision: number
  risk?: 'unrated' | 'low' | 'medium' | 'high'
} {
  const candidate = requestObject(value, '审阅请求')
  rejectUnknownKeys(candidate, new Set(['expectedRevision', 'risk']), '审阅请求')
  const risk = candidate.risk === undefined || candidate.risk === null
    ? undefined
    : requestText(candidate.risk, '风险等级', 40)
  if (risk !== undefined && !['unrated', 'low', 'medium', 'high'].includes(risk)) {
    throw projectControlHttpError('INVALID_BODY', '风险等级无效。')
  }
  return {
    expectedRevision: requestRevision(candidate.expectedRevision, '任务修订', 1),
    ...(risk === undefined ? {} : { risk: risk as 'unrated' | 'low' | 'medium' | 'high' }),
  }
}

function normalizeReviewDecisionRequest(value: unknown): {
  expectedRevision: number
  decision: 'approve' | 'reject' | 'request_changes'
  rationale?: string
} {
  const candidate = requestObject(value, '审阅决定请求')
  rejectUnknownKeys(candidate, new Set(['expectedRevision', 'decision', 'rationale']), '审阅决定请求')
  const decision = candidate.decision
  if (decision !== 'approve' && decision !== 'reject' && decision !== 'request_changes') {
    throw projectControlHttpError('INVALID_BODY', '审阅决定无效。')
  }
  const rationale = candidate.rationale === undefined || candidate.rationale === null || candidate.rationale === ''
    ? undefined
    : requestText(candidate.rationale, '审阅意见', 4000)
  return {
    expectedRevision: requestRevision(candidate.expectedRevision, '审阅修订', 1),
    decision,
    ...(rationale === undefined ? {} : { rationale }),
  }
}

function normalizeReviewCommentRequest(value: unknown): { comment: string } {
  const candidate = requestObject(value, '审阅评论请求')
  requireExactKeys(candidate, new Set(['comment']), '审阅评论请求')
  return { comment: requestText(candidate.comment, '评论内容', 4000) }
}

function normalizeRunStartRequest(value: unknown): { expectedRevision: number } {
  const candidate = requestObject(value, '启动运行请求')
  requireExactKeys(candidate, new Set(['expectedRevision']), '启动运行请求')
  return { expectedRevision: requestRevision(candidate.expectedRevision, '运行修订', 1) }
}

function normalizeProjectLifecycleRequest(value: unknown): { expectedRevision: number } {
  const input = requestObject(value, '项目归档请求')
  requireExactKeys(input, new Set(['expectedRevision']), '项目归档请求')
  return { expectedRevision: requestRevision(input.expectedRevision, '项目修订', 1) }
}

function normalizeReviewAction(value: unknown): Record<string, unknown> {
  const action = responseObject(value, 'review action')
  const kind = boundedText(action.action, 'action', 40)
  if (!['comment', 'request_changes', 'approve', 'reject', 'supersede'].includes(kind)) {
    throw new TypeError('external service returned an invalid review action')
  }
  return {
    reviewActionId: responseId(action.reviewActionId, REVIEW_ACTION_ID, 'reviewActionId'),
    reviewId: responseId(action.reviewId, REVIEW_ID, 'reviewId'),
    action: kind,
    actor: action.actor,
    comment: boundedNullableText(action.comment, 'comment', 4000),
    createdAt: responseTimestamp(action.createdAt, 'createdAt'),
  }
}

const THREAD_BINDING_ID = /^atb_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

function normalizeSessionList(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value) || value.length > 500) {
    throw new TypeError('external service returned an invalid session binding list')
  }
  return value.map((raw) => {
    const binding = responseObject(raw, 'session binding')
    return {
      bindingId: responseId(binding.bindingId, THREAD_BINDING_ID, 'bindingId'),
      projectId: responseId(binding.projectId, PROJECT_ID, 'projectId'),
      runId: responseId(binding.runId, RUN_ID, 'runId'),
      harnessInstanceRef: boundedText(binding.harnessInstanceRef, 'harnessInstanceRef', 127),
      sessionId: boundedText(binding.sessionId, 'sessionId', 200),
      threadId: boundedText(binding.threadId, 'threadId', 127),
      createdAt: responseTimestamp(binding.createdAt, 'createdAt'),
    }
  })
}

function normalizeReviewActionList(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value) || value.length > 500) {
    throw new TypeError('external service returned an invalid review action list')
  }
  return value.map((raw) => normalizeReviewAction(raw))
}

function requestTextList(value: unknown, field: string, maxLength: number, maxItemLength: number): string[] {
  if (!Array.isArray(value) || value.length > maxLength
    || value.some((item) => typeof item !== 'string' || item.length < 1 || item.length > maxItemLength)) {
    throw projectControlHttpError('INVALID_BODY', `${field}无效。`)
  }
  return value as string[]
}

function normalizeCreatePreparationResult(value: unknown): Record<string, unknown> {
  const candidate = responseObject(value, 'create preparation')
  const template = responseObject(candidate.template, 'template')
  const writePlan = responseObject(candidate.writePlan, 'writePlan')
  const command = responseObject(candidate.command, 'command')
  return {
    template: {
      templateId: boundedText(template.templateId, 'templateId', 128),
      templateVersion: boundedText(template.templateVersion, 'templateVersion', 64),
      displayName: boundedText(template.displayName, 'displayName', 120),
      templateHash: boundedText(template.templateHash, 'templateHash', 80),
    },
    projectId: boundedText(candidate.projectId, 'projectId', 80),
    targetDisplayPath: boundedText(candidate.targetDisplayPath, 'targetDisplayPath', 2048),
    directoryName: boundedText(candidate.directoryName, 'directoryName', 120),
    expiresAt: boundedText(candidate.expiresAt, 'expiresAt', 80),
    writePlan: {
      planId: boundedText(writePlan.planId, 'planId', 80),
      planHash: boundedText(writePlan.planHash, 'planHash', 80),
      manifestHash: boundedText(writePlan.manifestHash, 'manifestHash', 80),
      syncPolicy: boundedText(writePlan.syncPolicy, 'syncPolicy', 40),
      operations: writePlan.operations,
    },
    command,
  }
}

function normalizeDocumentIndex(value: unknown): Record<string, unknown> {
  const candidate = responseObject(value, 'document index')
  const documents = candidate.documents
  const proposals = candidate.proposals
  if (!Array.isArray(documents) || documents.length > 200
    || !Array.isArray(proposals) || proposals.length > 50) {
    throw new TypeError('intake service returned an invalid document index')
  }
  return {
    projectId: responseId(candidate.projectId, PROJECT_ID, 'projectId'),
    mode: boundedText(candidate.mode, 'project mode', 40),
    name: boundedText(candidate.name, 'project name', 240),
    revision: requiredRevision(candidate.revision, 'project revision', 1),
    locationDisplayPath: boundedNullableText(candidate.locationDisplayPath, 'locationDisplayPath', 32_767),
    documents: documents.map((raw) => {
      const document = responseObject(raw, 'document state')
      const state = boundedText(document.state, 'document state', 40)
      const bindingSource = boundedText(document.bindingSource, 'binding source', 40)
      if (!['ok', 'changed', 'missing', 'unreadable'].includes(state)
        || !['user_confirmed', 'manifest'].includes(bindingSource)) {
        throw new TypeError('intake service returned an invalid document state')
      }
      const parseIssues = document.parseIssues
      if (!Array.isArray(parseIssues) || parseIssues.length > 20) {
        throw new TypeError('intake service returned invalid parse issues')
      }
      return {
        role: boundedText(document.role, 'document role', 40),
        relativePath: responseRelativePath(document.relativePath, 'relativePath'),
        bindingSource,
        state,
        contentHash: boundedNullableText(document.contentHash, 'contentHash', 80),
        byteSize: document.byteSize === null || document.byteSize === undefined
          ? null
          : requiredRevision(document.byteSize, 'byteSize', 0),
        parseIssues: parseIssues.map((rawIssue) => {
          const issue = responseObject(rawIssue, 'parse issue')
          const severity = boundedText(issue.severity, 'parse issue severity', 20)
          if (!['info', 'warning', 'error', 'blocking'].includes(severity)) {
            throw new TypeError('intake service returned an invalid parse issue severity')
          }
          return {
            code: boundedText(issue.code, 'parse issue code', 100),
            severity,
            message: boundedText(issue.message, 'parse issue message', 1000),
            line: issue.line === null || issue.line === undefined
              ? null
              : requiredRevision(issue.line, 'parse issue line', 1),
          }
        }),
        revision: requiredRevision(document.revision, 'document revision', 1),
        firstSeenAt: responseTimestamp(document.firstSeenAt, 'firstSeenAt'),
        lastVerifiedAt: responseTimestamp(document.lastVerifiedAt, 'lastVerifiedAt'),
      }
    }),
    proposals: proposals.map(normalizeRebindProposal),
  }
}

function normalizeRebindProposal(value: unknown): Record<string, unknown> {
  const proposal = responseObject(value, 'rebind proposal')
  const status = boundedText(proposal.status, 'proposal status', 40)
  if (!['proposed', 'accepted', 'rejected', 'superseded'].includes(status)) {
    throw new TypeError('intake service returned an invalid rebind proposal status')
  }
  const candidates = proposal.candidateRelativePaths
  if (!Array.isArray(candidates) || candidates.length < 1 || candidates.length > 50) {
    throw new TypeError('intake service returned invalid rebind candidates')
  }
  return {
    proposalId: responseId(proposal.proposalId, REBIND_PROPOSAL_ID, 'proposalId'),
    role: boundedText(proposal.role, 'proposal role', 40),
    missingRelativePath: responseRelativePath(proposal.missingRelativePath, 'missingRelativePath'),
    contentHash: boundedText(proposal.contentHash, 'contentHash', 80),
    candidateRelativePaths: candidates.map(item => responseRelativePath(item, 'candidateRelativePath')),
    candidateCount: requiredRevision(proposal.candidateCount, 'candidateCount', 1),
    unambiguous: proposal.unambiguous === true,
    status,
    resolvedRelativePath: boundedNullableText(proposal.resolvedRelativePath, 'resolvedRelativePath', 2048),
    revision: requiredRevision(proposal.revision, 'proposal revision', 1),
    createdAt: responseTimestamp(proposal.createdAt, 'createdAt'),
    updatedAt: responseTimestamp(proposal.updatedAt, 'updatedAt'),
    resolvedAt: boundedNullableText(proposal.resolvedAt, 'resolvedAt', 80),
    applicable: proposal.applicable === true,
  }
}

function normalizeRebindResolution(value: unknown): {
  expectedRevision: number
  decision: 'accept' | 'reject'
  candidateRelativePath?: string
} {
  const candidate = requestObject(value, '重绑处理请求')
  for (const key of Object.keys(candidate)) {
    if (!['expectedRevision', 'decision', 'candidateRelativePath'].includes(key)) {
      throw projectControlHttpError('INVALID_BODY', '重绑处理请求包含未知字段。')
    }
  }
  if (candidate.decision !== 'accept' && candidate.decision !== 'reject') {
    throw projectControlHttpError('INVALID_BODY', '重绑处理决定无效。')
  }
  const input: {
    expectedRevision: number
    decision: 'accept' | 'reject'
    candidateRelativePath?: string
  } = {
    expectedRevision: requestRevision(candidate.expectedRevision, '提案修订', 1),
    decision: candidate.decision as 'accept' | 'reject',
  }
  if (candidate.candidateRelativePath !== undefined) {
    const relativePath = requestText(candidate.candidateRelativePath, '重绑目标路径', 512)
    if (!isCanonicalRelativePath(relativePath)) {
      throw projectControlHttpError('INVALID_BODY', '重绑目标路径无效。')
    }
    input.candidateRelativePath = relativePath
  }
  return input
}

function normalizeRebindResolutionResult(value: unknown): Record<string, unknown> {
  const candidate = responseObject(value, 'rebind resolution')
  return {
    proposal: candidate.proposal === undefined || candidate.proposal === null
      ? null
      : normalizeRebindProposal(candidate.proposal),
    projectRevision: requiredRevision(candidate.projectRevision, 'projectRevision', 1),
  }
}

function normalizeUpgradePreparation(value: unknown): { expectedRevision: number } {
  const candidate = requestObject(value, '升级预检请求')
  requireExactKeys(candidate, new Set(['expectedRevision']), '升级预检请求')
  return { expectedRevision: requestRevision(candidate.expectedRevision, '项目修订', 1) }
}

function normalizeUpgradePreparationResult(value: unknown): Record<string, unknown> {
  const candidate = responseObject(value, 'upgrade preparation')
  const writePlan = responseObject(candidate.writePlan, 'writePlan')
  const command = responseObject(candidate.command, 'command')
  return {
    projectId: boundedText(candidate.projectId, 'projectId', 80),
    name: boundedText(candidate.name, 'name', 120),
    targetDisplayPath: boundedText(candidate.targetDisplayPath, 'targetDisplayPath', 2048),
    documentCount: boundedText(String(candidate.documentCount), 'documentCount', 40),
    fingerprintHash: boundedText(candidate.fingerprintHash, 'fingerprintHash', 80),
    expiresAt: boundedText(candidate.expiresAt, 'expiresAt', 80),
    writePlan: {
      planId: boundedText(writePlan.planId, 'planId', 80),
      planHash: boundedText(writePlan.planHash, 'planHash', 80),
      manifestHash: boundedText(writePlan.manifestHash, 'manifestHash', 80),
      syncPolicy: boundedText(writePlan.syncPolicy, 'syncPolicy', 40),
      operations: writePlan.operations,
    },
    command,
  }
}

function normalizeImportScan(value: unknown): {
  sourceRoot: PublicSourceRoot
  job: PublicImportJob
  candidates: PublicImportCandidate[]
  summary: Record<string, unknown>
  issues: PublicImportJobIssue[]
} {
  const candidate = responseObject(value, 'scan')
  const job = normalizeImportJob(candidate.job)
  return {
    sourceRoot: normalizeSourceRoot(candidate.sourceRoot),
    job,
    candidates: normalizeCandidateList(candidate.candidates),
    summary: job.summary,
    issues: job.issues,
  }
}

function normalizeSourceRoots(value: unknown): PublicSourceRoot[] {
  if (!Array.isArray(value) || value.length > 200) {
    throw new TypeError('intake service returned an invalid source root list')
  }
  return value.map(normalizeSourceRoot)
}

function normalizeSourceRoot(value: unknown): PublicSourceRoot {
  const candidate = responseObject(value, 'source root')
  const kind = boundedText(candidate.kind, 'source root kind', 40)
  if (!['source_root', 'single_project', 'source-root', 'project-root'].includes(kind)) {
    throw new TypeError('intake service returned an invalid source root kind')
  }
  return {
    sourceRootId: responseId(candidate.sourceRootId, SOURCE_ROOT_ID, 'sourceRootId'),
    kind: kind === 'source_root' || kind === 'source-root' ? 'source-root' : 'project-root',
    path: boundedText(candidate.path ?? candidate.displayPath, 'source root path', 32_767),
    revision: requiredRevision(candidate.revision, 'source root revision', 1),
    updatedAt: responseTimestamp(candidate.updatedAt, 'source root updatedAt'),
  }
}

function normalizeImportJob(value: unknown): PublicImportJob {
  const candidate = responseObject(value, 'import job')
  const mode = boundedText(candidate.mode, 'import job mode', 40)
  const status = boundedText(candidate.status, 'import job status', 40)
  if (!['source_root', 'single_project', 'source-root', 'project-root'].includes(mode)
    || !['completed', 'failed', 'cancelled'].includes(status)) {
    throw new TypeError('intake service returned an invalid import job state')
  }
  return {
    jobId: responseId(candidate.jobId ?? candidate.importJobId, IMPORT_JOB_ID, 'jobId'),
    sourceRootId: responseId(candidate.sourceRootId, SOURCE_ROOT_ID, 'sourceRootId'),
    mode: mode === 'source_root' || mode === 'source-root' ? 'source-root' : 'project-root',
    status: status as PublicImportJob['status'],
    scannerVersion: boundedText(candidate.scannerVersion, 'scannerVersion', 80),
    startedAt: responseTimestamp(candidate.startedAt, 'startedAt'),
    completedAt: responseTimestamp(candidate.completedAt, 'completedAt'),
    summary: safeJsonObject(candidate.summary, 'import job summary'),
    issues: normalizeImportJobIssues(candidate.issues ?? []),
  }
}

function normalizeImportJobIssues(value: unknown): PublicImportJobIssue[] {
  if (!Array.isArray(value) || value.length > 500) {
    throw new TypeError('intake service returned an invalid import job issue list')
  }
  return value.map(raw => {
    const candidate = responseObject(raw, 'import job issue')
    const severity = boundedText(candidate.severity, 'job issue severity', 20)
    const status = boundedText(candidate.status, 'job issue status', 20)
    if (!['info', 'warning', 'error', 'blocking'].includes(severity)
      || !['open', 'resolved'].includes(status)) {
      throw new TypeError('intake service returned an invalid import job issue state')
    }
    const details = safeJsonObject(candidate.details ?? {}, 'job issue details')
    return {
      issueId: responseId(candidate.issueId ?? candidate.importJobIssueId, IMPORT_JOB_ISSUE_ID, 'jobIssueId'),
      code: boundedText(candidate.code, 'job issue code', 100),
      severity: severity as PublicImportJobIssue['severity'],
      status: status as PublicImportJobIssue['status'],
      message: boundedText(candidate.message ?? details.message ?? candidate.code, 'job issue message', 500),
    }
  })
}

function normalizeCandidateList(value: unknown): PublicImportCandidate[] {
  if (!Array.isArray(value) || value.length > 500) {
    throw new TypeError('intake service returned an invalid candidate list')
  }
  return value.map(candidate => normalizeCandidate(candidate, false))
}

function normalizeCandidatePage(value: unknown): {
  candidates: PublicImportCandidate[]
  total: number
  counts: { review: number; ignored: number; history: number }
  nextCursor: string | null
} {
  if (Array.isArray(value)) {
    const candidates = normalizeCandidateList(value)
    return {
      candidates,
      total: candidates.length,
      counts: {
        review: candidates.filter(candidate => ['discovered', 'conflict', 'relocation_candidate'].includes(candidate.status)).length,
        ignored: candidates.filter(candidate => candidate.status === 'ignored').length,
        history: candidates.filter(candidate => candidate.status === 'imported').length,
      },
      nextCursor: null,
    }
  }
  const page = responseObject(value, 'candidate page')
  const candidates = normalizeCandidateList(page.candidates)
  const counts = responseObject(page.counts, 'candidate counts')
  const nextCursor = page.nextCursor === null
    ? null
    : responseId(page.nextCursor, IMPORT_CANDIDATE_ID, 'candidate cursor')
  return {
    candidates,
    total: requiredRevision(page.total, 'candidate total', 0),
    counts: {
      review: requiredRevision(counts.review, 'review candidate count', 0),
      ignored: requiredRevision(counts.ignored, 'ignored candidate count', 0),
      history: requiredRevision(counts.history, 'history candidate count', 0),
    },
    nextCursor,
  }
}

function normalizeCandidate(value: unknown, includeDetails = true): PublicImportCandidate {
  const candidate = responseObject(value, 'candidate')
  const root = candidate.root === undefined ? undefined : responseObject(candidate.root, 'candidate root')
  const confidence = candidate.confidence === undefined
    ? {}
    : responseObject(candidate.confidence, 'candidate confidence')
  const detectedMode = boundedText(candidate.detectedMode, 'detectedMode', 40)
  const status = boundedText(candidate.status, 'candidate status', 40)
  const historyReason = candidate.historyReason
  const evidenceLevel = String(candidate.evidenceLevel ?? confidence.level ?? 'low')
  if (!['unknown', 'linked_legacy', 'managed'].includes(detectedMode)
    || !['discovered', 'conflict', 'relocation_candidate', 'ignored', 'imported'].includes(status)
    || (historyReason !== undefined && !['completed', 'superseded'].includes(String(historyReason)))
    || !['high', 'medium', 'low'].includes(evidenceLevel)) {
    throw new TypeError('intake service returned an invalid candidate state')
  }
  const documents = candidate.documents
  const issues = candidate.issues
  if (!Array.isArray(documents) || documents.length > 200
    || !Array.isArray(issues) || issues.length > 200) {
    throw new TypeError('intake service returned invalid candidate evidence')
  }
  return {
    candidateId: responseId(candidate.candidateId, IMPORT_CANDIDATE_ID, 'candidateId'),
    jobId: responseId(candidate.jobId ?? candidate.importJobId, IMPORT_JOB_ID, 'jobId'),
    revision: requiredRevision(candidate.revision, 'candidate revision', 1),
    rootPath: boundedText(candidate.rootPath ?? root?.displayPath, 'candidate rootPath', 32_767),
    suggestedName: boundedText(candidate.suggestedName, 'suggestedName', 240),
    nameSource: normalizeValueSource(candidate.nameSource ?? confidence.nameSource, 'nameSource'),
    summary: boundedNullableText(candidate.summary ?? candidate.suggestedSummary, 'summary', 1000),
    summarySource: normalizeValueSource(candidate.summarySource, 'summarySource'),
    evidenceLevel: evidenceLevel as PublicImportCandidate['evidenceLevel'],
    status: status as PublicImportCandidate['status'],
    ...(historyReason === undefined
      ? {}
      : { historyReason: historyReason as 'completed' | 'superseded' }),
    detectedMode: detectedMode as PublicImportCandidate['detectedMode'],
    manifestProjectId: boundedNullableText(candidate.manifestProjectId, 'manifestProjectId', 80),
    documentCount: documents.length,
    issueCount: issues.length,
    evidence: includeDetails ? normalizeEvidenceStrings(candidate.evidence ?? confidence.evidence ?? []) : [],
    documents: includeDetails ? documents.map(normalizeCandidateDocument) : [],
    issues: includeDetails ? issues.map(normalizeImportIssue) : [],
  }
}

function normalizeCandidateDocument(value: unknown): Record<string, unknown> {
  const candidate = responseObject(value, 'candidate document')
  const suggestedRole = candidate.suggestedRole
  if (suggestedRole !== null && suggestedRole !== undefined
    && (typeof suggestedRole !== 'string' || !DOCUMENT_ROLES.has(suggestedRole))) {
    throw new TypeError('intake service returned an invalid document role')
  }
  const contentHash = candidate.contentHash ?? candidate.sha256
  if (contentHash !== null && contentHash !== undefined
    && (typeof contentHash !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(contentHash))) {
    throw new TypeError('intake service returned an invalid document hash')
  }
  return {
    documentId: responseId(candidate.documentId ?? candidate.candidateDocumentId, CANDIDATE_DOCUMENT_ID, 'documentId'),
    relativePath: responseRelativePath(candidate.relativePath, 'relativePath'),
    suggestedRole: suggestedRole ?? null,
    contentHash: contentHash ?? null,
    title: boundedNullableText(candidate.title, 'document title', 240),
    preview: boundedNullableText(candidate.preview, 'document preview', 1000),
    evidence: normalizeEvidenceStrings(candidate.evidence ?? []),
  }
}

function normalizeImportIssue(value: unknown): Record<string, unknown> {
  const candidate = responseObject(value, 'import issue')
  const severity = boundedText(candidate.severity, 'issue severity', 20)
  const status = boundedText(candidate.status, 'issue status', 20)
  if (!['info', 'warning', 'error', 'blocking'].includes(severity)
    || !['open', 'resolved'].includes(status)) {
    throw new TypeError('intake service returned an invalid issue state')
  }
  return {
    issueId: responseId(candidate.issueId ?? candidate.importIssueId, IMPORT_ISSUE_ID, 'issueId'),
    code: boundedText(candidate.code, 'issue code', 80),
    severity,
    status,
    details: safeJsonObject(candidate.details ?? {}, 'issue details'),
  }
}

function requestObject(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw projectControlHttpError('INVALID_BODY', `${field}必须是对象。`)
  }
  return value as Record<string, unknown>
}

function responseObject(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`intake service returned an invalid ${field}`)
  }
  return value as Record<string, unknown>
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  field: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw projectControlHttpError('INVALID_BODY', `${field}包含未知字段。`)
  }
}

function requireExactKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  field: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw projectControlHttpError('INVALID_BODY', `${field}包含未知字段。`)
  }
  for (const required of allowed) {
    if (required === 'maxDepth') continue
    if (!(required in value)) throw projectControlHttpError('INVALID_BODY', `${field}缺少必需字段。`)
  }
}

function requestText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > maxLength) {
    throw projectControlHttpError('INVALID_BODY', `${field}无效。`)
  }
  return value
}

function requestRevision(value: unknown, field: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw projectControlHttpError('INVALID_BODY', `${field}无效。`)
  }
  return value as number
}

function optionalSingleQuery(parsed: URL, key: string, pattern: RegExp): string | undefined {
  const values = parsed.searchParams.getAll(key)
  if (values.length === 0) return undefined
  if (values.length !== 1 || !pattern.test(values[0] ?? '')) {
    throw projectControlHttpError('INVALID_QUERY', '项目候选筛选条件无效。')
  }
  return values[0]
}

function optionalBoundedQuery(parsed: URL, key: string, maxLength: number): string | undefined {
  const values = parsed.searchParams.getAll(key)
  if (values.length === 0) return undefined
  const value = values[0] ?? ''
  if (values.length !== 1 || value.length > maxLength || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw projectControlHttpError('INVALID_QUERY', '项目候选筛选条件无效。')
  }
  return value
}

function optionalIntegerQuery(
  parsed: URL,
  key: string,
  minimum: number,
  maximum: number,
): number | undefined {
  const values = parsed.searchParams.getAll(key)
  if (values.length === 0) return undefined
  const value = values[0] ?? ''
  if (values.length !== 1 || !/^[0-9]+$/u.test(value)) {
    throw projectControlHttpError('INVALID_QUERY', '项目候选筛选条件无效。')
  }
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw projectControlHttpError('INVALID_QUERY', '项目候选筛选条件无效。')
  }
  return number
}

function rejectUnexpectedQuery(parsed: URL, allowed: ReadonlySet<string>): void {
  for (const key of parsed.searchParams.keys()) {
    if (!allowed.has(key)) throw projectControlHttpError('INVALID_QUERY', '项目控制台查询参数无效。')
  }
}

function responseId(value: unknown, pattern: RegExp, field: string): string {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new TypeError(`intake service returned an invalid ${field}`)
  }
  return value
}

function responseTimestamp(value: unknown, field: string): string {
  if (typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
    || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`intake service returned an invalid ${field}`)
  }
  return value
}

function boundedNullableText(value: unknown, field: string, maxLength: number): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string' || value.length > maxLength || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
    throw new TypeError(`intake service returned an invalid ${field}`)
  }
  return value
}

function normalizeValueSource(value: unknown, field: string): PublicValueSource | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string') {
    const text = boundedNullableText(value, field, 512)
    if (text === null || text === '') return null
    return text.includes('/') || text.includes('\\') || /\.[A-Za-z0-9_-]{1,12}$/u.test(text)
      ? { relativePath: text.replaceAll('\\', '/') }
      : { label: text }
  }
  const candidate = responseObject(value, field)
  const relativePath = boundedNullableText(candidate.relativePath, `${field}.relativePath`, 512)
  const label = boundedNullableText(candidate.label, `${field}.label`, 240)
  if (relativePath === null && label === null) return null
  return {
    ...(relativePath === null ? {} : { relativePath: responseRelativePath(relativePath, field) }),
    ...(label === null ? {} : { label }),
  }
}

function normalizeEvidenceStrings(value: unknown): string[] {
  if (Array.isArray(value)) {
    if (value.length > 100) throw new TypeError('intake service returned oversized evidence')
    return value.map((item, index) => {
      if (typeof item === 'string' && item.length > 0 && item.length <= 500) return item
      if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
        const evidence = item as Record<string, unknown>
        const kind = typeof evidence.kind === 'string' ? evidence.kind : 'evidence'
        const detail = typeof evidence.detail === 'string'
          ? evidence.detail
          : typeof evidence.message === 'string'
            ? evidence.message
            : typeof evidence.relativePath === 'string' ? evidence.relativePath : ''
        const rendered = detail === '' ? kind : `${kind}: ${detail}`
        if (rendered.length > 0 && rendered.length <= 500) return rendered
      }
      throw new TypeError(`intake service returned invalid evidence at ${String(index)}`)
    })
  }
  if (value !== null && typeof value === 'object') {
    const candidate = value as Record<string, unknown>
    for (const key of ['signals', 'evidence', 'reasons']) {
      if (Array.isArray(candidate[key])) return normalizeEvidenceStrings(candidate[key])
    }
    const strings = Object.entries(candidate)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .map(([key, item]) => `${key}: ${item}`)
    return normalizeEvidenceStrings(strings)
  }
  throw new TypeError('intake service returned invalid evidence')
}

function responseRelativePath(value: unknown, field: string): string {
  if (typeof value !== 'string' || !isCanonicalRelativePath(value)) {
    throw new TypeError(`intake service returned an invalid ${field}`)
  }
  return value
}

function isCanonicalRelativePath(value: string): boolean {
  return value.length > 0
    && value.length <= 512
    && !value.startsWith('/')
    && !value.startsWith('./')
    && !value.endsWith('/')
    && !value.includes('\\')
    && !value.includes(':')
    && !value.includes('//')
    && !/[\u0000-\u001f\u007f]/u.test(value)
    && value.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..')
}

function safeJsonObject(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`intake service returned an invalid ${field}`)
  }
  return safeJsonValue(value, field, 0) as Record<string, unknown>
}

function safeJsonValue(value: unknown, field: string, depth: number): unknown {
  if (depth > 5) throw new TypeError(`intake service returned an oversized ${field}`)
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`intake service returned an invalid ${field}`)
    return value
  }
  if (typeof value === 'string') {
    if (value.length > 1000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
      throw new TypeError(`intake service returned an invalid ${field}`)
    }
    return value
  }
  if (Array.isArray(value)) {
    if (value.length > 100) throw new TypeError(`intake service returned an oversized ${field}`)
    return value.map(item => safeJsonValue(item, field, depth + 1))
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length > 100) throw new TypeError(`intake service returned an oversized ${field}`)
    return Object.fromEntries(entries.map(([key, item]) => {
      if (key.length === 0 || key.length > 100 || /[\u0000-\u001f\u007f]/u.test(key)) {
        throw new TypeError(`intake service returned an invalid ${field}`)
      }
      return [key, safeJsonValue(item, field, depth + 1)]
    }))
  }
  throw new TypeError(`intake service returned an invalid ${field}`)
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const PROJECT_ID = /^prj_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const SOURCE_ROOT_ID = /^src_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const IMPORT_JOB_ID = /^job_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const IMPORT_CANDIDATE_ID = /^can_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const CANDIDATE_DOCUMENT_ID = /^doc_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const IMPORT_ISSUE_ID = /^iss_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const IMPORT_JOB_ISSUE_ID = /^jis_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const REBIND_PROPOSAL_ID = /^rbd_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const DOCUMENT_ROLES = new Set([
  'readme',
  'prd',
  'devlog',
  'progress',
  'next',
  'current_architecture',
  'decision',
  'other',
])

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const contentType = request.headers['content-type']
  if (typeof contentType !== 'string' || contentType.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    throw projectControlHttpError('UNSUPPORTED_MEDIA_TYPE', '项目控制台写入请求必须使用 application/json。', 415)
  }
  const contentEncoding = request.headers['content-encoding']
  if (contentEncoding !== undefined && contentEncoding !== 'identity') {
    throw projectControlHttpError('UNSUPPORTED_CONTENT_ENCODING', '项目控制台写入请求不接受压缩正文。', 415)
  }

  const rawLength = request.headers['content-length']
  if (rawLength !== undefined) {
    const declared = Number(rawLength)
    if (!Number.isSafeInteger(declared) || declared < 0) {
      throw projectControlHttpError('INVALID_CONTENT_LENGTH', '请求长度无效。')
    }
    if (declared > MAX_BODY_BYTES) {
      throw projectControlHttpError('BODY_TOO_LARGE', '项目控制台请求内容过大。', 413)
    }
  }

  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) {
      throw projectControlHttpError('BODY_TOO_LARGE', '项目控制台请求内容过大。', 413)
    }
    chunks.push(buffer)
  }
  if (size === 0) throw projectControlHttpError('INVALID_JSON', '项目控制台写入请求正文不能为空。')
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw projectControlHttpError('INVALID_JSON', '项目控制台写入请求不是有效的 JSON。')
  }
}

async function executeLifecycleCommand(
  command: LifecycleCommand,
  options: ProjectControlHandlerOptions,
): Promise<unknown> {
  const lifecycle = options.lifecycle
  if (lifecycle === undefined) {
    throw projectControlHttpError('LIFECYCLE_UNAVAILABLE', '生命周期指令服务暂不可用。', 503)
  }
  const now = options.now ?? (() => new Date().toISOString())
  let storedReplayAuthorized = false

  try {
    const intakeCommand = command.kind === 'project.registerLegacy'
      || command.kind === 'project.registerManaged'
      || command.kind === 'project.rebindLocation'
    if (intakeCommand
      && options.referenceResolver?.authorizeStoredReplay !== undefined
      && lifecycle.replayCommandReceipt !== undefined
      && await options.referenceResolver.authorizeStoredReplay(command)) {
      storedReplayAuthorized = true
      // An accepted command advances/imports the candidate, so an exact
      // network retry must consult its immutable receipt before fresh-state
      // candidate/ref resolution. Storage performs the full request-hash
      // comparison; a changed envelope still raises IDEMPOTENCY_CONFLICT.
      const replay = await lifecycle.replayCommandReceipt(command)
      if (replay !== null) return replay
    }

    if (command.kind === 'project.createFromTemplate') {
      if (options.referenceResolver?.resolveCreate === undefined || lifecycle.createProject === undefined) {
        return lifecycle.recordRejectedCommand(command, lifecycleRejection(
          command,
          'CAPABILITY_NOT_NEGOTIATED',
          '此 Host 尚未开放标准项目快速新建。',
          now(),
          {
            currentRevision: command.expectedRevision,
            fileSync: plannedFileSync(command),
          },
        ))
      }
      const resolution = await options.referenceResolver.resolveCreate(command)
      if (resolution === null || resolution === undefined) {
        return lifecycle.recordRejectedCommand(command, lifecycleRejection(
          command,
          'REFERENCE_UNRESOLVED',
          '新建授权或写入计划已失效，请重新准备。',
          now(),
          {
            currentRevision: command.expectedRevision,
            fileSync: plannedFileSync(command),
          },
        ))
      }
      // The explicit await keeps createProject rejections inside this try so
      // the business error code mapping below applies.
      return await lifecycle.createProject(command, resolution)
    }

    if (command.kind === 'project.upgradeManaged') {
      if (options.referenceResolver?.resolveUpgrade === undefined || lifecycle.upgradeProject === undefined) {
        return lifecycle.recordRejectedCommand(command, lifecycleRejection(
          command,
          'CAPABILITY_NOT_NEGOTIATED',
          '此 Host 尚未开放 legacy 升级。',
          now(),
          {
            currentRevision: command.expectedRevision,
            fileSync: plannedFileSync(command),
          },
        ))
      }
      const resolution = await options.referenceResolver.resolveUpgrade(command)
      if (resolution === null || resolution === undefined) {
        return lifecycle.recordRejectedCommand(command, lifecycleRejection(
          command,
          'REFERENCE_UNRESOLVED',
          '升级授权或写入计划已失效，请重新准备。',
          now(),
          {
            currentRevision: command.expectedRevision,
            fileSync: plannedFileSync(command),
          },
        ))
      }
      // The explicit await keeps upgradeProject rejections inside this try so
      // the business error code mapping below applies.
      return await lifecycle.upgradeProject(command, resolution)
    }

    if (command.kind === 'project.registerLegacy' || command.kind === 'project.registerManaged') {
      const resolution = await options.referenceResolver?.resolveRegistration(command)
      if (resolution === undefined || resolution === null) {
        return lifecycle.recordRejectedCommand(command, lifecycleRejection(
          command,
          'REFERENCE_UNRESOLVED',
          '此 Host 尚未签发或解析项目位置引用；请等待 Gate 2C。',
          now(),
        ))
      }
      return lifecycle.registerProject(command, resolution)
    }

    const resolution = await options.referenceResolver?.resolveRebind(command)
    if (resolution === undefined || resolution === null) {
      return lifecycle.recordRejectedCommand(command, lifecycleRejection(
        command,
        'REFERENCE_UNRESOLVED',
        '此 Host 尚未签发或解析新的项目位置引用；请等待 Gate 2C。',
        now(),
      ))
    }
    return lifecycle.rebindProject(command, resolution)
  } catch (error) {
    let effectiveError = error
    if (storedReplayAuthorized && lifecycle.replayCommandReceipt !== undefined) {
      // Close the race where another identical request commits after the
      // first receipt lookup but before this request resolves mutable
      // candidate state. A conflicting second lookup intentionally replaces
      // the stale resolver error with IDEMPOTENCY_CONFLICT.
      try {
        const replay = await lifecycle.replayCommandReceipt(command)
        if (replay !== null) return replay
      } catch (replayError) {
        effectiveError = replayError
      }
    }
    const code = lifecycleBusinessErrorCode(effectiveError)
    if (code === null) throw effectiveError
    const currentRevision = lifecycleBusinessErrorRevision(effectiveError)
    return lifecycleRejection(
      command,
      code,
      publicLifecycleErrorMessage(code),
      now(),
      {
        ...(currentRevision === undefined ? {} : { currentRevision }),
        ...(command.kind === 'project.createFromTemplate' || command.kind === 'project.upgradeManaged'
          ? { fileSync: plannedFileSync(command) }
          : {}),
      },
    )
  }
}

function lifecycleRejection(
  command: LifecycleCommand,
  code: LifecycleErrorCode,
  message: string,
  recordedAt: string,
  details: Pick<LifecycleRejectedResult, 'currentRevision' | 'fileSync'> = {},
): LifecycleRejectedResult {
  return {
    protocolVersion: PROJECT_PROTOCOL_VERSION,
    schemaVersion: 'lifecycle-command-result/v1alpha1',
    commandId: command.commandId,
    correlationId: command.correlationId,
    kind: command.kind,
    status: 'rejected',
    recordedAt,
    ...(details.currentRevision === undefined ? {} : { currentRevision: details.currentRevision }),
    error: { code, message },
    ...(details.fileSync === undefined ? {} : { fileSync: details.fileSync }),
  }
}

function plannedFileSync(command: LifecycleCommand): NonNullable<LifecycleRejectedResult['fileSync']> {
  const writePlan = objectValue(command.payload.writePlan, 'command.payload.writePlan')
  return {
    status: 'planned',
    planId: boundedText(writePlan.planId, 'command.payload.writePlan.planId', 80),
    planHash: boundedText(writePlan.planHash, 'command.payload.writePlan.planHash', 80),
    manifestHash: boundedText(writePlan.manifestHash, 'command.payload.writePlan.manifestHash', 80),
  }
}

function lifecycleBusinessErrorCode(error: unknown): LifecycleErrorCode | null {
  if (!(error instanceof Error)) return null
  const code = (error as Error & { code?: unknown }).code
  return typeof code === 'string' && LIFECYCLE_ERROR_CODES.has(code)
    ? code as LifecycleErrorCode
    : null
}

function lifecycleBusinessErrorRevision(error: unknown): number | undefined {
  if (!(error instanceof Error)) return undefined
  const details = (error as Error & { details?: unknown }).details
  if (details === null || typeof details !== 'object' || Array.isArray(details)) return undefined
  const currentRevision = (details as Record<string, unknown>).currentRevision
  return Number.isSafeInteger(currentRevision) && (currentRevision as number) >= 0
    ? currentRevision as number
    : undefined
}

function normalizeLifecycleResult(value: unknown): Record<string, unknown> {
  const candidate = objectValue(value, 'lifecycle result')
  const protocolVersion = boundedText(candidate.protocolVersion, 'protocolVersion', 80)
  const schemaVersion = boundedText(candidate.schemaVersion, 'schemaVersion', 80)
  const kind = boundedText(candidate.kind, 'kind', 80)
  const status = boundedText(candidate.status, 'status', 20)
  if (protocolVersion !== PROJECT_PROTOCOL_VERSION
    || schemaVersion !== 'lifecycle-command-result/v1alpha1'
    || !LIFECYCLE_KINDS.has(kind)
    || !['accepted', 'replayed', 'rejected'].includes(status)) {
    throw new TypeError('lifecycle service returned an invalid result envelope')
  }

  const common = {
    protocolVersion,
    schemaVersion,
    commandId: boundedText(candidate.commandId, 'commandId', 80),
    correlationId: boundedText(candidate.correlationId, 'correlationId', 200),
    kind,
    status,
    recordedAt: boundedText(candidate.recordedAt, 'recordedAt', 80),
  }
  if (status === 'rejected') {
    const error = objectValue(candidate.error, 'error')
    const code = boundedText(error.code, 'error.code', 80)
    if (!LIFECYCLE_ERROR_CODES.has(code)) {
      throw new TypeError('lifecycle service returned an unsupported error code')
    }
    return {
      ...common,
      ...(optionalRevision(candidate.currentRevision) === undefined
        ? {}
        : { currentRevision: optionalRevision(candidate.currentRevision) }),
      error: {
        code,
        message: publicLifecycleErrorMessage(code),
      },
      ...(candidate.fileSync === undefined ? {} : { fileSync: normalizeFileSync(candidate.fileSync) }),
    }
  }

  const projectMode = boundedText(candidate.projectMode, 'projectMode', 30)
  const outcome = boundedText(candidate.outcome, 'outcome', 80)
  const aggregateRevision = requiredRevision(candidate.aggregateRevision, 'aggregateRevision', 1)
  if (!['linked_legacy', 'managed'].includes(projectMode) || !LIFECYCLE_OUTCOMES.has(outcome)) {
    throw new TypeError('lifecycle service returned invalid project outcome fields')
  }
  return {
    ...common,
    projectId: boundedText(candidate.projectId, 'projectId', 80),
    projectMode,
    aggregateRevision,
    eventId: boundedText(candidate.eventId, 'eventId', 80),
    outcome,
    fileSync: normalizeFileSync(candidate.fileSync),
  }
}

function publicLifecycleErrorMessage(code: string): string {
  switch (code) {
    case 'CAPABILITY_NOT_NEGOTIATED': return '当前 Host 尚未开放这项生命周期能力。'
    case 'REFERENCE_UNRESOLVED': return '项目或位置引用当前无法解析。'
    case 'IDEMPOTENCY_CONFLICT': return '相同命令标识已对应另一份请求。'
    case 'REVISION_CONFLICT': return '项目已发生变化，请刷新后重新确认。'
    case 'PROJECT_ALREADY_EXISTS': return '目标项目已经存在。'
    case 'LOCATION_CONFLICT': return '项目位置与现有登记冲突。'
    case 'MODE_CONFLICT': return '项目管理模式与当前指令不一致。'
    default: return '生命周期指令未被接受。'
  }
}

const LIFECYCLE_KINDS = new Set([
  'project.registerLegacy',
  'project.registerManaged',
  'project.createFromTemplate',
  'project.rebindLocation',
  'project.upgradeManaged',
])

const LIFECYCLE_OUTCOMES = new Set([
  'legacy_registered',
  'managed_registered',
  'managed_created',
  'location_rebound',
  'managed_upgraded',
])

const LIFECYCLE_ERROR_CODES: ReadonlySet<string> = new Set([
  'PROTOCOL_VERSION_UNSUPPORTED',
  'SCHEMA_INVALID',
  'CAPABILITY_NOT_NEGOTIATED',
  'REFERENCE_UNRESOLVED',
  'IDEMPOTENCY_CONFLICT',
  'REVISION_CONFLICT',
  'PATH_OUTSIDE_WORKSPACE',
  'CREDENTIAL_DATA_REJECTED',
  'QUARANTINED',
  'PROJECT_ALREADY_EXISTS',
  'LOCATION_CONFLICT',
  'MODE_CONFLICT',
  'MANIFEST_INVALID',
  'MANIFEST_HASH_MISMATCH',
  'WRITE_PLAN_STALE',
  'TARGET_NOT_EMPTY',
  'FILE_SYNC_FAILED',
])

function normalizeFileSync(value: unknown): Record<string, unknown> {
  const candidate = objectValue(value, 'fileSync')
  const status = boundedText(candidate.status, 'fileSync.status', 40)
  if (!['not_required', 'verified_existing', 'committed', 'planned', 'rolled_back', 'failed_recovery_required'].includes(status)) {
    throw new TypeError('lifecycle service returned an unsupported file sync status')
  }
  return {
    status,
    ...(candidate.planId === undefined ? {} : { planId: boundedText(candidate.planId, 'fileSync.planId', 80) }),
    ...(candidate.planHash === undefined ? {} : { planHash: boundedText(candidate.planHash, 'fileSync.planHash', 80) }),
    ...(candidate.manifestHash === undefined
      ? {}
      : { manifestHash: boundedText(candidate.manifestHash, 'fileSync.manifestHash', 80) }),
  }
}

function objectValue(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`lifecycle service returned an invalid ${field}`)
  }
  return value as Record<string, unknown>
}

function optionalRevision(value: unknown): number | undefined {
  return value === undefined ? undefined : requiredRevision(value, 'currentRevision', 0)
}

function requiredRevision(value: unknown, field: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new TypeError(`lifecycle service returned an invalid ${field}`)
  }
  return value as number
}

function normalizeStatus(value: ProjectControlStorageStatus): ProjectControlStorageStatus {
  if (!['ready', 'read_only_newer_schema', 'migration_failed', 'unavailable'].includes(value.state)) {
    throw new TypeError('storage returned an unsupported state')
  }
  if (value.schemaVersion !== null && (!Number.isSafeInteger(value.schemaVersion) || value.schemaVersion < 0)) {
    throw new TypeError('storage returned an invalid schema version')
  }
  if (typeof value.writable !== 'boolean') throw new TypeError('storage returned an invalid writable flag')
  if (value.projectCount !== null
    && (!Number.isSafeInteger(value.projectCount) || value.projectCount < 0)) {
    throw new TypeError('storage returned an invalid project count')
  }
  return {
    state: value.state,
    schemaVersion: value.schemaVersion,
    writable: value.writable,
    projectCount: value.projectCount,
  }
}

function normalizeProjectList(value: ProjectControlProjectList): ProjectControlProjectList {
  if (!Array.isArray(value.projects) || !Number.isSafeInteger(value.total) || value.total < value.projects.length) {
    throw new TypeError('storage returned an invalid project list')
  }
  const nextCursor = value.nextCursor
  if (nextCursor !== undefined && nextCursor !== null && !PROJECT_ID.test(nextCursor)) {
    throw new TypeError('storage returned an invalid project pagination cursor')
  }
  return {
    projects: value.projects.map(item => ({
      projectId: boundedText(item.projectId, 'projectId', 200),
      name: boundedText(item.name, 'name', 240),
      registrationMode: ['linked_legacy', 'managed'].includes(item.registrationMode)
        ? item.registrationMode
        : 'unknown',
      lifecycle: boundedText(item.lifecycle, 'lifecycle', 80),
      revision: requiredRevision(item.revision, 'revision', 1),
      archivedAt: item.archivedAt === null ? null : responseTimestamp(item.archivedAt, 'archivedAt'),
      updatedAt: boundedText(item.updatedAt, 'updatedAt', 80),
    })),
    total: value.total,
    nextCursor: nextCursor ?? null,
  }
}

function boundedText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > maxLength) {
    throw new TypeError(`storage returned an invalid ${field}`)
  }
  return value
}

function exposedError(error: unknown): {
  status: number
  code: string
  message: string
  headers?: Readonly<Record<string, string>>
} {
  const candidate = error as Partial<HttpError> | null
  if (candidate?.expose === true
    && typeof candidate.code === 'string'
    && typeof candidate.status === 'number'
    && candidate.status >= 400
    && candidate.status <= 599
    && error instanceof Error) {
    return {
      status: candidate.status,
      code: candidate.code,
      message: error.message,
      ...(candidate.headers === undefined ? {} : { headers: candidate.headers }),
    }
  }
  return {
    status: 500,
    code: 'INTERNAL_ERROR',
    message: '项目控制台服务请求失败。',
  }
}

function sendJson(
  response: ServerResponse,
  status: number,
  value: unknown,
  extraHeaders: Readonly<Record<string, string>> = {},
  maxBytes: number = MAX_BODY_BYTES,
): void {
  if (response.headersSent) return
  let payload = JSON.stringify(value)
  if (Buffer.byteLength(payload, 'utf8') > maxBytes) {
    status = 500
    payload = JSON.stringify({
      ok: false,
      error: {
        code: 'RESPONSE_TOO_LARGE',
        message: '项目控制台响应超过安全上限；请缩小扫描范围后重试。',
      },
    })
  }
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...extraHeaders,
  })
  response.end(payload)
}
