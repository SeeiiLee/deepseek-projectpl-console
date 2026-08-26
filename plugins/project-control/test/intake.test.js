import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { issueProjectControlSelectionTicket } from '../../../src/project-control-selection-ticket.js'
import { scanProjectDirectory, scanSourceDirectory } from '../src/discovery/runtime.js'
import { openProjectControlStorage } from '../src/host/index.js'
import { createProjectControlRequestHandler, PROJECT_CONTROL_API_PREFIX } from '../src/http.ts'
import { createProjectControlIntakeRuntime } from '../src/intake.ts'
import { validateLifecycleCommand } from '../src/lifecycle-validator.ts'

const migrationsDirectory = fileURLToPath(new URL('../migrations/', import.meta.url))

test('authorized scan prepares and atomically registers a linked project without project writes', async t => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'dsh-project-control-intake-'))
  const projectRoot = join(tempRoot, 'Existing Project')
  await mkdir(projectRoot)
  const storage = await openProjectControlStorage({
    databasePath: join(tempRoot, 'project-control.sqlite3'),
    backupDirectory: join(tempRoot, 'backups'),
    migrationsDirectory,
    applicationVersion: '0.1.0-test',
    instanceId: 'intake-test-writer',
  })
  t.after(() => {
    storage.close()
    return rm(tempRoot, { recursive: true, force: true })
  })

  const observedAt = new Date().toISOString()
  const contentHash = `sha256:${'a'.repeat(64)}`
  const envelope = {
    mode: 'single_project',
    rootPath: { displayPath: projectRoot, normalizedPath: resolve(projectRoot) },
    sourceRoot: null,
    scanPreferences: { maxDepth: 4 },
    scannerVersion: 'gate2c-test/1',
    status: 'completed',
    startedAt: observedAt,
    completedAt: observedAt,
    summary: { candidateCount: 1, documentCount: 1, issueCount: 0 },
    candidates: [{
      root: { displayPath: projectRoot, normalizedPath: resolve(projectRoot) },
      detectedMode: 'linked_legacy',
      suggestedName: 'Existing Project',
      suggestedSummary: 'Existing project documentation.',
      summarySource: 'README.md',
      confidence: { level: 'high', nameSource: 'folder_name', evidence: ['README.md'] },
      status: 'discovered',
      documents: [{
        relativePath: 'README.md',
        suggestedRole: 'readme',
        sha256: contentHash,
        title: 'Existing Project',
        preview: '# Existing Project',
        observedAt,
        evidence: { signals: ['filename:README.md'] },
      }],
      issues: [],
    }],
  }
  let projectScanCalls = 0
  const scanner = {
    async scanSourceDirectory() { assert.fail('unexpected source-root scan') },
    async scanProjectDirectory(path) {
      projectScanCalls += 1
      assert.equal(path, projectRoot)
      return structuredClone(envelope)
    },
  }
  const secret = 'intake-test-selection-secret-long-enough-for-hmac'
  const runtime = createProjectControlIntakeRuntime({
    storage,
    scanner,
    selectionSecret: secret,
    applicationInstanceId: 'host-test',
    applicationVersion: '0.1.0-test',
  })
  const authorization = issueProjectControlSelectionTicket({
    kind: 'project-root',
    path: projectRoot,
    secret,
  })
  const recorded = await runtime.intake.scan({
    mode: 'project-root',
    selection: { path: projectRoot, authorization },
  })
  assert.equal(recorded.candidates.length, 1)
  const candidate = recorded.candidates[0]
  const command = await runtime.intake.prepareCandidate(candidate.candidateId, {
    registrationMode: 'linked_legacy',
    name: 'Existing Project',
    expectedRevision: candidate.revision,
    documentBindings: [{ role: 'readme', relativePath: 'README.md', contentHash }],
  })
  assert.equal(validateLifecycleCommand(command).ok, true)
  const forgedTarget = structuredClone(command)
  forgedTarget.target.projectId = 'prj_0198f4b2-7c3a-7d11-a5c6-6b6f39e34799'
  assert.equal(await runtime.referenceResolver.resolveRegistration(forgedTarget), null)
  const forgedActor = structuredClone(command)
  forgedActor.actor.id = 'renderer-forged-user'
  assert.equal(await runtime.referenceResolver.resolveRegistration(forgedActor), null)
  const forgedRevision = structuredClone(command)
  forgedRevision.expectedRevision = 7
  assert.equal(await runtime.referenceResolver.resolveRegistration(forgedRevision), null)
  const forgedProvenance = structuredClone(command)
  forgedProvenance.provenance.sourceId = 'renderer-forged-source'
  assert.equal(await runtime.referenceResolver.resolveRegistration(forgedProvenance), null)
  const forgedTime = structuredClone(command)
  forgedTime.occurredAt = '2026-08-14T00:00:00.000Z'
  forgedTime.provenance.observedAt = forgedTime.occurredAt
  assert.equal(await runtime.referenceResolver.resolveRegistration(forgedTime), null)
  const forgedAdapter = structuredClone(command)
  forgedAdapter.provenance.adapterId = 'renderer-forged-adapter'
  forgedAdapter.provenance.adapterVersion = '1.0.0'
  assert.equal(await runtime.referenceResolver.resolveRegistration(forgedAdapter), null)
  const origin = await serveLifecycleRuntime(t, storage, runtime)
  const first = await submitLifecycle(origin, command)
  assert.equal(first.status, 'accepted')
  assert.equal(storage.getProject(first.projectId)?.name, 'Existing Project')
  const imported = storage.getImportCandidate(candidate.candidateId)
  assert.equal(imported?.status, 'imported')
  assert.equal(imported?.revision, candidate.revision + 1)
  assert.equal(imported?.matchedProjectId, first.projectId)

  const callsAfterFirstSubmit = projectScanCalls
  const replay = await submitLifecycle(origin, command)
  assert.equal(replay.status, 'replayed')
  assert.equal(replay.projectId, first.projectId)
  assert.equal(projectScanCalls, callsAfterFirstSubmit, 'receipt replay must precede candidate rescan')

  const changedEnvelope = structuredClone(command)
  changedEnvelope.correlationId = `${command.correlationId}:changed`
  const conflict = await submitLifecycle(origin, changedEnvelope)
  assert.equal(conflict.status, 'rejected')
  assert.equal(conflict.error.code, 'IDEMPOTENCY_CONFLICT')
  assert.equal(projectScanCalls, callsAfterFirstSubmit, 'invalid HMAC must not reach candidate rescan')
})

test('selection tickets are single-use and candidate hashes are rechecked before prepare', async t => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'dsh-project-control-intake-ticket-'))
  const projectRoot = join(tempRoot, 'Project')
  await mkdir(projectRoot)
  const storage = await openProjectControlStorage({
    databasePath: join(tempRoot, 'project-control.sqlite3'),
    migrationsDirectory,
    applicationVersion: '0.1.0-test',
    instanceId: 'intake-test-ticket-writer',
  })
  t.after(() => {
    storage.close()
    return rm(tempRoot, { recursive: true, force: true })
  })
  const observedAt = new Date().toISOString()
  let contentHash = `sha256:${'b'.repeat(64)}`
  const scanner = {
    async scanSourceDirectory() { assert.fail('unexpected source scan') },
    async scanProjectDirectory() {
      return {
        mode: 'single_project',
        rootPath: { displayPath: projectRoot, normalizedPath: resolve(projectRoot) },
        sourceRoot: null,
        scannerVersion: 'gate2c-test/1',
        status: 'completed',
        startedAt: observedAt,
        completedAt: observedAt,
        summary: { candidateCount: 1 },
        candidates: [{
          root: { displayPath: projectRoot, normalizedPath: resolve(projectRoot) },
          detectedMode: 'linked_legacy',
          suggestedName: 'Project',
          confidence: { level: 'medium', evidence: ['README.md'] },
          documents: [{ relativePath: 'README.md', suggestedRole: 'readme', sha256: contentHash }],
          issues: [],
        }],
      }
    },
  }
  const secret = 'another-intake-test-selection-secret-long-enough'
  const runtime = createProjectControlIntakeRuntime({
    storage,
    scanner,
    selectionSecret: secret,
    applicationInstanceId: 'host-test-2',
    applicationVersion: '0.1.0-test',
  })
  const authorization = issueProjectControlSelectionTicket({ kind: 'project-root', path: projectRoot, secret })
  const scan = await runtime.intake.scan({
    mode: 'project-root',
    selection: { path: projectRoot, authorization },
  })
  await assert.rejects(runtime.intake.scan({
    mode: 'project-root',
    selection: { path: projectRoot, authorization },
  }), error => error?.code === 'DIRECTORY_SELECTION_REQUIRED')

  const candidate = scan.candidates[0]
  contentHash = `sha256:${'c'.repeat(64)}`
  await assert.rejects(runtime.intake.prepareCandidate(candidate.candidateId, {
    registrationMode: 'linked_legacy',
    name: 'Project',
    expectedRevision: candidate.revision,
    documentBindings: [{
      role: 'readme',
      relativePath: 'README.md',
      contentHash: `sha256:${'b'.repeat(64)}`,
    }],
  }), error => error?.code === 'DOCUMENT_CHANGED')
  assert.equal(storage.listProjects().length, 0)
})

test('managed registration ignores renderer remapping and preserves manifest multi-role and optional bindings', async t => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'dsh-project-control-intake-managed-'))
  const projectRoot = join(tempRoot, 'Managed Project')
  await mkdir(join(projectRoot, '.dsh-project'), { recursive: true })
  await mkdir(join(projectRoot, 'docs', 'decisions'), { recursive: true })
  await writeFile(join(projectRoot, 'docs', 'PRD.md'), '# Managed Project\n\n## Goal\nKeep registration deterministic.\n')
  await writeFile(join(projectRoot, 'docs', 'decisions', '001-runtime.md'), '# Runtime Decision\n')
  await writeFile(join(projectRoot, 'docs', 'decisions', '002-storage.md'), '# Storage Decision\n')
  await writeFile(join(projectRoot, '.dsh-project', 'project.yaml'), [
    'apiVersion: project-control.dsh/v1alpha1',
    'kind: ProjectManifest',
    'metadata:',
    '  projectId: prj_0198f4b2-7c3a-7d11-a5c6-6b6f39e34711',
    '  name: Managed Project',
    '  createdAt: 2026-08-14T14:00:00.000Z',
    '  createdBy:',
    '    kind: human',
    '    id: cyrus',
    '  origin:',
    '    kind: imported',
    'spec:',
    '  documents:',
    '    docsRoot: docs',
    '    entries:',
    '      - role: prd',
    '        path: docs/PRD.md',
    '        required: true',
    '      - role: decision',
    '        path: docs/decisions/001-runtime.md',
    '        required: true',
    '      - role: decision',
    '        path: docs/decisions/002-storage.md',
    '        required: true',
    '      - role: next',
    '        path: docs/NEXT.md',
    '        required: false',
    '    standardOutputs:',
    '      updatesRoot: .dsh-project/updates',
    '      decisionsRoot: .dsh-project/decisions',
    '      artifactsRoot: .dsh-project/artifacts',
  ].join('\n'))
  const storage = await openProjectControlStorage({
    databasePath: join(tempRoot, 'project-control.sqlite3'),
    migrationsDirectory,
    applicationVersion: '0.1.0-test',
    instanceId: 'intake-managed-test-writer',
  })
  t.after(() => {
    storage.close()
    return rm(tempRoot, { recursive: true, force: true })
  })
  const secret = 'managed-intake-test-selection-secret-long-enough'
  const runtime = createProjectControlIntakeRuntime({
    storage,
    scanner: { scanProjectDirectory, scanSourceDirectory },
    selectionSecret: secret,
    applicationInstanceId: 'host-managed-test',
    applicationVersion: '0.1.0-test',
  })
  const authorization = issueProjectControlSelectionTicket({
    kind: 'project-root',
    path: projectRoot,
    secret,
  })
  const recorded = await runtime.intake.scan({
    mode: 'project-root',
    selection: { path: projectRoot, authorization },
  })
  const candidate = recorded.candidates[0]
  assert.equal(candidate.detectedMode, 'managed')
  const prd = candidate.documents.find(document => document.suggestedRole === 'prd')
  assert.notEqual(prd, undefined)
  await assert.rejects(runtime.intake.prepareCandidate(candidate.candidateId, {
    registrationMode: 'managed',
    name: candidate.suggestedName,
    expectedRevision: candidate.revision,
    documentBindings: [{ role: 'prd', relativePath: prd.relativePath, contentHash: prd.sha256 }],
  }), error => error?.code === 'MANAGED_BINDINGS_LOCKED')
  const command = await runtime.intake.prepareCandidate(candidate.candidateId, {
    registrationMode: 'managed',
    name: candidate.suggestedName,
    expectedRevision: candidate.revision,
    documentBindings: [],
  })
  const trusted = await runtime.referenceResolver.resolveRegistration(command)
  assert.notEqual(trusted, null)
  assert.deepEqual(trusted.manifestDocumentBindings.map(binding => ({
    role: binding.role,
    relativePath: binding.relativePath,
    contentHash: binding.contentHash ?? null,
    required: binding.required ?? false,
  })), [
    { role: 'prd', relativePath: 'docs/PRD.md', contentHash: prd.sha256, required: true },
    {
      role: 'decision',
      relativePath: 'docs/decisions/001-runtime.md',
      contentHash: candidate.documents.find(document => document.relativePath === 'docs/decisions/001-runtime.md').sha256,
      required: true,
    },
    {
      role: 'decision',
      relativePath: 'docs/decisions/002-storage.md',
      contentHash: candidate.documents.find(document => document.relativePath === 'docs/decisions/002-storage.md').sha256,
      required: true,
    },
    { role: 'next', relativePath: 'docs/NEXT.md', contentHash: null, required: false },
  ])
  const result = storage.registerProject(command, trusted)
  assert.equal(result.status, 'accepted')
  const project = storage.getProject(result.projectId)
  assert.equal(project.documentBindings.filter(binding => binding.role === 'decision').length, 2)
  assert.equal(project.documentBindings.find(binding => binding.relativePath === 'docs/NEXT.md').contentHash, null)
  assert.equal(project.documentBindings.find(binding => binding.relativePath === 'docs/NEXT.md').required, false)
  assert.equal(project.documentBindings.find(binding => binding.relativePath === 'docs/PRD.md').required, true)
  assert.equal(project.manifestMirror.documentBindings.filter(binding => binding.role === 'decision').length, 2)
  assert.deepEqual(
    project.manifestMirror.documentBindings.find(binding => binding.relativePath === 'docs/NEXT.md'),
    {
      role: 'next',
      relativePath: 'docs/NEXT.md',
      contentHash: null,
      required: false,
      source: 'manifest',
    },
  )
})

test('an accepted signed rebind closes same-path relocation duplicates and replays before rescan', async t => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'dsh-project-control-intake-rebind-'))
  const oldRoot = join(tempRoot, 'Managed Project Old')
  const newRoot = join(tempRoot, 'Managed Project New')
  await mkdir(join(oldRoot, '.dsh-project'), { recursive: true })
  await mkdir(join(oldRoot, 'docs'), { recursive: true })
  await writeFile(join(oldRoot, 'docs', 'PRD.md'), '# Relocatable Managed Project\n')
  await writeFile(join(oldRoot, '.dsh-project', 'project.yaml'), [
    'apiVersion: project-control.dsh/v1alpha1',
    'kind: ProjectManifest',
    'metadata:',
    '  projectId: prj_0198f4b2-7c3a-7d11-a5c6-6b6f39e34721',
    '  name: Relocatable Managed Project',
    '  createdAt: 2026-08-14T14:00:00.000Z',
    '  createdBy:',
    '    kind: human',
    '    id: cyrus',
    '  origin:',
    '    kind: imported',
    'spec:',
    '  documents:',
    '    docsRoot: docs',
    '    entries:',
    '      - role: prd',
    '        path: docs/PRD.md',
    '        required: true',
    '    standardOutputs:',
    '      updatesRoot: .dsh-project/updates',
    '      decisionsRoot: .dsh-project/decisions',
    '      artifactsRoot: .dsh-project/artifacts',
  ].join('\n'))
  const storage = await openProjectControlStorage({
    databasePath: join(tempRoot, 'project-control.sqlite3'),
    migrationsDirectory,
    applicationVersion: '0.1.0-test',
    instanceId: 'intake-rebind-test-writer',
  })
  t.after(() => {
    storage.close()
    return rm(tempRoot, { recursive: true, force: true })
  })
  let projectScanCalls = 0
  const scanner = {
    scanSourceDirectory,
    async scanProjectDirectory(path, options) {
      projectScanCalls += 1
      return scanProjectDirectory(path, options)
    },
  }
  const secret = 'managed-rebind-test-selection-secret-long-enough'
  const runtime = createProjectControlIntakeRuntime({
    storage,
    scanner,
    selectionSecret: secret,
    applicationInstanceId: 'host-rebind-test',
    applicationVersion: '0.1.0-test',
  })
  const origin = await serveLifecycleRuntime(t, storage, runtime)

  const initialScan = await runtime.intake.scan({
    mode: 'project-root',
    selection: {
      path: oldRoot,
      authorization: issueProjectControlSelectionTicket({ kind: 'project-root', path: oldRoot, secret }),
    },
  })
  const initialCandidate = initialScan.candidates[0]
  const register = await runtime.intake.prepareCandidate(initialCandidate.candidateId, {
    registrationMode: 'managed',
    name: initialCandidate.suggestedName,
    expectedRevision: initialCandidate.revision,
    documentBindings: [],
  })
  const registered = await submitLifecycle(origin, register)
  assert.equal(registered.status, 'accepted')

  await rename(oldRoot, newRoot)
  const relocationScan = await runtime.intake.scan({
    mode: 'project-root',
    selection: {
      path: newRoot,
      authorization: issueProjectControlSelectionTicket({ kind: 'project-root', path: newRoot, secret }),
    },
  })
  const relocation = relocationScan.candidates[0]
  assert.equal(relocation.status, 'relocation_candidate')
  const duplicateRelocationScan = await runtime.intake.scan({
    mode: 'project-root',
    selection: {
      path: newRoot,
      authorization: issueProjectControlSelectionTicket({ kind: 'project-root', path: newRoot, secret }),
    },
  })
  const duplicateRelocation = duplicateRelocationScan.candidates[0]
  assert.equal(duplicateRelocation.status, 'relocation_candidate')
  assert.notEqual(duplicateRelocation.candidateId, relocation.candidateId)
  const rebind = await runtime.intake.prepareCandidate(duplicateRelocation.candidateId, {
    registrationMode: 'managed',
    name: duplicateRelocation.suggestedName,
    expectedRevision: duplicateRelocation.revision,
    documentBindings: [],
  })
  assert.equal(rebind.kind, 'project.rebindLocation')
  const rebound = await submitLifecycle(origin, rebind)
  assert.equal(rebound.status, 'accepted')
  assert.equal(rebound.outcome, 'location_rebound')
  const imported = storage.getImportCandidate(duplicateRelocation.candidateId)
  assert.equal(imported?.status, 'imported')
  assert.equal(imported?.revision, duplicateRelocation.revision + 1)
  const closedDuplicate = storage.getImportCandidate(relocation.candidateId)
  assert.equal(closedDuplicate?.status, 'imported')
  assert.equal(closedDuplicate?.matchedProjectId, registered.projectId)
  assert.equal(closedDuplicate?.revision, relocation.revision + 1)

  const callsAfterFirstSubmit = projectScanCalls
  const replay = await submitLifecycle(origin, rebind)
  assert.equal(replay.status, 'replayed')
  assert.equal(replay.projectId, registered.projectId)
  assert.equal(projectScanCalls, callsAfterFirstSubmit, 'rebind replay must precede candidate rescan')

  const changedEnvelope = structuredClone(rebind)
  changedEnvelope.payload.newLocationRef = replaceFinalHex(rebind.payload.newLocationRef)
  const conflict = await submitLifecycle(origin, changedEnvelope)
  assert.equal(conflict.status, 'rejected')
  assert.equal(conflict.error.code, 'IDEMPOTENCY_CONFLICT')
  assert.equal(projectScanCalls, callsAfterFirstSubmit)
  const project = storage.getProject(registered.projectId)
  assert.equal(project.revision, 2)
  const activeLocation = project.workspaceLocations.find(location => location.isActive)
  assert.equal(activeLocation?.locationId, rebind.payload.newLocationRef)
  assert.equal(
    testWindowsPathKey(activeLocation.normalizedPath),
    testWindowsPathKey(duplicateRelocation.root.normalizedPath),
  )
  assert.equal(storage.listEvents().length, 2)
  assert.equal(storage.listOutbox().length, 2)
})

test('a linked legacy relocation uses deterministic legacy evidence before rebinding', async t => {
  const fixture = await setupLinkedLegacyRelocation(t)
  const command = await fixture.runtime.intake.prepareCandidate(fixture.candidate.candidateId, {
    registrationMode: 'managed',
    name: fixture.candidate.suggestedName,
    expectedRevision: fixture.candidate.revision,
    documentBindings: [],
  })

  assert.equal(validateLifecycleCommand(command).ok, true)
  assert.equal(command.kind, 'project.rebindLocation')
  assert.equal(command.payload.expectedMode, 'linked_legacy')
  assert.equal(command.payload.identityEvidence.kind, 'legacy_fingerprint')
  assert.deepEqual(command.payload.identityEvidence.contentHashes, [fixture.registeredContentHash])
  assert.match(command.payload.identityEvidence.fingerprintHash, /^sha256:[0-9a-f]{64}$/)

  const forgedEvidence = structuredClone(command)
  forgedEvidence.payload.identityEvidence.fingerprintHash = `sha256:${'f'.repeat(64)}`
  assert.equal(await fixture.runtime.referenceResolver.resolveRebind(forgedEvidence), null)

  const rebound = await submitLifecycle(fixture.origin, command)
  assert.equal(rebound.status, 'accepted')
  assert.equal(rebound.outcome, 'location_rebound')
  const project = fixture.storage.getProject(fixture.projectId)
  assert.equal(project.mode, 'linked_legacy')
  assert.equal(
    testWindowsPathKey(project.workspaceLocations.find(location => location.isActive)?.normalizedPath),
    testWindowsPathKey(fixture.candidate.root.normalizedPath),
  )
})

test('a linked legacy relocation without a matching registered document fails closed', async t => {
  const fixture = await setupLinkedLegacyRelocation(t, {
    relocationContentHash: `sha256:${'b'.repeat(64)}`,
  })

  await assert.rejects(fixture.runtime.intake.prepareCandidate(fixture.candidate.candidateId, {
    registrationMode: 'managed',
    name: fixture.candidate.suggestedName,
    expectedRevision: fixture.candidate.revision,
    documentBindings: [],
  }), error => error?.code === 'IDENTITY_EVIDENCE_REQUIRED')
  assert.equal(fixture.storage.getProject(fixture.projectId).revision, 1)
})

test('candidate center maps a stale view cursor to a public refresh error', () => {
  const storageError = new Error('cursor left the selected view')
  storageError.details = { reason: 'candidate_cursor_not_found' }
  const runtime = createProjectControlIntakeRuntime({
    storage: {
      queryImportCandidates() { throw storageError },
    },
    scanner: {
      async scanSourceDirectory() { assert.fail('unexpected source scan') },
      async scanProjectDirectory() { assert.fail('unexpected project scan') },
    },
    selectionSecret: 'candidate-cursor-test-secret-long-enough',
    applicationInstanceId: 'candidate-cursor-test',
    applicationVersion: '0.1.0-test',
  })

  assert.throws(
    () => runtime.intake.listCandidates({
      view: 'review',
      search: 'Alpha',
      limit: 25,
      afterCandidateId: 'can_019c0000-0000-7000-8000-000000000001',
    }),
    error => error.code === 'CANDIDATE_CURSOR_INVALID'
      && error.status === 409
      && /第一页/u.test(error.message),
  )
})

async function setupLinkedLegacyRelocation(t, options = {}) {
  const tempRoot = await mkdtemp(join(tmpdir(), 'dsh-project-control-intake-legacy-rebind-'))
  const oldRoot = join(tempRoot, 'Legacy Project Old')
  const newRoot = join(tempRoot, 'Legacy Project New')
  await mkdir(oldRoot)
  const storage = await openProjectControlStorage({
    databasePath: join(tempRoot, 'project-control.sqlite3'),
    migrationsDirectory,
    applicationVersion: '0.1.0-test',
    instanceId: 'intake-legacy-rebind-test-writer',
  })
  t.after(() => {
    storage.close()
    return rm(tempRoot, { recursive: true, force: true })
  })

  const registeredContentHash = `sha256:${'a'.repeat(64)}`
  let activeRoot = oldRoot
  let detectedMode = 'linked_legacy'
  let documentHash = registeredContentHash
  let manifest = null
  const observedAt = new Date().toISOString()
  const scanner = {
    async scanSourceDirectory() { assert.fail('unexpected source-root scan') },
    async scanProjectDirectory(path) {
      assert.equal(resolve(path), resolve(activeRoot))
      return {
        mode: 'single_project',
        rootPath: { displayPath: activeRoot, normalizedPath: resolve(activeRoot) },
        sourceRoot: null,
        scannerVersion: 'legacy-rebind-test/1',
        status: 'completed',
        startedAt: observedAt,
        completedAt: observedAt,
        summary: { candidateCount: 1, documentCount: 1, issueCount: 0 },
        candidates: [{
          root: { displayPath: activeRoot, normalizedPath: resolve(activeRoot) },
          detectedMode,
          manifestProjectId: manifest?.projectId ?? null,
          suggestedName: 'Legacy Relocation Project',
          confidence: {
            level: 'high',
            evidence: ['README.md'],
            ...(manifest === null ? {} : { manifest }),
          },
          status: 'discovered',
          documents: [{
            relativePath: 'README.md',
            suggestedRole: 'readme',
            sha256: documentHash,
            title: 'Legacy Relocation Project',
            preview: '# Legacy Relocation Project',
            observedAt,
            evidence: { signals: ['filename:README.md'] },
          }],
          issues: [],
        }],
      }
    },
  }
  const secret = 'legacy-rebind-test-selection-secret-long-enough'
  const runtime = createProjectControlIntakeRuntime({
    storage,
    scanner,
    selectionSecret: secret,
    applicationInstanceId: 'host-legacy-rebind-test',
    applicationVersion: '0.1.0-test',
  })
  const origin = await serveLifecycleRuntime(t, storage, runtime)
  const firstScan = await runtime.intake.scan({
    mode: 'project-root',
    selection: {
      path: oldRoot,
      authorization: issueProjectControlSelectionTicket({ kind: 'project-root', path: oldRoot, secret }),
    },
  })
  const initial = firstScan.candidates[0]
  const register = await runtime.intake.prepareCandidate(initial.candidateId, {
    registrationMode: 'linked_legacy',
    name: initial.suggestedName,
    expectedRevision: initial.revision,
    documentBindings: [{ role: 'readme', relativePath: 'README.md', contentHash: registeredContentHash }],
  })
  const registered = await submitLifecycle(origin, register)
  assert.equal(registered.status, 'accepted')

  await rename(oldRoot, newRoot)
  activeRoot = newRoot
  detectedMode = 'managed'
  documentHash = options.relocationContentHash ?? registeredContentHash
  manifest = {
    projectId: registered.projectId,
    hash: `sha256:${'c'.repeat(64)}`,
    name: 'Legacy Relocation Project',
    relativePath: '.dsh-project/project.yaml',
    origin: { kind: 'imported' },
    documentBindings: [{
      role: 'readme',
      relativePath: 'README.md',
      contentHash: documentHash,
      required: true,
    }],
  }
  const relocationScan = await runtime.intake.scan({
    mode: 'project-root',
    selection: {
      path: newRoot,
      authorization: issueProjectControlSelectionTicket({ kind: 'project-root', path: newRoot, secret }),
    },
  })
  const candidate = relocationScan.candidates[0]
  assert.equal(candidate.status, 'relocation_candidate')
  return {
    candidate,
    origin,
    projectId: registered.projectId,
    registeredContentHash,
    runtime,
    storage,
  }
}

async function serveLifecycleRuntime(t, storage, runtime) {
  const read = {
    getStatus() {
      const status = storage.status()
      return {
        state: status.state,
        schemaVersion: status.schemaVersion,
        writable: status.writable,
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

async function submitLifecycle(origin, command) {
  const response = await fetch(`${origin}${PROJECT_CONTROL_API_PREFIX}/lifecycle`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-dsh-personal-client': '1',
    },
    body: JSON.stringify(command),
  })
  const payload = await response.json()
  assert.equal(response.status, 200, JSON.stringify(payload))
  assert.equal(payload.ok, true, JSON.stringify(payload))
  return payload.data
}

function replaceFinalHex(value) {
  const final = value.at(-1)
  return `${value.slice(0, -1)}${final === '0' ? '1' : '0'}`
}

function testWindowsPathKey(value) {
  return win32.normalize(value.replaceAll('/', '\\')).normalize('NFC').toLocaleLowerCase('en-US')
}
