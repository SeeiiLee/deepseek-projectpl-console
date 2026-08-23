import { useMemo, useSyncExternalStore } from 'react'
import { getActiveWorkbench } from './index.ts'

const API_PREFIX = '/__personal/workspace'
const PROJECT_CONTROL_API_PREFIX = '/__personal/project-control/v1alpha1'

export interface WorkspaceStatus {
  workspaceRoot: string
}

export interface WorkspaceEntry {
  name: string
  kind: 'directory' | 'file'
  byteSize?: number
}

export interface WorkspaceTree {
  entries: readonly WorkspaceEntry[]
  truncated: boolean
}

export type WorkspaceFile =
  | { kind: 'text'; content: string; truncated: boolean; byteSize: number; sha256: string }
  | { kind: 'binary'; byteSize: number; tooLarge?: boolean; mime: string }

export interface WorkspaceSaveResult {
  path: string
  sha256: string
  byteSize: number
}

interface ApiEnvelope<T> {
  ok: boolean
  data?: T
  error?: { code?: string; message?: string }
}

export class WorkspaceApiError extends Error {
  readonly code: string
  readonly status: number
  constructor(message: string, code: string, status: number) {
    super(message)
    this.name = 'WorkspaceApiError'
    this.code = code
    this.status = status
  }
}

export interface WorkspaceSearchResult { path: string; name: string }

export interface BrowserProbeResult { embeddable: 'ok' | 'blocked' | 'unknown'; reason?: string; status?: number }

export interface WorkspaceApi {
  status(signal?: AbortSignal): Promise<WorkspaceStatus>
  search(query: string, signal?: AbortSignal): Promise<{ results: readonly WorkspaceSearchResult[]; truncated: boolean }>
  tree(path: string, signal?: AbortSignal): Promise<WorkspaceTree>
  file(path: string, signal?: AbortSignal): Promise<WorkspaceFile>
  save(path: string, content: string, expectedSha256: string | undefined, signal?: AbortSignal): Promise<WorkspaceSaveResult>
  blob(path: string, signal?: AbortSignal): Promise<Blob>
  /** Browser 嵌入性探测（Host 侧取响应头；失败返回 unknown 而不抛错）。 */
  browserProbe(url: string, signal?: AbortSignal): Promise<BrowserProbeResult>
}

export function createWorkspaceApi(options: { root?: string; fetchImpl?: typeof fetch } = {}): WorkspaceApi {
  const fetchImpl = options.fetchImpl ?? fetch
  // 根据 path 是否已有 query 决定用 ?root= 还是 &root=
  const withRoot = (path: string): string => {
    if (options.root === undefined) return path
    const separator = path.includes('?') ? '&' : '?'
    return path + separator + 'root=' + encodeURIComponent(options.root)
  }
  // status/blob 无既有 query，需要 '?' 前缀
  const rootQuery = options.root === undefined ? '' : '?root=' + encodeURIComponent(options.root)
  const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const response = await fetchImpl(API_PREFIX + withRoot(path), {
      ...init,
      cache: 'no-store',
      headers: {
        'x-dsh-personal-workspace': '1',
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...init.headers,
      },
    })
    const envelope = await response.json() as ApiEnvelope<T>
    if (!response.ok || !envelope.ok || envelope.data === undefined) {
      throw new WorkspaceApiError(
        envelope.error?.message ?? `工作区请求失败（HTTP ${String(response.status)}）。`,
        envelope.error?.code ?? 'HTTP_ERROR',
        response.status,
      )
    }
    return envelope.data
  }

  return {
    status: signal => request<WorkspaceStatus>('/status' + rootQuery, signal === undefined ? {} : { signal }),
    search: (query, signal) => request<{ results: readonly WorkspaceSearchResult[]; truncated: boolean }>('/search?q=' + encodeURIComponent(query), signal === undefined ? {} : { signal }),
    tree: (path, signal) => request<WorkspaceTree>('/tree?path=' + encodeURIComponent(path), signal === undefined ? {} : { signal }),
    file: (path, signal) => request<WorkspaceFile>('/file?path=' + encodeURIComponent(path), signal === undefined ? {} : { signal }),
    save: (path, content, expectedSha256, signal) => request<WorkspaceSaveResult>('/save', {
      method: 'POST',
      body: JSON.stringify({
        path,
        content,
        ...(expectedSha256 === undefined ? {} : { expectedSha256 }),
      }),
      ...(signal === undefined ? {} : { signal }),
    }),
    blob: async (path, signal) => {
      const response = await fetchImpl(API_PREFIX + withRoot('/blob?path=' + encodeURIComponent(path)), {
        cache: 'no-store',
        headers: { 'x-dsh-personal-workspace': '1' },
        ...(signal === undefined ? {} : { signal }),
      })
      if (!response.ok) throw new WorkspaceApiError('文件读取失败。', 'HTTP_ERROR', response.status)
      return response.blob()
    },
    browserProbe: async (targetUrl, signal) => {
      try {
        return await request<BrowserProbeResult>('/browser-probe?url=' + encodeURIComponent(targetUrl), signal === undefined ? {} : { signal })
      } catch {
        // 探测失败（不可达/超时）不阻断浏览：保持普通 iframe，由浏览器自己报错。
        return { embeddable: 'unknown', reason: 'probe-failed' }
      }
    },
  }
}

/** 控制台选中项目的工作区 API（只读：状态/目录树/文件/blob；保存被拒绝）。 */
export function createProjectWorkspaceApi(projectId: string, fetchImpl: typeof fetch = fetch): WorkspaceApi {
  const base = PROJECT_CONTROL_API_PREFIX + '/projects/' + encodeURIComponent(projectId) + '/workspace'
  const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const response = await fetchImpl(base + path, {
      ...init,
      cache: 'no-store',
      headers: {
        'x-dsh-personal-client': '1',
        ...init.headers,
      },
    })
    const envelope = await response.json() as ApiEnvelope<T>
    if (!response.ok || !envelope.ok || envelope.data === undefined) {
      throw new WorkspaceApiError(
        envelope.error?.message ?? `项目工作区请求失败（HTTP ${String(response.status)}）。`,
        envelope.error?.code ?? 'HTTP_ERROR',
        response.status,
      )
    }
    return envelope.data
  }

  return {
    status: async (signal) => {
      const data = await request<{ projectId: string; root: string }>('/status', signal === undefined ? {} : { signal })
      return { workspaceRoot: data.root }
    },
    search: (query, signal) => request<{ results: readonly WorkspaceSearchResult[]; truncated: boolean }>('/search?q=' + encodeURIComponent(query), signal === undefined ? {} : { signal }),
    tree: (path, signal) => request<WorkspaceTree>('/tree?path=' + encodeURIComponent(path), signal === undefined ? {} : { signal }),
    file: (path, signal) => request<WorkspaceFile>('/file?path=' + encodeURIComponent(path), signal === undefined ? {} : { signal }),
    save: async (path, content, expectedSha256) => {
      // 项目工作区读取走 project-control 有界接口；保存复用通用 workspace 的
      // 同根写能力（带 expectedSha256 冲突检测与 symlink 逃逸防护）。
      const data = await request<{ projectId: string; root: string }>('/status', {})
      const generic = createWorkspaceApi({ root: data.root })
      return generic.save(path, content, expectedSha256)
    },
    blob: async (path, signal) => {
      const response = await fetchImpl(base + '/blob?path=' + encodeURIComponent(path), {
        cache: 'no-store',
        headers: { 'x-dsh-personal-client': '1' },
        ...(signal === undefined ? {} : { signal }),
      })
      if (!response.ok) throw new WorkspaceApiError('文件读取失败。', 'HTTP_ERROR', response.status)
      return response.blob()
    },
    // 嵌入探测与项目无关，复用通用 workspace 路由。
    browserProbe: (targetUrl, signal) => createWorkspaceApi().browserProbe(targetUrl, signal),
  }
}

/** 指定项目工作区 API；未指定时回落到「当前绑定」环境 API。显式根（根外文件预览）优先于项目绑定。 */
export function useWorkspaceApiFor(projectId: string | undefined, explicitRoot?: string): { api: WorkspaceApi; boundProjectId: string | undefined } {
  const ambient = useWorkspaceApi()
  const api = useMemo(() => {
    if (explicitRoot !== undefined && explicitRoot !== '') return createWorkspaceApi({ root: explicitRoot })
    return projectId === undefined ? ambient.api : createProjectWorkspaceApi(projectId)
  }, [projectId, explicitRoot, ambient.api])
  return { api, boundProjectId: projectId ?? ambient.boundProjectId }
}

/** 当前工作区 API：控制台选中项目 → 项目工作区；否则 → 会话工作区。 */
export function useWorkspaceApi(): { api: WorkspaceApi; boundProjectId: string | undefined } {
  const workbench = getActiveWorkbench()
  const snapshot = useSyncExternalStore(
    workbench?.subscribe ?? (() => () => {}),
    workbench?.getSnapshot ?? (() => null),
    workbench?.getSnapshot ?? (() => null),
  )
  const projectWorkspace = snapshot?.projectWorkspace
  const context = snapshot?.context
  const api = useMemo(() => {
    // 三态：控制台/匹配项目 → 项目 API；会话工作区（显式根）→ 按根会话 API；否则默认 Host 根。
    if (projectWorkspace !== undefined) return createProjectWorkspaceApi(projectWorkspace.projectId)
    if (context?.primaryPath !== undefined) return createWorkspaceApi({ root: context.primaryPath })
    return createWorkspaceApi()
  }, [projectWorkspace?.projectId, context?.primaryPath])
  return { api, boundProjectId: projectWorkspace?.projectId }
}

export function workspacePath(resourceKey: string | undefined, prefix: string): string | null {
  if (resourceKey === undefined || !resourceKey.startsWith(prefix)) return null
  const path = resourceKey.slice(prefix.length)
  if (path === '' || path.includes('\u0000')) return null
  return path
}
