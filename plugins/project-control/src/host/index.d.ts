export interface LifecycleActor {
  kind: 'human' | 'agent' | 'system' | 'application'
  id: string
  applicationId: string
  displayName?: string
}

export interface LifecycleCommand {
  protocolVersion: string
  schemaVersion: string
  commandId: string
  correlationId: string
  idempotencyKey: string
  kind: string
  occurredAt: string
  actor: LifecycleActor
  target: { aggregateType: 'project'; projectId: string }
  expectedRevision: number
  provenance: Record<string, unknown>
  payload: Record<string, any>
  extensions?: Record<string, unknown>
}

export interface WorkspaceLocationResolution {
  locationId: string
  kind?: 'primary' | 'mirror' | 'archive'
  displayPath: string
  normalizedPath: string
  verifiedAt?: string
}

export interface ProjectView {
  projectId: string
  mode: 'linked_legacy' | 'managed'
  name: string
  originKind: 'imported' | 'template' | 'fork'
  templateId: string | null
  templateVersion: string | null
  forkedFromProjectId: string | null
  lifecycle: 'active' | 'paused' | 'archived' | 'needs_attention'
  health: 'unknown' | 'healthy' | 'at_risk' | 'blocked' | 'needs_attention'
  revision: number
  createdAt: string
  updatedAt: string
  archivedAt: string | null
  workspaceLocations?: WorkspaceLocationView[]
  activeLocation?: Pick<WorkspaceLocationView, 'locationId' | 'displayPath' | 'normalizedPath'> | null
  documentBindings?: ProjectDocumentBindingView[]
  manifestMirror?: ProjectManifestMirrorView | null
}

export interface ProjectDocumentBindingInput {
  role: 'readme' | 'prd' | 'devlog' | 'progress' | 'next' | 'current_architecture' | 'decision' | 'other'
  relativePath: string
  contentHash?: string | null
  required?: boolean
}

export interface ProjectDocumentBindingView extends ProjectDocumentBindingInput {
  contentHash: string | null
  required: boolean
  source: 'user_confirmed' | 'manifest'
  confirmedAt: string
  revision: number
}

export interface ProjectManifestMirrorView {
  protocolVersion: string
  manifestHash: string
  name: string
  origin: Record<string, unknown>
  documentBindings: Array<ProjectDocumentBindingInput & {
    contentHash: string | null
    required: boolean
    source: 'manifest'
  }>
  verifiedAt: string
  revision: number
}

export interface WorkspaceLocationView extends WorkspaceLocationResolution {
  projectId: string
  kind: 'primary' | 'mirror' | 'archive'
  isActive: boolean
  verifiedAt: string
  revision: number
  createdAt: string
  updatedAt: string
}

export interface StorageStatus {
  state: 'ready' | 'closed'
  databasePath: string
  lockPath: string
  instanceId: string
  openedAt: string
  schemaVersion: number
  migrationsAppliedThisOpen: number
  migrationBackupPath: string | null
  journalMode: 'wal'
  foreignKeys: true
  singleWriter: true
  projectCount: number
  archivedProjectCount: number
}

export interface LifecycleSuccessResult {
  protocolVersion: string
  schemaVersion: 'lifecycle-command-result/v1alpha1'
  commandId: string
  correlationId: string
  kind: string
  status: 'accepted' | 'replayed'
  recordedAt: string
  projectId: string
  projectMode: 'linked_legacy' | 'managed'
  aggregateRevision: number
  eventId: string
  outcome: 'legacy_registered' | 'managed_registered' | 'location_rebound'
  fileSync: Record<string, unknown>
}

export interface LifecycleRejectedResult {
  protocolVersion: string
  schemaVersion: 'lifecycle-command-result/v1alpha1'
  commandId: string
  correlationId: string
  kind: string
  status: 'rejected'
  recordedAt: string
  currentRevision?: number
  error: { code: string; message?: string }
  fileSync?: Record<string, unknown>
}

export type IntakeMode = 'source_root' | 'single_project'
export type FileSyncPlanKind = 'create_from_template' | 'upgrade_managed'
export type FileSyncPlanState =
  | 'planned'
  | 'staging'
  | 'staged'
  | 'files_committed'
  | 'accepted'
  | 'rolled_back'
  | 'recovery_required'
export type FileSyncOperation =
  | { kind: 'create_directory'; relativePath: string; expectedState: 'absent'; contentHash?: null }
  | { kind: 'create_file'; relativePath: string; expectedState: 'absent'; contentHash: string }

export interface FileSyncPlanInput {
  planId: string
  commandId: string
  kind: FileSyncPlanKind
  projectId: string
  syncPolicy: 'atomic_create' | 'atomic_additive'
  targetDisplayPath: string
  targetNormalizedPath?: string
  stagingDisplayPath: string
  planHash: string
  manifestHash: string
  operations: readonly FileSyncOperation[]
  rootPreexistedEmpty?: boolean
  renderParams?: Record<string, unknown> | null
}

export interface FileSyncPlanView {
  planId: string
  commandId: string
  kind: FileSyncPlanKind
  projectId: string
  syncPolicy: 'atomic_create' | 'atomic_additive'
  targetDisplayPath: string
  targetNormalizedPath: string
  stagingDisplayPath: string
  planHash: string
  manifestHash: string
  state: FileSyncPlanState
  operations: readonly FileSyncOperation[]
  createdPaths: readonly string[]
  renderParams: Record<string, unknown> | null
  rootPreexistedEmpty: boolean
  errorCode: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export type ImportJobStatus = 'completed' | 'failed' | 'cancelled'
export type ImportCandidateDiscoveryStatus = 'discovered' | 'conflict' | 'relocation_candidate'
export type ImportCandidateStatus = ImportCandidateDiscoveryStatus | 'ignored' | 'imported'
export type ImportIssueSeverity = 'info' | 'warning' | 'error' | 'blocking'
export type ProjectDocumentRole =
  | 'readme'
  | 'prd'
  | 'devlog'
  | 'progress'
  | 'next'
  | 'current_architecture'
  | 'decision'
  | 'other'

export interface IntakeWorkspacePathInput {
  displayPath: string
  normalizedPath?: string
}

export interface ProjectSourceRootInput extends IntakeWorkspacePathInput {
  scanPreferences?: Record<string, unknown>
  isEnabled?: boolean
}

export interface ImportCandidateDocumentInput {
  relativePath: string
  suggestedRole?: ProjectDocumentRole | null
  sha256?: string | null
  title?: string | null
  /** A bounded excerpt (at most 1000 characters); full file content is never persisted. */
  preview?: string | null
  observedAt?: string
  evidence?: Record<string, unknown>
}

export interface ImportIssueInput {
  code: string
  severity?: ImportIssueSeverity
  message?: string
  details?: Record<string, unknown>
  status?: 'open' | 'resolved'
  resolvedAt?: string | null
}

export interface ImportCandidateInput {
  root: IntakeWorkspacePathInput
  detectedMode?: 'unknown' | 'linked_legacy' | 'managed'
  manifestProjectId?: string | null
  suggestedName?: string | null
  suggestedSummary?: string | null
  summarySource?: string | null
  confidence?: Record<string, unknown>
  status?: ImportCandidateDiscoveryStatus
  documents: ImportCandidateDocumentInput[]
  issues: ImportIssueInput[]
}

export interface RecordImportScanInput {
  mode: IntakeMode
  /** The actual root inspected by this scan. */
  rootPath: IntakeWorkspacePathInput
  /** Null is supported for single-project import and creates a persistent single_project source root. */
  sourceRoot: ProjectSourceRootInput | null
  scanPreferences?: Record<string, unknown>
  scannerVersion: string
  status?: ImportJobStatus
  startedAt?: string
  completedAt?: string
  summary?: Record<string, unknown>
  /** Source-root or scan-level failures that are not attributable to one candidate. */
  issues?: ImportIssueInput[]
  candidates: ImportCandidateInput[]
}

export interface ProjectSourceRootView {
  sourceRootId: string
  kind: IntakeMode
  displayPath: string
  normalizedPath: string
  scanPreferences: Record<string, unknown>
  isEnabled: boolean
  revision: number
  createdAt: string
  updatedAt: string
}

export interface ImportJobView {
  importJobId: string
  sourceRootId: string
  rootPathSnapshot: string
  rootNormalizedPathSnapshot: string
  scanPreferencesSnapshot: Record<string, unknown>
  mode: IntakeMode
  status: ImportJobStatus
  scannerVersion: string
  startedAt: string
  completedAt: string
  summary: Record<string, unknown>
  issues: ImportJobIssueView[]
}

export interface ImportJobIssueView {
  importJobIssueId: string
  importJobId: string
  code: string
  severity: ImportIssueSeverity
  message: string | null
  details: Record<string, unknown>
  status: 'open' | 'resolved'
  resolvedAt: string | null
}

export interface ImportCandidateDocumentView {
  candidateDocumentId: string
  candidateId: string
  relativePath: string
  suggestedRole: ProjectDocumentRole | null
  sha256: string | null
  title: string | null
  preview: string | null
  observedAt: string
  evidence: Record<string, unknown>
}

export interface ImportIssueView {
  importIssueId: string
  candidateId: string
  code: string
  severity: ImportIssueSeverity
  message: string | null
  details: Record<string, unknown>
  status: 'open' | 'resolved'
  resolvedAt: string | null
}

export interface ImportCandidateView {
  candidateId: string
  importJobId: string
  sourceRootId: string
  root: { displayPath: string; normalizedPath: string }
  detectedMode: 'unknown' | 'linked_legacy' | 'managed'
  manifestProjectId: string | null
  suggestedName: string | null
  suggestedSummary: string | null
  summarySource: string | null
  confidence: Record<string, unknown>
  status: ImportCandidateStatus
  statusBeforeIgnored: ImportCandidateDiscoveryStatus | null
  matchedProjectId: string | null
  revision: number
  createdAt: string
  updatedAt: string
  documents: ImportCandidateDocumentView[]
  issues: ImportIssueView[]
}

export interface ImportScanView {
  sourceRoot: Readonly<ProjectSourceRootView>
  job: Readonly<ImportJobView>
  issues: Readonly<ImportJobIssueView>[]
  candidates: Readonly<ImportCandidateView>[]
}

export interface IntakeReferenceContext {
  applicationInstanceId: string
  scope: 'project-control.lifecycle'
}

export interface IssuedImportCandidateRefs {
  candidateRef: string
  locationRef: string
  sourceRootRef: string
  scope: 'project-control.lifecycle'
  expiresAt: string
}

export interface ResolvedLocationRef extends WorkspaceLocationResolution {
  candidateId: string
  sourceRootId: string
  kind: 'primary'
  expiresAt: string
}

export interface ResolvedSourceRootRef {
  candidateId: string
  sourceRootId: string
  sourceRootRef: string
  displayPath: string
  normalizedPath: string
  verifiedAt: string
  expiresAt: string
}

export interface ResolvedRegistrationRefs {
  candidateId: string
  sourceRoot: Omit<ResolvedSourceRootRef, 'candidateId' | 'expiresAt'>
  location: WorkspaceLocationResolution & { kind: 'primary' }
  expiresAt: string
}

export interface ProjectRegistrationTrustedBase {
  manifestName?: string
  /** Required for registerManaged; must equal the hash verified by the Host resolver. */
  manifestHash?: string
  /** Required for registerManaged; entries come from the verified manifest, never command payload. */
  manifestDocumentBindings?: ProjectDocumentBindingInput[]
  origin?: {
    kind: 'imported' | 'template' | 'fork'
    templateId?: string
    templateVersion?: string
    forkedFromProjectId?: string
  }
  location: WorkspaceLocationResolution
  eventId?: string
  outboxId?: string
}

export type ProjectRegistrationTrusted = ProjectRegistrationTrustedBase & (
  | {
      /** Gate 2C candidate transition is atomic with accepted registration. */
      candidateId: string
      candidateRevision: number
    }
  | { candidateId?: never; candidateRevision?: never }
)

export interface ProjectRebindTrustedBase {
  newLocation: WorkspaceLocationResolution
  eventId?: string
  outboxId?: string
  historyId?: string
}

export type ProjectRebindTrusted = ProjectRebindTrustedBase & (
  | {
      /** A relocation candidate is imported atomically with an accepted rebind. */
      candidateId: string
      candidateRevision: number
    }
  | { candidateId?: never; candidateRevision?: never }
)

export interface IssuedFileSyncPlanRefs {
  planId: string
  locationRef: string | null
  sourceRootRef: string
  scope: 'project-control.lifecycle'
  expiresAt: string
}

export interface ResolvedUpgradePlanRefs {
  planId: string
  location: WorkspaceLocationResolution & { kind: 'primary'; revision: number }
  sourceRoot: {
    sourceRootId: string
    displayPath: string
    normalizedPath: string
    expiresAt: string
  }
}

export interface ProjectUpgradeTrusted {
  planId: string
  location: WorkspaceLocationResolution
  manifestName: string
  manifestHash: string
  eventId?: string
  outboxId?: string
}

export interface DocumentParseIssueView {
  code: string
  severity: ImportIssueSeverity
  message: string
  line: number | null
}

export interface ProjectDocumentStateView {
  role: ProjectDocumentRole
  relativePath: string
  bindingSource: 'user_confirmed' | 'manifest'
  state: 'ok' | 'changed' | 'missing' | 'unreadable'
  contentHash: string | null
  byteSize: number | null
  parseIssues: readonly DocumentParseIssueView[]
  revision: number
  firstSeenAt: string
  lastVerifiedAt: string
}

export interface ProjectDocumentRebindProposalView {
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
  /** True when the current project mode may apply this proposal without a manifest update. */
  applicable: boolean
}

export interface ProjectDocumentIndexView {
  projectId: string
  mode: 'linked_legacy' | 'managed'
  name: string
  revision: number
  locationDisplayPath: string | null
  documents: readonly ProjectDocumentStateView[]
  proposals: readonly ProjectDocumentRebindProposalView[]
}

export interface RecordDocumentIndexInput {
  projectId: string
  documentStates: readonly {
    role: ProjectDocumentRole
    relativePath: string
    bindingSource: 'user_confirmed' | 'manifest'
    state: 'ok' | 'changed' | 'missing' | 'unreadable'
    contentHash: string | null
    byteSize: number | null
    parseIssues: readonly DocumentParseIssueView[]
  }[]
  rebindProposals: readonly {
    role: ProjectDocumentRole
    missingRelativePath: string
    contentHash: string
    candidateRelativePaths: readonly string[]
  }[]
}

export interface ResolvedFileSyncPlanRefs {
  planId: string
  location: WorkspaceLocationResolution & { kind: 'primary'; expiresAt: string }
  sourceRoot: {
    sourceRootId: string
    displayPath: string
    normalizedPath: string
    expiresAt: string
  }
}

export interface ProjectCreateTrusted {
  planId: string
  location: WorkspaceLocationResolution
  manifestName: string
  manifestHash: string
  manifestDocumentBindings: ProjectDocumentBindingInput[]
  origin?: { kind: 'template'; templateId: string; templateVersion: string }
  eventId?: string
  outboxId?: string
}

export interface ProjectControlStorage {
  status(): Readonly<StorageStatus>
  recordImportScan(input: RecordImportScanInput): Readonly<ImportScanView>
  getSourceRoot(sourceRootId: string): Readonly<ProjectSourceRootView> | null
  listSourceRoots(options?: {
    isEnabled?: boolean | null
    limit?: number
    afterSourceRootId?: string
  }): Readonly<ProjectSourceRootView>[]
  getImportJob(importJobId: string): Readonly<ImportJobView> | null
  listImportJobs(options?: {
    sourceRootId?: string | null
    status?: ImportJobStatus | null
    limit?: number
    afterImportJobId?: string
  }): Readonly<ImportJobView>[]
  getImportCandidate(candidateId: string): Readonly<ImportCandidateView> | null
  listImportCandidates(options?: {
    sourceRootId?: string | null
    importJobId?: string | null
    status?: ImportCandidateStatus | null
    /** When true, historical scans collapse to the newest row for each normalized project path. */
    latestPerPath?: boolean
    limit?: number
    afterCandidateId?: string
  }): Readonly<ImportCandidateView>[]
  setImportCandidateIgnored(
    candidateId: string,
    ignored: boolean,
    expectedRevision: number,
  ): Readonly<ImportCandidateView>
  setImportCandidateStatus(
    candidateId: string,
    status: ImportCandidateDiscoveryStatus,
    expectedRevision: number,
  ): Readonly<ImportCandidateView>
  issueImportCandidateRefs(
    candidateId: string,
    options: IntakeReferenceContext & { expectedRevision: number; ttlSeconds?: number },
  ): Readonly<IssuedImportCandidateRefs>
  resolveLocationRef(
    locationRef: string,
    context: IntakeReferenceContext,
  ): Readonly<ResolvedLocationRef>
  resolveSourceRootRef(
    sourceRootRef: string,
    context: IntakeReferenceContext,
  ): Readonly<ResolvedSourceRootRef>
  resolveRegistrationRefs(
    candidateId: string,
    refs: { locationRef: string; sourceRootRef: string },
    context: IntakeReferenceContext,
  ): Readonly<ResolvedRegistrationRefs>
  getProject(projectId: string): Readonly<ProjectView> | null
  listProjects(options?: {
    includeArchived?: boolean
    limit?: number
    afterProjectId?: string
  }): Readonly<ProjectView>[]
  getCommandReceipt(commandId: string): Readonly<Record<string, unknown>> | null
  replayCommandReceipt(
    command: LifecycleCommand,
  ): Readonly<LifecycleRejectedResult | LifecycleSuccessResult> | null
  listEvents(options?: {
    afterSequence?: number
    projectId?: string | null
    limit?: number
  }): Readonly<Record<string, unknown>>[]
  listOutbox(options?: {
    status?: 'pending' | 'dispatching' | 'delivered' | 'failed' | null
    limit?: number
  }): Readonly<Record<string, unknown>>[]
  transitionOutboxMessage(
    outboxId: string,
    expectedStatus: 'pending' | 'dispatching',
    next: {
      status: 'pending' | 'dispatching' | 'delivered' | 'failed'
      attemptCount: number
      nextAttemptAt?: string | null
      deliveredAt?: string | null
      lastError?: string | null
    },
  ): Readonly<Record<string, unknown>> | null
  recordRejectedCommand(
    command: LifecycleCommand,
    rejectedResult: LifecycleRejectedResult,
  ): Readonly<LifecycleRejectedResult | LifecycleSuccessResult>
  registerProject(
    command: LifecycleCommand,
    trusted: ProjectRegistrationTrusted,
  ): Readonly<LifecycleSuccessResult | LifecycleRejectedResult>
  rebindProject(
    command: LifecycleCommand,
    trusted: ProjectRebindTrusted,
  ): Readonly<LifecycleSuccessResult | LifecycleRejectedResult>
  registerCreatedProject(
    command: LifecycleCommand,
    trusted: ProjectCreateTrusted,
  ): Readonly<LifecycleSuccessResult | LifecycleRejectedResult>
  registerUpgradeManaged(
    command: LifecycleCommand,
    trusted: ProjectUpgradeTrusted,
  ): Readonly<LifecycleSuccessResult | LifecycleRejectedResult>
  resolveUpgradePlanRefs(
    planId: string,
    refs: { locationRef: string },
    context: IntakeReferenceContext,
  ): Readonly<ResolvedUpgradePlanRefs>
  issueFileSyncPlanRefs(
    planId: string,
    options: IntakeReferenceContext & {
      targetDisplayPath: string
      targetNormalizedPath?: string
      locationDisplayPath?: string
      locationNormalizedPath?: string
      parentDisplayPath: string
      parentNormalizedPath?: string
      ttlSeconds?: number
    },
  ): Readonly<IssuedFileSyncPlanRefs>
  resolveFileSyncPlanRefs(
    planId: string,
    refs: { locationRef: string; sourceRootRef: string },
    context: IntakeReferenceContext,
  ): Readonly<ResolvedFileSyncPlanRefs>
  createFileSyncPlan(input: FileSyncPlanInput): Readonly<FileSyncPlanView>
  getFileSyncPlan(planId: string): Readonly<FileSyncPlanView> | null
  listFileSyncPlansForRecovery(): Readonly<FileSyncPlanView>[]
  setFileSyncPlanState(
    planId: string,
    expectedState: FileSyncPlanState,
    updates: {
      state: FileSyncPlanState
      createdPaths?: readonly string[]
      errorCode?: string
    },
  ): Readonly<FileSyncPlanView>
  handshakeHostInstance(input: {
    instanceId: string
    appVersion: string
    protocolVersions: readonly string[]
    capabilities: readonly string[]
  }): Readonly<Record<string, unknown>>
  createWorkItem(
    projectId: string,
    input: {
      title: string
      instruction?: string | null
      acceptance?: readonly string[]
      executionStatus?: 'draft' | 'ready' | 'running' | 'paused' | 'blocked' | 'completed' | 'cancelled'
      reviewStatus?: 'not_requested' | 'pending' | 'changes_requested' | 'approved' | 'rejected'
      priority?: number
    },
  ): Readonly<Record<string, unknown>>
  createRun(
    projectId: string,
    workItemId: string,
    input?: {
      attemptNo?: number
      instructionSnapshot?: string
      acceptanceSnapshot?: unknown
    },
  ): Readonly<Record<string, unknown>>
  bindAgentThread(
    projectId: string,
    runId: string,
    input: { harnessInstanceRef: string; sessionId: string; threadId: string },
  ): Readonly<Record<string, unknown>>
  listThreadBindings(options?: {
    projectId?: string | null
    limit?: number
    afterBindingId?: string
  }): Readonly<Record<string, unknown>>[]
  applyExternalUpdate(command: LifecycleCommand): Readonly<Record<string, unknown>>
  getWorkItem(workItemId: string): Readonly<Record<string, unknown>> | null
  listWorkItems(options?: {
    projectId?: string | null
    limit?: number
    afterWorkItemId?: string
  }): Readonly<Record<string, unknown>>[]
  getRun(runId: string): Readonly<Record<string, unknown>> | null
  listRuns(options?: {
    projectId?: string | null
    workItemId?: string | null
    limit?: number
    afterRunId?: string
  }): Readonly<Record<string, unknown>>[]
  listProgressUpdates(options?: {
    projectId?: string | null
    workItemId?: string | null
    runId?: string | null
    limit?: number
    afterProgressUpdateId?: string
  }): Readonly<Record<string, unknown>>[]
  getProgressUpdateByCommandId(commandId: string): Readonly<Record<string, unknown>> | null
  recordQuarantineItem(input: {
    projectId?: string | null
    sourceKind: string
    sourceRef: string
    reasonCode: string
    payloadRef?: string | null
    details?: Record<string, unknown>
  }): Readonly<Record<string, unknown>>
  listQuarantineItems(options?: {
    projectId?: string | null
    status?: 'open' | 'resolved' | 'ignored' | null
    limit?: number
    afterQuarantineId?: string
  }): Readonly<Record<string, unknown>>[]
  resolveQuarantineItem(
    quarantineId: string,
    options: { expectedRevision: number; decision: 'resolved' | 'ignored' },
  ): Readonly<Record<string, unknown>>
  listReviews(options?: { projectId?: string | null; limit?: number }): Readonly<Record<string, unknown>>[]
  listDecisions(options?: { projectId?: string | null; limit?: number }): Readonly<Record<string, unknown>>[]
  getReview(reviewId: string): Readonly<Record<string, unknown>> | null
  listReviewActions(reviewId: string, options?: {
    afterReviewActionId?: string
    limit?: number
  }): Readonly<Record<string, unknown>>[]
  setWorkItemStatus(
    projectId: string,
    workItemId: string,
    input: { expectedRevision: number; status: string },
  ): Readonly<Record<string, unknown>>
  startRun(
    projectId: string,
    runId: string,
    input: { expectedRevision: number },
  ): Readonly<Record<string, unknown>>
  requestReview(
    projectId: string,
    workItemId: string,
    input: { expectedRevision: number; risk?: 'unrated' | 'low' | 'medium' | 'high' | null },
  ): Readonly<Record<string, unknown>>
  decideReview(
    projectId: string,
    reviewId: string,
    input: {
      expectedRevision: number
      decision: 'approve' | 'reject' | 'request_changes'
      rationale?: string | null
    },
  ): Readonly<Record<string, unknown>>
  commentReview(
    projectId: string,
    reviewId: string,
    input: { comment: string },
  ): Readonly<Record<string, unknown>>
  recordDocumentIndex(input: RecordDocumentIndexInput): Readonly<ProjectDocumentIndexView>
  getProjectDocumentIndex(projectId: string): Readonly<ProjectDocumentIndexView>
  resolveDocumentRebindProposal(
    projectId: string,
    proposalId: string,
    options: {
      expectedRevision: number
      decision: 'accept' | 'reject'
      candidateRelativePath?: string
    },
  ): Readonly<{ proposal?: Readonly<ProjectDocumentRebindProposalView>; projectRevision: number }>
  close(): void
}

export interface OpenProjectControlStorageOptions {
  databasePath: string
  backupDirectory?: string
  migrationsDirectory?: string
  applicationVersion: string
  instanceId: string
  now?: () => string
  idFactory?: (
    prefix: 'evt' | 'out' | 'pth' | 'src' | 'job' | 'can' | 'doc' | 'iss' | 'jis' | 'loc' | 'srt' | 'pln' | 'rbd'
      | 'wrk' | 'run' | 'rev' | 'rva' | 'dec' | 'atb' | 'upd' | 'qtn',
  ) => string
}

export function openProjectControlStorage(
  options: OpenProjectControlStorageOptions,
): Promise<Readonly<ProjectControlStorage>>

export function canonicalJson(value: unknown): string
export function requestSha256(value: unknown): string
export function createPrefixedUuidV7(
  prefix: string,
  options?: { nowMs?: number; randomBytes?: Uint8Array },
): string

export class ProjectControlStorageError extends Error {
  code: string
  details?: unknown
}
export class IdempotencyConflictError extends ProjectControlStorageError {}
export class InvalidStoragePathError extends ProjectControlStorageError {}
export class MigrationChecksumError extends ProjectControlStorageError {}
export class MigrationError extends ProjectControlStorageError {}
export class MigrationVersionError extends ProjectControlStorageError {}
export class StorageValidationError extends ProjectControlStorageError {}
export class UntrackedDatabaseError extends ProjectControlStorageError {}
export class WriterLockError extends ProjectControlStorageError {}
