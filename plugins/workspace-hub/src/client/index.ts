import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-runtime/client'
import type { WorkspaceContextChangeReason, WorkspaceContextSnapshot, WorkspaceHubClient } from './contracts.ts'
import type { ContextInputs } from './reducer.ts'
import { resolveContext, type TargetState } from './reducer.ts'
import { createSnapshotStore } from './store.ts'
import {
  installNativeWorkspaceAdapter,
  projectInputs,
  withProjectMatch,
  type WorkbenchBindingFace,
} from './adapter.ts'
import { ProjectIndex } from './projectIndex.ts'

export * from './contracts.ts'
export * from './reducer.ts'
export * from './adapter.ts'
export { createSnapshotStore } from './store.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Workspace Hub 只读 Context 服务（W0；W1 起承载跟随模式命令）。 */
    workspaceHub: WorkspaceHubClient
  }
}

/** W0：只注入会话与工作区注册表（无 UI、无数据库写）。 */
export const inject = ['sessions', 'workspaces']

/** 注册 Workspace Hub 只读 Context 服务（W0）。 */
export function apply(ctx: ClientContext): void {
  const store = createSnapshotStore<WorkspaceContextSnapshot>(
    resolveContext(undefined, {}, { mode: 'follow-session', consoleProjectId: undefined, pinMountId: undefined }, 'initial'),
  )
  const target: TargetState = { mode: 'follow-session', consoleProjectId: undefined, pinMountId: undefined }

  const recompute = (inputs: ContextInputs, reason: WorkspaceContextChangeReason): void => {
    store.set(resolveContext(store.getSnapshot(), inputs, target, reason))
  }

  // W1 Task D：项目索引由命令与订阅共用；命令重算必须带匹配，否则 follow-session 匹配会丢失。
  const projectIndex = new ProjectIndex(globalThis.fetch)
  const currentInputs = (): ContextInputs =>
    withProjectMatch(projectInputs(ctx.sessions, ctx.workspaces), projectIndex.roots())

  const workbench = ctx.reflect.get('workbench', false) as WorkbenchBindingFace | undefined
  const disposeAdapter = installNativeWorkspaceAdapter({
    sessions: ctx.sessions,
    workspaces: ctx.workspaces,
    recompute,
    projectIndex,
    ...(workbench !== undefined ? { workbench } : {}),
  })

  const service: WorkspaceHubClient = {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    setMode: async (mode) => {
      target.mode = mode
      recompute(currentInputs(), 'mode-changed')
    },
    pinMount: async (mountId) => {
      target.pinMountId = mountId
      recompute(currentInputs(), 'pinned')
    },
    clearPin: async () => {
      target.pinMountId = undefined
      recompute(currentInputs(), 'unpinned')
    },
    setConsoleProject: (projectId: string | undefined) => {
      target.consoleProjectId = projectId
      recompute(currentInputs(), 'console-project-changed')
    },
  }

  ctx.effect(
    () => {
      const disposeProvide = ctx.reflect.provide('workspaceHub', service)
      return () => {
        disposeAdapter()
        void disposeProvide()
      }
    },
    'workspace-hub: context service + native workspace adapter',
  )
}
