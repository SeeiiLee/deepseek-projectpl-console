import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { issueProjectControlSelectionTicket } from '../../../src/project-control-selection-ticket.js'
import { scanProjectDirectory, scanSourceDirectory } from '../src/discovery/runtime.js'
import { openProjectControlStorage, StorageValidationError } from '../src/host/index.js'
import { createProjectControlRequestHandler, PROJECT_CONTROL_API_PREFIX } from '../src/http.ts'
import { createProjectControlIntakeRuntime } from '../src/intake.ts'
import { refreshProjectDocumentIndex } from '../src/document-index.ts'
import { validateLifecycleCommand } from '../src/lifecycle-validator.ts'

const migrationsDirectory = fileURLToPath(new URL('../migrations/', import.meta.url))

function sha256Text(text) {
  return `sha256:${createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex')}`
}

function serialSuffix(serial) {
  return serial.toString(16).padStart(4, '0')
}

async function openStorage(root) {
  return openProjectControlStorage({
    databasePath: join(root, 'project-control.sqlite3'),
    backupDirectory: join(root, 'backups'),
    migrationsDirectory,
    applicationVersion: '0.1.0-test',
    instanceId: `docindex-${Math.random().toString(16).slice(2, 10)}`,
  })
}

function makeCommand({ kind, projectId, serial, extraPayload = {} }) {
  const suffix = serialSuffix(serial)
  return {
    protocolVersion: 'project-control.dsh/v1alpha1',
    schemaVersion: 'lifecycle-command-envelope/v1alpha1',
    commandId: `cmd_0198f4b2-7c3a-7d92-a5c6-6b6f39e3${suffix}`,
    correlationId: `corr.document-index.${serial}`,
    idempotencyKey: `document-index.${kind}.${serial}`,
    kind,
    occurredAt: '2026-08-14T12:00:00.000Z',
    actor: { kind: 'human', id: 'desktop-user', applicationId: 'deepseek-harness-personal' },
    target: { aggregateType: 'project', projectId },
    expectedRevision: 0,
    provenance: { sourceType: 'human', sourceId: 'document-index-test' },
    payload: {
      locationRef: `loc_0198f4b2-7c3a-7d92-a5c6-6b6f39e4${suffix}`,
      sourceRootRef: `srt_0198f4b2-7c3a-7d92-a5c6-6b6f39e5${suffix}`,
      ...extraPayload,
    },
  }
}

function trustedLocation(command, locationPath) {
  return {
    location: {
      locationId: command.payload.locationRef,
      kind: 'primary',
      displayPath: locationPath,
      normalizedPath: locationPath.toLowerCase(),
      verifiedAt: '2026-08-14T12:00:00.000Z',
    },
    eventId: `evt_0198f4b2-7c3a-7d92-a5c6-6b6f39e6${serialSuffix(command.idempotencyKey.length)}`,
    outboxId: `out_0198f4b2-7c3a-7d92-a5c6-6b6f39e7${serialSuffix(command.idempotencyKey.length)}`,
  }
}

function registerLegacy(storage, { projectId, locationPath, name, bindings, serial }) {
  const command = makeCommand({
    kind: 'project.registerLegacy',
    projectId,
    serial,
    extraPayload: { name, documentBindings: bindings },
  })
  const result = storage.registerProject(command, trustedLocation(command, locationPath))
  assert.equal(result.status, 'accepted')
  return command
}

function registerManaged(storage, { projectId, locationPath, name, manifestHash, bindings, serial }) {
  const command = makeCommand({
    kind: 'project.registerManaged',
    projectId,
    serial,
    extraPayload: { manifestHash },
  })
  const result = storage.registerProject(command, {
    ...trustedLocation(command, locationPath),
    manifestName: name,
    manifestHash,
    manifestDocumentBindings: bindings,
    origin: { kind: 'imported' },
  })
  assert.equal(result.status, 'accepted')
  return command
}

function stateRow({ role, relativePath, bindingSource, state, contentHash, byteSize = null, parseIssues = [] }) {
  return { role, relativePath, bindingSource, state, contentHash, byteSize, parseIssues }
}

function proposalRow({ role, missingRelativePath, contentHash, candidateRelativePaths }) {
  return { role, missingRelativePath, contentHash, candidateRelativePaths }
}

test('document index states persist revisions, stable facts, and reject invalid input', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-project-control-docindex-'))
  const projectRoot = join(root, 'Project-1')
  await mkdir(projectRoot, { recursive: true })
  const storage = await openStorage(root)
  t.after(async () => {
    storage.close()
    await rm(root, { recursive: true, force: true })
  })

  const hashA = sha256Text('alpha body')
  const projectId = 'prj_0198f4b2-7c3a-7d92-a5c6-6b6f39e21111'
  registerLegacy(storage, {
    projectId,
    locationPath: projectRoot,
    name: 'Indexed Project',
    bindings: [{ role: 'readme', relativePath: 'README.md', contentHash: hashA, required: true }],
    serial: 1,
  })

  const first = storage.recordDocumentIndex({
    projectId,
    documentStates: [stateRow({
      role: 'readme', relativePath: 'README.md', bindingSource: 'user_confirmed',
      state: 'ok', contentHash: hashA, byteSize: 11,
    })],
    rebindProposals: [],
  })
  assert.equal(first.mode, 'linked_legacy')
  assert.equal(first.documents.length, 1)
  assert.equal(first.documents[0].revision, 1)
  assert.equal(first.documents[0].state, 'ok')
  assert.equal(typeof first.documents[0].firstSeenAt, 'string')

  const unchanged = storage.recordDocumentIndex({
    projectId,
    documentStates: [stateRow({
      role: 'readme', relativePath: 'README.md', bindingSource: 'user_confirmed',
      state: 'ok', contentHash: hashA, byteSize: 11,
    })],
    rebindProposals: [],
  })
  assert.equal(unchanged.documents[0].revision, 1, 'stable hash must not bump the revision')

  const changed = storage.recordDocumentIndex({
    projectId,
    documentStates: [stateRow({
      role: 'readme', relativePath: 'README.md', bindingSource: 'user_confirmed',
      state: 'changed', contentHash: sha256Text('alpha body v2'), byteSize: 13,
    })],
    rebindProposals: [],
  })
  assert.equal(changed.documents[0].revision, 2)

  const expected = (error, reason) => error instanceof StorageValidationError
    && error.details?.reason === reason
  await assert.rejects(
    async () => storage.recordDocumentIndex({
      projectId,
      documentStates: [stateRow({
        role: 'readme', relativePath: 'README.md', bindingSource: 'user_confirmed',
        state: 'ok', contentHash: null, byteSize: 11,
      })],
      rebindProposals: [],
    }),
    error => error instanceof StorageValidationError,
  )
  await assert.rejects(
    async () => storage.recordDocumentIndex({
      projectId,
      documentStates: [stateRow({
        role: 'readme', relativePath: 'README.md', bindingSource: 'user_confirmed',
        state: 'missing', contentHash: hashA, byteSize: null,
      })],
      rebindProposals: [],
    }),
    error => error instanceof StorageValidationError,
  )
  await assert.rejects(
    async () => storage.recordDocumentIndex({
      projectId,
      documentStates: [
        stateRow({ role: 'readme', relativePath: 'README.md', bindingSource: 'user_confirmed', state: 'ok', contentHash: hashA, byteSize: 1 }),
        stateRow({ role: 'readme', relativePath: 'README.md', bindingSource: 'user_confirmed', state: 'ok', contentHash: hashA, byteSize: 1 }),
      ],
      rebindProposals: [],
    }),
    error => error instanceof StorageValidationError,
  )
  await assert.rejects(
    async () => storage.recordDocumentIndex({
      projectId: 'prj_0198f4b2-7c3a-7d92-a5c6-6b6f39e29999',
      documentStates: [],
      rebindProposals: [],
    }),
    error => expected(error, 'project_not_found'),
  )
  await assert.rejects(
    async () => storage.recordDocumentIndex({
      projectId,
      documentStates: [],
      rebindProposals: [proposalRow({
        role: 'readme', missingRelativePath: 'README.md', contentHash: hashA,
        candidateRelativePaths: ['README.md'],
      })],
    }),
    error => error instanceof StorageValidationError,
  )
  await assert.rejects(
    async () => storage.recordDocumentIndex({
      projectId,
      documentStates: [],
      rebindProposals: [proposalRow({
        role: 'readme', missingRelativePath: 'old/README.md', contentHash: hashA,
        candidateRelativePaths: ['README.md'],
      })],
    }),
    error => expected(error, 'binding_conflict'),
  )
})

test('legacy rebind proposals accept and reject with sticky resolutions and revision bumps', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-project-control-docrebind-'))
  const projectRoot = join(root, 'Project-2')
  await mkdir(join(projectRoot, 'docs'), { recursive: true })
  const storage = await openStorage(root)
  t.after(async () => {
    storage.close()
    await rm(root, { recursive: true, force: true })
  })

  const hashA = sha256Text('readme body')
  const hashD = sha256Text('devlog body')
  const projectId = 'prj_0198f4b2-7c3a-7d92-a5c6-6b6f39e22222'
  registerLegacy(storage, {
    projectId,
    locationPath: projectRoot,
    name: 'Rebind Project',
    bindings: [
      { role: 'readme', relativePath: 'README.md', contentHash: hashA, required: true },
      { role: 'devlog', relativePath: 'docs/DEVLOG.md', contentHash: hashD, required: false },
    ],
    serial: 2,
  })
  const baselineRevision = storage.getProject(projectId).revision

  storage.recordDocumentIndex({
    projectId,
    documentStates: [
      stateRow({ role: 'readme', relativePath: 'README.md', bindingSource: 'user_confirmed', state: 'ok', contentHash: hashA, byteSize: 12 }),
      stateRow({ role: 'devlog', relativePath: 'docs/DEVLOG.md', bindingSource: 'user_confirmed', state: 'missing', contentHash: null, byteSize: null }),
    ],
    rebindProposals: [proposalRow({
      role: 'devlog', missingRelativePath: 'docs/DEVLOG.md', contentHash: hashD,
      candidateRelativePaths: ['docs/HISTORY.md'],
    })],
  })
  let view = storage.getProjectDocumentIndex(projectId)
  assert.equal(view.proposals.length, 1)
  assert.equal(view.proposals[0].status, 'proposed')
  assert.equal(view.proposals[0].unambiguous, true)
  assert.equal(view.proposals[0].applicable, true)

  await assert.rejects(
    async () => storage.resolveDocumentRebindProposal(projectId, view.proposals[0].proposalId, {
      expectedRevision: 99,
      decision: 'accept',
    }),
    error => error instanceof StorageValidationError && error.details?.reason === 'proposal_changed',
  )
  const accepted = storage.resolveDocumentRebindProposal(projectId, view.proposals[0].proposalId, {
    expectedRevision: view.proposals[0].revision,
    decision: 'accept',
  })
  assert.equal(accepted.proposal.status, 'accepted')
  assert.equal(accepted.proposal.resolvedRelativePath, 'docs/HISTORY.md')
  assert.equal(accepted.projectRevision, baselineRevision + 1)

  const project = storage.getProject(projectId)
  assert.equal(project.revision, accepted.projectRevision)
  const devlogBindings = project.documentBindings.filter(binding => binding.role === 'devlog')
  assert.deepEqual(devlogBindings.map(binding => binding.relativePath), ['docs/HISTORY.md'])
  assert.equal(devlogBindings[0].contentHash, hashD)
  assert.equal(devlogBindings[0].required, false)
  assert.equal(devlogBindings[0].source, 'user_confirmed')

  // The accepted resolution is sticky history: a later refresh keeps it instead
  // of resurrecting a proposed row.
  storage.recordDocumentIndex({
    projectId,
    documentStates: [
      stateRow({ role: 'readme', relativePath: 'README.md', bindingSource: 'user_confirmed', state: 'missing', contentHash: null, byteSize: null }),
      stateRow({ role: 'devlog', relativePath: 'docs/HISTORY.md', bindingSource: 'user_confirmed', state: 'ok', contentHash: hashD, byteSize: 11 }),
    ],
    rebindProposals: [],
  })
  view = storage.getProjectDocumentIndex(projectId)
  const acceptedRows = view.proposals.filter(proposal => proposal.status === 'accepted')
  assert.equal(acceptedRows.length, 1)
  assert.equal(acceptedRows[0].resolvedRelativePath, 'docs/HISTORY.md')

  // Rejection is equally sticky and does not touch the project revision.
  storage.recordDocumentIndex({
    projectId,
    documentStates: [
      stateRow({ role: 'readme', relativePath: 'README.md', bindingSource: 'user_confirmed', state: 'missing', contentHash: null, byteSize: null }),
      stateRow({ role: 'devlog', relativePath: 'docs/HISTORY.md', bindingSource: 'user_confirmed', state: 'ok', contentHash: hashD, byteSize: 11 }),
    ],
    rebindProposals: [proposalRow({
      role: 'readme', missingRelativePath: 'README.md', contentHash: hashA,
      candidateRelativePaths: ['README-copy.md'],
    })],
  })
  view = storage.getProjectDocumentIndex(projectId)
  const readmeProposal = view.proposals.find(proposal => proposal.role === 'readme' && proposal.status === 'proposed')
  const revisionBeforeReject = storage.getProject(projectId).revision
  const rejected = storage.resolveDocumentRebindProposal(projectId, readmeProposal.proposalId, {
    expectedRevision: readmeProposal.revision,
    decision: 'reject',
  })
  assert.equal(rejected.proposal.status, 'rejected')
  assert.equal(rejected.projectRevision, revisionBeforeReject)
  assert.equal(
    storage.getProject(projectId).documentBindings.some(binding => binding.role === 'readme' && binding.relativePath === 'README.md'),
    true,
  )
  storage.recordDocumentIndex({
    projectId,
    documentStates: [
      stateRow({ role: 'readme', relativePath: 'README.md', bindingSource: 'user_confirmed', state: 'missing', contentHash: null, byteSize: null }),
      stateRow({ role: 'devlog', relativePath: 'docs/HISTORY.md', bindingSource: 'user_confirmed', state: 'ok', contentHash: hashD, byteSize: 11 }),
    ],
    rebindProposals: [proposalRow({
      role: 'readme', missingRelativePath: 'README.md', contentHash: hashA,
      candidateRelativePaths: ['README-copy.md'],
    })],
  })
  view = storage.getProjectDocumentIndex(projectId)
  assert.equal(
    view.proposals.filter(proposal => proposal.role === 'readme' && proposal.status === 'proposed').length,
    0,
    'rejected proposal must stay rejected across refreshes',
  )
})

test('ambiguous proposals require an explicit candidate and managed projects keep the manifest authoritative', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-project-control-docambiguous-'))
  const legacyRoot = join(root, 'Project-3')
  const managedRoot = join(root, 'Project-4')
  await mkdir(join(legacyRoot, 'docs'), { recursive: true })
  await mkdir(join(managedRoot, 'docs'), { recursive: true })
  const storage = await openStorage(root)
  t.after(async () => {
    storage.close()
    await rm(root, { recursive: true, force: true })
  })

  const hashN = sha256Text('next body')
  const legacyProjectId = 'prj_0198f4b2-7c3a-7d92-a5c6-6b6f39e23333'
  registerLegacy(storage, {
    projectId: legacyProjectId,
    locationPath: legacyRoot,
    name: 'Ambiguous Project',
    bindings: [{ role: 'next', relativePath: 'docs/NEXT.md', contentHash: hashN, required: false }],
    serial: 3,
  })
  storage.recordDocumentIndex({
    projectId: legacyProjectId,
    documentStates: [stateRow({
      role: 'next', relativePath: 'docs/NEXT.md', bindingSource: 'user_confirmed',
      state: 'missing', contentHash: null, byteSize: null,
    })],
    rebindProposals: [proposalRow({
      role: 'next', missingRelativePath: 'docs/NEXT.md', contentHash: hashN,
      candidateRelativePaths: ['docs/NEXT-2.md', 'backup/NEXT.md'],
    })],
  })
  let view = storage.getProjectDocumentIndex(legacyProjectId)
  const ambiguous = view.proposals[0]
  assert.equal(ambiguous.unambiguous, false)
  assert.equal(ambiguous.candidateCount, 2)
  await assert.rejects(
    async () => storage.resolveDocumentRebindProposal(legacyProjectId, ambiguous.proposalId, {
      expectedRevision: ambiguous.revision,
      decision: 'accept',
    }),
    error => error instanceof StorageValidationError && error.details?.reason === 'proposal_candidate_required',
  )
  await assert.rejects(
    async () => storage.resolveDocumentRebindProposal(legacyProjectId, ambiguous.proposalId, {
      expectedRevision: ambiguous.revision,
      decision: 'accept',
      candidateRelativePath: 'docs/OTHER.md',
    }),
    error => error instanceof StorageValidationError && error.details?.reason === 'proposal_candidate_invalid',
  )
  const resolved = storage.resolveDocumentRebindProposal(legacyProjectId, ambiguous.proposalId, {
    expectedRevision: ambiguous.revision,
    decision: 'accept',
    candidateRelativePath: 'docs/NEXT-2.md',
  })
  assert.equal(resolved.proposal.resolvedRelativePath, 'docs/NEXT-2.md')

  const hashP = sha256Text('prd body')
  const managedProjectId = 'prj_0198f4b2-7c3a-7d92-a5c6-6b6f39e24444'
  registerManaged(storage, {
    projectId: managedProjectId,
    locationPath: managedRoot,
    name: 'Managed Project',
    manifestHash: sha256Text('manifest body'),
    bindings: [{ role: 'prd', relativePath: 'docs/PRD.md', contentHash: null, required: false, source: 'manifest' }],
    serial: 4,
  })
  storage.recordDocumentIndex({
    projectId: managedProjectId,
    documentStates: [stateRow({
      role: 'prd', relativePath: 'docs/PRD.md', bindingSource: 'manifest',
      state: 'missing', contentHash: null, byteSize: null,
    })],
    rebindProposals: [proposalRow({
      role: 'prd', missingRelativePath: 'docs/PRD.md', contentHash: hashP,
      candidateRelativePaths: ['docs/PRD-2.md'],
    })],
  })
  view = storage.getProjectDocumentIndex(managedProjectId)
  assert.equal(view.mode, 'managed')
  assert.equal(view.proposals[0].applicable, false)
  await assert.rejects(
    async () => storage.resolveDocumentRebindProposal(managedProjectId, view.proposals[0].proposalId, {
      expectedRevision: view.proposals[0].revision,
      decision: 'accept',
    }),
    error => error instanceof StorageValidationError
      && error.details?.reason === 'managed_manifest_authoritative',
  )
  const managedReject = storage.resolveDocumentRebindProposal(managedProjectId, view.proposals[0].proposalId, {
    expectedRevision: view.proposals[0].revision,
    decision: 'reject',
  })
  assert.equal(managedReject.proposal.status, 'rejected')
})

test('refresh pipeline verifies hashes, proposes renames, and records parse diagnostics without storing content', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-project-control-docrefresh-'))
  const projectRoot = join(root, 'Project-5')
  await mkdir(join(projectRoot, 'docs'), { recursive: true })
  const storage = await openStorage(root)
  t.after(async () => {
    storage.close()
    await rm(root, { recursive: true, force: true })
  })

  const bodyA = '# PRD\n\n## Goal\nShip the alpha.\n'
  const bodyB = '# Devlog\n\n2026-08-15: stable launch confirmed.\n'
  const bodyD = '# Next\n\n- [ ] P5 documents.\n'
  const marker = 'X9QZ-UNIQUE-DOC-BODY-731'
  const bodyReadme = `# Readme\n\n${marker}\n`
  await writeFile(join(projectRoot, 'docs', 'PRD.md'), bodyA)
  await writeFile(join(projectRoot, 'docs', 'DEVLOG.md'), bodyB)
  await writeFile(join(projectRoot, 'README.md'), bodyReadme)
  const hashA = sha256Text(bodyA)
  const hashB = sha256Text(bodyB)
  const hashD = sha256Text(bodyD)
  const hashReadme = sha256Text(bodyReadme)

  const projectId = 'prj_0198f4b2-7c3a-7d92-a5c6-6b6f39e25555'
  registerLegacy(storage, {
    projectId,
    locationPath: projectRoot,
    name: 'Refresh Project',
    bindings: [
      { role: 'readme', relativePath: 'README.md', contentHash: hashReadme, required: true },
      { role: 'prd', relativePath: 'docs/PRD.md', contentHash: hashA, required: true },
      { role: 'devlog', relativePath: 'docs/DEVLOG.md', contentHash: hashB, required: false },
      { role: 'next', relativePath: 'docs/NEXT.md', contentHash: hashD, required: false },
    ],
    serial: 5,
  })

  const eventsBefore = storage.listEvents().length
  const outboxBefore = storage.listOutbox().length
  const project = storage.getProject(projectId)
  let payload = await refreshProjectDocumentIndex(storage, project)
  let view = storage.recordDocumentIndex(payload)
  assert.equal(view.documents.filter(document => document.state === 'ok').length, 3)
  assert.equal(view.documents.find(document => document.role === 'next').state, 'missing')
  assert.equal(view.proposals.length, 0)
  assert.equal(storage.listEvents().length, eventsBefore, 'refresh must not emit domain events')
  assert.equal(storage.listOutbox().length, outboxBefore, 'refresh must not enqueue outbox messages')

  // Rename detection: the missing doc reappears under a new name with the same content.
  await writeFile(join(projectRoot, 'docs', 'NEXT-renamed.md'), bodyD)
  payload = await refreshProjectDocumentIndex(storage, storage.getProject(projectId))
  view = storage.recordDocumentIndex(payload)
  let nextProposal = view.proposals.find(proposal => proposal.role === 'next' && proposal.status === 'proposed')
  assert.ok(nextProposal)
  assert.deepEqual(nextProposal.candidateRelativePaths, ['docs/NEXT-renamed.md'])
  assert.equal(nextProposal.unambiguous, true)

  // A second identical copy makes the proposal ambiguous.
  await mkdir(join(projectRoot, 'backup'), { recursive: true })
  await writeFile(join(projectRoot, 'backup', 'NEXT.md'), bodyD)
  payload = await refreshProjectDocumentIndex(storage, storage.getProject(projectId))
  view = storage.recordDocumentIndex(payload)
  nextProposal = view.proposals.find(proposal => proposal.role === 'next' && proposal.status === 'proposed')
  assert.equal(nextProposal.candidateCount, 2)
  assert.equal(nextProposal.unambiguous, false)

  // Restoring the original path supersedes the proposal and the doc returns to ok.
  await rm(join(projectRoot, 'docs', 'NEXT-renamed.md'))
  await rm(join(projectRoot, 'backup'), { recursive: true, force: true })
  await writeFile(join(projectRoot, 'docs', 'NEXT.md'), bodyD)
  payload = await refreshProjectDocumentIndex(storage, storage.getProject(projectId))
  view = storage.recordDocumentIndex(payload)
  assert.equal(view.documents.find(document => document.role === 'next').state, 'ok')
  assert.equal(view.proposals.filter(proposal => proposal.status === 'proposed').length, 0)
  assert.equal(view.proposals.some(proposal => proposal.status === 'superseded'), true)

  // Content changes surface as changed states with a bumped revision.
  const bodyA2 = `${bodyA}## Notes\nRevised.\n`
  await writeFile(join(projectRoot, 'docs', 'PRD.md'), bodyA2)
  payload = await refreshProjectDocumentIndex(storage, storage.getProject(projectId))
  view = storage.recordDocumentIndex(payload)
  const prdState = view.documents.find(document => document.role === 'prd')
  assert.equal(prdState.state, 'changed')
  assert.equal(prdState.revision, 2)

  // Unterminated frontmatter becomes a bounded parse diagnostic.
  await writeFile(join(projectRoot, 'docs', 'DEVLOG.md'), '---\nname: devlog\n# Body\n')
  payload = await refreshProjectDocumentIndex(storage, storage.getProject(projectId))
  view = storage.recordDocumentIndex(payload)
  const unterminated = view.documents.find(document => document.role === 'devlog')
  assert.equal(unterminated.parseIssues.some(issue => issue.code === 'FRONTMATTER_UNTERMINATED'), true)

  // Invalid frontmatter YAML becomes a bounded parse diagnostic too.
  await writeFile(join(projectRoot, 'docs', 'DEVLOG.md'), '---\n1bad-key: value\n---\n# Body\n')
  payload = await refreshProjectDocumentIndex(storage, storage.getProject(projectId))
  view = storage.recordDocumentIndex(payload)
  const broken = view.documents.find(document => document.role === 'devlog')
  assert.equal(broken.parseIssues.some(issue => issue.code === 'FRONTMATTER_PARSE_FAILED'), true)

  // Index rows never carry document content.
  for (const document of view.documents) {
    const keys = Object.keys(document)
    for (const forbidden of ['content', 'contents', 'body', 'preview', 'text']) {
      assert.equal(keys.includes(forbidden), false)
    }
  }
  const serialized = JSON.stringify(view)
  assert.equal(serialized.includes(marker), false)
  assert.equal(serialized.includes('Ship the alpha'), false)
  storage.close()
  const databaseBytes = readFileSync(join(root, 'project-control.sqlite3'))
  assert.equal(databaseBytes.includes(marker), false, 'document content must not reach the global database')
})

test('HTTP document index endpoints refresh, resolve, and expose bounded errors', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-project-control-dochttp-'))
  const projectRoot = join(root, 'Project-6')
  await mkdir(join(projectRoot, 'docs'), { recursive: true })
  await writeFile(join(projectRoot, 'README.md'), '# Readme\n')
  await writeFile(join(projectRoot, 'docs', 'PRD.md'), '# PRD\n')
  const storage = await openStorage(root)
  t.after(async () => {
    storage.close()
    await rm(root, { recursive: true, force: true })
  })

  const secret = 'document-index-http-selection-secret-long'
  const runtime = createProjectControlIntakeRuntime({
    storage,
    scanner: { scanProjectDirectory, scanSourceDirectory },
    selectionSecret: secret,
    applicationInstanceId: 'host-docindex-http',
    applicationVersion: '0.1.0-test',
  })
  const authorization = issueProjectControlSelectionTicket({ kind: 'project-root', path: projectRoot, secret })
  const scan = await runtime.intake.scan({
    mode: 'project-root',
    selection: { path: projectRoot, authorization },
  })
  const candidate = scan.candidates[0]
  const readmeHash = (await readFile(join(projectRoot, 'README.md'))).toString('utf8')
  const prdHash = (await readFile(join(projectRoot, 'docs', 'PRD.md'))).toString('utf8')
  const command = await runtime.intake.prepareCandidate(candidate.candidateId, {
    registrationMode: 'linked_legacy',
    name: 'HTTP Project',
    expectedRevision: candidate.revision,
    documentBindings: [
      { role: 'readme', relativePath: 'README.md', contentHash: sha256Text(readmeHash) },
      { role: 'prd', relativePath: 'docs/PRD.md', contentHash: sha256Text(prdHash) },
    ],
  })
  assert.equal(validateLifecycleCommand(command).ok, true)
  const origin = await serveRuntime(t, storage, runtime)
  const lifecycle = await postJson(origin, '/lifecycle', command)
  assert.equal(lifecycle.status, 'accepted')
  const projectId = lifecycle.projectId

  const status = await getJson(origin, '/status')
  assert.equal(status.capabilities.includes('project.documents.read'), true)
  assert.equal(status.capabilities.includes('project.documents.refresh'), true)
  assert.equal(status.capabilities.includes('project.document-rebind.resolve'), true)
  assert.equal(status.capabilities.includes('project.document-bindings.accept-current'), true)

  const empty = await getJson(origin, `/projects/${projectId}/documents`)
  assert.equal(empty.projectId, projectId)
  assert.equal(empty.documents.length, 0)

  const refreshed = await postJson(origin, `/projects/${projectId}/documents/refresh`, undefined)
  assert.equal(refreshed.documents.filter(document => document.state === 'ok').length, 2)
  assert.equal(refreshed.proposals.length, 0)

  const beforeUpgrade = await postJson(origin, `/intake/projects/${projectId}/prepare-upgrade`, {
    expectedRevision: 1,
  })
  const revisedReadme = '# Readme\n\nAccepted authority merge.\n'
  const revisedPrd = '# PRD\n\nAccepted authority merge.\n'
  const revisedReadmeHash = sha256Text(revisedReadme)
  const revisedPrdHash = sha256Text(revisedPrd)
  await writeFile(join(projectRoot, 'README.md'), revisedReadme)
  await writeFile(join(projectRoot, 'docs', 'PRD.md'), revisedPrd)
  const changed = await postJson(origin, `/projects/${projectId}/documents/refresh`, undefined)
  assert.equal(changed.documents.find(document => document.role === 'readme').state, 'changed')
  assert.equal(changed.documents.find(document => document.role === 'prd').state, 'changed')

  await postJson(origin, `/projects/${projectId}/document-bindings/accept-current`, {
    expectedRevision: 1,
    bindings: [{
      role: 'prd',
      relativePath: 'docs/PRD.md',
      expectedContentHash: sha256Text(prdHash),
      currentContentHash: revisedPrdHash,
    }],
  }, { expectError: 'DOCUMENT_BINDING_SET_CHANGED' })
  assert.equal(storage.getProject(projectId).revision, 1)

  await postJson(origin, `/projects/${projectId}/document-bindings/accept-current`, {
    expectedRevision: 1,
    bindings: [
      {
        role: 'readme',
        relativePath: 'README.md',
        expectedContentHash: sha256Text(readmeHash),
        currentContentHash: revisedReadmeHash,
      },
      {
        role: 'prd',
        relativePath: 'docs/PRD.md',
        expectedContentHash: sha256Text(prdHash),
        currentContentHash: `sha256:${'0'.repeat(64)}`,
      },
    ],
  }, { expectError: 'DOCUMENT_BINDING_SET_CHANGED' })
  assert.equal(storage.getProject(projectId).revision, 1)

  await postJson(origin, `/projects/${projectId}/document-bindings/accept-current`, {
    expectedRevision: 77,
    bindings: [
      {
        role: 'readme',
        relativePath: 'README.md',
        expectedContentHash: sha256Text(readmeHash),
        currentContentHash: revisedReadmeHash,
      },
      {
        role: 'prd',
        relativePath: 'docs/PRD.md',
        expectedContentHash: sha256Text(prdHash),
        currentContentHash: revisedPrdHash,
      },
    ],
  }, { expectError: 'REVISION_CONFLICT' })

  const outboxBeforeAcceptance = storage.listOutbox().length
  const accepted = await postJson(origin, `/projects/${projectId}/document-bindings/accept-current`, {
    expectedRevision: 1,
    bindings: [
      {
        role: 'readme',
        relativePath: 'README.md',
        expectedContentHash: sha256Text(readmeHash),
        currentContentHash: revisedReadmeHash,
      },
      {
        role: 'prd',
        relativePath: 'docs/PRD.md',
        expectedContentHash: sha256Text(prdHash),
        currentContentHash: revisedPrdHash,
      },
    ],
  })
  assert.equal(accepted.projectId, projectId)
  assert.equal(accepted.projectRevision, 2)
  assert.equal(accepted.acceptedBindings.length, 2)
  assert.equal(accepted.acceptedBindings.find(binding => binding.role === 'prd').previousContentHash, sha256Text(prdHash))
  assert.equal(accepted.acceptedBindings.find(binding => binding.role === 'prd').contentHash, revisedPrdHash)
  assert.match(accepted.commandId, /^cmd_/u)
  assert.match(accepted.eventId, /^evt_/u)
  const acceptanceReceipt = storage.getCommandReceipt(accepted.commandId)
  assert.equal(acceptanceReceipt?.status, 'accepted')
  assert.equal(acceptanceReceipt?.kind, 'console.project.legacy.document_bindings.accepted')
  assert.equal(storage.listEvents({ projectId }).some(event => (
    event.eventType === 'project.legacy.document_bindings.accepted'
      && event.eventId === accepted.eventId
  )), true)
  assert.equal(JSON.stringify(storage.listEvents({ projectId })).includes('Accepted authority merge'), false)
  assert.equal(storage.listOutbox().length, outboxBeforeAcceptance)
  assert.equal(storage.getProject(projectId).documentBindings.find(binding => binding.role === 'prd').contentHash, revisedPrdHash)

  const acceptedIndex = await getJson(origin, `/projects/${projectId}/documents`)
  assert.equal(acceptedIndex.documents.find(document => document.role === 'readme').state, 'ok')
  assert.equal(acceptedIndex.documents.find(document => document.role === 'prd').state, 'ok')
  const afterUpgrade = await postJson(origin, `/intake/projects/${projectId}/prepare-upgrade`, {
    expectedRevision: 2,
  })
  assert.notEqual(afterUpgrade.fingerprintHash, beforeUpgrade.fingerprintHash)
  assert.equal(afterUpgrade.command.payload.legacyFingerprintHash, afterUpgrade.fingerprintHash)

  await rename(join(projectRoot, 'docs', 'PRD.md'), join(projectRoot, 'docs', 'PRD-renamed.md'))
  const afterRename = await postJson(origin, `/projects/${projectId}/documents/refresh`, undefined)
  const proposal = afterRename.proposals.find(item => item.status === 'proposed')
  assert.ok(proposal)
  assert.deepEqual(proposal.candidateRelativePaths, ['docs/PRD-renamed.md'])
  assert.equal(proposal.applicable, true)

  const wrongRevision = await postJson(origin, `/projects/${projectId}/document-rebinds/${proposal.proposalId}/resolve`, {
    expectedRevision: 77,
    decision: 'accept',
  }, { expectError: 'REBIND_PROPOSAL_CHANGED' })
  assert.equal(wrongRevision, undefined)

  const resolved = await postJson(origin, `/projects/${projectId}/document-rebinds/${proposal.proposalId}/resolve`, {
    expectedRevision: proposal.revision,
    decision: 'accept',
  })
  assert.equal(resolved.proposal.status, 'accepted')
  assert.equal(resolved.proposal.resolvedRelativePath, 'docs/PRD-renamed.md')

  const final = await postJson(origin, `/projects/${projectId}/documents/refresh`, undefined)
  assert.equal(final.documents.find(document => document.role === 'prd').state, 'ok')
  assert.equal(final.proposals.filter(item => item.status === 'proposed').length, 0)

  const missing = await getJson(origin, '/projects/prj_0198f4b2-7c3a-7d92-a5c6-6b6f39e29999/documents', { expectError: 'PROJECT_NOT_FOUND' })
  assert.equal(missing, undefined)
})

async function serveRuntime(t, storage, runtime) {
  const read = {
    getStatus() {
      const status = storage.status()
      return {
        state: status.state,
        schemaVersion: status.schemaVersion,
        writable: true,
        projectCount: storage.listProjects().length,
      }
    },
    listProjects() {
      const projects = storage.listProjects().map(project => ({
        projectId: project.projectId,
        name: project.name,
        registrationMode: project.mode,
        lifecycle: project.lifecycle,
        updatedAt: project.updatedAt,
      }))
      return { projects, total: projects.length }
    },
  }
  const lifecycle = {
    replayCommandReceipt(command) { return storage.replayCommandReceipt(command) },
    recordRejectedCommand(command, result) { return storage.recordRejectedCommand(command, result) },
    registerProject(command, trusted) { return storage.registerProject(command, trusted) },
    rebindProject(command, trusted) { return storage.rebindProject(command, trusted) },
  }
  const server = createServer(createProjectControlRequestHandler(read, {
    lifecycle,
    intake: runtime.intake,
    referenceResolver: runtime.referenceResolver,
  }))
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolvePromise)
  })
  t.after(() => new Promise(resolvePromise => { server.close(resolvePromise) }))
  const address = server.address()
  assert.equal(typeof address, 'object')
  return `http://127.0.0.1:${address.port}`
}

async function getJson(origin, resource, options = {}) {
  const response = await fetch(`${origin}${PROJECT_CONTROL_API_PREFIX}${resource}`, {
    headers: { 'x-dsh-personal-client': '1' },
  })
  const payload = await response.json()
  if (options.expectError !== undefined) {
    assert.equal(payload.ok, false, JSON.stringify(payload))
    assert.equal(payload.error?.code, options.expectError, JSON.stringify(payload))
    return undefined
  }
  assert.equal(response.status, 200, JSON.stringify(payload))
  assert.equal(payload.ok, true, JSON.stringify(payload))
  return payload.data
}

async function postJson(origin, resource, body, options = {}) {
  const response = await fetch(`${origin}${PROJECT_CONTROL_API_PREFIX}${resource}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-dsh-personal-client': '1',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const payload = await response.json()
  if (options.expectError !== undefined) {
    assert.equal(payload.ok, false, JSON.stringify(payload))
    assert.equal(payload.error?.code, options.expectError, JSON.stringify(payload))
    return undefined
  }
  assert.equal(response.status, 200, JSON.stringify(payload))
  assert.equal(payload.ok, true, JSON.stringify(payload))
  return payload.data
}
