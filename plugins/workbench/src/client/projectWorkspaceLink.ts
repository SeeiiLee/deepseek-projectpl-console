// 原生侧栏工作区 → 项目控制台 → 右侧工作台文件树 联动（v1，只读）。
// 订阅上游 sessions.list / workspaces.list：当前会话的工作区路径变化时，
// 与 Project Control 已登记项目的根目录做归一化匹配（大小写不敏感、去尾分隔符、
// 分隔符边界前缀、最长根优先），匹配到 → workbench.setProjectWorkspace，
// 匹配不到 → clearProjectWorkspace。项目根列表通过只读 Host API 获取
// （/projects + 按 updatedAt 缓存的 /projects/{id}/workspace/status），不写数据库。
// 控制台「打开控制台」继续可用：两者写同一份绑定状态，后操作者覆盖
// （拉取期间绑定被控制台改写时放弃本次应用，保持 last-write-wins）。

const PROJECT_CONTROL_API_PREFIX = '/__personal/project-control/v1alpha1'

interface StoreLike<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

/** sessions.list 的最小结构面（只读）。current 显式 union：与上游 exactOptionalPropertyTypes 兼容。 */
export interface SessionListFace {
  current: string | undefined
  byId: Readonly<Record<string, { cwd?: string }>>
}

/** workspaces.list 的最小结构面（只读）。 */
export interface WorkspaceListFace {
  items: readonly { workspaceId: string; path: string; sessionIds: readonly string[] }[]
}

/** 联动需要的 workbench 最小结构面（只读）。 */
export interface ProjectWorkspaceBindingFace {
  getSnapshot(): { projectWorkspace?: { projectId: string; root: string } }
  setProjectWorkspace(projectId: string, root: string): void
  clearProjectWorkspace(): void
}

export interface ProjectWorkspaceLinkInput {
  sessions: { list: StoreLike<SessionListFace> }
  workspaces: { list: StoreLike<WorkspaceListFace> }
  workbench: ProjectWorkspaceBindingFace
  fetchImpl?: typeof fetch
}

interface ProjectRootEntry {
  projectId: string
  root: string
  updatedAt: string
}

/** 归一化：大小写不敏感、两种分隔符统一为反斜杠、去尾分隔符。 */
export function canonicalPath(raw: string): string {
  let path = raw.trim()
  while (path.endsWith('\\') || path.endsWith('/')) path = path.slice(0, -1)
  return path.toLowerCase().replace(/\//g, '\\')
}

/**
 * 会话工作区路径匹配项目根：相等或处于根目录内（分隔符边界），多根命中时最长者优先。
 * @returns 命中的项目根，无命中为 undefined。
 */
export function matchProjectRoot(
  workspacePath: string,
  roots: readonly { projectId: string; root: string }[],
): { projectId: string; root: string } | undefined {
  const target = canonicalPath(workspacePath)
  if (target === '') return undefined
  let best: { projectId: string; root: string } | undefined
  let bestLength = -1
  for (const entry of roots) {
    const root = canonicalPath(entry.root)
    if (root === '') continue
    if (target !== root && !target.startsWith(root + '\\')) continue
    if (root.length > bestLength) {
      best = entry
      bestLength = root.length
    }
  }
  return best
}

interface ProjectListEnvelope {
  ok?: unknown
  data?: {
    projects?: readonly { projectId?: unknown; updatedAt?: unknown }[]
  }
}

interface WorkspaceStatusEnvelope {
  ok?: unknown
  data?: { root?: unknown }
}

/**
 * 安装联动：返回 dispose。依赖注入使得纯逻辑可在 node --test 下验证。
 */
export function installProjectWorkspaceLink(input: ProjectWorkspaceLinkInput): () => void {
  const { sessions, workspaces, workbench } = input
  const fetchImpl: typeof fetch | undefined = input.fetchImpl ?? globalThis.fetch
  let roots: ProjectRootEntry[] = []
  let generation = 0
  let signature: string | undefined

  const currentWorkspacePath = (): string | undefined => {
    const sessionList = sessions.list.getSnapshot()
    const current = sessionList.current
    if (current === undefined) return undefined
    const membership = workspaces.list.getSnapshot().items.find(item => item.sessionIds.includes(current))?.path
    if (membership !== undefined && membership !== '') return membership
    return sessionList.byId[current]?.cwd
  }

  const apply = (match: { projectId: string; root: string } | undefined): void => {
    if (match === undefined) workbench.clearProjectWorkspace()
    else workbench.setProjectWorkspace(match.projectId, match.root)
  }

  const recompute = (): void => {
    const workspacePath = currentWorkspacePath()
    const next = String(sessions.list.getSnapshot().current ?? '') + '\u0000' + String(workspacePath ?? '')
    if (next === signature) return
    signature = next
    generation += 1
    const myGeneration = generation
    if (typeof fetchImpl !== 'function') return
    if (workspacePath === undefined || workspacePath === '') {
      apply(undefined)
      return
    }
    // 只比较绑定字段本身：页签/布局发布不会产生新的 projectWorkspace 引用，
    // 只有 set/clearProjectWorkspace（控制台动作）才会改变它。
    const bindingAtStart = workbench.getSnapshot().projectWorkspace
    void refreshRoots(fetchImpl)
      .then(() => {
        if (myGeneration !== generation) return
        if (workbench.getSnapshot().projectWorkspace !== bindingAtStart) return
        apply(matchProjectRoot(workspacePath, roots))
      })
      .catch(() => {
        // 拉取失败保持现有绑定（不因瞬时故障覆盖控制台动作）。
      })
  }

  const handler = (): void => { recompute() }
  const offSessions = sessions.list.subscribe(handler)
  const offWorkspaces = workspaces.list.subscribe(handler)
  handler()
  return () => {
    offSessions()
    offWorkspaces()
  }

  async function refreshRoots(fetcher: typeof fetch): Promise<void> {
    const response = await fetcher(PROJECT_CONTROL_API_PREFIX + '/projects', {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { accept: 'application/json', 'x-dsh-personal-client': '1' },
    })
    const envelope = await response.json() as ProjectListEnvelope
    if (envelope?.ok !== true || !Array.isArray(envelope?.data?.projects)) {
      throw new Error('project-control: 项目列表不可用')
    }
    const nextRoots: ProjectRootEntry[] = []
    for (const item of envelope.data.projects) {
      const projectId = typeof item?.projectId === 'string' ? item.projectId : ''
      const updatedAt = typeof item?.updatedAt === 'string' ? item.updatedAt : ''
      if (projectId === '') continue
      const cached = roots.find(entry => entry.projectId === projectId)
      if (cached !== undefined && cached.updatedAt === updatedAt) {
        nextRoots.push(cached)
        continue
      }
      const root = await fetchWorkspaceRoot(fetcher, projectId)
      if (root !== undefined) nextRoots.push({ projectId, root, updatedAt })
    }
    roots = nextRoots
  }

  async function fetchWorkspaceRoot(fetcher: typeof fetch, projectId: string): Promise<string | undefined> {
    try {
      const response = await fetcher(
        PROJECT_CONTROL_API_PREFIX + '/projects/' + encodeURIComponent(projectId) + '/workspace/status',
        {
          cache: 'no-store',
          credentials: 'same-origin',
          headers: { accept: 'application/json', 'x-dsh-personal-client': '1' },
        },
      )
      const envelope = await response.json() as WorkspaceStatusEnvelope
      if (envelope?.ok !== true || typeof envelope?.data?.root !== 'string' || envelope.data.root === '') {
        return undefined
      }
      return envelope.data.root
    } catch {
      return undefined
    }
  }
}
