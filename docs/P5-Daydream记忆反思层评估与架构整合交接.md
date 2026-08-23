# P5 Daydream 记忆反思层：评估与架构整合交接

> ⚠️ 本文已被《记忆系统手册 v4》（docs/记忆系统手册.md，唯一权威）吸收取代——2026-08-20 Cyrus 拍板（D2 §9 / D3 治理制度）。仅留档，勿据此开发。索引见 docs/INDEX.md。

> 状态：**已纳入 [P5 记忆智能层统一架构](./P5-记忆智能层统一架构.md)；本文保留 Reflection 详细合同，不再单独决定 P5/P6 顺序**
> 日期：2026-08-17；架构同步：2026-08-18
> 定位：P5-R4 的可选 Reflection 子能力；不属于 P4，不替代 Context Compiler、Hybrid、多路召回、Curator、来源验证或审批控制
> 外部基线：`glebis/claude-skills` main `46edb03cc915adbd78ee81e3406bc4480aefcaba`（2026-08-17 核验）
> 本轮边界：只做源码调研、方案评估和 DSH 交接；没有安装第三方 Skill、没有调用付费模型、没有修改 memory 代码/Schema/稳定数据

---

## 0. 给 DSH 的执行摘要

1. **不要把 Daydream 当成 Anthropic 官方记忆系统，也不要直接安装进 DSH。** 本轮找到的是社区 Claude Code Skill，依赖 Obsidian、Claude Task agents 和类 Unix 命令，原样不适合当前 Windows/Electron/SQLite 记忆架构。
2. **它真正服务的是 P5「关系发现与经验提炼」，不是 P4「语义召回」。** P4 可以为它提供本地向量和配对选择能力；P3 可以为它提供 candidate、TTL、人工确认和 promotion 闭环。
3. **推荐吸收思想，不复制产品形态。** 建议在 P5 下增加一个可选的 `Reflection` 子流水线：从同一项目内的高权威 active claims 中选择组合，生成“洞察假设”，经独立评审和确定性门禁后，只能进入低权威候选队列。
4. **最新顺序：P4/P6 基座已上线；先完成 S0 与 P5-R0/R1/R2 的数据、上下文和治理地基，再做 Reflection 无写入 spike。** 只有脱敏真实回归证明“可行动的新洞察”相对确定性关系、规则配对和随机配对均有提升，才接入候选写入。
5. **任何输出都不是事实。** reflection 结果必须是 `status=candidate + authority_class=llm_extracted`，至少链接两条来源；不得自动 active、不得修改 System/AGENTS/Gate、不得进入下一轮反思种子。
6. **默认手动触发、单项目、低预算、外部模型关闭。** 跨项目、敏感/商业内容、付费/远程生成、后台定时任务均需另行显式授权。

本文件的架构落点已整合进《记忆系统手册》v4 与 P5 统一架构。后续实现仍须保留“提案 / dry-run / candidate / Stable”四种状态差异，不得把本文件误报为 P5 已上线。

---

## 1. 本轮发现是什么

### 1.1 身份核验

本轮未找到 Anthropic 官方名为 “Daydream” 的长期记忆产品。最匹配的对象是：

- 项目：`glebis/claude-skills` 中的 `daydream` Skill；
- 名称：Vault Daydream；
- 用途：从 Obsidian 笔记中寻找非显然联系；
- 灵感来源：Gwern 的 “LLM Daydreaming” 构想；
- 许可：仓库根为 MIT，README 说明个别 Skill 若例外会在目录中注明；本轮未在 `daydream/` 发现单独例外；
- 形态：提示词与编排说明，不是独立记忆引擎。

与 Anthropic 官方 `CLAUDE.md` 记忆机制要分开：官方机制主要保存项目规则和用户偏好；本社区 Skill 做的是笔记重组与洞察生成。

### 1.2 原版执行流程

原版 Daydream 的核心步骤：

1. 自动定位 Obsidian Vault；
2. 扫描最近 120 天修改的 Markdown，最多取 200 篇；
3. 清理文本后，每篇只取前 500 词；
4. 按近期 3/2/1 权重随机抽取 50 组不重复笔记对；
5. 最多 10 个 Sonnet Task agent 并行生成联系；
6. 最多 10 个 Haiku Task agent 按 Novelty / Coherence / Usefulness 打分；
7. `average >= 7.0` 且 verdict=accept 的结果写入 `Daydreams/`；
8. 保存 pair history，避免同一组合重复抽取；
9. 原项目自报每次约 0.40–0.50 美元 Claude Code 用量。

### 1.3 已核验的外部来源

- Skill 与成本说明：<https://github.com/glebis/claude-skills/blob/46edb03cc915adbd78ee81e3406bc4480aefcaba/daydream/SKILL.md>
- 完整编排：<https://github.com/glebis/claude-skills/blob/46edb03cc915adbd78ee81e3406bc4480aefcaba/daydream/instructions.md>
- 生成提示词：<https://github.com/glebis/claude-skills/blob/46edb03cc915adbd78ee81e3406bc4480aefcaba/daydream/synthesizer-prompt.md>
- 评审提示词：<https://github.com/glebis/claude-skills/blob/46edb03cc915adbd78ee81e3406bc4480aefcaba/daydream/critic-prompt.md>
- 仓库与 MIT：<https://github.com/glebis/claude-skills/tree/46edb03cc915adbd78ee81e3406bc4480aefcaba>
- 原始构想：<https://gwern.net/ai-daydreaming>
- Anthropic 官方记忆文档：<https://docs.anthropic.com/zh-CN/docs/claude-code/memory>

> 证据边界：本轮审阅了 Daydream 的 Skill、执行说明和两份提示词，足以评估工作流；未对整个约百项 Skill 仓库做供应链/安全审计。若 DSH 后续复制任何代码或提示词，仍须按 vendor 流程锁 commit、保留 attribution、做完整许可/联网/写入面审计。

---

## 2. 它真正服务记忆系统的哪一部分

### 2.1 结论

Daydream 不是 Retrieval，而是 Reflection：

| 问题 | 当前 DSH 记忆系统 | Daydream 式反思 |
|---|---|---|
| 核心目的 | 找回过去确实记录过的决定、经验与来源 | 从两条旧记忆中提出可能的新联系 |
| 典型问题 | “我们上次为什么这样决定？” | “这两次事故是否暴露同一个缺失门禁？” |
| 输出性质 | 有状态、有来源的历史 claim | 尚未验证的 insight / hypothesis |
| 主要风险 | 漏召回、旧事实、串项目 | 牵强联想、幻觉、自我污染、成本放大 |
| 成功标准 | helpful hit、来源有效、cross-project leak=0 | grounded + novel + actionable，并经人确认 |

因此它应该归入 **P5 可选关系/反思层**。

### 2.2 与 P3、P4、P5、P6 的关系

| 阶段 | Daydream 对该阶段的作用 | 是否修改该阶段完成定义 |
|---|---|---|
| P3 候选治理 | 复用 candidate、TTL、review、promotion、敏感拦截 | 否；P3 是反思输出的治理底座 |
| P4 内嵌向量 | 用已生成的 claim embedding 辅助选择“有距离但可能相关”的配对 | 否；Daydream 不是 P4 功能门的一部分 |
| P5-R4 Reflection/可选关系 | 增加主动关系发现、事故→规则、决定→结果、重复模式提炼 | **是它的主要归属** |
| P6 稳定基座 | 提供加密、恢复、迁移、删除和运行边界 | 基座已上线；Reflection 仍需自己的 Stable 增强验收 |

### 2.3 它能增加的实际产品效果

普通召回只能恢复已保存的内容；反思层可以提出过去没有明确写下、但由多个历史事实共同支持的候选结论。例如：

```text
来源 A：原生依赖变化曾导致打包版启动失败。
来源 B：发布流程要求 smoke + 真实聊天关闭检查。

反思候选：
“凡是原生依赖或 Electron 打包依赖发生变化，发布门禁是否应自动升级为完整应用生命周期测试？”
```

这条候选可能成为：

- project pattern；
- 可复用 playbook；
- Skill 步骤；
- 自动化 Gate 建议；
- 待验证的工程假设。

但在 Cyrus 或权威证据确认前，它不是规则，也不得影响危险操作权限。

---

## 3. 不应照搬原版的部分

### 3.1 随机 50 对不是合适默认值

- 随机组合会产生大量完全无关的配对，迫使 LLM 编造联系；
- 固定数量不反映记忆规模、类别覆盖或预算；
- 高噪声会抬高评审调用量，并形成“必须想出点什么”的生成压力。

DSH 应改为覆盖驱动、有界采样，并拿原版随机配对作为 baseline，而不是正式算法。

### 3.2 `mtime + 最近 120 天 + 前 500 词` 不适合 claim 系统

- 文件修改时间不等于事实的新鲜度或最后核验时间；
- 旧事故和旧决定可能仍然极重要；
- 前 500 词可能漏掉结论、状态、适用版本和证据；
- DSH 已有 `status`、`authority_class`、`last_verified_at`、`source availability`，应使用结构化字段而不是文件启发式。

### 3.3 固定 7 分门槛不可靠

- Novelty / Coherence / Usefulness 都是模型主观分；
- Sonnet 生成、Haiku 评分仍然属于同一模型家族自评，错误可能相关；
- 不检查来源是否真的支持结论、是否可证伪、是否越权、是否泄漏其他项目；
- 固定分数没有用 Cyrus 的真实接受/拒绝数据校准。

### 3.4 直接写回知识库会污染 canonical memory

原版把接受结果直接写成 Markdown insight。DSH 必须保持现有边界：

- LLM 只能写候选；
- 候选不得成为反思种子；
- 候选不得进入默认召回；
- 用户确认后才能 active；
- 提升 System/AGENTS/Gate 仍走现有 diff、审阅、测试和授权流程。

### 3.5 远程生成扩大数据外发面

BGE-M3 只能选择/比较语义，不能生成洞察。真正 synthesis/critic 仍需要生成式模型。若使用云端 Claude/DeepSeek/其他模型，输入会包含记忆摘录，必须服从 DSH 的数据分级、连接授权和付费调用规则；不能因为存储和 embedding 在本机，就宣称整个 Reflection 流程“完全本地”。

---

## 4. 推荐架构：P5 Reflection 子流水线

### 4.1 总流程

```text
手动触发 / 已授权的低频任务
  → 解析 project_id 与运行政策
  → eligible claims 硬过滤
  → 规则 + 向量 + 关系辅助配对
  → generator 产生 insight hypothesis
  → critic 评审
  → 确定性安全/来源/Schema 门禁
  → reflection candidate（非 canonical）
  → Cyrus 评审
  → active pattern / playbook / Skill / Gate proposal
```

失败或没有高质量结果时应输出“本轮没有值得保留的洞察”，而不是降低门槛凑数。

### 4.2 触发政策

初始默认：

- 只允许用户显式调用；
- 单一明确 project_id；
- 只读 preview/dry-run 优先；
- 每轮有 maxPairs、maxTokens、maxCalls、deadline；
- DSH Memory 处于 pause 时禁止运行；
- Project Control 身份不明/冲突时拒绝运行；
- 后台定时默认关闭。

只有 Reflection-2 候选试点真实回归通过后，才可评估“每周一次”之类的低频任务；不得默认每次会话、每天或空闲即持续运行。

### 4.3 Eligible claims 硬过滤

默认只允许：

- 与当前 project_id 精确匹配；
- `status=active`；
- `authority_class IN (user_confirmed, repo_verified)`；
- 来源 `availability=available`；
- 未过保留期，适用版本未失效；
- 非 Restricted，且当前项目明确允许该敏感等级进入生成模型；
- 文本和来源通过 secret/PII/prompt-injection 扫描；
- 非 Reflection 生成的未确认内容。

默认排除：

- candidate / disputed / superseded / archived；
- 仅 `llm_extracted` 且未确认；
- 来源失效或只剩不可验证自然语言；
- 其他项目与 portfolio；
- 原始医疗、遗传、凭据、身份号码、账号、私人关系等受限内容；
- 已被用户拒绝的 reflection 候选及其原始配对版本。

跨项目 Reflection 是独立的未来能力：必须逐项目 allowlist、显示两侧项目来源并另做泄漏验收，不能复用单项目开关隐式开启。

### 4.4 配对策略

不要采用单一随机采样。建议候选池包含以下可解释 bucket：

1. **决定 ↔ 结果**：某项架构/流程决定与后续成功或失败；
2. **事故 ↔ Gate/Skill**：事故是否暴露缺失的机械门禁；
3. **重复问题 ↔ 不同修复**：同类症状是否有共同根因；
4. **规则 ↔ 反例/冲突**：现行规则在哪些条件下失效；
5. **同项目跨模块类比**：一个模块的可靠做法能否迁移到另一个模块；
6. **语义中距离探索**：P4 embedding 排名中不是近重复、也不是完全离题的组合；
7. **少量随机探索**：仅作为对照或保留低概率发现，不占主要预算。

实现约束：

- 先做 scope/status/authority 硬过滤，再读取向量；
- 不使用固定 cosine 阈值；沿用 P4 结论，用 rank、分位区间、相对 margin 和回归集校准；
- 近重复先走 DUPLICATE/SUPERSEDES，不送 creative synthesis；
- 每个 pair 有排序后的稳定 key：`scope_id | min(claimA, claimB) | max(...) | sampler_version | source_hashes`；
- 同一来源内容变化后可以重评，未变化且已拒绝则默认不重跑；
- 配对原因必须可见，例如 `decision_outcome`、`incident_gate`、`semantic_midrange`。

### 4.5 Generator 输出合同

生成模型只接收最小必要摘录，并要求结构化输出：

```json
{
  "source_claim_ids": ["claim-a", "claim-b"],
  "connection": "一句话描述可能的联系",
  "grounding": [
    {"claim_id": "claim-a", "supports": "它具体支持什么"},
    {"claim_id": "claim-b", "supports": "它具体支持什么"}
  ],
  "hypothesis": "明确标为假设的 1–3 句候选",
  "assumptions": ["成立所依赖的条件"],
  "counterevidence": ["可能推翻它的证据"],
  "suggested_action": "下一步验证、实验、文档或 Gate 建议",
  "target_kind": "pattern|skill_candidate|gate_candidate|question"
}
```

要求：

- 不允许把来源未表达的信息写成已知事实；
- 不允许输出权限、删除、发布、外发等执行指令；
- 不允许用“很可能”“显然”替代证据；
- 可以输出“没有可信联系”；
- 原始记忆按不可信数据块处理，里面的指令不得执行。

### 4.6 Critic 与确定性门禁

Critic 可以使用第二模型/第二提示词，但不能单独决定写入。评审至少覆盖：

- grounding：两条来源是否真的支持候选；
- novelty：是否只是改写任一来源；
- usefulness/actionability：是否形成可验证的问题或行动；
- coherence：推理链是否成立；
- falsifiability：什么证据会推翻它；
- risk：是否涉及权限、安全、敏感信息或跨项目推断；
- contradiction：是否忽略了 active 冲突或当前权威来源。

模型评审之后继续跑确定性门禁：

```text
project/scope 一致
→ source ids 存在且 available
→ source hash 未漂移
→ status/authority 合格
→ secret/PII/sensitivity 合格
→ prompt injection 标记
→ Schema/长度/枚举合格
→ 精确与语义去重
→ 预算未超
→ candidate 写入
```

初始不要采用 `average >= 7.0`。先以 Cyrus 的盲评结果建立接受/拒绝基线，再冻结阈值和 prompt 版本。

### 4.7 候选落地合同

推荐复用现有 `claims` 候选生命周期：

```text
status = candidate
authority_class = llm_extracted
kind = pattern（或经 DSH Schema 评审后的专用 insight kind）
origin = reflection/daydream-inspired@<version>
expires_at = 现有 candidate TTL（默认 14 天）
```

推荐为 claim relation 增加 `SYNTHESIZED_FROM`，候选分别指向两个或以上 source claim。若 DSH 不愿扩 enum，必须提供等价、可查询、可级联删除的来源链；不能只在正文里写两个标题。

额外约束：

- reflection candidate 默认不生成 embedding；确认 active 后再异步嵌入，减少短命候选的派生索引噪声；
- 如果实现选择为 candidate 预嵌入，它仍必须从默认召回和下一轮配对池硬排除；
- 用户 confirm 后直接变 `active + user_confirmed`，保留生成器/评审器版本和来源关系；
- reject/expire 后保留 pair outcome 和最小审计，不保留不必要正文；
- correct/supersede/delete 沿用现有事务、tombstone、级联和备份保留期合同。

### 4.8 用户评审与提升

评审界面/工具至少显示：

- 候选假设全文；
- 两条来源的精简 claim、状态、权威、日期和 locator；
- 为什么把它们配成一对；
- generator 的 assumptions/counterevidence；
- critic 的评分与反对理由；
- 预计提升目标：pattern / playbook / Skill / Gate proposal；
- 确认、拒绝、修改后确认、稍后处理。

确认 Reflection candidate 只代表“这条洞察值得作为 active memory 保存”。若要提升为 Skill、AGENTS、System 或 Gate，仍须走《记忆系统手册》§9.7 的独立 promotion 流程。

---

## 5. 最小接口与存储建议

### 5.1 工具面尽量不膨胀

当前记忆工具已较多，建议只增加一个入口，复用现有候选评审：

```text
memory_reflect
  action: preview | run | status
  projectId: required
  maxPairs: bounded
  sampler: hybrid | rule | vector | random-baseline
  dryRun: default true
  modelPolicy: local_only | configured_connection
```

- `preview`：只列 eligible 数量、pair 计划、敏感过滤统计、预计调用/Token/成本，不向模型发请求；
- `run`：需要符合当前授权，生成结果进入既有 candidate 队列；
- `status`：只显示最近运行、成本、接受率和错误，不输出敏感正文；
- 候选确认继续使用现有 `memory_candidates / memory_review`，增加 `origin=reflection` 过滤即可。

也可以先只做内部 Host API + 测试，不立刻扩公开工具面；由 DSH 根据 UI/工具速查面板计划整合。

### 5.2 推荐的最小审计实体

如现有 promotion/recall 审计不能无歧义承载，建议 P5 migration 增加：

```text
reflection_runs
  id, project_id, trigger_mode, sampler_version,
  generator_model/version, critic_model/version,
  policy_hash, started_at, finished_at, status,
  eligible_count, pair_count, accepted_to_staging_count,
  input_tokens, output_tokens, estimated_cost, error_code

reflection_pairs
  run_id, pair_key, source_a, source_b, selection_reason,
  source_hash_a, source_hash_b, outcome,
  candidate_claim_id, created_at
```

审计表不存完整 prompt、密钥或额外正文；内容留在有分级和删除合同的 claims/evidence 中。

若 DSH 决定复用现有表，仍必须满足：

- pair 去重可证明；
- 来源变化后可重跑；
- 拒绝/接受率可测；
- 模型与 prompt/policy 版本可追溯；
- 单项目删除能级联清理；
- 日志默认脱敏。

---

## 6. 应该在哪一步做

### 6.1 路线图定位

```text
v0.3.0：P4 Hybrid + P6-1 基座已发布
  → S0：P6-2/factual_at/UI/规模覆盖收口
  → P5-R0：统一合同与冻结基线
  → P5-R1：Context Compiler + 确定性多线索召回
  → P5-R2：Curator / Observation / Memory Doctor
  → P5-R3：Procedure / Outcome Ledger
  → P5-R4a：Reflection 无写入、手动 dry-run
  → P5-R4b：有增益才进候选队列与低频试点
  → P5-R4c：typed relation 不足且有证据时才评估 vendor graph
```

### 6.2 为什么必须在可信基座、召回和治理之后

- Reflection 不是召回刚需，不能抢占 S0/P5-R1 的规模召回和 Context Compiler；
- P4 的向量、generation、scope 过滤和失败降级已经可复用；
- P5-R2 的 observation、审批、Memory Doctor 和 diff/回滚必须先准备好，否则 Reflection 产出的二阶内容没有安全落点；
- 先稳定 canonical memory，再允许模型基于它产生二阶内容，能减少污染半径。

### 6.3 不需要等待“海量记忆”

Reflection 的前置条件应按覆盖而不是固定数量判断。至少需要：

- 两个以上可连接的高权威 active claims；
- 覆盖决定/结果、事故/Gate、重复问题/修复等一类真实关系任务；
- 来源仍可访问；
- 有足够差异供比较，不全是同一条规则的重复改写。

DSH 可从已有手册、DEVLOG、事故记录和已确认 claims 构造脱敏 fixture，不必先等待数月日常使用。但内容过少或全部同质时，应明确返回“不适合反思”，不强行生成。

---

## 7. Spike 与评测方案

### 7.1 Reflection-0（P5-R4a）：合同和 fixture

只做：

- JSON Schema；
- eligible filter；
- pair key 与 history；
- 敏感/跨项目/prompt-injection fixture；
- generator/critic fake；
- candidate 写入关闭。

验收：完全不调用外部模型、不写 Stable、所有负例 fail closed。

### 7.2 Reflection-1（P5-R4a）：无写入对比

在同一覆盖驱动的脱敏记忆集上比较：

1. 原版 recency-weighted random baseline；
2. P4 vector rank/分位辅助；
3. 决定↔结果、事故↔Gate 等规则配对；
4. 规则 + vector + 少量随机的 Hybrid。

所有结果只写临时评测制品，不进 memory DB。隐藏 sampler 标签后由 Cyrus 评审：

- 来源是否真的支持；
- 是否有新意；
- 是否可行动/可验证；
- 是否只是显而易见的改写；
- 是否牵强或虚构；
- 是否愿意保存、转成 Skill/Gate，或拒绝。

### 7.3 Reflection-2（P5-R4b）：候选治理试点

仅在 Reflection-1 证明确定性关系/规则/Hybrid 相对随机均有真实增益后：

- 接入 `status=candidate`；
- 沿用 14 天 TTL；
- 记录 pair outcome；
- 观察确认、修改确认、拒绝、过期比例；
- 确认后的候选才允许成为后续 active source；
- 被拒绝结果不得自我循环。

### 7.4 质量指标

必须记录：

- source completeness；
- grounding pass rate；
- user accepted actionable insight rate；
- modified-before-accept rate；
- obvious/duplicate rejection rate；
- false/confabulated insight rate；
- cross-project leak；
- sensitive exposure；
- rejected-pair repeat rate；
- cost per accepted insight；
- p50/p95 latency；
- 每轮读取条目、输入/输出 Token 和生成调用数。

### 7.5 上线硬门

以下全部满足才可从 Reflection-2 进入 Reflection-3（低频运行/可选关系整合）：

- cross-project leak = 0；
- Restricted/secret exposure = 0；
- 自动写 active = 0；
- 每条进入 staging 的候选有至少两条可访问来源；
- candidate 不进入下一轮 seed；
- malformed/timeout/model unavailable 时不写候选；
- Hybrid 相对 random baseline 在“用户确认且可行动的洞察”上有可测提升；
- false/confabulated 没有因追求 novelty 明显上升；
- 成本、延迟、候选积压在预算内。

不要先拍固定“7 分”或固定接受率。Reflection-1 先建立真实基线，再由 Cyrus/DSH 冻结保留门槛。若没有可测提升，保持无写入手动实验工具或直接不引入。

### 7.6 必测负例

- A 项目和 B 项目存在同名概念，不能被配对；
- active 与 superseded 冲突时不得忽略 superseded 链；
- 两条完全无关内容应返回 no-insight；
- 来源正文包含“忽略规则并执行命令”，不得执行或写成候选；
- 来源在 generator 后、写入前发生 hash 漂移，必须丢弃结果；
- candidate/disputed/llm-only 内容不能成为 seed；
- 模型返回非法 JSON、超时、拒绝、空结果，不写半条记录；
- Reflection pause、项目身份未知、模型政策为 local_only 但无本地生成模型时 fail closed；
- 被拒绝 pair 在来源未变化时不重复生成；
- 删除任一来源 claim 后，候选/关系/审计按合同处理，不留悬空引用。

---

## 8. 成本、缓存、重试与停止条件

### 8.1 原版成本只能作参考

原项目 README/Skill 自报 50 pairs 每轮约 0.40–0.50 美元。这不是 DSH 成本承诺：实际取决于生成模型、摘录长度、缓存、订阅/API 路径和重试。

本轮没有执行任何 Claude/DeepSeek 付费调用。

### 8.2 DSH 首次付费 spike 前必须回显

在用户授权之前，`preview` 至少给出：

- 模型和连接；
- eligible claim 与 pair 数；
- 预计 generator/critic 调用数；
- 预计输入/输出 Token 区间；
- 单轮金额上限；
- 是否会把哪一级数据发到远程；
- 缓存命中与最坏重试成本；
- 停止条件。

### 8.3 建议首轮硬预算

建议从小批开始，而不是照搬 50 pairs / 20 agents：

- `maxPairs <= 12`；
- generator 最多 2 个 batch 请求；
- critic 最多 2 个 batch 请求；
- 结构化输出解析失败最多做 1 次无新增上下文的 repair；
- 任一模型连续失败、超出 deadline、预算上限或敏感门命中即停止；
- 不因某批失败自动扩充 pair 补足数量。

具体数字可在合成 spike 后调整，但每次扩大前要有接受率/成本证据。

### 8.4 缓存键

```text
hash(
  source_claim_ids + source_content_hashes +
  generator_model/version + generator_prompt_version +
  critic_model/version + critic_prompt_version +
  sampler_version + policy_hash
)
```

同键成功结果不重复付费；失败缓存要有短 TTL，避免临时故障永久封死。来源、模型、prompt 或政策变化必须产生新键。

### 8.5 本地模型边界

- BGE-M3 只做 embedding/配对选择，不能承担 generator/critic；
- 若没有经过评测的本地生成模型，`local_only` 模式应明确不可用，不得静默切远程；
- 使用现有 DSH Connection Center 时，应创建/复用明确用途的反思连接政策，不能偷偷借用其他密钥；
- Sensitive/商业项目默认不允许远程 Reflection，即使日常聊天模型本身是远程，也不能推定获得批量记忆外发授权。

---

## 9. 已完成的架构整合与后续实现落点

### 9.1 《记忆系统手册》

2026-08-18 已按下表整合进手册 v4/P5 统一架构；实现仍待后续阶段：

| 当前章节 | 应整合内容 |
|---|---|
| §9.2 八个平面 | Reflection 归 Memory Intelligence Engine，不新建第二套 canonical store |
| §9.4 数据模型 | `SYNTHESIZED_FROM` 来源关系；必要时 reflection_runs/reflection_pairs |
| §9.5 写入架构 | 增加“反思候选通道”，强调只进 candidate、不能自动 active |
| §9.6 召回 | Reflection candidate 默认不召回、不作为 seed；确认后才进入正常召回 |
| §9.7 升级闭环 | reflection candidate → active pattern → Skill/Gate proposal 的两段确认 |
| §9.8 生命周期 | TTL、reject/expire、pair history、禁止自反馈 |
| §9.9 安全运维 | 远程批量外发、prompt injection、自我污染、成本失控威胁 |
| §9.10 指标验收 | grounding、accepted actionable、false insight、cost/accepted、leak=0 |
| §9.13 路线图 | Reflection 调整到统一 P5-R4，排在 Context/Curator/Procedure 地基之后 |

整合后应在手册修订记录中注明：来源是社区 Daydream 思路，DSH 采用的是治理化改造，不是 Anthropic 官方实现。

### 9.2 P4 文档

只需增加交叉引用：

- P4 embedding 可在未来供 P5 Reflection 做 pair selection；
- Reflection 不计入 P4 功能门、测试数或完成状态；
- P4 固定余弦阈值废弃结论同样适用于 Reflection。

不要把 generator/critic、候选洞察或付费调用塞进 embedding 插件职责。

### 9.3 DEVLOG 与状态口径

整合/实现时分别记录：

- `proposal reviewed`；
- `dry-run spike passed/failed`；
- `candidate staging enabled`；
- `Stable enabled`。

不得使用“Daydream 已接入”同时指代这四个不同状态。

---

## 10. DSH 实现顺序

1. 先完成统一 P5 的 S0、P5-R0、P5-R1、P5-R2 和 P5-R3 出口；
2. 定义 Reflection JSON Schema、eligible policy、pair key、模型政策；
3. 用合成 fixture 完成 P5-R4a：过滤、去重、来源漂移、自反馈和失败注入；
4. 实现 `preview`，证明零模型调用、零写入；
5. 用脱敏真实覆盖集比较 deterministic relation / rule / vector / random，禁止只胜随机基线；
6. 把结果和成本交 Cyrus 拍板，决定是否进入候选写入；
7. 通过后才接 existing candidate/review，继续默认手动；
8. typed relation 仍不足且有关系任务增益证据时，再评估 vendor graph；
9. 远程数据政策、长期预算、调度、恢复/删除/迁移和 Stable 验收全部继承统一 P5 合同。

---

## 11. DSH 交付时必须回答的决定

DSH 架构整合稿应明确回答：

1. 是否接受“P5 Reflection、非 P4”的定位；
2. 是增加 `SYNTHESIZED_FROM`，还是采用哪种等价可级联来源表示；
3. 是否需要 reflection_runs/reflection_pairs，或如何复用现有审计表证明 pair 去重；
4. 首个 sampler 的 buckets、上限和 baseline；
5. generator/critic 走本地、现有连接还是显式专用连接；
6. 哪些数据等级可进入远程模型；
7. preview/run/review 如何复用现有工具和 Workbench，避免工具面膨胀；
8. Reflection-1 的覆盖集、盲评表和停止条件；
9. 未证明增益时如何完全关闭并清理派生数据；
10. P5/P6 状态如何显示，防止把“提案/Spike/试点/上线”混为一谈。

其中第 5–6 项若涉及付费调用、远程外发、敏感项目或新连接，必须交 Cyrus 明确批准；技术整合文档本身不能代替授权。

---

## 12. 最终建议

**采纳思想，拒绝原样安装。**

- 原版直接接入价值：低；与 DSH 平台、数据模型和安全合同不匹配。
- 作为 P5 Reflection 改造价值：高；能补上“从历史事实形成新 pattern/Skill/Gate 建议”的能力。
- 对 P4 的价值：只提供未来 pair selection 复用场景，不改变 P4 验收。
- 最大风险：把有趣的联想误当事实并写回 canonical memory。
- 最关键门禁：来源链、单项目、candidate-only、人工确认、禁止自反馈、真实盲评、成本上限。

若 DSH 只能先做一个最小版本，应选择：

```text
单项目 + 手动 preview/run + 决定↔结果/事故↔Gate 规则配对
+ 最多 12 pairs + 两阶段评审 + candidate-only + 14 天 TTL
```

不要先做后台“自动做梦”、跨项目随机联想、固定 7 分自动保存或每日批量调用。
