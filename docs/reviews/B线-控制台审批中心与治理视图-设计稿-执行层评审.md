# B 线 · 控制台审批中心与治理视图 · 执行层评审

> 评审对象：`docs/design/B线-控制台审批中心与治理视图-设计稿.md`（Kimi K3，2026-08-20 草案）
> 评审范围：**执行层**——schema/数据模型能否落库、每期出口能否实测、引用能力是否真实存在、分期是否自洽。不重审“三层模型/八动作/常备授权”这些交互判断本身。
> 核对方式：逐条对照 `docs/governance/LLM项目治理说明书.md`、`docs/adr/ADR-004-*.md`、`docs/design/*` 两份实证稿与思考稿、`plugins/project-control` 现状（migrations 0001–0009、storage/http/client 全量）。
> 结论：交互层设计质量高（实证扎实），但**执行层有 15 项阻断级缺口**：schema 引用了仓库里不存在的实体与能力、四个投影只有两个落进分期、跨端摄入没有任何承载规格。按现稿直接派给 Flash，B1 会卡在“批准之后没有落点”，B2 会卡在“第六条不变量没有权威定义”，B3 会卡在“P6 session 路由无证据可复用”。建议 K3 修订后再派发。

---

## 一、执行阻断级问题（修订时必须解决）

### P0-1 全部引用路径少了 `docs/` 前缀（与 A 线同款错误）

- **设计稿位置**：第 4–6、126 行。
- **核实事实**：实证稿与思考稿在 `docs/design/`，治理说明书在 `docs/governance/LLM项目治理说明书.md`，D2 在 `docs/architecture/`，ADR-004 在 `docs/adr/ADR-004-project-control合同族扩展-治理语义与审批队列.md`。仓库根没有 `design/`、`governance/`、`architecture/`、`adr/` 目录。
- **改法**：全部改为 `docs/` 全路径。ADR-004 第 4 行的关联路径同样要改。

### P0-2 “六不变量”中的第 6 条没有权威定义，B2 无法机器实现

- **核实事实**：治理说明书 §10 L1 只定义了**五条**不变量（INDEX 双向一致 / 位置正确 / 状态头 / 取代横幅 / ADR 只追加）。第 6 条“各项目说明书副本版本漂移”只出现在思考稿（标注“来自 §12”）与 ADR-004；§12 只说了“副本标版本、冲突以主副本为准”，**没有**机器可查的规格（副本放哪、怎么枚举、漂移阈值、豁免清单）。
- **问题**：B2 出口“六灯全绿可被一条命令复核”没有可执行的第 6 条判据；R0–R2 的读取范围、archive/attachments 豁免集合、INDEX 多文件行（现 INDEX 有 `a / b / c` 合行）解析语法、ADR hash 基线存哪（思考稿开放问题 4 未答）也全部悬空。
- **改法**：
  1. 先补治理说明书（走 ADR，见 P0-15）把第 6 条固化为可计算不变量，给出主副本路径、副本发现规则、版本比较规则；
  2. 设计稿补 R2 的输入规范：docs 根解析、INDEX 表语法（含合行展开）、豁免目录名单、ADR 快照基线存储位置与合法变迁白名单；
  3. 明确“未接管项目”在 R0 的显示语义（思考稿倾向的“待办状态”，不能让存量项目红成一片）。

### P0-3 `gate_go` 卡承诺“前置 checklist 全绿展示”，但 schema 里没有 checklist 字段

- **改法**：schema 增加 `checklist: [{id, label, evidence?, passed}]`；质量门禁与 UI 均以它为准；gate_go 的 options 豁免在字段级写死。

### P0-4 响应对象不完整：没有选项选择、没有 action 枚举、没有 delegatee/snooze_until、没有机器打回态

- **核实事实**：schema 的 `response` 只有 `{action, reason_tag?, reason_text?, constraints_text?, responded_at}`。
- **问题**：
  1. `decision/option_pick` 批准时**没有 `selected_option_id`**——批准了哪个选项无法记录，批量一键批也无法验证“同建议方向”；
  2. 八动作没有枚举值（批准/批准+约束/打回补料/驳回+方向/完全否决/委托/缓议/知悉），无法 Ajv 校验；
  3. `delegated` 状态缺 `delegatee`，`snoozed` 状态缺 `snooze_until`；
  4. 质量门禁“机器打回不进队列”后卡片去向无状态承载——生产端拿不到回执，卡会静默消失。
- **改法**：response 补 `selected_option_id`、`action` 枚举、`delegatee?`、`snooze_until?`；status 增加 `machine_rejected`（或等价），并规定机器打回必须写回执（inbox 回执文件或可查列表），显式失败优于静默丢弃。同时定义 per-action 必填矩阵：approve_with_constraints 必须 `constraints_text`；reject_with_direction 必须 reason + direction；delegate 必须 delegatee；snooze 必须 snooze_until；Class A 驳回必须 reason_text。

### P0-5 `fyi_challenge` “到期自动生效”没有任何调度器设计

- **问题**：谁在何时把卡从 queued 转成 auto_effective？project-control 是请求驱动 + outbox 定时器，B1 是否引入 effect 定时器没有写；时钟基准（UTC/本地）、到期后若恰有 pending 补料如何互斥、进程不在运行时的补偿扫描，全部未定义。
- **改法**：B1 明确加“到期推进器”（Host effect 定时器 + 启动时补偿扫描，用可注入 now() 写测试）；deadline 统一存 UTC ISO；fyi 有 pending_clarification 时到期不自动生效，改为继续挂起。

### P0-6 三层模型的 Node 层没有表、没有摄入、没有任何数据来源；四个投影有两个没排期

- **核实事实**：project-control 现有 `work_items` + `work_item_dependencies`（migration 0009）就是现成的“节点 + 依赖边”。设计稿 schema 引用了 `node_id`，但 D-1 的 Node 层、§7 的流程图/看板投影在 B1–B3 里**完全没有落点**：B1 收件箱、B2 治理视图、B3 授权/门禁/CLI/会话/跨端/日历——流程图和看板没有出现在任何一期。
- **问题**：照现稿执行，`node_id` 是悬挂外键，聚合规则里“无相互依赖”没有可判定的边数据，§7 承诺的“一个任务图 + 四投影”只交付两个半投影。
- **改法（二选一，建议前者）**：
  1. Node 显式复用 `work_items`（node_id → work_item_id，不新建 node 表），补依赖边与卡的关系；流程图/看板降级为 B3 之后的 V2 登记项，设计稿明说“本期只交付收件箱 + 日历热力，流程图/看板后置”；
  2. 或真正把 node 表/边表/节点摄入（从 NEXT 或 work_items 导入）写进 B1 migration 与验收。
- 同时解决 batch 矛盾：Batch 定义为“视图层实时计算分组”（同 card_type + 同 recommendation.option_id + 依赖边不相交），**不落表**；`batch_id` 从 schema 中删除或改为响应时的审计引用。Class A 卡与不同 class 的卡永不合并，一键批的响应逐卡复制。

### P0-7 质量门禁声称“机器打回”，但“概念性提案无具体示例”不是纯机器可判

- **问题**：缺标题/选项/置信度等可机器查；但“概念性 vs 有示例”需要语义判断。若不加说明，执行端要么只能做字段存在性检查（与设计承诺不符），要么偷偷引入 LLM 判定（新增成本与依赖，未报备）。
- **改法**：把门禁拆两层：
  1. B1 只做 **schema/字段级校验**（Ajv strict，含 per-card-type 必填矩阵——fyi 无 options、gate_go 用 checklist、decision/option_pick 才要求 options≥2 + recommendation）；
  2. B3 的“示例门禁”用确定性 proxy 定义（如 `evidence` 非空且至少一条 `locator` 指向文件路径；或卡内新增 `example` 字段必填），若坚持语义判定则显式写明“LLM judge + 成本/超时上限”并走 Class A 报备。不要写“机器打回”又不给算法。

### P0-8 跨端 inbox 没有承载规格，且“各端写卡”的工具不存在

- **问题清单**：inbox 目录在哪（repo 内 gitignored 目录？共享盘？F 盘？）——任何选择都牵扯跨端可写性与受保护路径红线；文件格式是 YAML 还是 JSON（project-control 只有 ajv/ajv-formats，**没有 YAML 解析器**，新增依赖 = Class A）；原子写（tmp+rename）与轮询（Windows fs.watch 不可靠）策略；ULID 重复/恶意超大文件/路径穿越的 quarantine；摄入成功后文件归档去哪；机器打回的回执文件写哪；各端用什么工具产卡（现在没有任何 writer，K3/Codex 手写 YAML 必然漂移）。
- **核实事实**：Gate 2E 的外部输入适配器是 **HTTP + capability handshake**（http.ts /storage applyExternalUpdate），不是文件监听器。ADR-004 说“复用 Gate 2E 外部输入适配器 + quarantine 模式”只能理解为复用校验/隔离**模式**，代码是新的。
- **改法**：B3（建议把文件摄入提前到 B1 作为适配器建卡通道，见 P0-14）补全文件契约：
  - inbox 路径明确为 repo 内 `D:\Deepseek Harness Personal\.approval-inbox\`（gitignore），或 Cyrus 指定的共享路径；写清各端可写性前提；
  - 格式用 **JSON**（一卡一文件，schema_version 字段），并随设计发布 `approval-card/v1` JSON Schema + 合法/非法 examples + 各端共用的 `scripts/approval-submit.mjs`（校验通过才写文件）；
  - 定义 `inbox/ → ingested/ → rejected/` 生命周期、轮询间隔、文件大小/数量上限、重复 id 幂等、quarantine 留证。

### P0-9 “经 P6 既有 session 指令路由下发”在仓库里查无实据，B3 会卡住

- **核实事实**：全仓（含 project-control、plugins、scripts、docs）检索不到 session 指令路由的实现或接口；只有 NEXT.md P6 清单一行勾选与思考稿/ADR-004 的转述。project-control 有 `agent_thread_bindings`（关联 session/thread），但没有“向 session 下发指令”的能力。
- **改法**：把这条从“复用既有能力”改为“**待核实 + B3 前置 spike**”：K3 给出该路由的确切代码路径/协议名（若在上游运行时）与最小调用验证；查无则修订 ADR-004 为“新增推送机制”，并写入 B3 工作量。治理红线 5 要求不能把待核实当事实引用，设计稿与 ADR-004 都要改。

### P0-10 审批卡与既有 decisions/reviews/work_items 的关系未定义——“批准之后发生什么”没有落点

- **核实事实**：project-control 已有 `decisions`（ADR 载体）、`reviews`、`work_items`、`runs` 四类控制对象与 Review 页签；设计稿审批队列是第五个决策面，但没说与它们的关系。
- **问题**：
  1. 批准一张卡 = 批准内容 + 路由，但**批准后不产生 work_item/run**，路由字段就只是文本——06:24 教训要求的“路由违规标红”无法检测（系统不知道谁实际在执行）；
  2. 两个决策面并存，用户不知道去 Reviews 还是收件箱；
  3. ADR-004 说“卡状态与 WorkItem/Review 投影一致”，但没有映射规则。
- **改法**：明确最小闭环：**卡批准（含 routing）→ 生成/关联 work_item（执行者与 cost_tier 写入）→ run 开跑时回填实际执行者**；路由违规 = `run.owner ≠ card.routing.proposed_executor` 且未附理由。至少 B1 要先落“批准生成 work_item（或显式关联）”，否则 B1 出口“批掉一批真实卡”无下游证据。收件箱与 Reviews 的关系一句话定性：审批卡管“决策”，Reviews 管“交付物审阅”，并在 UI 互链。

### P0-11 “一期单向摄入”与“驳回理由结构化回流一等公民”直接矛盾

- **问题**：§4 说驳回理由结构化回流给 agent；D-8 说一期各端只写不读、二期才回派。照一期做，agent 永远收不到结构化驳回。
- **改法**：一期补一个廉价回执通道（agent 端经同一 inbox 收 `*.result.json` 回执文件，或轮询只读 API/CLI 查自己的卡）；“主动推送到会话”仍留二期。设计稿写明一期回流的承载物。

### P0-12 模板通路（§9“杠杆最高”）没有排进 B1–B3

- **核实事实**：三个内置模板（minimal/software/research 1.0.0）当前只产出 README/PRD/DEVLOG/NEXT 与 `.dsh-project`，**没有**治理骨架（docs/INDEX、AGENTS.md、首份 ADR）。
- **改法**：要么在 B2 或 B3 增加“三模板升级 + templateVersion bump + 模板合同测试 + 存量项目不自动改写声明”；要么把 §9 这句降为 V2 候选。不要在设计稿里保留一个没有任何分期的承诺。

### P0-13 migration 与既有测试的连锁改动没有列出

- **核实事实**：新 migration 将是 `0010_*.sql`，落库后 schemaVersion 9→10。`plugins/project-control/test/storage.test.js:181` 等多处硬编码 `schemaVersion: 9`，`external-runtime.test.js:307-320` 构造“到 0009 为止”的分段迁移，`scripts/verify-launch.js:65` 迁移检查循环写死 `1..9`。
- **改法**：设计稿/任务简报明确列出：新增 0010；更新 verify-launch 到 1..10；更新上述测试断言；migration 测试沿用现有 staged-migrations 模式（升级路径 9→10 保留旧库数据）。ADR-004 的“新 migration”也应写明编号约定。

### P0-14 B1 出口“批掉一批真实卡”没有真实卡来源

- **问题**：B1 只有“手动/适配器建卡”，跨端文件摄入在 B3；照字面执行，B1 交付时队列里只有手工点出来的演示卡，“真实卡”无法验收。
- **改法（建议）**：把**基础文件适配器 + approval-submit 脚本**提前到 B1（校验/幂等/quarantine 最小版），B3 只做多端并发、额度上下文与回执增强；同时把两份实证稿的 17+81 条事件转成 `test/fixtures` 的批卡包，B1 验收 = 用脚本导入 fixture → 页面批完 → 审计日志与 work_item 落点可查。

### P0-15 设计稿没有“每期可实测验收标准 + 证据要求 + 自报级别”

- **问题**：A 线已具备四件套；本稿 §10 只有“内容 + 出口一句话”，执行端无法自证，审查端无法验收。且 B1/B2 动 project-control DB（migration 0010）按 D2 分级至少需要明确哪期是 Class A/B 边界。
- **改法**：按治理说明书的四件套补齐 B1/B2/B3 的验收清单与证据要求；同时写明前置闸门：**ADR-004 由 Cyrus 拍板生效后才开工 B1**（ADR-004 自己已写此条，设计稿要同步）。

---

## 二、高优先级强化（不修会返工）

1. **ID 方案**：schema 写 `ulid`，project-control 全库用前缀 UUIDv7（`prj_/rev_/dec_`…）。审批卡直接用 `crd_xxxxxxxx-...` 前缀 UUIDv7（复用 `createPrefixedUuidV7`），不要引入 ULID 实现/依赖。
2. **project_id 归属**：卡必须归属项目（跨项目治理卡建议归到主项目 `prj_01a00cfd…` 并加 `scope: project|global`），否则 file adapter 无法确定写哪个 project DB、FK 无法落地。
3. **ID 与路径安全**：inbox 文件大小/数量上限、JSON 深度限制、locator/URL 白名单（外部链接沿用 https+github 白名单口径）、evidence 路径仅展示不自动执行。
4. **CLI 共享核心**：现有 `scripts/check-governance.js` 查的是受保护路径/AGENTS 投影/密扫/git remote，**不是**五不变量。B2 要新增或扩展 CLI，并解决“Console（随包 plugin）与 CLI（repo script）共用同一检查核心”的落点问题（插件 lib 不随 scripts 打包，建议核心放 project-control 可打包模块，script 薄封装）。
5. **日历/流程图 UI 零新依赖**：project-control 只有 ajv 依赖；日历热力用 CSS grid 自绘，流程图 V2 再议——加图表库必须走 ADR。
6. **额度上下文没有上报机制**：Codex #55 只是聊天里一句话；需定义各端额度状态的写入点（inbox 同款 `status.json`？）与过期策略，否则“额度进入路由上下文”是空字段。
7. **常备授权条件 DSL**：禁止任意代码；用白名单字段 + 等值/前缀/枚举组合的条件 JSON，配套 schema 与匹配函数测试；授权命中只写审计日志（ADR-004 已定）并给 agent 查询接口。
8. **自学习阈值**：5 次批准/2 次驳回的统计口径、窗口期、提议卡生成者与去重规则要写；否则 B3 指标无法定义。
9. **审计与并发**：response 落 append-only 表（参照 `review_actions`），卡表带 revision 乐观锁，actor 沿用 `CONSOLE_ACTOR`，时间统一 UTC。
10. **小笔误**：D-3 标题写“五种卡型”，正文列了 4 种卡型 + 1 个响应动作——改为“四卡型 + 八响应”；`confidence: 0-100` 要加整数与闭区间校验；routing 的 `k3|codex|v4pro|v4flash` 要与名册文档的正式 ID 一字不差并做成机器枚举。

---

## 三、按分期的最小补全清单（供 K3 勾对）

### B1（审批收件箱 MVP）需补
- [ ] `approval-card/v1` JSON Schema + examples + Ajv 严格解析测试（替代设计稿里的示意 YAML）。
- [ ] migration `0010_approval_queue.sql`：卡表/响应动作表/审计表（含 checklist、selected_option、delegatee、snooze_until、machine_rejected）。
- [ ] 卡 ⇄ work_item 最小联动：批准生成/关联 work_item，routing 写入，run 回填实际执行者。
- [ ] 基础文件适配器 + `approval-submit` 脚本 + fixture 卡包（把 17+81 事件转卡）。
- [ ] fyi 到期推进器（可注入时钟）+ 补偿扫描。
- [ ] per-action/per-card-type 校验矩阵与机器打回回执。
- [ ] 验收四件套 + 门禁（全量测试、project-control tsc、check-plugins、verify-launch 1..10、smoke 0）。

### B2（治理视图）需补
- [ ] 先定第 6 条不变量与豁免/解析规范（P0-2）。
- [ ] 治理检查核心落点（随包模块 + CLI 薄封装）；`check:governance` 输出 JSON。
- [ ] Governance 页签 + 跨项目健康列 + Documents 并入；未接管项目语义。
- [ ] ADR hash 基线存储与合法变迁白名单；诊断→Proposal→复验自动消除的表结构。
- [ ] 三模板升级（或明确后置）+ 模板合同测试。
- [ ] 验收四件套。

### B3（授权/门禁/会话/日历）需补
- [ ] P6 session 路由 spike 结论（存在则引用路径，不存在则改为新推送机制并更新 ADR-004）。
- [ ] 多端 inbox 并发/幂等/回执协议；额度状态上报格式。
- [ ] 常备授权注册表 + 条件 DSL + 匹配器 + 撤销入口 + 审计。
- [ ] 示例门禁确定性算法或 LLM-judge 的显式报备。
- [ ] 日历热力（CSS grid）+ 队列指标（卡均停留/打回率/授权命中率）口径。
- [ ] 流程图/看板投影的处置结论（降级 V2 或排期）。
- [ ] 验收四件套。

---

## 四、事实速查（评审时已逐项核对）

| 项 | 现状 |
|---|---|
| 治理说明书实际路径 | `docs/governance/LLM项目治理说明书.md`（v1.0） |
| §10 不变量数量 | **五条**；第 6 条只在思考稿/ADR-004，§12 无机器规格 |
| 现有治理 CLI | `scripts/check-governance.js`：查受保护根/AGENTS 投影/密扫/git remote/自动化守卫，**不含五不变量** |
| project-control DB | migrations 0001–0009，当前 schemaVersion=9；新表需 0010 |
| 既有控制对象 | work_items / runs / reviews / review_actions / decisions / progress_updates / quarantine_items / domain_events / outbox |
| 任务图可复用 | `work_items` + `work_item_dependencies(kind: blocks/relates_to)` |
| Gate 2E 外部输入 | HTTP + capability handshake + quarantine；**没有文件监听适配器** |
| session 指令路由 | 仓库内查无实现；仅有 NEXT P6 勾选行与转述 |
| 模板现状 | 三模板无 docs/INDEX、AGENTS.md、首份 ADR（需升级） |
| Console 现状 | 页签：总览/清单/审阅/运行/动态/文档/会话；无收件箱/Governance |
| ID 约定 | 前缀 UUIDv7（`crd_` 等），无 ULID |
| YAML 解析 | project-control 无 yaml 依赖；inbox 建议 JSON |
| 相关测试硬编码 | storage/external-runtime/console-http 等断言 schemaVersion=9；verify-launch 迁移循环 1..9 |

---

## 五、需要 Cyrus 拍板的三个执行前提

1. **P0-10 的最小闭环口径**：批准卡自动生成 work_item（推荐），还是只做审计留痕、派发仍人工？——决定 B1 是否真的“审批-执行”。
2. **P0-8 的 inbox 位置与跨端可写性**：repo 内 `.approval-inbox/`（推荐）还是共享目录？各端是否都能访问同一路径？
3. **P0-9 的 P6 session 路由**：请 K3 先给证据再排 B3；查无则同意 ADR-004 改为“新增推送机制”。

这三点连同 D-1～D-9 一起裁决后，K3 按本文修订，B 线即可进入任务简报与执行。
