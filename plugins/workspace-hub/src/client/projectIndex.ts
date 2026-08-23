/**
 * W1 Task D：Project Control 紧凑工作区索引与「会话工作区 → 项目根」匹配。
 * 一次 GET /projects/workspace-index 消除旧联动的 N+1；按 updatedAt 指纹缓存避免重复拉取。
 * 匹配结果只作为 Context 投影建议（不写库、不建立 binding；W3 才正式化 Project↔Workspace 绑定）。
 */
import { canonicalPath } from './adapter.ts'

const PROJECT_CONTROL_API_PREFIX = '/__personal/project-control/v1alpha1'

export interface ProjectRootEntry {
  projectId: string
  root: string
  updatedAt: string
}

export interface ProjectIndexEnvelope {
  ok?: unknown
  data?: { projects?: readonly { projectId?: unknown; root?: unknown; updatedAt?: unknown }[] }
}

/**
 * 会话工作区路径匹配项目根：相等或处于根目录内（分隔符边界），多根命中时最长者优先。
 * 与旧 projectWorkspaceLink 同规则（W3 前保持兼容行为）。
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

/** 拉取紧凑索引（条件请求：带 etag 时 304 返回 null，零状态更新）。 */
export async function fetchProjectIndex(
  fetchImpl: typeof fetch,
  etag?: string,
): Promise<{ projects: readonly ProjectRootEntry[]; etag?: string } | null> {
  const response = await fetchImpl(PROJECT_CONTROL_API_PREFIX + '/projects/workspace-index', {
    cache: 'no-store',
    credentials: 'same-origin',
    headers: {
      accept: 'application/json',
      'x-dsh-personal-client': '1',
      ...(etag === undefined ? {} : { 'if-none-match': etag }),
    },
  })
  if (response.status === 304) return null
  const envelope = await response.json() as ProjectIndexEnvelope
  if (envelope?.ok !== true || !Array.isArray(envelope?.data?.projects)) {
    throw new Error('project-control: 工作区索引不可用')
  }
  const projects: ProjectRootEntry[] = []
  for (const item of envelope.data.projects) {
    const projectId = typeof item?.projectId === 'string' ? item.projectId : ''
    const root = typeof item?.root === 'string' ? item.root : ''
    const updatedAt = typeof item?.updatedAt === 'string' ? item.updatedAt : ''
    if (projectId === '' || root === '' || updatedAt === '') continue
    projects.push({ projectId, root, updatedAt })
  }
  const nextEtag = response.headers.get('etag')
  return nextEtag === null ? { projects } : { projects, etag: nextEtag }
}

/** 带指纹缓存的索引加载器：指纹（projectId+updatedAt 列表）不变则不重拉。 */
export class ProjectIndex {
  #roots: readonly ProjectRootEntry[] = []
  #fingerprint: string | undefined
  #etag: string | undefined
  #inflight: Promise<void> | undefined
  readonly #fetchImpl: typeof fetch

  constructor(fetchImpl: typeof fetch) {
    this.#fetchImpl = fetchImpl
  }

  roots(): readonly ProjectRootEntry[] {
    return this.#roots
  }

  fingerprint(): string {
    return JSON.stringify(this.#roots.map(entry => [entry.projectId, entry.updatedAt]))
  }

  /** 刷新（幂等）：指纹变化或首次才真正拉取；并发调用共享同一次拉取。 */
  async refresh(): Promise<void> {
    if (this.#inflight !== undefined) return this.#inflight
    this.#inflight = (async () => {
      const result = await fetchProjectIndex(this.#fetchImpl, this.#etag)
      if (result === null) return // 304：服务端未变化，零状态更新
      const fingerprint = JSON.stringify(result.projects.map(entry => [entry.projectId, entry.updatedAt]))
      if (fingerprint !== this.#fingerprint) {
        this.#roots = result.projects
        this.#fingerprint = fingerprint
      }
      if (result.etag !== undefined) this.#etag = result.etag
    })().finally(() => { this.#inflight = undefined })
    return this.#inflight
  }

  /** 强制重拉（例如显式刷新命令）。 */
  async forceRefresh(): Promise<void> {
    this.#fingerprint = undefined
    return this.refresh()
  }
}
