interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: unknown
  signal?: AbortSignal
}

interface SuccessEnvelope<T> { ok: true; data: T }
interface ErrorEnvelope { ok: false; error: { code: string; message: string } }

export interface PersonalApi {
  request<T>(path: string, options?: RequestOptions): Promise<T>
}

interface ClientContextLike {
  provide(name: string, value: unknown): void
}

export const inject: string[] = []

export function apply(ctx: ClientContextLike): void {
  const api: PersonalApi = {
    async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
      const target = normalizePath(path)
      const response = await fetch(target, {
        method: options.method ?? 'GET',
        headers: {
          'accept': 'application/json',
          'x-dsh-personal-client': '1',
          ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        credentials: 'same-origin',
      })
      const payload = await response.json() as SuccessEnvelope<T> | ErrorEnvelope
      if (!response.ok || payload.ok !== true) {
        const error = payload.ok === false ? payload.error : { code: 'HTTP_ERROR', message: `HTTP ${String(response.status)}` }
        throw Object.assign(new Error(error.message), { code: error.code, status: response.status })
      }
      return payload.data
    },
  }
  ctx.provide('personalApi', api)
}

export function normalizePath(path: string): string {
  if (path === '/__personal/api' || path.startsWith('/__personal/api/')) return path
  if (!path.startsWith('/')) throw new TypeError('personalApi path must begin with "/"')
  return `/__personal/api${path}`
}
