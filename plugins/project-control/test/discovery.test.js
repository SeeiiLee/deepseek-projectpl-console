import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import test from 'node:test'

import {
  SCANNER_VERSION,
  scanProjectDirectory,
  scanSourceDirectory,
} from '../src/discovery/runtime.js'
import { openProjectControlStorage } from '../src/host/index.js'

function makeRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-discovery-'))
  t.after(() => {
    try {
      chmodSync(root, 0o700)
    } catch {}
    rmSync(root, { recursive: true, force: true })
  })
  return root
}

function put(root, relativePath, contents) {
  const target = join(root, ...relativePath.split('/'))
  mkdirSync(join(target, '..'), { recursive: true })
  writeFileSync(target, contents)
  return target
}

function treeDigest(root) {
  const hash = createHash('sha256')
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const target = join(directory, entry.name)
      const logical = relative(root, target).replaceAll('\\', '/')
      hash.update(`${entry.isDirectory() ? 'd' : entry.isSymbolicLink() ? 'l' : 'f'}:${logical}\0`)
      if (entry.isDirectory()) visit(target)
      else if (entry.isFile()) hash.update(readFileSync(target))
    }
  }
  visit(root)
  return hash.digest('hex')
}

function candidateOf(scan) {
  assert.equal(scan.candidates.length, 1)
  return scan.candidates[0]
}

test('single-project discovery is zero-write, bounded, and keeps an outer root with nested code documents', async (t) => {
  const root = makeRoot(t)
  const project = join(root, 'Cyrus Quant Trading')
  mkdirSync(project)
  put(project, 'README.md', '# Outer Notes\n')
  put(project, 'docs/PRD.md', '# Cyrus 量化模拟\n\n## 目标\n构建可审计的本地量化模拟环境。\n')
  put(project, 'cyrus-quant/ARCHITECTURE.md', '# System Architecture\n')
  put(project, 'cyrus-quant/pyproject.toml', '[project]\nname="cyrus-quant"\n')
  put(project, 'cyrus-quant/.dsh-project/project.yaml', 'apiVersion: project-control.dsh/v1alpha1\n')
  put(project, 'node_modules/fake/PRD.md', '# Must Be Ignored\n')
  const before = treeDigest(project)

  const scan = await scanProjectDirectory(project)
  const after = treeDigest(project)
  const candidate = candidateOf(scan)

  assert.equal(SCANNER_VERSION, 'gate2c-readonly/1')
  assert.equal(scan.mode, 'single_project')
  assert.equal(scan.summary.projectDirectoriesModified, 0)
  assert.equal(before, after)
  assert.equal(candidate.root.displayPath, project)
  assert.equal(candidate.displayPath, project)
  assert.equal(candidate.suggestedName, 'Cyrus 量化模拟')
  assert.equal(candidate.suggestedSummary, '构建可审计的本地量化模拟环境。')
  assert.deepEqual(
    new Set(candidate.documents.map((document) => document.relativePath)),
    new Set(['README.md', 'cyrus-quant/ARCHITECTURE.md', 'docs/PRD.md']),
  )
  assert.ok(candidate.documents.every((document) => !document.relativePath.includes('\\')))
  assert.ok(candidate.documents.every((document) => /^sha256:[0-9a-f]{64}$/.test(document.sha256)))
  assert.ok(candidate.documents.every((document) => (document.preview?.length ?? 0) <= 800))
  assert.ok(candidate.markers.some((marker) => marker.kind === 'python_manifest' && marker.location === 'nested'))
  assert.ok(candidate.issues.some((issue) => issue.code === 'NESTED_MANIFEST_DETECTED'))
})

test('multiple PRDs remain separate candidates and require confirmation instead of selecting a primary', async (t) => {
  const root = makeRoot(t)
  const project = join(root, 'Ambiguous Product')
  mkdirSync(project)
  put(project, 'docs/PRD.md', '# Product Current?\n')
  put(project, 'docs/PRD_legacy.md', '# Product Legacy?\n')

  const candidate = candidateOf(await scanProjectDirectory(project))
  const prds = candidate.documents.filter((document) => document.roleCandidates.some((role) => role.role === 'prd'))

  assert.equal(prds.length, 2)
  assert.equal(candidate.suggestedName, 'Ambiguous Product')
  assert.ok(candidate.issues.some((issue) => issue.code === 'MULTIPLE_ROLE_CANDIDATES' && issue.details.role === 'prd'))
  assert.ok(candidate.issues.every((issue) => issue.details.message === issue.message))
})

test('source discovery scans direct children and blocks a junction or symlink escaping the authorized root', async (t) => {
  const holder = makeRoot(t)
  const source = join(holder, 'Projects')
  const external = join(holder, 'External')
  mkdirSync(source)
  mkdirSync(external)
  const good = join(source, 'Good Project')
  mkdirSync(good)
  put(good, 'README.md', '# Good Project\n')
  put(external, 'README.md', '# Outside\n')
  const escape = join(source, 'Escaping Link')
  symlinkSync(external, escape, process.platform === 'win32' ? 'junction' : 'dir')

  const scan = await scanSourceDirectory(source)

  assert.equal(scan.mode, 'source_root')
  assert.deepEqual(scan.candidates.map((candidate) => candidate.suggestedName), ['Good Project'])
  assert.ok(scan.issues.some((issue) => issue.code === 'PATH_ESCAPE_BLOCKED'))
  assert.ok(scan.candidates.every((candidate) => candidate.realPath.toLocaleLowerCase('en-US').startsWith(scan.rootPath.realPath.toLocaleLowerCase('en-US'))))
})

test('source discovery keeps project-internal depth independent from direct-child source depth', async (t) => {
  const root = makeRoot(t)
  const source = join(root, 'Projects')
  const project = join(source, 'Nested Docs Project')
  mkdirSync(project, { recursive: true })
  put(project, 'docs/product/current/PRD.md', '# Nested Product Requirements\n')

  const scan = await scanSourceDirectory(source)
  const candidate = candidateOf(scan)

  assert.equal(scan.scanPreferences.sourceDepth, 1)
  assert.equal(scan.scanPreferences.maxDepth, 3)
  assert.ok(candidate.documents.some(document => document.relativePath === 'docs/product/current/PRD.md'))
})

test('large, binary, and access-failed documents are local issues and do not fail the whole candidate', async (t) => {
  const root = makeRoot(t)
  const project = join(root, 'Partial Project')
  mkdirSync(project)
  put(project, 'README.md', '# Partial Project\n')
  put(project, 'PRD_big.md', Buffer.alloc(4_096, 0x61))
  put(project, 'ARCHITECTURE.md', Buffer.from([0, 1, 2, 3, 4]))
  const denied = put(project, 'NEXT.md', '# Next\n')
  try {
    chmodSync(denied, 0o000)
  } catch {}

  const candidate = candidateOf(await scanProjectDirectory(project, { maxFileBytes: 1_024 }))

  assert.ok(candidate.documents.some((document) => document.relativePath === 'README.md'))
  assert.ok(candidate.issues.some((issue) => issue.code === 'FILE_TOO_LARGE'))
  assert.ok(candidate.issues.some((issue) => issue.code === 'BINARY_DOCUMENT_SKIPPED'))
  // POSIX enforces chmod(000); elevated Windows processes may still read it. Both outcomes must stay local.
  assert.ok(
    candidate.issues.some((issue) => issue.code === 'ENTRY_ACCESS_DENIED' || issue.code === 'FILE_READ_FAILED')
      || candidate.documents.some((document) => document.relativePath === 'NEXT.md'),
  )
})

test('a supported manifest exposes restart-safe identity and verified bindings in confidence', async (t) => {
  const root = makeRoot(t)
  const project = join(root, 'Managed Project')
  mkdirSync(project)
  put(project, 'docs/PRD.md', '# Managed Name\n\n## Goal\nKeep imports deterministic.\n')
  put(project, '.dsh-project/project.yaml', [
    'apiVersion: project-control.dsh/v1alpha1',
    'kind: ProjectManifest',
    'metadata:',
    '  projectId: prj_0198f4b2-7c3a-7d11-a5c6-6b6f39e34711',
    '  name: Managed From Manifest',
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

  const candidate = candidateOf(await scanProjectDirectory(project))

  assert.equal(candidate.detectedMode, 'managed')
  assert.equal(candidate.status, 'discovered')
  assert.equal(candidate.manifestStatus, 'valid')
  assert.equal(candidate.manifestProjectId, 'prj_0198f4b2-7c3a-7d11-a5c6-6b6f39e34711')
  assert.equal(candidate.suggestedName, 'Managed From Manifest')
  assert.equal(candidate.confidence.nameSource.label, 'manifest')
  assert.equal(candidate.confidence.manifest.projectId, candidate.manifestProjectId)
  assert.match(candidate.confidence.manifest.hash, /^sha256:[0-9a-f]{64}$/)
  assert.deepEqual(candidate.confidence.manifest.documentBindings, candidate.manifestDocumentBindings)
  assert.match(candidate.manifestDocumentBindings[0].contentHash, /^sha256:[0-9a-f]{64}$/)
})

test('manifest bindings are read directly beyond maxDepth before heuristic documents consume the budget', async (t) => {
  const root = makeRoot(t)
  const project = join(root, 'Deep Managed Project')
  mkdirSync(project)
  put(project, 'README.md', '# Heuristic document that must not consume the only document slot\n')
  const deepPath = 'docs/deep/nested/architecture/current/ARCHITECTURE.md'
  put(project, deepPath, '# Deep Architecture\n')
  put(project, '.dsh-project/project.yaml', [
    'apiVersion: project-control.dsh/v1alpha1',
    'kind: ProjectManifest',
    'metadata:',
    '  projectId: prj_0198f4b2-7c3a-7d11-a5c6-6b6f39e34712',
    '  name: Deep Managed Project',
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
    '      - role: current_architecture',
    `        path: ${deepPath}`,
    '        required: true',
    '      - role: decision',
    '        path: docs/decisions/future.md',
    '        required: false',
    '    standardOutputs:',
    '      updatesRoot: .dsh-project/updates',
    '      decisionsRoot: .dsh-project/decisions',
    '      artifactsRoot: .dsh-project/artifacts',
  ].join('\n'))

  const candidate = candidateOf(await scanProjectDirectory(project, {
    maxDepth: 0,
    maxDocuments: 1,
  }))

  assert.equal(candidate.detectedMode, 'managed')
  assert.equal(candidate.status, 'discovered')
  assert.deepEqual(candidate.documents.map(document => document.relativePath), [deepPath])
  assert.match(candidate.documents[0].sha256, /^sha256:[0-9a-f]{64}$/)
  assert.equal(candidate.manifestDocumentBindings[0].relativePath, deepPath)
  assert.match(candidate.manifestDocumentBindings[0].contentHash, /^sha256:[0-9a-f]{64}$/)
  assert.equal(candidate.manifestDocumentBindings[1].contentHash, null)
  assert.ok(candidate.issues.some(issue => (
    issue.code === 'MANIFEST_OPTIONAL_DOCUMENT_UNAVAILABLE'
      && issue.severity === 'warning'
  )))
  assert.ok(candidate.issues.every(issue => issue.code !== 'MANIFEST_REQUIRED_DOCUMENT_UNAVAILABLE'))
})

test('a managed manifest preserves multiple decision paths without legacy primary-role warnings', async (t) => {
  const root = makeRoot(t)
  const project = join(root, 'Decision Project')
  mkdirSync(project)
  put(project, 'docs/decisions/001-runtime.md', '# Runtime Decision\n')
  put(project, 'docs/decisions/002-storage.md', '# Storage Decision\n')
  put(project, '.dsh-project/project.yaml', [
    'apiVersion: project-control.dsh/v1alpha1',
    'kind: ProjectManifest',
    'metadata:',
    '  projectId: prj_0198f4b2-7c3a-7d11-a5c6-6b6f39e34713',
    '  name: Decision Project',
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
    '      - role: decision',
    '        path: docs/decisions/001-runtime.md',
    '        required: true',
    '      - role: decision',
    '        path: docs/decisions/002-storage.md',
    '        required: true',
    '    standardOutputs:',
    '      updatesRoot: .dsh-project/updates',
    '      decisionsRoot: .dsh-project/decisions',
    '      artifactsRoot: .dsh-project/artifacts',
  ].join('\n'))

  const candidate = candidateOf(await scanProjectDirectory(project))
  const decisions = candidate.manifestDocumentBindings.filter(binding => binding.role === 'decision')

  assert.equal(candidate.detectedMode, 'managed')
  assert.equal(candidate.status, 'discovered')
  assert.deepEqual(decisions.map(binding => binding.relativePath), [
    'docs/decisions/001-runtime.md',
    'docs/decisions/002-storage.md',
  ])
  assert.ok(decisions.every(binding => /^sha256:[0-9a-f]{64}$/.test(binding.contentHash)))
  assert.ok(candidate.issues.every(issue => issue.code !== 'MULTIPLE_ROLE_CANDIDATES'))
})

test('a missing required manifest document is a blocking scan conflict, not a late manifest error', async (t) => {
  const root = makeRoot(t)
  const project = join(root, 'Missing Required Project')
  mkdirSync(project)
  put(project, '.dsh-project/project.yaml', [
    'apiVersion: project-control.dsh/v1alpha1',
    'kind: ProjectManifest',
    'metadata:',
    '  projectId: prj_0198f4b2-7c3a-7d11-a5c6-6b6f39e34714',
    '  name: Missing Required Project',
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

  const candidate = candidateOf(await scanProjectDirectory(project))

  assert.equal(candidate.detectedMode, 'unknown')
  assert.equal(candidate.status, 'conflict')
  assert.equal(candidate.manifestStatus, 'invalid')
  assert.ok(candidate.issues.some(issue => (
    issue.code === 'MANIFEST_REQUIRED_DOCUMENT_UNAVAILABLE'
      && issue.severity === 'blocking'
  )))
  assert.ok(candidate.issues.every(issue => issue.code !== 'MANIFEST_INVALID'))
})

test('manifest trust is gated by the canonical schema and duplicate binding semantics', async (t) => {
  const root = makeRoot(t)
  const project = join(root, 'Invalid Managed Project')
  mkdirSync(project)
  put(project, 'docs/PRD.md', '# Invalid Managed Project\n')
  put(project, '.dsh-project/project.yaml', [
    'apiVersion: project-control.dsh/v1alpha1',
    'kind: ProjectManifest',
    'metadata:',
    '  projectId: prj_0198f4b2-7c3a-7d11-a5c6-6b6f39e34711',
    '  name: Invalid Managed Project',
    '  createdAt: 2026-02-31T14:00:00.000Z',
    '  createdBy:',
    '    kind: human',
    '    id: cyrus',
    '    displayName: 123',
    '  origin:',
    '    kind: template',
    '    templateId: cyrus.default',
    "    templateVersion: ''",
    'spec:',
    '  documents:',
    '    docsRoot: docs',
    '    entries:',
    '      - role: prd',
    '        path: docs/PRD.md',
    '      - role: prd',
    '        path: docs/PRD.md',
    '        required: true',
    '    standardOutputs:',
    '      updatesRoot: .dsh-project/updates',
    '      decisionsRoot: .dsh-project/decisions',
    '      artifactsRoot: .dsh-project/artifacts',
  ].join('\n'))

  const candidate = candidateOf(await scanProjectDirectory(project))
  assert.equal(candidate.detectedMode, 'unknown')
  assert.equal(candidate.status, 'conflict')
  assert.equal(candidate.manifestStatus, 'invalid')
  assert.ok(candidate.issues.some(issue => issue.code === 'MANIFEST_INVALID' && issue.severity === 'blocking'))
})

test('the scanner envelope persists directly through recordImportScan with bounded evidence objects', async (t) => {
  const root = makeRoot(t)
  const project = join(root, `Cyrus Quant Trading\u200c`)
  mkdirSync(project)
  put(project, 'README.md', '# README without title override?\n')
  const scan = await scanProjectDirectory(project)
  // Force the folder fallback by removing the README H1 from a fresh scan fixture.
  writeFileSync(join(project, 'README.md'), 'Project notes only.\n')
  const fallbackScan = await scanProjectDirectory(project)
  const storage = await openProjectControlStorage({
    databasePath: join(root, 'control', 'project-control.sqlite3'),
    applicationVersion: '0.1.0-test',
    instanceId: 'discovery-storage-compat',
  })
  try {
    assert.equal(candidateOf(fallbackScan).suggestedName, 'Cyrus Quant Trading')
    assert.equal(candidateOf(fallbackScan).displayPath, project)
    assert.ok(candidateOf(scan).documents.every((document) => !Array.isArray(document.evidence)))
    const persisted = storage.recordImportScan(scan)
    const persistedCandidate = persisted.candidates[0]

    assert.equal(persisted.candidates.length, 1)
    assert.equal(persistedCandidate.documents.length, 1)
    assert.ok(Array.isArray(persistedCandidate.documents[0].evidence.signals))
    assert.equal(persistedCandidate.suggestedName, 'README without title override?')
  } finally {
    storage.close()
  }
})
