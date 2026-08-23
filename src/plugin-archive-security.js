// src/plugin-archive-security.js — 插件 tgz 双侧安全解包/扫描模块（A2/A3 共用）
// 随客户端包分发；producer 与 consumer 都使用同一套规则，禁止只在 A2 扫一次。
// 不依赖新安装包：使用随包 vendor/pnpm 内已有的 tar 实现。
import { createRequire } from 'node:module'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(fileURLToPath(new URL('../vendor/pnpm/dist/node_modules/tar/package.json', import.meta.url)))
const tar = require('tar')

export const DEFAULT_MAX_ENTRIES = 2_000
export const DEFAULT_MAX_TOTAL_BYTES = 256 * 1024 * 1024
export const DEFAULT_MAX_SINGLE_FILE_BYTES = 64 * 1024 * 1024

export const BLOCKING_SECRET_PATTERNS = [
  { label: 'GitHub fine-grained PAT', pattern: /github_pat_[A-Za-z0-9_]{20,}/u },
  { label: 'GitHub classic PAT', pattern: /ghp_[A-Za-z0-9]{20,}/u },
  { label: 'OpenAI-style API key', pattern: /sk-[A-Za-z0-9]{20,}/u },
  { label: 'AWS access key', pattern: /AKIA[0-9A-Z]{16}/u },
  { label: 'private key block', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u },
  { label: 'Slack token', pattern: /xox[baprs]-[A-Za-z0-9-]{10,}/u },
]

export const BLOCKING_PERSONAL_PATH_PATTERNS = [
  { label: 'F drive personal data', pattern: /F:\\QClawData|F:\\documents\\Cyrus|F:\\AI/u },
  { label: 'Cyrus install path', pattern: /D:\\Cyrus Deepseek Harness/u },
  { label: 'Administrator home', pattern: /C:\\Users\\Administrator/u },
]

function normalizeEntryPath(rawPath) {
  const path = rawPath.replace(/\\/gu, '/')
  if (path.startsWith('/') || /^[A-Za-z]:\//u.test(path) || path.startsWith('//') || path.includes('\0')) {
    return { ok: false, reason: 'absolute/UNC/drive path' }
  }
  const parts = path.split('/')
  if (parts.some(part => part === '..' || part === '')) {
    return { ok: false, reason: 'path traversal/empty segment' }
  }
  if (path.includes(':')) {
    return { ok: false, reason: 'ADS/colon path' }
  }
  return { ok: true, path }
}

function entryKind(entry) {
  if (entry.type === 'File' || entry.type === 'OldFile' || entry.type === 'ContiguousFile') return 'file'
  if (entry.type === 'Directory') return 'directory'
  return entry.type
}

/**
 * 只读检查 tgz 条目，不落盘。
 * @returns {Promise<{ok:boolean, issues:string[], files:string[], totalBytes:number}>}
 */
export async function inspectTarball(tgzPath, options = {}) {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES
  const maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES
  const maxSingleFileBytes = options.maxSingleFileBytes ?? DEFAULT_MAX_SINGLE_FILE_BYTES
  const issues = []
  const files = []
  const seen = new Set()
  let count = 0
  let totalBytes = 0

  await tar.t({
    file: tgzPath,
    onentry(entry) {
      count += 1
      if (count > maxEntries) {
        issues.push(`条目数超限 > ${maxEntries}`)
        entry.resume()
        return
      }
      const norm = normalizeEntryPath(entry.path)
      if (!norm.ok) {
        issues.push(`${entry.path}: ${norm.reason}`)
        entry.resume()
        return
      }
      const kind = entryKind(entry)
      if (kind !== 'file' && kind !== 'directory') {
        issues.push(`${entry.path}: 拒绝特殊条目 ${kind}`)
        entry.resume()
        return
      }
      const lower = norm.path.toLowerCase()
      if (seen.has(lower)) issues.push(`${entry.path}: 大小写碰撞/重复条目`)
      seen.add(lower)
      if (kind === 'file') {
        const size = Number(entry.size ?? 0)
        if (size > maxSingleFileBytes) issues.push(`${entry.path}: 单文件超限`)
        totalBytes += size
        files.push(norm.path)
        entry.resume()
      }
    },
  })

  if (totalBytes > maxTotalBytes) issues.push(`解压总体积超限 > ${maxTotalBytes}`)
  return { ok: issues.length === 0, issues, files, totalBytes }
}

/**
 * 安全解包到目标目录（先 inspect 再 tar.x，拒绝特殊条目与穿越）。
 */
export async function safeExtractTarball(tgzPath, destDir, options = {}) {
  const inspection = await inspectTarball(tgzPath, options)
  if (!inspection.ok) throw new Error(`tgz 安全检查失败: ${inspection.issues.join('; ')}`)
  await tar.x({ file: tgzPath, cwd: destDir, strict: true, preservePaths: false })
  return inspection
}

/**
 * 扫描已解包目录中的个人路径/密钥；命中任一 BLOCKING 即失败。
 * @returns {{ok:boolean, issues:string[]}}
 */
export function scanExtractedDirectory(directory, { allowedFiles = null } = {}) {
  const issues = []
  const walk = current => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) {
        walk(path)
        continue
      }
      if (!entry.isFile()) {
        issues.push(`${path}: 解包目录含非普通文件`)
        continue
      }
      if (allowedFiles !== null) {
        const rel = path.slice(directory.length + 1).replace(/\\/gu, '/').replace(/^package\//u, '')
        if (!allowedFiles.includes(rel)) {
          issues.push(`${path}: 非白名单文件`)
          continue
        }
      }
      let text
      try {
        if (statSync(path).size > 4 * 1024 * 1024) continue
        text = readFileSync(path, 'utf8')
      } catch {
        continue
      }
      for (const { label, pattern } of [...BLOCKING_SECRET_PATTERNS, ...BLOCKING_PERSONAL_PATH_PATTERNS]) {
        if (pattern.test(text)) {
          issues.push(`${path}: 命中 ${label}`)
          break
        }
      }
    }
  }
  walk(directory)
  return { ok: issues.length === 0, issues }
}

export function assertNoProtectedPath(path, label = '路径') {
  const absolute = resolve(path)
  const protectedRoots = [
    'D:\\Cyrus Deepseek Harness',
    'F:\\documents\\Cyrus Deepseek Harness Data',
    join(process.env.APPDATA ?? '', 'DeepSeek Harness Personal'),
    join(process.env.APPDATA ?? '', 'DeepSeek Harness Personal Dev'),
    join(process.env.USERPROFILE ?? '', '.dsh'),
  ]
  for (const root of protectedRoots) {
    if (absolute.toLowerCase() === root.toLowerCase() || absolute.toLowerCase().startsWith(root.toLowerCase() + sep)) {
      throw new Error(`受保护路径拦截：${label} ${absolute}`)
    }
  }
}
