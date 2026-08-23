/**
 * Workspace Hub 合同（架构书 §6.1/§6.3/§9.1 的 W0 子集）。
 * 术语：Context = 某一时刻 Workbench/Agent 可用的工作区视图；Mount = 允许访问的根；
 * Resource = Mount + 相对路径 + 版本。W0 只产出 Context 快照；Mount/Resource 的完整
 * 能力与统一 Host 在 W2。
 */

export type WorkbenchTargetMode = 'follow-session' | 'follow-console' | 'pinned'

export type WorkspaceMountKind =
  | 'primary'
  | 'additional'
  | 'project-docs'
  | 'generated'
  | 'artifact'
  | 'worktree'

export type WorkspaceContextStatus =
  | 'ready'
  | 'unbound'
  | 'missing'
  | 'conflict'
  | 'untrusted'
  | 'degraded'

export type WorkspaceContextChangeReason =
  | 'initial'
  | 'session-changed'
  | 'workspace-changed'
  | 'console-project-changed'
  | 'mode-changed'
  | 'pinned'
  | 'unpinned'

export interface WorkspaceMountView {
  mountId: string
  label: string
  kind: WorkspaceMountKind
  /** W1 过渡字段：渲染层浏览所需的绝对根。W2 收敛到 Host handle registry 后移除（§6.2）。 */
  path?: string
  projectId?: string
  access: 'read-only' | 'read-write'
  trust: 'trusted' | 'untrusted' | 'missing'
  persistence: 'session' | 'project' | 'global'
  status: 'ready' | 'missing' | 'stale' | 'conflict'
  capabilities: readonly string[]
}

export interface WorkspaceContextSnapshot {
  contextId: string
  revision: number
  /** @internal reducer 语义签名（消费者勿读，仅用于同语义去重与单调 revision）。 */
  revisionKey: string
  mode: WorkbenchTargetMode
  currentSessionId?: string
  nativeWorkspace?: {
    workspaceId: string
    title: string
    primaryMountId: string
  }
  consoleProjectId?: string
  resolvedProjectId?: string
  primaryMountId?: string
  mounts: readonly WorkspaceMountView[]
  status: WorkspaceContextStatus
  capabilities: readonly string[]
  changedAt: string
  reason: WorkspaceContextChangeReason
}

/** Client service 面（W0 子集；openResource 等 W1 补）。 */
export interface WorkspaceHubClient {
  getSnapshot(): WorkspaceContextSnapshot
  subscribe(listener: () => void): () => void
  setMode(mode: WorkbenchTargetMode): Promise<void>
  pinMount(mountId: string): Promise<void>
  clearPin(): Promise<void>
  setConsoleProject(projectId: string | undefined): void
}
