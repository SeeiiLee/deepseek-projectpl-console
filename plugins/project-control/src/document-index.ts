import { createHash } from 'node:crypto'
import { lstat, open, readdir, realpath } from 'node:fs/promises'
import { extname, isAbsolute, join, normalize, relative } from 'node:path'
import { decodeText, isIgnoredDirectoryName, parseYamlSubset } from './discovery/runtime.js'
import { projectControlHttpError } from './http.ts'
import type { ProjectControlStorage, ProjectDocumentRole, ProjectView } from './host/index.js'

const LIMITS = Object.freeze({
  maxDocumentBytes: 8 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
  maxWalkEntries: 5_000,
  maxWalkDepth: 6,
  maxCandidatesPerBinding: 50,
})

const TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.mdx', '.txt', '.rst', '.yaml', '.yml'])

const SAFE_RELATIVE_PATH = /^(?!\/)(?!.*[:\\])(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*[\u0000-\u001F\u007F])(?!.*\/\/)(?!.*\/$)[^/]+(?:\/[^/]+)*$/

export interface DocumentParseIssue {
  code: string
  severity: 'info' | 'warning' | 'error' | 'blocking'
  message: string
  line: number | null
}

export interface DocumentStateInput {
  role: ProjectDocumentRole
  relativePath: string
  bindingSource: 'user_confirmed' | 'manifest'
  state: 'ok' | 'changed' | 'missing' | 'unreadable'
  contentHash: string | null
  byteSize: number | null
  parseIssues: DocumentParseIssue[]
}

export interface RebindProposalInput {
  role: ProjectDocumentRole
  missingRelativePath: string
  contentHash: string
  candidateRelativePaths: string[]
}

export interface DocumentIndexRefreshPayload {
  projectId: string
  documentStates: DocumentStateInput[]
  rebindProposals: RebindProposalInput[]
}

interface Binding {
  role: ProjectDocumentRole
  relativePath: string
  contentHash: string | null
  required: boolean
  source: 'user_confirmed' | 'manifest'
}

interface ReadBudget {
  bytesRead: number
  maxBytes: number
  exhausted?: boolean
}

type ReadOutcome =
  | { kind: 'bytes'; bytes: Buffer }
  | { kind: 'unreadable' }
  | { kind: 'too_large' }
  | { kind: 'budget_exhausted' }

function comparisonPath(value: string): string {
  const normalized = normalize(value)
  return process.platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized
}

function isWithin(rootPath: string, candidatePath: string): boolean {
  const relation = relative(comparisonPath(rootPath), comparisonPath(candidatePath))
  return relation === '' || (!relation.startsWith('..') && !isAbsolute(relation))
}

function sha256(bytes: Buffer): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

function cleanMessage(value: string, maximum = 1000): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim().slice(0, maximum)
}

function analyzeParseIssues(bytes: Buffer, relativePath: string): DocumentParseIssue[] {
  const extension = extname(relativePath).toLocaleLowerCase('en-US')
  if (!TEXT_EXTENSIONS.has(extension)) return []
  const issues: DocumentParseIssue[] = []
  let text: string
  try {
    text = decodeText(bytes)
  } catch (error) {
    issues.push({
      code: 'TEXT_ENCODING_UNSUPPORTED',
      severity: 'warning',
      message: cleanMessage(`文档不是可安全解析的 UTF-8/UTF-16 文本（${String((error as NodeJS.ErrnoException)?.code ?? 'DECODE_FAILED')}）。`),
      line: null,
    })
    return issues
  }
  const lines = text.split(/\r?\n/)
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
    if (end <= 0) {
      issues.push({
        code: 'FRONTMATTER_UNTERMINATED',
        severity: 'warning',
        message: '文档开头的 frontmatter 块没有闭合。',
        line: null,
      })
    } else {
      try {
        parseYamlSubset(lines.slice(1, end).join('\n'))
      } catch (error) {
        issues.push({
          code: 'FRONTMATTER_PARSE_FAILED',
          severity: 'warning',
          message: cleanMessage(`frontmatter 解析失败：${error instanceof Error ? error.message : 'UNKNOWN'}`),
          line: null,
        })
      }
    }
  } else if (extension === '.yaml' || extension === '.yml') {
    try {
      parseYamlSubset(text)
    } catch (error) {
      issues.push({
        code: 'DOCUMENT_PARSE_FAILED',
        severity: 'warning',
        message: cleanMessage(`文档解析失败：${error instanceof Error ? error.message : 'UNKNOWN'}`),
        line: null,
      })
    }
  }
  return issues
}

async function readBoundedFile(realPath: string, budget: ReadBudget): Promise<ReadOutcome> {
  if ((budget.exhausted ?? false) || budget.bytesRead >= budget.maxBytes) {
    return { kind: 'budget_exhausted' }
  }
  let handle
  try {
    handle = await open(realPath, 'r')
    const fileStat = await handle.stat()
    if (fileStat.size > LIMITS.maxDocumentBytes) return { kind: 'too_large' }
    const remaining = budget.maxBytes - budget.bytesRead
    if (fileStat.size > remaining) {
      budget.exhausted = true
      return { kind: 'budget_exhausted' }
    }
    const buffer = Buffer.alloc(Math.max(0, fileStat.size) + 1)
    let total = 0
    while (total < buffer.length) {
      const result = await handle.read(buffer, total, buffer.length - total, total)
      if (result.bytesRead === 0) break
      total += result.bytesRead
    }
    if (total > LIMITS.maxDocumentBytes) return { kind: 'too_large' }
    budget.bytesRead += total
    return { kind: 'bytes', bytes: Buffer.from(buffer.subarray(0, total)) }
  } catch {
    return { kind: 'unreadable' }
  } finally {
    if (handle !== undefined) await handle.close()
  }
}

async function verifyBindingDocument(
  rootDisplay: string,
  rootReal: string,
  binding: Binding,
  budget: ReadBudget,
): Promise<DocumentStateInput> {
  const base = {
    role: binding.role,
    relativePath: binding.relativePath,
    bindingSource: binding.source,
  }
  const missing: DocumentStateInput = {
    ...base,
    state: 'missing',
    contentHash: null,
    byteSize: null,
    parseIssues: [],
  }
  const unreadable: DocumentStateInput = {
    ...base,
    state: 'unreadable',
    contentHash: null,
    byteSize: null,
    parseIssues: [],
  }
  const displayPath = join(rootDisplay, ...binding.relativePath.split('/'))
  let info
  try {
    info = await lstat(displayPath)
  } catch {
    return missing
  }
  if (!info.isFile()) return missing
  let realFile: string
  try {
    realFile = await realpath(displayPath)
  } catch {
    return unreadable
  }
  if (!isWithin(rootReal, realFile)) return unreadable
  const read = await readBoundedFile(realFile, budget)
  if (read.kind !== 'bytes') return unreadable
  const contentHash = sha256(read.bytes)
  const changed = binding.contentHash !== null && binding.contentHash !== contentHash
  return {
    ...base,
    state: changed ? 'changed' : 'ok',
    contentHash,
    byteSize: read.bytes.length,
    parseIssues: analyzeParseIssues(read.bytes, binding.relativePath),
  }
}

interface RenameTarget {
  key: string
  binding: Binding
}

async function collectRenameCandidates(
  rootDisplay: string,
  rootReal: string,
  boundPaths: ReadonlySet<string>,
  targets: ReadonlyMap<string, RenameTarget[]>,
  budget: ReadBudget,
): Promise<Map<string, string[]>> {
  const found = new Map<string, string[]>()

  async function visit(displayDirectory: string, realDirectory: string, depth: number): Promise<void> {
    if ((budget.exhausted ?? false)
      || depth > LIMITS.maxWalkDepth
      || budget.bytesRead >= budget.maxBytes) return
    let entries
    try {
      entries = await readdir(realDirectory, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))
    for (const entry of entries) {
      if ((budget.exhausted ?? false) || budget.bytesRead >= budget.maxBytes) return
      const displayPath = join(displayDirectory, entry.name)
      const relativePath = relative(rootDisplay, displayPath).replaceAll('\\', '/')
      if (!SAFE_RELATIVE_PATH.test(relativePath)) continue
      const lowerName = entry.name.toLocaleLowerCase('en-US')
      if (entry.isDirectory()) {
        if (isIgnoredDirectoryName(lowerName)) continue
        let realChild: string
        try {
          realChild = await realpath(displayPath)
        } catch {
          continue
        }
        if (!isWithin(rootReal, realChild)) continue
        await visit(displayPath, realChild, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      if (boundPaths.has(relativePath)) continue
      let realFile: string
      try {
        realFile = await realpath(displayPath)
      } catch {
        continue
      }
      if (!isWithin(rootReal, realFile)) continue
      const read = await readBoundedFile(realFile, budget)
      if (read.kind !== 'bytes') {
        if (read.kind === 'budget_exhausted') budget.exhausted = true
        continue
      }
      const hash = sha256(read.bytes)
      const matches = targets.get(hash)
      if (matches === undefined) continue
      for (const match of matches) {
        const list = found.get(match.key) ?? []
        if (list.length < LIMITS.maxCandidatesPerBinding && !list.includes(relativePath)) {
          list.push(relativePath)
        }
        found.set(match.key, list)
      }
    }
  }

  await visit(rootDisplay, rootReal, 0)
  return found
}

/**
 * P5 Host pipeline: verify every authoritative binding against the registered
 * workspace, record hash/revision/parse diagnostics, and propose content-hash
 * rebinds for missing legacy documents. This reads project files but never
 * copies document content into the global database and never emits domain
 * events or advances WorkItem/Review aggregates.
 */
export async function refreshProjectDocumentIndex(
  _storage: Readonly<ProjectControlStorage>,
  project: Readonly<ProjectView>,
): Promise<DocumentIndexRefreshPayload> {
  if (project.mode !== 'linked_legacy' && project.mode !== 'managed') {
    throw projectControlHttpError('MODE_CONFLICT', '项目模式不支持文档索引。', 409)
  }
  const location = (project.workspaceLocations ?? []).find(item => item.isActive)
  if (location === undefined) {
    throw projectControlHttpError('REFERENCE_UNRESOLVED', '项目没有可用的活动位置。', 409)
  }
  const rootDisplay = normalize(location.displayPath)
  let rootReal: string
  try {
    rootReal = await realpath(rootDisplay)
  } catch {
    throw projectControlHttpError('PROJECT_LOCATION_UNAVAILABLE', '项目目录当前无法访问。', 409)
  }
  const mirrorBindings = project.manifestMirror?.documentBindings
  const rawBindings = project.mode === 'managed'
    ? (mirrorBindings ?? project.documentBindings ?? [])
    : (project.documentBindings ?? [])
  const bindings: Binding[] = rawBindings.map((binding) => ({
    role: binding.role,
    relativePath: binding.relativePath,
    contentHash: binding.contentHash ?? null,
    required: binding.required ?? false,
    source: project.mode === 'managed'
      ? 'manifest'
      : binding.source === 'manifest' ? 'manifest' : 'user_confirmed',
  }))
  const boundPaths = new Set(bindings.map((binding) => binding.relativePath))
  const readBudget: ReadBudget = { bytesRead: 0, maxBytes: LIMITS.maxTotalBytes }
  const documentStates: DocumentStateInput[] = []
  const missingWithHash: RenameTarget[] = []
  for (const binding of bindings) {
    const state = await verifyBindingDocument(rootDisplay, rootReal, binding, readBudget)
    documentStates.push(state)
    if (state.state === 'missing' && binding.contentHash !== null) {
      missingWithHash.push({ key: `${binding.role}\u0000${binding.relativePath}`, binding })
    }
  }
  const rebindProposals: RebindProposalInput[] = []
  if (missingWithHash.length > 0) {
    const targets = new Map<string, RenameTarget[]>()
    for (const item of missingWithHash) {
      const list = targets.get(item.binding.contentHash ?? '') ?? []
      list.push(item)
      targets.set(item.binding.contentHash ?? '', list)
    }
    const found = await collectRenameCandidates(
      rootDisplay,
      rootReal,
      boundPaths,
      targets,
      readBudget,
    )
    for (const item of missingWithHash) {
      const candidates = found.get(item.key)
      if (candidates !== undefined && candidates.length > 0) {
        rebindProposals.push({
          role: item.binding.role,
          missingRelativePath: item.binding.relativePath,
          contentHash: item.binding.contentHash ?? '',
          candidateRelativePaths: candidates,
        })
      }
    }
  }
  return { projectId: project.projectId, documentStates, rebindProposals }
}
