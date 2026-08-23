import { callPersonal, type PersonalApiService } from './personalApi.ts'

export type ConnectionKind = 'feishu-bot' | 'wechat-work-bot' | 'webhook' | 'mcp' | 'model' | 'memory-extraction' | 'personal-wechat'
export type McpTransport = 'streamable-http' | 'stdio'

export interface ConnectionItem {
  readonly id: string
  readonly label: string
  readonly kind: ConnectionKind
  readonly enabled: boolean
  /** Host-sanitized target label. Never use this value for a write. */
  readonly endpointDisplay: string
  readonly endpointConfigured: boolean
  readonly mcpTransport?: McpTransport
  readonly secretConfigured: boolean
  readonly canEdit: boolean
  readonly canDelete: boolean
}

export interface ConnectionInput {
  label: string
  kind: Exclude<ConnectionKind, 'personal-wechat'>
  enabled: boolean
  endpoint: string
  mcpTransport?: McpTransport
  /** Write-only. It is never populated from a server response. */
  secret?: string
}

export interface ConnectionCenterApi {
  list(signal?: AbortSignal): Promise<readonly ConnectionItem[]>
  create(input: ConnectionInput): Promise<void>
  update(item: ConnectionItem, patch: Partial<ConnectionInput>): Promise<void>
  remove(item: ConnectionItem): Promise<void>
}

type UnknownRecord = Record<string, unknown>

function record(value: unknown): UnknownRecord {
  return typeof value === 'object' && value !== null ? value as UnknownRecord : {}
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback
}

function boolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function normalizeKind(value: unknown): ConnectionKind {
  switch (value) {
    case 'feishu': case 'lark': case 'feishu-bot': return 'feishu-bot'
    case 'wecom': case 'wechat-work': case 'wechat-work-bot': return 'wechat-work-bot'
    case 'mcp': return 'mcp'
    case 'model': case 'llm': return 'model'
    case 'memory-extraction': return 'memory-extraction'
    case 'personal-wechat': case 'wechat-personal': return 'personal-wechat'
    default: return 'webhook'
  }
}

/** Last-resort display sanitizer for older Hosts that still return `endpoint`. */
function safeEndpointDisplay(value: string, kind: ConnectionKind, transport: McpTransport): string {
  if (value.length === 0) return ''
  if (kind === 'mcp' && transport === 'stdio') return value.split(/\s+/u)[0] ?? 'stdio command'
  try {
    const url = new URL(value)
    if (kind === 'mcp') return `${url.protocol}//${url.host}${url.pathname}`
    return `${url.protocol}//${url.host}/…`
  } catch {
    return '已配置目标（已隐藏）'
  }
}

function normalizeItem(value: unknown, index: number): ConnectionItem {
  const row = record(value)
  const config = record(row.config)
  const kind = normalizeKind(row.kind ?? row.type)
  const rawTransport = row.mcpTransport ?? row.transport ?? config.transport
  const mcpTransport = rawTransport === 'stdio' ? 'stdio' : 'streamable-http'
  const endpoint = text(row.endpoint,
    text(row.url, text(row.command, text(config.endpoint, text(config.url, text(config.command))))))
  const endpointDisplay = text(row.endpointDisplay,
    text(row.targetDisplay, safeEndpointDisplay(endpoint, kind, mcpTransport)))
  return {
    id: text(row.id, `connection-${index + 1}`),
    label: text(row.label, text(row.name, '未命名连接')),
    kind,
    enabled: boolean(row.enabled, false),
    endpointDisplay,
    endpointConfigured: boolean(row.endpointConfigured, boolean(row.targetConfigured, endpoint.length > 0)),
    ...(kind === 'mcp' ? { mcpTransport } : {}),
    secretConfigured: boolean(row.secretConfigured,
      boolean(row.hasSecret, boolean(row.credentialConfigured, false))),
    canEdit: boolean(row.canEdit, boolean(row.editable, kind !== 'personal-wechat')),
    canDelete: boolean(row.canDelete, boolean(row.deletable, kind !== 'personal-wechat')),
  }
}

function normalizeList(value: unknown): readonly ConnectionItem[] {
  const root = record(value)
  const rows = Array.isArray(value)
    ? value
    : Array.isArray(root.connections)
      ? root.connections
      : Array.isArray(root.items)
        ? root.items
        : []
  return rows.map(normalizeItem)
}

function mutationBody(input: Partial<ConnectionInput>): Record<string, unknown> {
  const body: Record<string, unknown> = { ...input }
  if (input.secret === undefined || input.secret.length === 0) delete body.secret
  return body
}

/** REST adapter that never derives or returns a credential value. */
export function createConnectionCenterApi(api: PersonalApiService): ConnectionCenterApi {
  return {
    async list(signal) {
      return normalizeList(await callPersonal<unknown>(api, 'GET', '/connections', undefined, signal))
    },
    async create(input) {
      await callPersonal(api, 'POST', '/connections', mutationBody(input))
    },
    async update(item, patch) {
      await callPersonal(api, 'PUT', '/connections', { id: item.id, ...mutationBody(patch) })
    },
    async remove(item) {
      await callPersonal(api, 'DELETE', '/connections', { id: item.id })
    },
  }
}
