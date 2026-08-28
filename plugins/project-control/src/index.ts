import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  MigrationChecksumError,
  MigrationError,
  MigrationVersionError,
  StorageValidationError,
  UntrackedDatabaseError,
  openProjectControlStorage,
  type FileSyncPlanState,
  type ProjectControlStorage,
} from './host/index.js'
import {
  scanProjectDirectory,
  scanSourceDirectory,
} from './discovery/index.ts'
import {
  PROJECT_CONTROL_API_PREFIX,
  createProjectControlRequestHandler,
  projectControlHttpError,
  type ProjectControlConsoleService,
  type ProjectControlExternalService,
  type ProjectControlLifecycleService,
  type ProjectControlIntakeService,
  type ProjectControlProjectList,
  type ProjectControlReadService,
  type ProjectControlReferenceResolver,
  type ProjectControlStorageState,
  type ProjectWorkspaceContinuity,
} from './http.ts'
import { createProjectControlIntakeRuntime } from './intake.ts'
import {
  executeFileSyncPlan,
  FileSyncPlanError,
  recoverPlan,
  rollbackCreated,
  validateWritePlanDomain,
  verifyCommittedPlan,
} from './filesync/plan-executor.js'
import type { ProjectCreateResolution, ProjectUpgradeResolution } from './http.ts'
import { createOutboxDispatcher } from './outbox-dispatcher.js'

const OUTBOX_DRAIN_INTERVAL_MS = 5_000

interface WebServerLike {
  register(route: {
    kind: 'prefix'
    path: string
    handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
  }): () => void
}

interface HostContextLike {
  webServer: WebServerLike
  effect(
    factory: () => Promise<(() => void) | void> | (() => void) | void,
    label?: string,
  ): void
}

interface ProjectControlRuntime {
  read: ProjectControlReadService
  lifecycle?: ProjectControlLifecycleService
  intake?: ProjectControlIntakeService
  external?: ProjectControlExternalService
  console?: ProjectControlConsoleService
  outbox?: { drain(): Promise<{ delivered: readonly string[]; failed: readonly string[] }> }
  referenceResolver?: ProjectControlReferenceResolver
  close(): void
}

const MIGRATIONS_DIRECTORY = fileURLToPath(new URL('../migrations/', import.meta.url))

/** The Host route is independent from Personal Foundation and owns the Gate 2B database lifetime. */
export const inject = ['webServer']

export function apply(ctx: HostContextLike): void {
  ctx.effect(async () => {
    const runtime = await openRuntime()
    const handler = createProjectControlRequestHandler(runtime.read, {
      ...(runtime.lifecycle === undefined ? {} : { lifecycle: runtime.lifecycle }),
      ...(runtime.intake === undefined ? {} : { intake: runtime.intake }),
      ...(runtime.external === undefined ? {} : { external: runtime.external }),
      ...(runtime.console === undefined ? {} : { console: runtime.console }),
      ...(runtime.referenceResolver === undefined ? {} : { referenceResolver: runtime.referenceResolver }),
    })
    let unregister: (() => void) | undefined
    let drainTimer: ReturnType<typeof setInterval> | undefined
    try {
      unregister = ctx.webServer.register({
        kind: 'prefix',
        path: PROJECT_CONTROL_API_PREFIX,
        handler,
      })
      if (runtime.outbox !== undefined) {
        drainTimer = setInterval(() => {
          runtime.outbox?.drain().catch(() => {})
        }, OUTBOX_DRAIN_INTERVAL_MS)
        drainTimer.unref?.()
      }
    } catch (error) {
      runtime.close()
      throw error
    }
    return () => {
      if (drainTimer !== undefined) clearInterval(drainTimer)
      disposeProjectControlRegistration(unregister, () => runtime.close())
    }
  }, 'project control Gate 2B Host API')
}

/** Always release the single-writer storage lock, even if Host route disposal fails. */
export function disposeProjectControlRegistration(
  unregister: () => void,
  close: () => void,
): void {
  let unregisterFailed = false
  let unregisterError: unknown
  try {
    unregister()
  } catch (error) {
    unregisterFailed = true
    unregisterError = error
  } finally {
    try {
      close()
    } catch (closeError) {
      if (unregisterFailed) {
        throw new AggregateError(
          [unregisterError, closeError],
          'Project Control route and storage disposal both failed.',
        )
      }
      throw closeError
    }
  }
  if (unregisterFailed) throw unregisterError
}

async function openRuntime(): Promise<ProjectControlRuntime> {
  const configuredHome = process.env.PROJECT_CONTROL_HOME?.trim()
  if (configuredHome === undefined || configuredHome === '' || !isAbsolute(configuredHome)) {
    return degradedRuntime('unavailable')
  }

  let storage: Readonly<ProjectControlStorage>
  const applicationVersion = packageVersion()
  const applicationInstanceId = `project-control-host:${String(process.pid)}:${randomUUID()}`
  try {
    const projectControlHome = resolve(configuredHome)
    storage = await openProjectControlStorage({
      databasePath: join(projectControlHome, 'project-control.sqlite3'),
      backupDirectory: join(projectControlHome, 'backups'),
      migrationsDirectory: MIGRATIONS_DIRECTORY,
      applicationVersion,
      instanceId: applicationInstanceId,
    })
  } catch (error) {
    // 持久诊断：storage 打不开时不得静默降级（曾因静默导致数小时排查；'unavailable' 本身不带原因）。
    console.warn('[project-control] openRuntime storage open failed:', error instanceof Error ? error.stack : String(error))
    return degradedRuntime(storageFailureState(error))
  }

  await recoverPendingFileSyncPlans(storage)

  const selectionSecret = process.env.PROJECT_CONTROL_SELECTION_SECRET?.trim()
  const intakeRuntime = selectionSecret !== undefined && selectionSecret.length >= 32
    ? createProjectControlIntakeRuntime({
        storage,
        scanner: { scanProjectDirectory, scanSourceDirectory },
        selectionSecret,
        applicationInstanceId,
        applicationVersion,
      })
    : undefined

  return {
    read: storageReadAdapter(storage),
    lifecycle: storageLifecycleAdapter(storage),
    external: storageExternalAdapter(storage),
    console: storageConsoleAdapter(storage),
    outbox: createOutboxDispatcher({
      storage,
      logger: (line) => { console.warn(`[project-control outbox] ${line}`) },
    }),
    ...(intakeRuntime === undefined ? {} : intakeRuntime),
    close: () => { storage.close() },
  }
}

/** Startup recovery for journal-owned staging residue and pre-acceptance commits. */
export async function recoverPendingFileSyncPlans(storage: Readonly<ProjectControlStorage>): Promise<void> {
  const pending = storage.listFileSyncPlansForRecovery()
  for (const plan of pending) {
    try {
      const canonical = validateWritePlanDomain(plan)
      await recoverPlan({
        plan,
        canonical,
        targetRoot: plan.targetDisplayPath,
        stagingRoot: plan.stagingDisplayPath,
        journal: fileSyncJournal(storage, plan.planId),
      })
    } catch {
      // Unrecoverable plans remain quarantined for manual attention; the Host
      // still serves read-only state and never deletes unknown files.
    }
  }
}

function storageReadAdapter(storage: Readonly<ProjectControlStorage>): ProjectControlReadService {
  return {
    getStatus() {
      const status = storage.status()
      if (status.state !== 'ready') return degradedStatus('unavailable')
      return {
        state: 'ready',
        schemaVersion: status.schemaVersion,
        writable: true,
        projectCount: status.projectCount,
      }
    },
    listProjects(options: {
      view: 'active' | 'archived'
      search?: string
      limit?: number
      afterProjectId?: string
    } = { view: 'active' }): ProjectControlProjectList {
      const status = storage.status()
      if (status.state !== 'ready') {
        throw projectControlHttpError('STORAGE_UNAVAILABLE', '项目数据库暂不可用。', 503)
      }
      const page = storage.queryProjects({
        archiveState: options.view,
        ...(options.search === undefined ? {} : { search: options.search }),
        ...(options.limit === undefined ? {} : { limit: options.limit }),
        ...(options.afterProjectId === undefined ? {} : { afterProjectId: options.afterProjectId }),
      })
      return {
        projects: page.projects.map(project => ({
          projectId: project.projectId,
          name: project.name,
          registrationMode: project.mode,
          lifecycle: project.lifecycle,
          revision: project.revision,
          archivedAt: project.archivedAt,
          updatedAt: project.updatedAt,
        })),
        total: page.total,
        nextCursor: page.nextCursor,
      }
    },
    getProjectWorkspace(projectId: string): { projectId: string; root: string } | null {
      const project = storage.getProject(projectId)
      if (project === null) return null
      const location = project.activeLocation
        ?? project.workspaceLocations?.find(item => item.isActive)
      if (location === undefined || location === null) return null
      return { projectId: project.projectId, root: location.displayPath }
    },
    getProjectWorkspaceContinuity(projectId: string): ProjectWorkspaceContinuity | null {
      const project = storage.getProject(projectId)
      if (project === null) return null
      const locations = project.workspaceLocations ?? []
      const active = locations.filter(location => location.isActive)
      if (active.length !== 1 || active[0] === undefined) return null
      return {
        projectId: project.projectId,
        revision: project.revision,
        activeRoot: active[0].displayPath,
        locations: locations.map(location => ({
          locationId: location.locationId,
          root: location.displayPath,
          kind: location.kind,
          active: location.isActive,
          revision: location.revision,
          createdAt: location.createdAt,
          updatedAt: location.updatedAt,
        })),
      }
    },
    listProjectWorkspaces() {
      const status = storage.status()
      if (status.state !== 'ready') {
        throw projectControlHttpError('STORAGE_UNAVAILABLE', '项目数据库暂不可用。', 503)
      }
      const projects: { projectId: string; root: string; updatedAt: string }[] = []
      let afterProjectId: string | undefined
      do {
        const page = storage.queryProjects({
          archiveState: 'active',
          limit: 100,
          ...(afterProjectId === undefined ? {} : { afterProjectId }),
        })
        for (const project of page.projects) {
          const location = project.activeLocation
            ?? project.workspaceLocations?.find(item => item.isActive)
          if (location === undefined || location === null) continue
          projects.push({ projectId: project.projectId, root: location.displayPath, updatedAt: project.updatedAt })
        }
        afterProjectId = page.nextCursor ?? undefined
      } while (afterProjectId !== undefined)
      return projects
    },
  }
}

export function fileSyncJournal(
  storage: Readonly<ProjectControlStorage>,
  planId: string,
): { transition(from: FileSyncPlanState, to: FileSyncPlanState, options?: { createdPaths?: readonly string[]; errorCode?: string }): unknown } {
  return {
    transition(from, to, options = {}) {
      return storage.setFileSyncPlanState(planId, from, {
        state: to,
        createdPaths: options.createdPaths ?? [],
        ...(options.errorCode === undefined ? {} : { errorCode: options.errorCode }),
      })
    },
  }
}

export function storageLifecycleAdapter(
  storage: Readonly<ProjectControlStorage>,
): ProjectControlLifecycleService {
  return {
    replayCommandReceipt(command) {
      return storage.replayCommandReceipt(command)
    },
    recordRejectedCommand(command, result) {
      return storage.recordRejectedCommand(command, result)
    },
    registerProject(command, trusted) {
      return storage.registerProject(command, trusted)
    },
    rebindProject(command, trusted) {
      return storage.rebindProject(command, trusted)
    },
    async createProject(command, trusted: ProjectCreateResolution) {
      const plan = storage.getFileSyncPlan(trusted.plan.planId)
      if (plan === null) {
        throw new FileSyncPlanError('FILE_SYNC_FAILED', '写入计划已不存在。', { planId: trusted.plan.planId })
      }
      const canonical = validateWritePlanDomain(plan)
      const journal = fileSyncJournal(storage, plan.planId)
      const targetRoot = plan.targetDisplayPath
      if (plan.state === 'files_committed') {
        const verification = await verifyCommittedPlan({ plan, canonical, targetRoot })
        if (!verification.ok) {
          await recoverPlan({ plan, canonical, targetRoot, stagingRoot: plan.stagingDisplayPath, journal })
          throw new FileSyncPlanError('FILE_SYNC_FAILED', '已落盘文件复验失败，计划已进入隔离。', {
            verification,
          })
        }
      } else if (plan.state === 'planned' || plan.state === 'rolled_back') {
        await executeFileSyncPlan({
          plan,
          targetRoot,
          stagingRoot: plan.stagingDisplayPath,
          authorizedRoot: trusted.refs.sourceRoot.displayPath,
          contents: trusted.contents,
          journal,
        })
      } else {
        throw new FileSyncPlanError('FILE_SYNC_FAILED', '写入计划处于不可执行状态。', { state: plan.state })
      }
      const result = storage.registerCreatedProject(command, {
        planId: plan.planId,
        location: trusted.refs.location,
        manifestName: trusted.manifestName,
        manifestHash: trusted.manifestHash,
        manifestDocumentBindings: trusted.manifestDocumentBindings,
        origin: {
          kind: 'template',
          templateId: trusted.template.templateId,
          templateVersion: trusted.template.templateVersion,
        },
      })
      if (result.status === 'rejected') {
        // Files were committed but the domain transaction rejected: roll the
        // created files back and mark the plan rolled_back (protocol step 7).
        await rollbackCreated({
          plan,
          canonical,
          targetRoot,
          stagingRoot: plan.stagingDisplayPath,
          createdPaths: plan.createdPaths,
          removeTargetRoot: !plan.rootPreexistedEmpty,
        })
        try {
          storage.setFileSyncPlanState(plan.planId, 'files_committed', {
            state: 'rolled_back',
            createdPaths: [],
            errorCode: result.error?.code,
          })
        } catch {}
      }
      return result
    },
    async upgradeProject(command, trusted: ProjectUpgradeResolution) {
      const plan = storage.getFileSyncPlan(trusted.plan.planId)
      if (plan === null) {
        throw new FileSyncPlanError('FILE_SYNC_FAILED', '写入计划已不存在。', { planId: trusted.plan.planId })
      }
      const canonical = validateWritePlanDomain(plan)
      const journal = fileSyncJournal(storage, plan.planId)
      const targetRoot = plan.targetDisplayPath
      if (plan.state === 'files_committed') {
        const verification = await verifyCommittedPlan({ plan, canonical, targetRoot })
        if (!verification.ok) {
          await recoverPlan({ plan, canonical, targetRoot, stagingRoot: plan.stagingDisplayPath, journal })
          throw new FileSyncPlanError('FILE_SYNC_FAILED', '已落盘 manifest 复验失败，计划已进入隔离。', {
            verification,
          })
        }
      } else if (plan.state === 'planned' || plan.state === 'rolled_back') {
        await executeFileSyncPlan({
          plan,
          targetRoot,
          stagingRoot: plan.stagingDisplayPath,
          // The upgrade staging directory lives inside the project root; the
          // root itself is the authorized containment boundary.
          authorizedRoot: targetRoot,
          contents: trusted.contents,
          journal,
        })
      } else {
        throw new FileSyncPlanError('FILE_SYNC_FAILED', '写入计划处于不可执行状态。', { state: plan.state })
      }
      const result = storage.registerUpgradeManaged(command, {
        planId: plan.planId,
        location: trusted.refs.location,
        manifestName: trusted.manifestName,
        manifestHash: trusted.manifestHash,
      })
      if (result.status === 'rejected') {
        await rollbackCreated({
          plan,
          canonical,
          targetRoot,
          stagingRoot: plan.stagingDisplayPath,
          createdPaths: plan.createdPaths,
          removeTargetRoot: false,
        })
        try {
          storage.setFileSyncPlanState(plan.planId, 'files_committed', {
            state: 'rolled_back',
            createdPaths: [],
            errorCode: result.error?.code,
          })
        } catch {}
      }
      return result
    },
  }
}

/** P7 console commands issued by the trusted local desktop UI. */
export function storageConsoleAdapter(
  storage: Readonly<ProjectControlStorage>,
): ProjectControlConsoleService {
  return {
    setProjectArchived(projectId, input) {
      try {
        const project = storage.setProjectArchived(projectId, input)
        return {
          projectId: project.projectId,
          name: project.name,
          registrationMode: project.mode,
          lifecycle: project.lifecycle,
          revision: project.revision,
          archivedAt: project.archivedAt,
          updatedAt: project.updatedAt,
        }
      } catch (error) {
        if (error instanceof StorageValidationError) {
          const reason = (error.details as { reason?: unknown } | undefined)?.reason
          if (reason === 'project_not_found') {
            throw projectControlHttpError('NOT_FOUND', '项目不存在。', 404)
          }
          if (reason === 'revision_conflict') {
            throw projectControlHttpError('REVISION_CONFLICT', '项目已发生变化，请刷新后重试。', 409)
          }
          if (reason === 'transition_not_allowed') {
            throw projectControlHttpError('PROJECT_LIFECYCLE_CONFLICT', '项目归档状态已发生变化，请刷新后重试。', 409)
          }
        }
        throw error
      }
    },
    createWorkItem(projectId, input) {
      return storage.createWorkItem(projectId, {
        title: String(input.title),
        ...(input.instruction === undefined ? {} : { instruction: String(input.instruction) }),
        ...(input.acceptance === undefined ? {} : { acceptance: input.acceptance as readonly string[] }),
        ...(input.executionStatus === undefined
          ? {}
          : { executionStatus: String(input.executionStatus) as 'draft' | 'ready' | 'running' | 'paused' | 'blocked' | 'completed' | 'cancelled' }),
        ...(input.reviewStatus === undefined
          ? {}
          : { reviewStatus: String(input.reviewStatus) as 'not_requested' | 'pending' | 'changes_requested' | 'approved' | 'rejected' }),
        ...(input.priority === undefined ? {} : { priority: Number(input.priority) }),
      })
    },
    setWorkItemStatus(projectId, workItemId, input) {
      return storage.setWorkItemStatus(projectId, workItemId, {
        expectedRevision: Number(input.expectedRevision),
        status: String(input.status),
      })
    },
    startRun(projectId, runId, input) {
      return storage.startRun(projectId, runId, {
        expectedRevision: Number(input.expectedRevision),
      })
    },
    requestReview(projectId, workItemId, input) {
      return storage.requestReview(projectId, workItemId, {
        expectedRevision: Number(input.expectedRevision),
        ...(input.risk === undefined ? {} : { risk: String(input.risk) as 'unrated' | 'low' | 'medium' | 'high' }),
      })
    },
    decideReview(projectId, reviewId, input) {
      return storage.decideReview(projectId, reviewId, {
        expectedRevision: Number(input.expectedRevision),
        decision: String(input.decision) as 'approve' | 'reject' | 'request_changes',
        ...(input.rationale === undefined ? {} : { rationale: String(input.rationale) }),
      })
    },
    commentReview(projectId, reviewId, input) {
      return storage.commentReview(projectId, reviewId, { comment: String(input.comment) })
    },
  }
}

/** Gate 2E: handshake + external runtime updates + P6 projections, straight onto storage. */
export function storageExternalAdapter(
  storage: Readonly<ProjectControlStorage>,
): ProjectControlExternalService {
  return {
    handshake(input) {
      return storage.handshakeHostInstance({
        instanceId: input.instanceId,
        appVersion: input.appVersion,
        protocolVersions: [...input.protocolVersions],
        capabilities: [...input.capabilities],
      })
    },
    submitExternalUpdate(command) {
      return storage.applyExternalUpdate(command as Parameters<ProjectControlStorage['applyExternalUpdate']>[0])
    },
    listWorkItems(projectId) {
      return storage.listWorkItems({ projectId, limit: 500 })
    },
    listRuns(projectId, workItemId) {
      return storage.listRuns({
        projectId,
        ...(workItemId === undefined ? {} : { workItemId }),
        limit: 500,
      })
    },
    listProgressUpdates(projectId) {
      return storage.listProgressUpdates({ projectId, limit: 500 })
    },
    listReviews(projectId) {
      return storage.listReviews({ projectId, limit: 500 })
    },
    listDecisions(projectId) {
      return storage.listDecisions({ projectId, limit: 500 })
    },
    listQuarantineItems() {
      return storage.listQuarantineItems({ limit: 500 })
    },
    resolveQuarantineItem(quarantineId, input) {
      return storage.resolveQuarantineItem(quarantineId, {
        expectedRevision: input.expectedRevision,
        decision: input.decision,
      })
    },
    listEvents(projectId, afterSequence) {
      return storage.listEvents({
        projectId,
        ...(afterSequence === undefined ? {} : { afterSequence }),
        limit: 500,
      })
    },
    listReviewActions(reviewId) {
      return storage.listReviewActions(reviewId, { limit: 500 })
    },
    listSessions(projectId) {
      return storage.listThreadBindings({ projectId, limit: 500 })
    },
  }
}

function degradedRuntime(state: ProjectControlStorageState): ProjectControlRuntime {
  return {
    read: {
      getStatus: () => degradedStatus(state),
      listProjects() {
        throw projectControlHttpError('STORAGE_UNAVAILABLE', '项目数据库暂不可用。', 503)
      },
      getProjectWorkspace() {
        throw projectControlHttpError('STORAGE_UNAVAILABLE', '项目数据库暂不可用。', 503)
      },
      getProjectWorkspaceContinuity() {
        throw projectControlHttpError('STORAGE_UNAVAILABLE', '项目数据库暂不可用。', 503)
      },
      listProjectWorkspaces() {
        throw projectControlHttpError('STORAGE_UNAVAILABLE', '项目数据库暂不可用。', 503)
      },
    },
    close() {},
  }
}

function degradedStatus(state: ProjectControlStorageState) {
  return {
    state,
    schemaVersion: null,
    writable: false,
    projectCount: null,
  } as const
}

function storageFailureState(error: unknown): ProjectControlStorageState {
  if (error instanceof MigrationVersionError) return 'read_only_newer_schema'
  if (error instanceof MigrationChecksumError
    || error instanceof MigrationError
    || error instanceof UntrackedDatabaseError) return 'migration_failed'
  return 'unavailable'
}

function packageVersion(): string {
  try {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      version?: unknown
    }
    if (typeof manifest.version === 'string' && manifest.version.trim() !== '') return manifest.version
  } catch {}
  return '0.1.0-rc.5'
}

export {
  createProjectControlRequestHandler,
  PROJECT_CONTROL_API_PREFIX,
} from './http.ts'
export { validateLifecycleCommand, validateLifecycleResult } from './lifecycle-validator.ts'
export { validateProjectManifest } from './manifest-validator.ts'
