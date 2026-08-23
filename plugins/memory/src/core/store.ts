// 存储层：引擎抽象（plain node:sqlite / cipher SQLCipher）+ 迁移框架 + 数据密钥管理。
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openEngine } from './engine.ts'
import type { EngineHandle } from './engine.ts'
import { encryptPlaintextDatabase, isPlaintextDatabase, loadOrCreateMasterKey, requireCipherConstructor } from './keys.ts'

export const SCHEMA_VERSION = 5
export const GLOBAL_SCOPE_ID = 'user:cyrus'

/** 迁移目录：源码态 src/core → ../../migrations；打包态 lib → ../../migrations 均指向 plugins/memory/migrations。 */
export function migrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  // src/core/*.ts → ../../migrations；打包后 lib/index.js → ../migrations
  const candidates = [
    resolve(here, '..', '..', 'migrations'),
    resolve(here, '..', 'migrations'),
  ]
  for (const candidate of candidates) if (existsSync(candidate)) return candidate
  throw new Error('memory migrations directory not found near ' + here)
}

function stripPragmas(sql: string): string {
  return sql.split('\n').filter((line) => !/^\s*PRAGMA/u.test(line)).join('\n')
}

/**
 * 加密模式的数据密钥准备：每个记忆库根目录一把主密钥（memory.key.json：
 * DPAPI 自动解锁 + 恢复口令包裹，一次性口令文件在根目录）；
 * 明文旧库首次启用加密时经 rekey 原地升级（保留 .pre-encrypt.bak）。
 */
export function prepareDataKey(dbRoot: string, dbPath: string): Buffer {
  const key = loadOrCreateMasterKey(dbRoot, dbPath)
  if (isPlaintextDatabase(dbPath)) {
    encryptPlaintextDatabase(dbPath, key, requireCipherConstructor())
  }
  return key
}

function currentVersion(db: EngineHandle): number | null {
  let row: { value?: string } | undefined
  try {
    row = db.prepare("SELECT value FROM meta WHERE key = 'schemaVersion'").get() as
      | { value?: string }
      | undefined
  } catch {
    return null // fresh database: meta table does not exist yet
  }
  if (row === undefined || row.value === undefined) return null
  const parsed = Number.parseInt(String(row.value), 10)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function setVersion(db: EngineHandle, version: number): void {
  db.prepare("INSERT INTO meta(key, value) VALUES ('schemaVersion', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(String(version))
}

function splitBaseline(sql: string): { catalog: string; shard: string } {
  const marker = '-- 第二部分：'
  const at = sql.indexOf(marker)
  if (at < 0) throw new Error('baseline migration lacks the shard part marker')
  return { catalog: sql.slice(0, at), shard: sql.slice(at) }
}

/**
 * Apply append-only migrations above the applied version. The 0001 baseline is
 * split into catalog and shard halves by the file's part markers.
 */
export function applyMigrations(db: EngineHandle, sqlDir: string, kind: 'catalog' | 'shard'): number {
  const current = currentVersion(db)
  let version: number
  if (current === null) {
    const baseline = readFileSync(join(sqlDir, '0001_initial.sql'), 'utf8')
    db.exec(stripPragmas(splitBaseline(baseline)[kind]))
    version = 1 // 0001 基线已内建 meta.schemaVersion='1'，后续编号迁移继续追加
  } else {
    if (current > SCHEMA_VERSION) {
      throw new Error('记忆库 schemaVersion ' + String(current) + ' 高于当前支持版本 ' + String(SCHEMA_VERSION) + '，拒绝打开（fail closed）。')
    }
    version = current
  }
  const files = readdirSync(sqlDir).filter((name) => /^\d{4}_.*\.sql$/u.test(name)).sort()
  for (const name of files) {
    const fileVersion = Number.parseInt(name.slice(0, 4), 10)
    if (!Number.isSafeInteger(fileVersion) || fileVersion <= version) continue
    const raw = readFileSync(join(sqlDir, name), 'utf8')
    // 编号迁移同样支持 catalog/shard 分半标记；无标记则原样应用于当前 kind。
    const sql = raw.includes('-- 第二部分：') ? splitBaseline(raw)[kind] : raw
    db.exec(stripPragmas(sql))
    setVersion(db, fileVersion)
    version = fileVersion
  }
  return version
}

export interface OpenStore {
  db: EngineHandle
  path: string
  version: number
}

export interface OpenOptions {
  encrypted?: boolean
  /** 主密钥所在目录（默认取数据库文件所在目录）。 */
  keyRoot?: string
}

/** Open catalog (memory_projects + meta) with migrations applied. */
export function openCatalog(path: string, options: OpenOptions = {}): OpenStore {
  const db = openEngine(path, options.encrypted === true ? { encrypted: true, key: prepareDataKey(options.keyRoot ?? dirname(path), path) } : {})
  try {
    const version = applyMigrations(db, migrationsDir(), 'catalog')
    return { db, path, version }
  } catch (error) {
    db.close()
    throw error
  }
}

/** Open a claim shard (claims/evidence/relations/fts/...) with migrations applied. */
export function openShard(path: string, options: OpenOptions = {}): OpenStore {
  const db = openEngine(path, options.encrypted === true ? { encrypted: true, key: prepareDataKey(options.keyRoot ?? dirname(path), path) } : {})
  try {
    const version = applyMigrations(db, migrationsDir(), 'shard')
    return { db, path, version }
  } catch (error) {
    db.close()
    throw error
  }
}
