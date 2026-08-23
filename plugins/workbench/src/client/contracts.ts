import type { ReactNode } from 'react'

/** Tool families accepted by the stable Workbench open-intent seam. */
export const WORKBENCH_FAMILIES = [
  'file',
  'preview',
  'outline',
  'diff',
  'artifact',
  'browser',
  'terminal',
  'details',
] as const

export type WorkbenchFamily = typeof WORKBENCH_FAMILIES[number]
export type WorkbenchScope = 'global' | 'session'

/** Minimal panel controls supplied by Personal Shell. */
export interface PersonalShellWorkbench {
  openWorkbench(): void
  closeWorkbench(): void
  toggleWorkbench(): void
  toggleWorkbenchFullscreen(): void
  focusConversation(): void
  resetLayout(): void
}

/**
 * One request to create or focus a tab. Gate 1 treats resourceKey as opaque
 * identity only: it never reads a path, navigates a URL, or starts a PTY.
 */
export interface WorkbenchOpenIntent {
  family: WorkbenchFamily
  /** Registered viewer id; omitted selects the family default. */
  viewerId?: string
  /** Stable caller identity. Omit to derive it from family/viewer/resourceKey. */
  tabId?: string
  /** Short display title only. */
  title?: string
  /** Opaque viewer recovery identity; no project/workflow records belong here. */
  resourceKey?: string
  /** 打开自项目工作区时携带：预览内容始终按此项目解析，不随控制台绑定变化而失效。 */
  workspaceProjectId?: string
  /** 根外文件的显式工作区根（如 .md 链接指向注册根之外的文件）：预览按此根解析，优先级高于项目绑定。 */
  workspaceRoot?: string
  /** Global by default. */
  scope?: WorkbenchScope
  /** Required only when opening a non-current session scope. */
  sessionId?: string
}

/** JSON-safe, recoverable part of a tab. */
export interface WorkbenchTabDescriptor {
  id: string
  family: WorkbenchFamily
  viewerId: string
  title: string
  scope: WorkbenchScope
  sessionId?: string
  resourceKey?: string
  /** 打开自项目工作区时的项目根绑定（预览独立于当前控制台绑定解析内容）。 */
  workspaceProjectId?: string
  /** 根外文件预览的显式工作区根（优先级高于 workspaceProjectId）。 */
  workspaceRoot?: string
}

/** Live tab projection; dirty/pinned are deliberately never persisted. */
export interface WorkbenchTabModel extends WorkbenchTabDescriptor {
  active: boolean
  dirty: boolean
  pinned: boolean
}

/** W1 三模式浏览目标（workspace-hub Context 投影；本地结构面，避免跨插件 value-import）。 */
export type WorkbenchTargetMode = 'follow-session' | 'follow-console' | 'pinned'

/** Hub Context 投影的只读面。 */
export interface WorkbenchContextProjection {
  mode: WorkbenchTargetMode
  status: 'ready' | 'unbound' | 'missing' | 'conflict' | 'untrusted' | 'degraded'
  primaryMountId?: string
  primaryLabel?: string
  primaryPath?: string
  projectId?: string
  /** 控制台当前选中的项目（与模式无关的独立轴）。 */
  consoleProjectId?: string
}

/** The one in-memory selection route used to display legacy tool details. */
export interface WorkbenchDetailsSelection {
  source: 'legacy-details'
  requestId: number
  sessionId?: string
}

/** Shell-owned command stream bridging the official Details close/open actions. */
export interface WorkbenchDetailsCommand {
  kind: 'open' | 'dismiss'
  revision: number
}

export interface WorkbenchSnapshot {
  scope: WorkbenchScope
  sessionId?: string
  tabs: readonly WorkbenchTabModel[]
  activeTabId: string
  detailsSelection?: WorkbenchDetailsSelection
  /** Whether the persistent Files dock on the right edge is open. */
  filesDockOpen: boolean
  /** Console-selected registered project workspace binding（Hub 投影或降级旧绑定）。 */
  projectWorkspace?: { projectId: string; root: string }
  /** W1 三模式 Context 投影（Hub 在场时）。 */
  context?: WorkbenchContextProjection
}

/** A viewer decides whether one descriptor contains enough safe data to restore. */
export interface WorkbenchViewerDefinition {
  id: string
  family: WorkbenchFamily
  title: string
  canRestore(descriptor: WorkbenchTabDescriptor): boolean
  /** Render a bounded plugin-owned view from the persisted descriptor only. */
  render?(descriptor: WorkbenchTabDescriptor): ReactNode
  /**
   * 文件匹配（preview family）：关联扩展名（小写、无点）。
   * 空数组 = catch-all 候选（配合 priority 兜底）；缺省 = 不参与文件匹配。
   */
  exts?: readonly string[]
  /** 文件匹配优先级（默认 0，降序稳定排序；catch-all 用负数兜底）。 */
  priority?: number
  /**
   * 内容嗅探：head 字节可用时先于 exts 判定。
   * 带 detect 的查看器在 head 缺失时本轮跳过（sniff-only，不盲认领）。
   */
  detect?: (path: string, head: Uint8Array) => boolean
}

export type CloseTabResult =
  | { closed: true }
  | { closed: false; reason: 'dirty' | 'missing' | 'pinned' }

export interface WorkbenchService {
  readonly viewers: WorkbenchViewerRegistryFace
  getSnapshot(): WorkbenchSnapshot
  subscribe(listener: () => void): () => void
  open(intent: WorkbenchOpenIntent): WorkbenchTabDescriptor
  reveal(): void
  collapse(): void
  toggle(): void
  setCurrentSession(sessionId: string | undefined): void
  /** Toggle the persistent Files dock on the right edge. */
  toggleFilesDock(): void
  /** Toggle transient fullscreen via the shell layout. */
  toggleFullscreen(): void
  /** Bind the files tree/preview to a console-selected registered project（Hub 在场时转译为 follow-console）。 */
  setProjectWorkspace(projectId: string, root: string): void
  /** Return the files tree/preview to the session workspace（Hub 在场时转译为 follow-session）。 */
  clearProjectWorkspace(): void
  /** W1：显式切换 Workbench 目标模式（Hub 在场时转译；缺失时 no-op 并保持现状）。 */
  setWorkbenchMode(mode: WorkbenchTargetMode): void
  /** W1：固定/取消固定当前主 Mount（切换 pinned 模式）。 */
  toggleWorkbenchPin(): void
  /** Collapse both auxiliary panels and focus Conversation. */
  focusConversation(): void
  /** Restore the contract layout defaults. */
  resetLayout(): void
  activateTab(tabId: string): boolean
  markDirty(tabId: string, dirty: boolean): boolean
  closeTab(tabId: string, options?: { force?: boolean }): CloseTabResult
  selectDetails(selection: WorkbenchDetailsSelection): void
  dismissDetails(): void
  /**
   * 更新已打开页签的可持久化字段（Browser 持久化当前 URL 等）。
   * 仅允许 resourceKey/title；页签不存在返回 false。
   */
  updateTab(tabId: string, patch: { resourceKey?: string; title?: string }): boolean
}

export interface WorkbenchViewerRegistryFace {
  register(viewer: WorkbenchViewerDefinition): () => void
  get(id: string): WorkbenchViewerDefinition | undefined
  list(): readonly WorkbenchViewerDefinition[]
  /** 按路径（可选 head 字节嗅探）匹配 preview family 查看器。 */
  matchViewer?(path: string, head?: Uint8Array): WorkbenchViewerDefinition | undefined
}

export function isWorkbenchFamily(value: unknown): value is WorkbenchFamily {
  return typeof value === 'string' && (WORKBENCH_FAMILIES as readonly string[]).includes(value)
}
