const API_PREFIX = '/__personal/image-vision'

export interface ModelConnectionSummary {
  id: string
  label: string
  enabled: boolean
  endpointConfigured: boolean
  secretConfigured: boolean
}

export interface ImageVisionResult {
  summary: string
  ocr: string
  uiAnalysis: string
  provider: string
  model: string
}

interface ApiEnvelope<T> {
  ok: boolean
  data?: T
  error?: { code?: string; message?: string }
}

export class ImageVisionApiError extends Error {
  readonly code: string
  readonly status: number
  constructor(message: string, code: string, status: number) {
    super(message)
    this.name = 'ImageVisionApiError'
    this.code = code
    this.status = status
  }
}

export interface ImageVisionApi {
  listConnections(signal?: AbortSignal): Promise<readonly ModelConnectionSummary[]>
  upload(sessionId: string, blob: Blob, signal?: AbortSignal): Promise<{ bytes: number; mimeType: string }>
  analyze(sessionId: string, connectionId: string, model: string, signal?: AbortSignal): Promise<{ result: ImageVisionResult; connectionLabel: string }>
}

export function createImageVisionApi(fetchImpl: typeof fetch = fetch): ImageVisionApi {
  const envelope = async <T>(response: Response): Promise<T> => {
    const payload = await response.json() as ApiEnvelope<T>
    if (!response.ok || !payload.ok || payload.data === undefined) {
      throw new ImageVisionApiError(
        payload.error?.message ?? `识图请求失败（HTTP ${String(response.status)}）。`,
        payload.error?.code ?? 'HTTP_ERROR',
        response.status,
      )
    }
    return payload.data
  }
  return {
    listConnections: async signal => {
      const response = await fetchImpl(API_PREFIX + '/connections', {
        cache: 'no-store',
        headers: { 'x-dsh-image-vision': '1' },
        ...(signal === undefined ? {} : { signal }),
      })
      const data = await envelope<{ connections: readonly ModelConnectionSummary[] }>(response)
      return data.connections
    },
    upload: async (sessionId, blob, signal) => {
      const response = await fetchImpl(API_PREFIX + '/upload', {
        method: 'POST',
        cache: 'no-store',
        headers: {
          'x-dsh-image-vision': '1',
          'x-session-id': sessionId,
          'content-type': blob.type === '' ? 'application/octet-stream' : blob.type,
        },
        body: blob,
        ...(signal === undefined ? {} : { signal }),
      })
      return envelope<{ bytes: number; mimeType: string }>(response)
    },
    analyze: async (sessionId, connectionId, model, signal) => {
      const response = await fetchImpl(API_PREFIX + '/analyze', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'x-dsh-image-vision': '1', 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, connectionId, model }),
        ...(signal === undefined ? {} : { signal }),
      })
      return envelope<{ result: ImageVisionResult; connectionLabel: string }>(response)
    },
  }
}