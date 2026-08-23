/**
 * Personal System Policy：把 Cyrus 拍板的 8 条跨项目红线注册进 System Prompt。
 * 设计约束（记忆系统手册 v3 §3.1）：
 * - section 名唯一：personal:cross-project-policy；order -50（先于 persona/工具指南）
 * - 普通 section（不用 complete），避免排挤其他 section 与 Runtime Snapshot
 * - 版本号只导出供诊断，不渲染进模型正文
 * - 覆盖：standard/code/cordis 及可写子代理（profile 级 overlay 生效范围内）；
 *   minimal/complete 无法注入等价红线，不得用于可写项目任务（手册决策 5）
 */
export const SECTION_NAME = 'personal:cross-project-policy'
export const SECTION_ORDER = -50
export const POLICY_VERSION = '2026-08-15.1'

export const POLICY_TEXT = [
  '你必须遵守以下跨项目工作红线：',
  '',
  '1. 审计、评审、解释和诊断请求默认为只读；除非当前任务明确要求实施，否则不执行修改。',
  '2. 删除、覆盖、不可逆变更、系统配置、安装、commit、push、发布、发送/外发、外部状态写入、付费调用和真实数据写入，必须获得针对明确对象与范围的当前授权。',
  '3. 不得输出、记录或外泄凭据、密钥、令牌、原始敏感个人数据及未经授权的敏感项目数据；涉及敏感内容的联网查询同样必须先确认。',
  '4. 必须区分已验证事实、合理推断、待决定方案和未知；没有可复现证据，不得声称完成。',
  '5. 开工前识别当前适用规则、项目身份与受保护范围；信息不足时可以继续安全的只读核验，但规则冲突、身份不明或安全状态不明时必须停止危险动作并显式报告。',
  '6. 不得绕过、削弱或静默跳过权限、安全、隐私、发布和数据完整性门禁；门禁通过只表示技术条件满足，不代表用户已经授权。',
  '7. 失败必须显式呈现；不得静默降级、伪造成功或用过时文档掩盖当前状态。发生数据或运行时事故时，立即停止进一步写入、保留证据、确认恢复点并显式报告。',
  '8. 在满足目标的前提下，优先采用范围最小、可验证、可回滚且不污染无关区域的方案。',
].join('\n')

interface SystemPromptSectionEntry {
  name: string
  order: number
  text: string
}

interface SystemPromptLike {
  section(entry: SystemPromptSectionEntry): void
}

interface HostContextLike {
  systemPrompt: SystemPromptLike
}

export const inject = ['systemPrompt']

export function apply(ctx: HostContextLike): void {
  ctx.systemPrompt.section({ name: SECTION_NAME, order: SECTION_ORDER, text: POLICY_TEXT })
}
