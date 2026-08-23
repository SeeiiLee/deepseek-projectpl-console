/**
 * Context Reducer（架构书 §6.1/§7.1，Task B）。
 * 纯函数：输入（Session/Workspace 投影 + 目标状态）→ 输出带单调 revision 的快照。
 * 三轴互不混淆：currentSessionId（原生 DSH 决定）、consoleProjectId（控制台管理哪个项目）、
 * pinMountId（Workbench 固定浏览根）。W0 只产出 follow-session 真实数据；follow-console 与
 * pinned 的接线在 W1，但全部逻辑在这里先行冻结并全量测试。
 */
import type {
  WorkbenchTargetMode,
  WorkspaceContextChangeReason,
  WorkspaceContextSnapshot,
  WorkspaceMountView,
} from './contracts.ts'

/** 适配器每次可观察到的输入（W0 无 Host 能力，根以路径形式投影；W2 后改为 handle）。 */
export interface ContextInputs {
  currentSessionId?: string
  sessionCwd?: string
  nativeWorkspace?: {
    workspaceId: string
    title: string
    path: string
  }
  /** W1 Task D 提供 Project 紧凑索引后由控制台投影填充。 */
  consoleProjectRoot?: string
  /** W1 Task D：follow-session 下「会话工作区 → 项目根」的匹配建议（不写库；W3 正式化）。 */
  projectRootMatch?: { projectId: string; root: string }
}

/** 用户/调用方可变的目标状态（命令写入，reducer 只读）。 */
export interface TargetState {
  mode: WorkbenchTargetMode
  /** 显式 undefined（可写目标对象；exactOptionalPropertyTypes 兼容）。 */
  consoleProjectId: string | undefined
  /** 显式 undefined（可写目标对象；exactOptionalPropertyTypes 兼容）。 */
  pinMountId: string | undefined
}

export const WORKSPACE_CONTEXT_ID = 'personal-workspace-context'

const W0_CAPABILITIES: readonly string[] = ['read-files']

/** 语义签名：任一轴或主根变化即 revision+1；无变化返回原对象引用。 */
function semanticSignature(
  inputs: ContextInputs,
  target: TargetState,
  primaryMountId: string | undefined,
): string {
  return JSON.stringify([
    target.mode,
    target.consoleProjectId ?? null,
    target.pinMountId ?? null,
    inputs.currentSessionId ?? null,
    inputs.sessionCwd ?? null,
    inputs.nativeWorkspace ? [inputs.nativeWorkspace.workspaceId, inputs.nativeWorkspace.title, inputs.nativeWorkspace.path] : null,
    inputs.projectRootMatch ? [inputs.projectRootMatch.projectId, inputs.projectRootMatch.root] : null,
    primaryMountId ?? null,
  ])
}

function sessionMount(inputs: ContextInputs): WorkspaceMountView | undefined {
  const matchRoot = inputs.projectRootMatch?.root
  if (inputs.nativeWorkspace !== undefined) {
    return {
      mountId: 'native:' + inputs.nativeWorkspace.workspaceId,
      label: inputs.nativeWorkspace.title,
      kind: 'primary',
      path: matchRoot ?? inputs.nativeWorkspace.path,
      access: 'read-write',
      trust: 'trusted',
      persistence: 'global',
      status: 'ready',
      capabilities: W0_CAPABILITIES,
    }
  }
  if (inputs.currentSessionId === undefined) return undefined
  return {
    mountId: 'session:' + inputs.currentSessionId,
    label: '当前会话工作区',
    kind: 'primary',
    ...((matchRoot ?? inputs.sessionCwd) !== undefined && (matchRoot ?? inputs.sessionCwd) !== '' ? { path: matchRoot ?? inputs.sessionCwd } : {}),
    access: 'read-write',
    trust: 'trusted',
    persistence: 'session',
    status: 'ready',
    capabilities: W0_CAPABILITIES,
  }
}

function consoleMount(inputs: ContextInputs, target: TargetState): WorkspaceMountView | undefined {
  if (target.consoleProjectId === undefined) return undefined
  return {
    mountId: 'project:' + target.consoleProjectId,
    label: target.consoleProjectId,
    kind: 'primary',
    ...(inputs.consoleProjectRoot !== undefined && inputs.consoleProjectRoot !== '' ? { path: inputs.consoleProjectRoot } : {}),
    projectId: target.consoleProjectId,
    access: 'read-write',
    trust: 'trusted',
    persistence: 'project',
    status: inputs.consoleProjectRoot === undefined || inputs.consoleProjectRoot === '' ? 'missing' : 'ready',
    capabilities: W0_CAPABILITIES,
  }
}

/**
 * 解析下一个 Context 快照。
 * @param prev 前一快照（首次为 undefined → revision 1）
 * @param inputs 当前 Session/Workspace 投影
 * @param target 当前目标状态（模式/控制台项目/固定挂载）
 * @param reason 本次变化原因
 * @param changedAt 时间戳（可注入便于测试）
 */
export function resolveContext(
  prev: WorkspaceContextSnapshot | undefined,
  inputs: ContextInputs,
  target: TargetState,
  reason: WorkspaceContextChangeReason,
  changedAt = new Date().toISOString(),
): WorkspaceContextSnapshot {
  let primaryMount: WorkspaceMountView | undefined
  let status: WorkspaceContextSnapshot['status'] = 'unbound'
  let resolvedProjectId: string | undefined

  if (target.mode === 'pinned') {
    // 固定挂载：只接受此前已解析过的 mount id；未知/失效 → missing（stale pin）。
    const retained = prev?.mounts.find(mount => mount.mountId === target.pinMountId)
    if (retained !== undefined) {
      primaryMount = retained
      status = 'ready'
    } else {
      status = 'missing'
    }
    resolvedProjectId = prev?.resolvedProjectId
  } else if (target.mode === 'follow-console') {
    if (target.consoleProjectId === undefined) {
      status = 'unbound'
    } else {
      primaryMount = consoleMount(inputs, target)
      status = primaryMount?.status === 'ready' ? 'ready' : 'missing'
      resolvedProjectId = target.consoleProjectId
    }
  } else if (target.mode === 'follow-session') {
    if (inputs.currentSessionId === undefined) {
      status = 'unbound'
    } else {
      const match = inputs.projectRootMatch
      const rawPath = inputs.nativeWorkspace?.path ?? inputs.sessionCwd
      const hasPath = rawPath !== undefined && rawPath !== ''
      primaryMount = sessionMount(inputs)
      status = hasPath ? 'ready' : 'missing'
      if (hasPath && match !== undefined) {
        resolvedProjectId = match.projectId
      }
    }
  }

  const primaryMountId = primaryMount?.mountId
  const signature = semanticSignature(inputs, target, primaryMountId)
  if (prev !== undefined && prev.revisionKey === signature) {
    return prev
  }
  const mounts: WorkspaceMountView[] = primaryMount === undefined ? [] : [primaryMount]
  return {
    contextId: WORKSPACE_CONTEXT_ID,
    revision: (prev?.revision ?? 0) + 1,
    revisionKey: signature,
    mode: target.mode,
    ...(inputs.currentSessionId !== undefined ? { currentSessionId: inputs.currentSessionId } : {}),
    ...(inputs.nativeWorkspace !== undefined
      ? { nativeWorkspace: { workspaceId: inputs.nativeWorkspace.workspaceId, title: inputs.nativeWorkspace.title, primaryMountId: 'native:' + inputs.nativeWorkspace.workspaceId } }
      : {}),
    ...(target.consoleProjectId !== undefined ? { consoleProjectId: target.consoleProjectId } : {}),
    ...(resolvedProjectId !== undefined ? { resolvedProjectId } : {}),
    ...(primaryMountId !== undefined ? { primaryMountId } : {}),
    mounts,
    status,
    capabilities: W0_CAPABILITIES,
    changedAt,
    reason,
  }
}

