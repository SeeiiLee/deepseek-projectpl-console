# B 线 · 控制台审批中心与治理视图 · 正式设计稿

> 状态：v2（已吸收执行层评审 15 项 P0 + 10 项强化 + Cyrus 三项拍板，待复核盖章） ｜ 日期：2026-08-20 ｜ 作者：Kimi K3
> 实证依据：`docs/design/审批交互模式-本会话实证分析.md`（Kimi 端 17 事件）、`docs/design/审批交互模式-Codex会话对照挖掘.md`（Codex 端 81 轮次）、`docs/design/执行者模型与任务路由.md`（名册与路由规则）
> 治理依据：`docs/governance/LLM项目治理说明书.md` v1.0、`docs/architecture/D2-插件体系治理与用户侧设计.md`
> 前置思考稿：`docs/design/项目控制台治理视图-思考稿.md`（本文吸收并取代其呈现层结论，思考稿留档）
> 评审留档：`docs/reviews/B线-控制台审批中心与治理视图-设计稿-执行层评审.md`（DeepSeek v4 Pro，15 项 P0 + 10 项强化，v2 全量吸收）

## 修订记录

- **v2（2026-08-20）**：吸收执行层评审全部 15 项 P0 与 10 项强化；Cyrus 三项执行前提已拍板（§10.4：P0-10 批准自动生成 work_item；P0-8 inbox 落 repo 内 `.approval-inbox/`；P0-9 session 路由改拉模式 + B3 前置 spike）。主要变更：全部路径补 `docs/` 前缀（P0-1）；schema 重写为 JSON Schema 口径并补 checklist/response/机器打回态（P0-3/4）；新增 fyi 到期推进器规格（P0-5）；Node 层复用 `work_items`、Batch 不落表、流程图/看板降级 V2（P0-6）；质量门禁拆两层（P0-7）；inbox 文件契约补全（P0-8）；session 路由认错改拉模式（P0-9）；新增 §9.5 最小闭环与 Reviews 关系（P0-10）；一期回执通道（P0-11）；三模板升级排进 B2（P0-12）；migration 0010 连锁改动清单（P0-13）；B1 真实卡来源 = 适配器提前 + fixture 卡包（P0-14）；每期四件套 + 前置闸门（P0-15）。
- **v1（2026-08-20）**：初稿，经执行层评审判定 15 项阻断级缺口。

---

## 0. 待拍板决策清单（逐项裁决，编号即下文节号）

| # | 决策 | 我的建议 | 状态 |
|---|---|---|---|
| D-1 | 三层模型：节点（工作包）/ 决策项（原子）/ 批次（呈现）分离；Node 复用 work_items | 采纳（§2） | 待拍板 |
| D-2 | 审批卡 schema 字段集（JSON Schema，含路由字段 + 期望动作模式） | 采纳（§3） | 待拍板 |
| D-3 | 四种卡型：待决 / 通报+压力测试 / 选项裁决 / Gate 放行（打回补料是响应不是卡型） | 采纳（§4） | 待拍板 |
| D-4 | 八响应动作 + 快捷原因标签 + Class A 强制文字原因 + per-action 必填矩阵 | 采纳（§4） | 待拍板 |
| D-5 | 质量门禁：B1 字段级机器打回（Ajv strict），B3 确定性示例门禁 | 采纳（§5.1） | 待拍板 |
| D-6 | 常备授权：批规则不批决定；命中规则不产卡只留痕；自学习闭环；Class A 永不可授权 | 采纳（§6） | 待拍板 |
| D-7 | 一个任务图 + 本期两投影（收件箱/日历热力）；流程图/看板降级 V2 | 采纳（§7） | 待拍板 |
| D-8 | 跨端摄入一期单向（文件托底 + 回执文件回流），二期再回派 | 采纳（§8） | 待拍板 |
| D-9 | 实施分期 B1→B2→B3（§10）与 ADR-004 扩展方式（新增协议线，不改冻结合同本体） | 采纳（§10 + ADR-004） | 待拍板 |

评审三项执行前提（Cyrus 已拍板，无需再审）：P0-10 批准自动生成 work_item ✅；P0-8 inbox = repo 内 `.approval-inbox/` ✅；P0-9 拉模式 + B3 spike ✅。

---

## 1. 定位与总架构

控制台 = 治理说明书的机器执行面 + 人机决策的召回漏斗。第一原则（继承 P5 红线）：**文件是唯一事实源；控制台只读、诊断、提议、复验，永不代写 docs 内容，永不把正文入 DB，永不因文本语气推进状态。**

总架构一句话：**一个任务图（DAG）是底层模型；收件箱与日历热力是本期交付的两个投影，流程图与看板是 V2 投影（§7）。** Plane 证明了多投影可行，PlanWeave 证明了图模型可行——我们把两个证明拼起来，不发明新范式。

**与既有决策面的关系（P0-10 一句话定性）：审批卡管"决策"，Reviews 管"交付物审阅"**——前者是"要不要做/怎么做"，后者是"做出来的东西行不行"。两个页签 UI 互链，永不合并。

## 2. 数据模型：三层分离（D-1）

| 层 | 定义 | 落库 | 回答的问题 |
|---|---|---|---|
| 节点 Node | 工作包（图上的点，带依赖边） | **复用现有 `work_items` + `work_item_dependencies`**（migration 0009），node_id 即 work_item_id，**不新建 node 表** | 这些决策是哪来的 |
| 决策项 DecisionItem | 原子审批单位，一条一答 | 新增审批卡表（migration 0010，§10.5） | 这条要不要批 |
| 批次 Batch | 投递/呈现分组，**纯视图层实时计算，不落表** | 无（schema 中的 batch 引用仅为响应时的审计快照） | 这批一起看还是分开看 |

聚合规则（视图层实时计算）：**同 card_type + 同 recommendation.option_id + 依赖边不相交 → 系统聚合成批，可一键全批，任何一条可抽出单批；异质永远分列；Class A 卡与不同 class 的卡永不合并；一键批的响应逐卡复制落审计。** 节点归属 ≠ 审批单位；合批是呈现层的事，随时可拆。

卡的 `node_id` 外键指向 `work_items`，不再悬挂（P0-6）。本期不做节点摄入 UI——卡建卡时可手工关联既有 work_item 或留空；从 NEXT.md/清单自动导入节点属 V2。

## 3. 审批卡 Schema（D-2，approval-card/v1）

承载格式为 **JSON**（一卡一文件；project-control 无 YAML 解析器，加依赖 = Class A）。下列为字段逻辑视图，正式 artifact 是随设计发布的 `approval-card/v1` JSON Schema 文件 + 合法/非法 examples（B1 交付物）。

```jsonc
{
  "id": "crd_<uuidv7>",                 // 前缀 UUIDv7，复用 createPrefixedUuidV7，不用 ULID
  "schema_version": "approval-card/v1",
  "card_type": "decision | fyi_challenge | option_pick | gate_go",
  "source": { "harness": "...", "session_ref": "...", "locator": "..." },
  "project_id": "prj_...",              // 必填；跨项目治理卡归主项目 prj_01a00cfd… + scope:"global"
  "scope": "project | global",
  "node_id": "wrk_... 或 null",          // 外键 → work_items
  "title": "string ≤50 字，人话",        // 质量门禁
  "context": "string，为什么现在需要决定（短）",
  "options": [{ "id", "label", "description", "consequences" }],  // decision/option_pick 必填 ≥2；fyi/gate_go 豁免（字段级写死）
  "checklist": [{ "id", "label", "evidence?", "passed" }],        // gate_go 必填；其余卡型可空
  "recommendation": { "option_id", "rationale", "confidence": 0, "dissent?" },  // confidence 整数闭区间 0-100
  "if_rejected": "string，不批/延期的后果",
  "class": "A | B",
  "evidence": ["path|url|locator"],     // 至少一条；外部链接沿用 https+github 白名单；路径仅展示不自动执行
  "routing": { "proposed_executor": "k3|codex|v4pro|v4flash", "cost_tier": "high|mid|low", "rationale" },  // 枚举与名册文档一字不差
  "mode": "think | discuss | document | code",
  "deadline": "UTC ISO8601 或 null",    // fyi_challenge 必填
  "status": "queued | pending_clarification | machine_rejected | approved | approved_with_constraints | rejected_with_direction | rejected_final | delegated | snoozed | noted | auto_effective",
  "revision": 1,                        // 乐观锁
  "response": {
    "action": "approve | approve_with_constraints | request_changes | reject_with_direction | reject_final | delegate | snooze | note",
    "selected_option_id": "...",        // approve/approve_with_constraints 必填
    "reason_tag?": "方向不对|成本太高|先缓缓|信息不足",
    "reason_text?": "...",              // Class A 驳回必填
    "constraints_text?": "...",         // approve_with_constraints 必填
    "direction_text?": "...",           // reject_with_direction 必填（direction）
    "delegatee?": "...",                // delegate 必填
    "snooze_until?": "UTC ISO8601",     // snooze 必填
    "responded_at": "UTC ISO8601",
    "actor": "CONSOLE_ACTOR"
  }
}
```

**per-action 必填矩阵**（Ajv 校验写死）：approve_with_constraints→constraints_text；reject_with_direction→reason_tag + direction_text；delegate→delegatee；snooze→snooze_until；Class A 任何驳回→reason_text。机器打回（machine_rejected）必须写回执（§8 回执文件 + DB 可查），显式失败优于静默丢弃。

**JSON 安全上限**：单卡文件 ≤64KB，inbox 排队 ≤500 卡，JSON 深度 ≤16，字符串字段单值 ≤8KB（P0-8/强化 3）。

路由字段是 06:24 事件的直接产物：**批准一张卡 = 同时批准内容与路由**；路由违规判定 = `run.owner ≠ card.routing.proposed_executor` 且未附理由 → 队列标红（检测依赖 §9.5 闭环）。

## 4. 卡型与响应动作（D-3 / D-4）

**卡型（四种，各附实证）：**

1. `decision` 待决卡——标准决策（01:37 五点裁决）
2. `fyi_challenge` 通报+压力测试卡——已决事项征求反驳，到期自动生效（02:05「你的理解呢」）；到期推进器见 §5.4
3. `option_pick` 选项裁决卡——agent 产多方案他点选，摩擦最低（Codex #18→#20「就选A了」）
4. `gate_go` Gate 放行卡——前置 checklist 全绿展示，一键 GO/NO-GO（Codex #34/#48/#54，门禁打包是自发实践）

**响应动作（八动作，枚举值即 §3 response.action）**：批准 / 批准+约束（主导模式，必须和一键批一样便宜）/ 打回补料（示例·证据·澄清）/ 驳回+方向 / 完全否决 / 委托 / 缓议 / 知悉。
驳回快捷原因标签：方向不对 / 成本太高 / 先缓缓 / 信息不足；**Class A 强制文字原因**。驳回理由结构化回流给 agent 变成约束——一期承载物 = inbox 回执文件（§8，P0-11），二期主动推送回会话。

## 5. 队列语义

### 5.1 质量门禁（D-5，拆两层，P0-7）

- **B1：schema/字段级校验**（Ajv strict + additionalProperties:false），含 per-card-type 必填矩阵：fyi 无 options 但必填 deadline；gate_go 必填 checklist 豁免 options；decision/option_pick 要求 options≥2 + recommendation。缺 人话标题/必填选项/建议+置信度/不批后果/级别/路由/依据 → `machine_rejected` + 回执，不进队列。
- **B3：示例门禁用确定性 proxy**——`evidence` 非空且至少一条 locator 指向可读文件路径（或卡内 `example` 字段必填）。若未来坚持语义判定，须显式报备 LLM judge（成本/超时上限）并走 Class A。实证依据不变：抽象提案历史弹回率 100%（K 端 3 次、Codex 端 #26/#79）。

### 5.2 排序与挂起

队列只呈现不自动置顶 agent 建议的下一步（实证：建议采纳率低，排序是他的三权之一）；单卡打回补料挂起不阻塞队列其余卡；**队列里只有需要他的卡**——agent 间的派发/审查路由走任务图层，不进收件箱。

### 5.3 债务年龄

队列与日历的颜色信号 = 最老卡的年龄，不是数量。

### 5.4 fyi 到期推进器（P0-5）

B1 引入 Host effect 定时器 + **启动时补偿扫描**（进程不在运行时错过的到期卡，启动补齐）；`now()` 可注入以便测试；deadline 统一存 UTC ISO；fyi 卡处于 `pending_clarification`（有待答补料）时到期**不**自动生效，改为继续挂起；到期推进与补料响应互斥（同事务内检查 status）。

## 6. 常备授权（D-6）

- **定义**：不是 agent 自主决策，是他把一类决定**一次性批成规则**，此后 agent 只是执行规则。判据一句话：**一条决策如果已有规则能给出答案，它就不该出现在队列里——它该出现在审计日志里。**
- **实证示例**（本项目真实发生）：INDEX 登记、取代横幅、已拍板方向内的组件选择、低风险可回滚的文件迁移。他本人 08-17 已向 Codex 要过此能力（Codex 挖掘 #79）。
- **注册表**：`{rule_id, 名称, 适用scope, 条件, 批准时间, 依据, 审计引用, 撤销入口}`；命中即执行 + 留审计日志（不产 Domain Event，ADR-004 已定），永不产卡。
- **条件 DSL（强化 7）**：禁止任意代码；白名单字段 + 等值/前缀/枚举组合的条件 JSON（如 `{"field":"class","op":"eq","value":"B"}`），配套 JSON Schema 与匹配函数测试；给 agent 查询接口（查"这条要不要产卡"）。
- **自学习闭环（强化 8 口径）**：同一规则候选（按 card_type+routing.mode+class 归组去重）在滚动 30 天窗口内被一键批准 ≥5 次 → 系统生成"转授权提议卡"（他批规则才生效）；同组被驳回 ≥2 次 → 提议把驳回理由固化为否定规则。提议卡由控制台生成，同组同时最多一张待批提议。
- **安全边界**：Class A 永不可常备授权；每条授权可一键撤销；审计日志完整可查。

## 7. 投影层（D-7）

- **本期交付（B3 完成）**：**收件箱投影**（审批队列本体，混合裁决 UI：逐项响应 + 批次一键批）+ **日历投影**（计划/截止 + 决策债务热力：格子色深 = 当天最老待批卡年龄；无卡=空；<24h 浅；24–72h 中；>72h 或逾期=深红；CSS grid 自绘，**零新依赖**，加图表库必须走 ADR）。
- **V2 登记（本期不交付，明示后置，P0-6）**：流程图投影（依赖与并行、活动窗口「当前阶段 ±1」、钻取细节）与看板投影（状态密度，Plane 参照）。节点/边数据已随 D-1 落 `work_items`，V2 只是加投影。

## 8. 跨端摄入（D-8，文件契约补全，P0-8/P0-11）

**总原则**：各端 Harness 只做一件事——把审批卡 JSON 经提交脚本写进 inbox 目录；摄入适配器校验后入 project-control DB。Harness 之间永不相见。**队列的系统记录 = DB，文件只是传输层。**（Gate 2E 是 HTTP+handshake，不是文件监听器；此处复用的是其校验/quarantine **模式**，代码新写。）

**inbox 位置（Cyrus 已拍板）**：repo 内 `D:\Deepseek Harness Personal\.approval-inbox\`，gitignore。跨端可写性前提：Codex/DSH/Kimi Work 全部运行在同一台机器且有本地文件访问权，已成立。

**目录生命周期**：

```
.approval-inbox/
  inbox/       # 各端写入区（tmp+rename 原子写）
  ingested/    # 摄入成功归档（保留 30 天滚动清理）
  rejected/    # 机器打回留证
  quarantine/  # 超大/深度超限/路径穿越/解析失败
  receipts/    # *.result.json 回执（一期驳回回流通道，P0-11）
  status/      # 各端额度状态 status.json（强化 6，见下）
```

**写卡唯一通道**：`scripts/approval-submit.mjs`——各端不许手写 JSON 文件，只许调脚本；脚本做 Ajv 校验，通过才原子写入 inbox。随设计发布 JSON Schema + 合法/非法 examples。

**摄入策略**：轮询（Windows fs.watch 不可靠），间隔 2s；重复 id 幂等（按 `crd_` id 去重）；摄入成功移 ingested/ 并写回执；打回移 rejected/ 并写 `*.result.json` 回执（含打回原因，agent 轮询 receipts/ 即得结构化驳回——一期回流的承载物）。

**额度状态上报（强化 6）**：各端可写 `status/<harness>.json`：`{harness, quota_state: ok|low|exhausted, reset_at?, updated_at}`；超过 24h 未更新视为过期，路由上下文忽略。一期仅展示，二期进入路由自动决策。

**云迁移预留**：卡自包含 JSON + 内容可寻址 `crd_` UUIDv7 + 文件 inbox 是中性传输层；未来上云 = 替换传输层（目录 → 云存储/API），schema 与 DB 语义不动。触发时机 = 多设备使用 DSH，届时 Class A 立项。当前不上云：队列本体是本地 SQLite、会话内容敏感（实测扫出过 API key）、工作流单机。

## 9. 治理视图（吸收思考稿，结论化）

三层读取：**R0 结构层**（骨架/AGENTS 速查卡/INDEX 在位）→ **R1 元数据层**（状态头、INDEX 表、ADR 登记解析，容错只记 parse issue）→ **R2 不变量层**（说明书 §10 五条 + 第 6 条，规格见 §9.1）。

呈现：单项目 Governance 页签（六不变量红绿灯 + **权威清单**=agent 开工最小阅读集 + 诊断列表 + 交接新鲜度）+ 跨项目总览健康摘要列；Documents 面板并入，不造第二个文档视图。修复通路复用 P5 提案交互：诊断 → Proposal → 人/agent 修复 → hash 复验自动消除。

**未接管项目语义（P0-2-3）**：R0 缺失（无骨架/无 INDEX）的项目显示为灰底"待接管"待办状态，**不计红**——存量项目不许红成一片。

### 9.1 第 6 条不变量与 R2 输入规范（P0-2，前置 ADR）

第 6 条（说明书副本版本漂移）目前无机器规格，**B2 开工前先以一份 ADR 把治理说明书第 6 条固化为可计算不变量**：主副本路径（`docs/governance/LLM项目治理说明书.md`）、副本发现规则（各接管项目 `docs/governance/` 下同名文件）、版本比较规则（状态头版本号落后主副本 = 黄；缺状态头 = 红；豁免清单显式列出）。

R2 输入规范（随该 ADR 一并固化）：docs 根解析规则；INDEX 表语法含 `a / b / c` 合行展开；豁免目录名单（archive/attachments 等）；ADR hash 基线存储位置（project-control DB 治理诊断表）与合法变迁白名单（新增/状态推进合法，内容篡改为红）。

### 9.2 治理检查核心落点（强化 4）

现有 `scripts/check-governance.js` 查的是受保护路径/AGENTS 投影/密扫/git remote，**不是**五不变量。B2 新增治理检查核心，**放在 project-control 可打包模块**（Console 与 CLI 共用），`scripts/` 只做薄封装；`check:governance` 输出 JSON（机器可复核，支撑 B2 出口"一条命令复核"）。

### 9.3 模板通路（P0-12，排进 B2）

三个内置模板（minimal/software/research）当前无治理骨架。B2 升级：模板产出 docs/INDEX、AGENTS.md 速查卡、首份 ADR；templateVersion bump + 模板合同测试；**存量项目不自动改写**（显式声明）。

## 9.5 最小闭环：批准之后发生什么（P0-10，Cyrus 已拍板）

**卡批准（含 routing）→ 自动生成/关联 `work_item`（proposed_executor 与 cost_tier 写入）→ run 开跑时回填实际执行者。** 路由违规 = `run.owner ≠ card.routing.proposed_executor` 且未附理由 → 收件箱标红。B1 即落此闭环，否则 B1 出口"批掉一批真实卡"无下游证据。

审批卡与既有对象的关系：卡 ≠ decisions（ADR 载体）≠ reviews（交付物审阅）≠ work_items（执行单元）。卡是第五个控制对象，但只此一个新增决策面；UI 上收件箱与 Reviews 页签互链。

## 10. 实施分期（D-9）

### 10.1 分期总表

| 期 | 内容 | 出口（可实测） |
|---|---|---|
| B1 | 审批收件箱 MVP：JSON Schema + migration 0010 + Console 收件箱页 + 基础文件适配器与 approval-submit + 八动作响应 + 审计日志 + fyi 到期推进器 + 最小闭环（§9.5） | 用 fixture 卡包（17+81 实证事件转卡）导入 → 页面批完 → 审计日志与 work_item 落点可查 |
| B2 | 治理视图：第 6 条不变量 ADR 先行 + R0–R2 + Governance 页签 + 诊断提案闭环 + 检查核心进 project-control + CLI 薄封装 + 三模板升级 | `check:governance` 一条命令输出 JSON，六灯状态机器可复核 |
| B3 | 常备授权注册表 + 条件 DSL + 示例门禁（确定性 proxy）+ 门禁 CLI 进 preflight + 会话上下文卡拉模式 + 跨端摄入增强（多端并发/回执/额度）+ 日历热力 + 队列指标 | 队列变短可度量（卡均停留时长、打回率、授权命中率） |

每期间可独立交付；B1 不依赖 B2。**流程图/看板投影后置 V2（§7）。** 执行者：实现 Flash、审查 Codex（额度不可用期间 v4 Pro 代审）、Class A 闸门 Cyrus（路由表见 `docs/design/执行者模型与任务路由.md` §3-B）。

### 10.2 前置闸门（P0-15）

**ADR-004 由 Cyrus 拍板生效后才开工 B1。** B2 另加前置：第 6 条不变量 ADR 拍板生效。

### 10.3 每期四件套（验收清单 + 证据要求 + 自报级别 + 门禁）

- **B1**：① migration 0010 及连锁更新（§10.5）；② JSON Schema + examples + Ajv 严格解析测试；③ 卡 ⇄ work_item 联动测试（批准生成/回填/违规标红）；④ 适配器幂等/quarantine/回执测试 + fixture 卡包导入验收。证据：全量测试绿、project-control tsc 0 错、check-plugins、verify-launch 1..10、smoke 0。自报级别：Class A（动 DB schema）。门禁：verify-launch + 全量测试。
- **B2**：① 第 6 条不变量 ADR 生效；② R0–R2 诊断与既有 docs 实证对拍（本项目自身六灯可复算）；③ 模板合同测试 + 存量不改写声明；④ CLI JSON 输出测试。证据：同上门禁 + Governance 页签截图。自报级别：Class B（只读诊断）+ Class A（模板变更）。
- **B3**：① session 路由 spike 结论落 docs；② 授权 DSL schema + 匹配器测试 + 撤销审计；③ 示例门禁 proxy 测试；④ 日历/指标口径文档化。证据：同上门禁 + 指标首份周报。自报级别：Class B。

### 10.4 三项执行前提（Cyrus 已拍板，2026-08-20）

1. **P0-10**：批准卡自动生成/关联 work_item，run 回填实际执行者 ✅
2. **P0-8**：inbox 落 repo 内 `.approval-inbox/`（gitignore）✅
3. **P0-9**：放弃"P6 既有路由"假设（查无实据，起草人认错）；B3 前置 spike 核实上游运行时能力；默认采用拉模式——session 启动钩子读取上下文卡，零机制兜底 = 上下文卡写成项目内约定文件（`docs/handoff/` 下）+ AGENTS.md 速查卡加一行"session 开始先读它"；**不建推送机制** ✅

### 10.5 migration 0010 与连锁改动清单（P0-13）

- 新增 `plugins/project-control/migrations/0010_approval_queue.sql`：卡表 / 响应动作表（append-only，参照 `review_actions`）/ 审计表 / 授权注册表（B3 用，同 migration 落）；卡表带 `revision` 乐观锁；schemaVersion 9→10。
- 更新 `scripts/verify-launch.js:65` 迁移检查循环 1..9 → 1..10。
- 更新测试断言：`test/storage.test.js:181` 等硬编码 `schemaVersion: 9` 处、`external-runtime.test.js:307-320` 分段迁移构造；migration 测试沿用现有 staged-migrations 模式（升级路径 9→10 保留旧库数据）。
- ADR-004 同步写明编号约定（0010）。

### 10.6 其他强化落点（评审第二节归口）

- ID：`crd_` 前缀 UUIDv7（强化 1）→ §3；project_id 必填 + scope（强化 2）→ §3；安全上限（强化 3）→ §3/§8；CLI 共享核心（强化 4）→ §9.2；零新依赖（强化 5）→ §7；额度上报（强化 6）→ §8；条件 DSL（强化 7）→ §6；自学习口径（强化 8）→ §6；审计/并发（强化 9）→ §3（revision/CONSOLE_ACTOR/UTC）+ §10.5（append-only）；笔误修正（强化 10：四卡型表述、confidence 整数闭区间、routing 枚举与名册一字不差）→ §0/§3/§4。

## 11. 与既有产物的关系

- 吸收 `docs/design/项目控制台治理视图-思考稿.md`（留档处理）；实证依据见两份挖掘稿；与 D2 的关系 = D2 定治理制度，本文定控制台形态。
- 合同扩展走 `docs/adr/ADR-004-project-control合同族扩展-治理语义与审批队列.md`（新增协议线，不改冻结本体——P1「新协议线版本」先例）。
- 落地后勾销/更新：`docs/NEXT.md` 增加 B 线登记块；坑清单增补 06:24 路由违规事件与"P6 session 路由查无实据"引用事故。
