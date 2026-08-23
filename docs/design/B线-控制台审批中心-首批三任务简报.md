# B 线 · 控制台审批中心与治理视图：首批三任务简报（B1–B3）

> 状态：草案（待 Cyrus 盖章后派发；**ADR-004 v2 随本简报盖章一并生效**） ｜ 日期：2026-08-20 ｜ 作者：Kimi K3
> 设计依据：`docs/design/B线-控制台审批中心与治理视图-设计稿.md` v2（15 P0 + 10 强化已吸收，D-1~D-9 与三项执行前提已拍板）
> 合同依据：`docs/adr/ADR-004-project-control合同族扩展-治理语义与审批队列.md` v2（只新增不改冻结本体）
> 治理依据：`docs/governance/LLM项目治理说明书.md` v1.0、`docs/design/执行者模型与任务路由.md`
> 执行配置：实现 = DeepSeek v4 Flash；审查 = Codex（额度重置前由 v4 Pro 代审）；Class A 闸门 = Cyrus

---

## 切分逻辑（为什么是这三段）

设计稿 v2 §10 已定：**B1 审批收件箱 MVP**（决策能进、能批、批完有执行落点）→ **B2 治理视图**（说明书五+1 不变量机器可读，项目健康一眼可见）→ **B3 授权/门禁/会话/日历**（队列变短、上下文自动就位）。三段串行但各自独立可交付；B1 不依赖 B2。

**三任务共同交接上下文（每次派发必带）**：

- 必读：设计稿 v2 全文、ADR-004 v2、治理说明书、名册与路由表；schema 语义以设计稿 §3 为唯一口径
- 红线（P5 继承）：文件是唯一事实源；控制台只读/诊断/提议/复验；卡正文与会话原文永不入 DB（只存结构化字段 + locator）；永不因文本语气推进状态
- ID/审计纪律：`crd_` 前缀 UUIDv7（复用 `createPrefixedUuidV7`）；响应动作表 append-only；卡表 `revision` 乐观锁；actor 统一 `CONSOLE_ACTOR`；时间统一 UTC ISO
- 依赖纪律：零新依赖（无 YAML/ULID/图表库）；任何新依赖走 ADR
- 门禁四件套（每期必交）：新增测试数 + 全量 `node --test` 绿 + project-control tsc 0 错 + `check-plugins` / `verify-launch` / smoke 0

---

## 任务 B1：审批收件箱 MVP

- **执行者**：v4 Flash ｜ **审查**：v4 Pro（代 Codex） ｜ **自报级别**：Class A（动 DB schema，Cyrus 闸门）
- **目标**：审批卡能经文件通道进队列、在 Console 收件箱页被八动作响应、批准即生成执行落点。

### 架构要点

1. **`approval-card/v1` JSON Schema + 合法/非法 examples**：字段口径见设计稿 §3（含 checklist、selected_option_id、delegatee、snooze_until、machine_rejected、per-action 必填矩阵、per-card-type 矩阵——fyi 必填 deadline 豁免 options，gate_go 必填 checklist 豁免 options，decision/option_pick 要 options≥2+recommendation）；Ajv strict + additionalProperties:false；confidence 整数闭区间 0-100；routing 枚举与名册一字不差。
2. **migration `0010_approval_queue.sql`**：卡表 / 响应动作表（append-only，参照 `review_actions`）/ 审计表 / 授权注册表（B3 用，同 migration 落）；schemaVersion 9→10。**连锁改动**：`scripts/verify-launch.js:65` 循环 1..9→1..10；`test/storage.test.js:181` 等硬编码断言；`external-runtime.test.js:307-320` 分段迁移；沿用 staged-migrations 模式（9→10 保留旧库数据）。
3. **Console 收件箱页**：逐项响应 UI + 批次一键批（批次 = 视图层实时计算：同 card_type + 同 recommendation.option_id + 依赖边不相交；Class A 永不合并；一键批逐卡复制响应落审计）；队列排序权在用户，不自动置顶；债务年龄配色。
4. **文件摄入最小版 + `scripts/approval-submit.mjs`**：inbox = repo 内 `.approval-inbox/`（gitignore；inbox/ingested/rejected/quarantine/receipts 五目录）；提交脚本 Ajv 校验通过才原子写（tmp+rename）；轮询 2s；重复 `crd_` id 幂等；单卡 ≤64KB、JSON 深度 ≤16、排队 ≤500；打回写 `*.result.json` 回执。
5. **fyi 到期推进器**：Host effect 定时器 + 启动补偿扫描；`now()` 可注入；deadline UTC；`pending_clarification` 到期不生效改继续挂起；推进与补料互斥（同事务查 status）。
6. **最小闭环（拍板项）**：卡批准（含 routing）→ 自动生成/关联 `work_item`（proposed_executor + cost_tier 写入）→ run 开跑回填实际执行者；`run.owner ≠ proposed_executor` 且无理由 → 收件箱标红。卡的 `node_id` 外键指向 `work_items`。
7. **fixture 卡包**：把两份实证稿的 17（K 端）+ 81（Codex 端）事件转成测试卡包，作 B1 验收输入。

### 验收标准

- [ ] fixture 卡包经 approval-submit 导入 → 收件箱批完（覆盖八动作各至少一例）→ 审计日志与 work_item 落点可查
- [ ] 批准卡生成/关联 work_item 且 routing 写入；模拟违规执行 → 标红
- [ ] per-action/per-card-type 校验矩阵全测；缺字段卡 → machine_rejected + 回执文件存在
- [ ] fyi 到期推进器测试（注入时钟）：到期生效 / 挂起互斥 / 启动补偿三用例
- [ ] 适配器幂等（同 id 重复提交只入一张）与 quarantine（超大/深度超限/坏 JSON）留证
- [ ] verify-launch 1..10 通过；staged-migration 9→10 旧库数据保留

### 证据要求

测试清单与数量 + 全量门禁四件套 + 收件箱页截图 + 审计日志导出样本 + fixture 卡包路径。

---

## 任务 B2：治理视图

- **执行者**：v4 Flash ｜ **审查**：v4 Pro（代 Codex） ｜ **自报级别**：Class B（只读诊断）+ Class A（模板变更，Cyrus 闸门）
- **前置**：B1 交付；**ADR-005（第 6 条不变量机器规格）由 K3 起草、Cyrus 拍板生效后才开工**（K3 随 B1 评审期并行产出 ADR-005 草案）
- **目标**：说明书五+1 不变量机器可读，单项目 Governance 页签 + 跨项目健康列上线，`check:governance` 一条命令可复核。

### 架构要点

1. **R0–R2 三层读取**：R0 结构层（骨架/AGENTS 速查卡/INDEX 在位；未接管项目显示灰底"待接管"，不计红）→ R1 元数据层（状态头/INDEX 表含 `a / b / c` 合行展开/ADR 登记解析，容错只记 parse issue）→ R2 不变量层（§10 五条 + 第 6 条，规格以 ADR-005 为准）。
2. **第 6 条与 R2 输入规范**（随 ADR-005 固化）：主副本路径、副本发现规则（各接管项目 `docs/governance/` 同名文件）、版本比较规则（落后主副本=黄、缺状态头=红）；豁免目录名单（archive/attachments）；ADR hash 基线存 project-control DB + 合法变迁白名单（新增/状态推进合法，篡改=红）。
3. **治理检查核心落点**：核心放 project-control 可打包模块（Console 与 CLI 共用）；`scripts/check-governance.js` 侧只做薄封装；`check:governance` 输出 JSON。现有脚本查的受保护路径/密扫等保留不动，五+1 不变量是新增能力。
4. **呈现**：单项目 Governance 页签（六不变量红绿灯 + 权威清单 + 诊断列表 + 交接新鲜度）+ 跨项目总览健康摘要列；Documents 面板并入，不造第二文档视图；修复通路复用 P5 提案交互（诊断 → Proposal → 修复 → hash 复验自动消除），表结构随 B2 migration（若需 0011，沿用同编号约定与连锁更新纪律）。
5. **三模板升级**：minimal/software/research 产出 docs/INDEX、AGENTS.md 速查卡、首份 ADR；templateVersion bump + 模板合同测试；**存量项目不自动改写**（显式声明）。

### 验收标准

- [ ] `check:governance` 一条命令输出 JSON；本仓库自身六灯状态可被第三方复算一致
- [ ] Governance 页签与跨项目健康列上线；未接管项目灰态不误红
- [ ] 诊断 → Proposal → 修复 → 复验消除闭环实测一例
- [ ] ADR hash 基线与合法变迁白名单测试（篡改检出 = 红）
- [ ] 模板合同测试绿；用新模板建示范项目出生即合规；存量项目零改动验证

### 证据要求

测试清单与数量 + 全量门禁四件套 + CLI JSON 输出样本 + 页签截图 + 模板合同测试输出。

---

## 任务 B3：常备授权 / 示例门禁 / 会话上下文 / 日历与指标

- **执行者**：v4 Flash ｜ **审查**：v4 Pro（代 Codex） ｜ **自报级别**：Class B
- **前置**：B1、B2 交付；session 路由 spike 结论经 K3 确认
- **目标**：队列变短可度量；agent 开工上下文自动就位；跨端摄入增强。

### 架构要点

1. **session 路由 spike（B3 第一步，0.5 天）**：核实上游运行时是否有可用下发通道（有则引用代码路径写入 docs；无则确认查无）。**rc.8 新增核查目标（2026-08-20 Cyrus 通报）**：上游已支持 Claude Code / Codex 作为 Profile Bundle 按需安装并作为子代理被 DSH 调用（Codex 含非交互权限模式、支持多命名实例并发）——spike 须核实子代理调用接口是否能携带指令/上下文载荷：能，则上下文卡下发升级为原生通道（`run.owner` 同时可获得真实实例身份，路由违规检测闭环）；不能，则维持默认拉模式。**默认实现 = 拉模式**：session 启动钩子读取待发上下文卡；**零机制兜底** = 上下文卡写成项目内约定文件（`docs/handoff/` 下）+ AGENTS.md 速查卡加一行"session 开始先读它"（独立 Codex / Kimi Work 等不走 DSH 的端永远需要这条兜底）。不另行自建推送机制。
2. **常备授权注册表**：条件 DSL = 白名单字段 + 等值/前缀/枚举组合的条件 JSON（禁任意代码），配套 schema + 匹配函数测试；命中即执行 + 写审计日志（不产 Domain Event、不产卡）；一键撤销入口；agent 查询接口。自学习口径：同组（card_type+mode+class 归组去重）滚动 30 天 ≥5 次一键批 → 生成转授权提议卡；≥2 次驳回 → 提议固化否定规则；同组同时最多一张待批提议。
3. **示例门禁（确定性 proxy）**：`evidence` 非空且至少一条 locator 指向可读文件路径（或卡内 `example` 字段必填）；不达标 → machine_rejected + 回执。坚持语义判定需另行 Class A 报备 LLM judge。
4. **门禁 CLI 进 preflight**：approval-submit 校验逻辑接入项目 preflight 链。
5. **跨端摄入增强**：多端并发写幂等复核；回执协议完善；各端额度状态上报 `status/<harness>.json`（quota_state/reset_at/updated_at；超 24h 过期不进路由上下文）；一期仅展示。
6. **日历投影**：计划/截止 + 决策债务热力（格子色深 = 当天最老待批卡年龄：<24h 浅 / 24–72h 中 / >72h 或逾期深红）；CSS grid 自绘零新依赖。
7. **队列指标**：卡均停留时长、打回率、授权命中率口径文档化，产出首份周报。

### 验收标准

- [ ] spike 结论落 docs（含代码路径或查无确认）；拉模式上下文卡实测一例（新 session 启动读到卡）
- [ ] 授权 DSL schema + 匹配器测试；命中留痕不产卡；撤销后恢复产卡
- [ ] 自学习阈值触发实测（构造 5 批/2 驳用例）
- [ ] 示例门禁 proxy 测试；打回回执可查
- [ ] 日历热力渲染零新依赖验证；三项指标口径文档 + 首份周报

### 证据要求

测试清单与数量 + 全量门禁四件套 + spike 文档路径 + 授权审计导出样本 + 指标周报路径。

---

## 前置闸门与路由

1. **ADR-004 v2 随本简报盖章生效**；B1 在其生效后开工。
2. **ADR-005（第 6 条不变量规格）为 B2 独有前置**——K3 在 B1 执行期并行起草，Cyrus 拍板后 B2 才开工，不阻塞 B1。
3. 执行者路由：Flash 实现；Codex 审查（额度重置前 v4 Pro 代审）；migration/模板两处 Class A 由 Cyrus 闸门。
4. **流程图/看板投影后置 V2**，不在 B1–B3 范围（设计稿 §7 已登记）。

## 节奏

B1（约 2.5h，含 fixture 卡包制作）→ B2（约 2h，待 ADR-005）→ B3（约 2.5h，含 spike）。B1 交付即可投入使用（真实卡进队列）；B3 交付后控制台形态完整（本期内）。
