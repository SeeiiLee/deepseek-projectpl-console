# MEMORY_DATA_CLASSIFICATION.md（记忆数据分级与写入合同）

> 状态：P0 交付物 #1（2026-08-15）。依据：docs/记忆系统手册.md v3 第 9.5/9.9.1 节与第 11 章决策 4（Cyrus 拍板）。
> 本文只定义分类与规则，不授权任何写库动作；实现按手册第 12.3 节执行边界逐项申请。

## 1. 数据等级

| 等级 | 示例 | 存储位置 | 规则 |
|---|---|---|---|
| Public | 公开项目文档指针 | 普通项目索引 | 可进普通分片与导出 |
| Internal | 内部架构、非敏感经验 | 本地加密、按项目隔离 | 默认等级 |
| Sensitive | 个人偏好、商业策略、私人记录 | private/user 分片或加密 Project 分片，独立密钥与策略 | 严格召回；跨项目禁止（除 user_confirmed 的 private/user） |
| Restricted | 凭据、令牌、原始医疗/遗传等高敏 | 不进记忆正文；只存安全 locator 或完全不存 | 写入门禁硬拒绝 |

- embeddings 继承原文敏感等级（不能因「向量不可读」视为无敏感性）。
- catalog.sqlite3 含敏感项目名与路径，同样需要加密。

## 2. 内容分类默认政策（决策 4 终稿）

| 类型 | 默认政策 | 存储位置 |
|---|---|---|
| 工作沟通偏好 | 用户确认后允许 | private/user，可跨项目召回 |
| 非敏感项目方法/架构决定 | 有来源、项目内允许 | Project 分片 |
| 客户名称、合同要点、经营策略、配方/工艺 | 默认关闭；每项目显式 opt-in | 加密 Project 分片，禁止跨项目 |
| 个人健康、情绪、家庭/私人关系 | 永不自动保存；仅明确「请记住」才可候选 | private 加密分片 |
| 原始医疗/遗传报告 | 不存正文，只存安全 locator 或不存 | Restricted 引用 |
| 身份证、银行卡、电话、详细地址、账号 | 永不保存 | 无 |
| 密码、密钥、token、cookie | 永不保存（写入门禁硬拒绝） | 系统凭据库只存秘密本体 |
| 当前测试数/插件数/进度 | 不存自然语言事实，只存事实源指针 | Runtime/状态文档/provenance |
| 第三方个人信息（如「邮件抄送某人」） | 保存前也需用户确认 | 按等级归类 |

- 用户修改政策只影响未来写入；历史条目列出，由用户决定删除/重分类/保留。

## 2.5 kind × scope 配对硬规则（2026-08-15 增补，源自真人验证归类反馈）

| scope | 允许 kind | 拒绝并提示 |
|---|---|---|
| global_user | global_fact / user_profile / pattern / skill | project_fact / event / task → 拒绝：项目级内容禁止落全局；通用教训请用 pattern 重述 |
| project | project_fact / event / task / skill / pattern | global_fact / user_profile → 拒绝：全局内容禁止冒充项目事实 |

- 「记住」前置归类：项目专属（客户/业务/项目架构/该项目坑）→ project；跨项目通用（规范/教训/方法/偏好）→ global_user；拿不准先 memory_classify。
- 项目事故含通用教训 → 主记录为项目 event，经用户同意另存全局 pattern（双记录）。
- 项目未登记 → fail closed：说明并询问，禁止擅自降级落全局。

## 3. 写入通道矩阵

| 通道 | 触发 | 可写状态 | 约束 |
|---|---|---|---|
| A 显式 | 用户明确要求记住 | active + authority=user_confirmed | 回显 1–3 句 claim；敏感类必须确认；text ≤ 4k；kind 白名单 |
| B 自动候选 | turn/task end（默认关闭，按项目 opt-in） | status=candidate + TTL 14 天 | 只进 staging；幂等键 project_id|session_id|turn_seq|extractor_version|candidate_index；LLM 不得直接写 canonical |
| C 机器事实 | 版本/路径/测试/构建/schema | 不写长期自然语言记忆 | 只存「在哪里重新确认」指针；事实本体在 Snapshot/状态文档/manifest |

- 写入前安全管线（12 步，全部确定性/本地，除标注外无 LLM）：scope 解析 → secret 扫描 → PII/敏感分级 → 数据最小化 → canonicalization → 精确去重（复合唯一键）→ 冲突检测 → authority 标注 → retention 赋值 → schema 校验 → 短事务写入 → 事务后异步 embedding（P4 起）。

## 4. 保留与生命周期

- lifecycle_status：candidate | active | disputed | superseded | archived；authority_class：user_confirmed | repo_verified | machine_observed | llm_extracted（两轴正交）。
- 候选 TTL：14 天；到期先标 outcome=expired/rejected，再按独立清理策略物理删除（幂等键与 outcome 保留）。
- Hot/Warm/Cold：Hot（active、当前版本适用、近期验证、重要约束）默认召回；Warm 按需；Cold（superseded/archived、旧证据）只用于审计。
- 衰减（P3 起，mnemon 参考）：类型先验 + 复用频率 + 时间衰减；到阈值进归档候选，不自动删除。
- retention_policy 按分片/项目策略赋值；valid_until 到期进归档候选。

## 5. 导出与删除语义

- 导出（memory.export）：明确 scope 目标 + 变更预览 + 双重确认 + 审计回执；evidence.local_locator 默认省略或重绑定；Restricted 正文不出现在导出包（只存 locator）。
- 删除（memory.delete）：目标预览 + 双重确认 + 审计回执；单事务内写 tombstone 并按 9.4.3 级联（FTS/embeddings/claim_evidence/claim_relations CASCADE；recall_items.claim_id、candidate_idempotency.claim_id、superseded_by SET NULL）；tombstone 只保留不可逆 id/hash/时间/原因。
- 项目级重置（memory.reset_project）：预览 + 双重确认 + 回执；分片级操作。
- 备份中的副本：按保留期自然过期；删除证明（tombstone）写入审计。
- 暂停（memory.pause）：关闭自动候选与自动召回，不影响显式通道。

## 6. 禁止内容清单（写入门禁硬拒绝）

凭据（github_pat_/ghp_/gho_/ghs_/sk-/AKIA/私钥块/Slack token 等模式）· 完整会话正文复制 · 数据库文件进包 · 原始医疗/遗传正文 · 身份证/卡号/电话/详细地址/账号 · Restricted 等级正文。检测到即拒绝写入并记录 reason code。
