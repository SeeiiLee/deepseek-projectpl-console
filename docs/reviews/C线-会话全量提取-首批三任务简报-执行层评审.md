# C 线 · Codex 会话全量提取 · 执行层评审

> 评审对象：`docs/design/C线-会话全量提取-首批三任务简报.md`（Kimi K3，2026-08-20 草案）
> 评审范围：**执行层**——按简报逐字执行能否通过验收、引用的合同/数据/现状是否属实、授权闸门顺序是否自洽。不重审导入合同本身。
> 核对方式：对照 `docs/codex-session-import-v1-合同.md`、`docs/attachments/codex-scan/` 原型四脚本与 out 产物、实测源目录（308 文件 / 3.10 GiB / 双源根枚举一致）、Project Control 开发库与稳定库的注册差异。
> 结论：任务切分（C1 登记 → C2 规范化 → C3 语料）与合同分层对得上，红线意识（日志无内容、脱敏先于落盘、fail closed）是三条线里最好的。但**执行层有 13 项阻断级缺口**：其中“C3 调用远程模型是否已被授权”直接决定 C3 能否开工；“42 个逻辑会话”这个验收数字现在并不存在；“项目映射”的注册表来源在两套 DB 之间是分裂的。建议 K3 修订后再派发。

---

## 一、执行阻断级问题（修订时必须解决）

### P0-1 C3 的远程模型调用没有被任何授权闸门覆盖

- **核实事实**：C3 要点 2 是“执行模型逐条复核改写标签”，盲评由 v4 Pro 独立重判——两者都是把会话正文（至少是用户轮次）发给**远程模型**。而文末授权闸门 1 只写了“**记忆候选提取**是否允许调用远程模型”，并把它卡在 C4。
- **问题**：按现稿，C1/C2/C3 作为首批派发，但 C3 会在闸门 1 未裁决的情况下把 Codex 会话内容外发到远程 API。合同 §8 与记忆手册红线 3（敏感内容外发需确认）都不允许这样做。
- **改法**：把闸门 1 的措辞扩为“**任何将会话内容外发远程模型的提取/标注/盲评**（含 C3 两轮判定）是否允许”，并明确顺序：**闸门 1 在 C3 派发前必须裁决**；若裁决为“仅本地”，C3 退化为纯启发式标签 + 本地人工复核。C1/C2 是纯确定性脚本，不受此门影响，可先行。

### P0-2 “42 个逻辑会话”这个验收数字当前不存在

- **核实事实**：实测 `by_cwd` 结果：cwd=`D:\Deepseek Harness Personal` 的 **rollout 文件是 42 个**（合计 507 MB）；血缘去重是 C1 要新做的（原型没做）。简报 C3 写的是“cwd=DSH 的 **42 个逻辑会话（血缘去重后）**”，把两个口径混成了一个数字。
- **问题**：血缘去重后逻辑会话数必然 ≤42、几乎肯定更小；Flash 照“42 全覆盖”执行会找不到 42 个逻辑会话，验收无法闭环。
- **改法**：C3 验收改为“覆盖 C1 血缘图产出的**全部 cwd=DSH 逻辑会话（数量以 C1 报告为准，不预设）**”；C3 目标行同样去掉 42。C1 报告增加“DSH 逻辑会话数 vs 42 个 rollout”的对照说明。

### P0-3 项目映射的注册表来源没有定义，且简报里的“未注册项目”示例已过时

- **核实事实（2026-08-20 实测两套库）**：
  - 开发库（`%APPDATA%\DeepSeek Harness Personal Dev\project-control`）：注册 4 个项目——mealtracker、tools、**Cyrus Quant Trading（已注册）**、DeepSeek Harness Personal Desktop；
  - 稳定库（`F:\documents\Cyrus Deepseek Harness Data\project-control`）：只有 2 个——DeepSeek Harness Personal Desktop、mealtracker；同名项目的 project_id 与开发库不同；
  - Quant 的 workspace 路径含**不可见 Unicode 字符（ZWNJ，U+200C）**，开发库存的 path_key 也带它；
  - Amazon 相关注册是 `F:\documents\Kimi\Workspaces\Amazon Store\tools`（挂在 tools 项目下），而会话 cwd 是父目录 `F:\documents\Kimi\Workspaces\Amazon Store`——精确匹配不会命中；
  - meal_tracker 另有 6 个 `C:\Users\...\.codex\worktrees\...\meal_tracker` 类 cwd，与注册路径不同，需要显式 alias。
- **问题**：
  1. “Project Control 已登记 project_id”来自哪套库？开发库和稳定库项目集与 project_id 都不一样，不指定来源，C1 产物今天链接明天就是悬空 id；
  2. 简报验收写“未注册项目（亚马逊、量化等）正确落 quarantine”——量化在开发库**已注册**，示例会误导执行与验收；
  3. ZWNJ、大小写、尾分隔符、junction 实路径这些规范化规则不定义，Quant 会因一个不可见字符被错误 quarantine；
  4. Amazon 父 cwd vs tools 子路径的“精确 or 前缀”匹配策略未定义（合同说 fail closed，没说前缀）；
  5. worktree cwd 的 alias 表没有落地形式。
- **改法**：
  1. 明确唯一权威注册表来源与导出 seam：建议由 Project Control 导出一份带 schemaVersion 的 `project-registry-export.json`（含 project_id + normalized workspace 路径 + 导出时间），C1 脚本只读该文件，不直连任一 SQLite；开发库 vs 稳定库的分叉由 Cyrus 先裁决；
  2. 项目映射规则细化：Unicode NFC/NFKC + 去零宽字符 + 大小写折叠 + 尾分隔符归一；匹配只认精确路径；前缀一律不自动命中（Amazon 父目录 → quarantine，除非 Cyrus 显式加 alias）；
  3. alias 表做成 repo 内显式配置文件（含 worktrees → mealtracker 等条目），并随 C1 验收逐条过 Cyrus；
  4. 验收示例改为“Quant（dev 注册）→ mapped、Amazon 父目录 → quarantine、worktree meal_tracker → 按 alias mapped”。

### P0-4 输出路径与现有 `protected-paths` 制度冲突

- **核实事实**：`scripts/protected-paths.js` 的 `assertAutomationSafe` 只允许“仓库目录或系统 temp”，`D:\CodexData\extract` 两者都不是；该目录**当前不存在**（闸门 3 尚未批准）。简报把输出落点写进“已拍板决策点”，又把目录批准列为闸门 3——自相矛盾。
- **问题**：新管线若照惯例复用路径守护会被自己的输出目录挡住；不守护又违背“自动化不得发明新写入目标”的既有纪律。
- **改法**：闸门 3 提前到 C1 派发前；通过后新增受控例外——`CODEX_EXTRACT_ROOT` 白名单（仅 `D:\CodexData\extract`，带 marker 与测试），默认关闭，未设置时脚本拒绝运行；C1 验收包含“无批准根时 dry-run 拒绝写入”的测试。

### P0-5 原型 out 产物仍在仓库 docs 内，与简报自己的红线冲突

- **核实事实**：`docs/attachments/codex-scan/out/` 里有 3 个 `.user-turns.jsonl` + `clean-turns.md`，内容是**完整用户轮次正文**（本次 grep 未发现密钥模式，但正文本身在仓库内）。简报第 20 行写“原始会话内容永不进仓库”，INDEX 把它标成“脱敏产物”。
- **问题**：现状已违反治理红线 3（docs 内不放会话记录正文）与简报自身承诺；简报只说“不成为惯例”，没有给出处置动作。处置又撞“永不删除 docs 文件”的规则，不能默默删。
- **改法**：在 C1 前置步骤写明处置方案：out 全文移出到 `D:\CodexData\extract\p6-2\_prototype-out\`（闸门 3 批准后），仓库内只留“计数 + 哈希 + 清理说明”的 README；按治理流程更新 INDEX 并留档说明，不静默删除。生产管线从第一行代码起就不在仓库 docs 落任何全文。

### P0-6 C2 的产物与合同 §3“排除项仍保留在证据索引层”冲突

- **核实事实**：合同 §3 明确“排除项不进入提取，但仍保留在证据索引层（可追溯）”；C2 要点 1 只写“排除项计数入报告”，要点 6 输出只有“规范化记录 JSONL”。
- **问题**：照字面执行，world_state / compacted / inter_agent 等排除事件在索引层**无记录**，违反冻结合同，且未来溯源断链。
- **改法**：C2 输出拆两条流：
  1. `turns/` 白名单轮次记录（合同 14 字段）；
  2. `events/` 全量事件索引（event_type、locator、content_hash、role、status=excluded_by_whitelist，**无正文**），排除项计数与索引行数对得上。
  验收增加“排除事件在 events 索引可追溯”一项。

### P0-7 C2 的 14 字段不含正文，但 C3 的输入文本来源没有定义

- **核实事实**：合同 §2 的 14 字段只有 `content_hash` 和 `portable_locator`，没有 text。C3 要逐条判定，必须有文本。
- **改法**：二选一并写死：C2 额外产出**本地工作集** `turns-text/`（脱敏后正文 + 同一 locator/content_hash，明确标注“非合同字段、仅本地工作集”），C3 只读它；或 C3 按 locator 回源读取。推荐前者（避免 C3 再次碰源目录、再次做脱敏）。

### P0-8 同一用户消息的双载体去重没有定义

- **核实事实**：原型 out 已实测同一句话同时以 `response_item(message, role=user)` 和 `event_msg(user_message)` 出现（jsonl 第 2、3 行即重复）；原型 `clean_turns.cjs` 只用“正文前 200 字符”粗略去重。
- **问题**：C2 不做载体优先级去重，用户每句话会进两条记录，C3 会双倍标注且计数虚高；“助手最终答复”“必要阶段结论”也没有 payload 判定矩阵——合同 §3 的“P6-0B 再细分”尚未发生。
- **改法**：C2 写明逐事件判定矩阵：每种 `type|payload.type` 的取用/排除/去重优先级（例如同一 user 文本优先 response_item、event_msg 同 hash 标 duplicate_carrier）；“阶段结论”列出具体 payload type 清单，列不出就放排除并计数——不放任执行端现场猜。

### P0-9 血缘去重算法细节缺失

- **问题**：parent 优先级合同已定（forked_from_id 优先），但以下未定义：逻辑会话根命名；传递闭包有环时怎么办；跨文件 parent 缺失时是否退化单文件族；“保留最早 rollout 出现”的“最早”排序键（session_meta.timestamp？文件名时间戳？tie-break 规则）。
- **改法**：C1 补算法规格：root = 无父节点的逻辑 id（或本文件 id）；环 → quarantine 并计数；排序键 = `(session_meta.timestamp, file_path)` 字典序 tie-break。C2 只消费 C1 血缘表，不重算。

### P0-10 `content_hash` 的规范化与脱敏顺序未定义

- **问题**：合同 §2 只说 `sha256(规范化正文)`，但规范化规则（trim？换行折叠？剥噪声前还是后？）和“先 hash 还是先脱敏”没写。这直接决定幂等续跑与血缘去重是否稳定。
- **改法**：定死：`content_hash = sha256(剥噪声后、未脱敏、规范化空白后的正文)`（hash 不含明文秘密，不会泄露；脱敏只作用于存储文本）；规范化 = NFC + 去首尾空白 + `\r\n→\n` + 连续空白折叠为单空格，进报告示例。C1/C2 同一函数共享。

### P0-11 噪声注册表只有名单，没有格式/版本/测试与生产脚本落点

- **核实事实**：原型四脚本硬编码 `ROOT="D:\\CodexData\\home\\sessions"`、无参数、无测试、`extract_turns.cjs` 会向控制台打印用户文本预览；注册表在简报里只是五个包装名字。
- **改法**：生产管线放 `scripts/codex-import/`（参数化源根/输出根、默认拒绝、dry-run）；噪声注册表 = repo 内版本化 JSON（规则类型：prefix/wrapper/payload_type，带 schemaVersion 与 fixtures 测试）；控制台输出只允许计数与哈希（可机器 grep 验收）；全部用合成 fixture 测试，永不读真实源目录。

### P0-12 C3 的标签体系与原型启发式标签不是同一套，映射规则缺失

- **核实事实**：`clean_turns.cjs` 产出 9 类启发式标签（驳回/纠偏、确认/追问、批准/同意…）；B 线定稿是 **8 动作 + 4 卡型**；C3 要点 1 说按八动作+两卡型，要点 2 又说“用 clean_turns.cjs 的规则族预标签”——两套枚举对不上。
- **改法**：C3 先冻结语料 schema：`label` 枚举 = B 线 8 动作 + `not_approval`，`card_type` 枚举 = B 线 4 卡型 + `none`，置信度 0–100；给出“9 类启发式标签 → 8 动作”的显式映射表（映射不了的归 `not_approval`）；每条记录含 locator、多标签数组、卡型候选、解析器版本。C3 只作为 B 线分类法的验证语料，不发明新标签。

### P0-13 盲评与验收的方法细节不足，且 C1–C3 没有任何测试/门禁证据要求

- **问题**：
  - 盲评只写“随机抽 20 条”，没有随机 seed、抽样层（按会话 or 全量）、多标签一致率公式（exact / Jaccard）、分歧仲裁方式、Codex 明日复核的具体对象；
  - 三任务都没有“新增测试文件 + 测试数 + 全量 `node --test` + 脱敏 grep + 日志零内容 grep”的证据要求（A 线有，C 线没有）；
  - C3 逐条判定 + 盲评的规模与远程模型成本没有估计，1h 节奏很可能不够。
- **改法**：补 C3 盲评规程（seed 固定、20 条按逻辑会话分层抽样、一致率公式写死、分歧记录不判对错、误判模式进 `docs/WORKING_RULES_AND_PITFALLS.md` 指定小节）；三任务证据要求统一为“脚本单测数 + 全量门禁 + 脱敏 grep=0 + 日志内容抽查 + locator 回验”；C3 给出轮次规模估计与 token/成本上限，成本上限本身进闸门 1。

---

## 二、高优先级强化（不修会返工）

1. **C1 的“已拍板决策点”标题改掉**：输出落点仍是闸门 3，未批准前不得写任何东西；C1 前半段（扫描/算 hash/生成报告草稿）可以 dry-run，落盘动作必须 gate 后。
2. **两源根去重**：实测 junction 与 canonical 都枚举出 308 个文件；C1 唯一键必须是 `source_realpath`（canonical 去重），junction 路径只作 `source_file` 备查，否则登记 616。
3. **幂等语义修正**：“跑两次第二次全量跳过”仅在无并发写入时成立。应定义为“按 `source_file_sha256` 判断：未变 → skip，变化 → 重跑；活跃/锁定 → retryable”，并记录 observed_at；验收措辞同步改。
4. **“未说明跳过 = 0”保留**，但要求每类 status 的计数都对得上注册表行数，报告加对账公式。
5. **C1 注册表 schema 未定义**：给出 `session-registry/v1` 字段（source_file、source_realpath、source_file_sha256、session_id、meta_session_id、cwd、lineage_root、project_resolution、status、parser_version、format_observation、observed_at）与 JSONL 命名。
6. **回仓库的聚合报告要脱敏**：不得出现 `F:\QClawData`、`D:\CodexData` 等个人路径原样；cwd 一律显示为 project_name/project_id 或路径哈希。原型 out 的处置见 P0-5。
7. **C1 “解析首行 session_meta”要容错**：实测 308 首行都能解析，但合同不保证未来首行必是 session_meta；定义“文件头 N 行内定位首个 session_meta，找不到 → quarantine 并记录”。
8. **C2 落盘路径/命名**：`turns/<logical_session_id>/<rollout_uuid>.jsonl` 与 `events/`、`turns-text/` 的命名规则、临时文件 + rename、同盘原子写要写明。
9. **C3 的 DSH 会话筛选**：不要用字符串含 “DSH” 判断；用 C1 的 `project_resolution=DeepSeek Harness Personal Desktop` 过滤，避免把 `agents-md-d-deepseek-harness-personal` 这类 Codex 工作区误纳入。
10. **路径引用**：C3 要点 1 的两处 `design/审批交互模式…` 补全为 `docs/design/…`；记忆手册写明 `docs/记忆系统手册.md`。
11. **合同 §7 现状栏已过时**（2026-08-17 只登记 mealtracker）：合同正文不动，但 C 线简报应引注“登记状态以 Project Control 最新导出为准”，并附本次实测结果。

---

## 三、按任务的最小补全清单（供 K3 勾对）

### C1 需补
- [ ] 权威项目注册表来源 + 导出文件 seam（P0-3）。
- [ ] 路径规范化 + 精确匹配 + alias 表 + ZWNJ 处理。
- [ ] 血缘算法（根/环/tie-break/缺失 parent）。
- [ ] 两源根 realpath 去重；idempotency 按 hash 语义改写。
- [ ] registry/report schema；回仓库报告脱敏规则。
- [ ] `CODEX_EXTRACT_ROOT` 受控例外 + dry-run 默认拒绝。
- [ ] 前置步骤：原型 out 移出仓库 + INDEX 处置。
- [ ] 证据：合成 fixture 测试数、日志零内容 grep、幂等输出、覆盖率声明。

### C2 需补
- [ ] 白名单判定矩阵（payload type 级）+ 双载体优先级（P0-8）。
- [ ] events 全量事件索引（排除项可追溯，P0-6）。
- [ ] turns-text 本地工作集（P0-7）。
- [ ] content_hash 规范化与脱敏顺序规格（P0-10）。
- [ ] 噪声注册表 JSON + 版本 + fixtures。
- [ ] 脱敏模式共享模块与产物 grep 门禁。
- [ ] 证据：14 字段抽查、排除/去重/脱敏计数对账、locator 回验、全量测试。

### C3 需补
- [ ] 授权闸门 1 扩展与顺序（远程模型，P0-1）。
- [ ] 逻辑会话数改“以 C1 报告为准”（P0-2）。
- [ ] 语料 schema + 9→8 标签映射表（P0-12）。
- [ ] 盲评 seed/分层/一致率公式/分歧记录/Codex 复核对象（P0-13）。
- [ ] 成本估计与输入长度上限、发送前脱敏校验。
- [ ] 证据：分布报告、盲评记录、语料路径、报告零全文零密钥。

---

## 四、事实速查（评审时已逐项实测）

| 项 | 现状 |
|---|---|
| 源文件数 | canonical 根 308 个 `.jsonl`；junction 根同样枚举 308；合计 3,327,723,189 字节 ≈ 3.10 GiB |
| cwd 分布（by_cwd 实测） | meal_tracker 192（507? 实际 2271 MB）、DSH 42（507 MB）、Codex Pets 12、Quant 12、Amazon Store 8、其余零散 |
| DSH 42 口径 | **42 是 rollout 文件数**，逻辑会话数未计算 |
| 原型管线 | 4 脚本硬编码 ROOT、无测试；out 含全文；clean_turns 是 9 类启发式标签 |
| 开发库项目 | mealtracker / tools / Cyrus Quant Trading / DSH Desktop（4 个） |
| 稳定库项目 | DSH Desktop / mealtracker（2 个，project_id 与开发库不同） |
| Quant 路径 | `F:\documents\Kimi\Workspaces\Cyrus Quant Trading\u200c`（含 ZWNJ） |
| Amazon 注册 | `...\Amazon Store\tools` 挂在 tools 项目，父目录 cwd 未注册 |
| 输出目录 | `D:\CodexData\extract` **不存在**；不在受保护路径清单，但也不在 `assertAutomationSafe` 白名单 |
| 合同 §2 | 14 字段；§3 排除项保留证据索引；§8 远程模型单独授权、日志零内容 |

---

## 五、需要 Cyrus 拍板的三个执行前提

1. **闸门顺序与范围**：闸门 3（输出目录）先于 C1；闸门 1 扩展为“含 C3 标注/盲评在内的任何远程模型外发”并先于 C3。是否同意？
2. **项目注册表权威来源**：开发库 / 稳定库 / 导出文件三选一（推荐导出文件 + 开发库为当前权威），并批准 alias 表（worktrees、Amazon 父目录）的维护方式。
3. **原型 out 的处置**：同意“全文移出仓库、留计数与哈希说明”的清理方式吗？（涉及治理“永不删除”，需要明确记录。）

这三点连同闸门表原有三项一起裁决后，K3 按本文修订，C 线即可派发执行。
