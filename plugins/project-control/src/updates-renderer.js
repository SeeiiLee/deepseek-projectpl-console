// Standard Markdown renderer for accepted external runtime updates
// (PROJECT_PROTOCOL.md section 8). The frontmatter must round-trip through
// the frozen progress-update-frontmatter schema; the body follows the fixed
// section order. This module is pure: it renders only, it never writes files
// and never re-imports rendered output.

const SCHEMA_VERSION = 'progress-update-frontmatter/v1alpha1'
const PROTOCOL_VERSION = 'project-control.dsh/v1alpha1'
const RENDERER_VERSION = 'progress-markdown/v1alpha1'

const CATEGORY_BY_KIND = Object.freeze({
  progress: 'progress',
  blocker: 'blocker',
  completion_declared: 'completion_declared',
})

function yamlScalar(value) {
  // Numbers, booleans and null stay unquoted YAML scalars; strings become
  // double-quoted scalars. This keeps aggregateRevision an integer for the
  // frozen frontmatter schema instead of degrading it to a string.
  return JSON.stringify(value)
}

function yamlMap(lines, indent, entries) {
  const prefix = ' '.repeat(indent)
  for (const [key, value] of entries) {
    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(prefix + key + ': []')
      } else {
        lines.push(prefix + key + ':')
        yamlSequence(lines, indent + 2, value)
      }
    } else if (value !== null && typeof value === 'object') {
      lines.push(prefix + key + ':')
      yamlMap(lines, indent + 2, Object.entries(value))
    } else {
      lines.push(prefix + key + ': ' + yamlScalar(value))
    }
  }
}

function yamlSequence(lines, indent, items) {
  const prefix = ' '.repeat(indent)
  for (const item of items) {
    if (item !== null && typeof item === 'object') {
      lines.push(prefix + '-')
      yamlMap(lines, indent + 2, Object.entries(item))
    } else {
      lines.push(prefix + '- ' + yamlScalar(item))
    }
  }
}

function evidenceEntry(evidence) {
  const entry = { kind: evidence.kind }
  if (evidence.kind === 'workspace_file') {
    entry.workspaceRef = evidence.workspaceRef
    entry.relativePath = evidence.relativePath
  } else {
    entry.ref = evidence.ref
  }
  if (evidence.contentHash !== undefined) entry.contentHash = evidence.contentHash
  // Deliberately dropped: the envelope allows evidence.title, but the frozen
  // progress-update-frontmatter schema does not — round-trips must not carry it.
  return entry
}

/**
 * Render one accepted external update into the frozen standard log format.
 * @param {{
 *   update: {
 *     progressUpdateId: string, projectId: string, workItemId: string | null,
 *     runId: string | null, kind: 'progress' | 'blocker' | 'completion_declared',
 *     summary: string, needs?: string[], acceptanceClaims?: string[],
 *     evidence?: unknown[], completionPercent?: number | null,
 *     details?: string | null, threadId?: string | null,
 *     aggregateRevision: number, commandId: string,
 *   },
 *   eventId: string,
 *   actor: { kind: string, id: string, applicationId: string, displayName?: string },
 *   occurredAt: string,
 *   recordedAt: string,
 *   generatedBy: { applicationId: string, applicationVersion: string, applicationInstanceId: string },
 * }} options
 * @returns {{ frontmatter: Record<string, unknown>, markdown: string, relativePath: string }}
 */
export function renderProgressUpdate(options) {
  const { update, eventId, actor, occurredAt, recordedAt, generatedBy } = options
  const occurred = new Date(occurredAt)
  const stamp = occurred.toISOString().replaceAll(/[-:.]/g, '').slice(0, 15) + 'Z'
  const relativePath = [
    '.dsh-project',
    'updates',
    String(occurred.getUTCFullYear()).padStart(4, '0'),
    String(occurred.getUTCMonth() + 1).padStart(2, '0'),
    stamp + '-' + update.progressUpdateId + '.md',
  ].join('/')
  const frontmatter = {
    protocolVersion: PROTOCOL_VERSION,
    schemaVersion: SCHEMA_VERSION,
    kind: 'ProgressUpdate',
    updateId: update.progressUpdateId,
    category: CATEGORY_BY_KIND[update.kind],
    projectId: update.projectId,
    workItemId: update.workItemId ?? null,
    runId: update.runId ?? null,
    threadId: update.threadId ?? null,
    sourceEventId: eventId,
    commandId: update.commandId,
    aggregateRevision: update.aggregateRevision,
    occurredAt,
    recordedAt,
    actor: {
      kind: actor.kind,
      id: actor.id,
      applicationId: actor.applicationId,
      ...(actor.displayName === undefined ? {} : { displayName: actor.displayName }),
    },
    summary: update.summary,
    evidence: (update.evidence ?? []).map(evidenceEntry),
    generatedBy: {
      applicationId: generatedBy.applicationId,
      applicationVersion: generatedBy.applicationVersion,
      applicationInstanceId: generatedBy.applicationInstanceId,
      rendererVersion: RENDERER_VERSION,
    },
  }

  const bodyLines = [
    '# ' + update.summary,
    '',
    '## 发生了什么',
    update.details && update.details.trim() !== '' ? update.details.trim() : '无',
    '',
    '## 证据',
  ]
  const evidence = update.evidence ?? []
  if (evidence.length === 0) {
    bodyLines.push('无')
  } else {
    for (const item of evidence) {
      const entry = evidenceEntry(item)
      bodyLines.push('- ' + [entry.kind, entry.ref ?? entry.relativePath, entry.contentHash].filter(Boolean).join(' | '))
    }
  }
  bodyLines.push('', '## 下一步')
  if (update.kind === 'blocker') {
    const needs = update.needs ?? []
    bodyLines.push(needs.length === 0 ? '无' : needs.map((need) => '- ' + need).join('\n'))
  } else if (update.kind === 'completion_declared') {
    const claims = update.acceptanceClaims ?? []
    bodyLines.push(claims.length === 0 ? '无' : claims.map((claim) => '- ' + claim).join('\n'))
  } else {
    bodyLines.push('无')
  }
  bodyLines.push('', '## 阻塞与待决定')
  bodyLines.push(update.kind === 'blocker' ? '见上（阻塞中）' : '无')
  bodyLines.push('')

  const frontmatterLines = ['---']
  yamlMap(frontmatterLines, 0, Object.entries(frontmatter))
  frontmatterLines.push('---')
  const markdown = frontmatterLines.join('\n') + '\n' + bodyLines.join('\n')
  return { frontmatter, markdown, relativePath }
}
