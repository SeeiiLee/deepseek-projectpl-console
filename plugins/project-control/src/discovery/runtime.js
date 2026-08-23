import { createHash } from 'node:crypto'
import { lstat, open, readdir, realpath, stat } from 'node:fs/promises'
import {
  basename,
  extname,
  isAbsolute,
  join,
  normalize,
  parse,
  relative,
  resolve,
  sep,
} from 'node:path'
import { validateProjectManifest } from '../manifest-validator.ts'

export const SCANNER_VERSION = 'gate2c-readonly/1'

const DEFAULTS = Object.freeze({
  maxDepth: 3,
  sourceDepth: 1,
  maxEntries: 20_000,
  maxDocuments: 200,
  maxBytes: 32 * 1024 * 1024,
  maxFileBytes: 2 * 1024 * 1024,
  maxCandidates: 100,
  previewChars: 800,
})

const HARD_LIMITS = Object.freeze({
  maxDepth: 3,
  sourceDepth: 3,
  maxEntries: 50_000,
  maxDocuments: 200,
  maxBytes: 128 * 1024 * 1024,
  maxFileBytes: 8 * 1024 * 1024,
  maxCandidates: 500,
  previewChars: 1_000,
})

const IGNORED_DIRECTORIES = new Set([
  '.git', '.hg', '.svn', 'node_modules', 'dist', 'build', 'out', 'target',
  '.next', 'coverage', 'artifacts', '.cache', 'cache', 'caches', '__pycache__',
  '.pytest_cache', '.mypy_cache', '.ruff_cache', '.turbo', '.gradle', '.idea',
  '.pnpm-store', '.yarn', 'tmp', 'temp', '$recycle.bin',
])

// Gate 2D staging residue ('.dsh-staging.<planId>') is journal-owned and must
// never surface as a candidate or pollute document indexing.
export function isIgnoredDirectoryName(lowerName) {
  return IGNORED_DIRECTORIES.has(lowerName) || lowerName.startsWith('.dsh-staging.')
}

const DOCUMENT_DIRECTORIES = new Set([
  'docs', 'doc', 'documentation', 'documents', 'adr', 'adrs', 'decisions',
  'architecture-decision-records',
])

const TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.mdx', '.txt', '.rst'])
const DOCUMENT_ROLES = new Set([
  'readme', 'prd', 'devlog', 'progress', 'next', 'current_architecture',
  'decision', 'other',
])

const PROJECT_MARKERS = new Map([
  ['package.json', 'node_manifest'],
  ['pnpm-workspace.yaml', 'node_workspace'],
  ['pyproject.toml', 'python_manifest'],
  ['cargo.toml', 'rust_manifest'],
  ['go.mod', 'go_manifest'],
  ['pom.xml', 'java_manifest'],
  ['build.gradle', 'gradle_manifest'],
  ['build.gradle.kts', 'gradle_manifest'],
  ['composer.json', 'php_manifest'],
  ['gemfile', 'ruby_manifest'],
  ['mix.exs', 'elixir_manifest'],
  ['makefile', 'build_manifest'],
  ['agents.md', 'agent_marker'],
])

const SAFE_RELATIVE_PATH = /^(?!\/)(?!.*[:\\])(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*[\u0000-\u001F\u007F])(?!.*\/\/)(?!.*\/$)[^/]+(?:\/[^/]+)*$/
const PROJECT_ID = /^prj_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export class DiscoveryPathError extends Error {
  constructor(message, code, details = {}) {
    super(message)
    this.name = 'DiscoveryPathError'
    this.code = code
    this.details = details
  }
}

function boundedInteger(value, fallback, maximum, name, minimum = 1) {
  const actual = value === undefined ? fallback : value
  if (!Number.isSafeInteger(actual) || actual < minimum || actual > maximum) {
    throw new RangeError(`${name} must be an integer between ${minimum} and ${maximum}.`)
  }
  return actual
}

function normalizeOptions(options = {}) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Discovery options must be an object.')
  }
  return Object.freeze({
    maxDepth: boundedInteger(options.maxDepth, DEFAULTS.maxDepth, HARD_LIMITS.maxDepth, 'maxDepth', 0),
    sourceDepth: boundedInteger(options.sourceDepth, DEFAULTS.sourceDepth, HARD_LIMITS.sourceDepth, 'sourceDepth'),
    maxEntries: boundedInteger(options.maxEntries, DEFAULTS.maxEntries, HARD_LIMITS.maxEntries, 'maxEntries'),
    maxDocuments: boundedInteger(options.maxDocuments, DEFAULTS.maxDocuments, HARD_LIMITS.maxDocuments, 'maxDocuments'),
    maxBytes: boundedInteger(options.maxBytes, DEFAULTS.maxBytes, HARD_LIMITS.maxBytes, 'maxBytes'),
    maxFileBytes: boundedInteger(options.maxFileBytes, DEFAULTS.maxFileBytes, HARD_LIMITS.maxFileBytes, 'maxFileBytes'),
    maxCandidates: boundedInteger(options.maxCandidates, DEFAULTS.maxCandidates, HARD_LIMITS.maxCandidates, 'maxCandidates'),
    previewChars: boundedInteger(options.previewChars, DEFAULTS.previewChars, HARD_LIMITS.previewChars, 'previewChars', 80),
  })
}

function isNetworkOrDevicePath(value) {
  return /^(?:\\\\|\/\/|\\\\[?.]\\)/.test(value) || /^file:/i.test(value)
}

function comparisonPath(value) {
  const normalized = normalize(value)
  return process.platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized
}

function isWithin(rootPath, candidatePath) {
  const relation = relative(comparisonPath(rootPath), comparisonPath(candidatePath))
  return relation === '' || (!relation.startsWith('..') && !isAbsolute(relation))
}

function toPosix(value) {
  return value.split(sep).join('/')
}

function pathRecord(displayPath, realPath) {
  return Object.freeze({
    displayPath: normalize(displayPath),
    realPath: normalize(realPath),
    normalizedPath: normalize(realPath),
  })
}

async function resolveDirectoryRoot(inputPath, label) {
  if (typeof inputPath !== 'string' || inputPath.length === 0 || inputPath.length > 2_048) {
    throw new DiscoveryPathError(`${label} must be a non-empty local path.`, 'INVALID_ROOT')
  }
  if (!isAbsolute(inputPath) || isNetworkOrDevicePath(inputPath)) {
    throw new DiscoveryPathError(`${label} must be an absolute local filesystem path.`, 'NON_LOCAL_ROOT')
  }
  const displayPath = normalize(resolve(inputPath))
  if (comparisonPath(displayPath) === comparisonPath(parse(displayPath).root)) {
    throw new DiscoveryPathError(`${label} cannot be a filesystem root.`, 'SYSTEM_ROOT_REJECTED')
  }
  let rootStat
  let resolvedPath
  try {
    rootStat = await stat(displayPath)
    resolvedPath = await realpath(displayPath)
  } catch (error) {
    throw new DiscoveryPathError(`${label} is not accessible.`, 'ROOT_UNREADABLE', { causeCode: error?.code })
  }
  if (!rootStat.isDirectory()) {
    throw new DiscoveryPathError(`${label} must be a directory.`, 'ROOT_NOT_DIRECTORY')
  }
  if (isNetworkOrDevicePath(resolvedPath)) {
    throw new DiscoveryPathError(`${label} resolved to a non-local path.`, 'NON_LOCAL_ROOT')
  }
  return pathRecord(displayPath, resolvedPath)
}

function createBudget(preferences) {
  return {
    entries: 0,
    documents: 0,
    bytesRead: 0,
    skippedDirectories: 0,
    limits: new Set(),
    preferences,
  }
}

function createIssueCollector() {
  const issues = []
  const keys = new Set()
  return {
    issues,
    add(code, severity, message, details = {}) {
      const key = `${code}\0${details.relativePath ?? ''}`
      if (keys.has(key) || issues.length >= 200) return
      keys.add(key)
      issues.push(Object.freeze({
        code,
        severity,
        message,
        details: Object.freeze({ message, ...details }),
      }))
    },
  }
}

function noteLimit(budget, collector, limit) {
  if (budget.limits.has(limit)) return
  budget.limits.add(limit)
  collector.add(
    'SCAN_LIMIT_REACHED',
    'warning',
    'The read-only scan stopped at a configured safety limit.',
    { limit },
  )
}

function safeRelative(root, displayPath) {
  const value = toPosix(relative(root.displayPath, displayPath))
  return value && SAFE_RELATIVE_PATH.test(value) ? value : null
}

async function inspectEntry(root, displayPath, relativePath, collector, blocking = false) {
  try {
    const entryLstat = await lstat(displayPath)
    const resolvedPath = await realpath(displayPath)
    if (!isWithin(root.realPath, resolvedPath)) {
      collector.add(
        'PATH_ESCAPE_BLOCKED',
        blocking ? 'blocking' : 'warning',
        'A link or reparse target outside the selected root was skipped.',
        { relativePath, entryType: entryLstat.isSymbolicLink() ? 'link' : 'reparse_or_path' },
      )
      return null
    }
    const resolvedStat = await stat(resolvedPath)
    return {
      displayPath: normalize(displayPath),
      realPath: normalize(resolvedPath),
      normalizedPath: normalize(resolvedPath),
      lstat: entryLstat,
      stat: resolvedStat,
    }
  } catch (error) {
    collector.add(
      error?.code === 'EACCES' || error?.code === 'EPERM' ? 'ENTRY_ACCESS_DENIED' : 'ENTRY_UNREADABLE',
      blocking ? 'blocking' : 'warning',
      'An entry could not be read and was skipped.',
      { relativePath, causeCode: error?.code ?? 'UNKNOWN' },
    )
    return null
  }
}

export function decodeText(bytes) {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le', { fatal: true }).decode(bytes.subarray(2))
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    if ((bytes.length - 2) % 2 !== 0) {
      throw Object.assign(new Error('invalid UTF-16BE byte length'), { code: 'INVALID_UTF16_LENGTH' })
    }
    const swapped = Buffer.allocUnsafe(bytes.length - 2)
    for (let index = 2; index + 1 < bytes.length; index += 2) {
      swapped[index - 2] = bytes[index + 1]
      swapped[index - 1] = bytes[index]
    }
    return new TextDecoder('utf-16le', { fatal: true }).decode(swapped)
  }
  if (bytes.includes(0)) throw Object.assign(new Error('binary content'), { code: 'BINARY_CONTENT' })
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '')
}

function cleanInline(value, maximum = 500) {
  return value
    .replace(/<!--.*?-->/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximum)
}

function cleanSuggestedName(value) {
  const cleaned = cleanInline(String(value), 200)
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned || '未命名项目'
}

function extractTitle(text) {
  for (const line of text.split(/\r?\n/, 200)) {
    const match = /^#\s+(.+?)\s*$/.exec(line)
    if (match) return cleanInline(match[1]) || null
  }
  return null
}

function makePreview(text, maximum) {
  let body = text
  if (/^---\s*\r?\n/.test(body)) {
    const end = body.slice(4).search(/\r?\n---\s*(?:\r?\n|$)/)
    if (end >= 0) body = body.slice(end + 8)
  }
  const preview = cleanInline(
    body.replace(/^#{1,6}\s+/gm, '').replace(/^\s*[-*+]\s+/gm, ''),
    maximum,
  )
  return preview || null
}

function confidenceLevel(score) {
  if (score >= 70) return 'high'
  if (score >= 40) return 'medium'
  if (score > 0) return 'low'
  return 'low'
}

function addRole(target, role, score, kind, detail) {
  if (!DOCUMENT_ROLES.has(role)) return
  const existing = target.get(role) ?? { role, score: 0, evidence: [] }
  existing.score = Math.max(existing.score, score)
  existing.evidence.push({ kind, detail })
  target.set(role, existing)
}

function classifyDocument(relativePath, title, manifestRoles = []) {
  const roles = new Map()
  const fileName = basename(relativePath)
  const stem = fileName.slice(0, fileName.length - extname(fileName).length)
  const normalizedStem = stem.replace(/[.\s_-]+/g, ' ').trim().toLocaleLowerCase('en-US')
  const segments = relativePath.toLocaleLowerCase('en-US').split('/')
  const inDecisionDirectory = segments.some((part) => ['adr', 'adrs', 'decisions', 'architecture-decision-records'].includes(part))
  const fileEvidence = (role, score, detail) => addRole(roles, role, score, 'filename', detail)

  if (/^readme(?:\b|\s)/i.test(normalizedStem) || /^(overview|home)$/i.test(normalizedStem)) fileEvidence('readme', 100, fileName)
  if (/^(prd)(?:\b|\s)|product requirements?|product spec|产品需求|需求规格/i.test(normalizedStem)) fileEvidence('prd', 100, fileName)
  if (/^devlog(?:\b|\s)|development log|开发日志/i.test(normalizedStem)) fileEvidence('devlog', 100, fileName)
  if (/^changelog(?:\b|\s)|change log|更新日志/i.test(normalizedStem)) fileEvidence('devlog', 78, fileName)
  if (/^progress(?:\b|\s)|status report|进展|进度/i.test(normalizedStem)) fileEvidence('progress', 100, fileName)
  if (/^next(?:\b|\s)|roadmap|next steps?|下一步|路线图/i.test(normalizedStem)) fileEvidence('next', 100, fileName)
  if (/^architecture(?:\b|\s)|system design|technical design|架构/i.test(normalizedStem)) fileEvidence('current_architecture', 100, fileName)
  if (/^(adr)(?:\b|\s)|architecture decision|架构决策|决策记录/i.test(normalizedStem) || inDecisionDirectory) fileEvidence('decision', 95, fileName)

  if (title) {
    if (/\bPRD\b|product requirements?|产品需求|需求规格/i.test(title)) addRole(roles, 'prd', 72, 'title', title)
    if (/architecture|system design|架构/i.test(title)) addRole(roles, 'current_architecture', 70, 'title', title)
    if (/development log|devlog|开发日志/i.test(title)) addRole(roles, 'devlog', 70, 'title', title)
    if (/progress|进展|进度/i.test(title)) addRole(roles, 'progress', 68, 'title', title)
    if (/roadmap|next steps?|下一步|路线图/i.test(title)) addRole(roles, 'next', 68, 'title', title)
  }
  for (const role of manifestRoles) {
    addRole(roles, role, 110, 'manifest', `Manifest-locked document binding: ${role}`)
  }
  if (roles.size === 0 && segments.some((part) => DOCUMENT_DIRECTORIES.has(part))) {
    addRole(roles, 'other', 35, 'document_directory', 'Text file under a recognized documentation directory')
  }

  const roleCandidates = [...roles.values()]
    .sort((left, right) => right.score - left.score || left.role.localeCompare(right.role, 'en'))
    .map((candidate) => Object.freeze({
      role: candidate.role,
      score: candidate.score,
      confidence: confidenceLevel(candidate.score),
      evidence: Object.freeze(candidate.evidence.map(Object.freeze)),
    }))
  const first = roleCandidates[0]
  const second = roleCandidates[1]
  const suggestedRole = first && first.score >= 65 && (!second || first.score - second.score >= 10)
    ? first.role
    : null
  return { suggestedRole, roleCandidates }
}

function extractSummaryCandidates(text, relativePath, suggestedRole) {
  const lines = text.split(/\r?\n/)
  const output = []
  if (lines[0]?.trim() === '---') {
    for (let index = 1; index < Math.min(lines.length, 100); index += 1) {
      if (lines[index].trim() === '---') break
      const match = /^\s*(summary|goal|objective|目标)\s*:\s*(.+?)\s*$/i.exec(lines[index])
      if (match) {
        const value = cleanInline(match[2].replace(/^['"]|['"]$/g, ''), 500)
        if (value) output.push({ value, source: { relativePath, kind: 'frontmatter', field: match[1], line: index + 1 }, score: suggestedRole === 'prd' ? 95 : 85 })
      }
    }
  }
  for (let index = 0; index < lines.length; index += 1) {
    const heading = /^#{1,6}\s*(项目目标|目标|Goal|Objective)\s*[:：]?\s*$/i.exec(lines[index])
    if (!heading) continue
    for (let next = index + 1; next < Math.min(lines.length, index + 12); next += 1) {
      if (/^#{1,6}\s+/.test(lines[next])) break
      const value = cleanInline(lines[next].replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, ''), 500)
      if (value) {
        output.push({ value, source: { relativePath, kind: 'heading', heading: heading[1], line: next + 1 }, score: suggestedRole === 'prd' ? 90 : 80 })
        break
      }
    }
  }
  return output.slice(0, 2)
}

function shouldReadDocument(relativePath, manifestPaths) {
  if (manifestPaths.has(relativePath)) return true
  const extension = extname(relativePath).toLocaleLowerCase('en-US')
  if (!TEXT_EXTENSIONS.has(extension)) return false
  const fileName = basename(relativePath).toLocaleLowerCase('en-US')
  const stem = fileName.slice(0, fileName.length - extension.length)
  if (/^(readme|overview|home|prd|devlog|progress|next|roadmap|architecture|changelog|adr)(?:[._ -]|$)/i.test(stem)) return true
  if (/产品需求|需求规格|开发日志|更新日志|进展|进度|下一步|路线图|架构|决策记录/.test(stem)) return true
  return relativePath.toLocaleLowerCase('en-US').split('/').some((part) => DOCUMENT_DIRECTORIES.has(part))
}

function parseScalar(value) {
  const trimmed = value.trim()
  if (trimmed === '{}') return {}
  if (trimmed === '[]') return []
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (trimmed === 'null' || trimmed === '~') return null
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(trimmed)) return Number(trimmed)
  if (trimmed.startsWith('"')) return JSON.parse(trimmed)
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1).replace(/''/g, "'")
  if (/^[&*!>|]/.test(trimmed)) throw new Error('Unsupported YAML feature')
  return trimmed
}

function stripYamlComment(line) {
  let single = false
  let double = false
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (character === "'" && !double) single = !single
    if (character === '"' && !single && line[index - 1] !== '\\') double = !double
    if (character === '#' && !single && !double && (index === 0 || /\s/.test(line[index - 1]))) return line.slice(0, index)
  }
  return line
}

function splitYamlPair(content) {
  let single = false
  let double = false
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index]
    if (character === "'" && !double) single = !single
    if (character === '"' && !single && content[index - 1] !== '\\') double = !double
    if (character === ':' && !single && !double) {
      const key = content.slice(0, index).trim()
      if (!/^[A-Za-z][A-Za-z0-9.-]*$/.test(key)) throw new Error('Invalid YAML key')
      return [key, content.slice(index + 1).trim()]
    }
  }
  throw new Error('Expected YAML mapping')
}

export function parseYamlSubset(text) {
  if (text.trimStart().startsWith('{')) return JSON.parse(text)
  const tokens = []
  for (const rawLine of text.split(/\r?\n/)) {
    if (/^\s*\t/.test(rawLine)) throw new Error('Tab indentation is not supported')
    const withoutComment = stripYamlComment(rawLine).replace(/\s+$/, '')
    if (!withoutComment.trim() || withoutComment.trim() === '---') continue
    const indent = withoutComment.length - withoutComment.trimStart().length
    tokens.push({ indent, content: withoutComment.trimStart() })
  }
  if (tokens.length === 0) throw new Error('Empty YAML')

  function parseBlock(start, indent) {
    return tokens[start].content.startsWith('-') ? parseSequence(start, indent) : parseMap(start, indent)
  }
  function parseMap(start, indent) {
    const output = {}
    let index = start
    while (index < tokens.length && tokens[index].indent === indent && !tokens[index].content.startsWith('-')) {
      const [key, rest] = splitYamlPair(tokens[index].content)
      if (Object.hasOwn(output, key)) throw new Error('Duplicate YAML key')
      index += 1
      if (rest) output[key] = parseScalar(rest)
      else if (index < tokens.length && tokens[index].indent > indent) {
        const parsed = parseBlock(index, tokens[index].indent)
        output[key] = parsed.value
        index = parsed.index
      } else output[key] = null
    }
    return { value: output, index }
  }
  function parseSequence(start, indent) {
    const output = []
    let index = start
    while (index < tokens.length && tokens[index].indent === indent && tokens[index].content.startsWith('-')) {
      const rest = tokens[index].content.slice(1).trim()
      index += 1
      if (!rest) {
        if (index >= tokens.length || tokens[index].indent <= indent) throw new Error('Empty YAML sequence item')
        const parsed = parseBlock(index, tokens[index].indent)
        output.push(parsed.value)
        index = parsed.index
        continue
      }
      if (rest.includes(':')) {
        const item = {}
        const [key, value] = splitYamlPair(rest)
        item[key] = value ? parseScalar(value) : null
        if (index < tokens.length && tokens[index].indent > indent) {
          const parsed = parseMap(index, tokens[index].indent)
          Object.assign(item, parsed.value)
          index = parsed.index
        }
        output.push(item)
      } else output.push(parseScalar(rest))
    }
    return { value: output, index }
  }
  const parsed = parseBlock(0, tokens[0].indent)
  if (parsed.index !== tokens.length || !parsed.value || Array.isArray(parsed.value)) throw new Error('Invalid YAML document')
  return parsed.value
}

function validateManifestObject(value) {
  return validateProjectManifest(value)
}

async function readBytes(info, relativePath, root, budget, collector, blocking = false) {
  if (info.stat.size > budget.preferences.maxFileBytes) {
    collector.add('FILE_TOO_LARGE', blocking ? 'blocking' : 'warning', 'A file exceeded the configured per-file read limit.', { relativePath, byteSize: info.stat.size, maximumBytes: budget.preferences.maxFileBytes })
    return null
  }
  if (budget.bytesRead + info.stat.size > budget.preferences.maxBytes) {
    noteLimit(budget, collector, 'maxBytes')
    return null
  }
  try {
    const before = await realpath(info.displayPath)
    if (!isWithin(root.realPath, before)) throw Object.assign(new Error('path escape'), { code: 'PATH_ESCAPE' })
    const remainingBytes = budget.preferences.maxBytes - budget.bytesRead
    const maximumRead = Math.min(budget.preferences.maxFileBytes, remainingBytes)
    let handle
    let bytes
    try {
      handle = await open(before, 'r')
      const initialStat = await handle.stat()
      if (initialStat.size > budget.preferences.maxFileBytes) {
        collector.add('FILE_TOO_LARGE', blocking ? 'blocking' : 'warning', 'A file exceeded the configured per-file read limit.', { relativePath, byteSize: initialStat.size, maximumBytes: budget.preferences.maxFileBytes })
        return null
      }
      if (initialStat.size > remainingBytes) {
        noteLimit(budget, collector, 'maxBytes')
        return null
      }
      const buffer = Buffer.allocUnsafe(maximumRead + 1)
      let total = 0
      while (total < buffer.length) {
        const result = await handle.read(buffer, total, buffer.length - total, total)
        if (result.bytesRead === 0) break
        total += result.bytesRead
      }
      const finalStat = await handle.stat()
      if (total > maximumRead) {
        collector.add('FILE_TOO_LARGE', blocking ? 'blocking' : 'warning', 'A file exceeded a configured read limit while it was being scanned.', { relativePath, maximumBytes: maximumRead })
        return null
      }
      if (initialStat.size !== finalStat.size || finalStat.size !== total) {
        collector.add('ENTRY_CHANGED_DURING_SCAN', blocking ? 'blocking' : 'warning', 'A file changed while it was being scanned and was discarded.', { relativePath })
        return null
      }
      bytes = buffer.subarray(0, total)
    } finally {
      await handle?.close()
    }
    const after = await realpath(info.displayPath)
    if (comparisonPath(before) !== comparisonPath(after) || !isWithin(root.realPath, after)) {
      collector.add('ENTRY_CHANGED_DURING_SCAN', blocking ? 'blocking' : 'warning', 'A file changed location during the scan and was discarded.', { relativePath })
      return null
    }
    if (bytes.length > budget.preferences.maxFileBytes) {
      collector.add('FILE_TOO_LARGE', blocking ? 'blocking' : 'warning', 'A file exceeded the configured per-file read limit.', { relativePath, byteSize: bytes.length, maximumBytes: budget.preferences.maxFileBytes })
      return null
    }
    if (budget.bytesRead + bytes.length > budget.preferences.maxBytes) {
      noteLimit(budget, collector, 'maxBytes')
      return null
    }
    budget.bytesRead += bytes.length
    return bytes
  } catch (error) {
    const access = error?.code === 'EACCES' || error?.code === 'EPERM'
    collector.add(access ? 'ENTRY_ACCESS_DENIED' : error?.code === 'PATH_ESCAPE' ? 'PATH_ESCAPE_BLOCKED' : 'FILE_READ_FAILED', blocking ? 'blocking' : 'warning', 'A file could not be safely read and was skipped.', { relativePath, causeCode: error?.code ?? 'UNKNOWN' })
    return null
  }
}

async function scanProjectInternal(root, preferences, budget) {
  const collector = createIssueCollector()
  const documents = []
  const documentByPath = new Map()
  const markers = []
  const confidenceEvidence = []
  const summaryCandidates = []
  const startStats = { entries: budget.entries, documents: budget.documents, bytesRead: budget.bytesRead, skippedDirectories: budget.skippedDirectories }
  const manifestRelativePath = '.dsh-project/project.yaml'
  let manifest = null
  let parsedManifest = null
  let manifestStructurallyValid = false
  const manifestRoles = new Map()
  const manifestRequirements = new Map()

  const addMarker = (kind, relativePath, location, weight, detail) => {
    if (markers.some((marker) => marker.kind === kind && marker.relativePath === relativePath)) return
    const marker = Object.freeze({ kind, relativePath, location, weight, detail })
    markers.push(marker)
    if (confidenceEvidence.length < 40) confidenceEvidence.push(Object.freeze({ kind: 'project_marker', relativePath, detail, weight }))
  }

  const manifestDisplayPath = join(root.displayPath, ...manifestRelativePath.split('/'))
  try {
    await lstat(manifestDisplayPath)
    const info = await inspectEntry(root, manifestDisplayPath, manifestRelativePath, collector, true)
    if (info?.stat.isFile()) {
      const bytes = await readBytes(info, manifestRelativePath, root, budget, collector, true)
      if (bytes) {
        const sha256 = `sha256:${createHash('sha256').update(bytes).digest('hex')}`
        try {
          const text = decodeText(bytes)
          parsedManifest = parseYamlSubset(text)
          const validation = validateManifestObject(parsedManifest)
          const unsupported = parsedManifest?.apiVersion && parsedManifest.apiVersion !== 'project-control.dsh/v1alpha1'
          manifestStructurallyValid = validation.valid
          manifest = {
            relativePath: manifestRelativePath,
            status: validation.valid ? 'validating_bindings' : unsupported ? 'unsupported' : 'invalid',
            sha256,
            apiVersion: typeof parsedManifest?.apiVersion === 'string' ? parsedManifest.apiVersion : null,
            projectId: PROJECT_ID.test(parsedManifest?.metadata?.projectId ?? '') ? parsedManifest.metadata.projectId : null,
            name: typeof parsedManifest?.metadata?.name === 'string' ? parsedManifest.metadata.name.slice(0, 120) : null,
            origin: parsedManifest?.metadata?.origin && typeof parsedManifest.metadata.origin === 'object' ? parsedManifest.metadata.origin : null,
            errors: validation.errors.slice(0, 20),
          }
          addMarker('managed_manifest', manifestRelativePath, 'root', validation.valid ? 100 : 90, 'Standard Project Control manifest')
          if (!validation.valid) collector.add(unsupported ? 'MANIFEST_VERSION_UNSUPPORTED' : 'MANIFEST_INVALID', 'blocking', 'The existing Project Control manifest cannot be trusted for registration.', { relativePath: manifestRelativePath, errors: validation.errors.slice(0, 10) })
          if (validation.valid) {
            for (const entry of parsedManifest.spec.documents.entries) {
              const list = manifestRoles.get(entry.path) ?? []
              list.push(entry.role)
              manifestRoles.set(entry.path, list)
              manifestRequirements.set(
                entry.path,
                manifestRequirements.get(entry.path) === true || entry.required === true,
              )
            }
          }
        } catch (error) {
          manifest = { relativePath: manifestRelativePath, status: 'invalid', sha256, apiVersion: null, projectId: null, name: null, origin: null, errors: [{ field: '$', reason: 'parse_failed' }] }
          addMarker('managed_manifest', manifestRelativePath, 'root', 90, 'Unreadable Project Control manifest')
          collector.add('MANIFEST_PARSE_FAILED', 'blocking', 'The existing Project Control manifest could not be parsed.', { relativePath: manifestRelativePath })
        }
      } else {
        manifest = { relativePath: manifestRelativePath, status: 'unreadable', sha256: null, apiVersion: null, projectId: null, name: null, origin: null, errors: [] }
        addMarker('managed_manifest', manifestRelativePath, 'root', 90, 'Unreadable Project Control manifest')
      }
    } else {
      manifest = { relativePath: manifestRelativePath, status: 'invalid', sha256: null, apiVersion: null, projectId: null, name: null, origin: null, errors: [{ field: '$', reason: 'not_file' }] }
      addMarker('managed_manifest', manifestRelativePath, 'root', 90, 'Invalid Project Control manifest entry')
      collector.add('MANIFEST_NOT_FILE', 'blocking', 'The standard manifest path is not a regular file.', { relativePath: manifestRelativePath })
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') collector.add('MANIFEST_ACCESS_FAILED', 'blocking', 'The standard manifest location could not be inspected.', { relativePath: manifestRelativePath, causeCode: error?.code ?? 'UNKNOWN' })
  }

  async function processDocument(info, relativePath, explicit = false) {
    if (documentByPath.has(relativePath)) return documentByPath.get(relativePath)
    if (budget.documents >= preferences.maxDocuments) {
      noteLimit(budget, collector, 'maxDocuments')
      return null
    }
    if (!info.stat.isFile()) return null
    const bytes = await readBytes(info, relativePath, root, budget, collector, explicit)
    if (!bytes) return null
    let text
    try {
      text = decodeText(bytes)
    } catch (error) {
      collector.add(error?.code === 'BINARY_CONTENT' ? 'BINARY_DOCUMENT_SKIPPED' : 'TEXT_ENCODING_UNSUPPORTED', explicit ? 'blocking' : 'warning', 'A candidate document was not safe UTF-8/UTF-16 text and was skipped.', { relativePath })
      return null
    }
    const title = extractTitle(text)
    const classification = classifyDocument(relativePath, title, manifestRoles.get(relativePath) ?? [])
    const document = {
      relativePath,
      displayPath: info.displayPath,
      realPath: info.realPath,
      normalizedPath: info.normalizedPath,
      suggestedRole: classification.suggestedRole,
      roleCandidates: classification.roleCandidates,
      title,
      preview: makePreview(text, preferences.previewChars),
      sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
      byteSize: bytes.length,
      mtime: info.stat.mtime.toISOString(),
      observedAt: new Date().toISOString(),
      evidence: Object.freeze({
        signals: Object.freeze(classification.roleCandidates.flatMap((candidate) => candidate.evidence.map((evidence) => Object.freeze({ role: candidate.role, score: candidate.score, ...evidence }))).slice(0, 20)),
      }),
    }
    documents.push(Object.freeze(document))
    documentByPath.set(relativePath, document)
    budget.documents += 1
    summaryCandidates.push(...extractSummaryCandidates(text, relativePath, classification.suggestedRole))
    if (classification.suggestedRole && classification.suggestedRole !== 'other' && confidenceEvidence.length < 40) {
      confidenceEvidence.push(Object.freeze({ kind: 'document_role', relativePath, detail: classification.suggestedRole, weight: Math.min(25, classification.roleCandidates[0]?.score / 5 ?? 5) }))
    }
    if (!classification.suggestedRole && classification.roleCandidates.length > 1) collector.add('AMBIGUOUS_DOCUMENT_ROLE', 'warning', 'A document matched multiple roles and needs confirmation.', { relativePath, roles: classification.roleCandidates.map((item) => item.role) })
    return document
  }

  // Manifest entries are authoritative project-root-relative bindings. Verify
  // them directly before heuristic traversal so maxDepth and documents found
  // earlier in the walk cannot hide or starve a deep required binding.
  if (manifestStructurallyValid) {
    let requiredBindingsSafe = true
    for (const [relativePath, required] of manifestRequirements) {
      const displayPath = join(root.displayPath, ...relativePath.split('/'))
      const info = await inspectEntry(root, displayPath, relativePath, collector, required)
      if (!info?.stat.isFile()) {
        if (required) requiredBindingsSafe = false
        collector.add(
          required
            ? 'MANIFEST_REQUIRED_DOCUMENT_UNAVAILABLE'
            : 'MANIFEST_OPTIONAL_DOCUMENT_UNAVAILABLE',
          required ? 'blocking' : 'warning',
          required
            ? 'A required manifest document binding could not be resolved to a safe readable file.'
            : 'An optional manifest document binding is currently unavailable and will not be indexed.',
          { relativePath },
        )
        continue
      }
      const document = await processDocument(info, relativePath, required)
      if (document === null) {
        if (required) requiredBindingsSafe = false
        collector.add(
          required
            ? 'MANIFEST_REQUIRED_DOCUMENT_UNAVAILABLE'
            : 'MANIFEST_OPTIONAL_DOCUMENT_UNAVAILABLE',
          required ? 'blocking' : 'warning',
          required
            ? 'A required manifest document binding could not be read and hashed safely.'
            : 'An optional manifest document binding could not be read and hashed and will not be indexed.',
          { relativePath },
        )
      }
    }
    manifest.status = requiredBindingsSafe ? 'valid' : 'invalid'
    if (!requiredBindingsSafe) manifestStructurallyValid = false
  }

  const visitedDirectories = new Set([comparisonPath(root.realPath)])
  async function walk(displayDirectory, realDirectory, depth) {
    if (depth > preferences.maxDepth || budget.entries >= preferences.maxEntries) {
      if (budget.entries >= preferences.maxEntries) noteLimit(budget, collector, 'maxEntries')
      return
    }
    let entries
    try {
      entries = await readdir(realDirectory, { withFileTypes: true })
    } catch (error) {
      collector.add(error?.code === 'EACCES' || error?.code === 'EPERM' ? 'DIRECTORY_ACCESS_DENIED' : 'DIRECTORY_READ_FAILED', 'warning', 'A directory could not be enumerated and was skipped.', { relativePath: safeRelative(root, displayDirectory) ?? '.', causeCode: error?.code ?? 'UNKNOWN' })
      return
    }
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))
    for (const entry of entries) {
      if (budget.entries >= preferences.maxEntries) {
        noteLimit(budget, collector, 'maxEntries')
        return
      }
      budget.entries += 1
      const displayPath = join(displayDirectory, entry.name)
      const relativePath = safeRelative(root, displayPath)
      if (!relativePath) {
        collector.add('INVALID_RELATIVE_PATH', 'warning', 'An entry did not produce a safe project-relative path.', {})
        continue
      }
      const lowerName = entry.name.toLocaleLowerCase('en-US')
      if (depth === 0 && (lowerName === '.git' || lowerName === '.hg' || lowerName === '.svn')) {
        addMarker('repository', relativePath, 'root', 45, `${entry.name} repository marker`)
      }
      if (entry.isDirectory() && isIgnoredDirectoryName(lowerName)) {
        budget.skippedDirectories += 1
        continue
      }
      const info = await inspectEntry(root, displayPath, relativePath, collector)
      if (!info) continue
      if (info.stat.isDirectory()) {
        if (isIgnoredDirectoryName(lowerName)) {
          budget.skippedDirectories += 1
          continue
        }
        const key = comparisonPath(info.realPath)
        if (visitedDirectories.has(key)) {
          collector.add('DIRECTORY_CYCLE_SKIPPED', 'info', 'A duplicate directory target was skipped.', { relativePath })
          continue
        }
        visitedDirectories.add(key)
        if (depth < preferences.maxDepth) await walk(displayPath, info.realPath, depth + 1)
        continue
      }
      if (!info.stat.isFile()) continue
      if (relativePath.toLocaleLowerCase('en-US').endsWith('/.dsh-project/project.yaml')) {
        addMarker('nested_managed_manifest', relativePath, 'nested', 20, 'Nested Project Control manifest')
        collector.add('NESTED_MANIFEST_DETECTED', 'warning', 'A nested Project Control manifest does not change the selected outer project root.', { relativePath })
        continue
      }
      const markerKind = PROJECT_MARKERS.get(lowerName) ?? (/\.(?:sln|csproj|fsproj|vbproj)$/i.test(entry.name) ? 'dotnet_manifest' : null)
      if (markerKind) addMarker(markerKind, relativePath, depth === 0 ? 'root' : 'nested', depth === 0 ? 35 : 12, `${entry.name} project marker`)
      if (relativePath !== manifestRelativePath && shouldReadDocument(relativePath, manifestRoles)) await processDocument(info, relativePath, manifestRoles.has(relativePath))
      else if (relativePath === manifestRelativePath && depth > 1) collector.add('NESTED_MANIFEST_DETECTED', 'warning', 'A nested Project Control manifest does not change the selected outer project root.', { relativePath })
    }
  }
  await walk(root.displayPath, root.realPath, 0)

  documents.sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'en'))
  if (manifest === null) {
    for (const role of DOCUMENT_ROLES) {
      if (role === 'other') continue
      const matches = documents.filter((document) => document.roleCandidates.some((candidate) => candidate.role === role && candidate.score >= 65))
      if (matches.length > 1) collector.add('MULTIPLE_ROLE_CANDIDATES', 'warning', 'Multiple documents matched the same role; no primary document was selected.', { role, count: matches.length, relativePaths: matches.slice(0, 10).map((document) => document.relativePath) })
    }
  }

  const nameCandidates = []
  if (manifestStructurallyValid && manifest?.name) nameCandidates.push({ value: manifest.name, kind: 'manifest', relativePath: manifestRelativePath, confidence: 'high', score: 100 })
  for (const document of documents) {
    if (!document.title) continue
    if (document.roleCandidates.some((candidate) => candidate.role === 'prd' && candidate.score >= 65)) nameCandidates.push({ value: document.title, kind: 'prd_title', relativePath: document.relativePath, confidence: 'high', score: 90 })
    else if (document.roleCandidates.some((candidate) => candidate.role === 'readme' && candidate.score >= 65)) nameCandidates.push({ value: document.title, kind: 'readme_title', relativePath: document.relativePath, confidence: 'medium', score: 80 })
  }
  nameCandidates.push({ value: cleanSuggestedName(basename(root.displayPath)), kind: 'directory', relativePath: null, confidence: 'low', score: 50 })
  const manifestNames = nameCandidates.filter((item) => item.kind === 'manifest')
  const prdNames = nameCandidates.filter((item) => item.kind === 'prd_title')
  const rootReadmes = nameCandidates.filter((item) => item.kind === 'readme_title' && !item.relativePath.includes('/'))
  const selectedNameCandidate = manifestNames.length === 1
    ? manifestNames[0]
    : prdNames.length === 1
      ? prdNames[0]
      : rootReadmes.length === 1
        ? rootReadmes[0]
        : nameCandidates.at(-1)
  const suggestedName = cleanSuggestedName(selectedNameCandidate.value)

  const uniqueSummaries = []
  const summaryKeys = new Set()
  for (const candidate of summaryCandidates.sort((left, right) => right.score - left.score)) {
    const key = candidate.value.toLocaleLowerCase('en-US')
    if (!summaryKeys.has(key)) {
      summaryKeys.add(key)
      uniqueSummaries.push(candidate)
    }
  }
  const selectedSummary = uniqueSummaries.length === 1 ? uniqueSummaries[0] : null
  if (uniqueSummaries.length > 1) collector.add('MULTIPLE_SUMMARY_CANDIDATES', 'warning', 'Multiple explicit goal or summary statements were found; none was selected automatically.', { count: uniqueSummaries.length, sources: uniqueSummaries.slice(0, 10).map((item) => item.source) })

  const score = Math.min(100, Math.round(confidenceEvidence.reduce((total, evidence) => total + evidence.weight, 0)))
  const isCandidate = score > 0
  let manifestDocumentBindings = manifestStructurallyValid
    ? parsedManifest.spec.documents.entries.map((entry) => ({
      role: entry.role,
      relativePath: entry.path,
      contentHash: documentByPath.get(entry.path)?.sha256 ?? null,
      required: entry.required ?? false,
    }))
    : []
  let persistedManifest = manifestStructurallyValid
    ? Object.freeze({
      projectId: manifest.projectId,
      hash: manifest.sha256,
      name: manifest.name,
      relativePath: manifestRelativePath,
      origin: Object.freeze({ ...manifest.origin }),
      documentBindings: Object.freeze(manifestDocumentBindings.map((binding) => Object.freeze({ ...binding }))),
    })
    : null
  if (persistedManifest && Buffer.byteLength(JSON.stringify(persistedManifest), 'utf8') > 10_000) {
    collector.add('MANIFEST_SNAPSHOT_TOO_LARGE', 'blocking', 'The verified manifest metadata is too large for a safe restart-persistent intake snapshot.', { relativePath: manifestRelativePath })
    manifestStructurallyValid = false
    manifest.status = 'invalid'
    manifestDocumentBindings = []
    persistedManifest = null
  }
  const status = manifest && !manifestStructurallyValid ? 'conflict' : 'discovered'
  const detectedMode = manifestStructurallyValid ? 'managed' : manifest ? 'unknown' : isCandidate ? 'linked_legacy' : 'unknown'
  const endStats = { entries: budget.entries, documents: budget.documents, bytesRead: budget.bytesRead, skippedDirectories: budget.skippedDirectories }
  const rootCopy = pathRecord(root.displayPath, root.realPath)
  const persistedEvidence = [...confidenceEvidence]
  const confidence = {
    level: confidenceLevel(score),
    score,
    evidence: persistedEvidence,
    nameSource: {
      relativePath: selectedNameCandidate.relativePath,
      label: selectedNameCandidate.kind,
    },
    manifest: persistedManifest,
  }
  while (persistedEvidence.length > 0 && Buffer.byteLength(JSON.stringify(confidence), 'utf8') > 16_000) {
    persistedEvidence.pop()
  }
  confidence.evidence = Object.freeze(persistedEvidence)
  confidence.nameSource = Object.freeze(confidence.nameSource)
  return Object.freeze({
    root: rootCopy,
    displayPath: rootCopy.displayPath,
    realPath: rootCopy.realPath,
    normalizedPath: rootCopy.normalizedPath,
    isCandidate,
    detectedMode,
    status,
    manifestStatus: manifest?.status ?? 'absent',
    manifestProjectId: manifestStructurallyValid ? manifest.projectId : null,
    manifestHash: manifestStructurallyValid ? manifest.sha256 : null,
    manifestName: manifestStructurallyValid ? manifest.name : null,
    manifestOrigin: manifestStructurallyValid ? manifest.origin : null,
    manifestDocumentBindings: Object.freeze(manifestDocumentBindings.map(Object.freeze)),
    manifest: manifest ? Object.freeze({ ...manifest, errors: Object.freeze(manifest.errors.map(Object.freeze)) }) : null,
    suggestedName,
    nameCandidates: Object.freeze(nameCandidates.map(Object.freeze)),
    suggestedSummary: selectedSummary?.value ?? null,
    summarySource: selectedSummary ? `${selectedSummary.source.relativePath}:${selectedSummary.source.line}`.slice(0, 512) : null,
    summary: Object.freeze({ value: selectedSummary?.value ?? null, source: selectedSummary ? Object.freeze(selectedSummary.source) : null }),
    confidence: Object.freeze(confidence),
    markers: Object.freeze(markers),
    documents: Object.freeze(documents),
    issues: Object.freeze(collector.issues),
    scanStats: Object.freeze({
      entriesVisited: endStats.entries - startStats.entries,
      documentsRead: endStats.documents - startStats.documents,
      bytesRead: endStats.bytesRead - startStats.bytesRead,
      skippedDirectories: endStats.skippedDirectories - startStats.skippedDirectories,
      limitsReached: Object.freeze([...budget.limits]),
    }),
  })
}

function scanEnvelope(mode, root, preferences, candidates, issues, budget) {
  const rootPath = pathRecord(root.displayPath, root.realPath)
  const scanPreferences = Object.freeze({ ...preferences, ignoredDirectories: Object.freeze([...IGNORED_DIRECTORIES].sort()) })
  return Object.freeze({
    mode,
    scannerVersion: SCANNER_VERSION,
    rootPath,
    sourceRoot: Object.freeze({ ...rootPath, scanPreferences, isEnabled: true }),
    scanPreferences,
    status: 'completed',
    summary: Object.freeze({
      candidateCount: candidates.length,
      issueCount: issues.length + candidates.reduce((total, candidate) => total + candidate.issues.length, 0),
      entriesVisited: budget.entries,
      documentsRead: budget.documents,
      bytesRead: budget.bytesRead,
      skippedDirectories: budget.skippedDirectories,
      limitsReached: Object.freeze([...budget.limits]),
      projectDirectoriesModified: 0,
    }),
    candidates: Object.freeze(candidates),
    issues: Object.freeze(issues),
  })
}

export async function scanProjectDirectory(rootPath, options = {}) {
  const preferences = normalizeOptions(options)
  const root = await resolveDirectoryRoot(rootPath, 'Project root')
  const budget = createBudget(preferences)
  const candidate = await scanProjectInternal(root, preferences, budget)
  return scanEnvelope('single_project', root, preferences, [candidate], [], budget)
}

export async function scanSourceDirectory(rootPath, options = {}) {
  const preferences = normalizeOptions(options)
  const root = await resolveDirectoryRoot(rootPath, 'Source root')
  const budget = createBudget(preferences)
  const sourceIssues = createIssueCollector()
  const candidates = []
  const visited = new Set([comparisonPath(root.realPath)])

  async function visit(displayDirectory, realDirectory, depth) {
    if (depth >= preferences.sourceDepth || candidates.length >= preferences.maxCandidates || budget.entries >= preferences.maxEntries) return
    let entries
    try {
      entries = await readdir(realDirectory, { withFileTypes: true })
    } catch (error) {
      sourceIssues.add(error?.code === 'EACCES' || error?.code === 'EPERM' ? 'DIRECTORY_ACCESS_DENIED' : 'DIRECTORY_READ_FAILED', 'warning', 'A source directory could not be enumerated.', { relativePath: safeRelative(root, displayDirectory) ?? '.', causeCode: error?.code ?? 'UNKNOWN' })
      return
    }
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))
    for (const entry of entries) {
      if (candidates.length >= preferences.maxCandidates) {
        noteLimit(budget, sourceIssues, 'maxCandidates')
        return
      }
      if (budget.entries >= preferences.maxEntries) {
        noteLimit(budget, sourceIssues, 'maxEntries')
        return
      }
      if (isIgnoredDirectoryName(entry.name.toLocaleLowerCase('en-US'))) {
        budget.skippedDirectories += 1
        continue
      }
      const displayPath = join(displayDirectory, entry.name)
      const relativePath = safeRelative(root, displayPath)
      if (!relativePath) continue
      budget.entries += 1
      const info = await inspectEntry(root, displayPath, relativePath, sourceIssues)
      if (!info?.stat.isDirectory()) continue
      const key = comparisonPath(info.realPath)
      if (visited.has(key)) continue
      visited.add(key)
      const candidateRoot = pathRecord(displayPath, info.realPath)
      const candidate = await scanProjectInternal(candidateRoot, preferences, budget)
      if (candidate.isCandidate) candidates.push(candidate)
      else if (depth + 1 < preferences.sourceDepth) await visit(displayPath, info.realPath, depth + 1)
    }
  }
  await visit(root.displayPath, root.realPath, 0)
  candidates.sort((left, right) => left.normalizedPath.localeCompare(right.normalizedPath, 'en'))
  return scanEnvelope('source_root', root, preferences, candidates, sourceIssues.issues, budget)
}
