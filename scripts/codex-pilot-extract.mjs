// P6-0C 试点正式提取（修订版 B）：3 个会话（最大根 / 最早根 / 最新），官方 API，预算硬上限，候选落稳定库。
// 密钥：cyrus-keyring get DEEPSEEK_API_KEY（进程内使用，不落盘、不打印）。候选只写 candidate + llm_extracted，带 codex:// 证据。
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import {
  buildBatches,
  callCostYuan,
  locatorTextReader,
  readStagingPackage,
  runExtraction,
} from '../plugins/memory/src/core/codex-import-extractor.ts'
import { MemoryService } from '../plugins/memory/src/core/service.ts'

const PACKAGE_DIR = 'F:\\AI\\codex-import\\package-snapshot-v2'
const PROJECT_ID = 'prj_01a0109b-0dd8-7bfb-be07-ee80c768640d'
const STABLE_DB_ROOT = 'F:\\documents\\Cyrus Deepseek Harness Data\\memory-live'
const BUDGET_YUAN = 2.0
const CHECKPOINT = join(PACKAGE_DIR, 'pilot-extract-state.json')
const ENDPOINT = 'https://api.deepseek.com'
const KEYRING_TOOL = 'C:\\Users\\Administrator\\.dsh\\skills\\cyrus-keyring\\scripts\\keyring_tool.py'

function keyringKey(name) {
  const out = execFileSync('python', [KEYRING_TOOL, 'get', name], { encoding: 'utf8', windowsHide: true, timeout: 30_000 })
  const key = String(out ?? '').trim()
  if (key === '') throw new Error('keyring 未取到 ' + name)
  return key
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

const { sessions, turns } = readStagingPackage(PACKAGE_DIR)
const food = sessions.filter((s) => s.project_label === '食溯(mealtracker)')
const byRoll = new Map()
for (const turn of turns) {
  if (turn.project_label !== '食溯(mealtracker)') continue
  const entry = byRoll.get(turn.rollout_id) ?? { chars: 0, n: 0 }
  entry.chars += turn.char_length
  entry.n += 1
  byRoll.set(turn.rollout_id, entry)
}
const roots = food.filter((s) => !(typeof s.forked_from_id === 'string' && s.forked_from_id !== '') && byRoll.has(s.rollout_id))
const topRoot = roots.reduce((a, b) => (byRoll.get(b.rollout_id).chars > byRoll.get(a.rollout_id).chars ? b : a))
const earlyRoot = roots.reduce((a, b) => ((b.first_at ?? '') < (a.first_at ?? '') ? b : a))
const newest = food.reduce((a, b) => ((b.last_at ?? '') > (a.last_at ?? '') ? b : a))
const picked = new Map()
for (const session of [topRoot, earlyRoot, newest]) picked.set(session.rollout_id, session)
const pickedSessions = [...picked.values()]
const batches = buildBatches(pickedSessions, turns)
const totalChars = batches.reduce((sum, batch) => sum + batch.chars, 0)
const estYuan = callCostYuan({ missIn: Math.round(totalChars * 0.6) + batches.length * 800, out: batches.length * 400 })
console.log('pilot sessions:')
for (const session of pickedSessions) {
  console.log('  ' + session.rollout_id + ' | chars=' + byRoll.get(session.rollout_id).chars + ' | turns=' + byRoll.get(session.rollout_id).n + ' | first=' + session.first_at + ' | last=' + session.last_at)
}
console.log('batches=' + batches.length + ' chars=' + totalChars + ' estAllMiss=¥' + estYuan.toFixed(2) + ' (cache hit 会更低)')

const apiKey = keyringKey('api.deepseek.v4.key')
const readText = locatorTextReader(PACKAGE_DIR)
const result = await runExtraction({
  endpoint: ENDPOINT,
  apiKey,
  projectId: PROJECT_ID,
  batches,
  readText,
  budgetYuan: BUDGET_YUAN,
  offPeakOnly: true,
  checkpointFile: CHECKPOINT,
  onProgress: (p) => console.log('progress: done=' + p.done + '/' + p.total + ' spent=¥' + p.spentYuan.toFixed(3) + ' candidates=' + p.candidates),
})

const service = new MemoryService({ dbRoot: STABLE_DB_ROOT, encrypted: true })
let written = 0
let rejected = 0
for (const candidate of result.candidates) {
  const kind = ['project_fact', 'event', 'pattern'].includes(candidate.kind) ? candidate.kind : 'event'
  let ok = false
  for (let attempt = 1; attempt <= 3 && !ok; attempt += 1) {
    try {
      service.record({ kind, text: candidate.text, scope: 'project', projectId: PROJECT_ID, confirm: false, evidence: candidate.locator, evidenceKind: 'session', ...(candidate.factualAt === undefined ? {} : { factualAt: candidate.factualAt }) })
      written += 1
      ok = true
    } catch (error) {
      if (attempt === 3 || !/locked|busy/u.test(String(error instanceof Error ? error.message : error))) {
        rejected += 1
        ok = true
      } else {
        await sleep(500 * attempt)
      }
    }
  }
}
console.log('result: calls=' + result.calls + ' spent=¥' + result.spentYuan.toFixed(3) + ' candidates=' + result.candidates.length + ' written=' + written + ' rejected=' + rejected + ' stopped=' + result.stopped + (result.error === undefined ? '' : ' error=' + result.error))
