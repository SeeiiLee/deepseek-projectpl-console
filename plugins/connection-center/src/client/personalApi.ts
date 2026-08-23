export interface PersonalApiService {
  request<T>(path: string, options?: { method?: string; body?: unknown; signal?: AbortSignal }): Promise<T>
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE'

export function requirePersonalApi(value: unknown): PersonalApiService {
  if (typeof value !== 'object' || value === null) throw new Error('personalApi service is unavailable')
  const api = value as PersonalApiService
  if (typeof api.request !== 'function') {
    throw new Error('personalApi service has no request method')
  }
  return api
}

export async function callPersonal<T>(
  api: PersonalApiService,
  method: Method,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  return api.request<T>(path, {
    method,
    ...(body === undefined ? {} : { body }),
    ...(signal === undefined ? {} : { signal }),
  })
}
