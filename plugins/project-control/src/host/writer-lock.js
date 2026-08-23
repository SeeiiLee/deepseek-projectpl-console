import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { WriterLockError } from './errors.js'

export function acquireWriterLock({ lockPath, instanceId, acquiredAt }) {
  mkdirSync(dirname(lockPath), { recursive: true })
  const database = new DatabaseSync(lockPath, { timeout: 0 })
  let transactionOpen = false

  try {
    database.exec('PRAGMA journal_mode = DELETE; PRAGMA busy_timeout = 0;')
    database.exec(`
      CREATE TABLE IF NOT EXISTS writer_lock_owner (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        instance_id TEXT,
        process_id INTEGER,
        acquired_at TEXT
      ) STRICT;
      INSERT OR IGNORE INTO writer_lock_owner(singleton) VALUES (1);
    `)
    database.exec('BEGIN EXCLUSIVE')
    transactionOpen = true
    database.prepare(`
      UPDATE writer_lock_owner
      SET instance_id = ?, process_id = ?, acquired_at = ?
      WHERE singleton = 1
    `).run(instanceId, process.pid, acquiredAt)
  } catch (error) {
    if (transactionOpen) {
      try {
        database.exec('ROLLBACK')
      } catch {}
    }
    try {
      database.close()
    } catch {}
    throw new WriterLockError(lockPath, { cause: error })
  }

  let released = false
  return Object.freeze({
    lockPath,
    release() {
      if (released) return
      released = true
      try {
        database.exec('ROLLBACK')
      } finally {
        database.close()
      }
    },
  })
}
