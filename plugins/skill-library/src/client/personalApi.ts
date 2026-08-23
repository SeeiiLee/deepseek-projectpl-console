/** The narrow foundation service surface used by this plugin. */
export interface PersonalApiService {
  request<T>(path: string, options?: PersonalRequestOptions): Promise<T>
}

interface PersonalRequestOptions {
  method?: string
  body?: unknown
  signal?: AbortSignal
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE'

/** Fail clearly when the foundation package is not mounted. */
export function requirePersonalApi(value: unknown): PersonalApiService {
  if (typeof value !== 'object' || value === null) {
    throw new Error('personalApi service is unavailable')
  }
  const api = value as PersonalApiService
  if (typeof api.request !== 'function') {
    throw new Error('personalApi service has no request method')
  }
  return api
}

/** Keep all foundation-call compatibility in one small adapter. */
export async function callPersonalApi<T>(
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
