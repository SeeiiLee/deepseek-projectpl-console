# C 线 · Codex 会话全量提取（P6-2 提取段）：首批三任务简报

> 状态：v2（已吸收执行层评审 13 项 P0 + 11 项强化 + Cyrus 三项拍板，待盖章派发） ｜ 日期：2026-08-20 ｜ 作者：Kimi K3
> 冻结依据：`docs/codex-session-import-v1-合同.md`（codex-session-import/v1，禁止静默适配，格式变化须升版）
> 评审留档：`docs/reviews/C线-会话全量提取-首批三任务简报-执行层评审.md`（DeepSeek v4 Pro，13 阻断 + 11 强化，v2 全量吸收）
> 执行配置：实现 = DeepSeek v4 Flash；审查 = Codex（**今日由 v4 Pro 代审**）；授权闸门 = Cyrus
> 已有资产：`docs/attachments/codex-scan/` 原型管线（已验证：选样/提取/清洗三脚本跑通 3 会话 81 轮次）

## 修订记录

- **v2（2026-08-20）**：吸收执行层评审全部 13 项 P0 与 11 项强化；Cyrus 三项拍板落位（§授权闸门：远程模型批准带三箍、稳定库为注册表权威 + 执行前补注册、原型 out 移出仓库）。主要变更：闸门顺序重排（输出目录/补注册先于 C1，远程模型先于 C3）；删除"42 个逻辑会话"预设数字（P0-2）；注册表改稳定库导出文件 seam + 路径规范化 + alias 表（P0-3）；`CODEX_EXTRACT_ROOT` 受控例外（P0-4）；原型 out 处置前置步骤（P0-5）；C2 拆 turns/events/turns-text 三流（P0-6/7）；双载体去重矩阵（P0-8）；血缘算法规格（P0-9）；content_hash 规范化定死（P0-10）；生产管线落 `scripts/codex-import/`（P0-11）；语料 schema 与 9→8 标签映射（P0-12）；盲评规程 + 三任务证据四件套（P0-13）。
- **v1（2026-08-20）**：初稿，经执行层评审判定 13 项阻断级缺口。

---

## 切分逻辑（为什么是这三段）

合同天然分两层 + 消费端：**C1 盘点登记层**（合同 §1/§4/§5/§7，会话级登记，零内容提取，纯确定性脚本）、**C2 解析规范化层**（§2/§3/§8，轮次级规范化记录 + 白名单过滤 + 脱敏门禁）、**C3 审批语料提取与盲评**（控制台设计的消费端）。三段串行，每段输出是下段的输入。

**记忆候选提取（P6-2 正式消费）不在首批**，列入第二批 C4；其远程模型授权已被扩展闸门 1 覆盖（见文末）。

**三任务共同交接上下文（每次派发必带）**：

- 必读：导入合同全文、`docs/design/审批交互模式-Codex会话对照挖掘.md`（分类法与八动作 + 卡型）、`docs/记忆系统手册.md` §3.11 授权映射（本批不触发写库）
- 源目录只读：`D:\CodexData\home\sessions`（canonical）与 `%USERPROFILE%\.codex\sessions`（junction）；**任何写入不得落在源目录**
- 日志纪律（§8）：日志只含计数与哈希，原始会话内容**永不进日志、永不进仓库**；脱敏门禁先于一切输出
- 每条输出记录必带 `parser_version` 与 `format_observation="codex-session-import/v1"`（§2/§9）
- **测试纪律**：全部测试用合成 fixture，**永不读真实源目录**

## 架构要点（跨三段的决策点）

1. **输出落点**（闸门 3，已拍板）：全量提取产物落 `D:\CodexData\extract\p6-2\`（新建；源数据旁、不在任何 git 仓库内、不在稳定版受保护路径内）。只有**聚合报告**（计数/哈希/覆盖率）回本仓库 docs，且报告必须脱敏——不得出现 `F:\QClawData`、`D:\CodexData` 等个人路径原样，cwd 一律显示为 project_name/project_id 或路径哈希。
2. **`CODEX_EXTRACT_ROOT` 受控例外**（P0-4）：`scripts/protected-paths.js` 的 `assertAutomationSafe` 新增白名单项，仅放行 `D:\CodexData\extract`，带 marker 文件与测试；**默认关闭，未设置时脚本拒绝运行**；C1 验收含"无批准根时 dry-run 拒绝写入"测试。
3. **血缘去重**（§1 + P0-9 算法规格）：从 session_meta 提取 `forked_from_id` / `parent_thread_id` 建逻辑会话血缘图（传递闭包）。算法定死：**逻辑根 = 无父节点的会话 id（无父则本文件 id）；检测到环 → quarantine 并计数；跨文件 parent 缺失 → 退化为单文件族；"保留最早 rollout"的排序键 = `(session_meta.timestamp, file_path)` 字典序 tie-break**。轮次去重键 = `逻辑会话根 + content_hash`，其余标 `skipped_with_reason=duplicate_lineage`。C2 只消费 C1 血缘表，不重算。
4. **幂等语义**（强化 3 修正）：按 `source_file_sha256` 判断——未变 → skip；变化 → 重跑该文件；活跃/锁定 → `retryable` 并记录 `observed_at`。"跑两次第二次全量跳过"仅在无源变更时成立。**未说明的跳过数必须 = 0**；每类 status 计数对得上注册表行数，报告加对账公式。
5. **注入噪声注册表**（P0-11）：`recommended_plugins` / `codex_internal_context` / `<environment_context>` / `in-app-browser-context` / `# Files mentioned by the user:` 包装以 user role 出现但不是用户发言。注册表 = **repo 内版本化 JSON**（规则类型：prefix/wrapper/payload_type，带 schemaVersion 与 fixtures 测试），命中即剥离或整条排除，排除计数入报告。
6. **content_hash 定死**（P0-10）：`content_hash = sha256(剥噪声后、未脱敏、规范化空白后的正文)`——hash 不含明文秘密，脱敏只作用于存储文本。规范化 = Unicode NFC + 去首尾空白 + `\r\n→\n` + 连续空白折叠为单空格。C1/C2 共享同一函数模块，报告附示例。
7. **生产管线落点**（P0-11）：`scripts/codex-import/`——参数化源根/输出根、默认拒绝、dry-run 模式；控制台输出只允许计数与哈希（可机器 grep 验收）。

---

## 任务 C0（前置步骤，随 C1 派发）

- **原型 out 处置**（P0-5，闸门 3 已批）：`docs/attachments/codex-scan/out/` 全文移出至 `D:\CodexData\extract\p6-2\_prototype-out\`；仓库原地留 README（计数 + 各文件 sha256 + 去向说明 + 清理日期）；INDEX 登记留档，不静默删除。
- **稳定版补注册**（Cyrus 人工，先于 C1）：稳定版 DSH 中注册 Cyrus Quant Trading；Amazon Store 父目录注册为独立项目。
- **导出注册表**：从**稳定库**导出 `project-registry-export.json`（带 schemaVersion、project_id、normalized workspace 路径、导出时间），落 `D:\CodexData\extract\p6-2\registry\`。合同 §7 现状栏已过时，登记状态以此导出为准。

## 任务 C1：盘点登记层（全量 308 会话）

- **执行者**：v4 Flash ｜ **审查**：v4 Pro（代 Codex） ｜ **自报级别**：Class B
- **前置**：C0 完成（补注册 + 导出 + out 移出 + CODEX_EXTRACT_ROOT 例外生效）
- **目标**：本机可见语料 100% 登记（§5）：会话级注册表 + 血缘图 + 项目映射 + 覆盖率报告。零内容提取。

### 架构要点

1. 全量遍历，**两源根以 `source_realpath` canonical 去重**为唯一键（junction 路径只作 `source_file` 备查——实测两根各枚举 308，不去重会登记 616）；算 `source_file_sha256`。
2. **session_meta 容错定位**：文件头 N 行内定位首个 session_meta，找不到 → quarantine 并记录（合同不保证未来首行必是 session_meta）。
3. 血缘图：按上文要点 3 算法规格执行（验证今晚观察：08-14/08-15 部分会话共享前轮次，08-11/08-12 meal_tracker 同前缀簇）。
4. **项目映射（P0-3 定死）**：只读 C0 导出的 `project-registry-export.json`，不直连任一 SQLite；路径规范化 = NFC/NFKC + 去零宽字符（ZWNJ 等）+ 大小写折叠 + 尾分隔符归一；**只认精确匹配，前缀一律不自动命中**；alias 表 = repo 内显式 JSON 配置（含 worktrees → mealtracker 等条目），随 C1 验收逐条过 Cyrus；禁止凭内容猜项目（fail closed）。
5. 活跃/锁定文件 → `retryable` 并记录原因。
6. 输出：会话级注册表 JSONL（**`session-registry/v1`**：source_file / source_realpath / source_file_sha256 / session_id / meta_session_id / cwd / lineage_root / project_resolution / status / parser_version / format_observation / observed_at）+ 覆盖率报告（脱敏；含 DSH 逻辑会话数 vs 42 个 rollout 文件的对照说明——**42 是文件数不是逻辑会话数**，P0-2）。

### 验收标准

- [ ] 注册表覆盖 308/308 文件（realpath 去重后）；未说明跳过 = 0；各 status 计数与注册表行数对账成立
- [ ] 血缘图输出逻辑会话数（应显著小于 308）与簇明细；环检测计数
- [ ] 项目映射表三态计数正确：Quant → mapped（C0 已补注册）；Amazon 父目录 → mapped（独立项目）；worktree meal_tracker → 按 alias mapped；**不再以"未注册落 quarantine"为预期**
- [ ] 日志零内容（机器 grep：仅计数与哈希）
- [ ] 幂等验证：无源变更时二次运行全量 skip；变更单文件只重跑该文件
- [ ] 无 `CODEX_EXTRACT_ROOT` 时 dry-run 拒绝写入（测试）
- [ ] 报告全文 grep 个人路径模式 = 0

### 证据要求

新增测试文件与测试数 + 全量 `node --test` 绿 + 注册表文件路径 + 覆盖率报告 + 血缘簇统计 + 幂等验证输出 + 日志零内容 grep 输出。

---

## 任务 C2：解析规范化层（轮次级记录 + 白名单 + 脱敏）

- **执行者**：v4 Flash ｜ **审查**：v4 Pro（代 Codex） ｜ **自报级别**：Class B
- **前置**：C1 交付
- **目标**：把 308 会话解析为合同 §2 全字段的规范化轮次记录，完成白名单过滤、噪声剥离、血缘去重、脱敏门禁。产物 = 证据索引层（§6 层 B）。

### 架构要点

1. **白名单判定矩阵**（P0-8，payload type 级，写进代码配置不放任现场猜）：每种 `type|payload.type` 的取用/排除/去重优先级显式列出——同一 user 文本双载体时**优先 `response_item(message)`**，`event_msg(user_message)` 同 hash 标 `duplicate_carrier`；"助手最终答复""必要阶段结论"列出具体 payload type 清单，列不出的放排除并计数。
2. **输出拆三条流**（P0-6/P0-7/P0-8）：
   - `turns/<logical_session_id>/<rollout_uuid>.jsonl`——白名单轮次记录（合同 14 字段，含 `portable_locator` = `codex://<session_id>#<line_seq>`、content_hash、status）；
   - `events/`——**全量事件索引**（event_type、locator、content_hash、role、status=excluded_by_whitelist，**无正文**），排除项计数与索引行数对得上（合同 §3"排除项保留在证据索引层"）；
   - `turns-text/`——**本地工作集**（脱敏后正文 + 同一 locator/content_hash，明确标注"非合同字段、仅本地工作集"），C3 只读它，不再碰源目录、不再做脱敏。
3. 噪声注册表剥离按 repo 内版本化 JSON 执行。
4. **脱敏门禁先于落盘**：密钥/PAT/身份证/银行卡模式命中 → 正文替换 `[REDACTED:<类别>]`，计数入报告（样本已实测命中 sk- key）。脱敏模式做成 C1/C2/C3 共享模块。
5. 血缘去重消费 C1 血缘表。
6. 落盘规范：临时文件 + rename、同盘原子写；路径/命名按上文三条流规则。

### 验收标准

- [ ] 全量轮次记录 14 字段齐全（抽查 50 条逐字段核对）
- [ ] 脱敏验证：产物 grep `sk-[A-Za-z0-9]{16,}` 等模式 = 0，且 REDACTED 计数 > 0
- [ ] 双载体去重生效：同一用户消息只进一条 turns 记录，另一载体标 duplicate_carrier
- [ ] 排除事件在 events 索引可追溯；排除计数与索引行数对账成立
- [ ] 血缘去重生效：08-14/08-15 共享轮次只出现一次
- [ ] 噪声注册表命中计数 > 0 且各类别有明细
- [ ] locator 回验：随机 10 条按 `portable_locator` 回源文件行号，内容一致

### 证据要求

新增测试数 + 全量门禁 + 解析报告 + 抽查记录 + 脱敏/去重/排除计数对账 + locator 回溯验证输出 + 日志零内容 grep。

---

## 任务 C3：审批事件语料提取 + 质量盲评（控制台消费端）

- **执行者**：v4 Flash（提取）｜ **审查**：v4 Pro 代审盲评（Codex 额度重置后复核）｜ **自报级别**：Class B
- **前置**：C2 交付 + **闸门 1（远程模型）已裁决为批准**
- **目标**：从 cwd 归属 **DeepSeek Harness Personal Desktop** 项目的全部逻辑会话（**数量以 C1 报告为准，不预设**——P0-2）的用户轮次中，按八动作 + 四卡型分类法提取审批事件语料库，供 B 线控制台使用。

### 架构要点

1. **筛选口径**：用 C1 的 `project_resolution = DeepSeek Harness Personal Desktop` 过滤，**禁止字符串含 "DSH" 判断**（避免误纳 Codex 工作区目录名）。
2. **语料 schema 冻结**（P0-12）：`label` 枚举 = B 线八动作 + `not_approval`；`card_type` 枚举 = B 线四卡型 + `none`；置信度整数 0–100；每条记录 = 轮次 locator + 多标签数组 + 卡型候选 + 置信度 + parser_version。附**"原型 9 类启发式标签 → 八动作"显式映射表**（映射不了的归 `not_approval`）。C3 只作 B 线分类法的验证语料，不发明新标签。
3. 提取两轮：启发式预标签（clean_turns 规则族，按映射表换算）→ 执行模型逐条复核改写。**输入只读 C2 的 `turns-text/` 工作集**。
4. **远程外发纪律（闸门 1 三箍）**：只发脱敏后文本；单条输入长度上限 2000 字符；成本上限 = 轮次规模 × token 估算随派发单一并报批（超上限 fail closed）。
5. **只输出标签与 locator，短摘录 ≤200 字**；全文永不进报告。
6. **盲评规程**（P0-13 定死）：固定随机 seed；20 条**按逻辑会话分层抽样**（每会话至少 1 条，不足全取）；一致率公式 = exact-match 为主 + Jaccard 多标签为辅，双双记录；分歧只记录不判对错；误判模式清单进 `docs/WORKING_RULES_AND_PITFALLS.md` 指定小节；Codex 复核对象 = 盲评 20 条 + 分歧记录全量。

### 验收标准

- [ ] C1 报告口径的 DSH 逻辑会话全覆盖（覆盖率 = 100%，分母以 C1 为准）
- [ ] 事件总量与各动作分布报告
- [ ] 盲评 20 条一致率（exact + Jaccard 双值）记录；分歧与误判模式清单
- [ ] 语料库每条含 locator 可回溯
- [ ] 报告零全文、零密钥；外发记录与成本对账在上限内

### 证据要求

新增测试数 + 全量门禁 + 分布报告 + 盲评记录 + 语料库路径（`D:\CodexData\extract\p6-2\approval-corpus\`）+ 报告零全文零密钥 grep + 成本对账单。

---

## 授权闸门（Cyrus 决策项——**全部已裁决，2026-08-20**）

| # | 决策 | 裁决 |
|---|---|---|
| 1 | **任何将会话内容外发远程模型的提取/标注/盲评**（含 C3 两轮判定与 C4 记忆候选提取）是否允许？ | ✅ **批准，带三箍**：只发脱敏后文本；单条 ≤2000 字符；成本上限随派发单报批。顺序：先于 C3 |
| 2 | 项目注册表权威来源？未注册项目（亚马逊、量化）怎么办？ | ✅ **稳定库为权威**；C0 执行前在稳定版补注册 Quant + Amazon Store（独立项目）；导出 `project-registry-export.json` 供 C1 只读；alias 表显式配置逐条过 Cyrus |
| 3 | 输出落点 `D:\CodexData\extract\p6-2\` 目录约定？ | ✅ **批准**；配套 `CODEX_EXTRACT_ROOT` 受控例外（默认关闭）。顺序：先于 C1 |

## 节奏

C0（人工 0.5h，Cyrus + Flash 协作）→ C1（约 1.5h）→ C2（约 2h）→ C3（约 1.5h + 盲评 0.5h；成本上限内）。三任务交付后，控制台设计即获得全量实证语料；C4（记忆候选提取）闸门 1 已覆盖，另行派发。
