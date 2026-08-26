import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

import {
  IdempotencyConflictError,
  InvalidStoragePathError,
  MigrationChecksumError,
  MigrationError,
  WriterLockError,
  createPrefixedUuidV7,
  openProjectControlStorage,
} from '../src/host/index.js'

const projectRoot = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const migrationsDirectory = join(projectRoot, 'migrations')
const protocolRoot = join(projectRoot, '..', '..', 'protocol', 'project-control', 'v1alpha1', 'lifecycle')

function jsonFixture(name) {
  return JSON.parse(readFileSync(join(protocolRoot, 'examples', name), 'utf8'))
}

function makeRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-project-control-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

function clock() {
  let tick = 0
  return () => `2026-08-14T12:00:${String(tick++).padStart(2, '0')}.000Z`
}

async function openStorage(root, overrides = {}) {
  return openProjectControlStorage({
    databasePath: join(root, 'project-control.sqlite3'),
    applicationVersion: '0.1.0-test',
    instanceId: overrides.instanceId ?? 'test-host-1',
    migrationsDirectory: overrides.migrationsDirectory ?? migrationsDirectory,
    now: overrides.now ?? clock(),
    idFactory: overrides.idFactory,
  })
}

function replaceId(value, serial) {
  return value.replace(/[0-9a-f]{4}$/, serial.toString(16).padStart(4, '0'))
}

function legacyCommand(serial = 1) {
  const command = jsonFixture('command-register-legacy.valid.json')
  command.commandId = replaceId(command.commandId, 0x100 + serial)
  command.target.projectId = replaceId(command.target.projectId, 0x200 + serial)
  command.payload.locationRef = replaceId(command.payload.locationRef, 0x300 + serial)
  command.idempotencyKey = `project.register-legacy.${String(serial).padStart(3, '0')}`
  command.correlationId = `corr.lifecycle.register-legacy.${serial}`
  return command
}

function trustedRegistration(root, command, serial = 1, overrides = {}) {
  const displayPath = join(root, `Project-${serial}`)
  return {
    location: {
      locationId: command.payload.locationRef,
      kind: 'primary',
      displayPath,
      normalizedPath: displayPath.toLowerCase(),
      verifiedAt: '2026-08-14T12:00:00.000Z',
    },
    eventId: replaceId('evt_0198f4b2-7c3a-7d71-a5c6-6b6f39e34771', 0x400 + serial),
    outboxId: overrides.outboxId
      ?? replaceId('out_0198f4b2-7c3a-7d81-a5c6-6b6f39e34781', 0x500 + serial),
  }
}

function rebindCommand(projectCommand, serial = 1, expectedRevision = 1) {
  const command = jsonFixture('command-rebind-location.valid.json')
  command.commandId = replaceId(command.commandId, 0x600 + serial)
  command.target.projectId = projectCommand.target.projectId
  command.expectedRevision = expectedRevision
  command.payload.expectedMode = 'linked_legacy'
  command.payload.currentLocationRef = projectCommand.payload.locationRef
  command.payload.currentLocationRevision = 1
  command.payload.newLocationRef = replaceId(command.payload.newLocationRef, 0x700 + serial)
  command.payload.identityEvidence = {
    kind: 'legacy_fingerprint',
    fingerprintHash: `sha256:${'2'.repeat(64)}`,
    contentHashes: [`sha256:${'3'.repeat(64)}`],
  }
  command.idempotencyKey = `project.rebind-location.${String(serial).padStart(3, '0')}`
  command.correlationId = `corr.lifecycle.rebind-location.${serial}`
  return command
}

function trustedRebind(root, command, serial = 1) {
  const displayPath = join(root, `Project-${serial}-moved`)
  return {
    newLocation: {
      locationId: command.payload.newLocationRef,
      kind: 'primary',
      displayPath,
      normalizedPath: displayPath.toLowerCase(),
      verifiedAt: '2026-08-14T12:01:00.000Z',
    },
    eventId: replaceId('evt_0198f4b2-7c3a-7d74-a5c6-6b6f39e34774', 0x800 + serial),
    outboxId: replaceId('out_0198f4b2-7c3a-7d84-a5c6-6b6f39e34784', 0x900 + serial),
    historyId: replaceId('pth_0198f4b2-7c3a-7da4-a5c6-6b6f39e347a4', 0xa00 + serial),
  }
}

function intakeScan(root, overrides = {}) {
  const sourcePath = overrides.sourcePath ?? join(root, 'Projects')
  const candidatePath = overrides.candidatePath ?? join(sourcePath, 'Alpha')
  return {
    mode: overrides.mode ?? 'source_root',
    rootPath: {
      displayPath: overrides.rootPath ?? sourcePath,
      normalizedPath: (overrides.rootPath ?? sourcePath).toLowerCase(),
    },
    sourceRoot: overrides.sourceRoot === undefined
      ? {
          displayPath: sourcePath,
          normalizedPath: sourcePath.toLowerCase(),
          scanPreferences: { maxDepth: 3, ignoredDirectories: ['node_modules'] },
        }
      : overrides.sourceRoot,
    scanPreferences: { maxDepth: 3, ignoredDirectories: ['node_modules'] },
    scannerVersion: 'gate2c-test/1',
    status: overrides.jobStatus ?? 'completed',
    summary: { candidateCount: overrides.candidates?.length ?? 1, readOnly: true },
    candidates: overrides.candidates ?? [{
      root: { displayPath: candidatePath, normalizedPath: candidatePath.toLowerCase() },
      detectedMode: 'linked_legacy',
      ...(overrides.manifestProjectId === undefined
        ? {}
        : { manifestProjectId: overrides.manifestProjectId }),
      suggestedName: 'Alpha',
      suggestedSummary: 'A bounded import candidate.',
      summarySource: 'README.md#goal',
      confidence: { level: 'high', evidence: ['README.md', 'docs/PRD.md'] },
      status: overrides.candidateStatus ?? 'discovered',
      documents: [{
        relativePath: 'README.md',
        suggestedRole: 'readme',
        sha256: `sha256:${'a'.repeat(64)}`,
        title: 'Alpha',
        preview: 'Short preview only.',
        observedAt: '2026-08-14T12:00:00.000Z',
        evidence: { matchedBy: 'file_name_and_heading' },
      }],
      issues: [{
        code: 'MISSING_DEVLOG',
        severity: 'warning',
        details: { role: 'devlog' },
      }],
    }],
  }
}

test('UUIDv7 business IDs preserve timestamp, version, variant, and lowercase wire shape', () => {
  const id = createPrefixedUuidV7('evt', {
    nowMs: 1_723_636_800_000,
    randomBytes: Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
  })
  assert.match(id, /^evt_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
})

test('first open migrates, close releases the lock, and reopen does not rerun migration', async (t) => {
  const root = makeRoot(t)
  const first = await openStorage(root)
  assert.deepEqual(
    {
      state: first.status().state,
      schemaVersion: first.status().schemaVersion,
      applied: first.status().migrationsAppliedThisOpen,
      projectCount: first.status().projectCount,
    },
    { state: 'ready', schemaVersion: 9, applied: 9, projectCount: 0 },
  )
  first.close()
  assert.equal(first.status().state, 'closed')

  const second = await openStorage(root, { instanceId: 'test-host-2' })
  assert.equal(second.status().schemaVersion, 9)
  assert.equal(second.status().migrationsAppliedThisOpen, 0)
  second.close()
})

test('source entry resolves its default migration directory without caller help', async (t) => {
  const root = makeRoot(t)
  const storage = await openProjectControlStorage({
    databasePath: join(root, 'project-control.sqlite3'),
    applicationVersion: '0.1.0-test',
    instanceId: 'test-default-migrations',
  })
  assert.equal(storage.status().schemaVersion, 9)
  storage.close()
})

test('storage rejects direct UNC and extended UNC database paths', async () => {
  for (const databasePath of [
    '\\\\server\\share\\project-control.sqlite3',
    '//server/share/project-control.sqlite3',
    '\\\\?\\UNC\\server\\share\\project-control.sqlite3',
  ]) {
    await assert.rejects(
      openProjectControlStorage({
        databasePath,
        applicationVersion: '0.1.0-test',
        instanceId: 'test-network-path',
      }),
      (error) => error instanceof InvalidStoragePathError
        && error.details.reason === 'network_paths_are_not_supported',
    )
  }
})

test('trusted project resolution cannot reintroduce a UNC workspace path', async (t) => {
  const root = makeRoot(t)
  const storage = await openStorage(root)
  const command = legacyCommand(12)
  const trusted = trustedRegistration(root, command, 12)
  trusted.location.displayPath = '\\\\server\\share\\Project-12'
  trusted.location.normalizedPath = '\\\\server\\share\\project-12'
  assert.throws(() => storage.registerProject(command, trusted), /absolute local paths/)
  assert.equal(storage.status().projectCount, 0)
  storage.close()
})

test('an independent SQLite BEGIN EXCLUSIVE lock rejects a second lifecycle writer', async (t) => {
  const root = makeRoot(t)
  const first = await openStorage(root)
  await assert.rejects(
    openStorage(root, { instanceId: 'test-host-2' }),
    (error) => error instanceof WriterLockError && error.code === 'WRITER_ALREADY_ACTIVE',
  )
  first.close()
})

test('callers cannot bypass the database-derived writer lock with another lock file', async (t) => {
  const root = makeRoot(t)
  const databasePath = join(root, 'project-control.sqlite3')
  await assert.rejects(
    openProjectControlStorage({
      databasePath,
      lockPath: join(root, 'alternate-lock.sqlite3'),
      applicationVersion: '0.1.0-test',
      instanceId: 'test-host-bypass',
    }),
    (error) => error instanceof InvalidStoragePathError
      && error.code === 'INVALID_STORAGE_PATH'
      && /cannot override/.test(error.message),
  )
})

test('migration history rejects checksum drift before opening the Host', async (t) => {
  const root = makeRoot(t)
  const copiedMigrations = join(root, 'migrations')
  cpSync(migrationsDirectory, copiedMigrations, { recursive: true })
  const first = await openStorage(root, { migrationsDirectory: copiedMigrations })
  first.close()

  const migrationPath = join(copiedMigrations, '0001_core_control_plane.sql')
  writeFileSync(migrationPath, `${readFileSync(migrationPath, 'utf8')}\n-- forbidden drift\n`, 'utf8')
  await assert.rejects(
    openStorage(root, { migrationsDirectory: copiedMigrations, instanceId: 'test-host-2' }),
    (error) => error instanceof MigrationChecksumError && error.code === 'MIGRATION_CHECKSUM_MISMATCH',
  )
})

test('a database created with only migration 0001 upgrades through 0002 with a backup', async (t) => {
  const root = makeRoot(t)
  const stagedMigrations = join(root, 'staged-migrations')
  mkdirSync(stagedMigrations)
  cpSync(
    join(migrationsDirectory, '0001_core_control_plane.sql'),
    join(stagedMigrations, '0001_core_control_plane.sql'),
  )
  const first = await openStorage(root, { migrationsDirectory: stagedMigrations })
  assert.equal(first.status().schemaVersion, 1)
  first.close()

  cpSync(
    join(migrationsDirectory, '0002_registration_state.sql'),
    join(stagedMigrations, '0002_registration_state.sql'),
  )
  const second = await openStorage(root, {
    migrationsDirectory: stagedMigrations,
    instanceId: 'test-host-after-0001',
  })
  assert.equal(second.status().schemaVersion, 2)
  assert.equal(second.status().migrationsAppliedThisOpen, 1)
  assert.ok(second.status().migrationBackupPath)
  second.close()
})

test('a database at migration 0002 upgrades through 0003 and keeps an online backup', async (t) => {
  const root = makeRoot(t)
  const stagedMigrations = join(root, 'staged-migrations')
  mkdirSync(stagedMigrations)
  for (const name of ['0001_core_control_plane.sql', '0002_registration_state.sql']) {
    cpSync(join(migrationsDirectory, name), join(stagedMigrations, name))
  }
  const first = await openStorage(root, { migrationsDirectory: stagedMigrations })
  assert.equal(first.status().schemaVersion, 2)
  first.close()

  cpSync(
    join(migrationsDirectory, '0003_intake_discovery.sql'),
    join(stagedMigrations, '0003_intake_discovery.sql'),
  )
  const second = await openStorage(root, {
    migrationsDirectory: stagedMigrations,
    instanceId: 'test-host-after-0002',
  })
  assert.equal(second.status().schemaVersion, 3)
  assert.equal(second.status().migrationsAppliedThisOpen, 1)
  assert.ok(second.status().migrationBackupPath)
  const backup = new DatabaseSync(second.status().migrationBackupPath)
  assert.deepEqual(
    backup.prepare('SELECT version FROM schema_migrations ORDER BY version').all()
      .map((row) => Number(row.version)),
    [1, 2],
  )
  backup.close()
  second.close()
})

test('a database at migration 0003 upgrades through 0004 with a backup and NOCASE indexes', async (t) => {
  const root = makeRoot(t)
  const stagedMigrations = join(root, 'staged-migrations')
  mkdirSync(stagedMigrations)
  for (const name of [
    '0001_core_control_plane.sql',
    '0002_registration_state.sql',
    '0003_intake_discovery.sql',
  ]) {
    cpSync(join(migrationsDirectory, name), join(stagedMigrations, name))
  }
  const first = await openStorage(root, { migrationsDirectory: stagedMigrations })
  assert.equal(first.status().schemaVersion, 3)
  first.close()

  cpSync(
    join(migrationsDirectory, '0004_windows_path_nocase.sql'),
    join(stagedMigrations, '0004_windows_path_nocase.sql'),
  )
  const second = await openStorage(root, {
    migrationsDirectory: stagedMigrations,
    instanceId: 'test-host-after-0003',
  })
  assert.equal(second.status().schemaVersion, 4)
  assert.equal(second.status().migrationsAppliedThisOpen, 1)
  assert.ok(second.status().migrationBackupPath)
  const database = new DatabaseSync(join(root, 'project-control.sqlite3'))
  const indexes = database.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'index' AND name LIKE '%_nocase_unique'
    ORDER BY name
  `).all().map(row => row.name)
  assert.deepEqual(indexes, [
    'project_source_roots_normalized_path_nocase_unique',
    'workspace_locations_active_path_nocase_unique',
  ])
  database.close()
  second.close()
})

test('migration 0004 safely fails and preserves case-only duplicate source roots', async (t) => {
  const root = makeRoot(t)
  const stagedMigrations = join(root, 'staged-migrations')
  mkdirSync(stagedMigrations)
  for (const name of [
    '0001_core_control_plane.sql',
    '0002_registration_state.sql',
    '0003_intake_discovery.sql',
  ]) {
    cpSync(join(migrationsDirectory, name), join(stagedMigrations, name))
  }
  const first = await openStorage(root, { migrationsDirectory: stagedMigrations })
  first.close()

  const databasePath = join(root, 'project-control.sqlite3')
  const legacy = new DatabaseSync(databasePath)
  const insert = legacy.prepare(`
    INSERT INTO project_source_roots(
      source_root_id, kind, display_path, normalized_path,
      scan_preferences_json, is_enabled, revision, created_at, updated_at
    ) VALUES (?, 'source_root', ?, ?, '{}', 1, 1, ?, ?)
  `)
  const timestamp = '2026-08-15T00:00:00.000Z'
  insert.run(createPrefixedUuidV7('src'), 'D:\\CasePath', 'D:\\CasePath', timestamp, timestamp)
  insert.run(createPrefixedUuidV7('src'), 'd:\\casepath', 'd:\\casepath', timestamp, timestamp)
  legacy.close()
  cpSync(
    join(migrationsDirectory, '0004_windows_path_nocase.sql'),
    join(stagedMigrations, '0004_windows_path_nocase.sql'),
  )

  let failure
  await assert.rejects(
    openStorage(root, {
      migrationsDirectory: stagedMigrations,
      instanceId: 'test-host-duplicate-case-migration',
    }),
    (error) => {
      failure = error
      return error instanceof MigrationError
        && error.code === 'MIGRATION_FAILED'
        && /UNIQUE constraint failed/.test(error.details?.causeMessage ?? '')
    },
  )
  assert.ok(failure.details.backupPath)
  assert.ok(readFileSync(failure.details.backupPath).length > 0)
  const preserved = new DatabaseSync(databasePath)
  assert.deepEqual(
    preserved.prepare('SELECT version FROM schema_migrations ORDER BY version').all()
      .map(row => Number(row.version)),
    [1, 2, 3],
  )
  assert.equal(preserved.prepare('SELECT count(*) AS count FROM project_source_roots').get().count, 2)
  preserved.close()
})

test('a database at migration 0004 upgrades through 0005 with versioned Unicode path keys and a backup', async (t) => {
  const root = makeRoot(t)
  const stagedMigrations = join(root, 'staged-migrations')
  mkdirSync(stagedMigrations)
  for (const name of [
    '0001_core_control_plane.sql',
    '0002_registration_state.sql',
    '0003_intake_discovery.sql',
    '0004_windows_path_nocase.sql',
  ]) {
    cpSync(join(migrationsDirectory, name), join(stagedMigrations, name))
  }
  const first = await openStorage(root, { migrationsDirectory: stagedMigrations })
  assert.equal(first.status().schemaVersion, 4)
  first.close()

  const databasePath = join(root, 'project-control.sqlite3')
  const schema4 = new DatabaseSync(databasePath)
  const timestamp = '2026-08-15T00:00:00.000Z'
  const sourceRootId = createPrefixedUuidV7('src')
  schema4.prepare(`
    INSERT INTO project_source_roots(
      source_root_id, kind, display_path, normalized_path,
      scan_preferences_json, is_enabled, revision, created_at, updated_at
    ) VALUES (?, 'source_root', ?, ?, '{}', 1, 1, ?, ?)
  `).run(sourceRootId, 'D:\\MÄP', 'D:\\MÄP', timestamp, timestamp)
  schema4.close()
  cpSync(
    join(migrationsDirectory, '0005_windows_unicode_path_key.sql'),
    join(stagedMigrations, '0005_windows_unicode_path_key.sql'),
  )

  const second = await openStorage(root, {
    migrationsDirectory: stagedMigrations,
    instanceId: 'test-host-after-0004',
  })
  assert.equal(second.status().schemaVersion, 5)
  assert.equal(second.status().migrationsAppliedThisOpen, 1)
  assert.ok(second.status().migrationBackupPath)

  const upgraded = new DatabaseSync(databasePath)
  assert.equal(
    upgraded.prepare(`
      SELECT path_key AS pathKey FROM project_source_roots WHERE source_root_id = ?
    `).get(sourceRootId).pathKey,
    'windows-unicode-v1:d:\\mäp',
  )
  const indexes = upgraded.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'index' AND name LIKE '%path_key_unique'
    ORDER BY name
  `).all().map(row => row.name)
  assert.deepEqual(indexes, [
    'import_candidates_job_path_key_unique',
    'project_source_roots_path_key_unique',
    'workspace_locations_active_path_key_unique',
  ])
  upgraded.close()

  const backup = new DatabaseSync(second.status().migrationBackupPath)
  assert.deepEqual(
    backup.prepare('SELECT version FROM schema_migrations ORDER BY version').all()
      .map(row => Number(row.version)),
    [1, 2, 3, 4],
  )
  assert.equal(
    backup.prepare(`PRAGMA table_info(project_source_roots)`).all()
      .some(column => column.name === 'path_key'),
    false,
  )
  backup.close()
  second.close()
})

test('migration 0005 safely fails and preserves Unicode case-equivalent source roots', async (t) => {
  const root = makeRoot(t)
  const stagedMigrations = join(root, 'staged-migrations')
  mkdirSync(stagedMigrations)
  for (const name of [
    '0001_core_control_plane.sql',
    '0002_registration_state.sql',
    '0003_intake_discovery.sql',
    '0004_windows_path_nocase.sql',
  ]) {
    cpSync(join(migrationsDirectory, name), join(stagedMigrations, name))
  }
  const first = await openStorage(root, { migrationsDirectory: stagedMigrations })
  first.close()

  const databasePath = join(root, 'project-control.sqlite3')
  const schema4 = new DatabaseSync(databasePath)
  const insert = schema4.prepare(`
    INSERT INTO project_source_roots(
      source_root_id, kind, display_path, normalized_path,
      scan_preferences_json, is_enabled, revision, created_at, updated_at
    ) VALUES (?, 'source_root', ?, ?, '{}', 1, 1, ?, ?)
  `)
  const timestamp = '2026-08-15T00:00:00.000Z'
  insert.run(createPrefixedUuidV7('src'), 'D:\\MÄP', 'D:\\MÄP', timestamp, timestamp)
  insert.run(createPrefixedUuidV7('src'), 'D:\\MäP', 'D:\\MäP', timestamp, timestamp)
  schema4.close()
  cpSync(
    join(migrationsDirectory, '0005_windows_unicode_path_key.sql'),
    join(stagedMigrations, '0005_windows_unicode_path_key.sql'),
  )

  let failure
  await assert.rejects(
    openStorage(root, {
      migrationsDirectory: stagedMigrations,
      instanceId: 'test-host-duplicate-unicode-migration',
    }),
    (error) => {
      failure = error
      return error instanceof MigrationError
        && error.code === 'MIGRATION_FAILED'
        && /UNIQUE constraint failed/.test(error.details?.causeMessage ?? '')
    },
  )
  assert.ok(failure.details.backupPath)
  assert.ok(readFileSync(failure.details.backupPath).length > 0)
  const preserved = new DatabaseSync(databasePath)
  assert.deepEqual(
    preserved.prepare('SELECT version FROM schema_migrations ORDER BY version').all()
      .map(row => Number(row.version)),
    [1, 2, 3, 4],
  )
  assert.equal(preserved.prepare('SELECT count(*) AS count FROM project_source_roots').get().count, 2)
  assert.equal(
    preserved.prepare(`PRAGMA table_info(project_source_roots)`).all()
      .some(column => column.name === 'path_key'),
    false,
  )
  preserved.close()
})

test('a pre-migration online backup is created before applying a later migration', async (t) => {
  const root = makeRoot(t)
  const copiedMigrations = join(root, 'migrations')
  cpSync(migrationsDirectory, copiedMigrations, { recursive: true })
  const first = await openStorage(root, { migrationsDirectory: copiedMigrations })
  first.close()

  writeFileSync(
    join(copiedMigrations, '0010_probe.sql'),
    'CREATE TABLE migration_probe (id INTEGER PRIMARY KEY) STRICT;\n',
    'utf8',
  )
  const second = await openStorage(root, {
    migrationsDirectory: copiedMigrations,
    instanceId: 'test-host-2',
  })
  assert.equal(second.status().schemaVersion, 10)
  assert.equal(second.status().migrationsAppliedThisOpen, 1)
  assert.ok(second.status().migrationBackupPath)
  assert.equal(readFileSync(second.status().migrationBackupPath).length > 0, true)
  second.close()
})

test('same full command replays, while the same key with a changed full request conflicts', async (t) => {
  const root = makeRoot(t)
  const storage = await openStorage(root)
  t.after(() => storage.close())
  const command = legacyCommand(1)
  const trusted = trustedRegistration(root, command, 1)

  assert.equal(storage.replayCommandReceipt(command), null)
  const accepted = storage.registerProject(command, trusted)
  const receiptReplay = storage.replayCommandReceipt(structuredClone(command))
  const replayed = storage.registerProject(structuredClone(command), {
    ...trusted,
    eventId: replaceId(trusted.eventId, 0x999),
  })
  assert.equal(accepted.status, 'accepted')
  assert.equal(receiptReplay.status, 'replayed')
  assert.equal(receiptReplay.eventId, accepted.eventId)
  assert.equal(replayed.status, 'replayed')
  assert.equal(replayed.eventId, accepted.eventId)
  assert.equal(storage.listEvents().length, 1)
  assert.equal(storage.listOutbox().length, 1)
  assert.deepEqual(
    storage.getProject(command.target.projectId).documentBindings.map(
      ({ role, relativePath, contentHash, source }) => ({ role, relativePath, contentHash, source }),
    ),
    [
      {
        role: 'prd',
        relativePath: 'docs/PRD.md',
        contentHash: `sha256:${'b'.repeat(64)}`,
        source: 'user_confirmed',
      },
      {
        role: 'readme',
        relativePath: 'README.md',
        contentHash: `sha256:${'a'.repeat(64)}`,
        source: 'user_confirmed',
      },
    ],
  )

  const changed = structuredClone(command)
  changed.payload.name = 'Changed after first acceptance'
  assert.throws(
    () => storage.registerProject(changed, trusted),
    (error) => error instanceof IdempotencyConflictError && error.code === 'IDEMPOTENCY_CONFLICT',
  )
  assert.throws(
    () => storage.replayCommandReceipt(changed),
    (error) => error instanceof IdempotencyConflictError && error.code === 'IDEMPOTENCY_CONFLICT',
  )
  const changedCommandId = structuredClone(command)
  changedCommandId.commandId = replaceId(command.commandId, 0x998)
  assert.throws(
    () => storage.replayCommandReceipt(changedCommandId),
    (error) => error instanceof IdempotencyConflictError
      && error.code === 'IDEMPOTENCY_CONFLICT'
      && error.details.matchedBy === 'idempotencyKey',
  )
  storage.close()
})

test('default UUIDv7 factory creates schema-valid event and outbox identities', async (t) => {
  const root = makeRoot(t)
  const storage = await openStorage(root)
  t.after(() => storage.close())
  const command = legacyCommand(11)
  const trusted = trustedRegistration(root, command, 11)
  delete trusted.eventId
  delete trusted.outboxId

  const result = storage.registerProject(command, trusted)
  assert.match(result.eventId, /^evt_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  assert.match(storage.listOutbox()[0].outboxId, /^out_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  storage.close()
})

test('managed registration stores the verified manifest name outside the command hash boundary', async (t) => {
  const root = makeRoot(t)
  const storage = await openStorage(root)
  t.after(() => storage.close())
  const command = jsonFixture('command-register-managed.valid.json')
  command.commandId = replaceId(command.commandId, 0xb01)
  command.target.projectId = replaceId(command.target.projectId, 0xb02)
  command.payload.locationRef = replaceId(command.payload.locationRef, 0xb03)
  command.idempotencyKey = 'project.register-managed.101'
  const trusted = trustedRegistration(root, command, 101)
  trusted.manifestName = 'Managed From Verified Manifest'
  trusted.manifestHash = command.payload.manifestHash
  trusted.manifestDocumentBindings = [{
    role: 'readme',
    relativePath: 'README.md',
    required: true,
  }, {
    role: 'prd',
    relativePath: 'docs/PRD.md',
    required: true,
  }]

  const result = storage.registerProject(command, trusted)
  assert.equal(result.projectMode, 'managed')
  assert.deepEqual(result.fileSync, {
    status: 'verified_existing',
    manifestHash: command.payload.manifestHash,
  })
  const storedProject = storage.getProject(command.target.projectId)
  assert.equal(storedProject.name, trusted.manifestName)
  assert.deepEqual(
    storedProject.documentBindings.map(({ role, relativePath, source }) => ({ role, relativePath, source })),
    [
      { role: 'prd', relativePath: 'docs/PRD.md', source: 'manifest' },
      { role: 'readme', relativePath: 'README.md', source: 'manifest' },
    ],
  )
  assert.equal(storedProject.manifestMirror.manifestHash, command.payload.manifestHash)
  assert.equal(storedProject.manifestMirror.name, trusted.manifestName)
  assert.deepEqual(storedProject.manifestMirror.documentBindings, [
    {
      role: 'readme',
      relativePath: 'README.md',
      contentHash: null,
      required: true,
      source: 'manifest',
    },
    {
      role: 'prd',
      relativePath: 'docs/PRD.md',
      contentHash: null,
      required: true,
      source: 'manifest',
    },
  ])

  const ajv = new Ajv2020({ strict: true, allErrors: true })
  addFormats(ajv)
  const resultSchema = JSON.parse(readFileSync(join(protocolRoot, 'schemas', 'lifecycle-command-result.schema.json'), 'utf8'))
  const validateResult = ajv.compile(resultSchema)
  assert.equal(validateResult(result), true, JSON.stringify(validateResult.errors))
  storage.close()
})

test('revision conflict is persisted as a replayable rejection without event or outbox', async (t) => {
  const root = makeRoot(t)
  const storage = await openStorage(root)
  t.after(() => storage.close())
  const registered = legacyCommand(2)
  storage.registerProject(registered, trustedRegistration(root, registered, 2))
  const stale = rebindCommand(registered, 2, 9)

  const rejected = storage.rebindProject(stale, trustedRebind(root, stale, 2))
  const replayed = storage.rebindProject(structuredClone(stale), trustedRebind(root, stale, 2))
  assert.equal(rejected.status, 'rejected')
  assert.equal(rejected.error.code, 'REVISION_CONFLICT')
  assert.deepEqual(replayed, rejected)
  assert.equal(storage.getCommandReceipt(stale.commandId).status, 'rejected')
  assert.equal(storage.listEvents().length, 1)
  assert.equal(storage.listOutbox().length, 1)
  assert.equal(storage.getProject(registered.target.projectId).revision, 1)
  storage.close()
})

test('register location conflict is a persisted replayable rejection with no half project', async (t) => {
  const root = makeRoot(t)
  const storage = await openStorage(root)
  t.after(() => storage.close())
  const ownerCommand = legacyCommand(20)
  const ownerTrusted = trustedRegistration(root, ownerCommand, 20)
  storage.registerProject(ownerCommand, ownerTrusted)

  const conflictingCommand = legacyCommand(21)
  const conflictingTrusted = trustedRegistration(root, conflictingCommand, 21)
  conflictingTrusted.location.normalizedPath = ownerTrusted.location.normalizedPath
  const rejected = storage.registerProject(conflictingCommand, conflictingTrusted)
  const replayed = storage.registerProject(structuredClone(conflictingCommand), conflictingTrusted)

  assert.equal(rejected.status, 'rejected')
  assert.equal(rejected.error.code, 'LOCATION_CONFLICT')
  assert.deepEqual(replayed, rejected)
  assert.equal(storage.getCommandReceipt(conflictingCommand.commandId).error.code, 'LOCATION_CONFLICT')
  assert.equal(storage.getProject(conflictingCommand.target.projectId), null)
  assert.equal(storage.status().projectCount, 1)
  assert.equal(storage.listEvents().length, 1)
  assert.equal(storage.listOutbox().length, 1)
  storage.close()
})

test('rebind location conflict preserves both active paths and writes only a rejection receipt', async (t) => {
  const root = makeRoot(t)
  const storage = await openStorage(root)
  t.after(() => storage.close())
  const firstCommand = legacyCommand(22)
  const firstTrusted = trustedRegistration(root, firstCommand, 22)
  const secondCommand = legacyCommand(23)
  const secondTrusted = trustedRegistration(root, secondCommand, 23)
  storage.registerProject(firstCommand, firstTrusted)
  storage.registerProject(secondCommand, secondTrusted)

  const rebind = rebindCommand(firstCommand, 22, 1)
  const conflictingTrusted = trustedRebind(root, rebind, 22)
  conflictingTrusted.newLocation.normalizedPath = secondTrusted.location.normalizedPath
  const rejected = storage.rebindProject(rebind, conflictingTrusted)
  const replayed = storage.rebindProject(structuredClone(rebind), conflictingTrusted)

  assert.equal(rejected.status, 'rejected')
  assert.equal(rejected.error.code, 'LOCATION_CONFLICT')
  assert.deepEqual(replayed, rejected)
  assert.equal(storage.getCommandReceipt(rebind.commandId).error.code, 'LOCATION_CONFLICT')
  const firstProject = storage.getProject(firstCommand.target.projectId)
  const secondProject = storage.getProject(secondCommand.target.projectId)
  assert.equal(firstProject.revision, 1)
  assert.equal(firstProject.workspaceLocations.filter(({ isActive }) => isActive).length, 1)
  assert.equal(firstProject.workspaceLocations.find(({ isActive }) => isActive).locationId, firstTrusted.location.locationId)
  assert.equal(secondProject.workspaceLocations.find(({ isActive }) => isActive).locationId, secondTrusted.location.locationId)
  assert.equal(storage.listEvents().length, 2)
  assert.equal(storage.listOutbox().length, 2)
  storage.close()
})

test('register and rebind reject active Windows paths that differ only by letter case', async (t) => {
  const root = makeRoot(t)
  const storage = await openStorage(root)
  t.after(() => storage.close())
  const ownerCommand = legacyCommand(120)
  const ownerTrusted = trustedRegistration(root, ownerCommand, 120)
  storage.registerProject(ownerCommand, ownerTrusted)

  const caseOnlyCommand = legacyCommand(121)
  const caseOnlyTrusted = trustedRegistration(root, caseOnlyCommand, 121)
  caseOnlyTrusted.location.displayPath = ownerTrusted.location.displayPath.toUpperCase()
  caseOnlyTrusted.location.normalizedPath = ownerTrusted.location.normalizedPath.toUpperCase()
  const registerRejected = storage.registerProject(caseOnlyCommand, caseOnlyTrusted)
  assert.equal(registerRejected.status, 'rejected')
  assert.equal(registerRejected.error.code, 'LOCATION_CONFLICT')
  assert.equal(storage.getProject(caseOnlyCommand.target.projectId), null)

  const otherCommand = legacyCommand(122)
  const otherTrusted = trustedRegistration(root, otherCommand, 122)
  storage.registerProject(otherCommand, otherTrusted)
  const rebind = rebindCommand(ownerCommand, 123, 1)
  const rebindTrusted = trustedRebind(root, rebind, 123)
  rebindTrusted.newLocation.displayPath = otherTrusted.location.displayPath.toUpperCase()
  rebindTrusted.newLocation.normalizedPath = otherTrusted.location.normalizedPath.toUpperCase()
  const rebindRejected = storage.rebindProject(rebind, rebindTrusted)
  assert.equal(rebindRejected.status, 'rejected')
  assert.equal(rebindRejected.error.code, 'LOCATION_CONFLICT')
  assert.equal(storage.getProject(ownerCommand.target.projectId).revision, 1)
  assert.equal(
    storage.getProject(ownerCommand.target.projectId).workspaceLocations
      .find(location => location.isActive).locationId,
    ownerTrusted.location.locationId,
  )
  assert.equal(
    storage.getProject(otherCommand.target.projectId).workspaceLocations
      .find(location => location.isActive).locationId,
    otherTrusted.location.locationId,
  )
  storage.close()
})

test('register and rebind reject active Windows paths that differ only by Unicode case', async (t) => {
  const root = makeRoot(t)
  const storage = await openStorage(root)
  t.after(() => storage.close())
  const ownerCommand = legacyCommand(124)
  const ownerTrusted = trustedRegistration(root, ownerCommand, 124)
  ownerTrusted.location.displayPath = join(root, 'MÄP-owner')
  ownerTrusted.location.normalizedPath = join(root, 'MÄP-owner')
  storage.registerProject(ownerCommand, ownerTrusted)

  const unicodeCaseCommand = legacyCommand(125)
  const unicodeCaseTrusted = trustedRegistration(root, unicodeCaseCommand, 125)
  unicodeCaseTrusted.location.displayPath = join(root, 'MäP-owner')
  unicodeCaseTrusted.location.normalizedPath = join(root, 'MäP-owner')
  const registerRejected = storage.registerProject(unicodeCaseCommand, unicodeCaseTrusted)
  assert.equal(registerRejected.status, 'rejected')
  assert.equal(registerRejected.error.code, 'LOCATION_CONFLICT')
  assert.equal(storage.getProject(unicodeCaseCommand.target.projectId), null)

  const otherCommand = legacyCommand(126)
  const otherTrusted = trustedRegistration(root, otherCommand, 126)
  otherTrusted.location.displayPath = join(root, 'TÄRGET')
  otherTrusted.location.normalizedPath = join(root, 'TÄRGET')
  storage.registerProject(otherCommand, otherTrusted)
  const rebind = rebindCommand(ownerCommand, 127, 1)
  const rebindTrusted = trustedRebind(root, rebind, 127)
  rebindTrusted.newLocation.displayPath = join(root, 'TäRGET')
  rebindTrusted.newLocation.normalizedPath = join(root, 'TäRGET')
  const rebindRejected = storage.rebindProject(rebind, rebindTrusted)
  assert.equal(rebindRejected.status, 'rejected')
  assert.equal(rebindRejected.error.code, 'LOCATION_CONFLICT')
  assert.equal(storage.getProject(ownerCommand.target.projectId).revision, 1)
  assert.equal(
    storage.getProject(ownerCommand.target.projectId).workspaceLocations
      .find(location => location.isActive).locationId,
    ownerTrusted.location.locationId,
  )
  assert.equal(
    storage.getProject(otherCommand.target.projectId).workspaceLocations
      .find(location => location.isActive).locationId,
    otherTrusted.location.locationId,
  )
  storage.close()
})

test('an outbox failure rolls back project, path, receipt, event, and sequence together', async (t) => {
  const root = makeRoot(t)
  const storage = await openStorage(root)
  t.after(() => storage.close())
  const firstCommand = legacyCommand(3)
  const firstTrusted = trustedRegistration(root, firstCommand, 3)
  storage.registerProject(firstCommand, firstTrusted)

  const failingCommand = legacyCommand(4)
  const failingTrusted = trustedRegistration(root, failingCommand, 4, {
    outboxId: firstTrusted.outboxId,
  })
  assert.throws(() => storage.registerProject(failingCommand, failingTrusted), /UNIQUE constraint failed/)
  assert.equal(storage.getProject(failingCommand.target.projectId), null)
  assert.equal(storage.getCommandReceipt(failingCommand.commandId), null)
  assert.deepEqual(storage.listEvents().map((event) => event.sequence), [1])
  assert.equal(storage.listOutbox().length, 1)
  assert.equal(storage.status().projectCount, 1)
  storage.close()
})

test('registration and rebind produce contiguous events, one outbox each, and one active path', async (t) => {
  const root = makeRoot(t)
  const storage = await openStorage(root)
  t.after(() => storage.close())
  const registered = legacyCommand(5)
  const firstResult = storage.registerProject(registered, trustedRegistration(root, registered, 5))
  const rebind = rebindCommand(registered, 5, 1)
  const secondResult = storage.rebindProject(rebind, trustedRebind(root, rebind, 5))

  assert.equal(firstResult.aggregateRevision, 1)
  assert.equal(secondResult.aggregateRevision, 2)
  const events = storage.listEvents()
  assert.deepEqual(events.map((event) => event.sequence), [1, 2])
  assert.deepEqual(events.map((event) => event.eventType), [
    'project.legacy.registered',
    'project.location.rebound',
  ])
  const project = storage.getProject(registered.target.projectId)
  assert.equal(project.revision, 2)
  assert.equal(project.workspaceLocations.filter((location) => location.isActive).length, 1)
  assert.equal(project.workspaceLocations.find((location) => location.isActive).locationId, rebind.payload.newLocationRef)

  const outbox = storage.listOutbox()
  assert.equal(outbox.length, 2)
  assert.deepEqual(outbox.map((message) => message.payload.sequence), [1, 2])
  const ajv = new Ajv2020({ strict: true, allErrors: true })
  addFormats(ajv)
  const eventSchema = JSON.parse(readFileSync(join(protocolRoot, 'schemas', 'lifecycle-normalized-event.schema.json'), 'utf8'))
  const validateEvent = ajv.compile(eventSchema)
  for (const message of outbox) {
    assert.equal(validateEvent(message.payload), true, JSON.stringify(validateEvent.errors))
  }
  storage.close()
})

test('service-level deterministic rejection is stored, replayed, and hash protected', async (t) => {
  const root = makeRoot(t)
  const storage = await openStorage(root)
  t.after(() => storage.close())
  const command = jsonFixture('command-create-template.valid.json')
  const rejection = jsonFixture('result-create-capability-rejected.valid.json')

  const first = storage.recordRejectedCommand(command, rejection)
  const replay = storage.recordRejectedCommand(structuredClone(command), structuredClone(rejection))
  assert.deepEqual(replay, first)
  assert.equal(storage.listEvents().length, 0)
  assert.equal(storage.listOutbox().length, 0)

  const changed = structuredClone(command)
  changed.payload.name = 'Different request'
  assert.throws(
    () => storage.recordRejectedCommand(changed, rejection),
    (error) => error instanceof IdempotencyConflictError,
  )
  storage.close()
})

test('single-project scan persists bounded candidate mappings and survives restart', async (t) => {
  const root = makeRoot(t)
  const candidatePath = join(root, 'Alpha')
  const storage = await openStorage(root)
  const saved = storage.recordImportScan(intakeScan(root, {
    mode: 'single_project',
    sourcePath: candidatePath,
    rootPath: candidatePath,
    candidatePath,
    sourceRoot: null,
  }))
  assert.equal(saved.sourceRoot.kind, 'single_project')
  assert.match(saved.sourceRoot.sourceRootId, /^src_.+-7/)
  assert.match(saved.job.importJobId, /^job_.+-7/)
  assert.equal(saved.job.mode, 'single_project')
  assert.equal(saved.candidates.length, 1)
  const candidate = saved.candidates[0]
  assert.match(candidate.candidateId, /^can_.+-7/)
  assert.equal(candidate.suggestedName, 'Alpha')
  assert.equal(candidate.suggestedSummary, 'A bounded import candidate.')
  assert.equal(candidate.summarySource, 'README.md#goal')
  assert.deepEqual(candidate.confidence.level, 'high')
  assert.deepEqual(
    candidate.documents.map(({ relativePath, suggestedRole, title, preview }) => ({
      relativePath,
      suggestedRole,
      title,
      preview,
    })),
    [{
      relativePath: 'README.md',
      suggestedRole: 'readme',
      title: 'Alpha',
      preview: 'Short preview only.',
    }],
  )
  assert.equal(candidate.documents[0].evidence.matchedBy, 'file_name_and_heading')
  assert.equal(candidate.issues[0].code, 'MISSING_DEVLOG')
  assert.equal('content' in candidate.documents[0], false)
  storage.close()

  const reopened = await openStorage(root, { instanceId: 'test-host-intake-reopen' })
  assert.equal(reopened.listSourceRoots().length, 1)
  assert.equal(reopened.listImportJobs().length, 1)
  assert.deepEqual(reopened.getImportCandidate(candidate.candidateId), candidate)
  reopened.close()
})

test('scan-level source issues persist on the import job and survive restart without candidate attribution', async (t) => {
  const root = makeRoot(t)
  const storage = await openStorage(root)
  const scan = intakeScan(root)
  scan.issues = [{
    code: 'SOURCE_ENTRY_UNREADABLE',
    severity: 'error',
    message: 'One source-root entry could not be inspected.',
    details: {
      entryName: 'RestrictedProject',
    },
  }]
  const saved = storage.recordImportScan(scan)
  assert.equal(saved.issues.length, 1)
  assert.match(saved.issues[0].importJobIssueId, /^jis_.+-7/)
  assert.equal(saved.issues[0].importJobId, saved.job.importJobId)
  assert.equal(saved.issues[0].code, 'SOURCE_ENTRY_UNREADABLE')
  assert.equal(saved.issues[0].message, 'One source-root entry could not be inspected.')
  assert.equal(saved.issues[0].details.message, 'One source-root entry could not be inspected.')
  assert.deepEqual(saved.job.issues, saved.issues)
  storage.close()

  const reopened = await openStorage(root, { instanceId: 'test-host-job-issues-reopen' })
  assert.deepEqual(reopened.getImportJob(saved.job.importJobId).issues, saved.issues)
  assert.deepEqual(reopened.listImportJobs()[0].issues, saved.issues)
  reopened.close()
})

test('source-root scans whose normalized paths differ only by case merge into one source root', async (t) => {
  const root = makeRoot(t)
  const storage = await openStorage(root)
  t.after(() => storage.close())
  const first = storage.recordImportScan(intakeScan(root))
  const caseOnly = intakeScan(root)
  caseOnly.sourceRoot.displayPath = caseOnly.sourceRoot.displayPath.toUpperCase()
  caseOnly.sourceRoot.normalizedPath = caseOnly.sourceRoot.normalizedPath.toUpperCase()
  caseOnly.rootPath.displayPath = caseOnly.rootPath.displayPath.toUpperCase()
  caseOnly.rootPath.normalizedPath = caseOnly.rootPath.normalizedPath.toUpperCase()
  caseOnly.candidates[0].root.displayPath = caseOnly.candidates[0].root.displayPath.toUpperCase()
  caseOnly.candidates[0].root.normalizedPath = caseOnly.candidates[0].root.normalizedPath.toUpperCase()
  const second = storage.recordImportScan(caseOnly)

  assert.equal(second.sourceRoot.sourceRootId, first.sourceRoot.sourceRootId)
  assert.equal(second.sourceRoot.revision, first.sourceRoot.revision + 1)
  assert.equal(storage.listSourceRoots().length, 1)
  assert.equal(storage.listImportJobs().length, 2)
  storage.close()
})

test('source-root scans whose normalized paths differ only by Unicode case merge into one source root', async (t) => {
  const root = makeRoot(t)
  const storage = await openStorage(root)
  t.after(() => storage.close())
  const sourcePath = join(root, 'ProjÄcts')
  const firstScan = intakeScan(root, { sourcePath })
  firstScan.sourceRoot.normalizedPath = firstScan.sourceRoot.normalizedPath.replace('ä', 'Ä')
  firstScan.rootPath.normalizedPath = firstScan.rootPath.normalizedPath.replace('ä', 'Ä')
  firstScan.candidates[0].root.normalizedPath = firstScan.candidates[0].root.normalizedPath.replace('ä', 'Ä')
  const first = storage.recordImportScan(firstScan)
  const second = storage.recordImportScan(intakeScan(root, { sourcePath }))

  assert.equal(second.sourceRoot.sourceRootId, first.sourceRoot.sourceRootId)
  assert.equal(second.sourceRoot.revision, first.sourceRoot.revision + 1)
  assert.equal(storage.listSourceRoots().length, 1)
  assert.equal(storage.listImportJobs().length, 2)
  storage.close()
})

test('candidate history lists latest-first and can collapse to one newest row per normalized path', async (t) => {
  const root = makeRoot(t)
  const storage = await openStorage(root)
  t.after(() => storage.close())
  const sourcePath = join(root, 'Projects')
  const alphaFirst = storage.recordImportScan(intakeScan(root)).candidates[0]
  const alphaSecond = storage.recordImportScan(intakeScan(root)).candidates[0]
  const beta = storage.recordImportScan(intakeScan(root, {
    candidatePath: join(sourcePath, 'Beta'),
  })).candidates[0]

  assert.deepEqual(
    storage.listImportCandidates().map(candidate => candidate.candidateId),
    [beta.candidateId, alphaSecond.candidateId, alphaFirst.candidateId],
  )
  assert.deepEqual(
    storage.listImportCandidates({ latestPerPath: true }).map(candidate => candidate.candidateId),
    [beta.candidateId, alphaSecond.candidateId],
  )
  const firstPage = storage.listImportCandidates({ latestPerPath: true, limit: 1 })
  const secondPage = storage.listImportCandidates({
    latestPerPath: true,
    limit: 1,
    afterCandidateId: firstPage[0].candidateId,
  })
  const finalPage = storage.listImportCandidates({
    latestPerPath: true,
    limit: 1,
    afterCandidateId: secondPage[0].candidateId,
  })
  assert.deepEqual(firstPage.map(candidate => candidate.candidateId), [beta.candidateId])
  assert.deepEqual(secondPage.map(candidate => candidate.candidateId), [alphaSecond.candidateId])
  assert.deepEqual(finalPage, [])
  assert.throws(
    () => storage.listImportCandidates({ afterCandidateId: createPrefixedUuidV7('can') }),
    (error) => error.details?.reason === 'candidate_cursor_not_found',
  )
  storage.close()
})

test('candidate center filters 120 mixed rows before pagination and reports view counts', async (t) => {
  const root = makeRoot(t)
  const storage = await openStorage(root)
  const importedProject = legacyCommand(500)
  storage.registerProject(importedProject, trustedRegistration(root, importedProject, 500))
  const sourcePath = join(root, 'Projects')
  const fixtureCandidate = intakeScan(root).candidates[0]
  const candidateFor = (index, name) => ({
    ...structuredClone(fixtureCandidate),
    root: {
      displayPath: join(sourcePath, `Project-${String(index).padStart(3, '0')}`),
      normalizedPath: join(sourcePath, `Project-${String(index).padStart(3, '0')}`).toLowerCase(),
    },
    suggestedName: name,
    status: index === 0 ? 'conflict' : index === 1 ? 'relocation_candidate' : 'discovered',
  })

  const oldScan = storage.recordImportScan(intakeScan(root, {
    candidates: Array.from({ length: 15 }, (_, index) => candidateFor(index + 5, `Old ${String(index)}`)),
  }))
  assert.equal(oldScan.candidates.length, 15)
  const current = storage.recordImportScan(intakeScan(root, {
    candidates: Array.from({ length: 105 }, (_, index) => candidateFor(
      index,
      index < 5 ? `Review Needle ${String(index)}` : `Terminal ${String(index)}`,
    )),
  })).candidates

  const fixtureDb = new DatabaseSync(join(root, 'project-control.sqlite3'))
  const importCandidate = fixtureDb.prepare(`
    UPDATE import_candidates
    SET status = 'imported', matched_project_id = ?, revision = revision + 1
    WHERE candidate_id = ?
  `)
  for (const candidate of current.slice(5, 55)) {
    importCandidate.run(importedProject.target.projectId, candidate.candidateId)
  }
  const ignoreCandidate = fixtureDb.prepare(`
    UPDATE import_candidates
    SET status_before_ignored = status, status = 'ignored', revision = revision + 1
    WHERE candidate_id = ?
  `)
  for (const candidate of current.slice(55)) ignoreCandidate.run(candidate.candidateId)
  fixtureDb.close()

  const firstPage = storage.queryImportCandidates({ view: 'review', limit: 2 })
  assert.equal(firstPage.total, 5)
  assert.deepEqual(firstPage.counts, { review: 5, ignored: 50, history: 65 })
  assert.equal(firstPage.candidates.length, 2)
  assert.equal(firstPage.candidates[0].status, 'conflict')
  assert.equal(firstPage.candidates[1].status, 'relocation_candidate')
  assert.match(firstPage.nextCursor, /^can_/)
  assert.ok(firstPage.candidates.every(candidate => [
    'discovered', 'conflict', 'relocation_candidate',
  ].includes(candidate.status)))

  const secondPage = storage.queryImportCandidates({
    view: 'review',
    limit: 3,
    afterCandidateId: firstPage.nextCursor,
  })
  assert.equal(secondPage.candidates.length, 3)
  assert.equal(secondPage.nextCursor, null)
  assert.equal(new Set([
    ...firstPage.candidates,
    ...secondPage.candidates,
  ].map(candidate => candidate.candidateId)).size, 5)

  const ignored = storage.queryImportCandidates({ view: 'ignored', limit: 25 })
  assert.equal(ignored.total, 50)
  assert.equal(ignored.candidates.length, 25)
  assert.match(ignored.nextCursor, /^can_/)
  assert.ok(ignored.candidates.every(candidate => candidate.status === 'ignored'))

  const history = storage.queryImportCandidates({ view: 'history', limit: 100 })
  assert.equal(history.total, 65)
  assert.equal(history.candidates.length, 65)
  assert.ok(history.candidates.some(candidate => (
    candidate.status === 'discovered' && candidate.historyReason === 'superseded'
  )))
  assert.ok(history.candidates.some(candidate => candidate.status === 'imported'))

  assert.throws(
    () => storage.queryImportCandidates({
      view: 'review',
      limit: 25,
      afterCandidateId: current[5].candidateId,
    }),
    error => error.details?.reason === 'candidate_cursor_not_found',
  )

  const searched = storage.queryImportCandidates({
    view: 'review',
    search: 'Needle 3',
    limit: 25,
  })
  assert.equal(searched.total, 1)
  assert.equal(searched.candidates[0].suggestedName, 'Review Needle 3')
  assert.equal(storage.listProjects().length, 1)
  assert.equal(storage.getProject(importedProject.target.projectId).name, importedProject.payload.name)
  storage.close()
})

test('candidate center bulk ignore and restore are atomic and preserve path fingerprints', async (t) => {
  const root = makeRoot(t)
  const storage = await openStorage(root)
  const sourcePath = join(root, 'Projects')
  const fixtureCandidate = intakeScan(root).candidates[0]
  const candidates = ['discovered', 'conflict', 'relocation_candidate'].map((status, index) => ({
    ...structuredClone(fixtureCandidate),
    root: {
      displayPath: join(sourcePath, `Bulk-${String(index)}`),
      normalizedPath: join(sourcePath, `Bulk-${String(index)}`).toLowerCase(),
    },
    suggestedName: `Bulk ${String(index)}`,
    status,
  }))
  const saved = storage.recordImportScan(intakeScan(root, { candidates })).candidates
  const ignored = storage.setImportCandidatesIgnored(
    saved.map(candidate => ({
      candidateId: candidate.candidateId,
      expectedRevision: candidate.revision,
    })),
    true,
  )
  assert.deepEqual(ignored.map(candidate => candidate.status), ['ignored', 'ignored', 'ignored'])

  assert.throws(
    () => storage.setImportCandidatesIgnored(ignored.map((candidate, index) => ({
      candidateId: candidate.candidateId,
      expectedRevision: candidate.revision + (index === 1 ? 1 : 0),
    })), false),
    (error) => error.details?.reason === 'revision_conflict',
  )
  assert.deepEqual(
    ignored.map(candidate => storage.getImportCandidate(candidate.candidateId).status),
    ['ignored', 'ignored', 'ignored'],
  )

  const restored = storage.setImportCandidatesIgnored(ignored.map(candidate => ({
    candidateId: candidate.candidateId,
    expectedRevision: candidate.revision,
  })), false)
  assert.deepEqual(
    restored.map(candidate => candidate.status),
    ['discovered', 'conflict', 'relocation_candidate'],
  )

  const fingerprintProjectId = createPrefixedUuidV7('prj')
  const fingerprintPath = join(sourcePath, 'Fingerprint')
  const fingerprintScan = intakeScan(root, {
    candidatePath: fingerprintPath,
    manifestProjectId: fingerprintProjectId,
  })
  fingerprintScan.candidates[0].confidence = {
    level: 'high',
    manifest: { hash: `sha256:${'a'.repeat(64)}` },
  }
  const fingerprintCandidate = storage.recordImportScan(fingerprintScan).candidates[0]
  storage.setImportCandidateIgnored(
    fingerprintCandidate.candidateId,
    true,
    fingerprintCandidate.revision,
  )
  const inheritedScan = intakeScan(root, {
    candidatePath: fingerprintPath,
    manifestProjectId: fingerprintProjectId,
  })
  inheritedScan.candidates[0].confidence = {
    level: 'high',
    manifest: { hash: `sha256:${'a'.repeat(64)}` },
  }
  const inherited = storage.recordImportScan(inheritedScan).candidates[0]
  assert.equal(inherited.status, 'ignored')

  const changedManifestScan = intakeScan(root, {
    candidatePath: fingerprintPath,
    manifestProjectId: fingerprintProjectId,
  })
  changedManifestScan.candidates[0].confidence = {
    level: 'high',
    manifest: { hash: `sha256:${'b'.repeat(64)}` },
  }
  const changedManifest = storage.recordImportScan(changedManifestScan).candidates[0]
  assert.equal(changedManifest.status, 'discovered')

  const changedIdentity = storage.recordImportScan(intakeScan(root, {
    candidatePath: fingerprintPath,
    manifestProjectId: createPrefixedUuidV7('prj'),
  })).candidates[0]
  assert.equal(changedIdentity.status, 'discovered')
  storage.close()
})

test('candidate latest and ignore inheritance use Unicode path keys', async (t) => {
  const root = makeRoot(t)
  const storage = await openStorage(root)
  t.after(() => storage.close())
  const sourcePath = join(root, 'Projects')
  const candidatePath = join(sourcePath, 'MÄP')
  const firstScan = intakeScan(root, { sourcePath, candidatePath })
  firstScan.candidates[0].root.normalizedPath = firstScan.candidates[0].root.normalizedPath.replace('ä', 'Ä')
  const first = storage.recordImportScan(firstScan).candidates[0]
  const ignored = storage.setImportCandidateIgnored(first.candidateId, true, first.revision)
  assert.equal(ignored.status, 'ignored')

  const second = storage.recordImportScan(intakeScan(root, { sourcePath, candidatePath })).candidates[0]
  assert.equal(second.status, 'ignored')
  assert.deepEqual(
    storage.listImportCandidates({ latestPerPath: true }).map(candidate => candidate.candidateId),
    [second.candidateId],
  )
  assert.equal(storage.listImportCandidates().length, 2)
  storage.close()
})

test('ignored project path inherits globally when scanning changes from project root to parent roots', async (t) => {
  const root = makeRoot(t)
  const storage = await openStorage(root)
  t.after(() => storage.close())
  const parentPath = join(root, 'Portfolio')
  const candidatePath = join(parentPath, 'Alpha')
  const single = storage.recordImportScan(intakeScan(root, {
    mode: 'single_project',
    sourcePath: candidatePath,
    rootPath: candidatePath,
    candidatePath,
    sourceRoot: null,
  }))
  const ignored = storage.setImportCandidateIgnored(
    single.candidates[0].candidateId,
    true,
    single.candidates[0].revision,
  )
  assert.equal(ignored.status, 'ignored')

  const fromParent = storage.recordImportScan(intakeScan(root, {
    sourcePath: parentPath,
    candidatePath,
  }))
  assert.notEqual(fromParent.sourceRoot.sourceRootId, single.sourceRoot.sourceRootId)
  assert.equal(fromParent.candidates[0].status, 'ignored')
  const restored = storage.setImportCandidateIgnored(
    fromParent.candidates[0].candidateId,
    false,
    fromParent.candidates[0].revision,
  )
  assert.equal(restored.status, 'discovered')

  const fromGrandparent = storage.recordImportScan(intakeScan(root, {
    sourcePath: root,
    candidatePath,
  }))
  assert.notEqual(fromGrandparent.sourceRoot.sourceRootId, fromParent.sourceRoot.sourceRootId)
  assert.equal(fromGrandparent.candidates[0].status, 'discovered')
  assert.deepEqual(
    storage.listImportCandidates({ latestPerPath: true }).map(candidate => candidate.candidateId),
    [fromGrandparent.candidates[0].candidateId],
  )
  assert.equal(storage.listImportCandidates().length, 3)
  storage.close()
})

test('complete scan persistence rolls back source, job, candidate, documents, and issues together', async (t) => {
  const root = makeRoot(t)
  const repeatedCandidateId = createPrefixedUuidV7('can')
  const storage = await openStorage(root, {
    idFactory: (prefix) => prefix === 'can'
      ? repeatedCandidateId
      : createPrefixedUuidV7(prefix),
  })
  t.after(() => storage.close())
  const sourcePath = join(root, 'Projects')
  const first = intakeScan(root).candidates[0]
  const second = structuredClone(first)
  second.root = {
    displayPath: join(sourcePath, 'Beta'),
    normalizedPath: join(sourcePath, 'Beta').toLowerCase(),
  }
  second.suggestedName = 'Beta'
  const failingScan = intakeScan(root, { candidates: [first, second] })
  failingScan.issues = [{
    code: 'SOURCE_PARTIAL',
    severity: 'warning',
    details: { message: 'Must roll back with the failed scan.' },
  }]
  assert.throws(
    () => storage.recordImportScan(failingScan),
    /UNIQUE constraint failed/,
  )
  assert.deepEqual(storage.listSourceRoots(), [])
  assert.deepEqual(storage.listImportJobs(), [])
  assert.deepEqual(storage.listImportCandidates(), [])
  const audit = new DatabaseSync(join(root, 'project-control.sqlite3'))
  assert.equal(audit.prepare('SELECT count(*) AS count FROM import_job_issues').get().count, 0)
  audit.close()
  storage.close()
})

test('ignore state restores correctly, refs are scoped, and successful registration marks imported', async (t) => {
  const root = makeRoot(t)
  let currentTime = '2026-08-15T00:00:00.000Z'
  const storage = await openStorage(root, { now: () => currentTime })
  t.after(() => storage.close())
  const scan = storage.recordImportScan(intakeScan(root, { candidateStatus: 'conflict' }))
  let candidate = scan.candidates[0]
  candidate = storage.setImportCandidateIgnored(candidate.candidateId, true, candidate.revision)
  assert.equal(candidate.status, 'ignored')
  assert.equal(candidate.statusBeforeIgnored, 'conflict')
  candidate = storage.setImportCandidateIgnored(candidate.candidateId, false, candidate.revision)
  assert.equal(candidate.status, 'conflict')
  assert.equal(candidate.statusBeforeIgnored, null)
  const context = {
    applicationInstanceId: 'desktop-test-instance',
    scope: 'project-control.lifecycle',
  }
  candidate = storage.setImportCandidateStatus(candidate.candidateId, 'discovered', candidate.revision)

  const refs = storage.issueImportCandidateRefs(candidate.candidateId, {
    ...context,
    expectedRevision: candidate.revision,
    ttlSeconds: 60,
  })
  assert.deepEqual(Object.keys(refs).sort(), [
    'candidateRef',
    'expiresAt',
    'locationRef',
    'scope',
    'sourceRootRef',
  ])
  assert.equal(refs.candidateRef, candidate.candidateId)
  assert.throws(
    () => storage.resolveLocationRef(refs.locationRef, {
      ...context,
      applicationInstanceId: 'another-instance',
    }),
    (error) => error.details?.reason === 'application_instance_mismatch',
  )
  const resolved = storage.resolveRegistrationRefs(
    candidate.candidateId,
    refs,
    context,
  )
  assert.equal(resolved.location.locationId, refs.locationRef)
  assert.equal(resolved.sourceRoot.sourceRootRef, refs.sourceRootRef)

  const command = legacyCommand(70)
  command.payload.locationRef = refs.locationRef
  command.payload.sourceRootRef = refs.sourceRootRef
  command.payload.name = candidate.suggestedName
  const accepted = storage.registerProject(command, {
    location: resolved.location,
    candidateId: candidate.candidateId,
    candidateRevision: candidate.revision,
  })
  assert.equal(accepted.status, 'accepted')
  candidate = storage.getImportCandidate(candidate.candidateId)
  assert.equal(candidate.status, 'imported')
  assert.equal(candidate.matchedProjectId, command.target.projectId)
  const importedRevision = candidate.revision
  const replayed = storage.registerProject(structuredClone(command), {
    location: resolved.location,
    candidateId: candidate.candidateId,
    candidateRevision: importedRevision - 1,
  })
  assert.equal(replayed.status, 'replayed')
  assert.equal(storage.getImportCandidate(candidate.candidateId).revision, importedRevision)
  assert.throws(
    () => storage.setImportCandidateIgnored(candidate.candidateId, true, candidate.revision),
    (error) => error.details?.reason === 'candidate_already_imported',
  )

  currentTime = refs.expiresAt
  assert.throws(
    () => storage.resolveSourceRootRef(refs.sourceRootRef, context),
    (error) => error.details?.reason === 'reference_expired',
  )
  storage.close()
})

test('candidate registration revision rejection and late outbox failure leave candidate/project atomic', async (t) => {
  const root = makeRoot(t)
  const storage = await openStorage(root)
  t.after(() => storage.close())
  const seedCommand = legacyCommand(80)
  storage.registerProject(seedCommand, trustedRegistration(root, seedCommand, 80))
  const occupiedOutboxId = storage.listOutbox()[0].outboxId

  const saved = storage.recordImportScan(intakeScan(root))
  const candidate = saved.candidates[0]
  const context = {
    applicationInstanceId: 'desktop-atomic-test',
    scope: 'project-control.lifecycle',
  }
  const refs = storage.issueImportCandidateRefs(candidate.candidateId, {
    ...context,
    expectedRevision: candidate.revision,
  })
  const resolved = storage.resolveRegistrationRefs(candidate.candidateId, refs, context)

  const staleCommand = legacyCommand(81)
  staleCommand.payload.locationRef = refs.locationRef
  staleCommand.payload.sourceRootRef = refs.sourceRootRef
  const rejected = storage.registerProject(staleCommand, {
    location: resolved.location,
    candidateId: candidate.candidateId,
    candidateRevision: candidate.revision + 1,
  })
  assert.equal(rejected.status, 'rejected')
  assert.equal(rejected.error.code, 'REVISION_CONFLICT')
  assert.equal(storage.getProject(staleCommand.target.projectId), null)
  assert.equal(storage.getImportCandidate(candidate.candidateId).status, 'discovered')
  assert.equal(storage.getImportCandidate(candidate.candidateId).revision, candidate.revision)

  const failingCommand = legacyCommand(82)
  failingCommand.payload.locationRef = refs.locationRef
  failingCommand.payload.sourceRootRef = refs.sourceRootRef
  assert.throws(
    () => storage.registerProject(failingCommand, {
      location: resolved.location,
      candidateId: candidate.candidateId,
      candidateRevision: candidate.revision,
      outboxId: occupiedOutboxId,
    }),
    /UNIQUE constraint failed/,
  )
  assert.equal(storage.getProject(failingCommand.target.projectId), null)
  assert.equal(storage.getCommandReceipt(failingCommand.commandId), null)
  assert.equal(storage.getImportCandidate(candidate.candidateId).status, 'discovered')
  assert.equal(storage.getImportCandidate(candidate.candidateId).revision, candidate.revision)
  storage.close()
})

test('relocation candidate, project rebind, event, and outbox commit or roll back together', async (t) => {
  const root = makeRoot(t)
  const storage = await openStorage(root)
  t.after(() => storage.close())
  const registered = legacyCommand(90)
  storage.registerProject(registered, trustedRegistration(root, registered, 90))
  const occupiedOutboxId = storage.listOutbox()[0].outboxId

  const staleSaved = storage.recordImportScan(intakeScan(root, {
    candidateStatus: 'relocation_candidate',
    manifestProjectId: registered.target.projectId,
  }))
  const staleCandidate = staleSaved.candidates[0]
  const saved = storage.recordImportScan(intakeScan(root, {
    candidateStatus: 'relocation_candidate',
    manifestProjectId: registered.target.projectId,
  }))
  const candidate = saved.candidates[0]
  const ignoredDuplicate = storage.recordImportScan(intakeScan(root, {
    candidateStatus: 'relocation_candidate',
    manifestProjectId: registered.target.projectId,
  })).candidates[0]
  const ignoredDuplicateState = storage.setImportCandidateIgnored(
    ignoredDuplicate.candidateId,
    true,
    ignoredDuplicate.revision,
  )
  assert.notEqual(staleCandidate.candidateId, candidate.candidateId)
  const differentProjectCandidate = storage.recordImportScan(intakeScan(root, {
    candidateStatus: 'relocation_candidate',
    manifestProjectId: legacyCommand(93).target.projectId,
  })).candidates[0]
  const differentPathCandidate = storage.recordImportScan(intakeScan(root, {
    candidateStatus: 'relocation_candidate',
    manifestProjectId: registered.target.projectId,
    candidatePath: join(root, 'Projects', 'Other-Location'),
  })).candidates[0]
  const context = {
    applicationInstanceId: 'desktop-relocation-test',
    scope: 'project-control.lifecycle',
  }
  const refs = storage.issueImportCandidateRefs(candidate.candidateId, {
    ...context,
    expectedRevision: candidate.revision,
  })
  const resolved = storage.resolveRegistrationRefs(candidate.candidateId, refs, context)

  const stale = rebindCommand(registered, 91, 1)
  stale.payload.newLocationRef = refs.locationRef
  stale.payload.sourceRootRef = refs.sourceRootRef
  const rejected = storage.rebindProject(stale, {
    newLocation: resolved.location,
    candidateId: candidate.candidateId,
    candidateRevision: candidate.revision + 1,
  })
  assert.equal(rejected.status, 'rejected')
  assert.equal(rejected.error.code, 'REVISION_CONFLICT')
  assert.equal(storage.getProject(registered.target.projectId).revision, 1)
  assert.equal(storage.getImportCandidate(candidate.candidateId).status, 'relocation_candidate')
  assert.equal(storage.getImportCandidate(staleCandidate.candidateId).status, 'relocation_candidate')
  assert.equal(storage.getImportCandidate(ignoredDuplicate.candidateId).status, 'ignored')

  const rebind = rebindCommand(registered, 92, 1)
  rebind.payload.newLocationRef = refs.locationRef
  rebind.payload.sourceRootRef = refs.sourceRootRef
  assert.throws(
    () => storage.rebindProject(rebind, {
      newLocation: resolved.location,
      candidateId: candidate.candidateId,
      candidateRevision: candidate.revision,
      outboxId: occupiedOutboxId,
    }),
    /UNIQUE constraint failed/,
  )
  let project = storage.getProject(registered.target.projectId)
  assert.equal(project.revision, 1)
  assert.equal(project.workspaceLocations.filter(location => location.isActive).length, 1)
  assert.equal(
    project.workspaceLocations.find(location => location.isActive).locationId,
    registered.payload.locationRef,
  )
  assert.equal(storage.getCommandReceipt(rebind.commandId), null)
  assert.equal(storage.getImportCandidate(candidate.candidateId).status, 'relocation_candidate')
  assert.equal(storage.getImportCandidate(candidate.candidateId).revision, candidate.revision)
  assert.equal(storage.getImportCandidate(staleCandidate.candidateId).status, 'relocation_candidate')
  assert.equal(storage.getImportCandidate(staleCandidate.candidateId).revision, staleCandidate.revision)
  assert.equal(storage.getImportCandidate(ignoredDuplicate.candidateId).status, 'ignored')
  assert.equal(storage.getImportCandidate(ignoredDuplicate.candidateId).revision, ignoredDuplicateState.revision)
  assert.equal(storage.getImportCandidate(differentProjectCandidate.candidateId).status, 'relocation_candidate')
  assert.equal(storage.getImportCandidate(differentPathCandidate.candidateId).status, 'relocation_candidate')
  assert.equal(storage.listEvents().length, 1)
  assert.equal(storage.listOutbox().length, 1)

  const accepted = storage.rebindProject(structuredClone(rebind), {
    newLocation: resolved.location,
    candidateId: candidate.candidateId,
    candidateRevision: candidate.revision,
  })
  assert.equal(accepted.status, 'accepted')
  project = storage.getProject(registered.target.projectId)
  assert.equal(project.revision, 2)
  assert.equal(project.workspaceLocations.filter(location => location.isActive).length, 1)
  assert.equal(
    project.workspaceLocations.find(location => location.isActive).locationId,
    refs.locationRef,
  )
  const imported = storage.getImportCandidate(candidate.candidateId)
  assert.equal(imported.status, 'imported')
  assert.equal(imported.matchedProjectId, registered.target.projectId)
  assert.equal(imported.revision, candidate.revision + 1)
  const closedDuplicate = storage.getImportCandidate(staleCandidate.candidateId)
  assert.equal(closedDuplicate.status, 'imported')
  assert.equal(closedDuplicate.matchedProjectId, registered.target.projectId)
  assert.equal(closedDuplicate.revision, staleCandidate.revision + 1)
  const closedIgnoredDuplicate = storage.getImportCandidate(ignoredDuplicate.candidateId)
  assert.equal(closedIgnoredDuplicate.status, 'imported')
  assert.equal(closedIgnoredDuplicate.matchedProjectId, registered.target.projectId)
  assert.equal(closedIgnoredDuplicate.revision, ignoredDuplicateState.revision + 1)
  assert.throws(
    () => storage.setImportCandidateIgnored(
      closedIgnoredDuplicate.candidateId,
      false,
      closedIgnoredDuplicate.revision,
    ),
    error => error.details?.reason === 'candidate_already_imported',
  )
  assert.equal(storage.getImportCandidate(differentProjectCandidate.candidateId).status, 'relocation_candidate')
  assert.equal(storage.getImportCandidate(differentPathCandidate.candidateId).status, 'relocation_candidate')
  assert.equal(storage.listEvents().length, 2)
  assert.equal(storage.listOutbox().length, 2)

  const replayed = storage.rebindProject(structuredClone(rebind), {
    newLocation: resolved.location,
    candidateId: candidate.candidateId,
    candidateRevision: candidate.revision,
  })
  assert.equal(replayed.status, 'replayed')
  assert.equal(storage.getImportCandidate(candidate.candidateId).revision, imported.revision)
  storage.close()
})

test('registration ref pairs cannot cross candidates and rescan preserves ignored paths', async (t) => {
  const root = makeRoot(t)
  const storage = await openStorage(root)
  t.after(() => storage.close())
  const first = storage.recordImportScan(intakeScan(root))
  const firstCandidate = storage.setImportCandidateIgnored(
    first.candidates[0].candidateId,
    true,
    first.candidates[0].revision,
  )
  const rescanned = storage.recordImportScan(intakeScan(root))
  assert.equal(rescanned.candidates[0].status, 'ignored')
  assert.equal(rescanned.candidates[0].statusBeforeIgnored, 'discovered')

  const restoredFirst = storage.setImportCandidateIgnored(
    firstCandidate.candidateId,
    false,
    firstCandidate.revision,
  )
  const restoredSecond = storage.setImportCandidateIgnored(
    rescanned.candidates[0].candidateId,
    false,
    rescanned.candidates[0].revision,
  )
  const context = {
    applicationInstanceId: 'desktop-pair-test',
    scope: 'project-control.lifecycle',
  }
  const firstRefs = storage.issueImportCandidateRefs(restoredFirst.candidateId, {
    ...context,
    expectedRevision: restoredFirst.revision,
  })
  const secondRefs = storage.issueImportCandidateRefs(restoredSecond.candidateId, {
    ...context,
    expectedRevision: restoredSecond.revision,
  })
  assert.throws(
    () => storage.resolveRegistrationRefs(
      restoredFirst.candidateId,
      { locationRef: firstRefs.locationRef, sourceRootRef: secondRefs.sourceRootRef },
      context,
    ),
    (error) => error.details?.reason === 'reference_pair_mismatch',
  )
  storage.close()
})

test('intake input rejects UNC, unbounded preview, pagination overflow, and stale revisions', async (t) => {
  const root = makeRoot(t)
  const storage = await openStorage(root)
  t.after(() => storage.close())
  const unc = intakeScan(root)
  unc.sourceRoot.displayPath = '\\\\server\\share\\Projects'
  unc.sourceRoot.normalizedPath = '\\\\server\\share\\projects'
  assert.throws(
    () => storage.recordImportScan(unc),
    (error) => error instanceof InvalidStoragePathError
      && error.details?.reason === 'network_paths_are_not_supported',
  )
  const oversized = intakeScan(root)
  oversized.candidates[0].documents[0].preview = 'x'.repeat(1001)
  assert.throws(() => storage.recordImportScan(oversized), /at most|between 1 and 1000/)
  const fullContent = intakeScan(root)
  fullContent.candidates[0].documents[0].evidence.content = 'forbidden full file body'
  assert.throws(() => storage.recordImportScan(fullContent), /full file-content fields/)
  const tooManyJobIssues = intakeScan(root)
  tooManyJobIssues.issues = Array.from({ length: 501 }, (_, index) => ({
    code: `SOURCE_ISSUE_${index}`,
    details: { message: 'bounded' },
  }))
  assert.throws(() => storage.recordImportScan(tooManyJobIssues), /at most 500 items/)
  assert.equal(storage.listSourceRoots().length, 0)

  const saved = storage.recordImportScan(intakeScan(root))
  assert.throws(() => storage.listImportCandidates({ limit: 101 }), /cannot exceed 100/)
  assert.throws(
    () => storage.setImportCandidateStatus(saved.candidates[0].candidateId, 'conflict', 999),
    (error) => error.details?.reason === 'revision_conflict',
  )
  storage.close()
})

test('close releases the database and writer lock even when its final status query fails', async (t) => {
  const root = makeRoot(t)
  const databasePath = join(root, 'project-control.sqlite3')
  const storage = await openStorage(root)
  t.after(() => storage.close())

  const sabotage = new DatabaseSync(databasePath)
  sabotage.exec('ALTER TABLE projects RENAME TO projects_hidden')
  sabotage.close()
  assert.throws(() => storage.close(), /no such table: projects/)

  const restore = new DatabaseSync(databasePath)
  restore.exec('ALTER TABLE projects_hidden RENAME TO projects')
  restore.close()
  const reopened = await openStorage(root, { instanceId: 'test-host-after-close-failure' })
  assert.equal(reopened.status().state, 'ready')
  reopened.close()
})
