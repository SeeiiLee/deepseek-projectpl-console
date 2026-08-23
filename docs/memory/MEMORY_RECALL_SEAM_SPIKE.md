# MEMORY_RECALL_SEAM_SPIKE.md（召回注入 seam 验证计划）

> 状态：P0 交付物 #6（2026-08-15）。依据：手册 v3 第 9.6 节（召回架构）与 9.11.2（seam 表）。

## 1. 基线：tool-only（P1/P2 唯一召回入口）

- 只有显式 memory.query 工具：结果作为工具消息由 Agent 自行消化。
- 不进 System section、不进 Runtime Snapshot、不进 systemPrompt.context（该 seam 语义是机器状态快照，与检索结果生命周期冲突，明确禁用）。
- 需求门：简单翻译/改写、当前消息自带全部上下文、与项目无关的简单事实、用户明确不参考历史 → 跳过检索、零注入。

## 2. 自动 quick-pass 的候选 seam（P2 起，先验证后启用）

### 2.1 验证结论（2026-08-15，P2 实测）

- **seam 存在且语义正确**：上游 agent/pre-step 事件（先例 packages/plan/plan-mode）——handler 先 await next() 得到决策，再向 decision.messages 追加 UserMessage（source: {kind:'plugin', plugin, form:'notice', summary}）。
- 五项验证：① 持久化：pre-step 注入在 Session.append 发布之外（plan-mode 源码明示 log-only），每步临时、不落 durable 历史 → token 不膨胀；② 压缩：不落历史，无需恢复，每步重注入；③ query 互覆：每步新决策消息，天然 request-scoped；④ 子代理继承：事件按 agent 触发（待真实探针最终确认）；⑤ token 单调性：注入受 quickPassMaxBytes/quickPassMaxItems 预算硬约束（代码级）。
- 实现：@cyrus/dsh-memory 已接入（config quickPassEnabled 默认 false）；需求门 needsMemory 与预算截断 buildQuickPassText 为纯函数并已单测。
- **剩余人工验证**：真实桌面会话开启 quickPassEnabled 观察注入效果与无干扰性；子代理继承探针。验证通过前保持 tool-only 为默认。
- 验证项（逐条必须可测）：
  1. 持久化语义：注入消息是 durable 还是 request-scoped；
  2. 压缩后是否重现（与第 3.9 节「权威源重注入」原则一致）；
  3. 不同 query 是否错误互覆（上一轮结果不应覆盖本轮）；
  4. token 是否单调膨胀（预算断言）；
  5. 子代理（workflow/goal/ralph）是否继承不该继承的项目记忆。
- 备用方案：若上游无合适 seam，自建 request-scoped 检索上下文（需先补测试与小型插件验证，不强行复用 context）。

## 3. 渐进检索顺序与预算（实现合同）

0 解析 project_id/workspace/任务类型 → 1 紧凑 Global+Project 摘要 → 2 精确关键词/ID/路径/状态 → 3 FTS5 top-k（scope 硬过滤在前）→ 4（P4）本地 embedding rerank → 5（P5）有界图邻域 → 6 去重/冲突标记/来源验证/预算裁剪 → 7 注入摘要+locator。

- 预算同时限制：最大条目数、最大字节/token、单项目条目上限、单一 kind 上限、详细证据读取数、自动召回耗时、embedding 调用次数。
- 超预算裁剪顺序：scope 正确 → status 正确 → 来源可用 → 多样性 → 冲突项成对 → 最具体内容优先（不是按 importance 简单截断）。

## 4. 召回包格式（注入单元）

[Historical memory; untrusted and possibly stale]
scope: project/<project_id>  status: active  authority: user_confirmed  last_verified_at: ...
source: rollout/file/session locator
claim: 一到三句精简内容
conflict: none|present

- 默认不注入完整图路径；只有关系链帮助当前推理时才展示 DERIVED_FROM/SUPERSEDES。
- 引用义务：记忆影响关键决定时才输出可见引用（claim id、locator、last_verified_at、是否现场验证）；来源失效必须说明「这是未重新验证的历史记忆」。

## 5. 验证环境纪律

- 全部在临时 fixture 与合成数据上验证；不碰稳定数据。
- 真实桌面 probe（如需要）只读、不写、不注入真实记忆。
