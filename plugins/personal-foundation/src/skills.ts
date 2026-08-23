import { lstat, mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import type { OrganizerMetadata, PersonalDocument } from './store.ts'
import { boundedText } from './store.ts'

export interface SkillItem {
  id: string
  name: string
  category: string
  description: string
  source: string
  canDelete: boolean
  canEdit: boolean
  path: string
}

interface DiscoveredSkill {
  id: string
  name: string
  description: string
  source: string
  path: string
  canDelete: boolean
}

export async function listSkills(
  dshHome: string,
  agentsHome: string,
  metadata: Record<string, OrganizerMetadata>,
): Promise<SkillItem[]> {
  const roots = [
    { root: join(dshHome, 'skills'), source: '个人 DSH 资料库', managed: true },
    { root: join(agentsHome, 'skills'), source: '共享 Agent 资料库', managed: false },
  ]
  const discovered = (await Promise.all(roots.map(root => scanRoot(root.root, root.source, root.managed)))).flat()
  return discovered.map(item => ({
    ...item,
    category: metadata[item.id]?.category ?? '未分类',
    description: metadata[item.id]?.description ?? item.description,
    canEdit: true,
  })).sort((left, right) => left.name.localeCompare(right.name, 'en'))
}

export async function createSkill(
  dshHome: string,
  input: Record<string, unknown>,
  document: PersonalDocument,
): Promise<SkillItem> {
  const name = skillName(input.name)
  const description = boundedText(input.description, '', 300)
  if (description === '') throw apiError('INVALID_SKILL', '一句话简介不能为空。')
  const category = boundedText(input.category, '未分类', 80)
  const content = typeof input.content === 'string' ? input.content.trim().slice(0, 200_000) : ''
  const skillsRoot = join(dshHome, 'skills')
  const directory = join(skillsRoot, name)
  const filename = join(directory, 'SKILL.md')
  try {
    await lstat(directory)
    throw apiError('SKILL_EXISTS', `Skill“${name}”已经存在。`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  await mkdir(skillsRoot, { recursive: true })
  await mkdir(directory, { recursive: false })
  const body = content || `# ${name}\n\n请在这里编写 Skill 指令。`
  await writeFile(filename, [
    '---',
    `name: ${JSON.stringify(name)}`,
    `description: ${JSON.stringify(description)}`,
    '---',
    '',
    body,
    '',
  ].join('\n'), { encoding: 'utf8', flag: 'wx' })
  const id = `user-dsh:${name}`
  document.skillMetadata[id] = { category, description }
  return { id, name, category, description, source: '个人 DSH 资料库', canDelete: true, canEdit: true, path: filename }
}

export async function updateSkillMetadata(
  dshHome: string,
  agentsHome: string,
  input: Record<string, unknown>,
  document: PersonalDocument,
): Promise<SkillItem> {
  const id = boundedText(input.id, '', 300)
  const current = (await listSkills(dshHome, agentsHome, document.skillMetadata)).find(item => item.id === id)
  if (current === undefined) throw apiError('SKILL_NOT_FOUND', '要整理的 Skill 不存在。')
  const description = boundedText(input.description, '', 300)
  if (description === '') throw apiError('INVALID_SKILL', '一句话简介不能为空。')
  const category = boundedText(input.category, '未分类', 80)
  document.skillMetadata[id] = { category, description }
  return { ...current, category, description }
}

export async function trashSkill(
  dshHome: string,
  agentsHome: string,
  input: Record<string, unknown>,
  document: PersonalDocument,
): Promise<{ trashed: string }> {
  const id = boundedText(input.id, '', 300)
  const suppliedName = boundedText(input.name, '', 100)
  const current = (await listSkills(dshHome, agentsHome, document.skillMetadata)).find(item => item.id === id)
  if (current === undefined) throw apiError('SKILL_NOT_FOUND', '要删除的 Skill 不存在。')
  if (!current.canDelete) throw apiError('SKILL_READ_ONLY', '这个 Skill 不属于个人 DSH 资料库，不能在这里删除。')
  if (suppliedName !== current.name) throw apiError('CONFIRMATION_MISMATCH', '删除确认名称与 Skill 不一致。')
  const skillsRoot = resolve(dshHome, 'skills')
  const target = resolve(current.path)
  assertContained(skillsRoot, target)
  const stat = await lstat(target)
  if (stat.isSymbolicLink()) throw apiError('SKILL_READ_ONLY', '符号链接 Skill 不支持在这里删除。')
  const source = basename(target).toLowerCase() === 'skill.md' ? dirname(target) : target
  assertContained(skillsRoot, source)
  const trashRoot = join(dshHome, 'personal', 'trash', 'skills')
  await mkdir(trashRoot, { recursive: true })
  const destination = join(trashRoot, `${safeTimestamp()}-${current.name}`)
  await rename(source, destination)
  delete document.skillMetadata[id]
  return { trashed: destination }
}

async function scanRoot(root: string, source: string, managed: boolean): Promise<DiscoveredSkill[]> {
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const result: DiscoveredSkill[] = []
  for (const entry of entries) {
    if (entry.name === '.system') continue
    const full = join(root, entry.name)
    const filename = entry.isDirectory()
      ? join(full, 'SKILL.md')
      : entry.isFile() && entry.name.toLowerCase().endsWith('.md') ? full : undefined
    if (filename === undefined) continue
    let raw: string
    let stat
    try {
      ;[raw, stat] = await Promise.all([readFile(filename, 'utf8'), lstat(full)])
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    const frontmatter = parseFrontmatter(raw)
    const fallbackName = entry.isDirectory() ? entry.name : entry.name.slice(0, -3)
    const name = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(frontmatter.name) ? frontmatter.name : fallbackName
    const prefix = managed ? 'user-dsh' : 'user-agents'
    result.push({
      id: `${prefix}:${name}`,
      name,
      description: frontmatter.description || '暂无简介',
      source,
      path: filename,
      canDelete: managed && !stat.isSymbolicLink(),
    })
  }
  return result
}

function parseFrontmatter(raw: string): { name: string; description: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(raw)
  if (match === null) return { name: '', description: '' }
  const fields: Record<string, string> = {}
  for (const line of (match[1] ?? '').split(/\r?\n/u)) {
    const field = /^([a-zA-Z][\w-]*):\s*(.*)$/u.exec(line)
    if (field === null) continue
    fields[field[1] ?? ''] = yamlScalar(field[2] ?? '')
  }
  return { name: fields.name ?? '', description: fields.description ?? '' }
}

function yamlScalar(value: string): string {
  const trimmed = value.trim()
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try { return String(JSON.parse(trimmed)) } catch { return trimmed.slice(1, -1) }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1).replaceAll("''", "'")
  return trimmed
}

function skillName(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value)) {
    throw apiError('INVALID_SKILL_NAME', 'Skill 名称必须是小写 kebab-case，例如 weekly-review。')
  }
  return value
}

function assertContained(root: string, target: string): void {
  const path = relative(resolve(root), resolve(target))
  if (path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !path.startsWith(sep))) return
  throw apiError('UNSAFE_PATH', 'Skill 路径超出了个人资料库。')
}

function safeTimestamp(): string {
  return new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
}

export function apiError(code: string, message: string, status = 400): Error & { code: string; status: number } {
  return Object.assign(new Error(message), { code, status })
}
