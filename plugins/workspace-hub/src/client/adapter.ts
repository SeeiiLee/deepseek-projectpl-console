/**
 * Native Workspace Adapter（Task A）：订阅 sessions.list / workspaces.list，
 * 投影 current Session 与 Native Workspace，驱动 Context reducer。
 * 影子运行（Task E）：只读对比旧 projectWorkspaceLink 的绑定结果，差异仅进诊断日志，
 * 不切换任何状态。W0 不写 Project DB、不改用户目录。
 */
import type { ContextInputs } from './reducer.ts'
import type { WorkspaceContextChangeReason } from './contracts.ts'
import { matchProjectRoot, ProjectIndex, type ProjectRootEntry } from './projectIndex.ts'

/** sessions.list 最小结构面（与 workbench projectWorkspaceLink 同口径，只读）。 */
export interface SessionListFace {
  current: string | undefined
  byId: Readonly<Record<string, { cwd?: string }>>
}

/** workspaces.list 最小结构面（只读）。 */
export interface WorkspaceListFace {
  items: readonly { workspaceId: string; path: string; sessionIds: readonly string[]; title?: string }[]
}

interface StoreLike<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

/** 旧 workbench 绑定（只读观察，结构面）。 */
export interface WorkbenchBindingFace {
  getSnapshot(): { projectWorkspace?: { projectId: string; root: string } }
}

export interface NativeWorkspaceAdapterInput {
  sessions: { list: StoreLike<SessionListFace> }
  workspaces: { list: StoreLike<WorkspaceListFace> }
  /** 每次输入变化回调（reducer 驱动）。 */
  recompute: (inputs: ContextInputs, reason: WorkspaceContextChangeReason) => void
  /** W1 Task D：项目工作区索引（缺省内部创建，按 updatedAt 指纹缓存）。 */
  projectIndex?: { roots(): readonly ProjectRootEntry[]; refresh(): Promise<void> }
  fetchImpl?: typeof fetch
  /** 影子对比：旧绑定观察（可选，缺省关闭）。 */
  workbench?: WorkbenchBindingFace
  /** 影子开关：env DSH_WORKSPACE_HUB_SHADOW='0' 关闭（缺省开）。 */
  shadowEnabled?: boolean
  /** 差异回调（默认 console.warn；测试注入）。 */
  onShadowDifference?: (diff: { hubPath: string; bindingRoot: string; projectId?: string }) => void
}

/** 带项目匹配的输入投影（纯函数；命令路径与订阅路径共用，避免匹配丢失）。 */
export function withProjectMatch(
  inputs: ContextInputs,
  roots: readonly ProjectRootEntry[],
): ContextInputs {
  const raw = inputs.nativeWorkspace?.path ?? inputs.sessionCwd
  if (raw === undefined || raw === '') return inputs
  const match = matchProjectRoot(raw, roots)
  if (match === undefined) return inputs
  return { ...inputs, projectRootMatch: match }
}

/** 归一化：大小写不敏感、两种分隔符统一为反斜杠、去尾分隔符（与旧联动规则镜像）。 */
export function canonicalPath(raw: string): string {
  let path = raw.trim()
  while (path.endsWith('\\') || path.endsWith('/')) path = path.slice(0, -1)
  return path.toLowerCase().replace(/\//g, '\\')
}

/** 读取当前投影输入（原生工作区成员优先于会话 cwd，与旧联动一致）。 */
export function projectInputs(
  sessions: { list: StoreLike<SessionListFace> },
  workspaces: { list: StoreLike<WorkspaceListFace> },
): ContextInputs {
  const sessionList = sessions.list.getSnapshot()
  const currentSessionId = sessionList.current
  if (currentSessionId === undefined) return {}
  const membership = workspaces.list.getSnapshot().items.find(item => item.sessionIds.includes(currentSessionId))
  const sessionCwd = sessionList.byId[currentSessionId]?.cwd
  if (membership !== undefined && membership.path !== '') {
    const title = membership.title !== undefined && membership.title !== ''
      ? membership.title
      : (membership.path.replace(/[\\/]+$/u, '').split(/[\\/]/u).pop() ?? membership.workspaceId)
    return {
      currentSessionId,
      ...(sessionCwd !== undefined && sessionCwd !== '' ? { sessionCwd } : {}),
      nativeWorkspace: { workspaceId: membership.workspaceId, title, path: membership.path },
    }
  }
  return { currentSessionId, ...(sessionCwd !== undefined && sessionCwd !== '' ? { sessionCwd } : {}) }
}

/** 影子差异：hub 解析的根 vs 旧 workbench 绑定根；返回差异描述或 undefined。 */
export function shadowDifference(
  workbench: WorkbenchBindingFace | undefined,
  inputs: ContextInputs,
): { hubPath: string; bindingRoot: string; projectId?: string } | undefined {
  if (workbench === undefined) return undefined
  const hubPath = inputs.nativeWorkspace?.path ?? inputs.sessionCwd
  if (hubPath === undefined || hubPath === '') return undefined
  const binding = workbench.getSnapshot().projectWorkspace
  if (binding === undefined) return undefined
  if (canonicalPath(hubPath) === canonicalPath(binding.root)) return undefined
  return { hubPath, bindingRoot: binding.root, projectId: binding.projectId }
}

/** 安装适配器：返回 dispose。 */
export function installNativeWorkspaceAdapter(input: NativeWorkspaceAdapterInput): () => void {
  const { sessions, workspaces, recompute } = input
  const shadowEnabled = input.shadowEnabled
    ?? (typeof process === 'undefined' || process.env?.DSH_WORKSPACE_HUB_SHADOW !== '0')
  const projectIndex = input.projectIndex ?? new ProjectIndex(input.fetchImpl ?? globalThis.fetch)
  const onDifference = input.onShadowDifference
    ?? ((diff) => console.warn('workspace-hub shadow: 旧绑定与 Hub Context 差异', diff))
  let lastInputs: ContextInputs = {}

  let disposed = false
  const read = (inputs: ContextInputs, reason: WorkspaceContextChangeReason): void => {
    lastInputs = inputs
    recompute(inputs, reason)
    if (shadowEnabled) {
      const diff = shadowDifference(input.workbench, inputs)
      if (diff !== undefined) onDifference(diff)
    }
  }
  /** 带项目匹配的输入投影。 */
  const withMatch = (inputs: ContextInputs): ContextInputs =>
    withProjectMatch(inputs, projectIndex.roots())
  /** 索引刷新后重算（匹配建议可能变化）；dispose 后不再触发。 */
  const refreshIndex = async (): Promise<void> => {
    try {
      await projectIndex.refresh()
      if (disposed) return
      read(withMatch(projectInputs(sessions, workspaces)), 'workspace-changed')
    } catch {
      // 索引不可用：保持现有匹配（不因瞬时故障覆盖）。
    }
  }

  const onSessions = (): void => {
    const inputs = projectInputs(sessions, workspaces)
    const reason: WorkspaceContextChangeReason = inputs.currentSessionId !== lastInputs.currentSessionId
      ? 'session-changed'
      : 'workspace-changed'
    read(withMatch(inputs), reason)
    void refreshIndex()
  }
  const onWorkspaces = (): void => {
    read(withMatch(projectInputs(sessions, workspaces)), 'workspace-changed')
    void refreshIndex()
  }

  const offSessions = sessions.list.subscribe(onSessions)
  const offWorkspaces = workspaces.list.subscribe(onWorkspaces)
  read(withMatch(projectInputs(sessions, workspaces)), 'initial')
  void refreshIndex()
  return () => {
    disposed = true
    offSessions()
    offWorkspaces()
  }
}
