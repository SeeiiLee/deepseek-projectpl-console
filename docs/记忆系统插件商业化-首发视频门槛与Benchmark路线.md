# 记忆系统插件商业化：首发视频门槛与 Benchmark 路线

> 日期：2026-08-18
> 状态：2026-08-18 竞争格局与 P5 统一架构同步版；产品门槛建议，具体发布/收费仍待 Cyrus 单独批准
> 目的：确定什么时候可以发布第一支阶段成果视频、下一阶段展示什么，以及插件真正进入收费交付前还缺什么
> 非范围：本文不写视频脚本、分镜、标题、平台投放或价格数字，也不授权发布、收费、上传用户记忆或调用付费 benchmark。

P5 产品能力与阶段以[P5 记忆智能层统一架构](./P5-记忆智能层统一架构.md)为准；召回消融与规模门见[P5-R0/R1 检索子方案](./P5-检索状态比较评测与召回架构升级方案.md)；分发合同继续以[D0 分发地基实施计划](./D0-分发地基-实施计划.md)和[工作台/项目控制台联动架构](./工作台-项目控制台-联动架构设计书.md)为准。

## 0. 核心决策

**不建议现在就把 v0.3.0 当作商业插件成品发布视频；也不建议等完整 P5/P6/P7 全部开发完才出现。**

第一支公开视频应卡在一个清晰的中间里程碑：

> **V1「可信跨会话记忆闭环」：陌生用户能在干净 DSH 中安装插件；用真实项目完成“产生候选 → 用户确认 → 关闭会话 → 新会话在正确项目召回当前版本 → 展示来源与为什么召回 → 可删除/备份恢复”的闭环。**

这个阶段已经足够形成 hook，因为它证明的不是“有个向量数据库”，而是 AI 真能带着**项目边界、来源、版本和用户控制**跨会话继续工作。

视频末尾可以预告的下一阶段是：

> **V2「会治理、会选择上下文、会沉淀流程的经验记忆」：Context Compiler 判断该带什么，Curator/Doctor 处理重复、过期、冲突和时效，Procedure Builder 从多次成功任务提出可复用流程，Outcome 证明它是否真正少走弯路；Reflection/Graph 只有评测通过才作为增强。**

V1 是“可信记住并找回”，V2 才是“从经验中学习”。两者不要混在一个版本承诺里。

## 1. 当前进度判断

### 已经具备

- v0.3.0 已正式发布，P4 本地 bge-m3 embedding + FTS5 + RRF Hybrid 已开启；
- SQLCipher 分片、项目身份、scope 硬过滤、candidate→active 治理、来源证据、备份/恢复/迁移等可信地基已经存在；
- P3-2 已可在轮末后台提取候选，失败不打断会话；
- P6-0C Codex 历史导入器和 173 次调用/329 candidates 的真实试点已经完成；20 条随机盲审支持提取质量 GO；
- D0 已用 AnySearch 和 Shell+Workbench 证明 `.tgz`、标准 bundle、干净 Profile 安装/启动/移除方向可行。

### 尚不能作为客户承诺

- `@cyrus/dsh-memory` 当前仍是 `private: true`，没有独立 LICENSE/README/bundle patch，且运行时仍借相邻 `personal-foundation`；
- Embedding、ONNX runtime、SQLCipher 的 OS/arch/Node ABI、模型下载、离线安装与升级矩阵尚未形成独立商品合同；
- P6-2 全量导入与 v0.3.1 的 factual_at v5/backfill 尚未完成；
- Workbench/Project Control 的客户可见记忆审阅、来源、版本和召回解释体验还在建设；
- 当前向量召回最多 brute-force 最近 512 条 active 向量，尚不能支持“几万条中稳定找 1–2 条”的规模宣传；
- Curator、潜在线索/有界再检索、Procedure 自动构建和 outcome reward 尚是架构提案，不是已上线能力；
- 没有可公开复现的系统 benchmark，也没有陌生机器/陌生用户安装成功证据。

因此现在可以做**内部开发纪录**，但不宜以“可购买插件”定位公开。最危险的不是功能少，而是观众被吸引后拿不到可安装、可解释、可恢复的同一套东西。

## 2. 竞争格局：通用记忆引擎已经拥挤，DSH 必须卖“可信的 DSH 原生项目记忆”

[MemoraX Code](https://github.com/memorax-ai/memorax-code)公开证明了四客户端接入、npm 一条命令安装、自动检测、更新/卸载、后台 writeback、Viewer、云 API Key 和 Console；其[架构文档](https://github.com/memorax-ai/memorax-code/blob/main/ARCHITECTURE.md)把 Adapter、Backend、云 API、本地状态与制品组装拆得很清楚。

[Hindsight](https://github.com/vectorize-io/hindsight)公开了 Retain/Recall/Reflect、语义/BM25/图/时间并行召回、RRF + cross-encoder，以及 observation/mental model consolidation；它在通用记忆准确率和 Benchmark 叙事上是当前最强 challenger 之一。[Letta Code](https://github.com/letta-ai/letta-code)则把 Reflection、History Analyzer、Memory Defrag/Doctor、Recall 子代理和 Git-backed MemFS 变成可理解的 agent memory 产品结构。

| 竞争对象 | 公开强项 | DSH 应如何回应 |
|---|---|---|
| MemoraX | 跨客户端、安装更新卸载、后台 writeback、Procedure、产品链 | 补独立分包与客户生命周期；不与不可见云端算法做无证据强弱宣称 |
| Hindsight | 多路召回、rerank、consolidation/mental model、公开 benchmark | 作为检索 challenger；借鉴 trace/diff/full-delta，不把自动 observation 直接当当前事实 |
| Letta Code | 专职记忆 Agent、MemFS diff/commit、Doctor/Reflection、长程 agent UX | 借鉴四 Profile 和变更审计；SQLCipher 继续做 canonical，子代理上下文按需编译 |
| DSH | 本地加密、project_id 硬隔离、来源/时效/版本、候选治理、恢复迁移、DSH 工作台 | 聚焦“真实多项目 coding memory 的可信延续”，而不是再做一个通用聊天 memory API |

DSH 当前最有潜力的优势是本地加密、无需强制云、项目隔离、candidate 治理、证据/authority/factual_at/supersede 和恢复能力。MemoraX 当前公开可见的优势则是：**客户如何得到、装上、跨客户端使用、更新、卸载、查看和求助**已经是一条产品链。

所以“除了商业化，其他不比 MemoraX/Hindsight/Letta 差”不适合作为现阶段外部结论。更准确的内部判断是：

> DSH 的可信记忆内核和 DSH 原生项目治理具有差异化，某些 scope/时效/版本/恢复合同更严格；但规模召回、Curator/Procedure 上线、陌生用户分发和公共证据尚未证明同等成熟。商业化工程不是包装层，而是产品架构的一部分。

## 3. 三个里程碑，而不是一次“大发布”

### M0：当前 v0.3.0——内部技术预览

用途：开发进度记录、邀请少量设计伙伴看概念。不能开放收费。

可以真实表达：本地加密记忆、P4 Hybrid、候选治理、Codex 历史导入试点。不能表达：开箱即用商品、几万条稳定召回、自我进化、RL 训练、Procedure 自动形成。

### M1 / V1：可信跨会话记忆闭环——第一支公开视频门

以下六组必须全部通过，缺一组就只做内部视频：

#### A. 真正可安装

- Memory Core 有独立 package identity、版本、LICENSE/NOTICE、README、`dsh.bundle` 和 files 白名单；
- 去掉相邻 checkout 与 `personal-foundation/lib/index.js` 物理路径依赖；需要的配置/DB/Credential Ref 归 Core，项目联动进入 Bridge；
- Embedding 作为可选重型 addon 或明确随包矩阵，不让无 embedding 的用户连 Core 都装不上；
- 在无 Personal checkout 的干净 rc.7 Profile 完成 install → restart → doctor → update → uninstall（默认保留数据）→ reinstall（数据仍可读）；
- 制品有 SHA-256、SBOM、第三方许可和模型 manifest；普通客户不需要开发机 junction。

#### B. 客户看得懂

- Workbench/Project Control 至少提供 Memory Inbox、Current/History 时间线和 Recall Explain：能看到待审候选、active/archived、项目、来源、记录时间、factual_at、版本/supersede；
- 用户能确认、拒绝、暂停、删除/归档、导出/备份，不靠记住内部工具名；
- 召回结果能解释“来自哪个项目、哪个会话/文件、为什么匹配、是否为旧版”；
- 首次启动给出隐私边界、模型位置、空间占用和自动提取开关；无密钥/无模型时清晰降级，不静默失效。

#### C. 真实数据闭环

- 完成 v0.3.1 所需 factual_at v5/backfill 和 P6-2 全量会话处理；
- 食溯、亚马逊、量化三个项目都用稳定 project_id 注册；
- 从真实候选中确认一组**覆盖驱动**的公开视频安全记忆：至少覆盖决定、失败方案、回归检查、用户偏好、版本替换和跨项目同词；不为凑固定数量而确认低质量内容；
- 演示数据经过密钥、PII、商业敏感与本机路径审查；不能直接录制真实私密库。

#### D. 四个能被一眼看懂的能力证明

1. **跨会话**：A 会话形成/确认经验，关闭后 B 会话使用；
2. **低词面重合**：新问题不复述旧记忆原句，仍找对；
3. **版本正确**：问卷迭代十余版时，新版作为当前事实，旧版只在需要历史原因时出现；
4. **不乱记/不串库**：另一个项目的同名概念不被注入，无相关记忆时给 0 条。

这四项是效果合同，不是视频脚本。最终怎么拍由后续内容策划决定。

#### E. 稳定与安全证据

- cross-project leak=0；存在新版时旧版不得作为当前 active 事实注入；
- 快速召回 p95≤300ms，Embedding 本地路径与慢路径单独报告；
- 打包态、崩溃重启、模型缺失/损坏、索引损坏降级、加密恢复和整机迁移演练通过；
- 自动提取失败不影响真实对话；候选积压可见、可暂停、可批量治理；
- 公开包、source map、fixture、日志零密钥、零真实个人数据、零个人绝对路径。

#### F. 一份最小证据报告

- 使用《P5 检索状态比较评测与召回架构升级方案》的内部挑战集，至少先比较 FTS-only 与当前 Hybrid；
- 报 Hit@2、错误注入、旧版泄漏、跨项目泄漏、abstention、p50/p95、RAM 和失败案例；
- 冻结数据/hash、硬件和配置，可复跑；
- 不要求第一支视频先拿公共榜单第一，但必须有证据证明演示不是挑选一次幸运命中。

### M2 / V2：会治理、会选择上下文、会沉淀流程——第二阶段效果

M2 不是简单“记得更多”，而是能控制记忆质量和改变解决问题路径：

- Context Compiler 用 Kernel/Catalog/Task Pack/Deep Evidence 判断 system/记忆哪些该常驻、预载或按需展开，并记录每项进入原因和 token 成本；
- Recall Orchestrator 从 ID/Path、FTS、Dense、Temporal、Entity/Causal 多路召回，经 RRF/Evidence Reranker 最终只注入 0–2 条或 abstain；
- Memory Intelligence Engine 以 Online Curator、History Analyzer、Memory Doctor、Reflection/Procedure Builder 四个 Profile 处理重复、冲突、时效、来源、合并和过期；
- Admission Controller 只让低风险、同项目、可复核、无冲突且可撤销的内容由 Agent policy-auto 批准；决策、偏好、跨项目和 Procedure/Skill 保留人工确认；
- Observation 支持 full/delta、snapshot/watermark、current/candidate diff、来源历史和回滚；二阶总结默认 candidate；
- Procedure Builder 从多次/独立成功且有结果证据的经历提出 procedure candidate；
- 写入、召回、任务结果反馈先落 append-only ledger，证明 task success/少试错后才允许离线影响排序，不宣称在线 RL；
- Latent Cue、Reflection、Daydream 和 Graph 都是 R4 可选增强，不作为 M2 前半段的强制承诺。

M2 的用户界面还应新增 Curator Run/Doctor 报告、Before/After Memory Diff、自动审批策略与撤销、Procedure Candidate。公开证据应该从“它召回了某句话”升级为“它让 Agent 少试错、提前检查关键条件、复用了成功流程，而且没有把旧版或别的项目带进来”。

### M3：可收费 Beta——商业交付门

第一支视频可以在 M1 发布，但**开始收费**还要额外满足：

- 陌生用户/陌生机器设计伙伴安装成功，至少覆盖支持矩阵中的每一种 Windows 形态；
- 有试用、激活、离线宽限、退款/迁移和丢失许可证恢复政策；
- 更新器支持数据库前向迁移、兼容矩阵和回滚；旧客户端不得误写新 schema；
- 隐私政策、安全说明、数据目录、联网清单、删除/导出、崩溃日志和可选遥测写清楚；
- 有支持入口、诊断包（默认不含记忆正文）、已知问题和响应边界；
- 许可证、商标、上游 DSH 分发权、第三方代码、字体、模型权重和训练数据许可经过正式审查；
- 完成至少一轮小规模付费意愿验证，再确定价格，不在没有客户证据时拍脑袋定价。

## 4. 推荐的商品架构

不要把当前 17 个 Personal 插件整体打成一个不可拆的“超级包”。记忆产品建议分成五层：

| 包 | 责任 | 是否可独立 |
|---|---|---|
| Memory Core | SQLCipher、schema/migrations、FTS、治理、显式工具、备份恢复 | 必须；无 UI Bridge、无 embedding 也能工作 |
| Embedding Addon | ONNX runtime、模型 manifest/download/verify、generation/backfill、向量索引 | 可选重型包；损坏可降级 FTS |
| Project Bridge | Project Control 的稳定 project_id、项目切换、候选投影 | 可选；拔掉后仍可显式配置 project_id |
| Importer Pack | Codex/DSH/未来客户端历史解析、断点、去重、脱敏、候选入库 | 可选；与实时 Core 解耦 |
| Intelligence Pack | Context Compiler、Recall Orchestrator、四 Profile Curator、Admission、Observation、Procedure/Reflection/Outcome | M2 以后分层开放；每层独立 kill switch、diff、审计和 NO-GO |

Workbench 可以作为通用宿主，不应成为 Memory Core 的隐式硬依赖。客户购买的是一个产品 Preset，安装器展开所需包；运行时仍保持清晰依赖图和可移除边界。

## 5. 开源、许可与收费模式

### 5.1 当前必须拍板的许可问题

Memory 包目前 `private: true` 且无 LICENSE，AnySearch/Workbench PoC 则已使用 MIT。开始公开前必须选择，不得先发包再补：

1. **Open Core**：Memory Core 以宽松许可证公开，收费项是 Intelligence Pack、导入器/Workbench 高级体验、签名制品、更新和支持；
2. **商业闭源插件**：公开文档与 trial，正式包按商业 EULA 交付；要确保没有把不可重许可的上游/第三方代码直接封入；
3. **双许可证**：个人/开源场景一种许可，商业/团队场景另一种，治理和维护复杂度最高。

推荐先评估 **Open Core + 本地 Pro**：本地加密 Core 建立信任，付费 Pro 提供真正高维护成本和高效果的 UI、Importer、Embedding/模型管理、Curator/Procedure、更新与支持。MemoraX 自身的公开 Adapter 是 MIT、价值链连接云服务，说明“代码公开”与商业化并不冲突；但 DSH 没有强制云，付费边界必须更清楚。

不建议把“记忆条数限制”作为核心付费墙，它会诱导错误产品行为，也削弱本地隐私承诺。更合理的是按**自动化深度、连接器、智能治理、团队能力和持续更新**分层。

### 5.2 推荐首期收费形态

- Personal Pro：本地优先、BYOK、无需强制云；购买主版本并含一定期限更新/支持，或按年续更新；
- 免费试用：功能不造假，限制试用期或自动化次数，允许完整导出；
- Team/Cloud 后置：只有团队同步、权限、审计、共享 memory 和 SLA 真正存在后再做订阅，不能只把个人版改名。

价格数字应在 5–10 个设计伙伴完成安装、持续使用和付费意愿访谈后决定。本文件不替代税务、消费者条款或软件许可法律意见。

## 6. 插件对外介绍合同

### 一句话定位

> 一个面向 AI 编程的本地优先、可审计长期记忆插件：让 Agent 在正确项目中找回经过确认的决定、经验和工作方式，同时保留来源、版本与用户控制。

### 七个当前/近期能力支柱

1. 跨会话延续，而不是每次从零开始；
2. 项目级硬隔离，不把食溯经验误塞进量化软件；
3. 本地 SQLCipher 加密，embedding 可离线运行；
4. 自动提取先进入 candidate，用户决定什么成为长期事实；
5. FTS + 语义 Hybrid，后续扩展多线索有界召回；
6. 来源、authority、factual_at、supersede 区分“现在是什么”和“以前为什么那样”；
7. 备份、恢复、迁移、删除和可降级，让记忆不是不可控黑盒。

### M1 可以说 / 不能说

| 可以在证据通过后说 | M2 前不能说 |
|---|---|
| 本地加密、项目隔离、跨会话、候选确认、Hybrid、来源/版本、可恢复 | 像人脑一样联想、自我进化、RL 训练完成、自动形成可靠 skill、全平台通用、行业最佳 |
| 内部挑战集的具体指标和机器配置 | “几万条永不漏召回”“零幻觉”“比 MemoraX 更强” |

所有文案必须对应可复跑证据；未来路线要标“planned/实验中”，不能用未来能力抬高当前售价。

## 7. Benchmark 路线

### B0：先做 DSH Memory Challenge（M1 前）

内部集必须覆盖：词面明确、语义改写、无直接语义/隐含方向、旧版冲突、跨项目同词、无记忆 abstain，并横切代码/表格/图片 bundle。先比较：

- 无记忆；
- FTS-only；
- 当前 Hybrid；
- 后续 Context / Latent Cue / Iterative 各层消融。

主要公开指标：Supported Helpful Hit@2、错误注入、旧版泄漏、跨项目泄漏、abstention、task success、试错轮数、p50/p95、RAM、调用数/费用。

### B1：LongMemEval（M1 后、M2 前）

[LongMemEval](https://github.com/xiaowu0162/LongMemEval)有 500 道题，覆盖多会话推理、知识更新、时间推理和 abstention，最适合先检验 DSH 的 factual_at/supersede 和长期对话召回。需要写公开 adapter，并把“最终回答准确率”和“检索是否找对当前证据”分开。

### B2：BEAM 规模检索（修复 512 截断后）

[BEAM](https://arxiv.org/abs/2510.27246)面向 100K–10M 规模 agent memory 检索。DSH 路线固定为：

1. 先完成内部 1k/10k/50k/200k 干扰规模；
2. 修复最近 512 条向量截断后挑战 BEAM 100K；
3. 预过滤/ANN、索引一致性、RAM、加密与恢复稳定后挑战 500K/1M；
4. 10M 只作长期目标，不为营销提前堆随机文本。

Hindsight 是该路线的公开 challenger。其官方仓库/榜单给出的成绩必须标注为其特定协议与配置下的公开结果；DSH 只有在数据、answer model、prompt/token 预算、硬件和截止时间对齐后才能直接比较。

### B3：ScriptMem（关系层完成后）

[ScriptMem](https://github.com/memorax-ai/ScriptMem)有 457 道跨时间/事件/参与者题，适合检验事件关系与多跳；其原始剧本文本不随仓库分发，必须先确认数据获取和使用许可。不要因为它来自 MemoraX 团队就把其分数自动等同于 MemoraX Code 产品分数。

### B4：MemoryArena / LongMemEval-V2（Procedure/Outcome 完成后）

[MemoryArena](https://memoryarena.github.io/)和[LongMemEval-V2](https://github.com/xiaowu0162/LongMemEval-V2)更接近多 session agentic tasks 与 memory-action loop。它们适合证明“记忆改变任务行动和结果”，应作为 M2 的挑战，不是 M1 为赶营销提前适配的任务。

[LoCoMo](https://snap-research.github.io/locomo/)可补充超长对话与多模态测试，但不能作为 coding project memory 的唯一 headline benchmark。

### 公平挑战规则

- 同一数据、answer model、prompt、token 预算、硬件和截止时间；
- 冻结版本/hash，不对测试答案做专用规则或硬编码；
- 报全部题和失败案例，不只剪成功画面；
- 无记忆、full-context、FTS、Hybrid、升级版分别报告；
- 若与 MemoraX 直接对比，必须使用双方公开允许的安装方式、相同数据和隐私边界；云服务不可见部分明确标注，不猜内部算法；
- 报延迟、成本和注入 token，而不只报准确率；
- benchmark 数据不得混入正式用户记忆或 Procedure 训练材料。

## 8. M1 发布前的“证据包”

视频公开时，至少应有一处可下载/查看的静态证据包：

- 产品 README、支持矩阵、安装/升级/卸载/数据保留说明；
- 隐私与联网清单、安全边界、自动提取/遥测开关；
- LICENSE/EULA、NOTICE、SBOM、模型/权重许可与 hash；
- benchmark 方法、配置、结果、失败案例和复跑命令；
- Release Notes、已知问题、兼容矩阵与回滚路径；
- 一套完全脱敏的 demo fixture；
- 支持/诊断说明，诊断包默认不含记忆正文。

这组材料本身就是商业可信度的一部分，也能防止视频流量到来后所有问题都落到 Cyrus 私聊解释。

## 9. 给 DSH 的执行顺序

1. 继续 D0，但把 Memory Core + Embedding Addon 设为“重原生依赖标杆”，完成独立 bundle 和干净 Profile 全生命周期；
2. 完成 S0：factual_at v5/backfill、P6-2 全量处理、三项目真实治理；
3. 在 Workbench/Project Control 完成 Memory Inbox、Current/History、Recall Explain 和用户控制；
4. 修复最近 512 条向量截断，或冻结诚实的 M1 支持规模并完成 1k/10k/50k 阶梯测试；
5. 完成 DSH Memory Challenge v1，出 FTS-only vs Hybrid 证据报告；
6. 用本文 M1 六组门逐项验收；全部通过后，Cyrus 可以发布第一支公开视频；
7. 视频发布与产品收费分开：先收集设计伙伴，陌生安装和商业门通过后才进入 M3 付费 Beta；
8. M1 后按 P5-R0→R1→R2→R3→R4 推进：先 Context/确定性多路召回，再 Curator/Observation/Doctor，再 Procedure/Outcome，最后才是 Latent Cue/Reflection/Graph；依次挑战 LongMemEval、BEAM、ScriptMem、MemoryArena，而不是先堆无法证明收益的超级 Agent。

## 10. 最终判断

现在最值得追求的不是一句“我们比 MemoraX 强”，而是形成一个别人可以复现的事实：

> **DSH Memory 能在真实多项目、跨会话、版本反复变化的工作中，安全地记住少量值得记的东西，并在需要时只找回当前、正确、可追溯的 1–2 条；客户能自己安装、控制、恢复和移除。**

M1 把这件事证明清楚，就足以成为第一支视频的 hook；M2 再证明它能选择正确上下文、自动治理低风险记忆、从成功与失败中形成可复现流程，才是下一次真正的效果跃迁。Reflection 或 Graph 如果评测 NO-GO，不影响这一商业主线。
