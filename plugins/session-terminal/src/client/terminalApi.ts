const API_PREFIX = '/__personal/terminal'

export type TerminalStatus =
  | { kind: 'running' }
  | { kind: 'exited'; exitCode: number | null; signal: string | null }
  | { kind: 'failed'; message: string }

export interface TerminalSnapshot {
  terminalId: string
  sessionId: string
  name: string
  cwd: string
  pid?: number
  createdAt: number
  status: TerminalStatus
  cursor: number
  history: readonly string[]
}

export interface TerminalReadResult {
  terminal: TerminalSnapshot
  output: string
  cursor: number
  truncated: boolean
}

export interface SessionTerminalApi {
  list(sessionId: string): Promise<readonly TerminalSnapshot[]>
  open(sessionId: string): Promise<TerminalSnapshot>
  read(sessionId: string, terminalId: string, cursor: number): Promise<TerminalReadResult>
  write(sessionId: string, terminalId: string, text: string): Promise<TerminalSnapshot>
  clear(sessionId: string, terminalId: string): Promise<{ cursor: number }>
  interrupt(sessionId: string, terminalId: string): Promise<{ delivered: boolean }>
  restart(sessionId: string, terminalId: string): Promise<TerminalSnapshot>
  close(sessionId: string, terminalId: string): Promise<{ closed: string }>
}

interface ApiEnvelope<T> {
  ok: boolean
  data?: T
  error?: { code?: string; message?: string }
}

/** Same-origin JSON client; the custom header prevents ordinary cross-origin form posts. */
export function createSessionTerminalApi(fetchImpl: typeof fetch = fetch): SessionTerminalApi {
  const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetchImpl(API_PREFIX + path, {
      ...init,
      cache: 'no-store',
      headers: {
        'x-dsh-personal-terminal': '1',
        ...(init?.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...init?.headers,
      },
    })
    const envelope = await response.json() as ApiEnvelope<T>
    if (!response.ok || !envelope.ok || envelope.data === undefined) {
      throw new Error(envelope.error?.message ?? `终端请求失败（HTTP ${response.status}）。`)
    }
    return envelope.data
  }
  const mutate = <T>(path: string, method: 'POST' | 'DELETE', body: Record<string, unknown>): Promise<T> =>
    request<T>(path, { method, body: JSON.stringify(body) })
  return {
    async list(sessionId) {
      const result = await request<{ terminals: TerminalSnapshot[] }>(`/tabs?sessionId=${encodeURIComponent(sessionId)}`)
      return result.terminals
    },
    open: sessionId => mutate('/tabs', 'POST', { sessionId }),
    read: (sessionId, terminalId, cursor) => request(
      `/output?sessionId=${encodeURIComponent(sessionId)}&terminalId=${encodeURIComponent(terminalId)}&cursor=${cursor}`,
    ),
    write: (sessionId, terminalId, text) => mutate('/input', 'POST', { sessionId, terminalId, text, submit: true }),
    clear: (sessionId, terminalId) => mutate('/clear', 'POST', { sessionId, terminalId }),
    interrupt: (sessionId, terminalId) => mutate('/interrupt', 'POST', { sessionId, terminalId }),
    restart: (sessionId, terminalId) => mutate('/restart', 'POST', { sessionId, terminalId }),
    close: (sessionId, terminalId) => mutate('/tabs', 'DELETE', { sessionId, terminalId }),
  }
}
