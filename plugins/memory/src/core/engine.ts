// 存储引擎抽象：plain（node:sqlite，默认）与 cipher（better-sqlite3-multiple-ciphers，SQLCipher）。
// 两者对 service 暴露同一窄接口：prepare/get/all/run/exec/close + integrityOk + vacuumInto。
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const require = createRequire(import.meta.url)

export interface EngineHandle {
  prepare(sql: string): { get(...params: unknown[]): unknown; all(...params: unknown[]): unknown; run(...params: unknown[]): unknown }
  exec(sql: string): void
  close(): void
  integrityOk(): boolean
  vacuumInto(path: string): void
}

function openPlain(path: string): EngineHandle {
  mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec('PRAGMA foreign_keys = ON')
  return {
    prepare: (sql) => db.prepare(sql),
    exec: (sql) => { db.exec(sql) },
    close: () => { db.close() },
    integrityOk: () => (db.prepare('PRAGMA integrity_check').get() as { integrity_check?: string } | undefined)?.integrity_check === 'ok',
    vacuumInto: (target) => { db.exec("VACUUM INTO '" + target.replace(/'/gu, "''") + "'") },
  }
}

function openCipher(path: string, key: Buffer): EngineHandle {
  mkdirSync(dirname(path), { recursive: true })
  const Database = require('better-sqlite3-multiple-ciphers') as new (path: string) => {
    pragma(source: string): void
    prepare(sql: string): { get(...params: unknown[]): unknown; all(...params: unknown[]): unknown; run(...params: unknown[]): unknown }
    exec(sql: string): void
    close(): void
  }
  const db = new Database(path)
  db.pragma("key = '" + key.toString('hex') + "'")
  db.pragma('foreign_keys = ON')
  const runIntegrity = (): boolean => {
    const rows = db.pragma('integrity_check') as unknown as Array<{ integrity_check?: string }>
    return rows.length === 1 && rows[0]?.integrity_check === 'ok'
  }
  return {
    prepare: (sql) => db.prepare(sql),
    exec: (sql) => { db.exec(sql) },
    close: () => { db.close() },
    integrityOk: runIntegrity,
    vacuumInto: (target) => { db.exec("VACUUM INTO '" + target.replace(/'/gu, "''") + "'") },
  }
}

export interface EngineOptions { encrypted?: boolean; key?: Buffer }

/** Open a store with the requested engine; key required when encrypted. */
export function openEngine(path: string, options: EngineOptions = {}): EngineHandle {
  if (options.encrypted === true) {
    if (options.key === undefined || options.key.length === 0) throw new Error('加密引擎需要 data key。')
    return openCipher(path, options.key)
  }
  return openPlain(path)
}
