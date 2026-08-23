// P6-0B：Codex 语料流式解析 + fork 去重 + 项目映射 dry-run（合同 codex-session-import/v1）。
// 约束：不复制/不输出消息正文；只产出元数据包；可 checkpoint 续跑；输出确定可复现。
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { basename, join, resolve } from 'node:path'

const NL = String.fromCharCode(10)
const CONTRACT = 'codex-session-import/v1'
const PARSER_VERSION = 'codex-parser/1'
const MAX_LINEAGE_DEPTH = 64

function arg(name, fallback) {
  const index = process.argv.indexOf(name)
  if (index >= 0 && process.argv[index + 1] !== undefined) return process.argv[index + 1]
  return fallback
}

function latestSnapshotDir() {
  const root = 'F:/AI/codex-import'
  const entries = readdirSyncSafe(root).filter((name) => name.startsWith('snapshot-')).sort()
  if (entries.length === 0) throw new Error('没有 inventory snapshot：先跑 scripts/codex-inventory.mjs')
  return join(root, entries[entries.length - 1])
}

function readdirSyncSafe(dir) {
  try { return readdirSync(dir) } catch { return [] }
}

const SNAPSHOT = resolve(arg('--snapshot', latestSnapshotDir()))
const OUT = resolve(arg('--out', join('F:/AI/codex-import', 'package-' + basename(SNAPSHOT))))
const RESUME = process.argv.includes('--resume')
const STATE_PATH = join(OUT, 'import-state.json')

// ---------- 项目映射表 v1（别名/rebind + 未登记项目标记；fail closed，禁止猜测） ----------
const PROJECT_MAPPING = [
  { cwd: 'F:\\QClawData\\workspace\\meal_tracker', projectLabel: '食溯(mealtracker)', projectId: 'prj_01a00719', status: 'registered', note: '待 Cyrus 确认 project_id 与 mealtracker 对应' },
  { cwdPrefix: 'C:\\Users\\Administrator\\.codex\\worktrees', pathContains: 'meal_tracker', aliasTo: 'F:\\QClawData\\workspace\\meal_tracker', status: 'alias' },
  { cwd: 'F:\\documents\\Kimi\\Workspaces\\Amazon Store', projectLabel: '亚马逊店铺', projectId: null, status: 'needs-registration' },
  { cwd: 'F:\\documents\\Kimi\\Workspaces\\Cyrus Quant Trading', projectLabel: '量化盯盘', projectId: null, status: 'needs-registration' },
  { cwd: 'D:\\Deepseek Harness Personal', projectLabel: 'DSH Personal 开发', projectId: null, status: 'needs-registration' },
]

function normalizeCwd(value) { return String(value).replace(/[\u200b\u200c\u200d\ufeff]/g, '').trim() }

function resolveProject(cwd) {
  if (cwd === '') return { resolution: 'unmapped', reason: 'session 无 cwd' }
  cwd = normalizeCwd(cwd)
  for (const rule of PROJECT_MAPPING) {
    if (rule.aliasTo !== undefined) {
      if (rule.cwdPrefix !== undefined && cwd.startsWith(rule.cwdPrefix) && (rule.pathContains === undefined || cwd.includes(rule.pathContains))) {
        return { resolution: 'mapped', projectLabel: '食溯(mealtracker)', projectId: rule.aliasTo, matchedBy: 'alias', appliedRule: JSON.stringify({ prefix: rule.cwdPrefix, contains: rule.pathContains }) }
      }
      continue
    }
    if (cwd === normalizeCwd(rule.cwd)) {
      return { resolution: rule.status === 'registered' ? 'mapped' : 'mapped-pending-registration', projectLabel: rule.projectLabel, projectId: rule.projectId ?? null, matchedBy: 'exact', status: rule.status, ...(rule.note !== undefined ? { note: rule.note } : {}) }
    }
  }
  return { resolution: 'unmapped', reason: 'cwd 不在映射表' }
}

function sha256(text) { return createHash('sha256').update(text).digest('hex') }

/** 从 content 块数组提取文本（只取长度与哈希，不保留正文）。 */
function contentDigest(content) {
  if (!Array.isArray(content)) return { charLength: 0, hash: sha256('') }
  const parts = []
  let charLength = 0
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    const text = block.text ?? block.output_text ?? block.input_text
    if (typeof text === 'string' && text !== '') { parts.push(text); charLength += text.length }
  }
  return { charLength, hash: sha256(parts.join(String.fromCharCode(10))) }
}

const inventory = JSON.parse(readFileSync(join(SNAPSHOT, 'summary.json'), 'utf8'))
const sourceRows = readFileSync(join(SNAPSHOT, 'source-files.jsonl'), 'utf8').trim().split(NL).filter((line) => line !== '').map((line) => JSON.parse(line))

const sessions = new Map() // key = rolloutId（文件名 uuid，每个 fork 文件唯一）；值含逻辑 sessionId + 血缘
const fileOrder = []

console.log('[codex-dryrun] 源文件 ' + sourceRows.length + ' 个，输出 ' + OUT)
mkdirSync(OUT, { recursive: true })
let state = { contract: CONTRACT, parserVersion: PARSER_VERSION, processedSha256: [], counters: {} }
if (RESUME && existsSync(STATE_PATH)) state = JSON.parse(readFileSync(STATE_PATH, 'utf8'))
const doneSet = new Set(state.processedSha256)

async function scanFile(rel, sha) {
  // rel 是相对遍历根的路径（可穿过 junction 读取）；canonical 哈希见盘点。
  const path = join(inventory.sessionsRoot, rel)
  const rolloutId = basename(rel).replace(/^rollout-/, '').replace(/\.jsonl$/, '')
  const rl = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity })
  const facts = { sessionId: '', cwds: new Set(), forkedFrom: '', parentThread: '', firstAt: null, lastAt: null }
  const turns = []
  const eventCounts = {}
  let lineSeq = 0
  for await (const line of rl) {
    if (line.trim() === '') continue
    lineSeq += 1
    let obj
    try { obj = JSON.parse(line) } catch { continue }
    const type = typeof obj.type === 'string' ? obj.type : '(unknown)'
    eventCounts[type] = (eventCounts[type] ?? 0) + 1
    const ts = typeof obj.timestamp === 'string' ? obj.timestamp : ''
    if (ts !== '') { if (facts.firstAt === null || ts < facts.firstAt) facts.firstAt = ts; if (facts.lastAt === null || ts > facts.lastAt) facts.lastAt = ts }
    if (type === 'session_meta' && obj.payload !== null && typeof obj.payload === 'object') {
      const p = obj.payload
      if (facts.sessionId === '' && typeof p.session_id === 'string') facts.sessionId = p.session_id
      if (typeof p.cwd === 'string' && p.cwd !== '') facts.cwds.add(p.cwd)
      if (typeof p.forked_from_id === 'string' && p.forked_from_id !== '') facts.forkedFrom = p.forked_from_id
      if (typeof p.parent_thread_id === 'string' && p.parent_thread_id !== '') facts.parentThread = p.parent_thread_id
    }
    if (type === 'response_item' && obj.payload !== null && typeof obj.payload === 'object') {
      const p = obj.payload
      const itemType = typeof p.type === 'string' ? p.type : ''
      const role = typeof p.role === 'string' ? p.role : ''
      if (itemType === 'message' && (role === 'user' || role === 'assistant')) {
        const digest = contentDigest(p.content)
        turns.push({
          lineSeq, turnId: typeof p.internal_chat_message_metadata_passthrough?.turn_id === 'string' ? p.internal_chat_message_metadata_passthrough.turn_id : '',
          role, itemType, timestamp: ts, charLength: digest.charLength, hash: digest.hash,
        })
      }
    }
  }
  if (facts.sessionId === '') facts.sessionId = rolloutId
  sessions.set(rolloutId, { rolloutId, file: rel, sha, ...facts, turns, eventCounts })
  fileOrder.push({ rel, sha, rolloutId })
}

let index = 0
for (const row of sourceRows) {
  index += 1
  if (row.source_sha256 === null) continue
  if (doneSet.has(row.source_sha256)) { console.log('[codex-dryrun] 跳过已处理 ' + row.source_file); continue }
  try {
    await scanFile(row.source_file, row.source_sha256)
    doneSet.add(row.source_sha256)
    state.processedSha256 = [...doneSet].sort()
    state.counters.sessions = sessions.size
    writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf8')
  } catch (error) {
    console.log('[codex-dryrun] retryable: ' + row.source_file + ' -> ' + String(error.code ?? error))
  }
  if (index % 50 === 0 || index === sourceRows.length) console.log('[codex-dryrun] 进度 ' + index + '/' + sourceRows.length + '（sessions ' + sessions.size + '）')
}

// ---------- fork 血缘 + 内容级去重（只标记 inherited_from，不删记录） ----------
// 实测：forked_from_id / parent_thread_id 是「逻辑会话 id」空间（非 rollout 文件名 uuid）。
// 血缘按逻辑 id 走；祖先 = 父逻辑 id 传递闭包对应的全部 rollout，取其 turn 哈希集合去重。
const logicalToRollouts = new Map()
for (const [rolloutId, s] of sessions) {
  const logical = s.sessionId
  if (!logicalToRollouts.has(logical)) logicalToRollouts.set(logical, new Set())
  logicalToRollouts.get(logical).add(rolloutId)
}
function parentLogicalOf(rolloutId) {
  const s = sessions.get(rolloutId)
  if (s === undefined) return ''
  return s.forkedFrom !== '' ? s.forkedFrom : s.parentThread
}
function ancestorRolloutsOf(rolloutId) {
  const seen = new Set()
  let current = parentLogicalOf(rolloutId)
  let depth = 0
  while (current !== '' && depth < MAX_LINEAGE_DEPTH) {
    const rollouts = logicalToRollouts.get(current)
    if (rollouts !== undefined) for (const other of rollouts) seen.add(other)
    current = parentLogicalOf(rollouts === undefined ? '' : [...rollouts][0] ?? '')
    depth += 1
  }
  return seen
}
let totalTurns = 0
let dedupedTurns = 0
for (const [id, s] of sessions) {
  const ancestorHashes = new Set()
  for (const ancestor of ancestorRolloutsOf(id)) {
    const ancestorSession = sessions.get(ancestor)
    if (ancestorSession !== undefined && ancestorSession.sessionId !== s.sessionId) {
      for (const turn of ancestorSession.turns) ancestorHashes.add(turn.hash)
    }
  }
  for (const turn of s.turns) {
    totalTurns += 1
    if (ancestorHashes.has(turn.hash)) { turn.inheritedFrom = true; dedupedTurns += 1 }
  }
}

// ---------- 输出包 ----------
const writeJsonl = (name, rows) => { writeFileSync(join(OUT, name), rows.map((row) => JSON.stringify(row)).join(NL) + (rows.length > 0 ? NL : ''), 'utf8') }
const mappingRows = []
const mappingSeen = new Set()
const quarantineRows = []
const sessionRows = []
const turnRows = []
const evidenceRows = []

for (const [id, s] of [...sessions.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
  const cwdList = [...s.cwds].sort()
  let resolution
  if (cwdList.length === 0) resolution = resolveProject('')
  else if (cwdList.length > 1) resolution = { resolution: 'ambiguous', reason: '多个 cwd: ' + cwdList.join(' | ') }
  else resolution = resolveProject(cwdList[0])
  const mappingKey = (cwdList[0] ?? '(none)')
  if (!mappingSeen.has(mappingKey)) {
    mappingSeen.add(mappingKey)
    mappingRows.push({ cwd: cwdList[0] ?? null, resolution: resolution.resolution, ...(resolution.projectLabel !== undefined ? { projectLabel: resolution.projectLabel } : {}), ...(resolution.projectId !== undefined ? { projectId: resolution.projectId } : {}), ...(resolution.reason !== undefined ? { reason: resolution.reason } : {}), ...(resolution.status !== undefined ? { registrationStatus: resolution.status } : {}), ...(resolution.note !== undefined ? { note: resolution.note } : {}) })
  }
  if (resolution.resolution === 'unmapped' || resolution.resolution === 'ambiguous') {
    quarantineRows.push({ rollout_id: id, session_id: s.sessionId, source_file: s.file, cwds: cwdList, resolution: resolution.resolution, reason: resolution.reason ?? '见 project-mapping.jsonl' })
  }
  const sessionRecord = {
    rollout_id: id, session_id: s.sessionId, source_file: s.file, source_sha256: s.sha, forked_from_id: s.forkedFrom, parent_thread_id: s.parentThread,
    cwds: cwdList, project_resolution: resolution.resolution, ...(resolution.projectLabel !== undefined ? { project_label: resolution.projectLabel } : {}),
    ...(resolution.projectId !== null && resolution.projectId !== undefined ? { project_id: resolution.projectId } : {}),
    first_at: s.firstAt, last_at: s.lastAt, event_counts: s.eventCounts, turn_count: s.turns.length,
  }
  sessionRows.push(sessionRecord)
  for (const turn of s.turns) {
    turnRows.push({
      locator: 'codex://' + id + '#' + String(turn.lineSeq), session_id: s.sessionId, rollout_id: id, source_sha256: s.sha, source_line: turn.lineSeq,
      turn_id: turn.turnId, role: turn.role, item_type: turn.itemType, timestamp: turn.timestamp,
      content_hash: turn.hash, char_length: turn.charLength,
      project_resolution: resolution.resolution, ...(resolution.projectLabel !== undefined ? { project_label: resolution.projectLabel } : {}),
      ...(turn.inheritedFrom === true ? { inherited_from_ancestor: true } : {}),
    })
  }
  evidenceRows.push({ locator: 'codex://' + id, session_id: s.sessionId, rollout_id: id, source_sha256: s.sha, source_file: s.file, cwds: cwdList, first_at: s.firstAt, last_at: s.lastAt, turn_count: s.turns.length })
}

writeJsonl('sessions.jsonl', sessionRows)
writeJsonl('turn-index.jsonl', turnRows)
writeJsonl('evidence-index.jsonl', evidenceRows)
writeJsonl('project-mapping.jsonl', mappingRows)
writeJsonl('quarantine.jsonl', quarantineRows)
writeFileSync(join(OUT, 'source-files.jsonl'), sourceRows.map((row) => JSON.stringify(row)).join(NL) + NL, 'utf8')

const manifest = {
  contract: CONTRACT, parserVersion: PARSER_VERSION, generatedAt: inventory.generatedAt, // 冻结为源快照时间，保证重跑确定性
  sourceSnapshot: basename(SNAPSHOT), sessionsRoot: inventory.sessionsRoot,
  counters: {
    sourceFiles: sourceRows.length, sessions: sessions.size, totalTurns, dedupedTurns,
    dedupRate: totalTurns === 0 ? 0 : Number((dedupedTurns / totalTurns).toFixed(4)),
    quarantineSessions: quarantineRows.length, badLines: inventory.badLines,
    mappedSessions: sessionRows.filter((row) => row.project_resolution === 'mapped' || row.project_resolution === 'mapped-pending-registration').length,
    unmappedSessions: sessionRows.filter((row) => row.project_resolution === 'unmapped' || row.project_resolution === 'ambiguous').length,
  },
}
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
state.counters = manifest.counters
writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf8')

const pkgFiles = ['manifest.json', 'source-files.jsonl', 'sessions.jsonl', 'turn-index.jsonl', 'evidence-index.jsonl', 'project-mapping.jsonl', 'quarantine.jsonl', 'import-state.json']
const hashLines = []
for (const name of pkgFiles) hashLines.push(sha256(readFileSync(join(OUT, name), 'utf8')) + '  ' + name)
writeFileSync(join(OUT, 'hashes.sha256'), hashLines.join(NL) + NL, 'utf8')

console.log('[codex-dryrun] 完成。输出: ' + OUT)
console.log('[codex-dryrun] sessions=' + sessions.size + ' turns=' + totalTurns + ' deduped=' + dedupedTurns + '（率 ' + manifest.counters.dedupRate + '） quarantine=' + quarantineRows.length + ' mapped=' + manifest.counters.mappedSessions + ' unmapped=' + manifest.counters.unmappedSessions)
