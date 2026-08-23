# Project Protocol v1alpha1

状态：Gate 2A 规范基线、Gate 2B lifecycle/SQLite/Host 和 Gate 2C intake/resolver 已实现；Gate 2D 文件同步与跨应用 dispatcher 尚未实现  
开发维护：DeepSeek Harness（2026-08-15 起；见 [`HANDOVER_TO_DEEPSEEK_HARNESS.md`](HANDOVER_TO_DEEPSEEK_HARNESS.md)）  
协议族：project-control.dsh  
线版本：v1alpha1  
日期：2026-08-14

## 1. 目的与范围

Project Protocol 是 Project Control、其他 Harness 应用、Agent 和项目目录之间的唯一共享契约。它让“导入已有项目”和“快速新建项目”进入同一条管线，并明确输入、校验、事务、事件和人类可读输出的边界。

本版本仍是所有实现必须遵守的规范。Personal Gate 2B 已实现 SQLite 事务内核、Lifecycle Host API 与真实数据库状态 UI，但尚未实现项目扫描、模板文件同步、调度或跨 Harness external runtime update dispatcher。协议定义的外部运行更新只有：

- progress.report → progress.recorded
- blocker.raise → blocker.raised
- completion.declare → completion.declared

completion.declared 只表示 Agent 提交了完成声明，不表示验证通过、审核通过或项目完成。

本文中的“必须”“不得”是规范要求；“应该”表示除非有记录在案的兼容原因，否则必须遵守；“可以”表示可选能力。

## 2. 版本分类

| 名称 | v1alpha1 表示 | 规则 |
| --- | --- | --- |
| 协议族 | project-control.dsh | 永久标识此协议，不携带版本 |
| 线版本 | project-control.dsh/v1alpha1 | 决定跨进程读写兼容性 |
| 文档 apiVersion | project-control.dsh/v1alpha1 | 出现在 project manifest |
| Schema 版本 | command-envelope/v1alpha1 等 | 精确标识单个 DTO |
| Markdown renderer 版本 | progress-markdown/v1alpha1 | 决定标准进展文件的正文布局 |
| 数据库迁移版本 | Gate 2B 定义 | 只属于本机存储，不是协议版本 |
| 应用版本 | 各 Harness 自己定义 | 只用于能力握手和来源记录 |

v1alpha1 是严格的 alpha 版本。任何字段、枚举、语义或必填规则变化都必须使用新线版本；不得在同一版本下静默改变含义。仅修正文案且不改变机器行为时可以保留版本。

所有时间必须是 UTC RFC 3339 的真实有效 UTC 时间，且线格式必须以 Z 结尾；Schema 同时使用 format: date-time 与 Z pattern，不能只检查字符形状。协议生成的业务 ID 使用“类型前缀 + 小写 UUIDv7”：Project 为 prj_、WorkItem 为 wrk_、Run 为 run_、Command 为 cmd_、Event 为 evt_、Update 为 upd_。目录移动不得改变 projectId，删除后的 ID 不得复用。

## 3. 事实来源

同一事实只允许一个权威来源。副本必须带来源和 revision，不能反向覆盖权威来源。

| 范围 | 权威内容 | 不得保存 |
| --- | --- | --- |
| 全局且不变 | 本文、v1alpha1 JSON Schema、状态与兼容规则 | 项目实例数据 |
| 本机全局控制面数据库 | 项目注册、绝对路径与路径历史、WorkItem、Run、Review、运行状态、revision、CommandReceipt、Event、Outbox、Quarantine、Session 绑定 | PRD 正文、完整 Session、凭据 |
| 项目目录 | project manifest、PRD、README、DEVLOG、架构、ADR、标准进展文件和 Artifact 文件 | 本机绝对路径、Token、Cookie、API Key |
| Harness 原生存储 | 完整 Session、流式输出、工具调用和原生 Agent 状态 | Project Control 的审核结论 |
| Connection Center | CredentialRef 与连接配置 | 项目业务状态 |
| 可重建投影 | 项目卡片、搜索索引、从旧文档提取的名称/阶段候选 | 新的权威事实 |

具体冲突规则：

1. managed 项目的 project manifest 只负责项目 ID、显示名称、创建来源 origin 和文档映射；数据库只缓存其 hash 和投影。origin 必须明确为 imported、template 或 fork，并携带该类型要求的 lineage 字段。
2. linked legacy 项目没有 manifest 时，文件夹名、README 或 PRD 标题只能生成带 provenance 的候选值。候选值不得伪装成项目已确认信息。
3. 项目目标、成功标准、产品范围以绑定为 prd 的项目文件为权威来源；manifest 不得复制这些正文。当前架构和 ADR 的正文同样以各自绑定的项目文件为准；解析结果始终可重建。
4. WorkItem、Run、Review 和运行状态以控制面数据库为准。Markdown 中的“完成”不能直接改变这些状态。
5. Session 全文仍归 Harness 所有；Project Control 只保存 threadId 和必要的绑定元数据。
6. 绝对路径只允许保存在本机全局数据库。manifest、事件和 Artifact 引用只使用 workspaceRef 与项目内 POSIX 相对路径。

## 4. 导入与新建汇入同一模型

Project Console 可以提供“扫描来源目录”“导入现有项目”和“新建标准项目”三个入口，但注册完成后都必须得到稳定 projectId，并使用相同的查询、命令、事件和审核模型。

导入现有项目：

1. Host 扫描目录并识别 README、PRD、DEVLOG、PROGRESS、NEXT、架构和 ADR。
2. 每个识别结果保存来源文件、内容 hash、观察时间和置信状态。
3. 用户确认项目根和 docs 根后，项目进入 linked_legacy；此步骤不得移动、改名或重写原文件。
4. 用户明确选择“纳入标准管理”后，Host 才可以写入 .dsh-project/project.yaml，使其进入 managed。
5. 旧日志提取出的工作项或状态只是候选输入，必须通过命令校验后才能成为控制面事实。

新建标准项目：

1. 用户选择父目录和模板。
2. Host 创建项目目录、稳定 projectId 和符合 Schema 的 manifest；模板创建的 manifest 以 origin.templateId 和 origin.templateVersion 记录可移植来源。
3. 模板可以决定初始文件，但不得改变核心状态机、命令语义或事实来源。
4. 创建完成后项目直接处于 managed，并进入与导入项目相同的控制面。

manifest 的标准位置是 .dsh-project/project.yaml。YAML 解析后的对象必须符合：

protocol/project-control/v1alpha1/schemas/project-manifest.schema.json

所有 manifest 路径必须是规范化 POSIX 相对路径：禁止盘符、绝对路径、反斜杠、冒号/Windows ADS、控制符、换行、双斜杠、尾斜杠以及 . 或 .. 路径段。只有 docsRoot 可以用精确的 “.” 表示项目根；其他 path 不允许 “.”。Schema 形状校验后，Host 仍必须解析 real path/reparse point 并再次验证没有逃出已登记根。文档角色 current_architecture 用于绑定当前架构；标准输出只包括 updatesRoot、decisionsRoot 和 artifactsRoot。origin.imported 不带额外 lineage 字段；origin.template 必须带 templateId/templateVersion；origin.fork 必须带 forkedFromProjectId。

## 5. DTO 边界

Project Control Host 是唯一写入者。Client、Workbench、Agent 和其他 Harness 应用不得直接打开 SQLite，也不得绕过 Host 改写控制状态。

跨进程只传输以下对象：

- External Runtime Update Command：外部 Harness/Agent 报告 progress、blocker 或 completion declaration。
- Project Lifecycle Command：Project Console 或获授权 Harness 发起项目注册、新建、重绑或升级；与运行更新使用不同 Schema 和 capability。
- Command Result：返回 accepted、replayed 或 rejected。
- Normalized Event：不可变的已接受事实；运行事件与 lifecycle 事件使用各自精确 Schema。
- Query View：带 revision、provenance 和 source state 的只读投影。
- Workbench Open Intent：只请求呈现文件、Diff 或 Artifact，不修改项目状态。

DTO 不得包含 ORM 实例、SQLite 行对象、任意可执行路径、凭据、完整 Session 内容或未经限幅的文件正文。Query View 不是写回模型，Client 不能把整份旧 View 作为更新提交。

## 6. 输入：External Runtime Update Command

所有外部运行更新必须通过：

protocol/project-control/v1alpha1/schemas/command-envelope.schema.json

核心字段：

| 字段 | 含义 |
| --- | --- |
| protocolVersion / schemaVersion | 精确线版本与 DTO 版本 |
| commandId | 本次意图的全局稳定 ID |
| correlationId | 由 producer 为同一业务链生成，并在 Command、Event 和 Outbox 中原样保留 |
| idempotencyKey | 生产者为同一业务动作生成的稳定去重键 |
| kind | v1alpha1 支持的三种命令之一 |
| actor | 谁发起动作及其 applicationId |
| target | Project、WorkItem、Run、Thread 与唯一被修改 aggregate |
| expectedRevision | 生产者读取时看到的 aggregate revision |
| provenance | 来源、observedAt、必填 applicationVersion/applicationInstanceId、可选成对 adapterId/adapterVersion，以及可选 hash/revision |
| payload | 与 kind 严格对应的业务内容 |
| extensions | 唯一允许扩展字段的命名空间 |

该 Schema 只覆盖 progress.report、blocker.raise 和 completion.declare，不覆盖项目注册、新建、重绑定、legacy 升级、审核或其他内部 lifecycle command。Gate 2B 的五类 Project lifecycle command 使用独立的 `lifecycle-command-envelope/v1alpha1`；实现不得把两组 kind 混进同一 Envelope，或用其中一组 capability 调用另一组。

completion.declare 的 evidence 至少包含一项。target.aggregateType 为 work_item 时 aggregateId 必须等于 target.workItemId；为 run 时必须等于 target.runId。JSON Schema 验证前缀，Host 负责验证跨字段相等。

外部运行更新管线必须按以下顺序执行：

1. 完成已认证的能力握手；Host 必须用 applicationInstanceId 关联该握手，并核对 applicationVersion 与可选 adapter 标识，不能把 payload 自报值直接当作可信身份。
2. 限制消息尺寸并解析 JSON。
3. 按精确 Schema 校验；未知字段或未知枚举立即拒绝。
4. 校验 actor、项目绑定、路径和引用是否可解析。
5. 执行幂等检查。
6. 比较 expectedRevision。
7. 在同一数据库事务中写入当前状态、CommandReceipt、Normalized Event 和 Outbox。
8. 事务提交后再执行可重试的 Markdown 渲染或外部投递。

Command Result 至少返回 commandId、status、recordedAt、aggregateRevision 和唯一 eventId。rejected 结果还必须返回稳定错误码，不得返回敏感内部堆栈。

稳定错误码至少包括：

- PROTOCOL_VERSION_UNSUPPORTED
- SCHEMA_INVALID
- CAPABILITY_NOT_NEGOTIATED
- REFERENCE_UNRESOLVED
- IDEMPOTENCY_CONFLICT
- REVISION_CONFLICT
- PATH_OUTSIDE_WORKSPACE
- CREDENTIAL_DATA_REJECTED
- QUARANTINED

## Gate 2B 补充：Project Lifecycle Command

Gate 2B 冻结五个项目 lifecycle command：

- `project.registerLegacy`
- `project.registerManaged`
- `project.createFromTemplate`
- `project.rebindLocation`
- `project.upgradeManaged`

机器合同位于：

- `protocol/project-control/v1alpha1/lifecycle/schemas/lifecycle-command-envelope.schema.json`
- `protocol/project-control/v1alpha1/lifecycle/schemas/lifecycle-command-result.schema.json`
- `protocol/project-control/v1alpha1/lifecycle/schemas/lifecycle-normalized-event.schema.json`

Lifecycle Envelope 复用本协议的 `protocolVersion`、UUIDv7 ID、actor、correlation、provenance、idempotency 和 optimistic revision 规则，但 target 固定为唯一 `project` aggregate。`registerLegacy`、`registerManaged` 和 `createFromTemplate` 的 `expectedRevision` 必须为 `0`；`rebindLocation` 和 `upgradeManaged` 必须精确提交当前大于等于 `1` 的 Project revision。Host 还要校验 location 自身的 revision、当前 mode、ID 一致性和跨字段 hash；这些领域约束不能只交给 JSON Schema。

Lifecycle DTO 不接受绝对路径。Client 先调用 Host 的授权/预检接口，获得不透明的 `locationRef` 和 `sourceRootRef`；引用采用 `loc_<uuidv7>` 与 `srt_<uuidv7>`，只能由签发它们的 Host 在已认证 application instance、授权范围和有效期内解析。盘符路径、UNC、POSIX 绝对路径、URI 或调用方自造 ref 均拒绝；`provenance.sourceId` 和 `extensions` 也不能被用作路径解析旁路。Event 和 Result 保留 ref 用于审计，不把本机路径复制到跨 Harness payload 或项目文件。

`manifestHash`、`templateHash`、`planHash` 和文档内容 hash 的线格式统一为 `sha256:` 加 64 位小写十六进制。`manifestHash` 是 Host 实际验证、观察或写入的 manifest 精确 UTF-8 文件字节的 SHA-256，不是调用方重排 YAML 后的逻辑对象 hash。`planHash` 是去掉 `planHash` 字段后，对 `{manifestHash,syncPolicy,operations}` 执行 RFC 8785 JSON Canonicalization Scheme 后的 SHA-256；Host 必须重算，不能信任自报值。

五个命令的 accepted 语义固定如下：

| Command | 项目目录 I/O | 同一领域事务中必须提交 | Lifecycle Event |
| --- | --- | --- | --- |
| `project.registerLegacy` | 无；只读取预检证据 | `projects(linked_legacy, revision=1)`、active location、用户确认的 document bindings、成功 Receipt、Event、Outbox | `project.legacy.registered`，`0 → 1` |
| `project.registerManaged` | 无写入；读取并验证现存 manifest/schema/hash/projectId | `projects(managed, revision=1)`、active location、manifest 事务镜像与 role bindings、成功 Receipt、Event、Outbox | `project.managed.registered`，`0 → 1` |
| `project.createFromTemplate` | 需要先按冻结 write plan 完成可恢复的原子同步 | 只有同步后 manifest hash 与 plan 一致时才创建 `projects(managed, revision=1)`、location、Receipt、Event、Outbox | `project.managed.created`，`0 → 1` |
| `project.rebindLocation` | 无项目目录写入 | 旧 location 失活、新 location 激活、path history、Project `revision+1`、Receipt、Event、Outbox | `project.location.rebound`，`n → n+1` |
| `project.upgradeManaged` | 需要先按冻结 write plan 原子新增 managed metadata，不覆盖旧文档 | 只有同步已提交且 hash 对账后才把 mode 改为 managed，并提交 `revision+1`、manifest 镜像/bindings、Receipt、Event、Outbox | `project.managed.upgraded`，`n → n+1` |

`registerLegacy` 与 `rebindLocation` 的成功 Result/Event 必须为 `fileSync.status=not_required`；`registerManaged` 必须为 `verified_existing`；`createFromTemplate` 与 `upgradeManaged` 的 accepted/replayed Result 和 Event 必须为 `committed`。`planned`、`rolled_back` 或 `failed_recovery_required` 只能出现在 rejected Result，不能推进 Project revision 或产生 lifecycle Event。

Gate 2B 只实现控制面 Host/数据库时，不具备模板或升级文件同步能力，因此必须对 `createFromTemplate` 和 `upgradeManaged` 返回 `CAPABILITY_NOT_NEGOTIATED`，保留 write plan 供界面展示；不得伪造 `committed`、创建 managed 行或发出 created/upgraded Event。Gate 2D 实现原子文件同步以后才能启用这两个 capability。文件同步失败时没有成功 Receipt/Event；已创建内容必须回滚。无法完整回滚时返回 `failed_recovery_required` 并进入 Quarantine，原有 linked legacy 状态不变。

所有 accepted/replayed lifecycle Result 都返回原 `commandId`、`correlationId`、唯一 `eventId` 和新的 Project revision。相同幂等 scope/key/hash 返回第一次的 Result，不能重复注册、重复重绑或重复写文件；同 key 不同规范化 command hash 返回 `IDEMPOTENCY_CONFLICT`。每个 accepted lifecycle command 恰好产生一个 lifecycle normalized event，并满足 `afterRevision = beforeRevision + 1`。

## 7. 输出：Normalized Event

每个 accepted external runtime update 恰好生成一个符合下列 Schema 的 append-only 事件，并只推进 target 指定的唯一 aggregate revision：

protocol/project-control/v1alpha1/schemas/normalized-event.schema.json

映射固定为：

| Command kind | Event type | 含义 |
| --- | --- | --- |
| progress.report | progress.recorded | 记录进展，不自动改变审核结论 |
| blocker.raise | blocker.raised | 记录阻塞及所需协助 |
| completion.declare | completion.declared | 记录完成声明，等待独立验证/审核 |

事件必须记录 beforeRevision、afterRevision、全局 sequence、actor、target、causation 和 provenance。causation.correlationId 必须原样复制输入 Command 的 correlationId。v1alpha1 运行规则要求 afterRevision 等于 beforeRevision + 1；Schema 只验证形状，Host 负责验证该跨字段规则。

Normalized Event 一经提交不得修改或删除。修正错误必须提交新命令并产生新事件，不能覆写历史。

## 8. 标准 Markdown 输出

Agent 和其他 Harness 应用提交 progress/blocker/completion 外部运行更新时应该使用 Command Envelope，不应自行拼写标准日志。accepted 事件由唯一 renderer 生成标准 Markdown，避免多个 Agent 并发修改一个巨大 DEVLOG.md。

标准目录：

~~~text
.dsh-project/
  project.yaml
  updates/YYYY/MM/YYYYMMDDTHHMMSSZ-<updateId>.md
  decisions/
  artifacts/
~~~

每个 update 文件的 YAML frontmatter 在解析为对象后必须符合：

protocol/project-control/v1alpha1/schemas/progress-update-frontmatter.schema.json

generatedBy 必须记录 applicationId、applicationVersion、applicationInstanceId 和 rendererVersion，使文件能与产生它的已认证 Host 实例对账。

正文顺序固定为：

1. 一级标题：summary。
2. 二级标题“发生了什么”。
3. 二级标题“证据”。
4. 二级标题“下一步”。
5. 二级标题“阻塞与待决定”。

没有内容的章节写“无”，不得省略。renderer 必须保留 sourceEventId、commandId、aggregateRevision 和 generatedBy。带 sourceEventId 的 renderer 输出不得再次作为输入导入，否则会形成回环。

DEVLOG.md 可以继续存在，但在 managed 项目中它应是人工维护的长期日志或系统生成汇总，不是运行状态数据库。系统不得从一句自然语言“已经完成”自动推出 WorkItem done 或 Review approved。

## 9. 幂等、并发与事务

幂等作用域固定为 actor.applicationId、target.projectId 和 idempotencyKey 的组合。

- 同一作用域、同一 key、相同规范化命令 hash：返回原 CommandReceipt，status 为 replayed，不生成第二个事件。
- 同一作用域、同一 key、不同 hash：拒绝为 IDEMPOTENCY_CONFLICT。
- CommandReceipt 必须与审计历史一同保留，不得因普通缓存清理丢失。

expectedRevision 是强制乐观并发条件：

- 现有 aggregate 必须精确匹配。
- 创建型命令在后续版本中统一使用 0 表示“预期不存在”。
- 不匹配时返回 REVISION_CONFLICT，并且不得写状态、事件或 Outbox。

当前状态、CommandReceipt、Event 和 Outbox 必须在同一事务提交。Markdown 文件和外部连接属于事务后的可重试副作用；失败只标记投递状态，不回滚已提交事实，也不重复执行领域命令。

## 10. Provenance 与 Quarantine

任何来自文件、Agent 或其他 Harness 的输入必须记录：

- sourceType 与 sourceId。
- observedAt。
- applicationVersion 与 applicationInstanceId；Host 必须通过已认证 capability handshake 的持久 instance 记录核对，而不是信任自报。
- 使用适配器时，adapterId 与 adapterVersion 必须成对出现。
- 可用时的 sourceRevision。
- 可用时的 sha256 内容 hash。

以下输入必须进入 Quarantine 或被拒绝，且不得推进领域状态：

- JSON/YAML 无法解析。
- Schema 或版本不支持。
- 项目、WorkItem、Run、Thread 或 Artifact 引用无法对账。
- hash 不匹配。
- 路径逃逸或符号链接逃逸。
- idempotency/revision 冲突。
- 疑似凭据或超出大小限制的内容。
- 标准 Markdown 声称的 sourceEventId 不存在或内容不一致。

Quarantine 保存有界原始内容或安全引用、hash、错误码、发现时间和来源；UI 必须显示“待修复”，不能把它混入正常活动。修复后创建新的 Command，不修改原 Quarantine 记录。

## 11. Capability Handshake

任何外部 Harness 在读写前必须发送 CapabilityOffer，字段固定为：

- protocolFamily：必须为 project-control.dsh。
- application：id、version、instanceId。
- supportedProtocolVersions：有序数组。
- supportedSchemaVersions：Schema 名到可接受版本数组的映射。
- capabilities：能力 ID 数组。
- extensions：可选的命名空间扩展。

Host 返回 CapabilitySelection：

- mode：read_write、read_only 或 incompatible。
- selectedProtocolVersion：精确共同版本；无共同版本时为 null。
- selectedSchemaVersions：逐项精确版本。
- enabledCapabilities：双方交集。
- disabledCapabilities：能力与原因。
- host：id、version、instanceId。
- limits：最大消息字节数、文本长度和 evidence 数量。

v1alpha1 的能力 ID：

- project.manifest.read
- command.progress.report
- command.blocker.raise
- command.completion.declare
- event.normalized.read
- document.progress.render
- project.lifecycle.register_legacy
- project.lifecycle.register_managed
- project.lifecycle.create_from_template
- project.lifecycle.rebind_location
- project.lifecycle.upgrade_managed
- project.lifecycle.event.read

外部应用只能调用 enabledCapabilities。Host 只能选择自己实际实现的 capability；Gate 2B 没有文件同步器时不得启用 `project.lifecycle.create_from_template` 或 `project.lifecycle.upgrade_managed`。没有共同线版本时不得写入；Host 可以提供不带业务内容的只读兼容提示。握手不能用于协商绕过 Schema、revision、安全审核或路径限制。

## 12. 兼容规则

1. v1alpha1 只保证精确版本兼容，不进行“看起来相近”的宽松解析。
2. 所有对象默认 additionalProperties 为 false；只有名为 extensions 的对象允许命名空间键。
3. extension 键必须采用反向域名式名称。接收方可以保存并忽略未知 extension，但 extension 不得改变核心状态、权限或审核结论。
4. 未知 kind、eventType、category 或 rendererVersion 必须拒绝或隔离。
5. 新增核心字段、命令类型或事件类型需要新协议版本和新的能力握手结果。
6. 新版本读取旧数据必须通过显式迁移或适配器，不能就地篡改旧事件。
7. 数据库迁移版本、应用版本和协议版本彼此独立，不能用应用版本推断线兼容。
8. read_only 只允许查询与导出，不能提交命令或写项目文件。

## 13. 安全边界

- Token、API Key、Cookie、Webhook secret、SSH/云凭据不得出现在 manifest、Command、Event、Markdown、extensions 或 Quarantine 明文。
- extensions 不是秘密存储，也不是逃避严格 Schema 的通道。
- workspaceRef 必须由 Host 解析；Client 提供的字符串不能直接变成任意文件系统路径。
- 所有相对路径都要在真实路径解析后再次验证仍位于已登记 workspace 内。
- 外部发送、发布、删除、付费与正式批准继续需要独立权限和人工审核；本协议中的 completion.declare 不能授权这些动作。

## 14. 机器可验证资产

Gate 2A 的四份 JSON Schema 与 Gate 2B 的三份 lifecycle JSON Schema 均使用 JSON Schema 2020-12：

- protocol/project-control/v1alpha1/schemas/project-manifest.schema.json
- protocol/project-control/v1alpha1/schemas/command-envelope.schema.json
- protocol/project-control/v1alpha1/schemas/normalized-event.schema.json
- protocol/project-control/v1alpha1/schemas/progress-update-frontmatter.schema.json
- protocol/project-control/v1alpha1/lifecycle/schemas/lifecycle-command-envelope.schema.json
- protocol/project-control/v1alpha1/lifecycle/schemas/lifecycle-command-result.schema.json
- protocol/project-control/v1alpha1/lifecycle/schemas/lifecycle-normalized-event.schema.json

`protocol/project-control/v1alpha1/examples/index.json` 与 `protocol/project-control/v1alpha1/lifecycle/examples/index.json` 分别列出每个 valid/invalid fixture、预期结果和预期错误关键字。index 只是测试目录，不是协议 payload，也不应通过业务 Schema 传输。验证器必须启用 JSON Schema 2020-12 的 format assertion；Ajv 实现必须加载 ajv-formats，避免把不存在的日期当作有效时间。

Gate 2B 的数据库、迁移与 Command Host 必须以这些资产为输入；HTTP/IPC 层必须调用同一个严格 validator，不得复制一份较宽松的手写字段检查。若实现需要改变已冻结字段或语义，应先发布新协议版本，而不是只改运行时代码。
