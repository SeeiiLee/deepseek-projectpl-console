# DeepSeek Harness Personal 提示词、AGENTS 与规则治理设计建议

> 文档状态：历史设计与现状依据；Personal System Policy、Dev Global AGENTS 投影脚本和部分机器门禁已有实现证据，但跨 Harness 统一规范源、Project Home 三分区、全 profile 覆盖与统一记忆/Skill 投影尚未完成。2026-08-25 之后的目录与跨端权威边界见 ADR-009 和 `docs/governance/统一项目目录与三分区治理合同.md`。
> 编写日期：2026-08-15
> 适用范围：`D:\Deepseek Harness Personal` 及由 Personal 统一启动、监督的 DeepSeek Harness 会话
> 本文目的：明确哪些规则进入 System、Runtime Snapshot、Global/Project/Nested AGENTS、详细文档和机器门禁，并在可靠性、上下文成本与可维护性之间取得平衡。

---

## 1. 结论摘要

推荐采用“短 System 总纲 + 短 AGENTS 路由 + 按需详细文档 + 动态 Runtime Snapshot + 机器门禁”的组合，而不是把所有规则集中到一个文件或一个提示词层。

核心决定建议如下：

1. **不修改上游 Harness 源码，不关闭或替换 Harness identity，不主动覆盖 deployment persona。**
2. **通过 Personal 的正规插件扩展点，新增一段极短的全局 System Policy。**它负责跨项目、不可协商、每次请求都必须在场的行为红线。
3. **Runtime Snapshot 只承载当前机器、部署、会话与安全状态。**永久人类规则不放入 Snapshot。
4. **`$DSH_HOME/AGENTS.md` 承载跨项目稳定流程和规则路由；项目根及嵌套 AGENTS 承载项目/子树特有规则。**
5. **复杂规则、解释、例外和事故案例保留在详细文档中，由 AGENTS 用明确触发条件定位到具体文档章节。**
6. **删除、覆盖、外发、付费、发布、受保护路径等真正危险的动作必须有代码级机器门禁。**提示词用于指导，机器门禁用于拒绝危险动作。
7. **不能把“AGENTS 只加载一次”理解成“只计费一次”或“几乎免费”。**AGENTS 会作为持久历史进入后续模型请求，直到压缩；详细文档被读取后同样会占用后续上下文。
8. **不要等到 AGENTS 遗忘红线后才升级 System。**如果一次违反就可能造成不可逆后果，应该从一开始就放入 System，并同时设置机器门禁。

一句话架构：

```text
Personal System Policy：跨项目不可协商红线
        ↓
Runtime Snapshot：当前机器与会话事实
        ↓
Global AGENTS：跨项目稳定流程与路由
        ↓
Project / Nested AGENTS：项目与子树规则
        ↓
按任务读取详细规则、架构、协议和事故记录
        ↓
Machine Gates：危险动作的最终硬拦截
```

注意：上图表示工作流关系，不表示 Runtime Snapshot 的指令权威高于 AGENTS。System、用户指令、AGENTS、动态事实和机器门禁需要分别讨论，不能仅用“第几层”表达全部语义。

---

## 2. 为什么必须采用组合方案

单独依赖任何一种载体都不够可靠：

| 单一方案 | 主要问题 |
|---|---|
| 所有内容都放 System | 每次请求都携带；规则过长会稀释重点；易把易变事实写死；维护和评审成本高 |
| 所有内容都放 AGENTS | 权威低于 System；加载受 `cwd`、项目根、预算和 profile 影响；仍会占上下文 |
| 所有内容都放 Runtime Snapshot | 语义错误；动态状态与永久规则混在一起；Snapshot 是 user-role 状态消息，不是安全边界 |
| 所有内容都放详细手册 | 模型未必会主动读取；整本读取浪费上下文；只给链接不会自动导入内容 |
| 只依赖提示词 | 模型可能误解、遗漏或遭遇冲突；无法保证危险工具调用一定被阻断 |
| 只依赖机器门禁 | 能拒绝部分危险动作，但无法完整指导分析、证据、汇报和架构判断 |

因此需要把内容按以下三个维度分类：

1. **权威要求**：违反一次是否可能产生不可逆后果？
2. **适用范围**：跨所有项目、仅 Personal、还是仅某个子树？
3. **变化频率**：长期稳定、偶尔变化、还是每次运行都可能变化？

分类结果决定规则应该进入哪里，而不是只看“哪个位置更省 token”。

---

## 3. 当前机制的已核验事实

以下结论基于 2026-08-15 对当前上游 `D:\Deepseek Harness` 的只读源码核验。实施前仍应针对当时的上游 revision 重新验证。

### 3.1 System Prompt 可以正规扩展

Harness 提供：

```ts
ctx.systemPrompt.section({ name, order, text, complete? })
```

当前机制要点：

- Harness identity 默认位于 `order: -100`。
- deployment persona 位于 `order: 0`。
- 工具指南通常使用 `order: 100–199`。
- 普通 section 按 `order` 升序拼接。
- 插件可以注册全局或 agent-scoped section。
- scoped 同名 section 可以遮蔽 global section。
- 同一层出现同名 section 会失败，而不是静默合并。
- `complete: true` section 会成为完整 System Prompt，排除其他普通 section。

主要证据：

- `D:\Deepseek Harness\packages\core\system-prompt\README.md:5-35`
- `D:\Deepseek Harness\packages\core\system-prompt\src\index.ts:337-406`
- `D:\Deepseek Harness\packages\core\system-prompt\src\index.ts:457-541`

因此，“上游只读”不等于“不能调整最终 System Prompt”。正确方式是 **Personal 插件注册自己的 section**，而不是修改上游文件。

### 3.2 System Section 每次模型请求都会携带

Agent Loop 在每个 step 都会重新 assemble 和 render System Prompt，并将其放入模型请求。

因此：

- System 文本是每次请求的输入成本之一。
- 内容完全稳定时，服务商可能复用 KV prefix cache，降低部分价格或延迟。
- KV cache 不等于不占上下文，也不能假定所有模型、部署和请求都一定命中缓存。
- System 应保持短、稳定、顺序稳定，避免把版本、插件数量、测试数量和运行状态写进去。

主要证据：

- `D:\Deepseek Harness\packages\core\agent-loop\src\agent.ts:225-242`
- `D:\Deepseek Harness\packages\core\agent-loop\src\agent.ts:332-345`
- `D:\Deepseek Harness\packages\core\agent-loop\src\agent.ts:458-493`
- `D:\Deepseek Harness\packages\core\system-prompt\README.md:63-69`

### 3.3 Runtime Snapshot 是“变化时追加”，不是“每轮无条件重写”

动态 context provider 会在每次 assembly 时求值，但只有渲染结果与当前保留快照不同时，才生成新的 user-role snapshot。

准确理解应是：

- provider 每轮计算当前状态；
- 状态没变，不追加新消息；
- 状态变化，追加一条新的持久消息并声明新状态取代旧状态；
- 旧消息可能仍在历史表面，直到压缩或投影处理；
- Snapshot 不是 System 权威层。

主要证据：

- `D:\Deepseek Harness\packages\core\system-prompt\src\index.ts:392-405`
- `D:\Deepseek Harness\packages\core\system-prompt\src\index.ts:521-528`
- `D:\Deepseek Harness\packages\core\agent-loop\src\runtime-context.ts:58-74`

所以永久规则放入 Snapshot 不是单纯“多烧一点 token”的问题，而是语义和权威层都不正确。

### 3.4 AGENTS 是持久 user-role 消息，不是 System 消息

AGENTS loader 会把 Global 和 Project instruction chain 渲染为带 `<system-reminder>` 外观的持久消息，但实际 role 是 `user`。

它的 framing 也明确说明：

- 更具体规则优先于更宽泛规则；
- AGENTS 不覆盖 System、Developer 或直接用户指令。

主要证据：

- `D:\Deepseek Harness\packages\context\agent-instructions\README.md:5-47`
- `D:\Deepseek Harness\packages\llm\llm\src\message.ts:187-198`
- `D:\Deepseek Harness\packages\context\agent-instructions\src\render.ts:228-242`

因此：

- AGENTS 很适合项目规则、工作流和文档路由；
- 对“无论用户怎么说都不能暴露密钥”一类红线，System 和机器门禁更可靠；
- 对“本次只做诊断，不实施修复”一类当前任务范围，直接用户指令仍然最具体。

### 3.5 “AGENTS 几乎免费”不成立

正确说法是：AGENTS baseline 通常只**追加**一次，但随后会留在 `session.deriveMessages()` 形成的完整可见历史中，并进入之后的模型请求，直到 compaction。

它的真实优势是：

- 不会每轮重复追加相同副本；
- 作为稳定历史前缀，可能有 KV cache 优势；
- 可按项目和目录选择性加载；
- 详细规则可以按需读取，而不是全部常驻。

它不意味着：

- 只发送一次；
- 只计算一次 input token；
- 不占上下文窗口；
- 可以无限增大而没有代价。

主要证据：

- `D:\Deepseek Harness\packages\context\agent-instructions\README.md:80-110`
- `D:\Deepseek Harness\packages\core\session\src\index.ts:701-746`
- `D:\Deepseek Harness\packages\core\agent-loop\src\agent.ts:332-345`

### 3.6 Project AGENTS 的加载范围有条件

默认逻辑向上寻找项目根 marker；当前默认 marker 是 `.git`。如果没有找到 marker，loader 返回 Session 当前 `cwd`，而不是自动认定某个更高层父目录为项目根。

随后只加载：

1. `$DSH_HOME/AGENTS.md`；
2. 已识别 project root 到当前 `cwd` 祖先链上的规则文件；
3. 成功的第一方结构化 `read`、`write`、`edit` 触达后发现的嵌套规则。

Shell 中执行 `cd` 不会可靠触发嵌套规则发现，规则文档中的普通链接或 `@path` 也不会被自动导入。

主要证据：

- `D:\Deepseek Harness\packages\context\agent-instructions\src\files.ts:168-212`
- `D:\Deepseek Harness\packages\context\agent-instructions\src\files.ts:267-308`
- `D:\Deepseek Harness\packages\context\agent-instructions\README.md:162-169`

2026-08-15 当前检查结果：

- `D:\Deepseek Harness Personal\.git` 不存在；
- `D:\Deepseek Harness Personal\.dsh-project` 不存在；
- `D:\Deepseek Harness Personal\AGENTS.md` 不存在。

因此，即使将来建立 Personal 根 AGENTS，也不能在未处理项目根发现问题时宣称它会覆盖所有 Personal Session。

### 3.7 Complete Prompt 会排除普通 Personal Section

当前 minimal preset 使用：

```yaml
complete: true
includeRuntimeContext: false
```

这意味着它会排除 Harness identity、工具说明、Personal 普通 System Section 和 Runtime Snapshot。

证据：

- `D:\Deepseek Harness\apps\cli\config\agent-presets\minimal\agent.cordis.yml:1-13`

所以 Personal System Policy 只能在“确认加载了该 section 的 profile”中发挥作用。实施时必须建立 profile 覆盖测试，不能仅测试 standard profile 后就声称“所有 agent 都受保护”。

---

## 4. 两条必须分开的优先链

### 4.1 行为指令权威链

推荐按以下语义处理：

```text
平台/System/Developer 约束
        ↓
Personal System Policy
        ↓
当前用户对本任务的明确指令
        ↓
更具体的 Nested AGENTS
        ↓
Project AGENTS
        ↓
Global AGENTS
        ↓
详细文档中的解释性建议
```

说明：

- Personal System Policy 是最终 System Prompt 的一部分，与其他 System section 同属 System role；`order` 只决定文本顺序，不创造更高权限。
- AGENTS loader 明确规定直接用户指令优先于 AGENTS。
- 更具体 AGENTS 可以细化更宽泛 AGENTS，但不能降低 System 红线。
- 详细文档只有在被实际读取后才进入上下文；路径或链接本身不是自动加载指令。

### 4.2 事实可信度链

事实可信度不应照搬行为指令链。推荐顺序：

```text
当前源码、Schema、数据库结构、运行探针、制品和机器 Gate
        ↓
机器生成且未过期的 Runtime Snapshot
        ↓
当前状态文档：NEXT / BLOCKED / compat / PROGRESS
        ↓
DEVLOG、事故记录和历史报告
        ↓
模型记忆或口头回忆
```

规则文档可以规定“去哪里确认事实”，但不能用一句旧规则覆盖当前源码和机器证据。

---

## 5. Personal System Policy 设计

### 5.1 应该进入 System 的判断标准

一条规则只有同时满足以下大部分条件，才应进入 System：

- 对几乎所有项目和任务都成立；
- 长期稳定，不依赖当前版本或目录结构；
- 忘记一次可能造成不可逆损失、隐私泄漏、付费或外部影响；
- 需要高于 AGENTS 的权威；
- 可以压缩成短句，不需要大量背景解释；
- 不适合完全交给某个项目自己的规则决定。

### 5.2 推荐纳入的主题

建议 System 仅覆盖：

1. 任务授权边界；
2. 破坏性、不可逆、外部和付费动作；
3. 凭据、隐私和敏感数据；
4. 事实、推断、提案和完成声明的区分；
5. 当前适用规则、受保护范围和冲突处理；
6. 禁止绕过机器门禁；
7. 失败时显式报告，不静默降级；
8. 未授权时维持只读或最小可逆状态。

### 5.3 不应进入 System 的内容

以下内容不应写入 System：

- `D:\Deepseek Harness` 等具体路径；
- 当前插件数量、测试数量、Schema 版本；
- 当前 milestone、Gate、blocker；
- pnpm、tsc、smoke 的完整命令；
- 某个模块的详细架构；
- 完整事故表和排障步骤；
- 临时“本轮只做什么”的用户要求；
- 可以由 Runtime Snapshot 自动提供的状态；
- 只对某个目录或插件成立的规则。

### 5.4 推荐候选文本

以下只是拟议文本，实施前应由 Cyrus 逐条确认：

```text
你必须遵守以下跨项目工作红线：

1. 审计、评审、解释和诊断请求默认为只读，不自动授权实施修改。
2. 删除、覆盖、不可逆变更、系统配置、安装、提交、推送、发布、外发、付费调用和真实数据写入，必须在当前任务中获得明确授权。
3. 不得输出或外泄凭据、密钥、令牌、原始个人数据及其他敏感信息。
4. 明确区分已验证事实、合理推断、待决定方案和未知状态；没有可复现证据，不得声称完成。
5. 开工前识别当前适用的项目规则与受保护范围；规则缺失、互相冲突或安全状态不明时，停止危险动作并显式报告。
6. 不得绕过、削弱或静默跳过权限、安全、隐私、发布和数据完整性门禁。
7. 失败必须显式呈现；不得用静默降级、伪造成功或过时文档掩盖实际状态。
8. 在满足目标的前提下，优先采用范围最小、可验证、可回滚且不污染无关区域的方案。
```

### 5.5 注册建议

建议采用：

- 唯一名称：`personal:cross-project-policy`；
- 独立且记录在案的 order，例如 `-50`；
- 普通 section，不使用 `complete: true`；
- 不使用 `deployment:persona` 等上游名称；
- 不通过 scoped 同名 section 覆盖；
- 文本使用版本号或内容哈希供诊断，但版本号不要渲染进模型正文；
- System Policy 的任何修改都需要独立 diff、审阅、测试和回滚点。

`order: -50` 只表示它位于 identity `-100` 与 persona `0` 之间，不代表它比 persona 更高权威。更重要的是确保所有 section 之间不存在矛盾，并验证最终实际送出的 prompt。

### 5.6 覆盖范围要求

“全局”必须被明确定义：

- 是仅覆盖 Personal Desktop 启动的 standard agent？
- 还是覆盖 code、cordis 和子代理？
- 是否允许 minimal/complete prompt？
- 是否覆盖直接运行的上游 `dsh web`？
- stable、dev、test 是否都加载 Personal 插件？

只有实际加载 Personal 插件并通过最终 prompt 检查的会话，才能声称受到该 System Policy 约束。

---

## 6. Runtime Snapshot 设计

### 6.1 适合放入 Snapshot 的内容

Runtime Snapshot 应包含可由机器产生、会随部署或会话变化的事实，例如：

- 当前时间和 `generatedAt`；
- 当前 app/profile/agent 类型；
- 当前 session `cwd` 和已解析 project root；
- 当前 `DSH_HOME`、userData、workspaceRoot；
- 当前 sandbox、approval、network 状态；
- 当前允许和禁止的能力；
- 当前受保护根目录列表；
- 当前上游 source root 与 revision；
- 当前 stable/dev/test 环境标识；
- 当前运行实例的 PID、端口和所有者信息；
- 当前 schema/version/compat 状态；
- 最近一次 Gate 结果及其时间；
- Snapshot 过期时间或 freshness 状态。

### 6.2 推荐结构

推荐机器生成结构化数据，再渲染成简短文本：

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-08-15T00:00:00+08:00",
  "expiresAt": "2026-08-15T00:10:00+08:00",
  "profile": "standard",
  "workspaceRoot": "...",
  "projectRoot": "...",
  "dshHome": "...",
  "userData": "...",
  "protectedRoots": ["..."],
  "approvalMode": "...",
  "sandboxMode": "...",
  "networkAccess": "...",
  "sourceRevision": "...",
  "gateSummary": {
    "status": "pass|fail|stale|unknown",
    "evidence": ["..."]
  }
}
```

字段值应来自机器探针，不得手工维护。

### 6.3 Snapshot 的失效处理

- Snapshot 过期时标记为 `stale`，不能继续当作当前事实。
- 缺失关键字段时使用 `unknown`，不得从历史文档猜测补齐。
- 受保护路径或 approval 状态未知时，危险动作默认拒绝。
- 新 Snapshot 必须明确取代旧 Snapshot。
- Runtime Snapshot 只能提供事实，不能因为其中出现 `allowed: true` 就越过当前用户授权。

最后一点非常重要：**机器状态可以限制能力，不能反向授予权限。**

---

## 7. Global AGENTS 设计

### 7.1 作用范围

`$DSH_HOME/AGENTS.md` 适合承载所有项目都适用、但不必进入 System 的稳定工作方法：

- 沟通和交付格式；
- 事实与建议的区分；
- 验证和证据要求；
- 只读审计与实施任务的边界；
- 规则文件的读取与路由方法；
- 当前项目文件优先于历史记忆；
- 失败、阻塞和未知状态的报告方法；
- 经验如何沉淀和升级。

### 7.2 不应放入 Global AGENTS 的内容

- NutriSight、DeepSeek Harness Personal 等单项目专属规则；
- 某个数据库表、插件协议或发布路径；
- 当前插件数量、里程碑、测试统计；
- 某个项目的上游只读路径；
- 完整长手册；
- 临时任务状态。

### 7.3 多个 DSH_HOME 的治理

如果 stable、dev、test 使用不同 `DSH_HOME`，每个 home 都有自己独立的 Global AGENTS 表面。不得为了共享规则而合并这些 home，破坏环境隔离。

推荐方式：

1. 在 Personal 仓库保留一个规范源；
2. 通过受控脚本投影到各个允许的 `DSH_HOME/AGENTS.md`；
3. 投影前确认目标 home；
4. 使用内容哈希验证一致性；
5. 写入前遵守覆盖和系统配置审批；
6. 不允许每个 home 手工维护并逐渐漂移。

这只是未来实施建议；本文本身不授权创建或覆盖任何 `$DSH_HOME/AGENTS.md`。

---

## 8. Project Root AGENTS 设计

### 8.1 它应该是路由器，不是百科全书

项目根 AGENTS 的职责是让 agent 在几十秒内知道：

- 这是哪个项目；
- 哪些目录可写、哪些只读；
- 当前事实去哪里查；
- 开工必须做什么；
- 常用验证命令是什么；
- 遇到某类任务时必须读取哪份详细文档；
- 哪些情况必须停下来请求 Cyrus 决定。

### 8.2 推荐结构

```markdown
# Scope

本文件适用于……

## Authority and truth sources

- 当前事实源……
- 历史文档用途……

## Non-negotiable project rules

- 上游只读……
- stable/dev/test 隔离……
- 禁止按名称批量杀进程……

## Start-of-work checklist

1. 确认 cwd、项目根和适用 AGENTS。
2. 确认当前任务是审计、诊断、设计还是实施。
3. 读取当前状态文件。
4. 根据路由表读取所需详细章节。

## Task routing

| 触发条件 | 执行前必须读取 | Stop gate |
|---|---|---|
| 安装/升级/迁移 | docs/...#... | 未确认目标实例不得继续 |
| Electron 生命周期 | docs/...#... | 未确认 PID/端口所有权不得清理 |
| Project Control | docs/...#... | 未确认单写者协议不得写数据库 |
| 打包/发布 | docs/...#... | preflight 未通过不得发布 |

## Stable commands

- 安装……
- 静态检查……
- 单元测试……
- smoke……

## Completion evidence

- 测试输出……
- 产物路径……
- 偏差与未验证项……
```

### 8.3 路由规则的写法

不推荐：

```text
必要时阅读经验.md。
```

推荐：

```text
当任务涉及进程退出、端口残留、迁移或覆盖运行中实例时，规划或执行前必须读取
docs/WORKING_RULES_AND_PITFALLS.md 中“进程生命周期”和“迁移/覆盖”章节；
如果无法确认目标 PID 属于当前实例，停止清理并报告。
```

一个合格路由必须包含：

1. 明确触发条件；
2. 精确文件路径；
3. 精确章节或 Markdown anchor；
4. 读取发生在规划/修改/执行之前；
5. 未满足时的停止条件。

### 8.4 Personal 根发现问题

在创建 `D:\Deepseek Harness Personal\AGENTS.md` 前，必须先决定并验证 project root 发现方案：

- 固定 Personal 会话 `cwd` 为仓库根；或
- 配置一个可靠且不会误认其他目录的 root marker；或
- 显式向 agent-instructions 传递 project root；或
- 让关键规则由 `$DSH_HOME/AGENTS.md` / Personal System Policy 覆盖。

只创建文件、不解决发现链，可能产生“规则文件存在但实际没有加载”的假安全感。

---

## 9. Nested AGENTS 设计

Nested AGENTS 只在某个子树拥有真正独特且稳定的规则时创建，例如：

- Project Control 数据库和单写者协议；
- release/staging/installer 目录；
- Electron 主进程和 shutdown 生命周期；
- 插件 SDK、跨插件 seam 与 schema；
- 数据导入、迁移或敏感数据目录。

不应为每个普通目录创建 AGENTS，否则会导致：

- 指令链难以理解；
- 同一规则被多处复制；
- 作用域冲突；
- 文件过多且易漂移；
- 触达目录时上下文突然膨胀。

每份 Nested AGENTS 只应写该子树相对根规则的增量，不重复根文件全文。

还要注意：当前 loader 主要依赖第一方结构化文件工具触达来发现新的嵌套作用域。仅在 shell 中 `cd` 或通过脚本间接改文件，不应被当作规则已自动加载的证据。

---

## 10. 详细规则文档设计

### 10.1 详细文档的职责

详细文档保存：

- 完整原理；
- 架构决策和取舍；
- 例外条件；
- 故障案例；
- 具体排障步骤；
- 长验证清单；
- 历史决策证据；
- 不适合常驻 prompt 的协议和 Schema 解释。

### 10.2 文档头部建议元数据

每份长期规则文档建议包含：

```yaml
project: deepseek-harness-personal
authority: normative | guidance | historical | generated
scope: project-control | release | electron | global
volatility: stable | changing | generated
loadWhen:
  - "涉及……"
sourceOfTruth: true | false
lastVerifiedAt: 2026-08-15
supersedes: []
```

不一定必须使用 YAML front matter，但这些语义必须清楚。

### 10.3 一个事实一个权威来源

例如“当前有多少插件”不应同时手写在 README、PROGRESS、compat、经验和架构设计中。推荐：

- 源码或生成清单是事实源；
- Runtime Snapshot 展示当前值；
- 文档写“从哪里读取”，不重复写死数值；
- 发布时机器检查文档或制品是否与事实源一致。

### 10.4 不要每次加载完整手册

“每次开工阅读第 1、2、4 节”仍可能让普通任务携带大量无关文本。更好的方式是：

- 普通开发：只读 Project AGENTS、NEXT/BLOCKED 和相关源码；
- 架构任务：再读架构设计和相关协议；
- 发布任务：再读发布规则和当前 Runtime Snapshot；
- 故障任务：按错误关键词检索经验和 postmortem；
- 上游工作：读取目标上游目录真实适用的 AGENTS，不在 Personal 手册复制上游全文。

---

## 11. Token 与上下文预算策略

### 11.1 正确的成本模型

| 内容 | 如何进入请求 | 成本特征 |
|---|---|---|
| System section | 每次 step 重新渲染并发送 | 每次请求占输入和上下文；稳定前缀可能缓存 |
| AGENTS baseline | 通常追加一次后留在历史 | 后续请求继续携带，直到 compaction |
| Runtime Snapshot | 变化时追加新消息 | 状态频繁变化会累积历史；应保持短小 |
| 详细文档读取结果 | 读取时进入工具结果/上下文 | 后续请求可能继续携带；只读相关章节 |
| 机器门禁 | 执行层判断 | 通常不需要把完整实现说明放进 prompt |

### 11.2 推荐预算原则

- System Policy：只保留 6–10 条短红线。
- Global AGENTS：尽量控制为短规则和路由，不放长解释。
- Project AGENTS：只放项目入口、稳定命令、路由和停止条件。
- Nested AGENTS：只放相对父级的增量规则。
- Runtime Snapshot：只显示决策所需字段，不输出整份环境变量或进程列表。
- 详细文档：不限制总长度，但必须可按章节、关键词和任务精确读取。

不要机械采用未经 tokenizer 实测的 token 数字作为硬门槛。当前 agent-instructions 使用的是字节预算，shipped preset 的 `maxBytes` 为 `65536`；字节数不等于模型 token 数。

### 11.3 必须测试 omission 和 truncation

Loader 超预算时可能先省略更宽泛文件，再截断最具体文件。因此需要模拟真实 loader，检查典型 `cwd` 下：

- Global AGENTS 是否被省略；
- Project AGENTS 是否被截断；
- 关键路由是否保留；
- Nested AGENTS 加入后总链是否超预算；
- 压缩后 baseline 是否正确恢复。

不能仅看单个 AGENTS 文件大小就判断最终上下文安全。

---

## 12. 机器门禁设计

### 12.1 原则

提示词的职责：

- 告诉 agent 应该怎么判断；
- 要求读取规则；
- 要求申请授权；
- 要求提供证据；
- 要求在冲突时停止。

机器门禁的职责：

- 在危险动作真正执行前复核；
- 不满足条件时拒绝；
- 产生可审计证据；
- 不因模型“自称已获授权”就自动放行。

机器门禁只能缩小权限，不能扩大权限。

### 12.2 推荐门禁

#### 文件系统与路径

- 保护上游和稳定版根目录；
- 禁止未授权覆盖、递归删除和跨根移动；
- 操作前解析绝对路径并验证仍在允许范围；
- symlink/reparse point 穿越保护；
- stable/dev/test 目录隔离。

#### 进程与生命周期

- 只操作由当前实例记录和验证的 PID；
- 不按宽泛进程名批量终止；
- 迁移、替换、打包覆盖前要求实例完成正式 shutdown；
- 关闭后验证 helper/Electron 无残留和端口释放；
- 兜底清理必须限时、定向、可审计。

#### 外部动作与成本

- commit、push、发布、邮件/消息发送、云端写入等外部动作二次确认；
- 付费 LLM、搜索、批处理和全流水线需要成本、调用量、缓存/重试和停止条件；
- 真实用户数据写入与测试数据严格区分。

#### 隐私与凭据

- secret scan；
- PII/敏感数据检查；
- 日志和报告自动脱敏；
- 禁止把完整环境变量、token、cookie、数据库原始敏感记录送入模型。

#### 构建与发布

- source revision、lockfile、构建结果、制品哈希一致性；
- Runtime Snapshot freshness；
- 文档和 compat 状态检查；
- 安装包、便携版及说明文件内容验证；
- 不允许用旧制品冒充新构建。

#### 规则治理

建议增加 `check:governance`，至少检查：

- AGENTS 是否存在于预期位置；
- 典型 cwd 能否实际加载正确规则链；
- 总链是否发生 omission/truncation；
- AGENTS 路由目标和 Markdown anchor 是否有效；
- 是否复制了上游规则或其他项目专属规则；
- 是否在稳定文档中写死易变插件数、测试数、Schema 和哈希；
- Runtime Snapshot 是否过期；
- System Policy 是否在允许的 profile 中真实出现；
- 是否存在 `complete: true` 绕过普通 section 的 profile。

---

## 13. 经验与踩坑的沉淀闭环

### 13.1 不建议无限追加一个必读经验文件

“每次踩坑都追加到经验.md”会产生：

- 重复事故；
- 旧根因与新实现冲突；
- 过时路径、数量和版本长期存在；
- 每次阅读成本越来越高；
- agent 难以区分当前规则与历史现象；
- 同一个教训在 AGENTS、经验、DEVLOG 和手册中多份漂移。

### 13.2 推荐事故记录字段

每个事故或坑点至少记录：

- 标题；
- 日期；
- 现象；
- 根因；
- 影响范围；
- 触发条件；
- 当时修复；
- 可复用稳定规则；
- 对应测试或机器 Gate；
- 验证证据；
- 最后核验日期；
- 状态：`active` / `superseded` / `archived`；
- 被哪条新规则或实现取代。

### 13.3 提升与降级流程

```text
DEVLOG / postmortem：保留原始事实和过程
        ↓
经验索引：提炼根因、触发条件和可复用结论
        ↓
高频且每次必须知道：提升到 Project / Global AGENTS
        ↓
跨项目、忘记一次不可接受：压缩后提升到 Personal System Policy
        ↓
可以机械判断：实现为测试或机器 Gate
        ↓
已失效：标记 superseded 并归档，不再进入默认阅读路径
```

### 13.4 经验不能直接升级为全局规则的情况

以下内容不能未经评审直接跨项目推广：

- 某个业务领域独有的隐私或数据模型细节；
- 某个仓库的目录、插件、版本和 milestone；
- 一次偶发环境错误；
- 未确认根因的 workaround；
- 只在旧版本成立的命令；
- 用户尚未决定的产品或架构偏好。

升级前必须回答：

1. 根因是否确认？
2. 是否仍在当前版本复现？
3. 适用范围是单模块、单项目还是跨项目？
4. 是行为原则、当前事实还是机器可检查条件？
5. 是否已有权威来源，避免重复？

---

## 14. 冲突处理规则

### 14.1 System 与 persona 冲突

- 不应依赖 section 顺序“赌模型听哪条”。
- 发现冲突时应修正文案或 persona，而不是增加更多重复强调。
- Personal Policy 不得注册为 `deployment:persona`，避免同名 shadow。

### 14.2 用户指令与 AGENTS 冲突

- 直接用户指令可以改变当前任务范围和普通工作偏好。
- 用户指令不能绕过更高层 System、安全策略和机器门禁。
- 如果用户明确授权一个通常需审批的动作，应记录精确授权对象、范围和时间，而不是泛化成永久授权。

### 14.3 AGENTS 之间冲突

- 更具体作用域优先于更宽泛作用域。
- Nested AGENTS 应细化父级，不应取消父级红线。
- 如果两个同级文件表达不一致，应停止并修复单源，而不是让模型自由选择。

### 14.4 文档与当前源码冲突

- 易变事实以当前源码、Schema、制品和机器探针为准。
- 规范性合同若与实现冲突，不能静默以实现覆盖合同；应报告“实现偏离规范”。
- 不得把“曾讨论过”写成“已实现”。
- 不得把旧测试数量、旧插件数量和旧哈希继续作为当前证据。

---

## 15. 推荐实施顺序

本文不执行以下步骤，只给出未来实施顺序。

### 阶段 A：确认范围和权威

1. Cyrus 逐条确认 System Policy 候选红线。
2. 定义“全局”具体覆盖哪些入口、profile、子代理和 DSH_HOME。
3. 确认哪些动作必须有机器门禁。
4. 将跨项目原则与 Personal/NutriSight 等项目专属内容彻底分开。

### 阶段 B：解决加载基础

1. 决定 Personal project root 发现方式。
2. 确认 stable/dev/test 的 `DSH_HOME` 分布。
3. 设计 Global AGENTS 的单一规范源和投影方式。
4. 建立 effective instruction chain 诊断输出。

### 阶段 C：建立最小规则层

1. 注册短 Personal System Policy。
2. 创建短 Global AGENTS。
3. 创建 Personal Project AGENTS。
4. 只有确有独特规则的子树才创建 Nested AGENTS。
5. 所有 AGENTS 使用触发式详细文档路由。

### 阶段 D：整理详细文档

1. 给规则文档标注 scope、authority、volatility 和 loadWhen。
2. 删除跨项目污染和上游 AGENTS 全文复制。
3. 易变数字改为从事实源读取。
4. 将经验改成索引、postmortem 和 active/superseded/archive 生命周期。

### 阶段 E：补机器门禁

1. 路径和受保护根门禁。
2. PID 和生命周期门禁。
3. 外部、付费、发布和真实数据写入审批门禁。
4. secret/PII 门禁。
5. governance、snapshot freshness 和制品一致性门禁。

### 阶段 F：验证与上线

1. 在隔离的临时 `DSH_HOME` 和工作区中验证。
2. 检查 standard、code、cordis、允许的子代理和其他 profile。
3. 明确处理 minimal/complete prompt。
4. 用不同 cwd 验证 Global/Project/Nested AGENTS 的实际加载链。
5. 验证 compaction 后规则恢复。
6. 验证 AGENTS 变更、删除、超预算和截断行为。
7. 对危险动作做失败注入，确认机器门禁真正拒绝。
8. 完成真人聊天、真实任务和真实关闭检查。
9. 记录验证证据、偏差和未覆盖项。

---

## 16. 验收矩阵

未来实施完成后，至少应满足以下验收条件：

| 验收项 | 通过条件 |
|---|---|
| System Policy 注入 | 最终实际模型请求中包含唯一、完整、顺序稳定的 Personal section |
| Profile 覆盖 | 每个允许 profile 都有明确 PASS；被排除的 profile 明确禁止或记录例外 |
| Complete prompt | 不允许静默绕过 Personal Policy；启动或测试阶段能检测 |
| Global AGENTS | 每个目标 DSH_HOME 内容一致且哈希可验证 |
| Project root | 从根目录和典型子目录启动都能加载预期根规则 |
| Nested AGENTS | 触达目标子树时加载；未触达时不无谓进入上下文 |
| Token/字节预算 | 典型链无意外 omission/truncation，预算诊断可见 |
| Runtime Snapshot | 来源可追溯、变化时更新、过期时 fail closed |
| 详细文档路由 | 每个路由的路径和 anchor 有效，触发条件可测试 |
| 删除/覆盖 | 未授权操作被机器拒绝 |
| 外部/付费动作 | 未授权 commit/push/publish/send/paid call 被拒绝 |
| 路径保护 | 上游、稳定版和真实用户数据根不能被测试或普通任务污染 |
| 进程管理 | 只对当前实例已验证 PID 操作，不按名称误杀 |
| 隐私 | 凭据和原始敏感数据不会进入模型、日志或制品 |
| 完成声明 | 没有测试或产物证据时，agent 不得报告完成 |
| 经验闭环 | 新事故有根因、范围、测试/Gate 和生命周期状态 |

---

## 17. 已知陷阱清单

1. **把“不改上游”误解成“不能扩展 System Prompt”。**正规插件 section 可以改变最终 system 字段，而不修改上游文件。
2. **把 `order` 当成权限。**它只控制拼接顺序。
3. **把 AGENTS 的 `<system-reminder>` 外观当成 System role。**它实际是 user-role durable message。
4. **把“追加一次”当成“只计费一次”。**后续请求仍包含可见历史。
5. **把 KV cache 当成免费。**缓存不消除上下文占用，也不保证每次命中。
6. **只创建 Personal 根 AGENTS，不验证 project root。**当前没有 `.git` 时，子目录 cwd 可能漏掉根文件。
7. **认为文档链接会自动加载。**当前 loader 不解释普通链接或 `@path` import。
8. **认为 shell `cd` 会触发 Nested AGENTS。**当前发现主要依赖结构化文件工具触达。
9. **忽略 `complete: true`。**它可以排除其他全部 System section。
10. **把 Runtime Snapshot 写成人类规则。**状态和政策应分开。
11. **让 Snapshot 反向授权。**Snapshot 只能陈述状态，不能替代用户批准。
12. **AGENTS 复制完整手册。**会增加常驻成本并产生多源漂移。
13. **AGENTS 只写“必要时阅读”。**没有触发条件、精确章节和 stop gate，执行不可靠。
14. **每次踩坑都无限追加同一经验文件。**长期必然膨胀和过时。
15. **把其他项目经验直接提升成跨项目规则。**会造成领域污染和错误约束。
16. **在稳定规则中写死插件数、测试数、Schema、哈希。**这些应由源码或 Snapshot 提供。
17. **只靠提示词保护危险动作。**真正红线必须有机器门禁。
18. **机器 Gate 被当成授权。**Gate 通过只表示技术条件满足，不表示用户已经批准。
19. **只测试一个 profile 或 agent。**子代理、code、cordis、minimal 可能使用不同 composition。
20. **只看“文件存在”，不看最终 effective prompt。**必须检查模型实际收到的 System 和 instruction chain。

---

## 18. 最终推荐

建议最终采用以下稳定结构：

```text
Personal 插件
└─ personal:cross-project-policy
   └─ 6–10 条跨项目不可协商红线

规范源
└─ Global AGENTS
   ├─ 跨项目协作原则
   ├─ 证据与授权要求
   └─ 如何定位项目规则

D:\Deepseek Harness Personal\AGENTS.md
├─ Personal 项目边界
├─ 上游/稳定版/测试环境保护
├─ 稳定命令和验证阶梯
├─ 当前事实源
└─ 精确任务路由表

子树 AGENTS
└─ 仅保存该子树独有的增量规则

docs/
├─ 完整工作规则
├─ 架构与协议
├─ 发布和安装规范
├─ 经验索引
└─ DEVLOG / postmortem / 历史证据

Runtime Snapshot
└─ 当前机器、部署、路径、权限、版本和 Gate 状态

Machine Gates
└─ 文件、进程、隐私、成本、外部动作、构建和发布硬拦截
```

这套方案保留了用户提出的“短 AGENTS + 按需详细规则文档”的省上下文设计，同时补上两个关键缺口：

1. 用短 System Policy 保证跨项目红线拥有更可靠的权威和覆盖；
2. 用机器门禁保证不可逆风险不依赖模型是否记住提示词。

---

## 19. 本文边界（2026-08-25 状态修正）

本文最初是设计建议；当前仓库已有 `plugins/personal-policy`、`scripts/project-global-agents.js`、`docs/agent-instructions/global-AGENTS.md` 和 `scripts/check-governance.js`，Dev home 投影哈希也可核验。因此下列旧的“全部尚未实施”口径不再成立。仍未完成的是：

- Global AGENTS 从 DSH 单仓规范源迁到跨 Harness toolbox，并逐实例产生 projection receipt；
- Project Home `workspace/worktrees/local` 与新建项目模板的机器实现；
- Runtime Snapshot 的 Project Home、project_id、baseline 与 retention freshness 字段；
- standard/code/cordis/minimal/子代理等允许 profile 的最终 effective prompt 覆盖复核；
- memory-host 与 Skill 在 DSH Dev + Codex 的首个双端闭环；
- Stable 投影、项目迁移和任何真实数据迁移（仍需单独授权）。

后续实施按 ADR-009 的 G0–G4 顺序推进；已有文件和脚本不能替代最终 effective prompt、错误路径反例、跨端 receipt 与真实迁移验收。
