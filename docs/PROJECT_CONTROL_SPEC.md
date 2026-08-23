# 项目控制台与 Workbench 架构规格

状态：产品架构已定；Gate 0、Gate 1、Gate 2A、Gate 2B、Gate 2C 与 Gate 2D（P1–P5：合同冻结、受控文件同步、标准快速新建、legacy 安全升级、文档索引与重命名重绑定）已完成。当前已实现真实四轨 Shell、Project Control SQLite/Host API、现有项目只读发现与确认关联、模板快速新建与升级、文档索引与人工确认重绑，以及 Workbench 候选详情 viewer；Gate 2E 的跨 Harness/Agent 管线、文件/浏览器/PTY 操作与完整审核闭环仍是目标，不代表已经完成。  
Owner：Cyrus  
开发维护：DeepSeek Harness（2026-08-15 起；见 [`HANDOVER_TO_DEEPSEEK_HARNESS.md`](HANDOVER_TO_DEEPSEEK_HARNESS.md)）  
定案日期：2026-08-14  
兼容基线：DeepSeek Harness `0.1.0-rc.5`，提交 `47f943859bef60e4160492346772ded9b24f765a`

规范入口：[`PROJECT_INTAKE_SPEC.md`](PROJECT_INTAKE_SPEC.md) 定义项目发现、导入、新建与默认无写入行为；[`PROJECT_CONTROL_DATA_MODEL.md`](PROJECT_CONTROL_DATA_MODEL.md) 定义事实归属、全局数据库和迁移边界；[`PROJECT_PROTOCOL.md`](PROJECT_PROTOCOL.md) 与 `protocol/project-control/v1alpha1/` 定义 manifest、lifecycle、外部运行更新和标准输出的机器可验证合同。本文件负责产品总览和实施顺序；细节冲突时不得由实现自行猜测，必须先统一对应规范。

## 1. 产品定义

项目控制台不是普通项目列表，而是面向 AI Agent 的项目决策、执行、审核与证据控制面。它管理项目、工作项、Agent Run、产物、审核和架构决策；Harness Session 继续负责完整对话，Workbench 负责查看和操作文件、代码、Diff、浏览器、终端与审核证据。

四个部分的事实边界固定如下：

| 部分 | 负责的事实 |
| --- | --- |
| Project Control | Project、WorkItem、Run、Review、Decision、Comment 与审计事件 |
| Harness Session | 完整对话、流式响应、工具调用和原生交互 |
| Workbench | 文件、代码、Diff、浏览器、终端和 Artifact 的呈现与局部操作 |
| Connection Center | 连接配置和凭据引用，不保存项目业务状态 |

`Agent 完成`、`验证通过`、`Cyrus 批准`是三个不同事实，任何一个都不能代替另外两个。

## 2. 固定桌面布局

Gate 1 已把宽屏 Shell 落实为四栏同时存在；栏内项目业务仍按后续 Gate 实现：

```text
┌────────────────┬──────────────────┬────────────────────────┬──────────────────┐
│ Harness 原生侧栏 │ Project Console  │ 完整 Harness 会话       │ Workbench        │
│ Workspace/Agent │ 项目、工作项、审核 │ 聊天、输入、流式响应      │ 文件、Diff、工具  │
└────────────────┴──────────────────┴────────────────────────┴──────────────────┘
```

已确定的布局规则：

- Harness 原生侧栏保持原有 Workspace、Session、Agent、搜索、排序和折叠行为；展开宽度固定沿用 rc.5 默认 `280px`、收起轨道沿用 `56px`，不渲染侧栏拖拽手柄，也不替换其内部列表。
- Project Console 位于原生侧栏右侧、完整会话左侧；展开时可从自身标题栏收起，收起后保留 40px 栏内轨道，可从轨道箭头或原生侧栏底部入口恢复，并可通过右边界拖拽调整展开宽度。
- 完整 Harness 会话始终保留，不降级成摘要或迷你聊天。
- Workbench 位于最右侧，可折叠并保留 44px 轨道，可通过左边界拖拽调整宽度。
- 只有 `Project Console | Conversation` 和 `Conversation | Workbench` 两处分隔线可以拖拽。
- Project Console 与 Workbench 独立开关、独立记忆宽度；当前 Workbench 还会按全局/Session 作用域保存可恢复的页签描述符和活动页签。项目、筛选和业务选中项要到后续 Gate 才存在。
- 窗口变窄时优先收起未固定的辅助面板，不能把 Conversation 压到不可读宽度。
- Gate 1 约束：Project Console `320–760px`、Conversation 最低 `560px`、Workbench `360–900px`；最终 100%–200% DPI 视觉验收仍放在 Gate 6。
- 双击分隔线恢复默认宽度，并提供“收起项目”“收起 Workbench”“专注会话”“重置布局”。

布局宽度与折叠状态按显示器可用宽度重新限幅，不能在分辨率或 DPI 改变后把面板留在屏幕外。

## 3. 当前 rc.5 约束与 Shell 决策

已经验证的上游事实：

- 官方 `ui-layout` 当前只提供 `sidebar | conversation | details` 三栏。
- `root`、`sidebar`、`conversation` 和 `details` 都是 single slot；普通插件不能在现有网格中追加真实第四栏。
- `shell.overlay` 是绝对定位的 list slot，不参与网格宽度和让步链，不能作为正式四栏实现。
- `sidebar.workspaces` 已由官方 Workspace 浏览器独占；`sidebar.footer.action` 是 Project Console 的常驻双向切换入口，同时保留项目栏自身的标题栏收起与 40px 轨道恢复，不新增根级悬浮按钮。
- 官方 `details` 由 Conversation 的详情容器占用，但 rc.5 当前 ChatView/工具卡没有把真实点击路由到 `openDetails`。Gate 1 已由 Workbench 接纳该子树，并把兼容的 `openDetails/closeDetails` 映射到唯一 `Details` 页签与临时 selection；上游真实工具点击仍未接通。

因此禁止使用 DOM 查询、CSS 位移或全屏浮层伪造第四栏。Gate 1 已落实桌面专用 `Personal Shell` 兼容层：

- Personal overlay 停用官方 `ui-layout` 行，仅在 Personal Desktop 组合中启用 Personal Shell。
- Personal Shell 兼容提供现有 `ctx.layout` 行为和 `sidebar`、`conversation`、`details`、`shell.overlay` 子 slot，并新增真实 single slot `project.control` 与 `workbench.panel`。
- 官方 Sidebar 与 Conversation 插件继续占用原来的 slot；上游源码目录保持只读。
- Personal Shell 保留官方主题投影、Session 切换时的详情清理、窄窗口让步和加载期稳定挂载；Project Control 与 Workbench 各由独立用户插件占用对应 slot。
- `D:\Deepseek Harness` 不产生 tracked 修改，普通 `dsh web` 不启用 Personal Shell。

官方 Sidebar/Conversation 的 client manifest 虽仍记录官方 layout 包名，但 rc.5 的包名边仅是 Client manifest 元数据，真正激活依赖是 `layout` 服务。Gate 0 已证明 Personal Shell 可提供兼容服务并替换根布局；Gate 1 进一步证明 Project/Workbench slot、四轨让步和 Details 路由可稳定 settled。该结论仍由 rc.5 版本门控，上游升级后必须重新验证。

## 4. 模块边界

### 4.1 Personal Shell（内部基础模块）

负责：

- 四栏网格、两处分隔线、让步规则和布局偏好。
- 继续提供兼容的 `ctx.layout`。
- 声明 Project Console 和 Workbench 的稳定插槽。
- 保持官方 Sidebar、Conversation、主题和 overlay 生命周期。

它是桌面组合的内部兼容层，不拥有项目数据，也不实现 Workbench 业务。

### 4.2 `@cyrus/dsh-project-control`（用户可见插件）

Gate 2C 当前边界：在真实 `project.control` slot 中保留固定导航，并通过唯一 Host 提供 SQLite `schemaVersion=5`、迁移/backup/单写者锁、Project 注册事务、Receipt/Event/Outbox、document bindings、managed manifest mirror，以及现有项目的授权扫描、候选审阅、忽略/恢复、文档映射、只读关联和 managed 安全重绑。Client 只显示真实数据库/扫描状态；空库不生成占位项目，扫描也不自动注册 Project。

后续 Gate 才扩展的 Host 职责：

- WorkItem、Run、AgentThreadBinding、Artifact、Review、Decision、Comment 及其状态机和写入命令。
- 结构化日志导入、Session Adapter、Outbox dispatch 和跨 Harness 已认证 capability handshake。
- Gate 2D 的项目文件同步/新建，以及后续恢复与调度。

Gate 2C 已实现接入所需的最小 Client 流程，Gate 2D 继续补齐写盘/新建；Gate 3 起扩展为完整管理界面：

- Project Console 面板。
- 全局总览、单项目页面、待审核、Agent Runs 和活动时间线。
- 向 Host 发送领域命令，不直接写状态。

### 4.3 `@cyrus/dsh-workbench`（用户可见插件）

Gate 2C 当前边界：已经提供七个稳定页签、viewer registry、统一 open intent、可恢复描述符/活动页签持久化、脏页签保护和唯一 Details selection 路由；`Details` 新增 Project Control 候选详情 viewer，用于展示扫描证据、问题、文档短预览和映射确认。Files、Code、Outline、Diff、Browser 与独立 PTY viewer 仍是占位，不执行文件写入、网页加载、Diff 生成或终端启动。

Gate 5 的目标职责：

- 文件树、代码、文件结构树、Diff、审核、浏览器和终端标签。
- 根据 Project/WorkItem/Run/Artifact 上下文打开对应证据。
- 提交“附加产物”“请求审核”“评论”“向关联 Session 补充指令”等领域意图。

Workbench 不建立第二套项目数据库。当前底部会话 PowerShell 的 Host/PTY 生命周期必须复用或明确迁移，禁止再造竞争的终端进程模型。

### 4.4 Project Protocol（共享契约）

作为 Project Control 内部共享模块，定义：

- 领域 ID、状态枚举、版本化命令/查询 DTO 和幂等输入边界。
- 标准化领域事件、进展更新 frontmatter 和来源信息。
- Artifact 引用、版本和 SHA-256。
- Workbench open intent，例如 `openFile`、`openDiff`、`openArtifact`、`openTerminal`。

规范入口是 [`PROJECT_PROTOCOL.md`](PROJECT_PROTOCOL.md)，机器合同位于 `protocol/project-control/v1alpha1/`。Gate 2B 已在 Personal Host 中运行 lifecycle Command/Result 校验；核心对象默认拒绝未知字段，只在明确的命名空间 `extensions` 中保留扩展。其他 Harness、Agent、UI 和未来 CLI/MCP 都必须经过同一 Host 与协议，不得直写 SQLite 或自行解释 Markdown 推进状态；跨应用的认证握手与 external runtime update dispatcher 仍未实现。它不单独显示为用户插件。

## 5. 信息架构

Project Console 内的全局导航项固定为：

- 项目总览
- 待我审核
- Agent Runs
- 全局活动

总览顶部只突出：

- 待 Cyrus
- 阻塞
- 有风险
- 正在运行的 Agent

项目列表至少显示一句话目标、生命周期、健康度、下一里程碑、待审核数、最近更新和下一动作。

单项目固定页签：

1. **概览**：目标、成功标准、当前成果、下一步、风险、待决定事项、最新更新和关联会话。
2. **工作项**：WorkItem、依赖、验收标准、Run、Artifact 与 Review。
3. **Agent Runs**：同一 WorkItem 的执行尝试、主/子 Agent、关联 Session、时间、usage 与预计费用。
4. **架构**：当前架构文档与 ADR。
5. **活动**：进展更新与系统审计的统一时间线，可分别过滤。

不开启任意页面搭建器、任意自定义字段或每项目不同工作流。

## 6. 核心领域模型

```text
Project
  └─ Milestone / Phase
      └─ WorkItem
          └─ Run
              ├─ AgentThreadBinding
              └─ Artifact
                  └─ Review

Decision / Comment / Event 可关联 Project、WorkItem、Run 或 Artifact。
```

- **Project**：目标、成功标准、主 Workspace、生命周期、健康度、审核与预算策略。
- **WorkItem**：完整指令、验收标准、依赖、优先级和路由要求。
- **Run**：一次不可变的执行尝试；保存指令快照、Session/Agent 绑定、状态、时间、usage、失败原因与 `retryOf`。
- **AgentThreadBinding**：Run 与主/子 Agent Session 的角色和生命周期映射，不复制会话全文。
- **Artifact**：文件、Diff、报告、测试、截图或网页预览引用；保存版本、来源和 SHA-256，大文件不进数据库。
- **Review**：绑定特定 Run/Artifact/Decision 版本的审核请求、结论和意见。
- **Decision**：背景、候选方案、取舍、决定、后果和 `supersededBy`。
- **Event**：append-only 审计事件，记录 actor、时间、关联对象、correlation/causation 和 schema version。

所有可并发修改的核心对象必须带 revision，领域命令使用乐观并发，不能让后到的旧页面覆盖新状态。

## 7. 分离的状态轴

- Project 生命周期：`planned | active | paused | completed | canceled`
- Project 健康度：`on_track | at_risk | off_track`
- WorkItem 执行：`draft | ready | queued | running | output_ready | blocked | paused | failed | done | canceled | superseded`
- Run：`queued | dispatching | running | succeeded | failed | canceled | orphaned`
- Review：`not_required | pending | changes_requested | approved | rejected | superseded`
- Decision：`proposed | accepted | rejected | superseded`

硬规则：

- `Run succeeded` 只表示 Agent 已结束执行，不表示 WorkItem 已验收。
- WorkItem 进入 `done` 前必须满足验收标准、必要 Artifact 和审核策略。
- 重试创建新 Run，不覆盖失败历史。
- 评论和“线程已解决”不等于批准。
- 审批绑定具体版本；材料实质变化后旧审批自动过期。
- Agent 默认不能正式批准自己生成的结果。
- Project 不因所有 WorkItem 看似完成而自动宣布 completed。

## 8. 领域动作

UI 不直接写状态，只发送命令：

- **执行**：冻结指令与验收标准，创建新 Run，再通过 Session Adapter 选择或创建 Session。
- **暂停**：请求协作式暂停并记录事实；不能伪装成操作系统已冻结所有外部副作用。
- **继续**：根据 Run/Session 实际状态恢复，必要时创建新 Run。
- **批准**：批准特定版本并解除相应审核关口。
- **要求修改**：保存意见，重新打开 WorkItem，并创建后续 Run 或 WorkItem。
- **评论**：追加讨论，不改变审核结论。
- **取消**：记录 actor、原因和时间；已发生的外部副作用不被宣称回滚。

打开项目不会自动切换当前 Session；只有“打开关联会话”或明确执行动作可以切换或创建 Session。

## 9. 四栏共享上下文

共享上下文最少包含：

```text
Project > WorkItem > Run > Session/Agent > Artifact
```

交互规则：

- 点击原生 Session 时，Project Console 可以跟随定位关联对象，但不能修改原生侧栏。
- 点击 WorkItem 时，显示关联 Run 与 Session；没有 Session 时显示“创建并执行”。
- 点击 Artifact 时，Workbench 打开对应文件、Diff、报告或预览。
- 所有下发指令前显示目标 Session，防止多 Agent 并行时发错对象。
- Project Console 支持“跟随当前 Session”和“固定当前项目”两种模式。
- 未绑定的 Session 明确显示“尚未关联项目”，不猜测绑定关系。

## 10. 结构化日志与架构文档

每个受管理项目可包含：

```text
.dsh-project/
  project.yaml
  updates/
  decisions/
  artifacts/
docs/
  PRD.md
  ARCHITECTURE.md
```

长期项目文档保存在项目目录：

- `project.yaml`：稳定项目身份、显示名、协议版本和项目根相对的文档角色映射；不得保存本机绝对路径、凭据或数据库运行状态。
- PRD、当前架构和其他叙述性资料：继续保存在 manifest 映射的项目文件中，各字段遵守 [`PROJECT_CONTROL_DATA_MODEL.md`](PROJECT_CONTROL_DATA_MODEL.md) 的唯一事实源表。
- `updates/`：人可阅读的进展更新。
- `decisions/`：不可静默改写的 ADR。
- `artifacts/`：产物元数据或受控引用，不复制所有大文件。

Agent 首选发送经过 Schema 校验的强类型命令，而不是自行拼写数据库状态或从 Markdown 反推状态。Gate 2A 首批机器合同覆盖：

- 项目 manifest；
- External Runtime Update Command Envelope（progress/blocker/completion）；
- 标准化 Domain Event；
- 人可阅读进展更新的 frontmatter。

命令与事件必须携带协议/Schema 版本、稳定 ID、actor、来源和 revision/幂等信息。格式错误、版本不支持、引用无法对账或发生并发冲突时进入明确拒绝、回执或 Quarantine，不能静默推进状态。具体字段与首批动作以 [`PROJECT_PROTOCOL.md`](PROJECT_PROTOCOL.md) 和 JSON Schema 为准；项目注册、新建、重绑和升级的 lifecycle DTO 已在 Gate 2B 前冻结，并由当前 Host 对 Command 与 Result 双向校验。

架构采用两种文档：

- **当前架构**：可持续更新，记录组件、边界、依赖、约束、风险和改进计划。
- **ADR**：`Proposed | Accepted | Rejected | Superseded`；旧决定被推翻时只建立 `supersededBy`，不修改历史结论。

## 11. 存储、安全与恢复

Gate 2C 已实现的控制面子集如下；项目目录读写、WorkItem/Run/Review 写入和跨应用管线仍是后续目标：

- Project 注册状态、路径绑定、document bindings、managed manifest mirror、Event、Outbox 与 CommandReceipt 已保存到当前 Windows 用户稳定的 Electron `userData\project-control\project-control.sqlite3`；允许显式 `PROJECT_CONTROL_HOME` 覆盖。数据库不得放入 `DSH_HOME`、Portable 临时解压目录、项目目录、Git 仓库、网盘或网络盘。
- 项目目录负责长期文档；数据库负责事务性控制状态。同一个字段只能有一个事实来源。
- 当前 Project 状态变更、Receipt、Event 和 Outbox 在同一事务提交；幂等冲突、revision 冲突与 `LOCATION_CONFLICT` 不产生伪成功事件。采用“当前状态表 + 审计事件”，不做复杂纯事件溯源。
- `schemaVersion=6` 使用 `0001 + 0002 + 0003 + 0004 + 0005 + 0006` 迁移、不可变 checksum、升级前 SQLite online backup 和数据库派生的单写者锁；`0003` 新增 source root、import job/candidate/document/issue 与限时 location/source-root ref，`0004_windows_path_nocase.sql` 保留来源级 import job issue 并作为 v4 阶段的 ASCII `NOCASE` 防线，`0005_windows_unicode_path_key.sql` 引入由 Host 生成的版本化 Unicode `path_key`（Windows 分隔符规范化、NFC、稳定 Unicode lower），统一覆盖 source root、active workspace、候选 latest/ignore 以及 register/rebind；`0006_file_sync_plans.sql` 新增 Gate 2D 的持久化 write plan journal（planned→staging→staged→files_committed→accepted/rolled_back/recovery_required）。v4 若已有 Unicode 等价重复路径，v5 升级会失败回滚并保留 pre-v5 backup，不静默合并或删除。Host 退出关闭数据库并释放锁。系统 Node 的 `node:sqlite` 当前仍会输出 ExperimentalWarning。
- 存储、目录授权与 trusted workspace path 拒绝 UNC/extended UNC；盘符形式的映射网络盘不能由当前字符串校验可靠识别，因此必须使用已知本机固定磁盘。Renderer 只能用系统选择器返回的单次短期签名授权请求扫描；lifecycle 只接受绑定候选、revision、应用实例和 scope 的 Host-issued `loc_`/`srt_`。
- 只读 scanner 不越过用户选择边界，不跟随逃逸链接，限制递归深度、文件数量、单文件读取量和响应大小；确认前及 resolver 执行前重新扫描并核对文档哈希。扫描、候选预览、忽略和 `linked_legacy` 关联都不写项目目录。
- Artifact 保存受控路径或 Workspace 引用，并记录 SHA-256、大小和生产 Run。
- 启动恢复时对账 `dispatching/running` Run 与真实 Session；无法确认的标记为 `orphaned/needs_attention`，不盲目重跑。
- 工作区文件访问必须规范化路径、阻止 `..` 和符号链接逃逸、限制文本和响应大小，并对写入使用 expected revision/version。
- Connection Center 只提供 CredentialRef；API Key、Webhook secret、Cookie 和 Token 不进入项目库、日志或 Agent 指令。
- 发布、删除、付费、外部发送等动作默认需要显式人工审核。

## 12. Workbench 当前骨架与目标能力

Gate 1 固定的七个页签仍是 `Files`、`Code`、`Outline`、`Diff`、`Browser`、`Terminal`、`Details`。这些名称和 viewer/open-intent 接口已经稳定；Gate 2C 已让 `Details` 承载 Project Control 候选审阅，官方详情子树继续走兼容 selection 路由，其余工具内容仍是占位。

Gate 5 的目标能力为：

- **文件**：受 Workspace 根限制的文件树、刷新与搜索。
- **代码**：Monaco 编辑、只读预览、版本冲突和脏状态保护。
- **大纲**：文件内 symbol/结构树和点击定位。
- **Diff / 审核**：版本化 Diff、证据、评论、批准与要求修改。
- **浏览器**：受限导航、明确来源和外部打开回退。
- **终端**：复用现有 Session Terminal Host/PTY，支持底部与右栏视图但只有一份终端事实。

首个完整版本不实现 Git 暂存/提交 UI、多级树状面板编排、任意插件页面搭建和复杂跨崩溃编辑器恢复；底层接口保留未来扩展空间。

## 13. 实施门槛与顺序

内部按门槛推进。Gate 0/1 的 Shell 与接口基础、Gate 2A 的合同冻结、Gate 2B 的数据库事务内核与状态 UI、Gate 2C 的现有项目只读接入均已完成；Gate 2D 以后在完整闭环前仍只描述目标。

### Gate 0：四栏 Shell 兼容性实验（已通过，历史门槛）

在隔离临时 `DSH_HOME` 中只实现空 Project Console 列：

- 官方 `ui-layout` 在 Personal overlay 中停用，Personal Shell 激活。
- 官方 Sidebar、Conversation、Details 容器、Theme 与 overlay 全部成功 settled；Details 的真实可见入口按 rc.5 当前可达行为单独记录，不把上游未接通入口误判为 Shell 回归。
- 原生左栏搜索、展开、折叠、Session 切换不回归。
- 空 Project Console 可从自身标题栏收起、从 40px 栏内轨道恢复，也可由原生侧栏底部入口双向切换；右边界可拖拽，根节点不得出现悬浮项目按钮，Conversation 可真实聊天。
- `ctx.layout` 的 sidebar/details 行为保持兼容。
- 开发态真实 Electron smoke 完成聊天、关闭、端口关闭和无残留进程。
- `D:\Deepseek Harness` tracked 文件零修改，普通 `dsh web` 不受影响。

若 Gate 0 不通过，立即停止 UI 扩张，改走版本化薄布局补丁或等待/贡献正式 slot；禁止改用 DOM/CSS 浮层伪造。

Gate 0 结果（2026-08-14）：

- 已在桌面 overlay 中停用官方 `@deepseek-ai/dsh-client-ui-layout`，并启用 `@cyrus/dsh-personal-shell`；浏览器 boot graph 已确认只包含后者。
- 已保留 rc.5 `ctx.layout` 的 `toggleSidebar/openDetails/closeDetails`、原四个 child slot、Theme presenter 与 Session 切换关闭 Details 的实现路径，并新增 `project.control`。
- 隔离 Electron smoke 已确认 Personal Shell 根、四轨网格、空项目列、项目分隔线、官方 Conversation、终端 dock 和全部个人插件完成加载；Project Console 的标题栏收起、40px 栏内轨道恢复和原生侧栏入口双向切换均已实际通过，且没有根级悬浮入口覆盖会话；原生 Sidebar 也实际开关并恢复。
- `pnpm test` 104/104、`pnpm run check:plugins`、无 pnpm PATH 的普通 `cmd.exe` 双击入口测试和加严开发态 smoke 通过；Harness 优雅退出、随机端口关闭、Helper/Electron 无残留。上游 tracked diff 为零，原有未跟踪启动脚本保持不变。
- 自动 smoke 未读取真实 `DEEPSEEK_API_KEY`，没有付费调用模型；Cyrus 已在真实资料中完成一轮聊天、创建并切换两个 Session，Conversation/Session 人工签收通过。
- rc.5 的 `openDetails(target)` 注入回调未从当前 ChatView/工具卡真实交互调用，工具 Inspect 进入 trajectory，因此没有可供人工执行的 Details 开关。Personal Shell 的 slot/service 兼容仍由类型、专项测试和启动 settled 证明；可见入口转入 Workbench 设计。Gate 0 按 rc.5 的真实可达行为记为通过。

### Gate 1：Personal Shell 正式化（已通过）

- 四栏网格、两处分隔线、项目栏标题栏收起/40px 轨道恢复/Sidebar footer 双向切换、Workbench 44px 轨道、宽度持久化、窄窗口让步和键盘操作。
- Project Console 和 Workbench 只放占位插件，先固定稳定接口。
- 为 Workbench 定义统一的工具详情入口与 selection 路由，替代 rc.5 当前不可达的独立 Details 交互，但不复制第二份详情状态。

Gate 1 结果（2026-08-14）：

- 十三个插件包完成 settled；`@cyrus/dsh-project-control` 占用真实 `project.control` slot，但保持无 Host 存储/API 的纯占位，`@cyrus/dsh-workbench` 占用真实 `workbench.panel` slot。
- Workbench 固定七个页签，并完成 viewer registry、统一 open intent、全局/Session 作用域、可恢复页签描述符与活动页签持久化、脏页签保护、Details 临时 selection 和 Session 切换清理；恢复数据按固定 schema 清洗并回写，未知字段和非法 ID 不进入模型。
- `pnpm test` 141/141 与 `pnpm run check:plugins` 十三个插件包门禁通过。
- 开发态真实 Electron smoke 使用 1380px BrowserWindow（Renderer 内容区 1366px），验证初始 Project/Conversation/Workbench 为 `360 / 682 / 44`，Workbench 展开后为 `40 / 626 / 420`，两种状态均无横向溢出；Project/Workbench 收起与恢复、专注会话/重置布局、Theme presenter、桌面 bridge、个人 API、优雅退出和端口关闭均通过。
- Gate 1 不包含项目数据库、项目文件、Project Control 业务 API，也不包含 Workbench 的文件、浏览器、Diff 或 PTY 执行路径。完整多 DPI 视觉、封装态和真实项目验收仍按 Gate 6 执行。

### Gate 2A：Project Control 合同冻结（已完成）

- 冻结现有项目扫描/只读导入、标准项目快速新建、`linked_legacy`/`managed`、身份与路径分离、默认无写入和冲突处理。
- 冻结字段级唯一事实源、全局 SQLite 数据模型、迁移/备份、安全边界、单写者 Host，以及“当前状态 + Event + Outbox + Receipt”的事务语义。
- 发布 `project-control.dsh/v1alpha1` 的人类规范、JSON Schema 2020-12 和有效/无效示例；不创建运行时数据库、扫描器、模板、Host API 或业务 UI。
- 用 strict Ajv 合同测试锁定事实归属、版本、UUIDv7、规范化相对路径、来源版本、并发/幂等字段与完成声明证据；合同变更必须先更新 Schema、fixture 和迁移边界。

### Gate 2B：数据库运行时与事务内核（已完成）

- 已冻结 register/create/rebind/upgrade lifecycle Command/Result/Event Schema，并由 Host 使用 strict Ajv 惰性校验；Schema 资产异常不会拖死 `GET /status` 和 `GET /projects`。
- Gate 2B 当时实现 SQLite `schemaVersion=2`、`0001 + 0002` migration runner、checksum/online backup、数据库派生单写者锁、Project 核心注册表、revision/幂等，以及“Project 状态 + Receipt + Event + Outbox”原子事务；Gate 2C 已在不改变这些事务语义的前提下把当前 schema 升到 v5。
- 已开放 `/__personal/project-control/v1alpha1` 的 `GET /status`、`GET /projects`、`POST /lifecycle`。UI 只显示真实存储状态、真实数量和真实项目列表。
- 本条的 Gate 2B 历史状态曾因 resolver 未实现而让 register/rebind 返回 `REFERENCE_UNRESOLVED`；Gate 2C 已补齐候选绑定的 resolver。Gate 2D 文件同步仍未实现，create/upgrade 继续返回 `CAPABILITY_NOT_NEGOTIATED` 并保留 write plan。没有 Outbox dispatcher、WorkItem 写入或自动 Agent 调度。
- 验证结果：`pnpm test` 188/188、十三插件 `check:plugins`、开发态 Electron smoke、重新 `pack:win:dir` 后的 `smoke:packed:dir` 全绿，真实路径报告 `schemaVersion=2` 并在退出后释放锁。`artifacts\win-unpacked` 是当前 Gate 2B 产物；Portable/NSIS 未重建，`compat.json` 仍为 rc.5/`47f943`。

### Gate 2C：现有项目发现与导入（已完成）

- 已实现来源目录直接子项目和单项目的有界只读扫描、候选/证据/问题预览、忽略/恢复、显示名称与文档角色确认、`linked_legacy`/有效 manifest `managed` 登记，以及 managed 路径重新绑定。
- 桌面系统选择器签发单次、短期且绑定用途的扫描授权；Host 对扫描边界、候选 revision、actor/provenance、目标身份、`loc_`/`srt_` scope 和文档哈希进行验证。候选转 `imported` 与正式登记或重绑在同一事务提交。
- 扫描、预览、忽略、映射和 legacy 导入默认不写项目目录；不会因发现高置信候选自动加入项目。managed 重绑仅在 manifest 身份一致且旧 active 位置不可访问时开放，两个位置同时存在则保持冲突。
- 四个现有项目的只读验收均成功：食溯 App、Amazon Store、Cyrus 量化模拟、Cyrus Music 分别识别 51、6、14、2 份候选文档，全部建议 `linked_legacy`，项目目录零写入且未自动登记。

### Gate 2D：标准项目快速新建（P1–P5 已完成）

- 实现版本化模板、原子新建、manifest/PRD 初始文件和 legacy 安全升级。
- 非空目录、无效 manifest、路径逃逸或覆盖风险必须停止，不能“尽力写入”。
- P5 文档索引：managed 以 manifest binding 为准、legacy 以确认过的 DB binding 为准；`0008_document_index.sql`（`schemaVersion=8`）逐绑定记录状态/观测哈希/字节数/解析诊断（不存正文），文档变化只形成候选或诊断；重命名按 role binding + 内容哈希提议重绑，多候选必须人工确认，managed 提案仅作诊断且重绑被拒绝（需先更新 manifest）。刷新与重绑通过 `GET /projects/:id/documents`、`POST /projects/:id/documents/refresh`、`POST /projects/:id/document-rebinds/:proposalId/resolve` 暴露给 Console，不产生 Domain Event/Outbox，也不自动推进 WorkItem/Review。

### Gate 2E：跨 Harness/Agent 管线

- 实现 UI、Agent、CLI/MCP 和其他 Harness 共用的强类型命令入口、标准日志 Renderer、Quarantine 与修复流程。
- 所有调用经过同一 Host、Schema、权限、revision 和幂等检查；其他应用不得直写数据库或创建第二套项目格式。

### Gate 3：Project Console

- 项目总览、固定项目页、进展/审计时间线、当前架构与 ADR。
- 人工绑定 Session、创建 Run 和查看关联会话。

### Gate 4：Session、Agent 与审核闭环

- `project_event`、Run/AgentThreadBinding、主/子 Agent 状态、Artifact、Review。
- 执行、暂停、继续、批准、要求修改和评论形成可审计闭环。

### Gate 5：Workbench 完整能力

- 文件、Monaco、Outline、Diff/Review、受限 Browser、复用终端。
- Project Console 只发 open intent；Workbench 返回 Artifact 引用和领域命令。

### Gate 6：恢复、封装与真实验收

- 崩溃/断线对账、并发与旧 revision、路径逃逸、敏感数据、DPI 和窄窗口测试。
- 开发态、解包版和 Portable smoke；真实项目、真实聊天、Agent Run、审核和退出清理人工验收。

## 14. 明确后置

- 修改或合并 Harness 原生侧栏。
- 任意自定义字段、任意页面布局和每项目不同工作流。
- 无人值守自动调度、自动重试和复杂依赖求解。
- Git 暂存、提交、变基等高级 Git 操作界面。
- 飞书/微信通知及远程审批。
- 多用户权限、多级审批和实时协同编辑。
- Gantt、Sprint、容量、故事点、速度预测和通用仪表盘设计器。
- GitHub、Notion、Slack 等双向同步。
- AI 自动宣布项目完成或自动批准自己的产出。

## 15. 完整验收定义

本阶段只有在以下闭环同时成立时才能称为完成：

1. 原生左栏、完整会话、Project Console 和 Workbench 可在宽屏同时显示。
2. Project Console 能从自身标题栏收起，并从 40px 栏内轨道或原生侧栏底部入口恢复；Workbench 能独立折叠与恢复；两者均可拖拽并在小窗口安全让步。
3. 一个 WorkItem 能创建 Run、绑定主/子 Agent Session、接收结构化事件并展示 Artifact。
4. Cyrus 能在 Workbench 查看具体版本的证据，评论、要求修改或批准。
5. 日志、ADR、状态和审核历史在重启后保持一致；断线不会盲目重复副作用。
6. 不修改上游 tracked 文件，不影响普通 `dsh web`，不泄露真实凭据。
7. 自动测试、插件门禁、开发态/封装态 smoke、真实聊天与退出清理全部通过。
