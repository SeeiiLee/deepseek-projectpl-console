// P3-2 项目绑定桥：Project Control 控制台打开/离开项目时，把「当前会话 ↔ 项目」绑定写进记忆插件，
// 同时幂等登记项目分片（新增项目自动适配，决策③）。只接受本地控制台（x-dsh-console 头）。
import type { IncomingMessage, ServerResponse } from 'node:http'

export const MEMORY_CONTEXT_API_PREFIX = '/__personal/memory/context'
export const MAX_CONTEXT_BODY_BYTES = 4096
const MAX_BINDINGS = 256
const MAX_SESSION_ID_CHARS = 200
const MAX_PROJECT_ID_CHARS = 200

export interface MemoryProjectRegistry {
  registerProject(projectId: string): { projectId: string; shardLocator: string }
}

export interface MemoryContextRuntime {
  service: MemoryProjectRegistry
  bindings: Map<string, string | undefined>
}

function contextError(code: string, message: string, status = 400): Error {
  return Object.assign(new Error(message), { code, status, expose: true })
}

/** 导出为可测 HTTP 处理器（与 image-vision 同构）。 */
export function createMemoryContextRequestHandler(runtime: MemoryContextRuntime) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    try {
      if (request.headers['x-dsh-console'] !== '1') {
        throw contextError('CONSOLE_CLIENT_REQUIRED', '此接口只供个人桌面项目控制台使用。', 403)
      }
      if ((request.method ?? 'GET') !== 'POST') {
        throw contextError('METHOD_NOT_ALLOWED', '此接口只支持 POST。', 405)
      }
      const body = await readJsonBody(request, MAX_CONTEXT_BODY_BYTES)
      const sessionId = boundedField(body.sessionId, MAX_SESSION_ID_CHARS)
      if (sessionId === '') throw contextError('INVALID_BODY', '缺少 sessionId。')
      const raw = body.projectId
      let projectId: string | undefined
      if (raw !== null && raw !== undefined && raw !== '') {
        if (typeof raw !== 'string') throw contextError('INVALID_BODY', 'projectId 非法。')
        projectId = raw.trim()
        if (projectId === '' || projectId.length > MAX_PROJECT_ID_CHARS) throw contextError('INVALID_BODY', 'projectId 非法。')
        if (projectId.includes('/') || projectId.includes('\\') || projectId === '.' || projectId === '..') {
          throw contextError('INVALID_BODY', 'projectId 非法。')
        }
        runtime.service.registerProject(projectId) // 幂等：新增项目自动适配
      }
      runtime.bindings.set(sessionId, projectId)
      pruneBindings(runtime.bindings)
      sendJson(response, 200, { ok: true, data: { sessionId, projectId: projectId ?? null } })
    } catch (error) {
      const status = errorStatus(error)
      sendJson(response, status, {
        ok: false,
        error: {
          code: errorCode(error, status),
          message: status >= 500 ? '记忆绑定服务请求失败。' : messageOf(error),
        },
      })
    }
  }
}

function pruneBindings(bindings: Map<string, string | undefined>): void {
  while (bindings.size > MAX_BINDINGS) {
    const first = bindings.keys().next().value
    if (first === undefined) break
    bindings.delete(first)
  }
}

function boundedField(value: unknown, maxLength: number): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > maxLength) return ''
  return value.trim()
}

async function readJsonBody(request: IncomingMessage, maximum: number): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  const declared = Number(request.headers['content-length'] ?? 0)
  if (Number.isFinite(declared) && declared > maximum) throw contextError('BODY_TOO_LARGE', '请求正文过大。', 413)
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > maximum) throw contextError('BODY_TOO_LARGE', '请求正文过大。', 413)
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw contextError('INVALID_BODY', '请求正文必须是对象。')
    }
    return parsed as Record<string, unknown>
  } catch (error) {
    if (error instanceof Error && 'code' in error && typeof (error as { code?: unknown }).code === 'string') throw error
    throw contextError('INVALID_BODY', '请求正文不是有效 JSON。')
  }
}

function errorStatus(error: unknown): number {
  const status = (error as { status?: unknown } | null)?.status
  return typeof status === 'number' && status >= 400 && status <= 599 ? status : 500
}

function errorCode(error: unknown, status: number): string {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' && code !== '' ? code : status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST'
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message.trim() !== '' ? error.message : '请求失败。'
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  if (response.headersSent) return
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  response.end(JSON.stringify(value))
}
