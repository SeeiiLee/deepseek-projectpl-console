import { createElement, type ReactNode } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-runtime/client'
import { WorkbenchPanel } from './WorkbenchPanel.tsx'
import type {
  PersonalShellWorkbench,
  WorkbenchDetailsCommand,
  WorkbenchOpenIntent,
  WorkbenchService,
} from './contracts.ts'
import { WorkbenchController } from './service.ts'
import { WorkbenchViewerRegistry } from './viewers.ts'
import { installContextLink, type WorkspaceHubFace } from './contextLink.ts'
import { EditingPreferencesSection } from './EditingPreferencesSection.tsx'
import { WorkspaceFilesViewer } from './WorkspaceFilesViewer.tsx'
import { WorkspacePreviewViewer } from './WorkspacePreviewViewer.tsx'
import { WorkspaceHtmlViewer } from './WorkspaceHtmlViewer.tsx'
import { WorkspaceOutlineViewer } from './WorkspaceOutlineViewer.tsx'
import { isWorkspaceDiffResourceKey, WorkspaceDiffViewer } from './WorkspaceDiffViewer.tsx'
import { WorkspaceBrowserViewer } from './WorkspaceBrowserViewer.tsx'
import { SessionTerminalViewer } from './SessionTerminalViewer.tsx'
import { installMarkdownOpenPathInterception, planAdhocMarkdownOpen, planMarkdownOpen } from './open-in-workbench.ts'
import { createProjectWorkspaceApi, createWorkspaceApi as createAmbientWorkspaceApi } from './workspaceApi.ts'

export * from './contracts.ts'
export { decideDetailsRoute } from './details-route.ts'
export { WorkbenchController, storageKey, FILES_DOCK_STORAGE_KEY, WORKBENCH_STORAGE_PREFIX, WORKBENCH_STORAGE_VERSION } from './service.ts'
export { DEFAULT_VIEWER_IDS, FAMILY_TITLES, WorkbenchViewerRegistry } from './viewers.ts'
export { createWorkspaceApi, workspacePath } from './workspaceApi.ts'
export { extractOutline } from './outline.ts'
export { diffLines, isWorkspaceDiffResourceKey } from './workspace-diff.ts'
export { WorkspaceOutlineViewer } from './WorkspaceOutlineViewer.tsx'
export { WorkspaceDiffViewer } from './WorkspaceDiffViewer.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Workbench 编辑偏好设置卡片（设置页；R-ED，形状对齐平台 ui-settings）。 */
    'settings.section': {
      kind: 'list'
      scope: 'root'
      owner: { close: () => void }
    }
    /** Personal Shell-owned right column. */
    'workbench.panel': {
      kind: 'single'
      scope: 'root'
      owner: { legacyDetails: ReactNode; detailsCommand: WorkbenchDetailsCommand; fullscreen: boolean }
    }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Stable outward Workbench intent and tab service. */
    workbench: WorkbenchService
  }
}

export const inject = ['slots', 'personalShell', 'sessions', 'workspaces']

let activeWorkbench: WorkbenchService | undefined

/** Viewer-side seam: bounded viewers can open follow-up intents. */
export function getActiveWorkbench(): WorkbenchService | undefined {
  return activeWorkbench
}

export function openWorkbenchIntent(intent: WorkbenchOpenIntent): void {
  if (activeWorkbench === undefined) return
  activeWorkbench.open(intent)
}

/** 按文件路径自动匹配 preview 查看器后打开（Code / Markdown 预览统一入口）。 */
export function openWorkspaceFile(path: string, title: string, workspaceProjectId?: string, workspaceRoot?: string): void {
  const viewer = activeWorkbench?.viewers.matchViewer?.(path)
  openWorkbenchIntent({
    family: 'preview',
    viewerId: viewer?.id ?? 'workbench.workspace-preview',
    resourceKey: 'workspace:' + path,
    title,
    ...(workspaceProjectId === undefined ? {} : { workspaceProjectId }),
    ...(workspaceRoot === undefined ? {} : { workspaceRoot }),
  })
}

/**
 * 尝试把本地绝对路径的 Markdown 文件在工作台内开页签；成功返回 true。
 * 判定逻辑在 open-in-workbench.ts（纯函数 planMarkdownOpen）；
 * 这里只补环境默认根的异步读取与真正的开页签动作。
 * 所有已知根都不包含时，用 planAdhocMarkdownOpen 以文件所在目录为显式根内开，
 * 保证任意 .md 链接（包括其他项目/任意目录）都不落外部应用。
 */
export async function tryOpenMarkdownInWorkbench(absPath: string): Promise<boolean> {
  if (activeWorkbench === undefined) return false
  const snapshot = activeWorkbench.getSnapshot()
  let plan = planMarkdownOpen(absPath, snapshot)
  const bound = snapshot.projectWorkspace
  if (plan === undefined && bound !== undefined) {
    // Hub 投影缺 primaryPath 时，snapshot 里的 root 会退化成项目标签/ID（非文件系统
    // 路径）；真实根以项目工作区 API 为准——与文件树/预览查看器同一来源。已命中或
    // 真正根外（快路径已按有效根否决）时不多发请求：仅快路径失败才取根重试一次。
    try {
      const status = await createProjectWorkspaceApi(bound.projectId).status()
      if (status.workspaceRoot !== '' && status.workspaceRoot !== bound.root) {
        plan = planMarkdownOpen(absPath, { projectWorkspace: { projectId: bound.projectId, root: status.workspaceRoot } })
      }
    } catch {
      // 项目根读取失败不阻断：继续走 ad-hoc 兜底。
    }
  }
  if (plan === undefined && bound === undefined && (snapshot.context?.primaryPath ?? '') === '') {
    try {
      const status = await createAmbientWorkspaceApi().status()
      plan = planMarkdownOpen(absPath, snapshot, status.workspaceRoot)
    } catch {
      // 环境根读取失败不阻断：继续走 ad-hoc 兜底。
    }
  }
  if (plan !== undefined) {
    // 页签始终携带实际匹配到的根：查看器严格按同一根解析，
    // 不受「自动绑定当前项目」干扰（根外/会话根文件曾被项目根劫持导致「目标不是文件」）。
    openWorkspaceFile(plan.rel, plan.name, plan.projectId, plan.root)
    return true
  }
  const adhoc = planAdhocMarkdownOpen(absPath)
  if (adhoc === undefined) return false
  openWorkspaceFile(adhoc.rel, adhoc.name, undefined, adhoc.root)
  return true
}

function isWorkspaceResourceKey(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('workspace:') && !value.includes('\u0000')
}

function isWorkspaceOutlineResourceKey(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('workspace-outline:') && !value.includes('\u0000')
}

function isBrowserResourceKey(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('browser:')
}

/** Register the single Workbench root occupant, its public client service, and the P8 viewers. */
export function apply(ctx: ClientContext): void {
  const shell = requirePersonalShell(ctx.get('personalShell'))
  // 查看器必须先于控制器构造注册：构造时会从存储恢复页签，插件查看器若尚未
  // 注册，预览等审阅页签会被 canRestore 过滤并在写回时永久丢失（启动失忆）。
  const registry = new WorkbenchViewerRegistry()
  registry.installDefaults()
  const viewerDisposers = [
    registry.register({
      id: 'workbench.workspace-files',
      family: 'file',
      title: '工作区文件',
      canRestore: descriptor => descriptor.family === 'file'
        && descriptor.viewerId === 'workbench.workspace-files',
      render: () => createElement(WorkspaceFilesViewer),
    }),
    registry.register({
      id: 'workbench.workspace-preview',
      family: 'preview',
      title: '工作区预览',
      exts: ['md', 'markdown', 'mdx'],
      priority: 10,
      canRestore: descriptor => descriptor.family === 'preview'
        && (descriptor.viewerId === 'workbench.workspace-preview' || descriptor.viewerId === 'workbench.workspace-code')
        && isWorkspaceResourceKey(descriptor.resourceKey),
      render: descriptor => isWorkspaceResourceKey(descriptor.resourceKey)
        ? createElement(WorkspacePreviewViewer, { descriptor })
        : createElement('p', null, '工作区文件标识无效。'),
    }),
    registry.register({
      id: 'workbench.workspace-html',
      family: 'preview',
      title: 'HTML 预览',
      exts: ['html', 'htm'],
      priority: 20,
      canRestore: descriptor => descriptor.family === 'preview'
        && descriptor.viewerId === 'workbench.workspace-html'
        && isWorkspaceResourceKey(descriptor.resourceKey),
      render: descriptor => isWorkspaceResourceKey(descriptor.resourceKey)
        ? createElement(WorkspaceHtmlViewer, { descriptor })
        : createElement('p', null, '工作区文件标识无效。'),
    }),
    registry.register({
      id: 'workbench.workspace-code',
      family: 'preview',
      title: '工作区代码',
      exts: [],
      priority: -100,
      canRestore: descriptor => descriptor.family === 'preview'
        && (descriptor.viewerId === 'workbench.workspace-code' || descriptor.viewerId === 'workbench.workspace-preview')
        && isWorkspaceResourceKey(descriptor.resourceKey),
      render: descriptor => isWorkspaceResourceKey(descriptor.resourceKey)
        ? createElement(WorkspacePreviewViewer, { descriptor })
        : createElement('p', null, '工作区文件标识无效。'),
    }),
    registry.register({
      id: 'workbench.workspace-outline',
      family: 'outline',
      title: '大纲',
      canRestore: descriptor => descriptor.family === 'outline'
        && descriptor.viewerId === 'workbench.workspace-outline'
        && isWorkspaceOutlineResourceKey(descriptor.resourceKey),
      render: descriptor => isWorkspaceOutlineResourceKey(descriptor.resourceKey)
        ? createElement(WorkspaceOutlineViewer, { descriptor })
        : createElement('p', null, '大纲文件标识无效。'),
    }),
    registry.register({
      id: 'workbench.workspace-diff',
      family: 'diff',
      title: '工作区 Diff',
      canRestore: descriptor => descriptor.family === 'diff'
        && descriptor.viewerId === 'workbench.workspace-diff'
        && isWorkspaceDiffResourceKey(descriptor.resourceKey),
      render: descriptor => isWorkspaceDiffResourceKey(descriptor.resourceKey)
        ? createElement(WorkspaceDiffViewer, { descriptor })
        : createElement('p', null, 'Diff 标识无效。'),
    }),
    registry.register({
      id: 'workbench.workspace-browser',
      family: 'browser',
      title: '受限浏览器',
      canRestore: descriptor => descriptor.family === 'browser'
        && descriptor.viewerId === 'workbench.workspace-browser'
        && (descriptor.resourceKey === undefined || isBrowserResourceKey(descriptor.resourceKey)),
      render: descriptor => createElement(WorkspaceBrowserViewer, { descriptor }),
    }),
    registry.register({
      id: 'workbench.session-terminal',
      family: 'terminal',
      title: '会话终端',
      canRestore: descriptor => descriptor.family === 'terminal'
        && descriptor.viewerId === 'workbench.session-terminal',
      render: () => createElement(SessionTerminalViewer),
    }),
  ]
  const workbench = new WorkbenchController(shell, undefined, registry)
  activeWorkbench = workbench
  // smoke/调试探针钩子：脚本可直接打开 Outline/Diff/Browser 等页签验证核心结构。
  const holder = window as unknown as {
    __wbOpenWorkbenchIntent?: typeof openWorkbenchIntent
    __wbWorkbench?: WorkbenchService
  }
  holder.__wbOpenWorkbenchIntent = openWorkbenchIntent
  holder.__wbWorkbench = workbench
  ctx.effect(
    () => {
      const disposeProvide = ctx.reflect.provide('workbench', workbench)
      return () => {
        for (const dispose of viewerDisposers) dispose()
        void disposeProvide()
      }
    },
    'workbench: public service + viewer disposal',
  )
  ctx.effect(
    () => {
      // W1：workbench 消费 workspace-hub Context（三模式）；Hub 缺失自动降级旧绑定。
      const hub = ctx.reflect.get('workspaceHub', false) as WorkspaceHubFace | undefined
      return installContextLink(hub, workbench)
    },
    'workbench: workspace-hub context link (three-mode target)',
  )
  ctx.effect(
    () => {
      // R-UX：会话窗点 .md 链接（文件提及/产物 chips/工具行）改在工作台内开页签，
      // 不再跳系统外部应用；补丁 workspaces.openPath 共享实例，卸载时还原。
      const workspaces = ctx.get('workspaces', false) as { openPath(path: string): Promise<void> } | undefined
      if (workspaces === undefined) return () => {}
      return installMarkdownOpenPathInterception(workspaces, tryOpenMarkdownInWorkbench)
    },
    'workbench: markdown openPath interception (in-workbench tabs)',
  )
  ctx.slots.inject('workbench.panel', () => ctx.slots.register({
    name: 'workbench.panel',
    inject: () => ({ workbench }),
  }, WorkbenchPanel))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'personal-workbench-editing',
    order: 46,
    label: 'Workbench 编辑',
    inject: () => ({}),
  }, EditingPreferencesSection))
}

function requirePersonalShell(value: unknown): PersonalShellWorkbench {
  if (typeof value !== 'object' || value === null) {
    throw new Error('workbench: personalShell service is unavailable')
  }
  const candidate = value as Partial<PersonalShellWorkbench>
  if (typeof candidate.openWorkbench !== 'function'
    || typeof candidate.closeWorkbench !== 'function'
    || typeof candidate.toggleWorkbench !== 'function'
    || typeof candidate.toggleWorkbenchFullscreen !== 'function'
    || typeof candidate.focusConversation !== 'function'
    || typeof candidate.resetLayout !== 'function') {
    throw new Error('workbench: personalShell service does not expose Workbench controls')
  }
  return candidate as PersonalShellWorkbench
}