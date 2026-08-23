declare module '@cyrus/dsh-workbench/client' {
  import type { ReactNode } from 'react'

  export interface WorkbenchTabDescriptor {
    id: string
    family: 'file' | 'preview' | 'outline' | 'diff' | 'artifact' | 'browser' | 'terminal' | 'details'
    viewerId: string
    title: string
    scope: 'global' | 'session'
    sessionId?: string
    resourceKey?: string
  }

  export interface WorkbenchViewerDefinition {
    id: string
    family: WorkbenchTabDescriptor['family']
    title: string
    canRestore(descriptor: WorkbenchTabDescriptor): boolean
    render?(descriptor: WorkbenchTabDescriptor): ReactNode
  }

  export interface WorkbenchService {
    readonly viewers: {
      register(viewer: WorkbenchViewerDefinition): () => void
    }
    open(intent: {
      family: WorkbenchTabDescriptor['family']
      viewerId?: string
      title?: string
      resourceKey?: string
      scope?: 'global' | 'session'
      sessionId?: string
    }): WorkbenchTabDescriptor
    /** 绑定文件树/预览到控制台选中项目的工作区根（Hub 在场转译为 follow-console）。 */
    setProjectWorkspace(projectId: string, root: string): void
    /** 回到会话工作区（Hub 在场转译为 follow-session）。 */
    clearProjectWorkspace(): void
    /** 展开右侧工作台面板。 */
    reveal(): void
  }
}
