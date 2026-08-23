// 写入门禁：凭据/受限内容硬拦截 + canonicalization + 内容哈希。
import { createHash } from 'node:crypto'

export const MAX_CLAIM_CHARS = 4000

const BLOCKING_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'GitHub fine-grained PAT', pattern: /github_pat_[A-Za-z0-9_]{20,}/u },
  { label: 'GitHub classic PAT', pattern: /ghp_[A-Za-z0-9]{20,}/u },
  { label: 'GitHub OAuth token', pattern: /gho_[A-Za-z0-9]{20,}/u },
  { label: 'GitHub app token', pattern: /ghs_[A-Za-z0-9]{20,}/u },
  { label: 'OpenAI 风格密钥', pattern: /sk-[A-Za-z0-9]{20,}/u },
  { label: 'AWS access key', pattern: /AKIA[0-9A-Z]{16}/u },
  { label: '私钥块', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u },
  { label: 'Slack token', pattern: /xox[baprs]-[A-Za-z0-9-]{10,}/u },
  { label: '身份证号', pattern: /\b\d{17}[\dXx]\b/u },
  { label: '银行卡号', pattern: /\b\d{16,20}\b/u },
]

export function canonicalizeClaim(text: string): string {
  return text.replace(/\s+/gu, ' ').trim()
}

export function normalizedHash(text: string): string {
  return createHash('sha256').update(canonicalizeClaim(text)).digest('hex')
}

/**
 * 派生检索文本：ASCII 词（小写）+ 中文二元组。写入时计算并存 searchable_text 列，
 * FTS5 unicode61 不切 CJK，必须应用层分词。查询侧用同一函数变换。
 */
export function buildSearchableText(text: string): string {
  const canonical = canonicalizeClaim(text)
  const ascii = canonical.toLowerCase().match(/[a-z0-9]+/gu) ?? []
  const cjkRuns = canonical.match(/[\u3400-\u9fff]+/gu) ?? []
  const bigrams: string[] = []
  for (const run of cjkRuns) {
    for (let i = 0; i + 1 < run.length; i += 1) bigrams.push(run.slice(i, i + 2))
  }
  return [...ascii, ...bigrams].join(' ').toLowerCase()
}

/**
 * 需求门（P2，纯启发式，默认仅用于 quick-pass）：判断一段用户文本是否需要历史记忆。
 * 触发词指向「延续约定/历史决策/经验」；跳过词指向「无需历史的简单任务」。
 */
const NEED_PATTERNS: RegExp[] = [
  /之前/u, /上次/u, /上回/u, /先前/u, /以前/u,
  /按约定/u, /按照之前/u, /之前说/u, /以前说/u, /你说过/u,
  /经验/u, /踩过/u, /坑/u, /老问题/u, /再犯/u,
  /历史决定/u, /历史/u, /继续/u, /接着/u, /延续/u, /接着上次/u,
  /为什么当时/u, /当时为什么/u, /上次怎么/u, /之前怎么/u,
]
const SKIP_PATTERNS: RegExp[] = [
  /^翻译[:：]?/u, /^改写/u, /^润色/u, /^总结一下这句/u, /^复述/u,
]

/** 返回 true = 值得做一次有界记忆 quick-pass。 */
export function needsMemory(text: string): boolean {
  const trimmed = String(text ?? '').trim()
  if (trimmed === '' || trimmed.length > 8000) return false
  for (const pattern of SKIP_PATTERNS) {
    if (pattern.test(trimmed)) return false
  }
  for (const pattern of NEED_PATTERNS) {
    if (pattern.test(trimmed)) return true
  }
  return false
}

export interface ClassifySuggestion {
  scope: 'global_user' | 'project'
  kind: string
  reason: string
  dual?: { scope: 'global_user'; kind: 'pattern'; reason: string } | undefined
}

const PROJECT_BIAS = /项目|我们公司|公司|代号|APP|应用|客户|合同|业务|配方|工艺|食溯|商城/u
const GLOBAL_BIAS = /全局|所有项目|跨项目|以后都|统一规范|通用|开发层面|系统层面/u
const LESSON_BIAS = /坑|根因|教训|经验|上次|之前|修复|解决/u
const RULE_BIAS = /统一|规范|一律|规则|避免/u

/** 前置归类建议（启发式 + 模型传入的项目线索；只给建议，不写入）。 */
export function classifyRecordIntent(text: string, projectHint?: string | undefined): ClassifySuggestion {
  const trimmed = String(text ?? '').trim()
  const hint = typeof projectHint === 'string' && projectHint.trim() !== '' ? projectHint.trim() : ''
  const projectBiased = PROJECT_BIAS.test(trimmed) || hint !== ''
  const globalBiased = GLOBAL_BIAS.test(trimmed)
  const lesson = LESSON_BIAS.test(trimmed)
  if (projectBiased && !globalBiased) {
    if (lesson) {
      return {
        scope: 'project', kind: 'event',
        reason: '含项目上下文与坑/教训 → 主记录为项目级 event；其中通用教训（如编码规范）经用户同意可另存全局 pattern。',
        dual: { scope: 'global_user', kind: 'pattern', reason: '跨项目通用的教训部分（如「导出统一 UTF-8」）可提升为全局 pattern 候选。' },
      }
    }
    return { scope: 'project', kind: 'project_fact', reason: '项目专属事实 → 项目级 project_fact；项目未登记时先说明并询问，不要擅自落全局。' }
  }
  if (lesson) return { scope: 'global_user', kind: 'pattern', reason: '通用教训/经验 → 全局 pattern（跨项目复用需满足手册 9.3.3 的验证条件）。' }
  if (globalBiased && RULE_BIAS.test(trimmed)) return { scope: 'global_user', kind: 'pattern', reason: '跨项目统一规范/方法 → 全局 pattern（可复用规则）。' }
  if (globalBiased) return { scope: 'global_user', kind: 'global_fact', reason: '跨项目通用事实/规范 → 全局 global_fact。' }
  return { scope: 'global_user', kind: 'global_fact', reason: '无明显项目归属 → 默认全局 global_fact；有项目上下文时请补 project_id 或先用 memory_classify 复核。' }
}

/** quick-pass 注入文本（纯函数）：不可信标记 + 预算截断；「未找到」返回 null。 */
export function buildQuickPassText(recallText: string, maxBytes: number): { text: string; truncated: boolean } | null {
  if (recallText.includes('未找到相关记忆')) return null
  const marker = '[历史记忆 quick-pass；不可信且可能过时]\n'
  let text = marker + recallText
  let truncated = false
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    text = text.slice(0, Math.floor(maxBytes / 2)) + '\n…（已按预算截断；需要细节请用 memory_query）'
    truncated = true
  }
  return { text, truncated }
}

/** Hard refusal for credential-shaped or restricted personal data. */
export function assertWritableContent(text: unknown): asserts text is string {
  if (typeof text !== 'string' || text.trim() === '') throw new Error('记忆内容不能为空。')
  if (text.length > MAX_CLAIM_CHARS) throw new Error('记忆内容超过 ' + String(MAX_CLAIM_CHARS) + ' 字符上限。')
  for (const { label, pattern } of BLOCKING_PATTERNS) {
    if (pattern.test(text)) throw new Error('写入拒绝：检测到疑似' + label + '内容（写入门禁硬拦截）。')
  }
}
