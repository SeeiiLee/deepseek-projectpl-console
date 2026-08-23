// P6-0A：Codex 历史语料只读盘点（合同 v1）。
// 约束：只读源文件；不打印任何消息正文/密钥；输出仅元数据；可重复运行、结果确定。
// 用法：node scripts/codex-inventory.mjs [--sessions-root <dir>] [--out <dir>]
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { join, relative, resolve } from 'node:path'

const NL = String.fromCharCode(10)
const CONTRACT = 'codex-session-import/v1'

function arg(name, fallback) {
  const index = process.argv.indexOf(name)
  if (index >= 0 && process.argv[index + 1] !== undefined) return process.argv[index + 1]
  return fallback
}

const SESSIONS_ROOT = resolve(arg('--sessions-root', join(process.env.USERPROFILE ?? 'C:/Users/Administrator', '.codex', 'sessions')))
const OUT = resolve(arg('--out', join('F:/AI/codex-import', 'snapshot-' + new Date().toISOString().replace(/[:.]/g, '-'))))

if (!existsSync(SESSIONS_ROOT)) {
  console.error('sessions root 不存在: ' + SESSIONS_ROOT)
  process.exit(2)
}

/** 枚举全部 .jsonl 并以 realpath 去重（junction/别名防重计）。 */
function enumerate(root) {
  const byRealpath = new Map()
  for (const rel of readdirSync(root, { recursive: true })) {
    const full = join(root, rel)
    if (!rel.endsWith('.jsonl')) continue
    let real
    try { real = realpathSync(full) } catch { real = full }
    const entry = byRealpath.get(real)
    if (entry === undefined) byRealpath.set(real, { path: full, real, duplicateOf: null })
    else byRealpath.set(real, { path: full, real, duplicateOf: entry.path })
  }
  return [...byRealpath.values()].sort((a, b) => (a.real < b.real ? -1 : a.real > b.real ? 1 : 0))
}

function sha256File(path) {
  return new Promise((resolvePromise, rejectPromise) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('data', (chunk) => { hash.update(chunk) })
    stream.on('end', () => { resolvePromise(hash.digest('hex')) })
    stream.on('error', rejectPromise)
  })
}

/** 流式逐行解析：只提取类型计数与 session_meta 元数据（绝不取正文）。 */
async function scan(path) {
  const typeCounts = {}
  const meta = { sessionIds: new Set(), forkIds: new Set(), parentIds: new Set(), cwds: new Set(), firstAt: null, lastAt: null }
  let lineCount = 0
  let badLines = 0
  let tooLongLines = 0
  const rl = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity })
  for await (const line of rl) {
    if (line.trim() === '') continue
    lineCount += 1
    if (line.length > 64 * 1024 * 1024) { tooLongLines += 1; continue }
    let obj
    try { obj = JSON.parse(line) } catch { badLines += 1; continue }
    const type = typeof obj.type === 'string' ? obj.type : '(unknown)'
    typeCounts[type] = (typeCounts[type] ?? 0) + 1
    if (typeof obj.timestamp === 'string' && obj.timestamp !== '') {
      if (meta.firstAt === null || obj.timestamp < meta.firstAt) meta.firstAt = obj.timestamp
      if (meta.lastAt === null || obj.timestamp > meta.lastAt) meta.lastAt = obj.timestamp
    }
    if (type === 'session_meta' && obj.payload !== null && typeof obj.payload === 'object') {
      const p = obj.payload
      if (typeof p.session_id === 'string' && p.session_id !== '') meta.sessionIds.add(p.session_id)
      if (typeof p.forked_from_id === 'string' && p.forked_from_id !== '') meta.forkIds.add(p.forked_from_id)
      if (typeof p.parent_thread_id === 'string' && p.parent_thread_id !== '') meta.parentIds.add(p.parent_thread_id)
      if (typeof p.cwd === 'string' && p.cwd !== '') meta.cwds.add(p.cwd)
    }
  }
  return { lineCount, badLines, tooLongLines, typeCounts, meta }
}

const files = enumerate(SESSIONS_ROOT)
console.log('[codex-inventory] 唯一源文件数: ' + files.length + '（去重后）')

mkdirSync(OUT, { recursive: true })
const sourceOut = join(OUT, 'source-files.jsonl')
const summaryOut = join(OUT, 'summary.json')
const hashOut = join(OUT, 'hashes.sha256')
const sourceStream = []
const summary = { contract: CONTRACT, generatedAt: new Date().toISOString(), sessionsRoot: SESSIONS_ROOT, files: 0, bytes: 0, status: {}, eventTypes: {}, cwdCount: 0, cwds: [], cwdFrequency: {}, duplicates: 0, badLines: 0, tooLongLines: 0, locked: 0 }
const cwdFreq = {}
const allCwds = new Set()

for (const [index, entry] of files.entries()) {
  // source_file 用遍历路径（junction 下保持相对、可读）；source_realpath 用 canonical（去重/哈希）。
  const rel = relative(SESSIONS_ROOT, entry.path)
  let stat
  try { stat = statSync(entry.real) } catch (error) {
    const record = { source_file: rel, source_sha256: null, bytes: null, mtime: null, status: 'skipped_with_reason', status_reason: 'stat 失败: ' + String(error.code ?? error) }
    sourceStream.push(JSON.stringify(record))
    summary.status.skipped_with_reason = (summary.status.skipped_with_reason ?? 0) + 1
    continue
  }
  if (entry.duplicateOf !== null) summary.duplicates += 1
  let hash = null
  let scanResult = null
  let status = 'processed'
  let statusReason = ''
  try {
    hash = await sha256File(entry.real)
    scanResult = await scan(entry.real)
  } catch (error) {
    status = 'retryable'
    statusReason = '读取失败（可能被占用）: ' + String(error.code ?? error)
    summary.locked += 1
  }
  summary.files += 1
  summary.bytes += stat.size
  summary.badLines += scanResult === null ? 0 : scanResult.badLines
  summary.tooLongLines += scanResult === null ? 0 : scanResult.tooLongLines
  if (scanResult !== null) {
    for (const [type, count] of Object.entries(scanResult.typeCounts)) {
      summary.eventTypes[type] = (summary.eventTypes[type] ?? 0) + count
    }
    for (const cwd of scanResult.meta.cwds) {
      allCwds.add(cwd)
      cwdFreq[cwd] = (cwdFreq[cwd] ?? 0) + 1
    }
  }
  const record = {
    source_file: rel,
    source_sha256: hash,
    bytes: stat.size,
    mtime: stat.mtime.toISOString(),
    status,
    line_count: scanResult === null ? null : scanResult.lineCount,
    bad_lines: scanResult === null ? 0 : scanResult.badLines,
    too_long_lines: scanResult === null ? 0 : scanResult.tooLongLines,
    event_type_counts: scanResult === null ? {} : scanResult.typeCounts,
    session_ids: scanResult === null ? [] : [...scanResult.meta.sessionIds].slice(0, 8),
    forked_from_ids: scanResult === null ? [] : [...scanResult.meta.forkIds].slice(0, 8),
    parent_thread_ids: scanResult === null ? [] : [...scanResult.meta.parentIds].slice(0, 8),
    cwds: scanResult === null ? [] : [...scanResult.meta.cwds].slice(0, 8),
    first_at: scanResult === null ? null : scanResult.meta.firstAt,
    last_at: scanResult === null ? null : scanResult.meta.lastAt,
  }
  if (statusReason !== '') record.status_reason = statusReason
  sourceStream.push(JSON.stringify(record))
  if ((index + 1) % 50 === 0 || index + 1 === files.length) console.log('[codex-inventory] 进度 ' + (index + 1) + '/' + files.length)
}

summary.status.processed = files.length - (summary.status.skipped_with_reason ?? 0) - summary.locked
summary.cwds = [...allCwds].sort()
summary.cwdCount = allCwds.size
summary.cwdFrequency = Object.fromEntries([...Object.entries(cwdFreq)].sort((a, b) => b[1] - a[1]).slice(0, 40))
writeFileSync(sourceOut, sourceStream.join(NL) + NL, 'utf8')
writeFileSync(summaryOut, JSON.stringify(summary, null, 2), 'utf8')
const hashLines = []
for (const raw of sourceStream) {
  const record = JSON.parse(raw)
  if (record.source_sha256 !== null) hashLines.push(record.source_sha256 + '  ' + record.source_file)
}
writeFileSync(hashOut, hashLines.join(NL) + NL, 'utf8')
console.log('[codex-inventory] 完成。输出目录: ' + OUT)
console.log('[codex-inventory] 摘要: files=' + summary.files + ' bytes=' + summary.bytes + ' locked=' + summary.locked + ' skipped=' + (summary.status.skipped_with_reason ?? 0) + ' badLines=' + summary.badLines + ' cwdCount=' + summary.cwdCount)
