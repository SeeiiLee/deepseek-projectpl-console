/**
 * W1 contextLink：workbench 消费 workspace-hub 的 Context（只读订阅），
 * 并把 Hub 命令面注入 controller（setProjectWorkspace 等旧调用的转译目标）。
 * Hub 缺失（降级）：不订阅、不注入，workbench 保持旧 LWW 绑定路径。
 * 不 value-import hub 包：全部使用本地结构面。
 */
import type { WorkbenchContextProjection, WorkbenchTargetMode } from './contracts.ts'

/** workspace-hub Client 服务的本地结构面。 */
export interface WorkspaceHubFace {
  getSnapshot(): {
    mode: WorkbenchTargetMode
    status: WorkbenchContextProjection['status']
    resolvedProjectId?: string
    consoleProjectId?: string
    primaryMountId?: string
    mounts: readonly { mountId: string; label: string; path?: string }[]
  }
  subscribe(listener: () => void): () => void
  setMode(mode: WorkbenchTargetMode): Promise<void>
  pinMount(mountId: string): Promise<void>
  clearPin(): Promise<void>
  setConsoleProject(projectId: string | undefined): void
}

export interface ContextLinkSink {
  applyHubContext(projection: WorkbenchContextProjection | undefined): void
  setHubCommands(commands: {
    setConsoleProject(projectId: string | undefined): void
    setMode(mode: WorkbenchTargetMode): Promise<void>
    pinMount(mountId: string): Promise<void>
    clearPin(): Promise<void>
  } | undefined): void
}

/** 投影 hub 快照为 workbench 侧结构。 */
export function projectContext(snapshot: ReturnType<WorkspaceHubFace['getSnapshot']>): WorkbenchContextProjection {
  const primary = snapshot.mounts[0]
  return {
    mode: snapshot.mode,
    status: snapshot.status,
    ...(snapshot.primaryMountId !== undefined ? { primaryMountId: snapshot.primaryMountId } : {}),
    ...(primary?.label !== undefined ? { primaryLabel: primary.label } : {}),
    ...(primary?.path !== undefined ? { primaryPath: primary.path } : {}),
    ...(snapshot.resolvedProjectId !== undefined ? { projectId: snapshot.resolvedProjectId } : {}),
    ...(snapshot.consoleProjectId !== undefined ? { consoleProjectId: snapshot.consoleProjectId } : {}),
  }
}

/** 安装 contextLink：hub 在场时订阅并注入命令；返回 dispose。 */
export function installContextLink(hub: WorkspaceHubFace | undefined, sink: ContextLinkSink): () => void {
  if (hub === undefined) {
    sink.setHubCommands(undefined)
    return () => {}
  }
  sink.setHubCommands({
    setConsoleProject: (projectId) => { hub.setConsoleProject(projectId) },
    setMode: (mode) => hub.setMode(mode),
    pinMount: (mountId) => hub.pinMount(mountId),
    clearPin: () => hub.clearPin(),
  })
  const listener = (): void => { sink.applyHubContext(projectContext(hub.getSnapshot())) }
  listener()
  const off = hub.subscribe(listener)
  return () => {
    off()
    sink.setHubCommands(undefined)
    sink.applyHubContext(undefined)
  }
}
