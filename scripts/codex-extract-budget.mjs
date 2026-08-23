// P6-0C 成本预算（只读统计，不调用任何模型）：基于 P6-0B 的 turn-index 真实数据，
// 统计食溯（mapped + alias）的候选提取调用量 / token / 预计候选数 / 多档单价总价。
import { readFileSync } from 'node:fs'

const NL = String.fromCharCode(10)
const turns = readFileSync('F:/AI/codex-import/package-snapshot-v2/turn-index.jsonl', 'utf8').trim().split(NL).filter(l => l !== '').map(JSON.parse)
const sessions = readFileSync('F:/AI/codex-import/package-snapshot-v2/sessions.jsonl', 'utf8').trim().split(NL).filter(l => l !== '').map(JSON.parse)

const projectTurns = turns.filter(t => t.project_label === '食溯(mealtracker)')
const projectSessions = sessions.filter(s => s.project_label === '食溯(mealtracker)')

// 本地确定性预筛（零成本）：单条消息 ≥20 字符才值得看；按 content_hash 去重。
const MIN_CHARS = 20
const seen = new Set()
const eligible = []
for (const t of projectTurns) {
  if (t.char_length < MIN_CHARS) continue
  if (seen.has(t.content_hash)) continue
  seen.add(t.content_hash)
  eligible.push(t)
}

const totalChars = eligible.reduce((s, t) => s + t.char_length, 0)
const sessionsWithEligible = new Set(eligible.map(t => t.rollout_id)).size

// 调用设计（拟）：按会话切块，每调用源码上限 4000 字符；每会话至少 1 次（有合格消息时）。
const CHUNK = 4000
let calls = 0
for (const sid of new Set(eligible.map(t => t.rollout_id))) {
  const chars = eligible.filter(t => t.rollout_id === sid).reduce((s, t) => s + t.char_length, 0)
  calls += Math.max(1, Math.ceil(chars / CHUNK))
}
const PROMPT_TOKENS_PER_CALL = 800
const inputTokens = Math.round(totalChars * 0.6) + calls * PROMPT_TOKENS_PER_CALL
const outputTokens = calls * 400 // 每调用 ≤5 候选 × ~80 token
const expectedCandidates = Math.round(calls * 2.5) // 历史提取实测 ~2 条/轮的量级

console.log('=== 食溯提取预算（基于 P6-0B 真实数据，零模型调用） ===')
console.log('会话文件（mapped+alias）:', projectSessions.length)
console.log('消息总数（user+assistant）:', projectTurns.length)
console.log('预筛后合格消息（≥20字+去重）:', eligible.length, '（原', projectTurns.length, '）')
console.log('预筛后总字符数:', totalChars)
console.log('预计 LLM 调用次数:', calls, '（每调用源码≤4000 字符切块）')
console.log('预计输入 token（源码×0.6 + 提示词 800/调用）:', inputTokens)
console.log('预计输出 token（≤400/调用）:', outputTokens)
console.log('预计候选条数（2.5/调用）:', expectedCandidates, '（全部进候选队列，人工确认）')

// 官方价（2026-08-17 读取 api-docs.deepseek.com 定价页）：deepseek-v4-flash 空闲时段（非 9-12/14-18 北京时）
// 输入（缓存未命中）1.5 元/百万，输出 4.5 元/百万；高峰翻倍；缓存命中 0.05 元/百万。
const OFF_PEAK = { in: 1.5, out: 4.5 }
const PEAK = { in: 3.0, out: 9.0 }
for (const [name, rate] of [['空闲时段', OFF_PEAK], ['高峰时段（应避免）', PEAK]]) {
  const cost = inputTokens / 1e6 * rate.in + outputTokens / 1e6 * rate.out
  console.log(name + ': ￥' + cost.toFixed(2) + '（输入 ' + (inputTokens / 1e6 * rate.in).toFixed(2) + ' + 输出 ' + (outputTokens / 1e6 * rate.out).toFixed(2) + '）')
}
console.log('注：缓存命中输入单价 0.05 元/百万（提示词前缀缓存），实际花费只会更低。')
