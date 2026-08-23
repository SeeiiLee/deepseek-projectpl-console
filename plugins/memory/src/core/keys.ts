// 数据密钥 v2：DPAPI（Windows 账户级自动解锁）+ 恢复口令（scrypt/AES-256-GCM 包裹）。
// 密钥文件：<db>.key.json；恢复口令在首次生成时写入一次性文件 recovery-passphrase.txt（用户转存后自行删除）。
// 明文旧库在启用加密后经 sqlcipher_export 原地升级；DPAPI 失效时用 scripts/memory-recover.mjs + 恢复口令重建。
import { createCipheriv, createDecipheriv, randomBytes, randomInt, scryptSync } from "node:crypto"
import { spawnSync } from "node:child_process"
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { createRequire } from "node:module"
import { BIP39_ENGLISH } from "./wordlist.ts"

export const DATA_KEY_BYTES = 32
export const KEY_FILE_VERSION = 2
export const RECOVERY_PASSPHRASE_WORDS = 12
const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const DPAPI_ENTROPY_TEXT = "deepseek-harness-personal:memory-data-key:v2"
const SQLITE_HEADER = Buffer.from("SQLite format 3\u0000", "utf8")
const require = createRequire(import.meta.url)

export interface RecoveryWrap {
  kdf: "scrypt"
  n: number
  r: number
  p: number
  salt: string
  nonce: string
  ciphertext: string
  words: number
}

export interface DataKeyFileV2 {
  version: 2
  dpapi: { scope: "current-user"; blob: string }
  recovery: RecoveryWrap
}

// ---------- DPAPI（powershell.exe 内建 ProtectedData，无第三方依赖） ----------

function dpapiInvoke(protect: boolean, payload: Buffer): Buffer {
  const verb = protect ? "Protect" : "Unprotect"
  const entropy = Buffer.from(DPAPI_ENTROPY_TEXT, "utf8").toString("base64")
  const input = payload.toString("base64")
  const script = [
    "Add-Type -AssemblyName System.Security",
    "$ErrorActionPreference = [System.Management.Automation.ActionPreference]::Stop",
    "$input = [Convert]::FromBase64String('" + input + "')",
    "$entropy = [Convert]::FromBase64String('" + entropy + "')",
    "$out = [System.Security.Cryptography.ProtectedData]::" + verb + "($input, $entropy, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)",
    "[Convert]::ToBase64String($out)"
  ].join("; ")
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    timeout: 20_000,
    encoding: "utf8",
    windowsHide: true,
  })
  if (result.error !== undefined) throw new Error("DPAPI 调用失败（powershell 不可用）：" + result.error.message)
  if (result.status !== 0) {
    const detail = String(result.stderr ?? "").trim().slice(0, 400)
    throw new Error("DPAPI 调用失败：" + (detail.length > 0 ? detail : "未知错误"))
  }
  const encoded = String(result.stdout ?? "").trim()
  if (encoded.length === 0) throw new Error("DPAPI 调用没有返回数据。")
  return Buffer.from(encoded, "base64")
}

export function dpapiProtect(plain: Buffer): string {
  if (plain.length === 0) throw new Error("DPAPI 保护内容不能为空。")
  return dpapiInvoke(true, plain).toString("base64")
}

export function dpapiUnprotect(blob: string): Buffer {
  if (blob.length === 0) throw new Error("DPAPI 密文不能为空。")
  return dpapiInvoke(false, Buffer.from(blob, "base64"))
}

// ---------- 恢复口令（BIP-39 词表 + scrypt + AES-256-GCM） ----------

export function generatePassphrase(words = RECOVERY_PASSPHRASE_WORDS): string {
  const picked: string[] = []
  for (let index = 0; index < words; index += 1) {
    picked.push(BIP39_ENGLISH[randomInt(0, BIP39_ENGLISH.length)] ?? "abandon")
  }
  return picked.join(" ")
}

export function normalizePassphrase(input: string): string {
  const words = input.trim().toLowerCase().split(/\s+/u).filter((word) => word.length > 0)
  if (words.length === 0) throw new Error("恢复口令不能为空。")
  return words.join(" ")
}

export function wrapRecovery(key: Buffer, passphrase: string): RecoveryWrap {
  if (key.length !== DATA_KEY_BYTES) throw new Error("恢复包裹需要 32 字节数据密钥。")
  const salt = randomBytes(16)
  const nonce = randomBytes(12)
  const derived = scryptSync(normalizePassphrase(passphrase), salt, DATA_KEY_BYTES, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P })
  const cipher = createCipheriv("aes-256-gcm", derived, nonce)
  const ciphertext = Buffer.concat([cipher.update(key), cipher.final()])
  return {
    kdf: "scrypt",
    n: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    salt: salt.toString("base64"),
    nonce: nonce.toString("base64"),
    ciphertext: Buffer.concat([ciphertext, cipher.getAuthTag()]).toString("base64"),
    words: RECOVERY_PASSPHRASE_WORDS,
  }
}

export function unwrapRecovery(recovery: RecoveryWrap, passphrase: string): Buffer {
  if (recovery.kdf !== "scrypt") throw new Error("不支持的恢复包裹格式。")
  const salt = Buffer.from(recovery.salt, "base64")
  const nonce = Buffer.from(recovery.nonce, "base64")
  const payload = Buffer.from(recovery.ciphertext, "base64")
  if (payload.length < 17) throw new Error("恢复包裹数据损坏。")
  const ciphertext = payload.subarray(0, payload.length - 16)
  const tag = payload.subarray(payload.length - 16)
  const derived = scryptSync(normalizePassphrase(passphrase), salt, DATA_KEY_BYTES, { N: recovery.n, r: recovery.r, p: recovery.p })
  const decipher = createDecipheriv("aes-256-gcm", derived, nonce)
  decipher.setAuthTag(tag)
  try {
    const key = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    if (key.length !== DATA_KEY_BYTES) throw new Error("恢复口令解出的密钥长度不正确。")
    return key
  } catch (error) {
    if (error instanceof Error && /auth/u.test(error.message)) throw new Error("恢复口令不正确。")
    throw error
  }
}

// ---------- 主密钥文件 v2（每个记忆库根目录一把）与一次性恢复口令文件 ----------

export function masterKeyFilePath(dbRoot: string): string {
  return join(dbRoot, "memory.key.json")
}

export function legacyKeyFilePath(dbPath: string): string {
  return dbPath + ".key"
}

export function readMasterKeyFile(dbRoot: string): DataKeyFileV2 | null {
  const path = masterKeyFilePath(dbRoot)
  if (!existsSync(path)) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as unknown
  } catch {
    throw new Error("数据密钥文件无法解析：" + path)
  }
  if (typeof parsed !== "object" || parsed === null) throw new Error("数据密钥文件格式损坏。")
  const record = parsed as Record<string, unknown>
  const dpapi = record.dpapi as Record<string, unknown> | undefined
  const recovery = record.recovery as Record<string, unknown> | undefined
  if (record.version !== KEY_FILE_VERSION
    || typeof dpapi?.blob !== "string"
    || dpapi.blob.length === 0
    || typeof recovery?.salt !== "string"
    || typeof recovery?.nonce !== "string"
    || typeof recovery?.ciphertext !== "string"
    || typeof recovery?.n !== "number"
    || typeof recovery?.r !== "number"
    || typeof recovery?.p !== "number") {
    throw new Error("数据密钥文件字段缺失或损坏。")
  }
  return {
    version: KEY_FILE_VERSION,
    dpapi: { scope: "current-user", blob: dpapi.blob },
    recovery: {
      kdf: "scrypt",
      n: recovery.n as number,
      r: recovery.r as number,
      p: recovery.p as number,
      salt: recovery.salt as string,
      nonce: recovery.nonce as string,
      ciphertext: recovery.ciphertext as string,
      words: RECOVERY_PASSPHRASE_WORDS,
    },
  }
}

export function writeMasterKeyFile(dbRoot: string, key: Buffer, passphrase: string, emitPassphraseFile: boolean): void {
  if (key.length !== DATA_KEY_BYTES) throw new Error("数据密钥必须是 32 字节。")
  mkdirSync(dbRoot, { recursive: true })
  const file: DataKeyFileV2 = {
    version: KEY_FILE_VERSION,
    dpapi: { scope: "current-user", blob: dpapiProtect(key) },
    recovery: wrapRecovery(key, passphrase),
  }
  writeFileSync(masterKeyFilePath(dbRoot), JSON.stringify(file, null, 2) + "\n", "utf8")
  if (emitPassphraseFile) {
    const oneTimePath = join(dbRoot, "recovery-passphrase.txt")
    const text = [
      "DeepSeek Harness 记忆库恢复口令（一次性展示，请立即转存后删除本文件）",
      "记忆库根目录：" + dbRoot,
      "恢复口令：" + passphrase,
      "转存：把恢复口令连同记忆库根目录一起存入你的密钥库（cyrus-keyring）。",
      "恢复：换机/重装后，用 scripts/memory-recover.mjs <记忆库根目录> <恢复口令> 重建本机解锁。",
      "警告：恢复口令一旦丢失，记忆库将无法恢复。本文件请勿备份到公开位置。",
    ].join("\n")
    writeFileSync(oneTimePath, text + "\n", "utf8")
  }
}

export function loadOrCreateMasterKey(dbRoot: string, legacyDbPath: string): Buffer {
  const existing = readMasterKeyFile(dbRoot)
  if (existing !== null) {
    try {
      const key = dpapiUnprotect(existing.dpapi.blob)
      if (key.length !== DATA_KEY_BYTES) throw new Error("DPAPI 解出的数据密钥长度不正确。")
      return key
    } catch (error) {
      throw new Error("数据密钥无法用当前 Windows 账户解锁（" + (error instanceof Error ? error.message : "DPAPI 失败") + "）。请用恢复口令运行 scripts/memory-recover.mjs 重建解锁。")
    }
  }
  const legacyPath = legacyKeyFilePath(legacyDbPath)
  if (existsSync(legacyPath)) {
    const key = Buffer.from(readFileSync(legacyPath, "utf8").trim(), "hex")
    if (key.length !== DATA_KEY_BYTES) throw new Error("旧版密钥文件内容损坏。")
    writeMasterKeyFile(dbRoot, key, generatePassphrase(), true)
    rmSync(legacyPath, { force: true })
    return key
  }
  const key = randomBytes(DATA_KEY_BYTES)
  writeMasterKeyFile(dbRoot, key, generatePassphrase(), true)
  return key
}

// ---------- 明文旧库 → SQLCipher 原地升级 ----------

export function isPlaintextDatabase(path: string): boolean {
  if (!existsSync(path)) return false
  let fd: number | undefined
  try {
    fd = openSync(path, "r")
    const head = Buffer.alloc(SQLITE_HEADER.length)
    readSync(fd, head, 0, head.length, 0)
    return head.equals(SQLITE_HEADER)
  } catch {
    return false
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

export type CipherConstructor = new (path: string) => {
  pragma(source: string): void
  exec(sql: string): void
  close(): void
}

export function requireCipherConstructor(): CipherConstructor {
  return require("better-sqlite3-multiple-ciphers") as unknown as CipherConstructor
}

export function integrityOfCipher(path: string, key: Buffer, Database: CipherConstructor): boolean {
  const db = new Database(path)
  try {
    db.pragma("key = \"" + key.toString("hex") + "\"")
    const rows = db.pragma("integrity_check") as unknown as Array<{ integrity_check?: string }>
    return rows.length === 1 && rows[0]?.integrity_check === "ok"
  } finally {
    db.close()
  }
}

export function encryptPlaintextDatabase(dbPath: string, key: Buffer, Database: CipherConstructor): void {
  if (key.length !== DATA_KEY_BYTES) throw new Error("数据密钥必须是 32 字节。")
  const backupPath = dbPath + ".pre-encrypt.bak"
  rmSync(backupPath, { force: true })
  copyFileSync(dbPath, backupPath)
  const db = new Database(dbPath)
  try {
    // better-sqlite3-multiple-ciphers 支持 rekey：明文连接设置密钥后原地重写为密文（与打开路径同 hex 约定）。
    db.pragma("rekey = \"" + key.toString("hex") + "\"")
  } finally {
    db.close()
  }
  if (!integrityOfCipher(dbPath, key, Database)) {
    copyFileSync(backupPath, dbPath)
    throw new Error("明文库加密升级校验失败，已还原原库。")
  }
}
