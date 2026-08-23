import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export interface ThemeConfig {
  fontFamily: string
  baseFontSize: number
  zoom: number
  accentColor: string
  backgroundColor: string
  sidebarColor: string
  textColor: string
  panelOpacity: number
}

export interface ThemeDocument {
  version: 1
  global: ThemeConfig
  workspaces: Record<string, ThemeConfig>
}

export interface OrganizerMetadata {
  category: string
  description: string
}

export type ConnectionKind = 'feishu-bot' | 'wechat-work-bot' | 'webhook' | 'mcp' | 'model' | 'memory-extraction' | 'personal-wechat'

export interface StoredConnection {
  id: string
  label: string
  kind: ConnectionKind
  enabled: boolean
  mcpTransport?: 'streamable-http' | 'stdio'
  endpointDisplay: string
  endpointRef: string
  secretRef: string
  createdAt: string
  updatedAt: string
}

export interface PersonalDocument {
  version: 1
  theme: ThemeDocument
  skillMetadata: Record<string, OrganizerMetadata>
  pluginMetadata: Record<string, OrganizerMetadata>
  connections: StoredConnection[]
}

export const DEFAULT_THEME: ThemeConfig = Object.freeze({
  fontFamily: 'Inter, "Segoe UI", "Microsoft YaHei UI", sans-serif',
  baseFontSize: 14,
  zoom: 1,
  accentColor: '#4d6bfe',
  backgroundColor: '#f7f8fa',
  sidebarColor: '#f1f2f5',
  textColor: '#171719',
  panelOpacity: 0.96,
})

export function defaultDocument(): PersonalDocument {
  return {
    version: 1,
    theme: { version: 1, global: { ...DEFAULT_THEME }, workspaces: {} },
    skillMetadata: {},
    pluginMetadata: {},
    connections: [],
  }
}

export function normalizeDocument(value: unknown): PersonalDocument {
  const source = record(value)
  return {
    version: 1,
    theme: normalizeTheme(source.theme),
    skillMetadata: normalizeMetadataMap(source.skillMetadata),
    pluginMetadata: normalizeMetadataMap(source.pluginMetadata),
    connections: Array.isArray(source.connections)
      ? source.connections.map(normalizeStoredConnection).filter((item): item is StoredConnection => item !== undefined)
      : [],
  }
}

export class PersonalStore {
  readonly filename: string
  private document: PersonalDocument | undefined
  private operations: Promise<void> = Promise.resolve()

  constructor(filename: string) {
    this.filename = filename
  }

  async read(): Promise<PersonalDocument> {
    if (this.document !== undefined) return structuredClone(this.document)
    let parsed: unknown
    try {
      parsed = JSON.parse(await readFile(this.filename, 'utf8'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      parsed = undefined
    }
    this.document = normalizeDocument(parsed)
    return structuredClone(this.document)
  }

  mutate<T>(operation: (draft: PersonalDocument) => T | Promise<T>): Promise<T> {
    let resolveResult!: (value: T | PromiseLike<T>) => void
    let rejectResult!: (reason?: unknown) => void
    const result = new Promise<T>((resolve, reject) => {
      resolveResult = resolve
      rejectResult = reject
    })
    const task = this.operations.then(async () => {
      try {
        const draft = await this.read()
        const value = await operation(draft)
        const normalized = normalizeDocument(draft)
        await writeJsonAtomic(this.filename, normalized)
        this.document = normalized
        resolveResult(value)
      } catch (error) {
        rejectResult(error)
      }
    })
    this.operations = task.catch(() => {})
    return result
  }
}

async function writeJsonAtomic(filename: string, value: unknown): Promise<void> {
  await mkdir(dirname(filename), { recursive: true })
  const temporary = join(dirname(filename), `.${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`)
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await rename(temporary, filename)
}

function normalizeTheme(value: unknown): ThemeDocument {
  const source = record(value)
  const global = normalizeThemeConfig(source.global, DEFAULT_THEME)
  const workspaces: Record<string, ThemeConfig> = {}
  for (const [key, config] of Object.entries(record(source.workspaces))) {
    const normalizedKey = key.trim().replace(/[\\/]+$/u, '').toLocaleLowerCase('en-US')
    if (normalizedKey !== '') workspaces[normalizedKey] = normalizeThemeConfig(config, global)
  }
  return { version: 1, global, workspaces }
}

function normalizeThemeConfig(value: unknown, fallback: Readonly<ThemeConfig>): ThemeConfig {
  const source = record(value)
  return {
    fontFamily: boundedText(source.fontFamily, fallback.fontFamily, 200),
    baseFontSize: boundedNumber(source.baseFontSize, fallback.baseFontSize, 12, 22),
    zoom: boundedNumber(source.zoom, fallback.zoom, 0.75, 1.5),
    accentColor: color(source.accentColor, fallback.accentColor),
    backgroundColor: color(source.backgroundColor, fallback.backgroundColor),
    sidebarColor: color(source.sidebarColor, fallback.sidebarColor),
    textColor: color(source.textColor, fallback.textColor),
    panelOpacity: boundedNumber(source.panelOpacity, fallback.panelOpacity, 0.35, 1),
  }
}

function normalizeMetadataMap(value: unknown): Record<string, OrganizerMetadata> {
  const output: Record<string, OrganizerMetadata> = {}
  for (const [key, metadata] of Object.entries(record(value))) {
    const row = record(metadata)
    if (key.length > 300) continue
    output[key] = {
      category: boundedText(row.category, '未分类', 80),
      description: boundedText(row.description, '暂无简介', 300),
    }
  }
  return output
}

function normalizeStoredConnection(value: unknown): StoredConnection | undefined {
  const row = record(value)
  const kind = connectionKind(row.kind)
  const id = boundedText(row.id, '', 80)
  if (kind === undefined || id === '') return undefined
  const transport = row.mcpTransport === 'stdio' ? 'stdio' as const : 'streamable-http' as const
  return {
    id,
    label: boundedText(row.label, '未命名连接', 100),
    kind,
    enabled: row.enabled === true,
    ...(kind === 'mcp' ? { mcpTransport: transport } : {}),
    endpointDisplay: boundedText(row.endpointDisplay, '已保存（不回显）', 200),
    endpointRef: boundedText(row.endpointRef, credentialRefFor(id, 'ENDPOINT'), 120),
    secretRef: boundedText(row.secretRef, credentialRefFor(id, 'SECRET'), 120),
    createdAt: isoText(row.createdAt),
    updatedAt: isoText(row.updatedAt),
  }
}

export function credentialRefFor(id: string, suffix: 'ENDPOINT' | 'SECRET'): string {
  return `DSH_PERSONAL_CONNECTION_${id.replace(/[^a-z0-9]/giu, '_').toUpperCase()}_${suffix}`
}

export function connectionKind(value: unknown): ConnectionKind | undefined {
  return value === 'feishu-bot' || value === 'wechat-work-bot' || value === 'webhook' || value === 'mcp' || value === 'model'
    || value === 'memory-extraction' || value === 'personal-wechat'
    ? value
    : undefined
}

export function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export function boundedText(value: unknown, fallback: string, maxLength: number): string {
  if (typeof value !== 'string') return fallback
  const normalized = value.trim()
  return normalized === '' ? fallback : normalized.slice(0, maxLength)
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback
}

function color(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/iu.test(value) ? value.toLowerCase() : fallback
}

function isoText(value: unknown): string {
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return value
  return new Date().toISOString()
}
