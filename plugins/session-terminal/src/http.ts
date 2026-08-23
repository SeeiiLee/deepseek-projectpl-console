import type { IncomingMessage, ServerResponse } from 'node:http'
import type { TerminalManager } from './terminal-runtime.ts'
import { terminalError } from './terminal-runtime.ts'

export const TERMINAL_API_PREFIX = '/__personal/terminal'
export const MAX_BODY_BYTES = 65_536

/** Create the loopback JSON handler without starting Harness. */
export function createTerminalRequestHandler(manager: TerminalManager) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    try {
      if (request.headers['x-dsh-personal-terminal'] !== '1') {
        throw terminalError('TERMINAL_CLIENT_REQUIRED', '此接口只供个人桌面终端使用。', 403)
      }
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      if (!url.pathname.startsWith(TERMINAL_API_PREFIX)) throw terminalError('NOT_FOUND', '终端接口不存在。', 404)
      const resource = url.pathname.slice(TERMINAL_API_PREFIX.length)
      const method = request.method ?? 'GET'
      const body = method === 'GET' ? {} : record(await readJsonBody(request))
      const data = await dispatch(manager, resource, method, url.searchParams, body)
      sendJson(response, 200, { ok: true, data })
    } catch (error) {
      const status = errorStatus(error)
      sendJson(response, status, {
        ok: false,
        error: {
          code: errorCode(error, status),
          message: status >= 500 ? safeServerMessage(error) : errorMessage(error),
        },
      })
    }
  }
}

async function dispatch(
  manager: TerminalManager,
  resource: string,
  method: string,
  query: URLSearchParams,
  body: Record<string, unknown>,
): Promise<unknown> {
  if (resource === '/tabs' && method === 'GET') return { terminals: manager.list(sessionId(query.get('sessionId'))) }
  if (resource === '/tabs' && method === 'POST') {
    return manager.open(sessionId(body.sessionId), optionalText(body.name, 80))
  }
  if (resource === '/tabs' && method === 'DELETE') {
    return manager.close(sessionId(body.sessionId), terminalId(body.terminalId))
  }
  if (resource === '/output' && method === 'GET') {
    return manager.read(sessionId(query.get('sessionId')), terminalId(query.get('terminalId')), cursor(query.get('cursor')))
  }
  if (resource === '/input' && method === 'POST') {
    if (typeof body.text !== 'string') throw terminalError('INVALID_TERMINAL_INPUT', '终端输入必须是文本。')
    return manager.write(sessionId(body.sessionId), terminalId(body.terminalId), body.text, body.submit !== false)
  }
  if (resource === '/clear' && method === 'POST') {
    return manager.clear(sessionId(body.sessionId), terminalId(body.terminalId))
  }
  if (resource === '/interrupt' && method === 'POST') {
    return manager.interrupt(sessionId(body.sessionId), terminalId(body.terminalId))
  }
  if (resource === '/restart' && method === 'POST') {
    return manager.restart(sessionId(body.sessionId), terminalId(body.terminalId))
  }
  if (['/tabs', '/output', '/input', '/clear', '/interrupt', '/restart'].includes(resource)) {
    throw terminalError('METHOD_NOT_ALLOWED', '此终端接口不支持该请求方法。', 405)
  }
  throw terminalError('NOT_FOUND', '终端接口不存在。', 404)
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const declared = Number(request.headers['content-length'] ?? 0)
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw terminalError('BODY_TOO_LARGE', '终端请求内容过大。', 413)
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw terminalError('BODY_TOO_LARGE', '终端请求内容过大。', 413)
    chunks.push(buffer)
  }
  if (size === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw terminalError('INVALID_JSON', '终端请求不是有效的 JSON。')
  }
}

function sessionId(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 300 || /[\u0000-\u001f]/u.test(value)) {
    throw terminalError('INVALID_SESSION_ID', '会话标识无效。')
  }
  return value
}

function terminalId(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 120 || !/^[a-zA-Z0-9_-]+$/u.test(value)) {
    throw terminalError('INVALID_TERMINAL_ID', '终端标识无效。')
  }
  return value
}

function cursor(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw terminalError('INVALID_CURSOR', '终端游标无效。')
  return parsed
}

function optionalText(value: unknown, maxLength: number): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length > maxLength) throw terminalError('INVALID_TEXT', '文本字段无效。')
  return value
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw terminalError('INVALID_BODY', '终端请求正文必须是 JSON 对象。')
  return value as Record<string, unknown>
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

function errorStatus(error: unknown): number {
  const status = (error as { status?: unknown } | null)?.status
  return typeof status === 'number' && status >= 400 && status <= 599 ? status : 500
}

function errorCode(error: unknown, status: number): string {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' && code !== '' ? code : status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST'
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message !== '' ? error.message : '终端请求失败。'
}

function safeServerMessage(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code
  if (code === 'POWERSHELL_NOT_FOUND' || code === 'TERMINAL_DISPOSING') return errorMessage(error)
  return '终端服务请求失败。'
}
