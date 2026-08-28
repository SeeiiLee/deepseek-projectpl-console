import { createElement } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { WorkbenchService } from '@cyrus/dsh-workbench/client'
import { CandidateDetails } from './CandidateDetails.tsx'
import { ProjectControlPlaceholder } from './ProjectControlPlaceholder.tsx'
import { isCandidateResourceKey } from './projectControlApi.ts'
import { createNativeWorkspaceHistoryBridge } from './nativeWorkspaceHistory.ts'
import { isProgressUpdateResourceKey, ProgressUpdateViewer } from './ProgressUpdateViewer.tsx'
import type {} from './contract.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    workbench: WorkbenchService
  }
}

export const inject = ['slots', 'workbench', 'sessions', 'workspaces']

/** Occupy Project Control and contribute one bounded candidate viewer to Workbench. */
export function apply(ctx: ClientContext): void {
  const nativeHistory = createNativeWorkspaceHistoryBridge({
    sessions: {
      list: ctx.sessions.list,
      open(id) { ctx.sessions.open(id as Parameters<typeof ctx.sessions.open>[0]) },
    },
    workspaces: {
      list: ctx.workspaces.list,
      create: input => ctx.workspaces.create(input),
      connectWorkspace: workspaceId => ctx.workspaces.connectWorkspace(
        workspaceId as Parameters<typeof ctx.workspaces.connectWorkspace>[0],
      ),
    },
  })
  ctx.effect(
    () => ctx.workbench.viewers.register({
      id: 'project-control.candidate-details',
      family: 'details',
      title: '项目候选',
      canRestore: descriptor => descriptor.family === 'details'
        && descriptor.viewerId === 'project-control.candidate-details'
        && isCandidateResourceKey(descriptor.resourceKey),
      render: descriptor => isCandidateResourceKey(descriptor.resourceKey)
        ? createElement(CandidateDetails, { candidateId: descriptor.resourceKey, nativeHistory })
        : createElement('p', null, '候选项目标识无效。'),
    }),
    'project-control: candidate details viewer',
  )
  ctx.effect(
    () => ctx.workbench.viewers.register({
      id: 'project-control.progress-update',
      family: 'artifact',
      title: '进展更新',
      canRestore: descriptor => descriptor.family === 'artifact'
        && descriptor.viewerId === 'project-control.progress-update'
        && isProgressUpdateResourceKey(descriptor.resourceKey),
      render: descriptor => isProgressUpdateResourceKey(descriptor.resourceKey)
        ? createElement(ProgressUpdateViewer, { descriptor })
        : createElement('p', null, '进展更新标识无效。'),
    }),
    'project-control: progress update viewer',
  )
  ctx.slots.inject('project.control', () => ctx.slots.register({
    name: 'project.control',
    inject: () => ({ workbench: ctx.workbench, nativeHistory }),
  }, ProjectControlPlaceholder))
}

export { CandidateDetails } from './CandidateDetails.tsx'
export { ProjectControlPlaceholder } from './ProjectControlPlaceholder.tsx'
export { ProgressUpdateViewer, isProgressUpdateResourceKey } from './ProgressUpdateViewer.tsx'
export { ProjectConsole, loadConsolePreferences, saveConsolePreferences } from './ProjectConsole.tsx'
export type { ProjectControlOwnerProps, ProjectControlPlaceholderProps } from './contract.ts'
export { createProjectControlApi } from './projectControlApi.ts'
export {
  assessNativeRebindPreflight,
  createNativeWorkspaceHistoryBridge,
  nativePathKey,
  projectNativeWorkspaceHistory,
  NativeWorkspaceHistoryError,
} from './nativeWorkspaceHistory.ts'
export type {
  NativeLegacySession,
  NativeLegacyWorkspace,
  NativeRebindPreflight,
  NativeWorkspaceHistoryBridge,
  NativeWorkspaceHistoryProjection,
  NativeWorkspaceHistorySnapshot,
  ProjectWorkspaceContinuity,
  ProjectWorkspaceContinuityLocation,
} from './nativeWorkspaceHistory.ts'
export type {
  CandidateDocument,
  CandidateIssue,
  CandidatePrepareInput,
  EvidenceLevel,
  IntakeCandidateList,
  IntakeJob,
  IntakeScanResult,
  IntakeSourceRoot,
  LifecycleCommandResult,
  PagedItems,
  ProjectCandidate,
  ProjectControlApi,
  ProjectControlStatus,
  ProjectDecision,
  ProjectDocumentIndex,
  ProjectDocumentParseIssue,
  ProjectDocumentRebindProposal,
  ProjectDocumentRole,
  ProjectDocumentState,
  ProjectEvent,
  ProjectList,
  ProjectListItem,
  ProjectListOptions,
  ProjectListView,
  ProjectProgressUpdate,
  ProjectQuarantineItem,
  ProjectReview,
  ProjectReviewAction,
  ProjectRun,
  ProjectSessionBinding,
  ProjectStorageState,
  ProjectWorkItem,
  RebindResolutionInput,
  RebindResolutionResult,
  WorkItemExecutionStatus,
  WorkItemReviewStatus,
} from './projectControlApi.ts'
