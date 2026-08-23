import { getPersonal, putPersonal, type PersonalApiService } from './personalApi.ts'

export type PluginFiberPhase = 'pending' | 'loading' | 'active' | 'failed' | 'unloading' | null

export interface PluginItem {
  readonly id: string
  readonly entryId: string
  readonly packageName: string
  readonly category: string
  readonly categoryCustomized: boolean
  readonly description: string
  readonly descriptionCustomized: boolean
  readonly enabled: boolean
  readonly fiberPhase: PluginFiberPhase
  readonly canEdit: boolean
  readonly version?: string
  readonly source?: 'builtin' | 'external'
  readonly installedAt?: string
  readonly degradedReason?: string
}

export interface PluginOrganizerApi {
  list(signal?: AbortSignal): Promise<readonly PluginItem[]>
  update(item: PluginItem, patch: { category: string; description: string }): Promise<void>
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

function defaultCategory(packageName: string): string {
  if (packageName.startsWith('@cyrus/')) return '个人扩展'
  if (packageName.startsWith('@deepseek-ai/')) return 'Harness 官方'
  return '第三方插件'
}

function defaultDescription(packageName: string): string {
  if (packageName.startsWith('@cyrus/')) return '个人桌面环境的扩展组件。'
  if (packageName.startsWith('@deepseek-ai/')) return 'DeepSeek Harness 随附的官方组件。'
  return '由当前 Harness 配置加载的第三方组件。'
}

const PHASES = new Set<PluginFiberPhase>(['pending', 'loading', 'active', 'failed', 'unloading', null])

function normalizeItem(value: unknown, index: number): PluginItem {
  const row = record(value)
  const packageName = text(row.packageName, text(row.moduleName, `plugin-${index + 1}`))
  const entryId = text(row.entryId, text(row.id, packageName))
  const customCategory = text(row.category)
  const customDescription = text(row.description, text(row.summary))
  const rawPhase = row.fiberPhase
  const fiberPhase = PHASES.has(rawPhase as PluginFiberPhase) ? rawPhase as PluginFiberPhase : null
  const rawSource = row.source
  const source = rawSource === 'external' || rawSource === 'builtin' ? rawSource : undefined
  return {
    id: text(row.id, entryId),
    entryId,
    packageName,
    category: customCategory || defaultCategory(packageName),
    categoryCustomized: boolean(row.categoryCustomized, boolean(row.customCategory, customCategory.length > 0)),
    description: customDescription || defaultDescription(packageName),
    descriptionCustomized: boolean(row.descriptionCustomized, boolean(row.customDescription, customDescription.length > 0)),
    enabled: boolean(row.enabled, false),
    fiberPhase,
    canEdit: boolean(row.canEdit, boolean(row.editable, true)),
    ...(row.version === undefined ? {} : { version: text(row.version) }),
    ...(source === undefined ? {} : { source }),
    ...(row.installedAt === undefined ? {} : { installedAt: text(row.installedAt) }),
    ...(row.degradedReason === undefined ? {} : { degradedReason: text(row.degradedReason) }),
  }
}

function normalizeList(value: unknown): readonly PluginItem[] {
  const root = record(value)
  const rows = Array.isArray(value)
    ? value
    : Array.isArray(root.plugins)
      ? root.plugins
      : Array.isArray(root.items)
        ? root.items
        : Array.isArray(root.entries)
          ? root.entries
          : []
  return rows.map(normalizeItem)
}

export function createPluginOrganizerApi(api: PersonalApiService): PluginOrganizerApi {
  return {
    async list(signal) {
      return normalizeList(await getPersonal<unknown>(api, '/plugins', signal))
    },
    async update(item, patch) {
      await putPersonal(api, '/plugins', {
        id: item.id,
        entryId: item.entryId,
        packageName: item.packageName,
        category: patch.category,
        description: patch.description,
      })
    },
  }
}
