const API_PREFIX = '/__personal/terminal'

export interface TerminalSnapshot {
  terminalId: string
  sessionId: string
  name: string
  cwd: string
  cursor: number
}

export interface TerminalReadResult {
  terminal: TerminalSnapshot
  output: string
  cursor: number
  truncated: boolean
}

interface ApiEnvelope<T> {
  ok: boolean
  data?: T
  error?: { code?: string; message?: string }
}

/** Minimal client bridge to the existing session-terminal Host PTYs. */
export function createSessionTerminalBridge(fetchImpl: typeof fetch = fetch) {
  const request = async <T>(path: string): Promise<T> => {
    const response = await fetchImpl(API_PREFIX + path, {
      cache: 'no-store',
      headers: { 'x-dsh-personal-terminal': '1' },
    })
    const envelope = await response.json() as ApiEnvelope<T>
    if (!response.ok || !envelope.ok || envelope.data === undefined) {
      throw new Error(envelope.error?.message ?? '终端请求失败。')
    }
    return envelope.data
  }
  const mutate = async <T>(path: string, body: Record<string, unknown>): Promise<T> => {
    const response = await fetchImpl(API_PREFIX + path, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'x-dsh-personal-terminal': '1', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const envelope = await response.json() as ApiEnvelope<T>
    if (!response.ok || !envelope.ok || envelope.data === undefined) {
      throw new Error(envelope.error?.message ?? '终端请求失败。')
    }
    return envelope.data
  }
  return {
    list: (sessionId: string) => request<{ terminals: TerminalSnapshot[] }>('/tabs?sessionId=' + encodeURIComponent(sessionId)).then(result => result.terminals),
    read: (sessionId: string, terminalId: string, cursor: number) => request<TerminalReadResult>('/output?sessionId=' + encodeURIComponent(sessionId) + '&terminalId=' + encodeURIComponent(terminalId) + '&cursor=' + String(cursor)),
    write: (sessionId: string, terminalId: string, text: string) => mutate('/input', { sessionId, terminalId, text, submit: true }),
  }
}