import { createHash } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, isAbsolute, join, normalize, resolve, win32 } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

import { canonicalJson, requestSha256 } from './canonical-json.js'
import {
  IdempotencyConflictError,
  InvalidStoragePathError,
  StorageValidationError,
} from './errors.js'
import { migrateDatabase } from './migrations.js'
import { createPrefixedUuidV7 } from './ids.js'
import { acquireWriterLock } from './writer-lock.js'

const PROTOCOL_VERSION = 'project-control.dsh/v1alpha1'
const RESULT_SCHEMA_VERSION = 'lifecycle-command-result/v1alpha1'
const EVENT_SCHEMA_VERSION = 'lifecycle-normalized-event/v1alpha1'
const EXTERNAL_EVENT_SCHEMA_VERSION = 'normalized-event/v1alpha1'
const EXTERNAL_RESULT_SCHEMA_VERSION = 'command-result/v1alpha1'
const OUTBOX_DESTINATION = 'project-control.lifecycle.events'
const DEFAULT_MIGRATIONS_DIRECTORIES = [
  fileURLToPath(new URL('../migrations/', import.meta.url)),
  fileURLToPath(new URL('../../migrations/', import.meta.url)),
]

function defaultMigrationsDirectory() {
  return DEFAULT_MIGRATIONS_DIRECTORIES.find((candidate) => existsSync(candidate))
    ?? DEFAULT_MIGRATIONS_DIRECTORIES[0]
}
const SUPPORTED_REGISTER_KINDS = new Set([
  'project.registerLegacy',
  'project.registerManaged',
])
const EVENT_ID = /^evt_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const CONTENT_HASH = /^sha256:[0-9a-f]{64}$/
const TEMPLATE_ID_PATTERN = /^[a-z][a-z0-9.-]{1,127}$/
const TEMPLATE_VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+$/
const DOCUMENT_ROLES = new Set([
  'readme',
  'prd',
  'devlog',
  'progress',
  'next',
  'current_architecture',
  'decision',
  'other',
])
const RELATIVE_PATH = /^(?!\/)(?!.*[:\\])(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*[\u0000-\u001F\u007F])(?!.*\/\/)(?!.*\/$)[^/]+(?:\/[^/]+)*$/
const BUSINESS_IDS = Object.freeze({
  src: /^src_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  job: /^job_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  can: /^can_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  doc: /^doc_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  iss: /^iss_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  jis: /^jis_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  loc: /^loc_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  srt: /^srt_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  pln: /^pln_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  cmd: /^cmd_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  prj: /^prj_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  rbd: /^rbd_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  wrk: /^wrk_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  run: /^run_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  rev: /^rev_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  rva: /^rva_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  dec: /^dec_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  atb: /^atb_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  upd: /^upd_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  qtn: /^qtn_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  out: /^out_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
})
const INTAKE_SCOPE = 'project-control.lifecycle'
const CANDIDATE_STATES = new Set(['discovered', 'conflict', 'relocation_candidate'])
const MAX_SCAN_CANDIDATES = 500
const MAX_CANDIDATE_DOCUMENTS = 200
const MAX_CANDIDATE_ISSUES = 200
const MAX_JOB_ISSUES = 500
const MAX_SCAN_DOCUMENTS = 10_000
const MAX_SCAN_ISSUES = 5_000
const DOCUMENT_INDEX_STATES = new Set(['ok', 'changed', 'missing', 'unreadable'])
const PARSE_ISSUE_SEVERITIES = new Set(['info', 'warning', 'error', 'blocking'])
const MAX_INDEX_DOCUMENTS = 200
const MAX_INDEX_PARSE_ISSUES = 20
const MAX_REBIND_PROPOSALS = 50
const MAX_REBIND_CANDIDATES = 50
const MAX_DOCUMENT_BYTES = 64 * 1024 * 1024
const EXTERNAL_UPDATE_KINDS = new Set(['progress.report', 'blocker.raise', 'completion.declare'])
const EXTERNAL_EVENT_TYPES = Object.freeze({
  'progress.report': 'progress.recorded',
  'blocker.raise': 'blocker.raised',
  'completion.declare': 'completion.declared',
})
const WORK_ITEM_STATUSES = new Set(['draft', 'ready', 'running', 'paused', 'blocked', 'completed', 'cancelled'])
const RUN_STATUSES = new Set(['queued', 'running', 'completed', 'failed', 'blocked', 'orphaned', 'cancelled'])
const REVIEW_STATUSES = new Set(['requested', 'in_review', 'approved', 'rejected', 'superseded'])
const REVIEW_RISKS = new Set(['unrated', 'low', 'medium', 'high'])
/** Actor stamped on console-driven commands issued from the local desktop UI. */
const CONSOLE_ACTOR = Object.freeze({
  kind: 'human',
  id: 'desktop-console-user',
  applicationId: 'deepseek-harness-personal',
})
const INSTANCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,126}$/
const THREAD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const WINDOWS_PATH_KEY_VERSION = 'windows-unicode-v1:'

function defaultNow() {
  return new Date().toISOString()
}

function requireString(value, field) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new StorageValidationError(`${field} must be a non-empty string.`, { field })
  }
  return value
}

function requireBoundedString(value, field, maximum, minimum = 1) {
  requireString(value, field)
  if (value.length < minimum || value.length > maximum) {
    throw new StorageValidationError(
      `${field} must contain between ${minimum} and ${maximum} characters.`,
      { field, minimum, maximum },
    )
  }
  return value
}

function optionalBoundedString(value, field, maximum) {
  if (value === null || value === undefined) return null
  return requireBoundedString(value, field, maximum)
}

function requireInteger(value, field, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new StorageValidationError(`${field} must be an integer >= ${minimum}.`, { field })
  }
  return value
}

function requireObject(value, field) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new StorageValidationError(`${field} must be an object.`, { field })
  }
  return value
}

function isNetworkPath(value) {
  return /^(?:\\\\\?\\UNC\\|\\\\(?!\?\\)|\/\/)/i.test(value)
}

function projectPathKey(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new StorageValidationError('A project path key requires a non-empty path string.')
  }
  const separatorNormalized = win32.normalize(value.replaceAll('/', '\\'))
  const unicodeFolded = separatorNormalized.normalize('NFC').toLocaleLowerCase('en-US')
  return `${WINDOWS_PATH_KEY_VERSION}${unicodeFolded}`
}

function sameFilesystemPath(left, right) {
  return projectPathKey(left) === projectPathKey(right)
}

function validateStoragePath(value, field) {
  requireString(value, field)
  const isUnc = isNetworkPath(value)
  if (!isAbsolute(value) || value === ':memory:' || value.startsWith('file:') || isUnc) {
    throw new InvalidStoragePathError(`${field} must be a stable absolute filesystem path.`, {
      field,
      value,
      reason: isUnc ? 'network_paths_are_not_supported' : 'not_a_stable_absolute_path',
    })
  }
  return normalize(resolve(value))
}

function validateWorkspacePath(value, field) {
  requireBoundedString(value, field, 2048)
  if (!isAbsolute(value) || value.startsWith('file:') || isNetworkPath(value)) {
    throw new InvalidStoragePathError(`${field} must be an absolute local filesystem path.`, {
      field,
      value,
      reason: isNetworkPath(value) ? 'network_paths_are_not_supported' : 'not_an_absolute_local_path',
    })
  }
  return normalize(resolve(value))
}

function validatePathPair(value, field) {
  const pair = requireObject(value, field)
  const displayPath = validateWorkspacePath(pair.displayPath, `${field}.displayPath`)
  const normalizedPath = validateWorkspacePath(
    pair.normalizedPath ?? displayPath,
    `${field}.normalizedPath`,
  )
  return { displayPath, normalizedPath, pathKey: projectPathKey(normalizedPath) }
}

function pathIsWithin(rootPath, candidatePath) {
  const rootKey = projectPathKey(rootPath)
  const candidateKey = projectPathKey(candidatePath)
  const childPrefix = rootKey.endsWith('\\') ? rootKey : `${rootKey}\\`
  return candidateKey === rootKey || candidateKey.startsWith(childPrefix)
}

function requireTimestamp(value, field) {
  requireBoundedString(value, field, 64)
  if (!Number.isFinite(Date.parse(value))) {
    throw new StorageValidationError(`${field} must be an ISO-8601 timestamp.`, { field })
  }
  return value
}

function boundedJson(value, field, maximumBytes, requireJsonObject = false) {
  if (requireJsonObject) requireObject(value, field)
  const stack = [{ value, depth: 0 }]
  const seen = new WeakSet()
  let nodes = 0
  while (stack.length > 0) {
    const current = stack.pop()
    nodes += 1
    if (nodes > 10_000 || current.depth > 20) {
      throw new StorageValidationError(`${field} exceeds its JSON structure limit.`, { field })
    }
    if (typeof current.value === 'string' && current.value.length > 4096) {
      throw new StorageValidationError(`${field} contains an unbounded metadata string.`, { field })
    }
    if (current.value === null || typeof current.value !== 'object') continue
    if (seen.has(current.value)) {
      throw new StorageValidationError(`${field} must be a tree-shaped JSON value.`, { field })
    }
    seen.add(current.value)
    if (Array.isArray(current.value)) {
      for (const item of current.value) stack.push({ value: item, depth: current.depth + 1 })
      continue
    }
    for (const [key, child] of Object.entries(current.value)) {
      if (key.length > 200) {
        throw new StorageValidationError(`${field} contains an oversized JSON key.`, { field })
      }
      if (/^(?:content|contents|body|full(?:text|content)|raw(?:text|content)|file(?:text|content))$/i.test(key)) {
        throw new StorageValidationError(`${field} cannot contain full file-content fields.`, {
          field,
          key,
        })
      }
      stack.push({ value: child, depth: current.depth + 1 })
    }
  }
  const json = canonicalJson(value)
  if (Buffer.byteLength(json, 'utf8') > maximumBytes) {
    throw new StorageValidationError(`${field} exceeds its JSON size limit.`, {
      field,
      maximumBytes,
    })
  }
  return json
}

function createBusinessId(idFactory, prefix, field) {
  const id = requireString(idFactory(prefix), field)
  if (!BUSINESS_IDS[prefix]?.test(id)) {
    throw new StorageValidationError(`${field} must be a ${prefix}_ UUIDv7.`, { field })
  }
  return id
}

function parseJson(value) {
  return value === null || value === undefined ? null : JSON.parse(value)
}

function mapLocation(row) {
  if (!row) return null
  return {
    locationId: row.locationId,
    projectId: row.projectId,
    kind: row.kind,
    displayPath: row.displayPath,
    normalizedPath: row.normalizedPath,
    isActive: Boolean(row.isActive),
    verifiedAt: row.verifiedAt,
    revision: Number(row.revision),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function mapProject(row, locations = undefined) {
  if (!row) return null
  const project = {
    projectId: row.projectId,
    mode: row.mode,
    name: row.name,
    originKind: row.originKind,
    templateId: row.templateId,
    templateVersion: row.templateVersion,
    forkedFromProjectId: row.forkedFromProjectId,
    lifecycle: row.lifecycle,
    health: row.health,
    revision: Number(row.revision),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt,
  }
  if (locations !== undefined) project.workspaceLocations = locations.map(mapLocation)
  return project
}

function mapDocumentBinding(row) {
  return {
    role: row.role,
    relativePath: row.relativePath,
    contentHash: row.contentHash,
    required: Boolean(row.isRequired),
    source: row.source,
    confirmedAt: row.confirmedAt,
    revision: Number(row.revision),
  }
}

function validateDocumentBindings(value, { source, requireContentHash }) {
  if (!Array.isArray(value) || value.length > 200) {
    throw new StorageValidationError('Confirmed document bindings must be an array of at most 200 items.')
  }
  const seen = new Set()
  return value.map((raw, index) => {
    const binding = requireObject(raw, `documentBindings[${index}]`)
    const role = requireString(binding.role, `documentBindings[${index}].role`)
    const relativePath = requireString(
      binding.relativePath,
      `documentBindings[${index}].relativePath`,
    )
    if (!DOCUMENT_ROLES.has(role) || !RELATIVE_PATH.test(relativePath)) {
      throw new StorageValidationError('Confirmed document binding contains an invalid role or relative path.', {
        index,
      })
    }
    const contentHash = binding.contentHash ?? null
    if ((requireContentHash || contentHash !== null) && !CONTENT_HASH.test(contentHash)) {
      throw new StorageValidationError('Confirmed document binding contains an invalid content hash.', {
        index,
      })
    }
    if (binding.required !== undefined && typeof binding.required !== 'boolean') {
      throw new StorageValidationError('Confirmed document binding required flag must be boolean.', { index })
    }
    const identity = `${role}\u0000${relativePath}`
    if (seen.has(identity)) {
      throw new StorageValidationError('Confirmed document bindings contain a duplicate role/path pair.', {
        index,
      })
    }
    seen.add(identity)
    return {
      role,
      relativePath,
      contentHash,
      required: binding.required ?? false,
      source,
    }
  })
}

function insertDocumentBindings(database, projectId, bindings, confirmedAt) {
  const statement = database.prepare(`
    INSERT INTO project_document_bindings(
      project_id, role, relative_path, content_hash, is_required,
      source, confirmed_at, revision
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  `)
  for (const binding of bindings) {
    statement.run(
      projectId,
      binding.role,
      binding.relativePath,
      binding.contentHash,
      binding.required ? 1 : 0,
      binding.source,
      confirmedAt,
    )
  }
}

function validateImportIssue(rawIssue, field, details = {}) {
  const issue = requireObject(rawIssue, field)
  const severity = issue.severity ?? 'warning'
  if (!['info', 'warning', 'error', 'blocking'].includes(severity)) {
    throw new StorageValidationError('Import issue severity is not supported.', details)
  }
  const issueStatus = issue.status ?? 'open'
  if (!['open', 'resolved'].includes(issueStatus)) {
    throw new StorageValidationError('Import issue status is not supported.', details)
  }
  const resolvedAt = issue.resolvedAt ?? null
  if ((issueStatus === 'resolved') !== (resolvedAt !== null)) {
    throw new StorageValidationError(
      'Resolved import issues require resolvedAt and open issues forbid it.',
      details,
    )
  }
  const issueDetails = { ...requireObject(issue.details ?? {}, `${field}.details`) }
  if (issue.message !== undefined) {
    issueDetails.message = requireBoundedString(issue.message, `${field}.message`, 2000)
  }
  return {
    code: requireBoundedString(issue.code, `${field}.code`, 100),
    severity,
    detailsJson: boundedJson(issueDetails, `${field}.details`, 16_384, true),
    status: issueStatus,
    resolvedAt: resolvedAt === null ? null : requireTimestamp(resolvedAt, `${field}.resolvedAt`),
  }
}

function validateImportScan(input) {
  const scan = requireObject(input, 'scan')
  if (!['source_root', 'single_project'].includes(scan.mode)) {
    throw new StorageValidationError('scan.mode must be source_root or single_project.')
  }
  const rootPath = validatePathPair(scan.rootPath, 'scan.rootPath')
  const sourceInput = scan.sourceRoot === null || scan.sourceRoot === undefined
    ? { ...rootPath, scanPreferences: scan.scanPreferences ?? {} }
    : requireObject(scan.sourceRoot, 'scan.sourceRoot')
  const sourcePath = validatePathPair(sourceInput, 'scan.sourceRoot')
  if (!pathIsWithin(sourcePath.normalizedPath, rootPath.normalizedPath)) {
    throw new StorageValidationError('The scan root must remain within its authorized source root.', {
      reason: 'scan_root_outside_source_root',
    })
  }
  const sourcePreferencesJson = boundedJson(
    sourceInput.scanPreferences ?? {},
    'scan.sourceRoot.scanPreferences',
    65_536,
    true,
  )
  if (sourceInput.isEnabled !== undefined && typeof sourceInput.isEnabled !== 'boolean') {
    throw new StorageValidationError('scan.sourceRoot.isEnabled must be boolean.')
  }
  const scanPreferencesJson = boundedJson(
    scan.scanPreferences ?? sourceInput.scanPreferences ?? {},
    'scan.scanPreferences',
    65_536,
    true,
  )
  const scannerVersion = requireBoundedString(scan.scannerVersion, 'scan.scannerVersion', 100)
  const status = scan.status ?? 'completed'
  if (!['completed', 'failed', 'cancelled'].includes(status)) {
    throw new StorageValidationError('scan.status is not supported.')
  }
  const summaryJson = boundedJson(scan.summary ?? {}, 'scan.summary', 65_536, true)
  if (!Array.isArray(scan.candidates) || scan.candidates.length > MAX_SCAN_CANDIDATES) {
    throw new StorageValidationError(`scan.candidates must contain at most ${MAX_SCAN_CANDIDATES} items.`)
  }
  if (scan.mode === 'single_project' && scan.candidates.length > 1) {
    throw new StorageValidationError('A single_project scan cannot persist more than one candidate.')
  }

  const rawJobIssues = scan.issues ?? []
  if (!Array.isArray(rawJobIssues) || rawJobIssues.length > MAX_JOB_ISSUES) {
    throw new StorageValidationError(`scan.issues must contain at most ${MAX_JOB_ISSUES} items.`)
  }
  const issues = rawJobIssues.map((rawIssue, issueIndex) => validateImportIssue(
    rawIssue,
    `scan.issues[${issueIndex}]`,
    { issueIndex },
  ))

  let totalDocuments = 0
  let totalIssues = issues.length
  const seenCandidatePaths = new Set()
  const candidates = scan.candidates.map((rawCandidate, candidateIndex) => {
    const candidate = requireObject(rawCandidate, `scan.candidates[${candidateIndex}]`)
    const root = validatePathPair(candidate.root, `scan.candidates[${candidateIndex}].root`)
    if (!pathIsWithin(sourcePath.normalizedPath, root.normalizedPath)) {
      throw new StorageValidationError('A candidate root escaped its authorized source root.', {
        reason: 'candidate_outside_source_root',
        candidateIndex,
      })
    }
    if (!pathIsWithin(rootPath.normalizedPath, root.normalizedPath)) {
      throw new StorageValidationError('A candidate root escaped the concrete scan boundary.', {
        reason: 'candidate_outside_scan_root',
        candidateIndex,
      })
    }
    if (scan.mode === 'single_project' && !sameFilesystemPath(root.normalizedPath, rootPath.normalizedPath)) {
      throw new StorageValidationError('A single_project candidate must equal the selected scan root.', {
        reason: 'single_project_root_mismatch',
        candidateIndex,
      })
    }
    if (seenCandidatePaths.has(root.pathKey)) {
      throw new StorageValidationError('A scan cannot contain the same candidate root twice.', {
        candidateIndex,
      })
    }
    seenCandidatePaths.add(root.pathKey)

    const detectedMode = candidate.detectedMode ?? 'unknown'
    if (!['unknown', 'linked_legacy', 'managed'].includes(detectedMode)) {
      throw new StorageValidationError('Candidate detectedMode is not supported.', { candidateIndex })
    }
    const candidateStatus = candidate.status ?? 'discovered'
    if (!CANDIDATE_STATES.has(candidateStatus)) {
      throw new StorageValidationError('Initial candidate status is not supported.', { candidateIndex })
    }
    const confidenceJson = boundedJson(
      candidate.confidence ?? {},
      `scan.candidates[${candidateIndex}].confidence`,
      16_384,
      true,
    )
    if (!Array.isArray(candidate.documents) || candidate.documents.length > MAX_CANDIDATE_DOCUMENTS) {
      throw new StorageValidationError(
        `Each candidate may contain at most ${MAX_CANDIDATE_DOCUMENTS} documents.`,
        { candidateIndex },
      )
    }
    if (!Array.isArray(candidate.issues) || candidate.issues.length > MAX_CANDIDATE_ISSUES) {
      throw new StorageValidationError(
        `Each candidate may contain at most ${MAX_CANDIDATE_ISSUES} issues.`,
        { candidateIndex },
      )
    }
    totalDocuments += candidate.documents.length
    totalIssues += candidate.issues.length
    const seenDocuments = new Set()
    const documents = candidate.documents.map((rawDocument, documentIndex) => {
      const field = `scan.candidates[${candidateIndex}].documents[${documentIndex}]`
      const document = requireObject(rawDocument, field)
      const relativePath = requireBoundedString(document.relativePath, `${field}.relativePath`, 512)
      if (!RELATIVE_PATH.test(relativePath)) {
        throw new StorageValidationError('Candidate document path must be a safe project-relative path.', {
          candidateIndex,
          documentIndex,
        })
      }
      if (seenDocuments.has(relativePath)) {
        throw new StorageValidationError('Candidate documents contain a duplicate relative path.', {
          candidateIndex,
          documentIndex,
        })
      }
      seenDocuments.add(relativePath)
      const suggestedRole = document.suggestedRole ?? null
      if (suggestedRole !== null && !DOCUMENT_ROLES.has(suggestedRole)) {
        throw new StorageValidationError('Candidate document role is not supported.', {
          candidateIndex,
          documentIndex,
        })
      }
      const sha256 = document.sha256 ?? null
      if (sha256 !== null && !CONTENT_HASH.test(sha256)) {
        throw new StorageValidationError('Candidate document sha256 is invalid.', {
          candidateIndex,
          documentIndex,
        })
      }
      return {
        relativePath,
        suggestedRole,
        sha256,
        title: optionalBoundedString(document.title, `${field}.title`, 500),
        preview: optionalBoundedString(document.preview, `${field}.preview`, 1000),
        observedAt: document.observedAt === undefined
          ? null
          : requireTimestamp(document.observedAt, `${field}.observedAt`),
        evidenceJson: boundedJson(document.evidence ?? {}, `${field}.evidence`, 16_384, true),
      }
    })
    const issues = candidate.issues.map((rawIssue, issueIndex) => validateImportIssue(
      rawIssue,
      `scan.candidates[${candidateIndex}].issues[${issueIndex}]`,
      { candidateIndex, issueIndex },
    ))
    return {
      root,
      detectedMode,
      manifestProjectId: optionalBoundedString(
        candidate.manifestProjectId,
        `scan.candidates[${candidateIndex}].manifestProjectId`,
        100,
      ),
      suggestedName: optionalBoundedString(
        candidate.suggestedName,
        `scan.candidates[${candidateIndex}].suggestedName`,
        200,
      ),
      suggestedSummary: optionalBoundedString(
        candidate.suggestedSummary,
        `scan.candidates[${candidateIndex}].suggestedSummary`,
        2000,
      ),
      summarySource: optionalBoundedString(
        candidate.summarySource,
        `scan.candidates[${candidateIndex}].summarySource`,
        512,
      ),
      confidenceJson,
      status: candidateStatus,
      documents,
      issues,
    }
  })
  if (totalDocuments > MAX_SCAN_DOCUMENTS || totalIssues > MAX_SCAN_ISSUES) {
    throw new StorageValidationError('The complete scan exceeds its bounded document or issue total.', {
      totalDocuments,
      totalIssues,
      maximumDocuments: MAX_SCAN_DOCUMENTS,
      maximumIssues: MAX_SCAN_ISSUES,
    })
  }
  return {
    mode: scan.mode,
    rootPath,
    sourcePath,
    sourcePreferencesJson,
    scanPreferencesJson,
    sourceEnabled: sourceInput.isEnabled ?? true,
    scannerVersion,
    status,
    summaryJson,
    startedAt: scan.startedAt === undefined ? null : requireTimestamp(scan.startedAt, 'scan.startedAt'),
    completedAt: scan.completedAt === undefined
      ? null
      : requireTimestamp(scan.completedAt, 'scan.completedAt'),
    issues,
    candidates,
  }
}

function mapSourceRoot(row) {
  if (!row) return null
  return {
    sourceRootId: row.sourceRootId,
    kind: row.kind,
    displayPath: row.displayPath,
    normalizedPath: row.normalizedPath,
    scanPreferences: parseJson(row.scanPreferencesJson),
    isEnabled: Boolean(row.isEnabled),
    revision: Number(row.revision),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function mapImportJobIssue(row) {
  const details = parseJson(row.detailsJson)
  return {
    importJobIssueId: row.importJobIssueId,
    importJobId: row.importJobId,
    code: row.code,
    severity: row.severity,
    message: typeof details?.message === 'string' ? details.message : null,
    details,
    status: row.status,
    resolvedAt: row.resolvedAt,
  }
}

function mapImportJob(row, issues = []) {
  if (!row) return null
  return {
    importJobId: row.importJobId,
    sourceRootId: row.sourceRootId,
    rootPathSnapshot: row.rootPathSnapshot,
    rootNormalizedPathSnapshot: row.rootNormalizedPathSnapshot,
    scanPreferencesSnapshot: parseJson(row.scanPreferencesSnapshotJson),
    mode: row.mode,
    status: row.status,
    scannerVersion: row.scannerVersion,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    summary: parseJson(row.summaryJson),
    issues,
  }
}

function mapCandidateDocument(row) {
  return {
    candidateDocumentId: row.candidateDocumentId,
    candidateId: row.candidateId,
    relativePath: row.relativePath,
    suggestedRole: row.suggestedRole,
    sha256: row.sha256,
    title: row.title,
    preview: row.preview,
    observedAt: row.observedAt,
    evidence: parseJson(row.evidenceJson),
  }
}

function mapImportIssue(row) {
  const details = parseJson(row.detailsJson)
  return {
    importIssueId: row.importIssueId,
    candidateId: row.candidateId,
    code: row.code,
    severity: row.severity,
    message: typeof details?.message === 'string' ? details.message : null,
    details,
    status: row.status,
    resolvedAt: row.resolvedAt,
  }
}

function mapImportCandidate(row, documents = [], issues = []) {
  if (!row) return null
  return {
    candidateId: row.candidateId,
    importJobId: row.importJobId,
    sourceRootId: row.sourceRootId,
    root: {
      displayPath: row.rootDisplayPath,
      normalizedPath: row.rootNormalizedPath,
    },
    detectedMode: row.detectedMode,
    manifestProjectId: row.manifestProjectId,
    suggestedName: row.suggestedName,
    suggestedSummary: row.suggestedSummary,
    summarySource: row.summarySource,
    confidence: parseJson(row.confidenceJson),
    status: row.status,
    statusBeforeIgnored: row.statusBeforeIgnored,
    matchedProjectId: row.matchedProjectId,
    revision: Number(row.revision),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    documents,
    issues,
  }
}

function selectSourceRoot(database, sourceRootId) {
  const row = database.prepare(`
    SELECT
      source_root_id AS sourceRootId, kind, display_path AS displayPath,
      normalized_path AS normalizedPath, scan_preferences_json AS scanPreferencesJson,
      is_enabled AS isEnabled, revision, created_at AS createdAt, updated_at AS updatedAt
    FROM project_source_roots
    WHERE source_root_id = ?
  `).get(sourceRootId)
  return row ? Object.freeze(mapSourceRoot(row)) : null
}

function selectImportJob(database, importJobId) {
  const row = database.prepare(`
    SELECT
      import_job_id AS importJobId, source_root_id AS sourceRootId,
      root_path_snapshot AS rootPathSnapshot,
      root_normalized_path_snapshot AS rootNormalizedPathSnapshot,
      scan_preferences_snapshot_json AS scanPreferencesSnapshotJson,
      mode, status, scanner_version AS scannerVersion,
      started_at AS startedAt, completed_at AS completedAt, summary_json AS summaryJson
    FROM import_jobs
    WHERE import_job_id = ?
  `).get(importJobId)
  if (!row) return null
  const issues = database.prepare(`
    SELECT
      import_job_issue_id AS importJobIssueId, import_job_id AS importJobId,
      code, severity, details_json AS detailsJson, status, resolved_at AS resolvedAt
    FROM import_job_issues
    WHERE import_job_id = ?
    ORDER BY severity DESC, import_job_issue_id
  `).all(importJobId).map(mapImportJobIssue)
  return Object.freeze(mapImportJob(row, issues))
}

function selectImportCandidate(database, candidateId) {
  const row = database.prepare(`
    SELECT
      candidate_id AS candidateId, import_job_id AS importJobId,
      source_root_id AS sourceRootId, root_display_path AS rootDisplayPath,
      root_normalized_path AS rootNormalizedPath, detected_mode AS detectedMode,
      manifest_project_id AS manifestProjectId, suggested_name AS suggestedName,
      suggested_summary AS suggestedSummary, summary_source AS summarySource,
      confidence_json AS confidenceJson, status,
      status_before_ignored AS statusBeforeIgnored,
      matched_project_id AS matchedProjectId, revision,
      created_at AS createdAt, updated_at AS updatedAt
    FROM import_candidates
    WHERE candidate_id = ?
  `).get(candidateId)
  if (!row) return null
  const documents = database.prepare(`
    SELECT
      candidate_document_id AS candidateDocumentId, candidate_id AS candidateId,
      relative_path AS relativePath, suggested_role AS suggestedRole, sha256,
      title, preview, observed_at AS observedAt, evidence_json AS evidenceJson
    FROM import_candidate_documents
    WHERE candidate_id = ?
    ORDER BY relative_path, candidate_document_id
  `).all(candidateId).map(mapCandidateDocument)
  const issues = database.prepare(`
    SELECT
      import_issue_id AS importIssueId, candidate_id AS candidateId, code, severity,
      details_json AS detailsJson, status, resolved_at AS resolvedAt
    FROM import_issues
    WHERE candidate_id = ?
    ORDER BY severity DESC, import_issue_id
  `).all(candidateId).map(mapImportIssue)
  return Object.freeze(mapImportCandidate(row, documents, issues))
}

function requireCandidateRevision(database, candidateId, expectedRevision) {
  requireString(candidateId, 'candidateId')
  requireInteger(expectedRevision, 'expectedRevision', 1)
  const row = database.prepare(`
    SELECT status, status_before_ignored AS statusBeforeIgnored,
      matched_project_id AS matchedProjectId, revision
    FROM import_candidates WHERE candidate_id = ?
  `).get(candidateId)
  if (!row) {
    throw new StorageValidationError('Import candidate was not found.', {
      reason: 'candidate_not_found',
      candidateId,
    })
  }
  if (Number(row.revision) !== expectedRevision) {
    throw new StorageValidationError('Import candidate revision changed.', {
      reason: 'revision_conflict',
      candidateId,
      expectedRevision,
      currentRevision: Number(row.revision),
    })
  }
  return row
}

function mapReceipt(row) {
  if (!row) return null
  return {
    commandId: row.commandId,
    idempotencyScope: row.idempotencyScope,
    idempotencyKey: row.idempotencyKey,
    kind: row.kind,
    requestSha256: row.requestSha256,
    actor: parseJson(row.actorRef),
    status: row.status,
    result: parseJson(row.resultJson),
    error: parseJson(row.errorJson),
    receivedAt: row.receivedAt,
    completedAt: row.completedAt,
  }
}

function mapEvent(row) {
  if (!row) return null
  return {
    eventId: row.eventId,
    sequence: Number(row.sequence),
    projectId: row.projectId,
    aggregateType: row.aggregateType,
    aggregateId: row.aggregateId,
    beforeRevision: Number(row.beforeRevision),
    afterRevision: Number(row.afterRevision),
    eventType: row.eventType,
    schemaVersion: row.schemaVersion,
    data: parseJson(row.payloadJson),
    actor: parseJson(row.actorRef),
    provenance: parseJson(row.provenanceJson),
    commandId: row.commandId,
    correlationId: row.correlationId,
    causationId: row.causationId,
    occurredAt: row.occurredAt,
    recordedAt: row.recordedAt,
  }
}

function validateCommand(command, expectedKind = undefined) {
  requireObject(command, 'command')
  requireString(command.commandId, 'command.commandId')
  requireString(command.correlationId, 'command.correlationId')
  requireString(command.idempotencyKey, 'command.idempotencyKey')
  requireString(command.kind, 'command.kind')
  if (expectedKind && command.kind !== expectedKind) {
    throw new StorageValidationError(`Expected command kind ${expectedKind}.`, {
      actualKind: command.kind,
    })
  }
  requireObject(command.actor, 'command.actor')
  requireString(command.actor.applicationId, 'command.actor.applicationId')
  requireObject(command.target, 'command.target')
  if (command.target.aggregateType !== 'project') {
    throw new StorageValidationError('Storage lifecycle command target must be a project.')
  }
  requireString(command.target.projectId, 'command.target.projectId')
  requireInteger(command.expectedRevision, 'command.expectedRevision')
  requireString(command.occurredAt, 'command.occurredAt')
  requireObject(command.provenance, 'command.provenance')
  requireObject(command.payload, 'command.payload')
  canonicalJson(command)
  return command
}

function validateLocation(location, expectedId = undefined) {
  requireObject(location, 'trusted.location')
  requireString(location.locationId, 'trusted.location.locationId')
  if (expectedId && location.locationId !== expectedId) {
    throw new StorageValidationError('Resolved location does not match the command locationRef.', {
      expectedId,
      actualId: location.locationId,
    })
  }
  requireString(location.displayPath, 'trusted.location.displayPath')
  requireString(location.normalizedPath, 'trusted.location.normalizedPath')
  if (
    !isAbsolute(location.displayPath)
    || !isAbsolute(location.normalizedPath)
    || isNetworkPath(location.displayPath)
    || isNetworkPath(location.normalizedPath)
  ) {
    throw new StorageValidationError('Resolved workspace paths must be absolute local paths.')
  }
  if (location.kind !== undefined && !['primary', 'mirror', 'archive'].includes(location.kind)) {
    throw new StorageValidationError('Resolved workspace kind is not supported.')
  }
  return location
}

function commandIdentity(command) {
  return {
    commandId: command.commandId,
    requestHash: requestSha256(command),
    idempotencyKey: command.idempotencyKey,
    idempotencyScope: canonicalJson([
      command.actor.applicationId,
      command.target.projectId,
    ]),
  }
}

function eventTypeForRegister(kind) {
  return kind === 'project.registerLegacy'
    ? 'project.legacy.registered'
    : 'project.managed.registered'
}

function outcomeForRegister(kind) {
  return kind === 'project.registerLegacy' ? 'legacy_registered' : 'managed_registered'
}

function insertReceipt(database, command, identity, status, recordedAt, result, error) {
  database.prepare(`
    INSERT INTO command_receipts(
      command_id, idempotency_scope, idempotency_key, kind, request_sha256,
      actor_ref, status, result_json, error_json, received_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    identity.commandId,
    identity.idempotencyScope,
    identity.idempotencyKey,
    command.kind,
    identity.requestHash,
    canonicalJson(command.actor),
    status,
    result === null ? null : canonicalJson(result),
    error === null ? null : canonicalJson(error),
    recordedAt,
    recordedAt,
  )
}

function findExistingReceipt(database, identity) {
  const byCommand = findReceiptByCommandId(database, identity.commandId)
  if (byCommand) return { row: byCommand, matchedBy: 'commandId' }

  const byKey = database.prepare(`
    SELECT
      command_id AS commandId,
      idempotency_scope AS idempotencyScope,
      idempotency_key AS idempotencyKey,
      kind,
      request_sha256 AS requestSha256,
      actor_ref AS actorRef,
      status,
      result_json AS resultJson,
      error_json AS errorJson,
      received_at AS receivedAt,
      completed_at AS completedAt
    FROM command_receipts
    WHERE idempotency_scope = ? AND idempotency_key = ?
  `).get(identity.idempotencyScope, identity.idempotencyKey)
  return byKey ? { row: byKey, matchedBy: 'idempotencyKey' } : null
}

function findReceiptByCommandId(database, commandId) {
  return database.prepare(`
    SELECT
      command_id AS commandId,
      idempotency_scope AS idempotencyScope,
      idempotency_key AS idempotencyKey,
      kind,
      request_sha256 AS requestSha256,
      actor_ref AS actorRef,
      status,
      result_json AS resultJson,
      error_json AS errorJson,
      received_at AS receivedAt,
      completed_at AS completedAt
    FROM command_receipts
    WHERE command_id = ?
  `).get(commandId)
}

function replayOrThrow(existing, identity) {
  if (!existing) return null
  if (existing.row.requestSha256 !== identity.requestHash) {
    throw new IdempotencyConflictError({
      matchedBy: existing.matchedBy,
      originalCommandId: existing.row.commandId,
      attemptedCommandId: identity.commandId,
      expectedRequestSha256: existing.row.requestSha256,
      actualRequestSha256: identity.requestHash,
    })
  }
  const receipt = mapReceipt(existing.row)
  if (receipt.status === 'accepted') {
    return Object.freeze({ ...receipt.result, status: 'replayed' })
  }
  return Object.freeze(receipt.result)
}

function nextSequence(database) {
  const row = database.prepare(`
    UPDATE event_sequence
    SET last_value = last_value + 1
    WHERE singleton = 1
    RETURNING last_value AS value
  `).get()
  return Number(row.value)
}

function buildNormalizedEvent({ command, eventId, eventType, sequence, beforeRevision, afterRevision, recordedAt, data }) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    schemaVersion: EVENT_SCHEMA_VERSION,
    eventId,
    eventType,
    occurredAt: command.occurredAt,
    recordedAt,
    sequence,
    actor: command.actor,
    target: command.target,
    beforeRevision,
    afterRevision,
    causation: {
      commandId: command.commandId,
      commandKind: command.kind,
      idempotencyKey: command.idempotencyKey,
      correlationId: command.correlationId,
    },
    provenance: command.provenance,
    data,
  }
}

function insertEvent(database, event, command, aggregateType = 'project', aggregateId = command.target.projectId) {
  database.prepare(`
    INSERT INTO domain_events(
      event_id, global_sequence, project_id, aggregate_type, aggregate_id,
      before_revision, aggregate_revision, event_type, schema_version, payload_json,
      actor_ref, provenance_json, command_id, correlation_id, causation_id,
      occurred_at, recorded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    event.eventId,
    event.sequence,
    command.target.projectId,
    aggregateType,
    aggregateId,
    event.beforeRevision,
    event.afterRevision,
    event.eventType,
    event.schemaVersion,
    canonicalJson(event.data),
    canonicalJson(event.actor),
    canonicalJson(event.provenance),
    command.commandId,
    command.correlationId,
    command.commandId,
    event.occurredAt,
    event.recordedAt,
  )
}

function insertOutbox(database, outboxId, event, recordedAt) {
  database.prepare(`
    INSERT INTO outbox_messages(
      outbox_id, event_id, destination, message_key, schema_version, payload_json,
      status, attempt_count, next_attempt_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)
  `).run(
    outboxId,
    event.eventId,
    OUTBOX_DESTINATION,
    event.eventId,
    event.schemaVersion,
    canonicalJson(event),
    recordedAt,
    recordedAt,
    recordedAt,
  )
}

function rejectionResult(command, recordedAt, code, message, currentRevision = undefined) {
  const result = {
    protocolVersion: PROTOCOL_VERSION,
    schemaVersion: RESULT_SCHEMA_VERSION,
    commandId: command.commandId,
    correlationId: command.correlationId,
    kind: command.kind,
    status: 'rejected',
    recordedAt,
    error: { code, message },
  }
  if (currentRevision !== undefined) result.currentRevision = currentRevision
  return result
}

function validateReferenceContext(value) {
  const context = requireObject(value, 'referenceContext')
  const applicationInstanceId = requireBoundedString(
    context.applicationInstanceId,
    'referenceContext.applicationInstanceId',
    200,
  )
  if (context.scope !== INTAKE_SCOPE) {
    throw new StorageValidationError(`Reference scope must be ${INTAKE_SCOPE}.`, {
      reason: 'scope_not_supported',
    })
  }
  return { applicationInstanceId, scope: context.scope }
}

function referenceResolutionError(reason) {
  return new StorageValidationError('The intake reference cannot be resolved in this context.', { reason })
}

function validateResolvedReference(row, context, observedAt) {
  if (!row) throw referenceResolutionError('reference_not_found')
  if (row.applicationInstanceId !== context.applicationInstanceId) {
    throw referenceResolutionError('application_instance_mismatch')
  }
  if (row.scope !== context.scope) throw referenceResolutionError('scope_mismatch')
  if (row.revokedAt !== null) throw referenceResolutionError('reference_revoked')
  if (Date.parse(observedAt) >= Date.parse(row.expiresAt)) {
    throw referenceResolutionError('reference_expired')
  }
  if (!Boolean(row.sourceEnabled)) throw referenceResolutionError('source_root_disabled')
  return row
}

function selectLocationRef(database, locationRef) {
  return database.prepare(`
    SELECT
      r.location_ref AS locationRef, r.candidate_id AS candidateId,
      r.source_root_id AS sourceRootId,
      r.application_instance_id AS applicationInstanceId, r.scope,
      r.display_path AS displayPath, r.normalized_path AS normalizedPath,
      r.issued_at AS issuedAt, r.expires_at AS expiresAt, r.revoked_at AS revokedAt,
      c.root_normalized_path AS candidateNormalizedPath, c.status AS candidateStatus,
      s.display_path AS sourceDisplayPath, s.normalized_path AS sourceNormalizedPath,
      s.is_enabled AS sourceEnabled
    FROM intake_location_refs r
    JOIN import_candidates c ON c.candidate_id = r.candidate_id
    JOIN project_source_roots s ON s.source_root_id = r.source_root_id
    WHERE r.location_ref = ?
  `).get(locationRef)
}

function selectSourceRootRef(database, sourceRootRef) {
  return database.prepare(`
    SELECT
      r.source_root_ref AS sourceRootRef, r.candidate_id AS candidateId,
      r.source_root_id AS sourceRootId,
      r.application_instance_id AS applicationInstanceId, r.scope,
      r.issued_at AS issuedAt, r.expires_at AS expiresAt, r.revoked_at AS revokedAt,
      s.display_path AS sourceDisplayPath, s.normalized_path AS sourceNormalizedPath,
      s.is_enabled AS sourceEnabled
    FROM intake_source_root_refs r
    JOIN project_source_roots s ON s.source_root_id = r.source_root_id
    WHERE r.source_root_ref = ?
  `).get(sourceRootRef)
}

function executeWrite(database, callback) {
  database.exec('BEGIN IMMEDIATE')
  try {
    const result = callback()
    database.exec('COMMIT')
    return result
  } catch (error) {
    try {
      database.exec('ROLLBACK')
    } catch {}
    throw error
  }
}

const FILE_SYNC_STATES = new Set([
  'planned', 'staging', 'staged', 'files_committed',
  'accepted', 'rolled_back', 'recovery_required',
])
const FILE_SYNC_TERMINAL_STATES = new Set(['accepted', 'rolled_back', 'recovery_required'])
const FILE_SYNC_TRANSITIONS = Object.freeze({
  planned: new Set(['staging', 'rolled_back', 'recovery_required']),
  staging: new Set(['staged', 'rolled_back', 'recovery_required']),
  staged: new Set(['files_committed', 'rolled_back', 'recovery_required']),
  files_committed: new Set(['accepted', 'rolled_back', 'recovery_required']),
  recovery_required: new Set(['rolled_back']),
  // A retry of the same commandId re-enters staging after a clean rollback
  // (PROJECT_TEMPLATE_SPEC.md W1/W2); the planId is never reused by another command.
  rolled_back: new Set(['staging']),
})

function validateFileSyncPlanInput(input) {
  requireObject(input, 'input')
  const planId = requireString(input.planId, 'input.planId')
  const commandId = requireString(input.commandId, 'input.commandId')
  const projectId = requireString(input.projectId, 'input.projectId')
  if (!BUSINESS_IDS.pln.test(planId)) {
    throw new StorageValidationError('input.planId must be a pln_ UUIDv7.')
  }
  if (!BUSINESS_IDS.cmd.test(commandId)) {
    throw new StorageValidationError('input.commandId must be a cmd_ UUIDv7.')
  }
  if (!BUSINESS_IDS.prj.test(projectId)) {
    throw new StorageValidationError('input.projectId must be a prj_ UUIDv7.')
  }
  const kind = requireString(input.kind, 'input.kind')
  if (!['create_from_template', 'upgrade_managed'].includes(kind)) {
    throw new StorageValidationError('input.kind must be create_from_template or upgrade_managed.')
  }
  const syncPolicy = requireString(input.syncPolicy, 'input.syncPolicy')
  if (!['atomic_create', 'atomic_additive'].includes(syncPolicy)) {
    throw new StorageValidationError('input.syncPolicy must be atomic_create or atomic_additive.')
  }
  const planHash = requireString(input.planHash, 'input.planHash')
  const manifestHash = requireString(input.manifestHash, 'input.manifestHash')
  if (!CONTENT_HASH.test(planHash) || !CONTENT_HASH.test(manifestHash)) {
    throw new StorageValidationError('File sync plan hashes must use the sha256: line format.')
  }
  const targetDisplayPath = validateWorkspacePath(input.targetDisplayPath, 'input.targetDisplayPath')
  const targetNormalizedPath = validateWorkspacePath(
    input.targetNormalizedPath ?? targetDisplayPath,
    'input.targetNormalizedPath',
  )
  const stagingDisplayPath = validateWorkspacePath(input.stagingDisplayPath, 'input.stagingDisplayPath')
  if (input.rootPreexistedEmpty !== undefined && typeof input.rootPreexistedEmpty !== 'boolean') {
    throw new StorageValidationError('input.rootPreexistedEmpty must be a boolean.')
  }
  if (!Array.isArray(input.operations) || input.operations.length < 1 || input.operations.length > 500) {
    throw new StorageValidationError('input.operations must be an array of 1..500 operations.')
  }
  let renderParams = null
  if (input.renderParams !== undefined) {
    requireObject(input.renderParams, 'input.renderParams')
    boundedJson(input.renderParams, 'input.renderParams', 4096, true)
    renderParams = input.renderParams
  }
  const operations = input.operations.map((raw, index) => {
    requireObject(raw, `input.operations[${index}]`)
    const kind = requireString(raw.kind, `input.operations[${index}].kind`)
    if (!['create_directory', 'create_file'].includes(kind)) {
      throw new StorageValidationError(`input.operations[${index}].kind is unsupported.`)
    }
    const relativePath = requireString(raw.relativePath, `input.operations[${index}].relativePath`)
    if (!RELATIVE_PATH.test(relativePath)) {
      throw new StorageValidationError(`input.operations[${index}].relativePath is invalid.`)
    }
    if (raw.expectedState !== 'absent') {
      throw new StorageValidationError('File sync operations may only create absent paths.')
    }
    const contentHash = raw.contentHash === undefined || raw.contentHash === null
      ? null
      : requireString(raw.contentHash, `input.operations[${index}].contentHash`)
    if (kind === 'create_file' && (contentHash === null || !CONTENT_HASH.test(contentHash))) {
      throw new StorageValidationError('create_file operations require a sha256: contentHash.')
    }
    if (kind === 'create_directory' && contentHash !== null) {
      throw new StorageValidationError('create_directory operations cannot carry a contentHash.')
    }
    return Object.freeze({ kind, relativePath, expectedState: 'absent', contentHash })
  })
  return Object.freeze({
    planId,
    commandId,
    kind,
    projectId,
    syncPolicy,
    targetDisplayPath,
    targetNormalizedPath,
    stagingDisplayPath,
    planHash,
    manifestHash,
    operations,
    rootPreexistedEmpty: input.rootPreexistedEmpty === true,
    renderParams,
  })
}

function rowToFileSyncPlan(row) {
  return Object.freeze({
    planId: row.plan_id,
    commandId: row.command_id,
    kind: row.kind,
    projectId: row.project_id,
    syncPolicy: row.sync_policy,
    targetDisplayPath: row.target_display_path,
    targetNormalizedPath: row.target_normalized_path,
    stagingDisplayPath: row.staging_display_path,
    planHash: row.plan_hash,
    manifestHash: row.manifest_hash,
    state: row.state,
    operations: JSON.parse(row.operations_json),
    createdPaths: JSON.parse(row.created_paths_json),
    renderParams: row.render_params_json === null ? null : JSON.parse(row.render_params_json),
    rootPreexistedEmpty: row.root_preexisted_empty === 1,
    errorCode: row.error_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  })
}

function computeLegacyFingerprint(database, projectId) {
  const bindings = database.prepare(`
    SELECT role, relative_path AS relativePath, content_hash AS contentHash
    FROM project_document_bindings
    WHERE project_id = ?
    ORDER BY role, relative_path
  `).all(projectId).map((row) => ({
    role: row.role,
    relativePath: row.relativePath,
    contentHash: row.contentHash,
  }))
  return `sha256:${createHash('sha256').update(canonicalJson({
    projectId,
    documentBindings: bindings,
  }), 'utf8').digest('hex')}`
}

function selectPlanRef(database, planRef) {
  return database.prepare(`
    SELECT
      plan_ref AS planRef, ref_kind AS refKind, plan_id AS planId,
      application_instance_id AS applicationInstanceId, scope,
      display_path AS displayPath, normalized_path AS normalizedPath,
      issued_at AS issuedAt, expires_at AS expiresAt, revoked_at AS revokedAt
    FROM file_sync_plan_refs
    WHERE plan_ref = ?
  `).get(planRef)
}

function selectFileSyncPlan(database, planId) {
  const row = database.prepare(`
    SELECT
      plan_id, command_id, kind, project_id, sync_policy,
      target_display_path, target_normalized_path, staging_display_path,
      plan_hash, manifest_hash, state, operations_json, created_paths_json,
      render_params_json, root_preexisted_empty, error_code,
      created_at, updated_at, completed_at
    FROM file_sync_plans
    WHERE plan_id = ?
  `).get(planId)
  return row ? rowToFileSyncPlan(row) : null
}

function validateParseIssues(value, field) {
  if (!Array.isArray(value) || value.length > MAX_INDEX_PARSE_ISSUES) {
    throw new StorageValidationError(
      `${field} must be an array of at most ${MAX_INDEX_PARSE_ISSUES} parse issues.`,
    )
  }
  return value.map((raw, index) => {
    const issue = requireObject(raw, `${field}[${index}]`)
    const severity = issue.severity ?? 'warning'
    if (!PARSE_ISSUE_SEVERITIES.has(severity)) {
      throw new StorageValidationError(`${field}[${index}].severity is not supported.`, { index })
    }
    const line = issue.line === undefined || issue.line === null
      ? null
      : requireInteger(issue.line, `${field}[${index}].line`, 1)
    return {
      code: requireBoundedString(issue.code, `${field}[${index}].code`, 100),
      severity,
      message: requireBoundedString(
        issue.message ?? issue.code,
        `${field}[${index}].message`,
        1000,
      ),
      line,
    }
  })
}

function validateDocumentIndexInput(input) {
  requireObject(input, 'input')
  const projectId = requireString(input.projectId, 'input.projectId')
  if (!BUSINESS_IDS.prj.test(projectId)) {
    throw new StorageValidationError('input.projectId must be a prj_ UUIDv7.')
  }
  if (!Array.isArray(input.documentStates) || input.documentStates.length > MAX_INDEX_DOCUMENTS) {
    throw new StorageValidationError(
      `input.documentStates must be an array of at most ${MAX_INDEX_DOCUMENTS} items.`,
    )
  }
  const seenStates = new Set()
  const documentStates = input.documentStates.map((raw, index) => {
    const field = `input.documentStates[${index}]`
    const item = requireObject(raw, field)
    const role = requireString(item.role, `${field}.role`)
    const relativePath = requireString(item.relativePath, `${field}.relativePath`)
    if (!DOCUMENT_ROLES.has(role) || !RELATIVE_PATH.test(relativePath)) {
      throw new StorageValidationError('Document index state contains an invalid role or relative path.', { index })
    }
    const identity = `${role}\u0000${relativePath}`
    if (seenStates.has(identity)) {
      throw new StorageValidationError('Document index states contain a duplicate role/path pair.', { index })
    }
    seenStates.add(identity)
    const bindingSource = requireString(item.bindingSource, `${field}.bindingSource`)
    if (!['user_confirmed', 'manifest'].includes(bindingSource)) {
      throw new StorageValidationError(`${field}.bindingSource is not supported.`, { index })
    }
    const state = requireString(item.state, `${field}.state`)
    if (!DOCUMENT_INDEX_STATES.has(state)) {
      throw new StorageValidationError(`${field}.state is not supported.`, { index })
    }
    const contentHash = item.contentHash === undefined || item.contentHash === null
      ? null
      : requireString(item.contentHash, `${field}.contentHash`)
    if (contentHash !== null && !CONTENT_HASH.test(contentHash)) {
      throw new StorageValidationError(`${field}.contentHash is invalid.`, { index })
    }
    const byteSize = item.byteSize === undefined || item.byteSize === null
      ? null
      : requireInteger(item.byteSize, `${field}.byteSize`, 0)
    if (byteSize !== null && byteSize > MAX_DOCUMENT_BYTES) {
      throw new StorageValidationError(`${field}.byteSize exceeds the document byte limit.`, { index })
    }
    const readable = state === 'ok' || state === 'changed'
    if (readable && contentHash === null) {
      throw new StorageValidationError('Readable document index states require a content hash.', { index })
    }
    if (!readable && (contentHash !== null || byteSize !== null)) {
      throw new StorageValidationError('Missing/unreadable document index states cannot carry file facts.', { index })
    }
    return {
      role,
      relativePath,
      bindingSource,
      state,
      contentHash,
      byteSize,
      parseIssues: validateParseIssues(item.parseIssues ?? [], `${field}.parseIssues`),
    }
  })
  if (!Array.isArray(input.rebindProposals) || input.rebindProposals.length > MAX_REBIND_PROPOSALS) {
    throw new StorageValidationError(
      `input.rebindProposals must be an array of at most ${MAX_REBIND_PROPOSALS} items.`,
    )
  }
  const seenProposals = new Set()
  const rebindProposals = input.rebindProposals.map((raw, index) => {
    const field = `input.rebindProposals[${index}]`
    const item = requireObject(raw, field)
    const role = requireString(item.role, `${field}.role`)
    const missingRelativePath = requireString(item.missingRelativePath, `${field}.missingRelativePath`)
    if (!DOCUMENT_ROLES.has(role) || !RELATIVE_PATH.test(missingRelativePath)) {
      throw new StorageValidationError('Rebind proposal contains an invalid role or relative path.', { index })
    }
    const identity = `${role}\u0000${missingRelativePath}`
    if (seenProposals.has(identity)) {
      throw new StorageValidationError('Rebind proposals contain a duplicate role/path pair.', { index })
    }
    seenProposals.add(identity)
    const contentHash = requireString(item.contentHash, `${field}.contentHash`)
    if (!CONTENT_HASH.test(contentHash)) {
      throw new StorageValidationError(`${field}.contentHash is invalid.`, { index })
    }
    if (!Array.isArray(item.candidateRelativePaths)
      || item.candidateRelativePaths.length < 1
      || item.candidateRelativePaths.length > MAX_REBIND_CANDIDATES) {
      throw new StorageValidationError(
        `${field}.candidateRelativePaths must be an array of 1..${MAX_REBIND_CANDIDATES} paths.`,
        { index },
      )
    }
    const candidateRelativePaths = [...new Set(item.candidateRelativePaths.map((candidate, candidateIndex) => {
      const candidatePath = requireString(
        candidate,
        `${field}.candidateRelativePaths[${candidateIndex}]`,
      )
      if (!RELATIVE_PATH.test(candidatePath)) {
        throw new StorageValidationError(`${field}.candidateRelativePaths[${candidateIndex}] is invalid.`, { index })
      }
      return candidatePath
    }))]
    if (candidateRelativePaths.includes(missingRelativePath)) {
      throw new StorageValidationError('A rebind candidate cannot equal its own missing binding path.', { index })
    }
    return { role, missingRelativePath, contentHash, candidateRelativePaths }
  })
  return Object.freeze({ projectId, documentStates, rebindProposals })
}

function selectDocumentStateRows(database, projectId) {
  return database.prepare(`
    SELECT
      project_id AS projectId, role, relative_path AS relativePath,
      binding_source AS bindingSource, state, content_hash AS contentHash,
      byte_size AS byteSize, parse_issues_json AS parseIssuesJson,
      revision, first_seen_at AS firstSeenAt, last_verified_at AS lastVerifiedAt,
      updated_at AS updatedAt
    FROM project_document_states
    WHERE project_id = ?
    ORDER BY role, relative_path
  `).all(projectId)
}

function rowToDocumentState(row) {
  return Object.freeze({
    role: row.role,
    relativePath: row.relativePath,
    bindingSource: row.bindingSource,
    state: row.state,
    contentHash: row.contentHash,
    byteSize: row.byteSize === null ? null : Number(row.byteSize),
    parseIssues: parseJson(row.parseIssuesJson),
    revision: Number(row.revision),
    firstSeenAt: row.firstSeenAt,
    lastVerifiedAt: row.lastVerifiedAt,
  })
}

function selectRebindProposalRows(database, projectId) {
  return database.prepare(`
    SELECT
      proposal_id AS proposalId, project_id AS projectId, role,
      missing_relative_path AS missingRelativePath, content_hash AS contentHash,
      candidate_relative_paths_json AS candidateRelativePathsJson,
      candidate_count AS candidateCount, unambiguous,
      status, resolved_relative_path AS resolvedRelativePath,
      revision, created_at AS createdAt, updated_at AS updatedAt,
      resolved_at AS resolvedAt
    FROM project_document_rebind_proposals
    WHERE project_id = ?
    ORDER BY created_at, proposal_id
  `).all(projectId)
}

function rowToRebindProposal(row) {
  return {
    proposalId: row.proposalId,
    role: row.role,
    missingRelativePath: row.missingRelativePath,
    contentHash: row.contentHash,
    candidateRelativePaths: parseJson(row.candidateRelativePathsJson),
    candidateCount: Number(row.candidateCount),
    unambiguous: Number(row.unambiguous) === 1,
    status: row.status,
    resolvedRelativePath: row.resolvedRelativePath,
    revision: Number(row.revision),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    resolvedAt: row.resolvedAt,
  }
}

function selectWorkItem(database, workItemId) {
  const row = database.prepare(`
    SELECT
      work_item_id AS workItemId, project_id AS projectId, title, instruction,
      acceptance_json AS acceptanceJson, execution_status AS executionStatus,
      review_status AS reviewStatus, priority, revision,
      created_at AS createdAt, updated_at AS updatedAt, archived_at AS archivedAt
    FROM work_items WHERE work_item_id = ?
  `).get(workItemId)
  if (!row) return null
  return Object.freeze({
    workItemId: row.workItemId,
    projectId: row.projectId,
    title: row.title,
    instruction: row.instruction,
    acceptance: parseJson(row.acceptanceJson),
    executionStatus: row.executionStatus,
    reviewStatus: row.reviewStatus,
    priority: Number(row.priority),
    revision: Number(row.revision),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt,
  })
}

function selectRun(database, runId) {
  const row = database.prepare(`
    SELECT
      run_id AS runId, project_id AS projectId, work_item_id AS workItemId,
      attempt_no AS attemptNo, status,
      instruction_snapshot_json AS instructionSnapshotJson,
      acceptance_snapshot_json AS acceptanceSnapshotJson,
      revision, created_at AS createdAt, started_at AS startedAt,
      completed_at AS completedAt, updated_at AS updatedAt
    FROM runs WHERE run_id = ?
  `).get(runId)
  if (!row) return null
  return Object.freeze({
    runId: row.runId,
    projectId: row.projectId,
    workItemId: row.workItemId,
    attemptNo: Number(row.attemptNo),
    status: row.status,
    instructionSnapshot: parseJson(row.instructionSnapshotJson),
    acceptanceSnapshot: parseJson(row.acceptanceSnapshotJson),
    revision: Number(row.revision),
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    updatedAt: row.updatedAt,
  })
}

function selectQuarantineItem(database, quarantineId) {
  const row = database.prepare(`
    SELECT
      quarantine_id AS quarantineId, project_id AS projectId,
      source_kind AS sourceKind, source_ref AS sourceRef,
      reason_code AS reasonCode, payload_ref AS payloadRef,
      status, details_json AS detailsJson, revision,
      created_at AS createdAt, updated_at AS updatedAt, resolved_at AS resolvedAt
    FROM quarantine_items WHERE quarantine_id = ?
  `).get(quarantineId)
  if (!row) return null
  return Object.freeze({
    quarantineId: row.quarantineId,
    projectId: row.projectId,
    sourceKind: row.sourceKind,
    sourceRef: row.sourceRef,
    reasonCode: row.reasonCode,
    payloadRef: row.payloadRef,
    status: row.status,
    details: parseJson(row.detailsJson),
    revision: Number(row.revision),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    resolvedAt: row.resolvedAt,
  })
}

const REVIEW_COLUMNS = `
  review_id AS reviewId, project_id AS projectId, work_item_id AS workItemId,
  reviewed_work_item_revision AS reviewedWorkItemRevision,
  artifact_refs_json AS artifactRefsJson, status, risk,
  requested_by_json AS requestedByJson, decided_by_json AS decidedByJson,
  revision, created_at AS createdAt, updated_at AS updatedAt, decided_at AS decidedAt
`

function mapReviewRow(row) {
  return {
    reviewId: row.reviewId,
    projectId: row.projectId,
    workItemId: row.workItemId,
    reviewedWorkItemRevision: row.reviewedWorkItemRevision === null ? null : Number(row.reviewedWorkItemRevision),
    artifactRefs: parseJson(row.artifactRefsJson),
    status: row.status,
    risk: row.risk,
    requestedBy: parseJson(row.requestedByJson),
    decidedBy: row.decidedByJson === null ? null : parseJson(row.decidedByJson),
    revision: Number(row.revision),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    decidedAt: row.decidedAt,
  }
}

function selectReview(database, reviewId) {
  const row = database.prepare(`SELECT ${REVIEW_COLUMNS} FROM reviews WHERE review_id = ?`).get(reviewId)
  return row ? Object.freeze(mapReviewRow(row)) : null
}

function mapReviewActionRow(row) {
  return {
    reviewActionId: row.reviewActionId,
    reviewId: row.reviewId,
    action: row.action,
    actor: parseJson(row.actorRef),
    comment: row.comment,
    createdAt: row.createdAt,
  }
}

const PROGRESS_UPDATE_COLUMNS = `
  progress_update_id AS progressUpdateId, project_id AS projectId,
  work_item_id AS workItemId, run_id AS runId, kind, summary,
  needs_json AS needsJson, acceptance_claims_json AS acceptanceClaimsJson,
  evidence_json AS evidenceJson, completion_percent AS completionPercent,
  details, thread_id AS threadId, source_event_id AS sourceEventId,
  command_id AS commandId, aggregate_type AS aggregateType,
  aggregate_id AS aggregateId, aggregate_revision AS aggregateRevision,
  generated_by_json AS generatedByJson, created_at AS createdAt
`

function mapProgressUpdateRow(row) {
  return {
    progressUpdateId: row.progressUpdateId,
    projectId: row.projectId,
    workItemId: row.workItemId,
    runId: row.runId,
    kind: row.kind,
    summary: row.summary,
    needs: parseJson(row.needsJson),
    acceptanceClaims: parseJson(row.acceptanceClaimsJson),
    evidence: parseJson(row.evidenceJson),
    completionPercent: row.completionPercent === null ? null : Number(row.completionPercent),
    details: row.details,
    threadId: row.threadId,
    sourceEventId: row.sourceEventId,
    commandId: row.commandId,
    aggregateType: row.aggregateType,
    aggregateId: row.aggregateId,
    aggregateRevision: Number(row.aggregateRevision),
    generatedBy: parseJson(row.generatedByJson),
    createdAt: row.createdAt,
  }
}

export async function openProjectControlStorage(options) {
  requireObject(options, 'options')
  const databasePath = validateStoragePath(options.databasePath, 'options.databasePath')
  const lockPath = validateStoragePath(`${databasePath}.writer-lock.sqlite3`, 'derivedLockPath')
  if (options.lockPath !== undefined) {
    const requestedLockPath = validateStoragePath(options.lockPath, 'options.lockPath')
    if (!sameFilesystemPath(lockPath, requestedLockPath)) {
      throw new InvalidStoragePathError(
        'options.lockPath cannot override the database-derived single-writer lock.',
        { expectedLockPath: lockPath, requestedLockPath },
      )
    }
  }
  const backupDirectory = validateStoragePath(
    options.backupDirectory ?? join(dirname(databasePath), 'backups'),
    'options.backupDirectory',
  )
  const migrationsDirectory = validateStoragePath(
    options.migrationsDirectory ?? defaultMigrationsDirectory(),
    'options.migrationsDirectory',
  )
  const applicationVersion = requireString(options.applicationVersion, 'options.applicationVersion')
  const instanceId = requireString(options.instanceId, 'options.instanceId')
  const now = options.now ?? defaultNow
  if (typeof now !== 'function') {
    throw new StorageValidationError('options.now must be a function.')
  }
  const idFactory = options.idFactory ?? ((prefix) => createPrefixedUuidV7(prefix))
  if (typeof idFactory !== 'function') {
    throw new StorageValidationError('options.idFactory must be a function.')
  }

  const databaseExisted = existsSync(databasePath)
  mkdirSync(dirname(databasePath), { recursive: true })
  const openedAt = now()
  const writerLock = acquireWriterLock({ lockPath, instanceId, acquiredAt: openedAt })
  let database
  try {
    database = new DatabaseSync(databasePath, { timeout: 2_000 })
    database.function('project_path_key', { deterministic: true }, projectPathKey)
    database.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA busy_timeout = 2000;
    `)
    const migration = await migrateDatabase({
      database,
      databasePath,
      databaseExisted,
      backupDirectory,
      migrationsDirectory,
      applicationVersion,
      now,
    })
    return createStorage({
      database,
      databasePath,
      lockPath,
      writerLock,
      migration,
      instanceId,
      openedAt,
      now,
      idFactory,
    })
  } catch (error) {
    if (database) {
      try {
        database.close()
      } catch {}
    }
    writerLock.release()
    throw error
  }
}

function validateTextList(value, field, required = false) {
  if (value === undefined) {
    if (required) throw new StorageValidationError(`${field} is required.`)
    return []
  }
  if (!Array.isArray(value) || value.length < 1 || value.length > 50) {
    throw new StorageValidationError(`${field} must be an array of 1..50 strings.`)
  }
  return value.map((item, index) => requireBoundedString(item, `${field}[${index}]`, 1000))
}

function validateEvidenceList(value, field, required = false) {
  if (value === undefined) {
    if (required) throw new StorageValidationError(`${field} is required.`)
    return []
  }
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    throw new StorageValidationError(`${field} must be an array of 1..100 evidence references.`)
  }
  return value.map((raw, index) => {
    const evidence = requireObject(raw, `${field}[${index}]`)
    const kind = requireString(evidence.kind, `${field}[${index}].kind`)
    const contentHash = evidence.contentHash === undefined ? null : requireString(evidence.contentHash, `${field}[${index}].contentHash`)
    if (contentHash !== null && !CONTENT_HASH.test(contentHash)) {
      throw new StorageValidationError(`${field}[${index}].contentHash is invalid.`, { index })
    }
    const title = evidence.title === undefined ? null : requireBoundedString(evidence.title, `${field}[${index}].title`, 200)
    if (kind === 'workspace_file') {
      const relativePath = requireString(evidence.relativePath, `${field}[${index}].relativePath`)
      if (!RELATIVE_PATH.test(relativePath)) {
        throw new StorageValidationError(`${field}[${index}].relativePath is invalid.`, { index })
      }
      return {
        kind,
        workspaceRef: requireBoundedString(evidence.workspaceRef, `${field}[${index}].workspaceRef`, 127),
        relativePath,
        ...(contentHash === null ? {} : { contentHash }),
        ...(title === null ? {} : { title }),
      }
    }
    if (!['artifact', 'event', 'test'].includes(kind)) {
      throw new StorageValidationError(`${field}[${index}].kind is not supported.`, { index })
    }
    const ref = requireBoundedString(evidence.ref, `${field}[${index}].ref`, 255)
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/.test(ref)) {
      throw new StorageValidationError(`${field}[${index}].ref is invalid.`, { index })
    }
    return {
      kind,
      ref,
      ...(contentHash === null ? {} : { contentHash }),
      ...(title === null ? {} : { title }),
    }
  })
}

function validateExternalUpdateCommand(command) {
  requireObject(command, 'command')
  requireString(command.commandId, 'command.commandId')
  requireString(command.correlationId, 'command.correlationId')
  requireString(command.idempotencyKey, 'command.idempotencyKey')
  const kind = requireString(command.kind, 'command.kind')
  if (!EXTERNAL_UPDATE_KINDS.has(kind)) {
    throw new StorageValidationError('command.kind must be an external runtime update kind.')
  }
  requireTimestamp(command.occurredAt, 'command.occurredAt')
  const actor = requireObject(command.actor, 'command.actor')
  requireString(actor.applicationId, 'command.actor.applicationId')
  const target = requireObject(command.target, 'command.target')
  const projectId = requireString(target.projectId, 'command.target.projectId')
  const workItemId = requireString(target.workItemId, 'command.target.workItemId')
  const runId = requireString(target.runId, 'command.target.runId')
  const threadId = requireString(target.threadId, 'command.target.threadId')
  const aggregateType = requireString(target.aggregateType, 'command.target.aggregateType')
  const aggregateId = requireString(target.aggregateId, 'command.target.aggregateId')
  if (!BUSINESS_IDS.cmd.test(command.commandId) || !BUSINESS_IDS.prj.test(projectId)
    || !BUSINESS_IDS.wrk.test(workItemId) || !BUSINESS_IDS.run.test(runId)) {
    throw new StorageValidationError('External update ids must use their prefixed UUIDv7 shapes.')
  }
  if (!THREAD_ID_PATTERN.test(threadId)) {
    throw new StorageValidationError('command.target.threadId is invalid.')
  }
  if (aggregateType === 'work_item' && aggregateId !== workItemId) {
    throw new StorageValidationError('work_item aggregateId must equal target.workItemId.')
  }
  if (aggregateType === 'run' && aggregateId !== runId) {
    throw new StorageValidationError('run aggregateId must equal target.runId.')
  }
  if (!['work_item', 'run'].includes(aggregateType)) {
    throw new StorageValidationError('command.target.aggregateType is not supported.')
  }
  const expectedRevision = requireInteger(command.expectedRevision, 'command.expectedRevision', 1)
  const provenance = requireObject(command.provenance, 'command.provenance')
  const sourceType = requireString(provenance.sourceType, 'command.provenance.sourceType')
  if (!['human', 'agent', 'harness', 'imported_document', 'system'].includes(sourceType)) {
    throw new StorageValidationError('command.provenance.sourceType is not supported.')
  }
  requireBoundedString(provenance.sourceId, 'command.provenance.sourceId', 255)
  const applicationVersion = requireBoundedString(provenance.applicationVersion, 'command.provenance.applicationVersion', 64)
  const applicationInstanceId = requireString(provenance.applicationInstanceId, 'command.provenance.applicationInstanceId')
  if (!INSTANCE_ID_PATTERN.test(applicationInstanceId)) {
    throw new StorageValidationError('command.provenance.applicationInstanceId is invalid.')
  }
  requireTimestamp(provenance.observedAt, 'command.provenance.observedAt')
  if ((provenance.adapterId === undefined) !== (provenance.adapterVersion === undefined)) {
    throw new StorageValidationError('adapterId and adapterVersion must appear together.')
  }
  if (provenance.contentHash !== undefined && !CONTENT_HASH.test(requireString(provenance.contentHash, 'command.provenance.contentHash'))) {
    throw new StorageValidationError('command.provenance.contentHash is invalid.')
  }
  const payload = requireObject(command.payload, 'command.payload')
  const summary = requireBoundedString(payload.summary, 'command.payload.summary', 1000)
  let normalizedPayload
  if (kind === 'progress.report') {
    normalizedPayload = {
      summary,
      ...(payload.details === undefined ? {} : { details: requireBoundedString(payload.details, 'command.payload.details', 20000) }),
      ...(payload.completionPercent === undefined ? {} : { completionPercent: requireInteger(payload.completionPercent, 'command.payload.completionPercent', 0) }),
      ...(payload.nextSteps === undefined ? {} : { nextSteps: validateTextList(payload.nextSteps, 'command.payload.nextSteps') }),
      ...(payload.evidence === undefined ? {} : { evidence: validateEvidenceList(payload.evidence, 'command.payload.evidence') }),
    }
    if (payload.completionPercent !== undefined && payload.completionPercent > 100) {
      throw new StorageValidationError('command.payload.completionPercent cannot exceed 100.')
    }
  } else if (kind === 'blocker.raise') {
    normalizedPayload = {
      summary,
      impact: requireBoundedString(payload.impact, 'command.payload.impact', 4000),
      needs: validateTextList(payload.needs, 'command.payload.needs', true),
      ...(payload.evidence === undefined ? {} : { evidence: validateEvidenceList(payload.evidence, 'command.payload.evidence') }),
    }
  } else {
    normalizedPayload = {
      summary,
      acceptanceClaims: validateTextList(payload.acceptanceClaims, 'command.payload.acceptanceClaims', true),
      evidence: validateEvidenceList(payload.evidence, 'command.payload.evidence', true),
    }
  }
  canonicalJson(command)
  return Object.freeze({
    commandId: command.commandId,
    correlationId: command.correlationId,
    idempotencyKey: command.idempotencyKey,
    kind,
    occurredAt: command.occurredAt,
    actor,
    target: Object.freeze({ projectId, workItemId, runId, threadId, aggregateType, aggregateId }),
    expectedRevision,
    provenance,
    payload: Object.freeze(normalizedPayload),
    extensions: command.extensions ?? null,
  })
}
function createStorage({ database, databasePath, lockPath, writerLock, migration, instanceId, openedAt, now, idFactory }) {
  let closed = false
  let lastCounts = { projectCount: 0, archivedProjectCount: 0 }
  const ensureOpen = () => {
    if (closed) throw new StorageValidationError('Project Control storage is closed.')
  }

  function rejectAndRecord(command, identity, code, message, currentRevision) {
    const recordedAt = now()
    const result = rejectionResult(command, recordedAt, code, message, currentRevision)
    insertReceipt(database, command, identity, 'rejected', recordedAt, result, result.error)
    return Object.freeze(result)
  }

  function rejectExternalUpdate(command, identity, code, message, currentRevision) {
    const recordedAt = now()
    const result = {
      protocolVersion: PROTOCOL_VERSION,
      schemaVersion: EXTERNAL_RESULT_SCHEMA_VERSION,
      commandId: command.commandId,
      correlationId: command.correlationId,
      kind: command.kind,
      status: 'rejected',
      recordedAt,
      ...(currentRevision === undefined ? {} : { currentRevision }),
      error: { code, message },
    }
    insertReceipt(database, command, identity, 'rejected', recordedAt, result, result.error)
    return Object.freeze(result)
  }

  /**
   * Console-driven commands ride the same audit rails as protocol commands:
   * one CommandReceipt, one append-only domain event, no outbox row (they have
   * no renderer or external consumer). Aggregate revisions always equal the
   * affected row revision so the event stream can never collide with
   * external-update events, which use the same convention.
   */
  function recordConsoleEvent({ projectId, aggregateType, aggregateId, beforeRevision, afterRevision, eventType, data, recordedAt }) {
    const commandId = createBusinessId(idFactory, 'cmd', 'consoleCommandId')
    const command = {
      commandId,
      correlationId: commandId,
      idempotencyKey: `console.${eventType}.${commandId}`,
      kind: `console.${eventType}`,
      occurredAt: recordedAt,
      actor: CONSOLE_ACTOR,
      target: { projectId, aggregateType, aggregateId },
      expectedRevision: beforeRevision,
      provenance: { sourceType: 'human', sourceId: 'desktop-console' },
      payload: data,
    }
    const identity = commandIdentity(command)
    insertReceipt(database, command, identity, 'accepted', recordedAt, {
      protocolVersion: PROTOCOL_VERSION,
      schemaVersion: 'console-command-result/v1alpha1',
      commandId,
      correlationId: commandId,
      kind: command.kind,
      status: 'accepted',
      recordedAt,
      aggregateType,
      aggregateId,
      aggregateRevision: afterRevision,
    }, null)
    const event = {
      protocolVersion: PROTOCOL_VERSION,
      schemaVersion: 'console-event/v1alpha1',
      eventId: idFactory('evt'),
      eventType,
      occurredAt: recordedAt,
      recordedAt,
      sequence: nextSequence(database),
      actor: CONSOLE_ACTOR,
      target: command.target,
      beforeRevision,
      afterRevision,
      causation: {
        commandId,
        idempotencyKey: command.idempotencyKey,
        correlationId: commandId,
      },
      provenance: command.provenance,
      data,
    }
    insertEvent(database, event, command, aggregateType, aggregateId)
    return Object.freeze(event)
  }

  const storage = {
    status() {
      if (!closed) {
        const counts = database.prepare(`
          SELECT
            count(*) FILTER (WHERE archived_at IS NULL) AS projectCount,
            count(*) FILTER (WHERE archived_at IS NOT NULL) AS archivedProjectCount
          FROM projects
        `).get()
        lastCounts = {
          projectCount: Number(counts.projectCount),
          archivedProjectCount: Number(counts.archivedProjectCount),
        }
      }
      return Object.freeze({
        state: closed ? 'closed' : 'ready',
        databasePath,
        lockPath,
        instanceId,
        openedAt,
        schemaVersion: migration.currentVersion,
        migrationsAppliedThisOpen: migration.applied.length,
        migrationBackupPath: migration.backupPath,
        journalMode: 'wal',
        foreignKeys: true,
        singleWriter: true,
        ...lastCounts,
      })
    },

    recordImportScan(input) {
      ensureOpen()
      const scan = validateImportScan(input)
      const recordedAt = requireTimestamp(now(), 'now()')
      const startedAt = scan.startedAt ?? recordedAt
      const completedAt = scan.completedAt ?? recordedAt
      if (Date.parse(completedAt) < Date.parse(startedAt)) {
        throw new StorageValidationError('scan.completedAt cannot precede scan.startedAt.')
      }

      const persisted = executeWrite(database, () => {
        let sourceRoot = database.prepare(`
          SELECT source_root_id AS sourceRootId, kind
          FROM project_source_roots WHERE path_key = ?
        `).get(scan.sourcePath.pathKey)
        if (sourceRoot) {
          const kind = sourceRoot.kind === 'source_root' || scan.mode === 'source_root'
            ? 'source_root'
            : 'single_project'
          database.prepare(`
            UPDATE project_source_roots
            SET kind = ?, display_path = ?, scan_preferences_json = ?, is_enabled = ?,
              revision = revision + 1, updated_at = ?
            WHERE source_root_id = ?
          `).run(
            kind,
            scan.sourcePath.displayPath,
            scan.sourcePreferencesJson,
            scan.sourceEnabled ? 1 : 0,
            recordedAt,
            sourceRoot.sourceRootId,
          )
        } else {
          sourceRoot = {
            sourceRootId: createBusinessId(idFactory, 'src', 'sourceRootId'),
            kind: scan.mode,
          }
          database.prepare(`
            INSERT INTO project_source_roots(
              source_root_id, kind, display_path, normalized_path, path_key,
              scan_preferences_json, is_enabled, revision, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
          `).run(
            sourceRoot.sourceRootId,
            scan.mode,
            scan.sourcePath.displayPath,
            scan.sourcePath.normalizedPath,
            scan.sourcePath.pathKey,
            scan.sourcePreferencesJson,
            scan.sourceEnabled ? 1 : 0,
            recordedAt,
            recordedAt,
          )
        }

        const importJobId = createBusinessId(idFactory, 'job', 'importJobId')
        database.prepare(`
          INSERT INTO import_jobs(
            import_job_id, source_root_id, root_path_snapshot,
            root_normalized_path_snapshot, scan_preferences_snapshot_json,
            mode, status, scanner_version, started_at, completed_at, summary_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          importJobId,
          sourceRoot.sourceRootId,
          scan.rootPath.displayPath,
          scan.rootPath.normalizedPath,
          scan.scanPreferencesJson,
          scan.mode,
          scan.status,
          scan.scannerVersion,
          startedAt,
          completedAt,
          scan.summaryJson,
        )
        const insertJobIssue = database.prepare(`
          INSERT INTO import_job_issues(
            import_job_issue_id, import_job_id, code, severity,
            details_json, status, resolved_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        for (const issue of scan.issues) {
          insertJobIssue.run(
            createBusinessId(idFactory, 'jis', 'importJobIssueId'),
            importJobId,
            issue.code,
            issue.severity,
            issue.detailsJson,
            issue.status,
            issue.resolvedAt,
          )
        }

        const candidateIds = []
        for (const candidate of scan.candidates) {
          const candidateId = createBusinessId(idFactory, 'can', 'candidateId')
          candidateIds.push(candidateId)
          let status = candidate.status
          let statusBeforeIgnored = null
          let matchedProjectId = null
          const activeProject = database.prepare(`
            SELECT project_id AS projectId
            FROM workspace_locations
            WHERE path_key = ? AND is_active = 1
            LIMIT 1
          `).get(candidate.root.pathKey)
          if (activeProject) {
            status = 'imported'
            matchedProjectId = activeProject.projectId
          } else {
            const prior = database.prepare(`
              SELECT status, status_before_ignored AS statusBeforeIgnored
              FROM import_candidates
              WHERE root_path_key = ?
              ORDER BY rowid DESC
              LIMIT 1
            `).get(candidate.root.pathKey)
            if (prior?.status === 'ignored') {
              status = 'ignored'
              statusBeforeIgnored = candidate.status
            }
          }
          database.prepare(`
            INSERT INTO import_candidates(
              candidate_id, import_job_id, source_root_id,
              root_display_path, root_normalized_path, root_path_key, detected_mode,
              manifest_project_id, suggested_name, suggested_summary, summary_source,
              confidence_json, status, status_before_ignored, matched_project_id,
              revision, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
          `).run(
            candidateId,
            importJobId,
            sourceRoot.sourceRootId,
            candidate.root.displayPath,
            candidate.root.normalizedPath,
            candidate.root.pathKey,
            candidate.detectedMode,
            candidate.manifestProjectId,
            candidate.suggestedName,
            candidate.suggestedSummary,
            candidate.summarySource,
            candidate.confidenceJson,
            status,
            statusBeforeIgnored,
            matchedProjectId,
            recordedAt,
            recordedAt,
          )
          const insertDocument = database.prepare(`
            INSERT INTO import_candidate_documents(
              candidate_document_id, candidate_id, relative_path, suggested_role,
              sha256, title, preview, observed_at, evidence_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `)
          for (const document of candidate.documents) {
            insertDocument.run(
              createBusinessId(idFactory, 'doc', 'candidateDocumentId'),
              candidateId,
              document.relativePath,
              document.suggestedRole,
              document.sha256,
              document.title,
              document.preview,
              document.observedAt ?? recordedAt,
              document.evidenceJson,
            )
          }
          const insertIssue = database.prepare(`
            INSERT INTO import_issues(
              import_issue_id, candidate_id, code, severity,
              details_json, status, resolved_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
          `)
          for (const issue of candidate.issues) {
            insertIssue.run(
              createBusinessId(idFactory, 'iss', 'importIssueId'),
              candidateId,
              issue.code,
              issue.severity,
              issue.detailsJson,
              issue.status,
              issue.resolvedAt,
            )
          }
        }
        return { sourceRootId: sourceRoot.sourceRootId, importJobId, candidateIds }
      })

      const job = selectImportJob(database, persisted.importJobId)
      return Object.freeze({
        sourceRoot: selectSourceRoot(database, persisted.sourceRootId),
        job,
        issues: job.issues,
        candidates: persisted.candidateIds.map((candidateId) => selectImportCandidate(database, candidateId)),
      })
    },

    getSourceRoot(sourceRootId) {
      ensureOpen()
      requireString(sourceRootId, 'sourceRootId')
      return selectSourceRoot(database, sourceRootId)
    },

    listSourceRoots({ isEnabled = null, limit = 100, afterSourceRootId = '' } = {}) {
      ensureOpen()
      if (isEnabled !== null && typeof isEnabled !== 'boolean') {
        throw new StorageValidationError('isEnabled must be boolean or null.')
      }
      requireInteger(limit, 'limit', 1)
      if (limit > 500) throw new StorageValidationError('limit cannot exceed 500.')
      if (afterSourceRootId !== '') requireString(afterSourceRootId, 'afterSourceRootId')
      return database.prepare(`
        SELECT
          source_root_id AS sourceRootId, kind, display_path AS displayPath,
          normalized_path AS normalizedPath, scan_preferences_json AS scanPreferencesJson,
          is_enabled AS isEnabled, revision, created_at AS createdAt, updated_at AS updatedAt
        FROM project_source_roots
        WHERE source_root_id > ? AND (? IS NULL OR is_enabled = ?)
        ORDER BY source_root_id
        LIMIT ?
      `).all(afterSourceRootId, isEnabled === null ? null : (isEnabled ? 1 : 0), isEnabled ? 1 : 0, limit)
        .map((row) => Object.freeze(mapSourceRoot(row)))
    },

    getImportJob(importJobId) {
      ensureOpen()
      requireString(importJobId, 'importJobId')
      return selectImportJob(database, importJobId)
    },

    listImportJobs({ sourceRootId = null, status = null, limit = 100, afterImportJobId = '' } = {}) {
      ensureOpen()
      if (sourceRootId !== null) requireString(sourceRootId, 'sourceRootId')
      if (status !== null && !['completed', 'failed', 'cancelled'].includes(status)) {
        throw new StorageValidationError('Import job status is not supported.')
      }
      requireInteger(limit, 'limit', 1)
      if (limit > 100) throw new StorageValidationError('Import job detail limit cannot exceed 100.')
      if (afterImportJobId !== '') requireString(afterImportJobId, 'afterImportJobId')
      return database.prepare(`
        SELECT import_job_id AS importJobId
        FROM import_jobs
        WHERE import_job_id > ?
          AND (? IS NULL OR source_root_id = ?)
          AND (? IS NULL OR status = ?)
        ORDER BY import_job_id
        LIMIT ?
      `).all(afterImportJobId, sourceRootId, sourceRootId, status, status, limit)
        .map((row) => selectImportJob(database, row.importJobId))
    },

    getImportCandidate(candidateId) {
      ensureOpen()
      requireString(candidateId, 'candidateId')
      return selectImportCandidate(database, candidateId)
    },

    listImportCandidates({
      sourceRootId = null,
      importJobId = null,
      status = null,
      latestPerPath = false,
      limit = 100,
      afterCandidateId = '',
    } = {}) {
      ensureOpen()
      if (sourceRootId !== null) requireString(sourceRootId, 'sourceRootId')
      if (importJobId !== null) requireString(importJobId, 'importJobId')
      if (status !== null && ![
        'discovered',
        'conflict',
        'relocation_candidate',
        'ignored',
        'imported',
      ].includes(status)) {
        throw new StorageValidationError('Import candidate status is not supported.')
      }
      if (typeof latestPerPath !== 'boolean') {
        throw new StorageValidationError('latestPerPath must be boolean.')
      }
      requireInteger(limit, 'limit', 1)
      if (limit > 100) throw new StorageValidationError('Candidate detail limit cannot exceed 100.')
      if (afterCandidateId !== '') requireString(afterCandidateId, 'afterCandidateId')
      let beforeRowId = null
      if (afterCandidateId !== '') {
        const cursor = database.prepare(`
          SELECT rowid AS rowId FROM import_candidates WHERE candidate_id = ?
        `).get(afterCandidateId)
        if (!cursor) {
          throw new StorageValidationError('Import candidate pagination cursor was not found.', {
            reason: 'candidate_cursor_not_found',
          })
        }
        beforeRowId = Number(cursor.rowId)
      }
      const rows = database.prepare(`
        SELECT c.candidate_id AS candidateId
        FROM import_candidates c
        WHERE (? IS NULL OR c.rowid < ?)
          AND (? IS NULL OR c.source_root_id = ?)
          AND (? IS NULL OR c.import_job_id = ?)
          AND (? IS NULL OR c.status = ?)
          AND (
            ? = 0
            OR NOT EXISTS (
              SELECT 1
              FROM import_candidates newer
              WHERE newer.root_path_key = c.root_path_key
                AND newer.rowid > c.rowid
            )
          )
        ORDER BY c.rowid DESC
        LIMIT ?
      `).all(
        beforeRowId,
        beforeRowId,
        sourceRootId,
        sourceRootId,
        importJobId,
        importJobId,
        status,
        status,
        latestPerPath ? 1 : 0,
        limit,
      )
      return rows.map((row) => selectImportCandidate(database, row.candidateId))
    },

    setImportCandidateIgnored(candidateId, ignored, expectedRevision) {
      ensureOpen()
      if (typeof ignored !== 'boolean') {
        throw new StorageValidationError('ignored must be boolean.')
      }
      return executeWrite(database, () => {
        const current = requireCandidateRevision(database, candidateId, expectedRevision)
        if (current.status === 'imported') {
          throw new StorageValidationError('An imported candidate cannot be ignored.', {
            reason: 'candidate_already_imported',
            candidateId,
          })
        }
        if ((ignored && current.status === 'ignored') || (!ignored && current.status !== 'ignored')) {
          return selectImportCandidate(database, candidateId)
        }
        const updatedAt = requireTimestamp(now(), 'now()')
        if (ignored) {
          database.prepare(`
            UPDATE import_candidates
            SET status_before_ignored = status, status = 'ignored',
              revision = revision + 1, updated_at = ?
            WHERE candidate_id = ? AND revision = ?
          `).run(updatedAt, candidateId, expectedRevision)
        } else {
          database.prepare(`
            UPDATE import_candidates
            SET status = status_before_ignored, status_before_ignored = NULL,
              revision = revision + 1, updated_at = ?
            WHERE candidate_id = ? AND revision = ?
          `).run(updatedAt, candidateId, expectedRevision)
        }
        return selectImportCandidate(database, candidateId)
      })
    },

    setImportCandidateStatus(candidateId, status, expectedRevision) {
      ensureOpen()
      if (!CANDIDATE_STATES.has(status)) {
        throw new StorageValidationError('Candidate status must be a non-terminal discovery status.')
      }
      return executeWrite(database, () => {
        const current = requireCandidateRevision(database, candidateId, expectedRevision)
        if (current.status === 'imported' || current.status === 'ignored') {
          throw new StorageValidationError('Use the dedicated import or ignore transition for this candidate.', {
            reason: 'invalid_candidate_transition',
            candidateId,
          })
        }
        if (current.status === status) return selectImportCandidate(database, candidateId)
        database.prepare(`
          UPDATE import_candidates
          SET status = ?, revision = revision + 1, updated_at = ?
          WHERE candidate_id = ? AND revision = ?
        `).run(status, requireTimestamp(now(), 'now()'), candidateId, expectedRevision)
        return selectImportCandidate(database, candidateId)
      })
    },

    issueImportCandidateRefs(candidateId, options) {
      ensureOpen()
      const context = validateReferenceContext(options)
      const ttlSeconds = options.ttlSeconds ?? 300
      requireInteger(ttlSeconds, 'options.ttlSeconds', 1)
      if (ttlSeconds > 3600) {
        throw new StorageValidationError('Reference ttlSeconds cannot exceed 3600.')
      }
      requireInteger(options.expectedRevision, 'options.expectedRevision', 1)
      const issuedAt = requireTimestamp(now(), 'now()')
      const expiresAt = new Date(Date.parse(issuedAt) + (ttlSeconds * 1000)).toISOString()
      return executeWrite(database, () => {
        const current = requireCandidateRevision(database, candidateId, options.expectedRevision)
        if (!CANDIDATE_STATES.has(current.status)) {
          throw new StorageValidationError('Only an active discovery candidate can receive lifecycle refs.', {
            reason: 'candidate_not_issuable',
            candidateId,
          })
        }
        const candidate = database.prepare(`
          SELECT
            c.source_root_id AS sourceRootId,
            c.root_display_path AS displayPath, c.root_normalized_path AS normalizedPath,
            s.normalized_path AS sourceNormalizedPath, s.is_enabled AS sourceEnabled
          FROM import_candidates c
          JOIN project_source_roots s ON s.source_root_id = c.source_root_id
          WHERE c.candidate_id = ?
        `).get(candidateId)
        if (!Boolean(candidate.sourceEnabled)) {
          throw new StorageValidationError('The source root is disabled.', {
            reason: 'source_root_disabled',
          })
        }
        if (!pathIsWithin(candidate.sourceNormalizedPath, candidate.normalizedPath)) {
          throw new StorageValidationError('The candidate no longer belongs to its source root.', {
            reason: 'candidate_outside_source_root',
          })
        }
        const locationRef = createBusinessId(idFactory, 'loc', 'locationRef')
        const sourceRootRef = createBusinessId(idFactory, 'srt', 'sourceRootRef')
        database.prepare(`
          INSERT INTO intake_location_refs(
            location_ref, candidate_id, source_root_id, application_instance_id,
            scope, display_path, normalized_path, issued_at, expires_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          locationRef,
          candidateId,
          candidate.sourceRootId,
          context.applicationInstanceId,
          context.scope,
          candidate.displayPath,
          candidate.normalizedPath,
          issuedAt,
          expiresAt,
        )
        database.prepare(`
          INSERT INTO intake_source_root_refs(
            source_root_ref, candidate_id, source_root_id, application_instance_id,
            scope, issued_at, expires_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          sourceRootRef,
          candidateId,
          candidate.sourceRootId,
          context.applicationInstanceId,
          context.scope,
          issuedAt,
          expiresAt,
        )
        return Object.freeze({
          candidateRef: candidateId,
          locationRef,
          sourceRootRef,
          scope: context.scope,
          expiresAt,
        })
      })
    },

    resolveLocationRef(locationRef, referenceContext) {
      ensureOpen()
      if (!BUSINESS_IDS.loc.test(requireString(locationRef, 'locationRef'))) {
        throw referenceResolutionError('reference_shape_invalid')
      }
      const context = validateReferenceContext(referenceContext)
      const observedAt = requireTimestamp(now(), 'now()')
      const row = validateResolvedReference(
        selectLocationRef(database, locationRef),
        context,
        observedAt,
      )
      if (!pathIsWithin(row.sourceNormalizedPath, row.normalizedPath)) {
        throw referenceResolutionError('location_outside_source_root')
      }
      if (!sameFilesystemPath(row.normalizedPath, row.candidateNormalizedPath)) {
        throw referenceResolutionError('candidate_location_mismatch')
      }
      return Object.freeze({
        candidateId: row.candidateId,
        sourceRootId: row.sourceRootId,
        locationId: row.locationRef,
        kind: 'primary',
        displayPath: row.displayPath,
        normalizedPath: row.normalizedPath,
        verifiedAt: row.issuedAt,
        expiresAt: row.expiresAt,
      })
    },

    resolveSourceRootRef(sourceRootRef, referenceContext) {
      ensureOpen()
      if (!BUSINESS_IDS.srt.test(requireString(sourceRootRef, 'sourceRootRef'))) {
        throw referenceResolutionError('reference_shape_invalid')
      }
      const context = validateReferenceContext(referenceContext)
      const row = validateResolvedReference(
        selectSourceRootRef(database, sourceRootRef),
        context,
        requireTimestamp(now(), 'now()'),
      )
      return Object.freeze({
        candidateId: row.candidateId,
        sourceRootId: row.sourceRootId,
        sourceRootRef: row.sourceRootRef,
        displayPath: row.sourceDisplayPath,
        normalizedPath: row.sourceNormalizedPath,
        verifiedAt: row.issuedAt,
        expiresAt: row.expiresAt,
      })
    },

    resolveRegistrationRefs(candidateId, refs, referenceContext) {
      ensureOpen()
      requireString(candidateId, 'candidateId')
      const pair = requireObject(refs, 'refs')
      if (!BUSINESS_IDS.loc.test(requireString(pair.locationRef, 'refs.locationRef'))
        || !BUSINESS_IDS.srt.test(requireString(pair.sourceRootRef, 'refs.sourceRootRef'))) {
        throw referenceResolutionError('reference_shape_invalid')
      }
      const context = validateReferenceContext(referenceContext)
      const observedAt = requireTimestamp(now(), 'now()')
      const location = validateResolvedReference(
        selectLocationRef(database, pair.locationRef),
        context,
        observedAt,
      )
      const sourceRoot = validateResolvedReference(
        selectSourceRootRef(database, pair.sourceRootRef),
        context,
        observedAt,
      )
      if (
        location.candidateId !== candidateId
        || sourceRoot.candidateId !== candidateId
        || location.sourceRootId !== sourceRoot.sourceRootId
      ) {
        throw referenceResolutionError('reference_pair_mismatch')
      }
      if (!sameFilesystemPath(location.normalizedPath, location.candidateNormalizedPath)) {
        throw referenceResolutionError('candidate_location_mismatch')
      }
      if (!pathIsWithin(sourceRoot.sourceNormalizedPath, location.normalizedPath)) {
        throw referenceResolutionError('location_outside_source_root')
      }
      return Object.freeze({
        candidateId,
        sourceRoot: {
          sourceRootId: sourceRoot.sourceRootId,
          sourceRootRef: sourceRoot.sourceRootRef,
          displayPath: sourceRoot.sourceDisplayPath,
          normalizedPath: sourceRoot.sourceNormalizedPath,
          verifiedAt: sourceRoot.issuedAt,
        },
        location: {
          locationId: location.locationRef,
          kind: 'primary',
          displayPath: location.displayPath,
          normalizedPath: location.normalizedPath,
          verifiedAt: location.issuedAt,
        },
        expiresAt: location.expiresAt < sourceRoot.expiresAt
          ? location.expiresAt
          : sourceRoot.expiresAt,
      })
    },

    getProject(projectId) {
      ensureOpen()
      requireString(projectId, 'projectId')
      const row = database.prepare(`
        SELECT
          project_id AS projectId, mode, name, origin_kind AS originKind,
          template_id AS templateId, template_version AS templateVersion,
          forked_from_project_id AS forkedFromProjectId, lifecycle, health,
          revision, created_at AS createdAt, updated_at AS updatedAt,
          archived_at AS archivedAt
        FROM projects WHERE project_id = ?
      `).get(projectId)
      if (!row) return null
      const locations = database.prepare(`
        SELECT
          location_id AS locationId, project_id AS projectId, kind,
          display_path AS displayPath, normalized_path AS normalizedPath,
          is_active AS isActive, verified_at AS verifiedAt, revision,
          created_at AS createdAt, updated_at AS updatedAt
        FROM workspace_locations
        WHERE project_id = ?
        ORDER BY is_active DESC, kind, location_id
      `).all(projectId)
      const documentBindings = database.prepare(`
        SELECT
          role, relative_path AS relativePath, content_hash AS contentHash,
          is_required AS isRequired, source, confirmed_at AS confirmedAt, revision
        FROM project_document_bindings
        WHERE project_id = ?
        ORDER BY role, relative_path
      `).all(projectId).map(mapDocumentBinding)
      const manifestRow = database.prepare(`
        SELECT
          protocol_version AS protocolVersion, manifest_hash AS manifestHash,
          name, origin_json AS originJson,
          document_bindings_json AS documentBindingsJson,
          verified_at AS verifiedAt, revision
        FROM project_manifest_mirrors
        WHERE project_id = ?
      `).get(projectId)
      const project = mapProject(row, locations)
      project.documentBindings = documentBindings
      project.manifestMirror = manifestRow
        ? {
            protocolVersion: manifestRow.protocolVersion,
            manifestHash: manifestRow.manifestHash,
            name: manifestRow.name,
            origin: parseJson(manifestRow.originJson),
            documentBindings: parseJson(manifestRow.documentBindingsJson),
            verifiedAt: manifestRow.verifiedAt,
            revision: Number(manifestRow.revision),
          }
        : null
      return Object.freeze(project)
    },

    listProjects({ includeArchived = false, limit = 100, afterProjectId = '' } = {}) {
      ensureOpen()
      requireInteger(limit, 'limit', 1)
      if (limit > 500) throw new StorageValidationError('limit cannot exceed 500.')
      const rows = database.prepare(`
        SELECT
          p.project_id AS projectId, p.mode, p.name, p.origin_kind AS originKind,
          p.template_id AS templateId, p.template_version AS templateVersion,
          p.forked_from_project_id AS forkedFromProjectId, p.lifecycle, p.health,
          p.revision, p.created_at AS createdAt, p.updated_at AS updatedAt,
          p.archived_at AS archivedAt,
          l.location_id AS activeLocationId, l.display_path AS activeDisplayPath,
          l.normalized_path AS activeNormalizedPath
        FROM projects p
        LEFT JOIN workspace_locations l
          ON l.project_id = p.project_id AND l.kind = 'primary' AND l.is_active = 1
        WHERE p.project_id > ? AND (? = 1 OR p.archived_at IS NULL)
        ORDER BY p.project_id
        LIMIT ?
      `).all(afterProjectId, includeArchived ? 1 : 0, limit)
      return rows.map((row) => Object.freeze({
        ...mapProject(row),
        activeLocation: row.activeLocationId
          ? {
              locationId: row.activeLocationId,
              displayPath: row.activeDisplayPath,
              normalizedPath: row.activeNormalizedPath,
            }
          : null,
      }))
    },

    getCommandReceipt(commandId) {
      ensureOpen()
      requireString(commandId, 'commandId')
      const row = findReceiptByCommandId(database, commandId)
      return row ? Object.freeze(mapReceipt(row)) : null
    },

    replayCommandReceipt(command) {
      ensureOpen()
      validateCommand(command)
      const identity = commandIdentity(command)
      return replayOrThrow(findExistingReceipt(database, identity), identity)
    },

    listEvents({ afterSequence = 0, projectId = null, limit = 100 } = {}) {
      ensureOpen()
      requireInteger(afterSequence, 'afterSequence')
      requireInteger(limit, 'limit', 1)
      if (limit > 500) throw new StorageValidationError('limit cannot exceed 500.')
      if (projectId !== null) requireString(projectId, 'projectId')
      const rows = database.prepare(`
        SELECT
          event_id AS eventId, global_sequence AS sequence, project_id AS projectId,
          aggregate_type AS aggregateType, aggregate_id AS aggregateId,
          before_revision AS beforeRevision, aggregate_revision AS afterRevision,
          event_type AS eventType, schema_version AS schemaVersion,
          payload_json AS payloadJson, actor_ref AS actorRef,
          provenance_json AS provenanceJson, command_id AS commandId,
          correlation_id AS correlationId, causation_id AS causationId,
          occurred_at AS occurredAt, recorded_at AS recordedAt
        FROM domain_events
        WHERE global_sequence > ? AND (? IS NULL OR project_id = ?)
        ORDER BY global_sequence
        LIMIT ?
      `).all(afterSequence, projectId, projectId, limit)
      return rows.map((row) => Object.freeze(mapEvent(row)))
    },

    listOutbox({ status = null, limit = 100 } = {}) {
      ensureOpen()
      requireInteger(limit, 'limit', 1)
      if (limit > 500) throw new StorageValidationError('limit cannot exceed 500.')
      if (status !== null && !['pending', 'dispatching', 'delivered', 'failed'].includes(status)) {
        throw new StorageValidationError('Unsupported outbox status.')
      }
      return database.prepare(`
        SELECT
          outbox_id AS outboxId, event_id AS eventId, destination, message_key AS messageKey,
          schema_version AS schemaVersion, payload_json AS payloadJson, status,
          attempt_count AS attemptCount, next_attempt_at AS nextAttemptAt,
          delivered_at AS deliveredAt, last_error AS lastError,
          created_at AS createdAt, updated_at AS updatedAt
        FROM outbox_messages
        WHERE (? IS NULL OR status = ?)
        ORDER BY created_at, outbox_id
        LIMIT ?
      `).all(status, status, limit).map((row) => {
        const { payloadJson, ...fields } = row
        return Object.freeze({
          ...fields,
          attemptCount: Number(row.attemptCount),
          payload: parseJson(payloadJson),
        })
      })
    },

    transitionOutboxMessage(outboxId, expectedStatus, next) {
      ensureOpen()
      requireString(outboxId, 'outboxId')
      if (!BUSINESS_IDS.out.test(outboxId)) throw new StorageValidationError('outboxId must be an out_ UUIDv7.')
      if (!['pending', 'dispatching'].includes(expectedStatus)) {
        throw new StorageValidationError('Unsupported expected outbox status.')
      }
      requireObject(next, 'next')
      const status = requireString(next.status, 'next.status')
      if (!['pending', 'dispatching', 'delivered', 'failed'].includes(status)) {
        throw new StorageValidationError('Unsupported outbox status.')
      }
      const attemptCount = requireInteger(next.attemptCount, 'next.attemptCount', 1)
      const deliveredAt = next.deliveredAt === undefined || next.deliveredAt === null
        ? null
        : requireTimestamp(next.deliveredAt, 'next.deliveredAt')
      const nextAttemptAt = next.nextAttemptAt === undefined || next.nextAttemptAt === null
        ? null
        : requireTimestamp(next.nextAttemptAt, 'next.nextAttemptAt')
      const lastError = next.lastError === undefined || next.lastError === null
        ? null
        : requireBoundedString(next.lastError, 'next.lastError', 1000)
      const updatedAt = requireTimestamp(now(), 'now()')
      return executeWrite(database, () => {
        const existing = database.prepare('SELECT status FROM outbox_messages WHERE outbox_id = ?').get(outboxId)
        if (!existing) {
          throw new StorageValidationError('The outbox message does not exist.', { reason: 'outbox_not_found' })
        }
        if (existing.status !== expectedStatus) return null
        database.prepare(`
          UPDATE outbox_messages
          SET status = ?, attempt_count = ?, next_attempt_at = ?, delivered_at = ?,
            last_error = ?, updated_at = ?
          WHERE outbox_id = ? AND status = ?
        `).run(status, attemptCount, nextAttemptAt, deliveredAt, lastError, updatedAt, outboxId, expectedStatus)
        const row = database.prepare(`
          SELECT
            outbox_id AS outboxId, event_id AS eventId, destination, message_key AS messageKey,
            schema_version AS schemaVersion, payload_json AS payloadJson, status,
            attempt_count AS attemptCount, next_attempt_at AS nextAttemptAt,
            delivered_at AS deliveredAt, last_error AS lastError,
            created_at AS createdAt, updated_at AS updatedAt
          FROM outbox_messages WHERE outbox_id = ?
        `).get(outboxId)
        const { payloadJson, ...fields } = row
        return Object.freeze({
          ...fields,
          attemptCount: Number(row.attemptCount),
          payload: parseJson(payloadJson),
        })
      })
    },

    recordRejectedCommand(command, rejectedResult) {
      ensureOpen()
      validateCommand(command)
      requireObject(rejectedResult, 'rejectedResult')
      if (
        rejectedResult.status !== 'rejected'
        || rejectedResult.commandId !== command.commandId
        || rejectedResult.correlationId !== command.correlationId
        || rejectedResult.kind !== command.kind
      ) {
        throw new StorageValidationError('Rejected result identity does not match its full command.')
      }
      requireString(rejectedResult.recordedAt, 'rejectedResult.recordedAt')
      requireObject(rejectedResult.error, 'rejectedResult.error')
      requireString(rejectedResult.error.code, 'rejectedResult.error.code')
      canonicalJson(rejectedResult)
      const identity = commandIdentity(command)
      return executeWrite(database, () => {
        const replay = replayOrThrow(findExistingReceipt(database, identity), identity)
        if (replay) return replay
        insertReceipt(
          database,
          command,
          identity,
          'rejected',
          rejectedResult.recordedAt,
          rejectedResult,
          rejectedResult.error,
        )
        return Object.freeze({ ...rejectedResult })
      })
    },

    registerProject(command, trusted) {
      ensureOpen()
      validateCommand(command)
      if (!SUPPORTED_REGISTER_KINDS.has(command.kind)) {
        throw new StorageValidationError('registerProject only accepts registerLegacy/registerManaged.')
      }
      requireObject(trusted, 'trusted')
      const mode = command.kind === 'project.registerLegacy' ? 'linked_legacy' : 'managed'
      const expectedLocationRef = command.payload.locationRef
      validateLocation(trusted.location, expectedLocationRef)
      const locationPathKey = projectPathKey(trusted.location.normalizedPath)
      let candidateBinding = null
      if (trusted.candidateId !== undefined || trusted.candidateRevision !== undefined) {
        const candidateId = requireString(trusted.candidateId, 'trusted.candidateId')
        if (!BUSINESS_IDS.can.test(candidateId)) {
          throw new StorageValidationError('trusted.candidateId must be a can_ UUIDv7.')
        }
        candidateBinding = {
          candidateId,
          candidateRevision: requireInteger(
            trusted.candidateRevision,
            'trusted.candidateRevision',
            1,
          ),
        }
      }
      const eventId = trusted.eventId ?? idFactory('evt')
      const outboxId = trusted.outboxId ?? idFactory('out')
      if (!EVENT_ID.test(requireString(eventId, 'trusted.eventId'))) {
        throw new StorageValidationError('trusted.eventId must be an evt_ UUIDv7.')
      }
      requireString(outboxId, 'trusted.outboxId')
      const name = command.kind === 'project.registerLegacy'
        ? requireString(command.payload.name, 'command.payload.name')
        : requireString(trusted.manifestName, 'trusted.manifestName')
      const origin = command.kind === 'project.registerLegacy'
        ? { kind: 'imported' }
        : (trusted.origin ?? { kind: 'imported' })
      requireObject(origin, 'trusted.origin')
      requireString(origin.kind, 'trusted.origin.kind')
      const documentBindings = command.kind === 'project.registerLegacy'
        ? validateDocumentBindings(command.payload.documentBindings, {
            source: 'user_confirmed',
            requireContentHash: true,
          })
        : validateDocumentBindings(trusted.manifestDocumentBindings, {
            source: 'manifest',
            requireContentHash: false,
          })
      if (command.kind === 'project.registerManaged') {
        if (
          !CONTENT_HASH.test(requireString(trusted.manifestHash, 'trusted.manifestHash'))
          || trusted.manifestHash !== command.payload.manifestHash
        ) {
          throw new StorageValidationError(
            'Trusted manifest hash does not match the validated registerManaged command.',
          )
        }
      }
      const identity = commandIdentity(command)

      return executeWrite(database, () => {
        const replay = replayOrThrow(findExistingReceipt(database, identity), identity)
        if (replay) return replay

        const current = database.prepare('SELECT revision FROM projects WHERE project_id = ?')
          .get(command.target.projectId)
        if (current || command.expectedRevision !== 0) {
          return rejectAndRecord(
            command,
            identity,
            'REVISION_CONFLICT',
            'Project creation expected revision 0, but the project already exists or the expectation is invalid.',
            Number(current?.revision ?? 0),
          )
        }

        if (candidateBinding) {
          const candidate = database.prepare(`
            SELECT
              root_path_key AS rootPathKey, status,
              matched_project_id AS matchedProjectId, revision
            FROM import_candidates
            WHERE candidate_id = ?
          `).get(candidateBinding.candidateId)
          if (
            !candidate
            || Number(candidate.revision) !== candidateBinding.candidateRevision
            || !CANDIDATE_STATES.has(candidate.status)
            || candidate.matchedProjectId !== null
          ) {
            return rejectAndRecord(
              command,
              identity,
              'REVISION_CONFLICT',
              'The import candidate changed before project registration.',
              0,
            )
          }
          if (candidate.rootPathKey !== locationPathKey) {
            return rejectAndRecord(
              command,
              identity,
              'REFERENCE_UNRESOLVED',
              'The import candidate no longer matches the resolved workspace location.',
              0,
            )
          }
        }

        const locationConflict = database.prepare(`
          SELECT location_id AS locationId
          FROM workspace_locations
          WHERE location_id = ?
            OR (path_key = ? AND is_active = 1)
          LIMIT 1
        `).get(trusted.location.locationId, locationPathKey)
        if (locationConflict) {
          return rejectAndRecord(
            command,
            identity,
            'LOCATION_CONFLICT',
            'The confirmed workspace location is already registered.',
            0,
          )
        }

        const recordedAt = now()
        const verifiedAt = trusted.location.verifiedAt ?? recordedAt
        database.prepare(`
          INSERT INTO projects(
            project_id, mode, name, origin_kind, template_id, template_version,
            forked_from_project_id, lifecycle, health, revision, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 'unknown', 1, ?, ?)
        `).run(
          command.target.projectId,
          mode,
          name,
          origin.kind,
          origin.templateId ?? null,
          origin.templateVersion ?? null,
          origin.forkedFromProjectId ?? null,
          recordedAt,
          recordedAt,
        )
        if (candidateBinding) {
          const candidateUpdated = database.prepare(`
            UPDATE import_candidates
            SET status = 'imported', status_before_ignored = NULL,
              matched_project_id = ?, revision = revision + 1, updated_at = ?
            WHERE candidate_id = ? AND revision = ?
              AND status IN ('discovered', 'conflict', 'relocation_candidate')
              AND matched_project_id IS NULL
            RETURNING revision
          `).get(
            command.target.projectId,
            recordedAt,
            candidateBinding.candidateId,
            candidateBinding.candidateRevision,
          )
          if (!candidateUpdated) {
            throw new StorageValidationError(
              'Import candidate update unexpectedly affected no rows.',
            )
          }
        }
        insertDocumentBindings(
          database,
          command.target.projectId,
          documentBindings,
          recordedAt,
        )
        if (command.kind === 'project.registerManaged') {
          database.prepare(`
            INSERT INTO project_manifest_mirrors(
              project_id, protocol_version, manifest_hash, name, origin_json,
              document_bindings_json, verified_at, revision
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)
          `).run(
            command.target.projectId,
            PROTOCOL_VERSION,
            trusted.manifestHash,
            name,
            canonicalJson(origin),
            canonicalJson(documentBindings),
            verifiedAt,
          )
        }
        database.prepare(`
          INSERT INTO workspace_locations(
            location_id, project_id, kind, display_path, normalized_path, path_key,
            is_active, verified_at, revision, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, 1, ?, ?)
        `).run(
          trusted.location.locationId,
          command.target.projectId,
          trusted.location.kind ?? 'primary',
          trusted.location.displayPath,
          trusted.location.normalizedPath,
          locationPathKey,
          verifiedAt,
          recordedAt,
          recordedAt,
        )

        const sequence = nextSequence(database)
        const fileSync = command.kind === 'project.registerLegacy'
          ? { status: 'not_required' }
          : { status: 'verified_existing', manifestHash: command.payload.manifestHash }
        const data = command.kind === 'project.registerLegacy'
          ? {
              projectMode: mode,
              name,
              locationRef: command.payload.locationRef,
              sourceRootRef: command.payload.sourceRootRef,
              documentBindings: command.payload.documentBindings,
              fileSync,
            }
          : {
              projectMode: mode,
              locationRef: command.payload.locationRef,
              sourceRootRef: command.payload.sourceRootRef,
              manifestHash: command.payload.manifestHash,
              fileSync,
            }
        const event = buildNormalizedEvent({
          command,
          eventId,
          eventType: eventTypeForRegister(command.kind),
          sequence,
          beforeRevision: 0,
          afterRevision: 1,
          recordedAt,
          data,
        })
        const result = {
          protocolVersion: PROTOCOL_VERSION,
          schemaVersion: RESULT_SCHEMA_VERSION,
          commandId: command.commandId,
          correlationId: command.correlationId,
          kind: command.kind,
          status: 'accepted',
          recordedAt,
          projectId: command.target.projectId,
          projectMode: mode,
          aggregateRevision: 1,
          eventId,
          outcome: outcomeForRegister(command.kind),
          fileSync,
        }
        insertReceipt(database, command, identity, 'accepted', recordedAt, result, null)
        insertEvent(database, event, command)
        insertOutbox(database, outboxId, event, recordedAt)
        return Object.freeze(result)
      })
    },

    rebindProject(command, trusted) {
      ensureOpen()
      validateCommand(command, 'project.rebindLocation')
      requireObject(trusted, 'trusted')
      validateLocation(trusted.newLocation, command.payload.newLocationRef)
      const newLocationPathKey = projectPathKey(trusted.newLocation.normalizedPath)
      let candidateBinding = null
      if (trusted.candidateId !== undefined || trusted.candidateRevision !== undefined) {
        const candidateId = requireString(trusted.candidateId, 'trusted.candidateId')
        if (!BUSINESS_IDS.can.test(candidateId)) {
          throw new StorageValidationError('trusted.candidateId must be a can_ UUIDv7.')
        }
        candidateBinding = {
          candidateId,
          candidateRevision: requireInteger(
            trusted.candidateRevision,
            'trusted.candidateRevision',
            1,
          ),
        }
      }
      const eventId = trusted.eventId ?? idFactory('evt')
      const outboxId = trusted.outboxId ?? idFactory('out')
      const historyId = trusted.historyId ?? idFactory('pth')
      if (!EVENT_ID.test(requireString(eventId, 'trusted.eventId'))) {
        throw new StorageValidationError('trusted.eventId must be an evt_ UUIDv7.')
      }
      requireString(outboxId, 'trusted.outboxId')
      requireString(historyId, 'trusted.historyId')
      const identity = commandIdentity(command)

      return executeWrite(database, () => {
        const replay = replayOrThrow(findExistingReceipt(database, identity), identity)
        if (replay) return replay

        const project = database.prepare(`
          SELECT mode, revision FROM projects WHERE project_id = ?
        `).get(command.target.projectId)
        if (!project) {
          return rejectAndRecord(
            command,
            identity,
            'REFERENCE_UNRESOLVED',
            'The project does not exist.',
            0,
          )
        }
        if (Number(project.revision) !== command.expectedRevision) {
          return rejectAndRecord(
            command,
            identity,
            'REVISION_CONFLICT',
            'The project revision changed before the location could be rebound.',
            Number(project.revision),
          )
        }
        if (project.mode !== command.payload.expectedMode) {
          return rejectAndRecord(
            command,
            identity,
            'MODE_CONFLICT',
            'The project mode no longer matches the confirmed rebind command.',
            Number(project.revision),
          )
        }

        if (candidateBinding) {
          const candidate = database.prepare(`
            SELECT
              root_path_key AS rootPathKey, status,
              matched_project_id AS matchedProjectId, revision
            FROM import_candidates
            WHERE candidate_id = ?
          `).get(candidateBinding.candidateId)
          if (
            !candidate
            || Number(candidate.revision) !== candidateBinding.candidateRevision
            || candidate.status !== 'relocation_candidate'
            || candidate.matchedProjectId !== null
          ) {
            return rejectAndRecord(
              command,
              identity,
              'REVISION_CONFLICT',
              'The relocation candidate changed before project rebind.',
              Number(project.revision),
            )
          }
          if (candidate.rootPathKey !== newLocationPathKey) {
            return rejectAndRecord(
              command,
              identity,
              'REFERENCE_UNRESOLVED',
              'The relocation candidate no longer matches the resolved workspace location.',
              Number(project.revision),
            )
          }
        }

        const currentLocation = database.prepare(`
          SELECT
            location_id AS locationId, display_path AS displayPath,
            normalized_path AS normalizedPath, revision
          FROM workspace_locations
          WHERE project_id = ? AND location_id = ? AND is_active = 1
        `).get(command.target.projectId, command.payload.currentLocationRef)
        if (!currentLocation) {
          return rejectAndRecord(
            command,
            identity,
            'REFERENCE_UNRESOLVED',
            'The active workspace location no longer matches the command.',
            Number(project.revision),
          )
        }
        if (Number(currentLocation.revision) !== command.payload.currentLocationRevision) {
          return rejectAndRecord(
            command,
            identity,
            'REVISION_CONFLICT',
            'The workspace location revision changed before rebind.',
            Number(project.revision),
          )
        }

        const locationConflict = database.prepare(`
          SELECT location_id AS locationId
          FROM workspace_locations
          WHERE location_id = ?
            OR (path_key = ? AND is_active = 1 AND location_id <> ?)
            OR (project_id = ? AND kind = ? AND is_active = 1 AND location_id <> ?)
          LIMIT 1
        `).get(
          trusted.newLocation.locationId,
          newLocationPathKey,
          currentLocation.locationId,
          command.target.projectId,
          trusted.newLocation.kind ?? 'primary',
          currentLocation.locationId,
        )
        if (locationConflict) {
          return rejectAndRecord(
            command,
            identity,
            'LOCATION_CONFLICT',
            'The new workspace location is already active for another registration.',
            Number(project.revision),
          )
        }

        const recordedAt = now()
        const verifiedAt = trusted.newLocation.verifiedAt ?? recordedAt
        database.prepare(`
          UPDATE workspace_locations
          SET is_active = 0, revision = revision + 1, updated_at = ?
          WHERE location_id = ? AND project_id = ? AND revision = ? AND is_active = 1
        `).run(
          recordedAt,
          currentLocation.locationId,
          command.target.projectId,
          command.payload.currentLocationRevision,
        )
        database.prepare(`
          INSERT INTO workspace_locations(
            location_id, project_id, kind, display_path, normalized_path, path_key,
            is_active, verified_at, revision, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, 1, ?, ?)
        `).run(
          trusted.newLocation.locationId,
          command.target.projectId,
          trusted.newLocation.kind ?? 'primary',
          trusted.newLocation.displayPath,
          trusted.newLocation.normalizedPath,
          newLocationPathKey,
          verifiedAt,
          recordedAt,
          recordedAt,
        )
        database.prepare(`
          INSERT INTO project_path_history(
            history_id, project_id, old_path, new_path, reason, changed_by, changed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          historyId,
          command.target.projectId,
          currentLocation.displayPath,
          trusted.newLocation.displayPath,
          command.payload.reason,
          canonicalJson(command.actor),
          recordedAt,
        )
        const updated = database.prepare(`
          UPDATE projects
          SET revision = revision + 1, updated_at = ?
          WHERE project_id = ? AND revision = ?
          RETURNING revision
        `).get(recordedAt, command.target.projectId, command.expectedRevision)
        if (!updated) {
          throw new StorageValidationError('Project revision update unexpectedly affected no rows.')
        }
        if (candidateBinding) {
          const candidateUpdated = database.prepare(`
            UPDATE import_candidates
            SET status = 'imported', status_before_ignored = NULL,
              matched_project_id = ?, revision = revision + 1, updated_at = ?
            WHERE candidate_id = ? AND revision = ?
              AND status = 'relocation_candidate'
              AND matched_project_id IS NULL
            RETURNING revision
          `).get(
            command.target.projectId,
            recordedAt,
            candidateBinding.candidateId,
            candidateBinding.candidateRevision,
          )
          if (!candidateUpdated) {
            throw new StorageValidationError(
              'Relocation candidate update unexpectedly affected no rows.',
            )
          }
        }

        const afterRevision = Number(updated.revision)
        const sequence = nextSequence(database)
        const fileSync = { status: 'not_required' }
        const data = {
          projectMode: project.mode,
          previousLocationRef: command.payload.currentLocationRef,
          newLocationRef: command.payload.newLocationRef,
          sourceRootRef: command.payload.sourceRootRef,
          reason: command.payload.reason,
          identityEvidence: command.payload.identityEvidence,
          fileSync,
        }
        const event = buildNormalizedEvent({
          command,
          eventId,
          eventType: 'project.location.rebound',
          sequence,
          beforeRevision: command.expectedRevision,
          afterRevision,
          recordedAt,
          data,
        })
        const result = {
          protocolVersion: PROTOCOL_VERSION,
          schemaVersion: RESULT_SCHEMA_VERSION,
          commandId: command.commandId,
          correlationId: command.correlationId,
          kind: command.kind,
          status: 'accepted',
          recordedAt,
          projectId: command.target.projectId,
          projectMode: project.mode,
          aggregateRevision: afterRevision,
          eventId,
          outcome: 'location_rebound',
          fileSync,
        }
        insertReceipt(database, command, identity, 'accepted', recordedAt, result, null)
        insertEvent(database, event, command)
        insertOutbox(database, outboxId, event, recordedAt)
        return Object.freeze(result)
      })
    },

    resolveUpgradePlanRefs(planId, refs, referenceContext) {
      ensureOpen()
      if (!BUSINESS_IDS.pln.test(requireString(planId, 'planId'))) {
        throw referenceResolutionError('plan_shape_invalid')
      }
      requireObject(refs, 'refs')
      if (!BUSINESS_IDS.loc.test(requireString(refs.locationRef, 'refs.locationRef'))) {
        throw referenceResolutionError('reference_shape_invalid')
      }
      const context = validateReferenceContext(referenceContext)
      const observedAt = requireTimestamp(now(), 'now()')
      const plan = selectFileSyncPlan(database, planId)
      if (plan === null) throw referenceResolutionError('plan_not_found')
      if (plan.kind !== 'upgrade_managed') throw referenceResolutionError('plan_kind_mismatch')
      // The frozen upgrade payload carries no sourceRootRef: the prepare-time
      // source-root authorization row is bound to the plan itself and serves
      // as the time-limited capability marker.
      const sourceRootRow = database.prepare(`
        SELECT
          plan_ref AS planRef, ref_kind AS refKind, plan_id AS planId,
          application_instance_id AS applicationInstanceId, scope,
          display_path AS displayPath, normalized_path AS normalizedPath,
          issued_at AS issuedAt, expires_at AS expiresAt, revoked_at AS revokedAt
        FROM file_sync_plan_refs
        WHERE plan_id = ? AND ref_kind = 'source_root'
        ORDER BY issued_at DESC, plan_ref DESC
        LIMIT 1
      `).get(planId)
      if (!sourceRootRow) throw referenceResolutionError('reference_not_found')
      if (sourceRootRow.applicationInstanceId !== context.applicationInstanceId) {
        throw referenceResolutionError('application_instance_mismatch')
      }
      if (sourceRootRow.scope !== context.scope) throw referenceResolutionError('scope_mismatch')
      if (sourceRootRow.revokedAt !== null) throw referenceResolutionError('reference_revoked')
      if (Date.parse(observedAt) >= Date.parse(sourceRootRow.expiresAt)) {
        throw referenceResolutionError('reference_expired')
      }
      if (sourceRootRow.planId !== planId || sourceRootRow.refKind !== 'source_root') {
        throw referenceResolutionError('reference_plan_mismatch')
      }
      const locationRow = database.prepare(`
        SELECT
          location_id AS locationId, project_id AS projectId,
          display_path AS displayPath, normalized_path AS normalizedPath,
          is_active AS isActive, verified_at AS verifiedAt, revision
        FROM workspace_locations
        WHERE location_id = ?
      `).get(refs.locationRef)
      if (!locationRow || Number(locationRow.isActive) !== 1) {
        throw referenceResolutionError('reference_not_found')
      }
      if (locationRow.projectId !== plan.projectId) {
        throw referenceResolutionError('reference_plan_mismatch')
      }
      if (!sameFilesystemPath(locationRow.normalizedPath, plan.targetNormalizedPath)) {
        throw referenceResolutionError('plan_target_mismatch')
      }
      if (!pathIsWithin(sourceRootRow.normalizedPath, locationRow.normalizedPath)
        || sameFilesystemPath(sourceRootRow.normalizedPath, locationRow.normalizedPath)) {
        throw referenceResolutionError('location_outside_source_root')
      }
      return Object.freeze({
        planId,
        location: {
          locationId: locationRow.locationId,
          kind: 'primary',
          displayPath: locationRow.displayPath,
          normalizedPath: locationRow.normalizedPath,
          verifiedAt: locationRow.verifiedAt,
          revision: Number(locationRow.revision),
        },
        sourceRoot: {
          sourceRootId: sourceRootRow.planRef,
          displayPath: sourceRootRow.displayPath,
          normalizedPath: sourceRootRow.normalizedPath,
          expiresAt: sourceRootRow.expiresAt,
        },
      })
    },

    registerUpgradeManaged(command, trusted) {
      ensureOpen()
      validateCommand(command, 'project.upgradeManaged')
      requireObject(trusted, 'trusted')
      const planId = requireString(trusted.planId, 'trusted.planId')
      if (!BUSINESS_IDS.pln.test(planId)) {
        throw new StorageValidationError('trusted.planId must be a pln_ UUIDv7.')
      }
      validateLocation(trusted.location, command.payload.locationRef)
      const eventId = trusted.eventId ?? idFactory('evt')
      const outboxId = trusted.outboxId ?? idFactory('out')
      if (!EVENT_ID.test(requireString(eventId, 'trusted.eventId'))) {
        throw new StorageValidationError('trusted.eventId must be an evt_ UUIDv7.')
      }
      requireString(outboxId, 'trusted.outboxId')
      const manifestName = requireString(trusted.manifestName, 'trusted.manifestName')
      if (!CONTENT_HASH.test(requireString(trusted.manifestHash, 'trusted.manifestHash'))) {
        throw new StorageValidationError('trusted.manifestHash must use the sha256: line format.')
      }
      const identity = commandIdentity(command)

      return executeWrite(database, () => {
        const replay = replayOrThrow(findExistingReceipt(database, identity), identity)
        if (replay) return replay

        const project = database.prepare(`
          SELECT mode, name, revision FROM projects WHERE project_id = ?
        `).get(command.target.projectId)
        if (!project) {
          return rejectAndRecord(command, identity, 'REFERENCE_UNRESOLVED', 'The project does not exist.', 0)
        }
        if (project.mode !== 'linked_legacy') {
          return rejectAndRecord(command, identity, 'MODE_CONFLICT', 'Only a linked legacy project can be upgraded.', Number(project.revision))
        }
        if (Number(project.revision) !== command.expectedRevision) {
          return rejectAndRecord(command, identity, 'REVISION_CONFLICT', 'The project revision changed before the upgrade.', Number(project.revision))
        }
        const location = database.prepare(`
          SELECT location_id AS locationId, revision, normalized_path AS normalizedPath
          FROM workspace_locations
          WHERE project_id = ? AND location_id = ? AND is_active = 1
        `).get(command.target.projectId, command.payload.locationRef)
        if (!location) {
          return rejectAndRecord(command, identity, 'REFERENCE_UNRESOLVED', 'The active workspace location no longer matches the command.', Number(project.revision))
        }
        if (Number(location.revision) !== command.payload.locationRevision) {
          return rejectAndRecord(command, identity, 'REVISION_CONFLICT', 'The workspace location revision changed before the upgrade.', Number(project.revision))
        }
        if (!sameFilesystemPath(location.normalizedPath, trusted.location.normalizedPath)) {
          return rejectAndRecord(command, identity, 'REFERENCE_UNRESOLVED', 'The resolved location no longer matches the active workspace.', Number(project.revision))
        }
        const plan = selectFileSyncPlan(database, planId)
        if (plan === null) {
          return rejectAndRecord(command, identity, 'REFERENCE_UNRESOLVED', 'The write plan no longer exists.', Number(project.revision))
        }
        if (plan.commandId !== command.commandId
          || plan.projectId !== command.target.projectId
          || plan.kind !== 'upgrade_managed') {
          return rejectAndRecord(command, identity, 'REFERENCE_UNRESOLVED', 'The write plan does not belong to this command.', Number(project.revision))
        }
        if (plan.state !== 'files_committed') {
          return rejectAndRecord(command, identity, 'FILE_SYNC_FAILED', 'The project manifest was not committed before acceptance.', Number(project.revision))
        }
        if (plan.planHash !== command.payload.writePlan.planHash
          || plan.manifestHash !== command.payload.writePlan.manifestHash
          || plan.manifestHash !== trusted.manifestHash) {
          return rejectAndRecord(command, identity, 'WRITE_PLAN_STALE', 'The write plan hashes no longer match the committed plan.', Number(project.revision))
        }
        const fingerprint = computeLegacyFingerprint(database, command.target.projectId)
        if (fingerprint !== command.payload.legacyFingerprintHash) {
          return rejectAndRecord(command, identity, 'WRITE_PLAN_STALE', 'The legacy document fingerprint no longer matches the command.', Number(project.revision))
        }
        if (manifestName !== project.name) {
          return rejectAndRecord(command, identity, 'WRITE_PLAN_STALE', 'The manifest name no longer matches the project.', Number(project.revision))
        }
        const recordedAt = now()
        const afterRevision = Number(project.revision) + 1
        const name = project.name
        database.prepare(`
          UPDATE projects
          SET mode = 'managed', origin_kind = 'imported',
            template_id = NULL, template_version = NULL,
            revision = revision + 1, updated_at = ?
          WHERE project_id = ? AND revision = ?
        `).run(recordedAt, command.target.projectId, command.expectedRevision)
        const documentBindings = database.prepare(`
          SELECT role, relative_path AS relativePath, content_hash AS contentHash,
            is_required AS required
          FROM project_document_bindings
          WHERE project_id = ?
          ORDER BY role, relative_path
        `).all(command.target.projectId).map((row) => ({
          role: row.role,
          relativePath: row.relativePath,
          contentHash: row.contentHash,
          required: Number(row.required) === 1,
          source: 'manifest',
        }))
        database.prepare(`
          INSERT INTO project_manifest_mirrors(
            project_id, protocol_version, manifest_hash, name, origin_json,
            document_bindings_json, verified_at, revision
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)
        `).run(
          command.target.projectId,
          PROTOCOL_VERSION,
          trusted.manifestHash,
          name,
          canonicalJson({ kind: 'imported' }),
          canonicalJson(documentBindings),
          recordedAt,
        )
        const planAccepted = database.prepare(`
          UPDATE file_sync_plans
          SET state = 'accepted', updated_at = ?, completed_at = ?
          WHERE plan_id = ? AND state = 'files_committed'
        `).run(recordedAt, recordedAt, planId)
        if (Number(planAccepted.changes) !== 1) {
          throw new StorageValidationError('The file sync plan changed before acceptance.')
        }
        const sequence = nextSequence(database)
        const fileSync = {
          status: 'committed',
          planId,
          planHash: plan.planHash,
          manifestHash: plan.manifestHash,
        }
        const data = {
          previousMode: 'linked_legacy',
          projectMode: 'managed',
          locationRef: command.payload.locationRef,
          manifestHash: trusted.manifestHash,
          fileSync,
        }
        const event = buildNormalizedEvent({
          command,
          eventId,
          eventType: 'project.managed.upgraded',
          sequence,
          beforeRevision: Number(project.revision),
          afterRevision,
          recordedAt,
          data,
        })
        const result = {
          protocolVersion: PROTOCOL_VERSION,
          schemaVersion: RESULT_SCHEMA_VERSION,
          commandId: command.commandId,
          correlationId: command.correlationId,
          kind: command.kind,
          status: 'accepted',
          recordedAt,
          projectId: command.target.projectId,
          projectMode: 'managed',
          aggregateRevision: afterRevision,
          eventId,
          outcome: 'managed_upgraded',
          fileSync,
        }
        insertReceipt(database, command, identity, 'accepted', recordedAt, result, null)
        insertEvent(database, event, command)
        insertOutbox(database, outboxId, event, recordedAt)
        return Object.freeze(result)
      })
    },

    registerCreatedProject(command, trusted) {
      ensureOpen()
      validateCommand(command, 'project.createFromTemplate')
      requireObject(trusted, 'trusted')
      const planId = requireString(trusted.planId, 'trusted.planId')
      if (!BUSINESS_IDS.pln.test(planId)) {
        throw new StorageValidationError('trusted.planId must be a pln_ UUIDv7.')
      }
      validateLocation(trusted.location, command.payload.targetLocationRef)
      const locationPathKey = projectPathKey(trusted.location.normalizedPath)
      const eventId = trusted.eventId ?? idFactory('evt')
      const outboxId = trusted.outboxId ?? idFactory('out')
      if (!EVENT_ID.test(requireString(eventId, 'trusted.eventId'))) {
        throw new StorageValidationError('trusted.eventId must be an evt_ UUIDv7.')
      }
      requireString(outboxId, 'trusted.outboxId')
      const name = requireString(trusted.manifestName, 'trusted.manifestName')
      const origin = trusted.origin ?? {
        kind: 'template',
        templateId: command.payload.template.templateId,
        templateVersion: command.payload.template.templateVersion,
      }
      requireObject(origin, 'trusted.origin')
      if (origin.kind !== 'template'
        || !TEMPLATE_ID_PATTERN.test(requireString(origin.templateId, 'trusted.origin.templateId'))
        || !TEMPLATE_VERSION_PATTERN.test(requireString(origin.templateVersion, 'trusted.origin.templateVersion'))) {
        throw new StorageValidationError('A created project requires a template origin with id and version.')
      }
      const documentBindings = validateDocumentBindings(trusted.manifestDocumentBindings, {
        source: 'manifest',
        requireContentHash: false,
      })
      if (!CONTENT_HASH.test(requireString(trusted.manifestHash, 'trusted.manifestHash'))) {
        throw new StorageValidationError('trusted.manifestHash must use the sha256: line format.')
      }
      const identity = commandIdentity(command)

      return executeWrite(database, () => {
        const replay = replayOrThrow(findExistingReceipt(database, identity), identity)
        if (replay) return replay

        const current = database.prepare('SELECT revision FROM projects WHERE project_id = ?')
          .get(command.target.projectId)
        if (current || command.expectedRevision !== 0) {
          return rejectAndRecord(
            command,
            identity,
            'REVISION_CONFLICT',
            'Project creation expected revision 0, but the project already exists or the expectation is invalid.',
            Number(current?.revision ?? 0),
          )
        }

        const plan = selectFileSyncPlan(database, planId)
        if (plan === null) {
          return rejectAndRecord(command, identity, 'REFERENCE_UNRESOLVED', 'The write plan no longer exists.', 0)
        }
        if (plan.commandId !== command.commandId || plan.projectId !== command.target.projectId) {
          return rejectAndRecord(command, identity, 'REFERENCE_UNRESOLVED', 'The write plan does not belong to this command.', 0)
        }
        if (plan.state !== 'files_committed') {
          return rejectAndRecord(command, identity, 'FILE_SYNC_FAILED', 'The project files were not committed before acceptance.', 0)
        }
        if (plan.planHash !== command.payload.writePlan.planHash
          || plan.manifestHash !== command.payload.writePlan.manifestHash
          || plan.manifestHash !== trusted.manifestHash) {
          return rejectAndRecord(command, identity, 'WRITE_PLAN_STALE', 'The write plan hashes no longer match the committed plan.', 0)
        }

        const locationConflict = database.prepare(`
          SELECT location_id AS locationId
          FROM workspace_locations
          WHERE location_id = ?
            OR (path_key = ? AND is_active = 1)
          LIMIT 1
        `).get(trusted.location.locationId, locationPathKey)
        if (locationConflict) {
          return rejectAndRecord(
            command,
            identity,
            'LOCATION_CONFLICT',
            'The created workspace location is already registered.',
            0,
          )
        }

        const recordedAt = now()
        const verifiedAt = trusted.location.verifiedAt ?? recordedAt
        database.prepare(`
          INSERT INTO projects(
            project_id, mode, name, origin_kind, template_id, template_version,
            forked_from_project_id, lifecycle, health, revision, created_at, updated_at
          ) VALUES (?, 'managed', ?, 'template', ?, ?, NULL, 'active', 'unknown', 1, ?, ?)
        `).run(
          command.target.projectId,
          name,
          origin.templateId,
          origin.templateVersion,
          recordedAt,
          recordedAt,
        )
        insertDocumentBindings(database, command.target.projectId, documentBindings, recordedAt)
        database.prepare(`
          INSERT INTO project_manifest_mirrors(
            project_id, protocol_version, manifest_hash, name, origin_json,
            document_bindings_json, verified_at, revision
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)
        `).run(
          command.target.projectId,
          PROTOCOL_VERSION,
          trusted.manifestHash,
          name,
          canonicalJson(origin),
          canonicalJson(documentBindings),
          verifiedAt,
        )
        database.prepare(`
          INSERT INTO workspace_locations(
            location_id, project_id, kind, display_path, normalized_path, path_key,
            is_active, verified_at, revision, created_at, updated_at
          ) VALUES (?, ?, 'primary', ?, ?, ?, 1, ?, 1, ?, ?)
        `).run(
          trusted.location.locationId,
          command.target.projectId,
          trusted.location.displayPath,
          trusted.location.normalizedPath,
          locationPathKey,
          verifiedAt,
          recordedAt,
          recordedAt,
        )
        const sequence = nextSequence(database)
        const fileSync = {
          status: 'committed',
          planId,
          planHash: plan.planHash,
          manifestHash: plan.manifestHash,
        }
        const data = {
          projectMode: 'managed',
          name,
          templateId: origin.templateId,
          templateVersion: origin.templateVersion,
          locationRef: command.payload.targetLocationRef,
          sourceRootRef: command.payload.sourceRootRef,
          manifestHash: trusted.manifestHash,
          fileSync,
        }
        const event = buildNormalizedEvent({
          command,
          eventId,
          eventType: 'project.managed.created',
          sequence,
          beforeRevision: 0,
          afterRevision: 1,
          recordedAt,
          data,
        })
        const result = {
          protocolVersion: PROTOCOL_VERSION,
          schemaVersion: RESULT_SCHEMA_VERSION,
          commandId: command.commandId,
          correlationId: command.correlationId,
          kind: command.kind,
          status: 'accepted',
          recordedAt,
          projectId: command.target.projectId,
          projectMode: 'managed',
          aggregateRevision: 1,
          eventId,
          outcome: 'managed_created',
          fileSync,
        }
        const planAccepted = database.prepare(`
          UPDATE file_sync_plans
          SET state = 'accepted', updated_at = ?, completed_at = ?
          WHERE plan_id = ? AND state = 'files_committed'
        `).run(recordedAt, recordedAt, planId)
        if (Number(planAccepted.changes) !== 1) {
          throw new StorageValidationError('The file sync plan changed before acceptance.')
        }
        insertReceipt(database, command, identity, 'accepted', recordedAt, result, null)
        insertEvent(database, event, command)
        insertOutbox(database, outboxId, event, recordedAt)
        return Object.freeze(result)
      })
    },

    createFileSyncPlan(input) {
      ensureOpen()
      const plan = validateFileSyncPlanInput(input)
      const recordedAt = requireTimestamp(now(), 'now()')
      return executeWrite(database, () => {
        const existing = database.prepare(`
          SELECT 1 AS present FROM file_sync_plans WHERE plan_id = ?
        `).get(plan.planId)
        if (existing) {
          throw new StorageValidationError('A file sync plan with this planId already exists.', {
            reason: 'plan_id_conflict',
            planId: plan.planId,
          })
        }
        database.prepare(`
          INSERT INTO file_sync_plans(
            plan_id, command_id, kind, project_id, sync_policy,
            target_display_path, target_normalized_path, staging_display_path,
            plan_hash, manifest_hash, state, operations_json,
            render_params_json, root_preexisted_empty, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'planned', ?, ?, ?, ?, ?)
        `).run(
          plan.planId,
          plan.commandId,
          plan.kind,
          plan.projectId,
          plan.syncPolicy,
          plan.targetDisplayPath,
          plan.targetNormalizedPath,
          plan.stagingDisplayPath,
          plan.planHash,
          plan.manifestHash,
          JSON.stringify(plan.operations),
          plan.renderParams === null ? null : JSON.stringify(plan.renderParams),
          plan.rootPreexistedEmpty ? 1 : 0,
          recordedAt,
          recordedAt,
        )
        return selectFileSyncPlan(database, plan.planId)
      })
    },

    getFileSyncPlan(planId) {
      ensureOpen()
      if (!BUSINESS_IDS.pln.test(requireString(planId, 'planId'))) {
        throw new StorageValidationError('planId must be a pln_ UUIDv7.')
      }
      return selectFileSyncPlan(database, planId)
    },

    listFileSyncPlansForRecovery() {
      ensureOpen()
      return database.prepare(`
        SELECT
          plan_id, command_id, kind, project_id, sync_policy,
          target_display_path, target_normalized_path, staging_display_path,
          plan_hash, manifest_hash, state, operations_json, created_paths_json,
          render_params_json, root_preexisted_empty, error_code,
          created_at, updated_at, completed_at
        FROM file_sync_plans
        WHERE state IN ('staging', 'staged', 'files_committed')
        ORDER BY created_at, plan_id
      `).all().map(rowToFileSyncPlan)
    },

    setFileSyncPlanState(planId, expectedState, updates) {
      ensureOpen()
      if (!BUSINESS_IDS.pln.test(requireString(planId, 'planId'))) {
        throw new StorageValidationError('planId must be a pln_ UUIDv7.')
      }
      if (!FILE_SYNC_STATES.has(expectedState)) {
        throw new StorageValidationError('The expected file sync plan state is unsupported.')
      }
      requireObject(updates, 'updates')
      const nextState = requireString(updates.state, 'updates.state')
      if (!FILE_SYNC_TRANSITIONS[expectedState]?.has(nextState)) {
        throw new StorageValidationError('The file sync plan cannot move between these states.', {
          reason: 'transition_invalid',
          planId,
          expectedState,
          nextState,
        })
      }
      if (updates.createdPaths !== undefined
        && (!Array.isArray(updates.createdPaths) || updates.createdPaths.length > 500)) {
        throw new StorageValidationError('updates.createdPaths must be an array of at most 500 relative paths.')
      }
      const createdPaths = [...new Set((updates.createdPaths ?? []).map((raw, index) => {
        const relativePath = requireString(raw, `updates.createdPaths[${index}]`)
        if (!RELATIVE_PATH.test(relativePath)) {
          throw new StorageValidationError(`updates.createdPaths[${index}] is invalid.`)
        }
        return relativePath
      }))]
      const errorCode = updates.errorCode === undefined
        ? null
        : requireString(updates.errorCode, 'updates.errorCode').slice(0, 100)
      return executeWrite(database, () => {
        const current = selectFileSyncPlan(database, planId)
        if (current === null) {
          throw new StorageValidationError('The file sync plan does not exist.', {
            reason: 'plan_not_found',
            planId,
          })
        }
        if (current.state !== expectedState) {
          throw new StorageValidationError('The file sync plan state changed.', {
            reason: 'state_conflict',
            planId,
            expectedState,
            actualState: current.state,
          })
        }
        const recordedAt = requireTimestamp(now(), 'now()')
        const terminal = FILE_SYNC_TERMINAL_STATES.has(nextState)
        database.prepare(`
          UPDATE file_sync_plans
          SET state = ?, created_paths_json = ?, error_code = ?, updated_at = ?,
              completed_at = ?
          WHERE plan_id = ? AND state = ?
        `).run(
          nextState,
          JSON.stringify(createdPaths),
          errorCode,
          recordedAt,
          terminal ? recordedAt : null,
          planId,
          expectedState,
        )
        return selectFileSyncPlan(database, planId)
      })
    },

    issueFileSyncPlanRefs(planId, options) {
      ensureOpen()
      if (!BUSINESS_IDS.pln.test(requireString(planId, 'planId'))) {
        throw new StorageValidationError('planId must be a pln_ UUIDv7.')
      }
      requireObject(options, 'options')
      const context = validateReferenceContext(options)
      const ttlSeconds = options.ttlSeconds ?? 300
      requireInteger(ttlSeconds, 'options.ttlSeconds', 1)
      if (ttlSeconds > 3600) {
        throw new StorageValidationError('Reference ttlSeconds cannot exceed 3600.')
      }
      const targetDisplayPath = validateWorkspacePath(options.targetDisplayPath, 'options.targetDisplayPath')
      const targetNormalizedPath = validateWorkspacePath(
        options.targetNormalizedPath ?? targetDisplayPath,
        'options.targetNormalizedPath',
      )
      const locationDisplayPath = validateWorkspacePath(
        options.locationDisplayPath ?? targetDisplayPath,
        'options.locationDisplayPath',
      )
      const defaultLocationNormalizedPath = sameFilesystemPath(locationDisplayPath, targetDisplayPath)
        ? targetNormalizedPath
        : sameFilesystemPath(locationDisplayPath, win32.join(targetDisplayPath, 'workspace'))
          ? win32.join(targetNormalizedPath, 'workspace')
          : locationDisplayPath
      const locationNormalizedPath = validateWorkspacePath(
        options.locationNormalizedPath ?? defaultLocationNormalizedPath,
        'options.locationNormalizedPath',
      )
      const parentDisplayPath = validateWorkspacePath(options.parentDisplayPath, 'options.parentDisplayPath')
      const parentNormalizedPath = validateWorkspacePath(
        options.parentNormalizedPath ?? parentDisplayPath,
        'options.parentNormalizedPath',
      )
      if (!pathIsWithin(parentNormalizedPath, targetNormalizedPath)
        || sameFilesystemPath(parentNormalizedPath, targetNormalizedPath)) {
        throw new StorageValidationError('The create target must be a strict child of the parent directory.', {
          reason: 'target_outside_parent',
        })
      }
      const projectHomeWorkspacePath = win32.join(targetNormalizedPath, 'workspace')
      if (!sameFilesystemPath(locationNormalizedPath, targetNormalizedPath)
        && !sameFilesystemPath(locationNormalizedPath, projectHomeWorkspacePath)) {
        throw new StorageValidationError('The primary location must be the plan target or its fixed workspace child.', {
          reason: 'location_outside_target',
        })
      }
      const issuedAt = requireTimestamp(now(), 'now()')
      const expiresAt = new Date(Date.parse(issuedAt) + (ttlSeconds * 1000)).toISOString()
      return executeWrite(database, () => {
        const plan = selectFileSyncPlan(database, planId)
        if (plan === null) {
          throw new StorageValidationError('The file sync plan does not exist.', {
            reason: 'plan_not_found',
            planId,
          })
        }
        if (plan.kind !== 'create_from_template' && plan.kind !== 'upgrade_managed') {
          throw new StorageValidationError('Only create/upgrade plans can receive plan refs.', {
            reason: 'plan_kind_mismatch',
          })
        }
        if (plan.state !== 'planned' && plan.state !== 'rolled_back') {
          throw new StorageValidationError('The plan is not in an issuable state.', {
            reason: 'plan_not_issuable',
            state: plan.state,
          })
        }
        if (!sameFilesystemPath(plan.targetNormalizedPath, targetNormalizedPath)) {
          throw new StorageValidationError('The ref target no longer matches the plan.', {
            reason: 'plan_target_mismatch',
          })
        }
        const locationRef = plan.kind === 'create_from_template'
          ? createBusinessId(idFactory, 'loc', 'locationRef')
          : null
        const sourceRootRef = createBusinessId(idFactory, 'srt', 'sourceRootRef')
        if (locationRef !== null) {
          database.prepare(`
            INSERT INTO file_sync_plan_refs(
              plan_ref, ref_kind, plan_id, application_instance_id, scope,
              display_path, normalized_path, issued_at, expires_at
            ) VALUES (?, 'location', ?, ?, ?, ?, ?, ?, ?)
          `).run(
            locationRef,
            planId,
            context.applicationInstanceId,
            context.scope,
            locationDisplayPath,
            locationNormalizedPath,
            issuedAt,
            expiresAt,
          )
        }
        database.prepare(`
          INSERT INTO file_sync_plan_refs(
            plan_ref, ref_kind, plan_id, application_instance_id, scope,
            display_path, normalized_path, issued_at, expires_at
          ) VALUES (?, 'source_root', ?, ?, ?, ?, ?, ?, ?)
        `).run(
          sourceRootRef,
          planId,
          context.applicationInstanceId,
          context.scope,
          parentDisplayPath,
          parentNormalizedPath,
          issuedAt,
          expiresAt,
        )
        return Object.freeze({
          planId,
          locationRef,
          sourceRootRef,
          scope: context.scope,
          expiresAt,
        })
      })
    },

    resolveFileSyncPlanRefs(planId, refs, referenceContext) {
      ensureOpen()
      if (!BUSINESS_IDS.pln.test(requireString(planId, 'planId'))) {
        throw referenceResolutionError('plan_shape_invalid')
      }
      requireObject(refs, 'refs')
      if (!BUSINESS_IDS.loc.test(requireString(refs.locationRef, 'refs.locationRef'))
        || !BUSINESS_IDS.srt.test(requireString(refs.sourceRootRef, 'refs.sourceRootRef'))) {
        throw referenceResolutionError('reference_shape_invalid')
      }
      const context = validateReferenceContext(referenceContext)
      const observedAt = requireTimestamp(now(), 'now()')
      const plan = selectFileSyncPlan(database, planId)
      if (plan === null) throw referenceResolutionError('plan_not_found')
      if (plan.kind !== 'create_from_template') throw referenceResolutionError('plan_kind_mismatch')
      const validateRow = (row, expectedKind) => {
        if (!row) throw referenceResolutionError('reference_not_found')
        if (row.applicationInstanceId !== context.applicationInstanceId) {
          throw referenceResolutionError('application_instance_mismatch')
        }
        if (row.scope !== context.scope) throw referenceResolutionError('scope_mismatch')
        if (row.revokedAt !== null) throw referenceResolutionError('reference_revoked')
        if (Date.parse(observedAt) >= Date.parse(row.expiresAt)) {
          throw referenceResolutionError('reference_expired')
        }
        if (row.planId !== planId || row.refKind !== expectedKind) {
          throw referenceResolutionError('reference_plan_mismatch')
        }
        return row
      }
      const locationRow = validateRow(selectPlanRef(database, refs.locationRef), 'location')
      const sourceRootRow = validateRow(selectPlanRef(database, refs.sourceRootRef), 'source_root')
      if (!pathIsWithin(sourceRootRow.normalizedPath, locationRow.normalizedPath)
        || sameFilesystemPath(sourceRootRow.normalizedPath, locationRow.normalizedPath)) {
        throw referenceResolutionError('location_outside_source_root')
      }
      const projectHomeWorkspacePath = win32.join(plan.targetNormalizedPath, 'workspace')
      if (!sameFilesystemPath(plan.targetNormalizedPath, locationRow.normalizedPath)
        && !sameFilesystemPath(projectHomeWorkspacePath, locationRow.normalizedPath)) {
        throw referenceResolutionError('plan_target_mismatch')
      }
      return Object.freeze({
        planId,
        location: {
          locationId: locationRow.planRef,
          kind: 'primary',
          displayPath: locationRow.displayPath,
          normalizedPath: locationRow.normalizedPath,
          verifiedAt: locationRow.issuedAt,
          expiresAt: locationRow.expiresAt,
        },
        sourceRoot: {
          sourceRootId: sourceRootRow.planRef,
          displayPath: sourceRootRow.displayPath,
          normalizedPath: sourceRootRow.normalizedPath,
          expiresAt: sourceRootRow.expiresAt,
        },
      })
    },

    recordDocumentIndex(input) {
      ensureOpen()
      const index = validateDocumentIndexInput(input)
      const recordedAt = requireTimestamp(now(), 'now()')
      const persisted = executeWrite(database, () => {
        const project = database.prepare('SELECT mode FROM projects WHERE project_id = ?')
          .get(index.projectId)
        if (!project) {
          throw new StorageValidationError('The project does not exist.', {
            reason: 'project_not_found',
            projectId: index.projectId,
          })
        }
        for (const proposal of index.rebindProposals) {
          for (const candidatePath of proposal.candidateRelativePaths) {
            const bound = database.prepare(`
              SELECT 1 AS present FROM project_document_bindings
              WHERE project_id = ? AND relative_path = ?
              LIMIT 1
            `).get(index.projectId, candidatePath)
            if (bound) {
              throw new StorageValidationError('A rebind candidate is already a bound document path.', {
                reason: 'binding_conflict',
                candidatePath,
              })
            }
          }
        }
        const upsertState = database.prepare(`
          INSERT INTO project_document_states(
            project_id, role, relative_path, binding_source, state, content_hash,
            byte_size, parse_issues_json, revision, first_seen_at,
            last_verified_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(project_id, role, relative_path) DO UPDATE SET
            binding_source = excluded.binding_source,
            state = excluded.state,
            content_hash = excluded.content_hash,
            byte_size = excluded.byte_size,
            parse_issues_json = excluded.parse_issues_json,
            revision = excluded.revision,
            last_verified_at = excluded.last_verified_at,
            updated_at = excluded.updated_at
        `)
        for (const state of index.documentStates) {
          const prior = database.prepare(`
            SELECT revision, content_hash AS contentHash, state, first_seen_at AS firstSeenAt
            FROM project_document_states
            WHERE project_id = ? AND role = ? AND relative_path = ?
          `).get(index.projectId, state.role, state.relativePath)
          const changed = prior === undefined
            || prior.contentHash !== state.contentHash
            || prior.state !== state.state
          upsertState.run(
            index.projectId,
            state.role,
            state.relativePath,
            state.bindingSource,
            state.state,
            state.contentHash,
            state.byteSize,
            JSON.stringify(state.parseIssues),
            prior === undefined ? 1 : Number(prior.revision) + (changed ? 1 : 0),
            prior === undefined ? recordedAt : prior.firstSeenAt,
            recordedAt,
            recordedAt,
          )
        }

        const incomingKeys = new Set(index.rebindProposals.map((proposal) => (
          `${proposal.role}\u0000${proposal.missingRelativePath}`
        )))
        const existingRows = selectRebindProposalRows(database, index.projectId)
        for (const existing of existingRows) {
          const key = `${existing.role}\u0000${existing.missingRelativePath}`
          if (!incomingKeys.has(key)) {
            if (existing.status === 'proposed') {
              database.prepare(`
                UPDATE project_document_rebind_proposals
                SET status = 'superseded', resolved_at = ?, updated_at = ?,
                  revision = revision + 1
                WHERE proposal_id = ?
              `).run(recordedAt, recordedAt, existing.proposalId)
            }
            continue
          }
          if (existing.status !== 'proposed') {
            // Accepted/rejected resolutions are sticky until the missing path
            // stops being missing (superseded above) or the proposal is
            // explicitly replaced by a new one.
            if (existing.status === 'superseded') {
              database.prepare(`
                DELETE FROM project_document_rebind_proposals WHERE proposal_id = ?
              `).run(existing.proposalId)
            }
          }
        }
        for (const proposal of index.rebindProposals) {
          const key = `${proposal.role}\u0000${proposal.missingRelativePath}`
          const existing = existingRows.find((row) => (
            `${row.role}\u0000${row.missingRelativePath}` === key
          ))
          if (existing !== undefined && existing.status !== 'proposed' && existing.status !== 'superseded') {
            continue
          }
          const candidatesJson = JSON.stringify(proposal.candidateRelativePaths)
          const unambiguous = proposal.candidateRelativePaths.length === 1
          if (existing !== undefined && existing.status === 'proposed') {
            const previousCandidates = JSON.stringify(existing.candidateRelativePaths)
            if (previousCandidates !== candidatesJson) {
              database.prepare(`
                UPDATE project_document_rebind_proposals
                SET candidate_relative_paths_json = ?, candidate_count = ?,
                  unambiguous = ?, revision = revision + 1, updated_at = ?
                WHERE proposal_id = ?
              `).run(
                candidatesJson,
                proposal.candidateRelativePaths.length,
                unambiguous ? 1 : 0,
                recordedAt,
                existing.proposalId,
              )
            }
            continue
          }
          database.prepare(`
            INSERT INTO project_document_rebind_proposals(
              proposal_id, project_id, role, missing_relative_path, content_hash,
              candidate_relative_paths_json, candidate_count, unambiguous,
              status, revision, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'proposed', 1, ?, ?)
          `).run(
            createBusinessId(idFactory, 'rbd', 'proposalId'),
            index.projectId,
            proposal.role,
            proposal.missingRelativePath,
            proposal.contentHash,
            candidatesJson,
            proposal.candidateRelativePaths.length,
            unambiguous ? 1 : 0,
            recordedAt,
            recordedAt,
          )
        }
        return null
      })
      void persisted
      return this.getProjectDocumentIndex(index.projectId)
    },

    getProjectDocumentIndex(projectId) {
      ensureOpen()
      requireString(projectId, 'projectId')
      if (!BUSINESS_IDS.prj.test(projectId)) {
        throw new StorageValidationError('projectId must be a prj_ UUIDv7.')
      }
      const project = database.prepare(`
        SELECT project_id AS projectId, mode, name, revision
        FROM projects WHERE project_id = ?
      `).get(projectId)
      if (!project) {
        throw new StorageValidationError('The project does not exist.', {
          reason: 'project_not_found',
          projectId,
        })
      }
      const location = database.prepare(`
        SELECT display_path AS displayPath
        FROM workspace_locations
        WHERE project_id = ? AND is_active = 1
        ORDER BY kind = 'primary' DESC, location_id
        LIMIT 1
      `).get(projectId)
      const documents = selectDocumentStateRows(database, projectId).map(rowToDocumentState)
      const proposals = selectRebindProposalRows(database, projectId).map((row) => {
        const proposal = rowToRebindProposal(row)
        proposal.applicable = project.mode === 'linked_legacy' && proposal.status === 'proposed'
        return Object.freeze(proposal)
      })
      return Object.freeze({
        projectId,
        mode: project.mode,
        name: project.name,
        revision: Number(project.revision),
        locationDisplayPath: location === undefined ? null : location.displayPath,
        documents: Object.freeze(documents),
        proposals: Object.freeze(proposals),
      })
    },

    resolveDocumentRebindProposal(projectId, proposalId, options) {
      ensureOpen()
      requireString(projectId, 'projectId')
      requireString(proposalId, 'proposalId')
      if (!BUSINESS_IDS.prj.test(projectId) || !BUSINESS_IDS.rbd.test(proposalId)) {
        throw new StorageValidationError('projectId/proposalId must use their prefixed UUIDv7 shapes.')
      }
      requireObject(options, 'options')
      const expectedRevision = requireInteger(options.expectedRevision, 'options.expectedRevision', 1)
      const decision = requireString(options.decision, 'options.decision')
      if (!['accept', 'reject'].includes(decision)) {
        throw new StorageValidationError('options.decision must be accept or reject.')
      }
      const candidateRelativePath = options.candidateRelativePath === undefined
        ? null
        : requireString(options.candidateRelativePath, 'options.candidateRelativePath')
      if (candidateRelativePath !== null && !RELATIVE_PATH.test(candidateRelativePath)) {
        throw new StorageValidationError('options.candidateRelativePath is invalid.')
      }
      const recordedAt = requireTimestamp(now(), 'now()')
      return executeWrite(database, () => {
        const project = database.prepare(`
          SELECT mode, revision FROM projects WHERE project_id = ?
        `).get(projectId)
        if (!project) {
          throw new StorageValidationError('The project does not exist.', {
            reason: 'project_not_found',
            projectId,
          })
        }
        const row = database.prepare(`
          SELECT
            proposal_id AS proposalId, project_id AS projectId, role,
            missing_relative_path AS missingRelativePath, content_hash AS contentHash,
            candidate_relative_paths_json AS candidateRelativePathsJson,
            candidate_count AS candidateCount, unambiguous,
            status, resolved_relative_path AS resolvedRelativePath,
            revision, created_at AS createdAt, updated_at AS updatedAt,
            resolved_at AS resolvedAt
          FROM project_document_rebind_proposals
          WHERE proposal_id = ? AND project_id = ?
        `).get(proposalId, projectId)
        if (!row) {
          throw new StorageValidationError('The rebind proposal does not exist.', {
            reason: 'proposal_not_found',
            proposalId,
          })
        }
        if (row.status !== 'proposed') {
          throw new StorageValidationError('The rebind proposal is no longer open.', {
            reason: 'proposal_not_proposed',
            proposalId,
            status: row.status,
          })
        }
        if (Number(row.revision) !== expectedRevision) {
          throw new StorageValidationError('The rebind proposal changed before resolution.', {
            reason: 'proposal_changed',
            proposalId,
            expectedRevision,
            actualRevision: Number(row.revision),
          })
        }
        if (decision === 'reject') {
          database.prepare(`
            UPDATE project_document_rebind_proposals
            SET status = 'rejected', resolved_at = ?, updated_at = ?,
              revision = revision + 1
            WHERE proposal_id = ?
          `).run(recordedAt, recordedAt, proposalId)
          return {
            proposal: this.getProjectDocumentIndex(projectId).proposals
              .find((proposal) => proposal.proposalId === proposalId),
            projectRevision: Number(project.revision),
          }
        }
        if (project.mode !== 'linked_legacy') {
          throw new StorageValidationError(
            'Managed projects keep the manifest as the authoritative binding source; update the manifest instead of rebinding in the index.',
            {
              reason: 'managed_manifest_authoritative',
              projectId,
              mode: project.mode,
            },
          )
        }
        const candidates = parseJson(row.candidateRelativePathsJson)
        let chosenPath = null
        if (Number(row.unambiguous) === 1) {
          chosenPath = candidates[0]
          if (candidateRelativePath !== null && candidateRelativePath !== chosenPath) {
            throw new StorageValidationError('The requested candidate does not match the unambiguous proposal.', {
              reason: 'proposal_candidate_mismatch',
              proposalId,
            })
          }
        } else {
          if (candidateRelativePath === null) {
            throw new StorageValidationError('Ambiguous rebind proposals require an explicit candidate path.', {
              reason: 'proposal_candidate_required',
              proposalId,
              candidateCount: candidates.length,
            })
          }
          if (!candidates.includes(candidateRelativePath)) {
            throw new StorageValidationError('The requested candidate is not part of the proposal.', {
              reason: 'proposal_candidate_invalid',
              proposalId,
            })
          }
          chosenPath = candidateRelativePath
        }
        const oldBinding = database.prepare(`
          SELECT is_required AS isRequired, source
          FROM project_document_bindings
          WHERE project_id = ? AND role = ? AND relative_path = ?
        `).get(projectId, row.role, row.missingRelativePath)
        if (!oldBinding) {
          throw new StorageValidationError('The missing binding no longer exists.', {
            reason: 'binding_not_found',
            projectId,
          })
        }
        const conflicting = database.prepare(`
          SELECT 1 AS present FROM project_document_bindings
          WHERE project_id = ? AND role = ? AND relative_path = ?
          LIMIT 1
        `).get(projectId, row.role, chosenPath)
        if (conflicting) {
          throw new StorageValidationError('The rebind target is already bound.', {
            reason: 'binding_conflict',
            projectId,
            chosenPath,
          })
        }
        database.prepare(`
          DELETE FROM project_document_bindings
          WHERE project_id = ? AND role = ? AND relative_path = ?
        `).run(projectId, row.role, row.missingRelativePath)
        database.prepare(`
          INSERT INTO project_document_bindings(
            project_id, role, relative_path, content_hash, is_required,
            source, confirmed_at, revision
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)
        `).run(
          projectId,
          row.role,
          chosenPath,
          row.contentHash,
          Number(oldBinding.isRequired),
          oldBinding.source,
          recordedAt,
        )
        database.prepare(`
          UPDATE project_document_rebind_proposals
          SET status = 'accepted', resolved_relative_path = ?, resolved_at = ?,
            updated_at = ?, revision = revision + 1
          WHERE proposal_id = ?
        `).run(chosenPath, recordedAt, recordedAt, proposalId)
        const updated = database.prepare(`
          UPDATE projects
          SET revision = revision + 1, updated_at = ?
          WHERE project_id = ?
          RETURNING revision
        `).get(recordedAt, projectId)
        return {
          proposal: this.getProjectDocumentIndex(projectId).proposals
            .find((proposal) => proposal.proposalId === proposalId),
          projectRevision: Number(updated.revision),
        }
      })
    },




    handshakeHostInstance(input) {
      ensureOpen()
      requireObject(input, 'input')
      const instanceId = requireString(input.instanceId, 'input.instanceId')
      if (!INSTANCE_ID_PATTERN.test(instanceId)) {
        throw new StorageValidationError('input.instanceId is invalid.')
      }
      const appVersion = requireBoundedString(input.appVersion, 'input.appVersion', 64)
      if (!Array.isArray(input.protocolVersions) || input.protocolVersions.length < 1 || input.protocolVersions.length > 50
        || input.protocolVersions.some((version) => typeof version !== 'string' || version.length < 1 || version.length > 127)) {
        throw new StorageValidationError('input.protocolVersions must be an array of 1..50 strings.')
      }
      if (!Array.isArray(input.capabilities) || input.capabilities.length > 100
        || input.capabilities.some((capability) => typeof capability !== 'string' || capability.length < 1 || capability.length > 127)) {
        throw new StorageValidationError('input.capabilities must be an array of at most 100 strings.')
      }
      const recordedAt = requireTimestamp(now(), 'now()')
      executeWrite(database, () => {
        const existing = database.prepare('SELECT revision, started_at AS startedAt FROM host_instances WHERE instance_id = ?').get(instanceId)
        if (existing) {
          database.prepare(`
            UPDATE host_instances
            SET app_version = ?, protocol_versions_json = ?, capabilities_json = ?,
              heartbeat_at = ?, revision = revision + 1, updated_at = ?
            WHERE instance_id = ?
          `).run(appVersion, JSON.stringify(input.protocolVersions), JSON.stringify(input.capabilities), recordedAt, recordedAt, instanceId)
        } else {
          database.prepare(`
            INSERT INTO host_instances(
              instance_id, app_version, protocol_versions_json, capabilities_json,
              heartbeat_at, started_at, revision, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
          `).run(instanceId, appVersion, JSON.stringify(input.protocolVersions), JSON.stringify(input.capabilities), recordedAt, recordedAt, recordedAt, recordedAt)
        }
      })
      const row = database.prepare(`
        SELECT instance_id AS instanceId, app_version AS appVersion,
          protocol_versions_json AS protocolVersionsJson,
          capabilities_json AS capabilitiesJson,
          heartbeat_at AS heartbeatAt, started_at AS startedAt,
          revision, created_at AS createdAt, updated_at AS updatedAt
        FROM host_instances WHERE instance_id = ?
      `).get(instanceId)
      return Object.freeze({
        instanceId: row.instanceId,
        appVersion: row.appVersion,
        protocolVersions: parseJson(row.protocolVersionsJson),
        capabilities: parseJson(row.capabilitiesJson),
        heartbeatAt: row.heartbeatAt,
        startedAt: row.startedAt,
        revision: Number(row.revision),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })
    },

    createWorkItem(projectId, input) {
      ensureOpen()
      requireString(projectId, 'projectId')
      if (!BUSINESS_IDS.prj.test(projectId)) throw new StorageValidationError('projectId must be a prj_ UUIDv7.')
      requireObject(input, 'input')
      const title = requireBoundedString(input.title, 'input.title', 500)
      const instruction = input.instruction === undefined ? null : requireBoundedString(input.instruction, 'input.instruction', 20000)
      const acceptance = validateTextList(input.acceptance ?? ['已完成并通过验收'], 'input.acceptance')
      const executionStatus = input.executionStatus ?? 'draft'
      if (!['draft', 'ready', 'running', 'paused', 'blocked', 'completed', 'cancelled'].includes(executionStatus)) {
        throw new StorageValidationError('input.executionStatus is not supported.')
      }
      const reviewStatus = input.reviewStatus ?? 'not_requested'
      if (!['not_requested', 'pending', 'changes_requested', 'approved', 'rejected'].includes(reviewStatus)) {
        throw new StorageValidationError('input.reviewStatus is not supported.')
      }
      const priority = input.priority === undefined ? 50 : requireInteger(input.priority, 'input.priority', 0)
      if (priority > 100) throw new StorageValidationError('input.priority cannot exceed 100.')
      const recordedAt = requireTimestamp(now(), 'now()')
      const workItemId = createBusinessId(idFactory, 'wrk', 'workItemId')
      executeWrite(database, () => {
        const project = database.prepare('SELECT 1 AS present FROM projects WHERE project_id = ?').get(projectId)
        if (!project) throw new StorageValidationError('The project does not exist.', { reason: 'project_not_found' })
        database.prepare(`
          INSERT INTO work_items(
            work_item_id, project_id, title, instruction, acceptance_json,
            execution_status, review_status, priority, revision, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        `).run(workItemId, projectId, title, instruction, JSON.stringify(acceptance), executionStatus, reviewStatus, priority, recordedAt, recordedAt)
        recordConsoleEvent({
          projectId,
          aggregateType: 'work_item',
          aggregateId: workItemId,
          beforeRevision: 0,
          afterRevision: 1,
          eventType: 'workitem.created',
          data: { title, executionStatus, reviewStatus, priority },
          recordedAt,
        })
      })
      return this.getWorkItem(workItemId)
    },

    createRun(projectId, workItemId, input) {
      ensureOpen()
      requireString(projectId, 'projectId')
      requireString(workItemId, 'workItemId')
      if (!BUSINESS_IDS.prj.test(projectId) || !BUSINESS_IDS.wrk.test(workItemId)) {
        throw new StorageValidationError('projectId/workItemId must use their prefixed UUIDv7 shapes.')
      }
      requireObject(input ?? {}, 'input')
      input = input ?? {}
      const recordedAt = requireTimestamp(now(), 'now()')
      const runId = createBusinessId(idFactory, 'run', 'runId')
      executeWrite(database, () => {
        const workItem = database.prepare(`
          SELECT instruction, acceptance_json AS acceptanceJson FROM work_items
          WHERE work_item_id = ? AND project_id = ?
        `).get(workItemId, projectId)
        if (!workItem) {
          throw new StorageValidationError('The work item does not exist in this project.', { reason: 'work_item_not_found' })
        }
        const attemptNo = input.attemptNo === undefined
          ? Number(database.prepare('SELECT COALESCE(MAX(attempt_no), 0) AS maximum FROM runs WHERE work_item_id = ?').get(workItemId).maximum) + 1
          : requireInteger(input.attemptNo, 'input.attemptNo', 1)
        const instructionSnapshot = input.instructionSnapshot ?? workItem.instruction ?? ''
        const acceptanceSnapshot = input.acceptanceSnapshot ?? parseJson(workItem.acceptanceJson)
        database.prepare(`
          INSERT INTO runs(
            run_id, project_id, work_item_id, attempt_no, status,
            instruction_snapshot_json, acceptance_snapshot_json,
            revision, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 'queued', ?, ?, 1, ?, ?)
        `).run(runId, projectId, workItemId, attemptNo, JSON.stringify(instructionSnapshot), JSON.stringify(acceptanceSnapshot), recordedAt, recordedAt)
        recordConsoleEvent({
          projectId,
          aggregateType: 'run',
          aggregateId: runId,
          beforeRevision: 0,
          afterRevision: 1,
          eventType: 'run.created',
          data: { workItemId, attemptNo, status: 'queued' },
          recordedAt,
        })
      })
      return this.getRun(runId)
    },

    bindAgentThread(projectId, runId, input) {
      ensureOpen()
      requireString(projectId, 'projectId')
      requireString(runId, 'runId')
      if (!BUSINESS_IDS.prj.test(projectId) || !BUSINESS_IDS.run.test(runId)) {
        throw new StorageValidationError('projectId/runId must use their prefixed UUIDv7 shapes.')
      }
      requireObject(input, 'input')
      const harnessInstanceRef = requireBoundedString(input.harnessInstanceRef, 'input.harnessInstanceRef', 127)
      const sessionId = requireBoundedString(input.sessionId, 'input.sessionId', 200)
      const threadId = requireString(input.threadId, 'input.threadId')
      if (!THREAD_ID_PATTERN.test(threadId)) throw new StorageValidationError('input.threadId is invalid.')
      const recordedAt = requireTimestamp(now(), 'now()')
      const bindingId = createBusinessId(idFactory, 'atb', 'bindingId')
      executeWrite(database, () => {
        const run = database.prepare('SELECT 1 AS present FROM runs WHERE run_id = ? AND project_id = ?').get(runId, projectId)
        if (!run) throw new StorageValidationError('The run does not exist in this project.', { reason: 'run_not_found' })
        const instance = database.prepare('SELECT 1 AS present FROM host_instances WHERE instance_id = ?').get(harnessInstanceRef)
        if (!instance) {
          throw new StorageValidationError('The Harness instance has not completed a capability handshake.', { reason: 'instance_not_handshaken' })
        }
        const conflict = database.prepare('SELECT 1 AS present FROM agent_thread_bindings WHERE run_id = ? AND thread_id = ?').get(runId, threadId)
        if (conflict) {
          throw new StorageValidationError('The thread is already bound to this run.', { reason: 'thread_binding_conflict' })
        }
        database.prepare(`
          INSERT INTO agent_thread_bindings(
            binding_id, project_id, run_id, harness_instance_ref, session_id, thread_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(bindingId, projectId, runId, harnessInstanceRef, sessionId, threadId, recordedAt)
      })
      const row = database.prepare(`
        SELECT binding_id AS bindingId, project_id AS projectId, run_id AS runId,
          harness_instance_ref AS harnessInstanceRef, session_id AS sessionId,
          thread_id AS threadId, created_at AS createdAt
        FROM agent_thread_bindings WHERE binding_id = ?
      `).get(bindingId)
      return Object.freeze({
        bindingId: row.bindingId,
        projectId: row.projectId,
        runId: row.runId,
        harnessInstanceRef: row.harnessInstanceRef,
        sessionId: row.sessionId,
        threadId: row.threadId,
        createdAt: row.createdAt,
      })
    },

    applyExternalUpdate(command) {
      ensureOpen()
      const envelope = validateExternalUpdateCommand(command)
      const identity = commandIdentity(command)
      return executeWrite(database, () => {
        const replay = replayOrThrow(findExistingReceipt(database, identity), identity)
        if (replay) return replay

        const instance = database.prepare('SELECT app_version AS appVersion FROM host_instances WHERE instance_id = ?')
          .get(envelope.provenance.applicationInstanceId)
        if (!instance) {
          return rejectExternalUpdate(command, identity, 'CAPABILITY_NOT_NEGOTIATED', 'The producer has not completed a capability handshake with this Host.')
        }
        if (instance.appVersion !== envelope.provenance.applicationVersion) {
          return rejectExternalUpdate(command, identity, 'CAPABILITY_NOT_NEGOTIATED', 'The producer applicationVersion does not match the handshake record.')
        }

        const target = envelope.target
        let currentRevision = null
        if (target.aggregateType === 'work_item') {
          const row = database.prepare(`
            SELECT revision FROM work_items WHERE work_item_id = ? AND project_id = ?
          `).get(target.aggregateId, target.projectId)
          if (!row) return rejectExternalUpdate(command, identity, 'REFERENCE_UNRESOLVED', 'The target work item does not exist in this project.')
          currentRevision = Number(row.revision)
        } else {
          const row = database.prepare(`
            SELECT revision FROM runs
            WHERE run_id = ? AND project_id = ? AND work_item_id = ?
          `).get(target.aggregateId, target.projectId, target.workItemId)
          if (!row) return rejectExternalUpdate(command, identity, 'REFERENCE_UNRESOLVED', 'The target run does not exist for this work item and project.')
          currentRevision = Number(row.revision)
        }
        if (currentRevision !== envelope.expectedRevision) {
          return rejectExternalUpdate(command, identity, 'REVISION_CONFLICT', 'The target aggregate revision changed before this update.', currentRevision)
        }
        const binding = database.prepare(`
          SELECT 1 AS present FROM agent_thread_bindings
          WHERE run_id = ? AND thread_id = ?
        `).get(target.runId, target.threadId)
        if (!binding) {
          return rejectExternalUpdate(command, identity, 'REFERENCE_UNRESOLVED', 'The session thread is not bound to the target run.')
        }

        const recordedAt = now()
        const afterRevision = currentRevision + 1
        const nextStatus = envelope.kind === 'blocker.raise'
          ? 'blocked'
          : envelope.kind === 'completion.declare'
            ? target.aggregateType === 'run' ? 'completed' : 'needs_review'
            : null
        if (target.aggregateType === 'work_item') {
          if (nextStatus === null) {
            database.prepare(`
              UPDATE work_items SET updated_at = ?, revision = revision + 1
              WHERE work_item_id = ? AND project_id = ?
            `).run(recordedAt, target.aggregateId, target.projectId)
          } else if (envelope.kind === 'completion.declare') {
            database.prepare(`
              UPDATE work_items
              SET execution_status = 'completed', review_status = 'pending',
                updated_at = ?, revision = revision + 1
              WHERE work_item_id = ? AND project_id = ?
            `).run(recordedAt, target.aggregateId, target.projectId)
          } else {
            database.prepare(`
              UPDATE work_items
              SET execution_status = 'blocked', updated_at = ?, revision = revision + 1
              WHERE work_item_id = ? AND project_id = ?
            `).run(recordedAt, target.aggregateId, target.projectId)
          }
        } else if (nextStatus === null) {
          database.prepare(`
            UPDATE runs SET updated_at = ?, revision = revision + 1
            WHERE run_id = ? AND project_id = ?
          `).run(recordedAt, target.aggregateId, target.projectId)
        } else {
          database.prepare(`
            UPDATE runs SET status = ?, updated_at = ?, revision = revision + 1
            WHERE run_id = ? AND project_id = ?
          `).run(nextStatus, recordedAt, target.aggregateId, target.projectId)
        }

        const kindColumn = {
          'progress.report': 'progress',
          'blocker.raise': 'blocker',
          'completion.declare': 'completion_declared',
        }[envelope.kind]
        database.prepare(`
          INSERT INTO progress_updates(
            progress_update_id, project_id, work_item_id, run_id, kind,
            summary, needs_json, acceptance_claims_json, evidence_json,
            completion_percent, details, thread_id, command_id,
            aggregate_type, aggregate_id, aggregate_revision,
            generated_by_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          createBusinessId(idFactory, 'upd', 'progressUpdateId'),
          target.projectId,
          target.workItemId,
          target.runId,
          kindColumn,
          envelope.payload.summary,
          kindColumn === 'blocker' ? JSON.stringify(envelope.payload.needs) : '[]',
          kindColumn === 'completion_declared' ? JSON.stringify(envelope.payload.acceptanceClaims) : '[]',
          JSON.stringify(envelope.payload.evidence ?? []),
          envelope.payload.completionPercent ?? null,
          envelope.payload.details ?? null,
          target.threadId,
          envelope.commandId,
          target.aggregateType,
          target.aggregateId,
          afterRevision,
          JSON.stringify({
            applicationId: envelope.actor.applicationId,
            applicationVersion: envelope.provenance.applicationVersion,
            applicationInstanceId: envelope.provenance.applicationInstanceId,
            rendererVersion: 'project-control-host/v1alpha1',
          }),
          recordedAt,
        )

        const sequence = nextSequence(database)
        const eventId = idFactory('evt')
        const outboxId = idFactory('out')
        const event = {
          protocolVersion: PROTOCOL_VERSION,
          schemaVersion: EXTERNAL_EVENT_SCHEMA_VERSION,
          eventId,
          eventType: EXTERNAL_EVENT_TYPES[envelope.kind],
          occurredAt: envelope.occurredAt,
          recordedAt,
          sequence,
          actor: envelope.actor,
          target: envelope.target,
          beforeRevision: currentRevision,
          afterRevision,
          causation: {
            commandId: envelope.commandId,
            idempotencyKey: envelope.idempotencyKey,
            correlationId: envelope.correlationId,
          },
          provenance: envelope.provenance,
          data: envelope.payload,
        }
        const result = {
          protocolVersion: PROTOCOL_VERSION,
          schemaVersion: EXTERNAL_RESULT_SCHEMA_VERSION,
          commandId: envelope.commandId,
          correlationId: envelope.correlationId,
          kind: envelope.kind,
          status: 'accepted',
          recordedAt,
          aggregateType: target.aggregateType,
          aggregateId: target.aggregateId,
          aggregateRevision: afterRevision,
          eventId,
        }
        insertReceipt(database, command, identity, 'accepted', recordedAt, result, null)
        insertEvent(database, event, command, target.aggregateType, target.aggregateId)
        insertOutbox(database, outboxId, event, recordedAt)
        return Object.freeze(result)
      })
    },


    getWorkItem(workItemId) {
      ensureOpen()
      requireString(workItemId, 'workItemId')
      if (!BUSINESS_IDS.wrk.test(workItemId)) throw new StorageValidationError('workItemId must be a wrk_ UUIDv7.')
      return selectWorkItem(database, workItemId)
    },

    listWorkItems({ projectId = null, limit = 100, afterWorkItemId = '' } = {}) {
      ensureOpen()
      requireInteger(limit, 'limit', 1)
      if (limit > 500) throw new StorageValidationError('limit cannot exceed 500.')
      if (projectId !== null) requireString(projectId, 'projectId')
      if (afterWorkItemId !== '') requireString(afterWorkItemId, 'afterWorkItemId')
      return database.prepare(`
        SELECT work_item_id AS workItemId FROM work_items
        WHERE work_item_id > ? AND (? IS NULL OR project_id = ?)
        ORDER BY work_item_id LIMIT ?
      `).all(afterWorkItemId, projectId, projectId, limit)
        .map((row) => selectWorkItem(database, row.workItemId))
    },

    getRun(runId) {
      ensureOpen()
      requireString(runId, 'runId')
      if (!BUSINESS_IDS.run.test(runId)) throw new StorageValidationError('runId must be a run_ UUIDv7.')
      return selectRun(database, runId)
    },

    listRuns({ projectId = null, workItemId = null, limit = 100, afterRunId = '' } = {}) {
      ensureOpen()
      requireInteger(limit, 'limit', 1)
      if (limit > 500) throw new StorageValidationError('limit cannot exceed 500.')
      if (projectId !== null) requireString(projectId, 'projectId')
      if (workItemId !== null) requireString(workItemId, 'workItemId')
      if (afterRunId !== '') requireString(afterRunId, 'afterRunId')
      return database.prepare(`
        SELECT run_id AS runId FROM runs
        WHERE run_id > ?
          AND (? IS NULL OR project_id = ?)
          AND (? IS NULL OR work_item_id = ?)
        ORDER BY run_id LIMIT ?
      `).all(afterRunId, projectId, projectId, workItemId, workItemId, limit)
        .map((row) => selectRun(database, row.runId))
    },

    listProgressUpdates({ projectId = null, workItemId = null, runId = null, limit = 100, afterProgressUpdateId = '' } = {}) {
      ensureOpen()
      requireInteger(limit, 'limit', 1)
      if (limit > 500) throw new StorageValidationError('limit cannot exceed 500.')
      if (projectId !== null) requireString(projectId, 'projectId')
      if (workItemId !== null) requireString(workItemId, 'workItemId')
      if (runId !== null) requireString(runId, 'runId')
      if (afterProgressUpdateId !== '') requireString(afterProgressUpdateId, 'afterProgressUpdateId')
      return database.prepare(`
        SELECT ${PROGRESS_UPDATE_COLUMNS}
        FROM progress_updates
        WHERE progress_update_id > ?
          AND (? IS NULL OR project_id = ?)
          AND (? IS NULL OR work_item_id = ?)
          AND (? IS NULL OR run_id = ?)
        ORDER BY progress_update_id LIMIT ?
      `).all(afterProgressUpdateId, projectId, projectId, workItemId, workItemId, runId, runId, limit)
        .map((row) => Object.freeze(mapProgressUpdateRow(row)))
    },

    getProgressUpdateByCommandId(commandId) {
      ensureOpen()
      requireString(commandId, 'commandId')
      const row = database.prepare(`
        SELECT ${PROGRESS_UPDATE_COLUMNS}
        FROM progress_updates WHERE command_id = ?
        ORDER BY created_at, progress_update_id LIMIT 1
      `).get(commandId)
      return row ? Object.freeze(mapProgressUpdateRow(row)) : null
    },

    recordQuarantineItem(input) {
      ensureOpen()
      requireObject(input, 'input')
      const quarantineId = createBusinessId(idFactory, 'qtn', 'quarantineId')
      const recordedAt = requireTimestamp(now(), 'now()')
      const projectId = input.projectId === undefined || input.projectId === null
        ? null
        : requireString(input.projectId, 'input.projectId')
      if (projectId !== null && !BUSINESS_IDS.prj.test(projectId)) {
        throw new StorageValidationError('input.projectId must be a prj_ UUIDv7.')
      }
      const details = input.details ?? {}
      requireObject(details, 'input.details')
      executeWrite(database, () => {
        database.prepare(`
          INSERT INTO quarantine_items(
            quarantine_id, project_id, source_kind, source_ref, reason_code,
            payload_ref, status, details_json, revision, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, 1, ?, ?)
        `).run(
          quarantineId,
          projectId,
          requireBoundedString(input.sourceKind, 'input.sourceKind', 100),
          requireBoundedString(input.sourceRef, 'input.sourceRef', 512),
          requireBoundedString(input.reasonCode, 'input.reasonCode', 100),
          input.payloadRef === undefined ? null : requireBoundedString(input.payloadRef, 'input.payloadRef', 512),
          JSON.stringify(details),
          recordedAt,
          recordedAt,
        )
      })
      return selectQuarantineItem(database, quarantineId)
    },

    listQuarantineItems({ projectId = null, status = null, limit = 100, afterQuarantineId = '' } = {}) {
      ensureOpen()
      requireInteger(limit, 'limit', 1)
      if (limit > 500) throw new StorageValidationError('limit cannot exceed 500.')
      if (projectId !== null) requireString(projectId, 'projectId')
      if (status !== null && !['open', 'resolved', 'ignored'].includes(status)) {
        throw new StorageValidationError('status must be open, resolved or ignored.')
      }
      if (afterQuarantineId !== '') requireString(afterQuarantineId, 'afterQuarantineId')
      return database.prepare(`
        SELECT quarantine_id AS quarantineId FROM quarantine_items
        WHERE quarantine_id > ?
          AND (? IS NULL OR project_id = ?)
          AND (? IS NULL OR status = ?)
        ORDER BY quarantine_id LIMIT ?
      `).all(afterQuarantineId, projectId, projectId, status, status, limit)
        .map((row) => selectQuarantineItem(database, row.quarantineId))
    },

    resolveQuarantineItem(quarantineId, options) {
      ensureOpen()
      requireString(quarantineId, 'quarantineId')
      if (!BUSINESS_IDS.qtn.test(quarantineId)) throw new StorageValidationError('quarantineId must be a qtn_ UUIDv7.')
      requireObject(options, 'options')
      const expectedRevision = requireInteger(options.expectedRevision, 'options.expectedRevision', 1)
      const decision = requireString(options.decision, 'options.decision')
      if (!['resolved', 'ignored'].includes(decision)) {
        throw new StorageValidationError('options.decision must be resolved or ignored.')
      }
      const recordedAt = requireTimestamp(now(), 'now()')
      executeWrite(database, () => {
        const current = database.prepare('SELECT revision, status FROM quarantine_items WHERE quarantine_id = ?').get(quarantineId)
        if (!current) throw new StorageValidationError('The quarantine item does not exist.', { reason: 'quarantine_not_found' })
        if (Number(current.revision) !== expectedRevision) {
          throw new StorageValidationError('The quarantine item changed before resolution.', { reason: 'quarantine_changed' })
        }
        if (current.status !== 'open') {
          throw new StorageValidationError('The quarantine item is no longer open.', { reason: 'quarantine_not_open' })
        }
        database.prepare(`
          UPDATE quarantine_items
          SET status = ?, resolved_at = ?, updated_at = ?, revision = revision + 1
          WHERE quarantine_id = ? AND revision = ?
        `).run(decision, recordedAt, recordedAt, quarantineId, expectedRevision)
      })
      return selectQuarantineItem(database, quarantineId)
    },

    listReviews({ projectId = null, limit = 100 } = {}) {
      ensureOpen()
      requireInteger(limit, 'limit', 1)
      if (limit > 500) throw new StorageValidationError('limit cannot exceed 500.')
      if (projectId !== null) requireString(projectId, 'projectId')
      return database.prepare(`
        SELECT ${REVIEW_COLUMNS}
        FROM reviews
        WHERE (? IS NULL OR project_id = ?)
        ORDER BY review_id LIMIT ?
      `).all(projectId, projectId, limit).map((row) => Object.freeze(mapReviewRow(row)))
    },

    getReview(reviewId) {
      ensureOpen()
      requireString(reviewId, 'reviewId')
      if (!BUSINESS_IDS.rev.test(reviewId)) throw new StorageValidationError('reviewId must be a rev_ UUIDv7.')
      return selectReview(database, reviewId)
    },

    listThreadBindings({ projectId = null, limit = 100, afterBindingId = '' } = {}) {
      ensureOpen()
      requireInteger(limit, 'limit', 1)
      if (limit > 500) throw new StorageValidationError('limit cannot exceed 500.')
      if (projectId !== null) requireString(projectId, 'projectId')
      if (afterBindingId !== '') requireString(afterBindingId, 'afterBindingId')
      return database.prepare(`
        SELECT
          binding_id AS bindingId, project_id AS projectId, run_id AS runId,
          harness_instance_ref AS harnessInstanceRef, session_id AS sessionId,
          thread_id AS threadId, created_at AS createdAt
        FROM agent_thread_bindings
        WHERE binding_id > ? AND (? IS NULL OR project_id = ?)
        ORDER BY created_at, binding_id LIMIT ?
      `).all(afterBindingId, projectId, projectId, limit).map((row) => Object.freeze({
        bindingId: row.bindingId,
        projectId: row.projectId,
        runId: row.runId,
        harnessInstanceRef: row.harnessInstanceRef,
        sessionId: row.sessionId,
        threadId: row.threadId,
        createdAt: row.createdAt,
      }))
    },

    listReviewActions(reviewId, { afterReviewActionId = '', limit = 100 } = {}) {
      ensureOpen()
      requireString(reviewId, 'reviewId')
      if (!BUSINESS_IDS.rev.test(reviewId)) throw new StorageValidationError('reviewId must be a rev_ UUIDv7.')
      requireInteger(limit, 'limit', 1)
      if (limit > 500) throw new StorageValidationError('limit cannot exceed 500.')
      if (afterReviewActionId !== '') requireString(afterReviewActionId, 'afterReviewActionId')
      return database.prepare(`
        SELECT
          review_action_id AS reviewActionId, review_id AS reviewId,
          action, actor_ref AS actorRef, comment, created_at AS createdAt
        FROM review_actions
        WHERE review_id = ? AND review_action_id > ?
        ORDER BY created_at, review_action_id LIMIT ?
      `).all(reviewId, afterReviewActionId, limit).map((row) => Object.freeze(mapReviewActionRow(row)))
    },

    listDecisions({ projectId = null, limit = 100 } = {}) {
      ensureOpen()
      requireInteger(limit, 'limit', 1)
      if (limit > 500) throw new StorageValidationError('limit cannot exceed 500.')
      if (projectId !== null) requireString(projectId, 'projectId')
      return database.prepare(`
        SELECT
          decision_id AS decisionId, project_id AS projectId, work_item_id AS workItemId,
          title, context, options_json AS optionsJson, status, rationale,
          proposed_by_json AS proposedByJson, decided_by_json AS decidedByJson,
          revision, created_at AS createdAt, updated_at AS updatedAt, decided_at AS decidedAt
        FROM decisions
        WHERE (? IS NULL OR project_id = ?)
        ORDER BY decision_id LIMIT ?
      `).all(projectId, projectId, limit).map((row) => Object.freeze({
        decisionId: row.decisionId,
        projectId: row.projectId,
        workItemId: row.workItemId,
        title: row.title,
        context: row.context,
        options: parseJson(row.optionsJson),
        status: row.status,
        rationale: row.rationale,
        proposedBy: parseJson(row.proposedByJson),
        decidedBy: row.decidedByJson === null ? null : parseJson(row.decidedByJson),
        revision: Number(row.revision),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        decidedAt: row.decidedAt,
      }))
    },

    setWorkItemStatus(projectId, workItemId, input) {
      ensureOpen()
      requireString(projectId, 'projectId')
      requireString(workItemId, 'workItemId')
      if (!BUSINESS_IDS.prj.test(projectId) || !BUSINESS_IDS.wrk.test(workItemId)) {
        throw new StorageValidationError('projectId/workItemId must use their prefixed UUIDv7 shapes.')
      }
      requireObject(input, 'input')
      const expectedRevision = requireInteger(input.expectedRevision, 'input.expectedRevision', 1)
      const status = requireString(input.status, 'input.status')
      if (!WORK_ITEM_STATUSES.has(status)) {
        throw new StorageValidationError('input.status is not supported.')
      }
      const transitions = {
        draft: new Set(['ready', 'cancelled']),
        ready: new Set(['running', 'cancelled']),
        running: new Set(['paused', 'cancelled']),
        paused: new Set(['ready', 'running', 'cancelled']),
        blocked: new Set(['ready', 'cancelled']),
      }
      const recordedAt = requireTimestamp(now(), 'now()')
      return executeWrite(database, () => {
        const row = database.prepare(`
          SELECT execution_status AS executionStatus, revision
          FROM work_items WHERE work_item_id = ? AND project_id = ?
        `).get(workItemId, projectId)
        if (!row) {
          throw new StorageValidationError('The work item does not exist in this project.', { reason: 'work_item_not_found' })
        }
        if (Number(row.revision) !== expectedRevision) {
          throw new StorageValidationError('The work item changed before this update.', { reason: 'revision_conflict' })
        }
        const allowed = transitions[row.executionStatus]
        if (allowed === undefined || !allowed.has(status)) {
          throw new StorageValidationError('The work item status transition is not allowed.', { reason: 'transition_not_allowed' })
        }
        database.prepare(`
          UPDATE work_items SET execution_status = ?, updated_at = ?, revision = revision + 1
          WHERE work_item_id = ? AND project_id = ?
        `).run(status, recordedAt, workItemId, projectId)
        recordConsoleEvent({
          projectId,
          aggregateType: 'work_item',
          aggregateId: workItemId,
          beforeRevision: expectedRevision,
          afterRevision: expectedRevision + 1,
          eventType: 'workitem.status_changed',
          data: { from: row.executionStatus, to: status },
          recordedAt,
        })
        return this.getWorkItem(workItemId)
      })
    },

    startRun(projectId, runId, input) {
      ensureOpen()
      requireString(projectId, 'projectId')
      requireString(runId, 'runId')
      if (!BUSINESS_IDS.prj.test(projectId) || !BUSINESS_IDS.run.test(runId)) {
        throw new StorageValidationError('projectId/runId must use their prefixed UUIDv7 shapes.')
      }
      requireObject(input, 'input')
      const expectedRevision = requireInteger(input.expectedRevision, 'input.expectedRevision', 1)
      const recordedAt = requireTimestamp(now(), 'now()')
      return executeWrite(database, () => {
        const run = database.prepare(`
          SELECT work_item_id AS workItemId, status, revision
          FROM runs WHERE run_id = ? AND project_id = ?
        `).get(runId, projectId)
        if (!run) {
          throw new StorageValidationError('The run does not exist in this project.', { reason: 'run_not_found' })
        }
        if (Number(run.revision) !== expectedRevision) {
          throw new StorageValidationError('The run changed before this update.', { reason: 'revision_conflict' })
        }
        if (run.status !== 'queued') {
          throw new StorageValidationError('Only queued runs can be started.', { reason: 'transition_not_allowed' })
        }
        database.prepare(`
          UPDATE runs SET status = 'running', started_at = ?, updated_at = ?, revision = revision + 1
          WHERE run_id = ? AND project_id = ?
        `).run(recordedAt, recordedAt, runId, projectId)
        const workItem = database.prepare(`
          SELECT execution_status AS executionStatus, revision
          FROM work_items WHERE work_item_id = ? AND project_id = ?
        `).get(run.workItemId, projectId)
        if (!workItem) {
          throw new StorageValidationError('The run work item does not exist.', { reason: 'work_item_not_found' })
        }
        if (workItem.executionStatus !== 'running'
          && workItem.executionStatus !== 'completed'
          && workItem.executionStatus !== 'cancelled') {
          database.prepare(`
            UPDATE work_items SET execution_status = 'running', updated_at = ?, revision = revision + 1
            WHERE work_item_id = ? AND project_id = ?
          `).run(recordedAt, run.workItemId, projectId)
        }
        recordConsoleEvent({
          projectId,
          aggregateType: 'run',
          aggregateId: runId,
          beforeRevision: expectedRevision,
          afterRevision: expectedRevision + 1,
          eventType: 'run.started',
          data: { workItemId: run.workItemId },
          recordedAt,
        })
        return this.getRun(runId)
      })
    },

    requestReview(projectId, workItemId, input) {
      ensureOpen()
      requireString(projectId, 'projectId')
      requireString(workItemId, 'workItemId')
      if (!BUSINESS_IDS.prj.test(projectId) || !BUSINESS_IDS.wrk.test(workItemId)) {
        throw new StorageValidationError('projectId/workItemId must use their prefixed UUIDv7 shapes.')
      }
      requireObject(input, 'input')
      const expectedRevision = requireInteger(input.expectedRevision, 'input.expectedRevision', 1)
      const risk = input.risk === undefined || input.risk === null ? 'unrated' : requireString(input.risk, 'input.risk')
      if (!REVIEW_RISKS.has(risk)) throw new StorageValidationError('input.risk is not supported.')
      const recordedAt = requireTimestamp(now(), 'now()')
      const reviewId = createBusinessId(idFactory, 'rev', 'reviewId')
      return executeWrite(database, () => {
        const row = database.prepare(`
          SELECT review_status AS reviewStatus, revision
          FROM work_items WHERE work_item_id = ? AND project_id = ?
        `).get(workItemId, projectId)
        if (!row) {
          throw new StorageValidationError('The work item does not exist in this project.', { reason: 'work_item_not_found' })
        }
        if (Number(row.revision) !== expectedRevision) {
          throw new StorageValidationError('The work item changed before this request.', { reason: 'revision_conflict' })
        }
        if (!['not_requested', 'changes_requested', 'rejected'].includes(row.reviewStatus)) {
          throw new StorageValidationError('The work item review state does not allow a new request.', { reason: 'review_state_conflict' })
        }
        const openReview = database.prepare(`
          SELECT 1 AS present FROM reviews
          WHERE work_item_id = ? AND status IN ('requested', 'in_review')
        `).get(workItemId)
        if (openReview) {
          throw new StorageValidationError('The work item already has an open review.', { reason: 'review_open' })
        }
        database.prepare(`
          UPDATE work_items SET review_status = 'pending', updated_at = ?, revision = revision + 1
          WHERE work_item_id = ? AND project_id = ?
        `).run(recordedAt, workItemId, projectId)
        database.prepare(`
          INSERT INTO reviews(
            review_id, project_id, work_item_id, reviewed_work_item_revision,
            artifact_refs_json, status, risk, requested_by_json, decided_by_json,
            revision, created_at, updated_at, decided_at
          ) VALUES (?, ?, ?, ?, '[]', 'requested', ?, ?, NULL, 1, ?, ?, NULL)
        `).run(reviewId, projectId, workItemId, expectedRevision + 1, risk, canonicalJson(CONSOLE_ACTOR), recordedAt, recordedAt)
        recordConsoleEvent({
          projectId,
          aggregateType: 'work_item',
          aggregateId: workItemId,
          beforeRevision: expectedRevision,
          afterRevision: expectedRevision + 1,
          eventType: 'review.requested',
          data: { reviewId, risk, reviewedWorkItemRevision: expectedRevision + 1 },
          recordedAt,
        })
        return this.getReview(reviewId)
      })
    },

    decideReview(projectId, reviewId, input) {
      ensureOpen()
      requireString(projectId, 'projectId')
      requireString(reviewId, 'reviewId')
      if (!BUSINESS_IDS.prj.test(projectId) || !BUSINESS_IDS.rev.test(reviewId)) {
        throw new StorageValidationError('projectId/reviewId must use their prefixed UUIDv7 shapes.')
      }
      requireObject(input, 'input')
      const expectedRevision = requireInteger(input.expectedRevision, 'input.expectedRevision', 1)
      const decision = requireString(input.decision, 'input.decision')
      if (!['approve', 'reject', 'request_changes'].includes(decision)) {
        throw new StorageValidationError('input.decision is not supported.')
      }
      const rationale = input.rationale === undefined || input.rationale === null
        ? null
        : requireBoundedString(input.rationale, 'input.rationale', 4000)
      const recordedAt = requireTimestamp(now(), 'now()')
      const reviewActionId = createBusinessId(idFactory, 'rva', 'reviewActionId')
      return executeWrite(database, () => {
        const review = database.prepare(`
          SELECT work_item_id AS workItemId, status, revision
          FROM reviews WHERE review_id = ? AND project_id = ?
        `).get(reviewId, projectId)
        if (!review) {
          throw new StorageValidationError('The review does not exist in this project.', { reason: 'review_not_found' })
        }
        if (Number(review.revision) !== expectedRevision) {
          throw new StorageValidationError('The review changed before this decision.', { reason: 'revision_conflict' })
        }
        if (!['requested', 'in_review'].includes(review.status)) {
          throw new StorageValidationError('The review is no longer open.', { reason: 'review_not_open' })
        }
        const workItem = database.prepare(`
          SELECT review_status AS reviewStatus, revision
          FROM work_items WHERE work_item_id = ? AND project_id = ?
        `).get(review.workItemId, projectId)
        if (!workItem) {
          throw new StorageValidationError('The review work item does not exist.', { reason: 'work_item_not_found' })
        }
        const action = decision === 'approve' ? 'approve' : decision === 'reject' ? 'reject' : 'request_changes'
        const eventType = decision === 'approve' ? 'review.approved' : decision === 'reject' ? 'review.rejected' : 'review.changes_requested'
        const reviewStatus = decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'changes_requested'
        // request_changes closes the review as rejected-with-feedback so a fixed
        // work item can open a fresh review instead of stacking open reviews.
        const reviewRowStatus = decision === 'approve' ? 'approved' : 'rejected'
        database.prepare(`
          UPDATE reviews
          SET status = ?, decided_by_json = ?, decided_at = ?, updated_at = ?, revision = revision + 1
          WHERE review_id = ? AND project_id = ?
        `).run(reviewRowStatus, canonicalJson(CONSOLE_ACTOR), recordedAt, recordedAt, reviewId, projectId)
        database.prepare(`
          UPDATE work_items SET review_status = ?, updated_at = ?, revision = revision + 1
          WHERE work_item_id = ? AND project_id = ?
        `).run(reviewStatus, recordedAt, review.workItemId, projectId)
        database.prepare(`
          INSERT INTO review_actions(review_action_id, review_id, action, actor_ref, comment, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(reviewActionId, reviewId, action, canonicalJson(CONSOLE_ACTOR), rationale, recordedAt)
        recordConsoleEvent({
          projectId,
          aggregateType: 'work_item',
          aggregateId: review.workItemId,
          beforeRevision: Number(workItem.revision),
          afterRevision: Number(workItem.revision) + 1,
          eventType,
          data: { reviewId, decision, rationale },
          recordedAt,
        })
        return this.getReview(reviewId)
      })
    },

    commentReview(projectId, reviewId, input) {
      ensureOpen()
      requireString(projectId, 'projectId')
      requireString(reviewId, 'reviewId')
      if (!BUSINESS_IDS.prj.test(projectId) || !BUSINESS_IDS.rev.test(reviewId)) {
        throw new StorageValidationError('projectId/reviewId must use their prefixed UUIDv7 shapes.')
      }
      requireObject(input, 'input')
      const comment = requireBoundedString(input.comment, 'input.comment', 4000)
      const recordedAt = requireTimestamp(now(), 'now()')
      const reviewActionId = createBusinessId(idFactory, 'rva', 'reviewActionId')
      return executeWrite(database, () => {
        const review = database.prepare('SELECT 1 AS present FROM reviews WHERE review_id = ? AND project_id = ?').get(reviewId, projectId)
        if (!review) {
          throw new StorageValidationError('The review does not exist in this project.', { reason: 'review_not_found' })
        }
        database.prepare(`
          INSERT INTO review_actions(review_action_id, review_id, action, actor_ref, comment, created_at)
          VALUES (?, ?, 'comment', ?, ?, ?)
        `).run(reviewActionId, reviewId, canonicalJson(CONSOLE_ACTOR), comment, recordedAt)
        const row = database.prepare(`
          SELECT
            review_action_id AS reviewActionId, review_id AS reviewId,
            action, actor_ref AS actorRef, comment, created_at AS createdAt
          FROM review_actions WHERE review_action_id = ?
        `).get(reviewActionId)
        return Object.freeze(mapReviewActionRow(row))
      })
    },

    close() {
      if (closed) return
      let failure = null
      try {
        storage.status()
      } catch (error) {
        failure = error
      } finally {
        closed = true
        try {
          database.close()
        } catch (error) {
          failure ??= error
        }
        try {
          writerLock.release()
        } catch (error) {
          failure ??= error
        }
      }
      if (failure) throw failure
    },
  }

  return Object.freeze(storage)
}
