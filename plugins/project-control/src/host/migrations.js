import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs'
import { basename, join } from 'node:path'
import { backup } from 'node:sqlite'

import {
  MigrationChecksumError,
  MigrationError,
  MigrationVersionError,
  UntrackedDatabaseError,
} from './errors.js'

const MIGRATION_FILE = /^(\d{4})_([a-z0-9][a-z0-9_-]*)\.sql$/

function sha256(contents) {
  return createHash('sha256').update(contents).digest('hex')
}

export function loadMigrations(migrationsDirectory) {
  const migrations = readdirSync(migrationsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && MIGRATION_FILE.test(entry.name))
    .map((entry) => {
      const match = MIGRATION_FILE.exec(entry.name)
      const contents = readFileSync(join(migrationsDirectory, entry.name))
      return Object.freeze({
        version: Number.parseInt(match[1], 10),
        name: match[2],
        fileName: entry.name,
        sql: contents.toString('utf8'),
        checksum: sha256(contents),
      })
    })
    .sort((left, right) => left.version - right.version)

  if (migrations.length === 0) {
    throw new MigrationError(
      'MIGRATIONS_MISSING',
      `No Project Control migrations were found in ${migrationsDirectory}.`,
    )
  }

  for (let index = 0; index < migrations.length; index += 1) {
    const expectedVersion = index + 1
    if (migrations[index].version !== expectedVersion) {
      throw new MigrationError(
        'MIGRATION_SEQUENCE_INVALID',
        `Expected migration ${expectedVersion.toString().padStart(4, '0')}, found ${migrations[index].fileName}.`,
        { expectedVersion, actualVersion: migrations[index].version },
      )
    }
  }

  return migrations
}

function hasMigrationTable(database) {
  return Boolean(
    database.prepare(`
      SELECT 1 AS present
      FROM sqlite_master
      WHERE type = 'table' AND name = 'schema_migrations'
    `).get(),
  )
}

function hasUserTables(database) {
  return Boolean(
    database.prepare(`
      SELECT 1 AS present
      FROM sqlite_master
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
        AND name <> 'schema_migrations'
      LIMIT 1
    `).get(),
  )
}

function readAppliedMigrations(database) {
  if (!hasMigrationTable(database)) return []
  return database.prepare(`
    SELECT version, name, checksum, applied_at AS appliedAt, app_version AS appVersion
    FROM schema_migrations
    ORDER BY version
  `).all()
}

function validateAppliedMigrations(applied, available) {
  const availableByVersion = new Map(available.map((migration) => [migration.version, migration]))
  for (const row of applied) {
    const migration = availableByVersion.get(Number(row.version))
    if (!migration) throw new MigrationVersionError(Number(row.version))
    if (row.checksum !== migration.checksum) {
      throw new MigrationChecksumError(Number(row.version), row.checksum, migration.checksum)
    }
  }
}

function backupFileName(databasePath, currentVersion, now) {
  const stamp = now().replaceAll(/[-:.]/g, '')
  return `${basename(databasePath)}.pre-v${currentVersion + 1}.${stamp}.sqlite3`
}

export async function migrateDatabase({
  database,
  databasePath,
  databaseExisted,
  backupDirectory,
  migrationsDirectory,
  applicationVersion,
  now,
}) {
  const migrations = loadMigrations(migrationsDirectory)
  const migrationTablePresent = hasMigrationTable(database)
  if (!migrationTablePresent && hasUserTables(database)) {
    throw new UntrackedDatabaseError(databasePath)
  }

  const applied = readAppliedMigrations(database)
  validateAppliedMigrations(applied, migrations)
  const appliedVersions = new Set(applied.map((row) => Number(row.version)))
  const pending = migrations.filter((migration) => !appliedVersions.has(migration.version))
  if (pending.length === 0) {
    return Object.freeze({ applied: [], backupPath: null, currentVersion: applied.at(-1)?.version ?? 0 })
  }

  let backupPath = null
  if (databaseExisted && statSync(databasePath).size > 0) {
    mkdirSync(backupDirectory, { recursive: true })
    const currentVersion = Number(applied.at(-1)?.version ?? 0)
    backupPath = join(backupDirectory, backupFileName(databasePath, currentVersion, now))
    if (existsSync(backupPath)) {
      throw new MigrationError('MIGRATION_BACKUP_EXISTS', 'Migration backup path already exists.', {
        backupPath,
      })
    }
    await backup(database, backupPath)
  }

  database.exec('BEGIN IMMEDIATE')
  try {
    for (const migration of pending) {
      database.exec(migration.sql)
      database.prepare(`
        INSERT INTO schema_migrations(version, name, checksum, applied_at, app_version)
        VALUES (?, ?, ?, ?, ?)
      `).run(migration.version, migration.name, migration.checksum, now(), applicationVersion)
    }
    database.exec('COMMIT')
  } catch (error) {
    try {
      database.exec('ROLLBACK')
    } catch {}
    throw new MigrationError(
      'MIGRATION_FAILED',
      `Project Control migration failed; the pre-migration backup was kept at ${backupPath ?? '(new database)'}.`,
      { backupPath, causeMessage: error instanceof Error ? error.message : String(error) },
      { cause: error },
    )
  }

  return Object.freeze({
    applied: pending.map(({ version, name, checksum }) => ({ version, name, checksum })),
    backupPath,
    currentVersion: pending.at(-1).version,
  })
}
