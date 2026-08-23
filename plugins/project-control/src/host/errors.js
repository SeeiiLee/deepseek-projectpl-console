export class ProjectControlStorageError extends Error {
  constructor(code, message, details = undefined, options = undefined) {
    super(message, options)
    this.name = new.target.name
    this.code = code
    this.details = details
  }
}

export class InvalidStoragePathError extends ProjectControlStorageError {
  constructor(message, details) {
    super('INVALID_STORAGE_PATH', message, details)
  }
}

export class WriterLockError extends ProjectControlStorageError {
  constructor(lockPath, options = undefined) {
    super(
      'WRITER_ALREADY_ACTIVE',
      `Project Control writer lock is already held: ${lockPath}`,
      { lockPath },
      options,
    )
  }
}

export class MigrationError extends ProjectControlStorageError {}

export class MigrationChecksumError extends MigrationError {
  constructor(version, expectedChecksum, actualChecksum) {
    super(
      'MIGRATION_CHECKSUM_MISMATCH',
      `Applied migration ${version} no longer matches its immutable checksum.`,
      { version, expectedChecksum, actualChecksum },
    )
  }
}

export class MigrationVersionError extends MigrationError {
  constructor(version) {
    super(
      'MIGRATION_VERSION_UNSUPPORTED',
      `Database contains migration ${version}, which is not available to this build.`,
      { version },
    )
  }
}

export class UntrackedDatabaseError extends MigrationError {
  constructor(databasePath) {
    super(
      'UNTRACKED_DATABASE',
      'Refusing to migrate a non-empty database without schema_migrations history.',
      { databasePath },
    )
  }
}

export class IdempotencyConflictError extends ProjectControlStorageError {
  constructor(details) {
    super(
      'IDEMPOTENCY_CONFLICT',
      'The command identity or idempotency key was already used with a different full request.',
      details,
    )
  }
}

export class StorageValidationError extends ProjectControlStorageError {
  constructor(message, details = undefined) {
    super('STORAGE_INPUT_INVALID', message, details)
  }
}
