import { callPersonalApi, type PersonalApiService } from './personalApi.ts'

export interface SkillItem {
  readonly id: string
  readonly name: string
  readonly category: string
  readonly description: string
  readonly source?: string
  readonly canDelete: boolean
  readonly canEdit: boolean
}

export interface NewSkillInput {
  name: string
  category: string
  description: string
  content: string
}

export interface SkillLibraryApi {
  list(signal?: AbortSignal): Promise<readonly SkillItem[]>
  create(input: NewSkillInput): Promise<void>
  update(item: SkillItem, patch: Pick<NewSkillInput, 'category' | 'description'>): Promise<void>
  remove(item: SkillItem): Promise<void>
}

type UnknownRecord = Record<string, unknown>

function record(value: unknown): UnknownRecord {
  return typeof value === 'object' && value !== null ? value as UnknownRecord : {}
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function normalizeItem(value: unknown, index: number): SkillItem {
  const row = record(value)
  const name = text(row.name, text(row.id, `skill-${index + 1}`))
  const actions = record(row.actions)
  const canDelete = bool(row.canDelete, bool(row.deletable, bool(actions.delete, false)))
  return {
    id: text(row.id, name),
    name,
    category: text(row.category, '未分类'),
    description: text(row.description, text(row.summary, '暂无简介')),
    ...(text(row.source).length > 0 ? { source: text(row.source) } : {}),
    canDelete,
    canEdit: bool(row.canEdit, bool(row.editable, true)),
  }
}

function normalizeList(value: unknown): readonly SkillItem[] {
  const root = record(value)
  const rows = Array.isArray(value)
    ? value
    : Array.isArray(root.skills)
      ? root.skills
      : Array.isArray(root.items)
        ? root.items
        : []
  return rows.map(normalizeItem)
}

/** Adapt the stable personal REST collection to the Skill page. */
export function createSkillLibraryApi(api: PersonalApiService): SkillLibraryApi {
  return {
    async list(signal) {
      return normalizeList(await callPersonalApi<unknown>(api, 'GET', '/skills', undefined, signal))
    },
    async create(input) {
      await callPersonalApi(api, 'POST', '/skills', input)
    },
    async update(item, patch) {
      await callPersonalApi(api, 'PUT', '/skills', { id: item.id, name: item.name, ...patch })
    },
    async remove(item) {
      await callPersonalApi(api, 'DELETE', '/skills', { id: item.id, name: item.name })
    },
  }
}
