// P6-0C 测试：抽样确定性 / 切块 / 时段闸门 / 成本记账 / 批量提取（假 fetch）/ 文本读取。
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  buildBatches,
  callCostYuan,
  isOffPeak,
  locatorTextReader,
  runExtraction,
  sampleSessions,
} from '../src/core/codex-import-extractor.ts'

function fakeSessions(n) {
  return Array.from({ length: n }, (_, i) => ({
    rollout_id: 'rollout-' + String(i).padStart(3, '0'),
    session_id: 'logical-' + String(i % 7),
    project_label: '食溯(mealtracker)',
    source_file: '2026/08/01/rollout-' + String(i).padStart(3, '0') + '.jsonl',
    first_at: '2026-08-0' + String((i % 9) + 1) + 'T00:00:00Z',
    last_at: '2026-08-1' + String(i % 9) + 'T12:00:00Z',
    turn_count: (i % 50) + 1,
  }))
}

test('sampleSessions filters label, respects count, deterministic under seed', () => {
  const sessions = fakeSessions(60).concat([{ ...fakeSessions(1)[0], rollout_id: 'other', project_label: '亚马逊店铺' }])
  const a = sampleSessions(sessions, { projectLabel: '食溯(mealtracker)', count: 20 })
  const b = sampleSessions(sessions, { projectLabel: '食溯(mealtracker)', count: 20 })
  assert.equal(a.length, 20)
  assert.deepEqual(a.map(s => s.rollout_id), b.map(s => s.rollout_id))
  assert.equal(a.some(s => s.project_label !== '食溯(mealtracker)'), false)
})

test('buildBatches chunks by char budget and skips short messages', () => {
  const sessions = [{ rollout_id: 'r1', session_id: 's1', project_label: '食溯(mealtracker)', source_file: 'f', first_at: null, last_at: null, turn_count: 3 }]
  const turns = [
    { locator: 'codex://r1#1', session_id: 's1', rollout_id: 'r1', role: 'user', content_hash: 'h1', char_length: 5, timestamp: '2026-07-25T06:26:10.296Z' },
    { locator: 'codex://r1#2', session_id: 's1', rollout_id: 'r1', role: 'assistant', content_hash: 'h2', char_length: 2500, timestamp: '2026-07-25T06:26:11.240Z' },
    { locator: 'codex://r1#3', session_id: 's1', rollout_id: 'r1', role: 'user', content_hash: 'h3', char_length: 2500, timestamp: '2026-07-25T06:26:12.000Z' },
  ]
  const batches = buildBatches(sessions, turns, { charsPerCall: 4000 })
  // 5 字符的 user 消息被 MIN_CANDIDATE_CHARS 预筛跳过；2500+2500 > 4000 预算 → 切成两个单消息批次。
  assert.equal(batches.length, 2)
  assert.equal(batches[0].messages.length, 1)
  assert.equal(batches[0].messages[0].locator, 'codex://r1#2')
  assert.equal(batches[0].messages[0].timestamp, '2026-07-25T06:26:11.240Z')
  assert.equal(batches[1].messages.length, 1)
  assert.equal(batches[1].messages[0].locator, 'codex://r1#3')
  assert.equal(batches[1].messages[0].timestamp, '2026-07-25T06:26:12.000Z')
  assert.equal(batches[0].chars, 2500)
  assert.equal(batches[1].chars, 2500)
  assert.equal(batches.every(b => b.chars <= 4000), true)
})

test('isOffPeak excludes Beijing peak windows', () => {
  const at = (h) => new Date(2026, 7, 17, h, 0, 0)
  assert.equal(isOffPeak(at(8)), true)
  assert.equal(isOffPeak(at(9)), false)
  assert.equal(isOffPeak(at(11)), false)
  assert.equal(isOffPeak(at(13)), true)
  assert.equal(isOffPeak(at(14)), false)
  assert.equal(isOffPeak(at(18)), true)
  assert.equal(isOffPeak(at(23)), true)
})

test('callCostYuan applies official off-peak prices', () => {
  const cost = callCostYuan({ missIn: 1_000_000, out: 100_000 })
  assert.ok(Math.abs(cost - (1.5 + 0.45)) < 1e-6, '1M miss + 100k out = 1.95')
  const cached = callCostYuan({ hitIn: 1_000_000, out: 0 })
  assert.ok(Math.abs(cached - 0.05) < 1e-6)
})

test('runExtraction honors budget and checkpoint with a fake model', async () => {
  const batches = Array.from({ length: 4 }, (_, i) => ({
    rolloutId: 'r' + i, sessionId: 's' + i, chars: 1000,
    messages: [
      { locator: 'codex://r' + i + '#1', role: 'user', charLength: 1000, timestamp: '2026-07-25T06:26:1' + i + '.000Z' },
      { locator: 'codex://r' + i + '#2', role: 'assistant', charLength: 1000, timestamp: '2026-07-25T06:26:2' + i + '.000Z' },
    ],
  }))
  const fakeFetch = async () => new Response(JSON.stringify({
    model: 'deepseek-v4-flash',
    usage: { prompt_tokens: 100, completion_tokens: 50, prompt_cache_miss_tokens: 100, prompt_cache_hit_tokens: 0 },
    choices: [{ message: { content: '{"candidates":[{"kind":"project_fact","scope":"project","text":"试点提取的候选事实内容一","confidence":60}]}' } }],
  }), { status: 200, headers: { 'content-type': 'application/json' } })
  const result = await runExtraction({
    endpoint: 'https://api.example.com', apiKey: 'k', projectId: 'prj_test', batches,
    readText: (locator) => '这是来自 ' + locator + ' 的消息原文，足够长。',
    budgetYuan: 0.001, // 只够 1 次调用
    offPeakOnly: false,
    fetchImpl: fakeFetch,
  })
  assert.equal(result.stopped, 'budget')
  assert.ok(result.calls >= 1 && result.calls < 4, '预算耗尽前只跑了一部分调用（实际 ' + result.calls + '）')
  assert.ok(result.candidates.length >= 1)
  assert.equal(result.candidates[0].locator, 'codex://r0#1')
  // 事实时间 = 批次最后一条消息的时间戳
  assert.equal(result.candidates[0].factualAt, '2026-07-25T06:26:20.000Z')
  // checkpoint 续跑
  const cp = join(mkdtempSync(join(tmpdir(), 'dsh-codex-')), 'state.json')
  const resumed = await runExtraction({
    endpoint: 'https://api.example.com', apiKey: 'k', projectId: 'prj_test', batches,
    readText: (locator) => '续跑的消息原文，足够长。',
    budgetYuan: 0.05, offPeakOnly: false, fetchImpl: fakeFetch, checkpointFile: cp,
  })
  assert.equal(resumed.stopped, 'completed')
  assert.ok(resumed.calls >= 4)
  rmSync(cp, { force: true })
})

test('locatorTextReader extracts message text from a staged source file', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-locator-'))
  try {
    const sessionsRoot = join(root, 'sessions')
    mkdirSync(join(sessionsRoot, '2026'), { recursive: true })
    const sourceFile = join(sessionsRoot, '2026', 'rollout-x.jsonl')
    writeFileSync(sourceFile, JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '提取到的正文内容' }] } }) + String.fromCharCode(10), 'utf8')
    const pkg = join(root, 'pkg')
    mkdirSync(pkg, { recursive: true })
    writeFileSync(join(pkg, 'manifest.json'), JSON.stringify({ sessionsRoot }), 'utf8')
    writeFileSync(join(pkg, 'sessions.jsonl'), JSON.stringify({ rollout_id: 'x', source_file: '2026/rollout-x.jsonl' }) + String.fromCharCode(10), 'utf8')
    const readText = locatorTextReader(pkg)
    assert.equal(readText('codex://x#1'), '提取到的正文内容')
    assert.equal(readText('codex://x#99'), '')
    assert.equal(readText('codex://nope#1'), '')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
