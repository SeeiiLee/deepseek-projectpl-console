/**
 * The sole adapter between this feature and personal-foundation. Keep the
 * endpoint and transport assumptions here so the rest of the theme remains a
 * plain state/UI module.
 */
import {
  normalizeThemeDocument,
} from './theme-document.ts'
import type { ThemePersistence } from './controller.ts'

export const PERSONAL_THEME_ENDPOINT = '/__personal/api/theme'

interface JsonPersonalApi {
  request<T>(path: string, options?: {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
    body?: unknown
    signal?: AbortSignal
  }): Promise<T>
}

export function createThemePersistence(personalApi: unknown): ThemePersistence {
  const api = personalApi as JsonPersonalApi
  return {
    async read() {
      const value = await api.request<unknown>(PERSONAL_THEME_ENDPOINT, { method: 'GET' })
      return normalizeThemeDocument(unwrapDocument(value))
    },
    async write(document) {
      const value = await api.request<unknown>(PERSONAL_THEME_ENDPOINT, {
        method: 'PUT',
        body: document,
      })
      return normalizeThemeDocument(unwrapDocument(value) ?? document)
    },
  }
}

function unwrapDocument(value: unknown): unknown {
  if (!isRecord(value)) return value
  if ('document' in value) return value.document
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
