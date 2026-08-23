export interface PersonalApiService {
  request<T>(path: string, options?: { method?: string; body?: unknown; signal?: AbortSignal }): Promise<T>
}

export function requirePersonalApi(value: unknown): PersonalApiService {
  if (typeof value !== 'object' || value === null) throw new Error('personalApi service is unavailable')
  const api = value as PersonalApiService
  if (typeof api.request !== 'function') {
    throw new Error('personalApi service has no request method')
  }
  return api
}

export async function getPersonal<T>(api: PersonalApiService, path: string, signal?: AbortSignal): Promise<T> {
  return api.request<T>(path, { method: 'GET', ...(signal === undefined ? {} : { signal }) })
}

export async function putPersonal<T>(api: PersonalApiService, path: string, body: unknown): Promise<T> {
  return api.request<T>(path, { method: 'PUT', body })
}
