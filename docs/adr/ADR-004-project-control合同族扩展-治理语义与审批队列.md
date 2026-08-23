# ADR-004 project-control 合同族扩展：治理语义与审批队列

> 状态：预登记 v2（待 Cyrus 拍板） ｜ 日期：2026-08-20 ｜ 起草：Kimi K3
> 关联：`docs/design/B线-控制台审批中心与治理视图-设计稿.md`（D-9 引用本文）
> 评审留档：`docs/reviews/B线-控制台审批中心与治理视图-设计稿-执行层评审.md`

## 修订记录

- **v2（2026-08-20）**：吸收执行层评审——关联路径补 `docs/` 前缀（P0-1）；决策 4 由"复用 P6 既有 session 指令路由"改为"待核实 + B3 前置 spike，默认拉模式"（P0-9，原引用查无实据，起草人认错）；migration 写明编号约定 0010 及连锁改动（P0-13）；补最小闭环与 inbox 文件契约的拍板结论（P0-10/P0-8）。
- **v1（2026-08-20）**：初稿。

## 背景

B 线控制台需要三种 project-control 尚不具备的能力：(a) document-index 的治理语义读取（说明书六不变量诊断）；(b) 审批队列一等能力（卡 CRUD、状态机、审计日志）；(c) 会话上下文卡下发（agent 打开项目时收到权威清单 + 失败不变量 + 交接指针）。现有合同族（PROJECT_PROTOCOL / INTAKE / TEMPLATE / CONTROL_SPEC / DATA_MODEL）已冻结，P5/P6/P7 语义不得破坏。

## 决策

1. **只新增不修改**：不动任何冻结合同的既有语义；扩展以新增 migration + 新增 capability 组实现（P1「覆盖策略属新协议线版本」的先例）。
2. **document-index 扩展治理诊断维度**：新增诊断类型（骨架/状态头/INDEX 双向一致/横幅/ADR 追加/说明书版本漂移），只增诊断类型，不改 P5 既有状态语义；正文仍不入 DB，刷新仍不产生 Domain Event。第 6 条不变量的机器规格以单独 ADR 先行固化（B2 前置）。
3. **审批队列作为独立 capability 组**（`approval-queue/v1`）：卡表 + 响应动作表（append-only）+ 审计日志 + 授权注册表，落 project-control SQLite，**migration 编号 0010**（schemaVersion 9→10；连锁更新 `scripts/verify-launch.js` 检查循环至 1..10 与相关测试断言，沿用 staged-migrations 模式）；队列的系统记录 = DB，跨端摄入的文件只是传输层——复用 Gate 2E 的校验/quarantine **模式**（Gate 2E 本体是 HTTP+handshake，文件摄入代码新写）；inbox 落 repo 内 `.approval-inbox/`（gitignore，Cyrus 已拍板）。
4. **会话上下文卡走拉模式，不建推送机制**（修订，原"经 P6 既有 session 指令路由"查无实据）：B3 前置 spike 核实上游运行时是否有可用下发通道（有则引用代码路径，无则确认）；默认实现 = session 启动钩子读取待发上下文卡；零机制兜底 = 上下文卡写成项目内约定文件（`docs/handoff/` 下）+ AGENTS.md 速查卡指引读取。
5. **常备授权注册表**随审批队列同 migration 落库；命中规则的执行只写审计日志，不产 Domain Event。
6. **最小闭环**（Cyrus 已拍板）：卡批准（含 routing）→ 自动生成/关联 work_item → run 开跑回填实际执行者；路由违规 = `run.owner ≠ card.routing.proposed_executor` 且未附理由，收件箱标红。审批卡管"决策"，Reviews 管"交付物审阅"，UI 互链不合并。

## 否决项及原因

- **修改冻结合同本体**：断兼容，违背 P1 冻结纪律。
- **审批卡以 docs 文件为系统记录**：文件不是队列，运行时状态必须入 DB；文件只作跨端传输。
- **卡正文/会话原文入 DB**：延续 P5 红线；卡只存决策结构化字段 + locator，不存会话全文。
- **把审批队列做成独立插件进程**：控制台风控属性要求与 project-control 同事务（卡状态与 WorkItem/Review 投影一致），拆分引入最终一致性问题，V1 不值。
- **新建 node 表**：现有 `work_items` + `work_item_dependencies`（migration 0009）即节点+边，复用即可。
- **推送式 session 下发**：重机制，一期拉模式 + 约定文件兜底已够；未来确需推送另行 Class A 立项。
- **引入 YAML/ULID/图表库依赖**：卡格式 JSON（无 YAML 解析器）、ID 用前缀 UUIDv7（`createPrefixedUuidV7`）、日历热力 CSS grid 自绘；任何新依赖走 ADR。

## 影响

- 新增 migration `0010_approval_queue.sql` 与 capability 声明；Console 新增收件箱页面与 Governance 页签；文件摄入适配器 + `scripts/approval-submit.mjs` + 治理检查核心（放 project-control 可打包模块，CLI 薄封装）。
- 实施后 `docs/NEXT.md` 与 `docs/INDEX.md` 同步登记；本 ADR 生效后 B1–B3 才允许开工。
