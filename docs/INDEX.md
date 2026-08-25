# docs/ 权威索引（DOCS_INDEX）

> 治理制度见 architecture/D3（全局项目文档与文件治理体系）。本索引是 docs/ 的唯一入口：每份文档一行，标注状态与目标目录。
> 规则：一个主题只有一份权威文档；新文档按目标目录直接落位；旧文档原地惰性迁移（被修改或被取代时移入目标目录）；被取代文档只进 archive/ 或加横幅，**永不改名、永不删除**。
> 建立：2026-08-20（D3 落地第一步）。

## 状态图例

- **权威**：该主题唯一有效文档，据此开发
- **活跃**：正在使用的工作文档（交接/日志）
- **留档**：已被取代/已冻结，仅留档（含已加横幅）
- **待核实**：尚未逐条核实内容，状态暂定

## 架构（目标目录 architecture/）

| 文档 | 状态 | 说明 |
|---|---|---|
| architecture/D1-插件独立更新通道-架构设计.md | 已实现并由 A 线生产验收 | Harness / Personal / 插件三线升级；generation 原子激活、doctor、插件发布与客户端回退已落地；最终基线见 v0.4.5 与 plugins-v2026.08.24.2 证据 |
| architecture/D2-插件体系治理与用户侧设计.md | 权威 | 治理基建（ADR/权威文档/兼容矩阵/契约测试/上游观察/分级授权/发布总账）；开发四层门禁；用户侧仪表板与说明书 |
| architecture/D3-全局项目文档与文件治理体系.md | 权威 | 十二目录骨架、命名与生命周期、本索引的制度来源 |
| architecture/D4-记忆系统跨Harness复用方案.md | 权威（§0–§8）；§9 为历史理论证据 | 跨端定位、核心/外壳、竞争格局；2026-08-21 修正 T0 seam 与非 DSH 端身份；2026-08-23 起 §9 的类型硬入口/语义末级/全局 EMA 口径由 ADR-006 与 P5 v2 取代 |
| architecture/D5-统一工具层-跨Harness技能插件MCP-CLI共用架构.md | v4.1 权威输入 | 跨端工具/记忆/项目身份；产品/实例双层身份、surface resolver、项目缺省拒绝、retire receipt；Project Control 管任务/route policy/原子 claim，D5 只解析 capability/instance 并回 receipt |
| 架构设计.md | 待核实 | 早期总体架构，部分内容或已过时（D1 §8 已登记其 §9 第 5 条过时） |
| 工作台-项目控制台-联动架构设计书.md | 待核实 | 工作台↔控制台联动架构 |
| WORKBENCH_VIEWERS_ARCHITECTURE.md | 待核实 | 工作台查看器架构 |
| 原生工作区-项目联动-方案.md | 待核实 | 原生工作区联动方案 |

## 决策档案（adr/）

| 文档 | 状态 | 说明 |
|---|---|---|
| adr/ADR-001-记忆系统定位-跨端个人记忆基础设施.md | 生效 | 2026-08-20 拍板 |
| adr/ADR-002-记忆核心-外壳拆分.md | 预登记 | 终审 = P5/P6 收尾期 |
| adr/ADR-003-漏斗式召回管线与决策点留痕.md | 留档（Superseded） | 2026-08-23 被 ADR-006 完整取代；决策留痕与公共基准纪律由 ADR-006 重新采纳 |
| adr/ADR-004-project-control合同族扩展-治理语义与审批队列.md | **v4 已生效**（Cyrus 2026-08-22 拍板） | B 线合同扩展；窄例外、卡↔Decision 关联、effective_class 兜底、路由违规分档、extensions 治理与云端终局 |
| adr/ADR-005-测试版升级rc8与个人插件构建适配.md | 生效（补登记，待 Cyrus 复核） | 测试版 Harness 升 rc.8；build-kit/插件 peer 基线迁移；tsdown.client 本地 fallback 补丁；--no-open 适配 |
| adr/ADR-006-召回管线与学习边界.md | 生效 | 并行多臂、Evidence Set、VOI、归因与 P7/JitRL 边界；完整取代 ADR-003 |
| adr/ADR-007-关于用户的记忆-权威范围与召回合同.md | 生效 | 意图 revision、scope/sensitivity 正交、开放标签、图式与普通召回边界 |
| adr/ADR-008-个人数据捕捉保留与外发治理.md | 生效 | 情绪捕捉与长期晋升分离；Personal Reflection、Egress、删除与商业化治理 |
| adr/ADR-009-F盘统一项目根与三分区治理.md | 生效（Cyrus 2026-08-25） | `F:\Projects\<slug>\{workspace,worktrees,local}`；路径不作身份；Project Console 新建、迁移、Skill/记忆与生成物生命周期统一合同 |

## 规则/治理（目标目录 governance/）

| 文档 | 状态 | 说明 |
|---|---|---|
| PUBLISHING_RULES.md | 权威 | 发布红线门；模型哈希；商用剥离清单 |
| PROMPT_AND_AGENTS_GOVERNANCE.md | 权威 | 提示词/AGENTS/规则治理设计 |
| WORKING_RULES_AND_PITFALLS.md | 活跃 | 工作规则与坑清单（48K，持续追加） |
| WORK_RULES_AND_PITFALLS.md | 待核实 | 与上一份的关系待核实（疑似旧版） |
| PROJECT_PROTOCOL.md / PROJECT_INTAKE_SPEC.md / PROJECT_TEMPLATE_SPEC.md / PROJECT_CONTROL_SPEC.md / PROJECT_CONTROL_DATA_MODEL.md | 权威 | project-control 合同族（冻结条款以各文为准）；PROJECT_TEMPLATE_SPEC 已登记 G1 Project Home 兼容扩展 |
| `../protocol/project-control/v1alpha1/project-home/` | 机器合同 | `project-home/v1` marker Schema、8 个合法/非法 fixtures 与机器索引；Host 不接受任意 zone 路径 |
| codex-session-import-v1-合同.md | 留档 | Codex 历史导入合同 |
| governance/LLM项目治理说明书.md | 权威（v1.1，ADR-009 联动） | LLM 治理操作手册；Project Home 三分区；§0 速查卡进 workspace/AGENTS.md；含三层执行保障 |
| governance/统一项目目录与三分区治理合同.md | 权威 v1.0（ADR-009） | Project Home、workspace/worktrees/local、Project ID、跨 Harness AGENTS/Skill/记忆、retention、存量迁移和 Console 机器验收 |
| governance/项目路径绑定盘点表.md | 权威（v2，2026-08-25 联动） | 项目统一迁移第 0 步；目标改为 `F:\Projects\<slug>\workspace`；旧物理分类目录建议被 ADR-009 取代 |
| GOVERNANCE_INDEX.md | 权威入口 | 治理总索引的人类可读入口；当前已记录 G2-P1 本地验收与 G3 执行指针，机器入口见下两行 |
| governance/governance-index.json | 权威机器索引 | 权威优先级、固定合同 hash、实时状态入口、G2 local 生命周期合同和 fail-closed 规则 |
| governance/current-state.json | 活跃机器状态 | 当前项目身份、A/B 基线、G2-P1 已提交状态、阻断、保护路径和 G3 当前任务；每次交接必须刷新 |

## 设计（目标目录 design/）

| 文档 | 状态 | 说明 |
|---|---|---|
| design/P7-记忆效用反馈与主动判别召回-设计稿.md | 留档（superseded-draft） | 主动判别并入 P5-R1b VOI，日志并入归因合同；全局 EMA 在线排序被 ADR-006 否决 |
| P4-内嵌向量插件方案.md | 留档 | 已完成并上线（v0.3.0） |
| P4-内嵌向量插件三轮评审与交接.md | 留档 | 评审稿 |
| P4完成后路线图-Codex历史导入-P6稳定化-P5后置.md | 留档 | 路线图，顺序以 记忆系统手册 v4 为准 |
| P5-记忆智能层统一架构.md | 权威 v2（2026-08-23） | P5 当前唯一架构入口；三条循环、核心数据合同、用户记忆、Personal Reflection、类比与 P7 边界 |
| RICH_TEXT_EDITOR_REFACTOR.md / RICH_TEXT_EDITOR_PHASE1_REVIEW.md | 待核实 | 富文本编辑器重构与评审 |
| FEATURE_IMAGE_VISION.md | 待核实 | 识图插件需求 |
| design/项目控制台治理视图-思考稿.md | 草案 | 控制台作为说明书机器执行面；三层读取/两界面/五通路/三期；待工作台参考对齐 |
| design/审批交互模式-本会话实证分析.md | 草案 | 从本 session 17 条消息挖掘的审批事件日志、响应动作实证集、卡 schema 设计修正 |
| design/审批交互模式-Codex会话对照挖掘.md | 草案 | Codex 3 会话 81 轮次对照挖掘；8 动作集跨端成立 + 2 新卡型；含 P6-2 提取段管线雏形 |
| design/执行者模型与任务路由.md | 权威（名册）/**v3 已生效** | K3/Codex/v4Pro/v4Flash 名册；D5 identity/capability 路由、受约束 fallback、原子认领、路由违规分档与 extensions 注册纪律 |
| design/A线-插件通道-首批三任务简报.md | 历史执行合同（A 线已完成并冻结） | A0–A3 已在 `c27e989` / v0.4.5 与 plugins-v2026.08.24.2 完成生产验收；不得作为待开工任务重新派发 |
| design/C线-会话全量提取-首批三任务简报.md | 已盖章（Cyrus 2026-08-20），派发 Flash 执行 | C0 前置（稳定版补注册/out 移出/注册表导出）/ C1 登记 / C2 规范化三流 / C3 语料+盲评；稳定库为注册表权威；远程模型批准带三箍 |
| design/B线-控制台审批中心与治理视图-设计稿.md | **v4 已生效**（2026-08-22；D-17～D-27 收口） | 单一 WorkItem 事实面；approval/details、impact/effective_class/extensions、卡↔Decision、分诊/裁决投影、云端终局与记忆接缝 |
| design/B线-控制台审批中心-首批三任务简报.md | v4；B1a 已实现，B1b 被 G0–G3 暂停 | B1a 协议合同已迁入 `c27e989` 候选；migration/DB/HTTP/UI/侧栏/收件箱未开始；恢复前须通过当前治理索引与 context receipt |
| design/多线任务排期总表.md | v1.1 历史排期输入 | A/B/C/D5/迁移/记忆/客户端依赖链；当前执行顺序以 NEXT 顶部 G0–G4 为准 |
| design/D5线-统一工具层-D5-0任务简报.md | 已盖章的历史任务输入 | D5-0a/D5-0b 的 schema、resolver、实例盘点与 identity_conflict 边界 |

## 评审（目标目录 reviews/）

| 文档 | 状态 | 说明 |
|---|---|---|
| 记忆系统架构评审与升级建议.md | 留档（横幅） | 已被手册 v4 吸收，2026-08-20 加横幅 |
| 记忆系统架构二次评审与拍板建议.md | 留档（横幅） | 同上 |
| P5-Daydream记忆反思层评估与架构整合交接.md | 留档（横幅） | 同上 |
| P5-检索状态比较评测与召回架构升级方案.md | 留档（横幅） | 同上 |
| Codex试点盲评-2026-08-17.md | 留档 | 盲评记录 |
| reviews/A线-插件通道-首批三任务简报-执行层评审.md | 历史留档 | A 线后续已完成生产验收；本文件不再是当前执行入口 |
| reviews/B线-控制台审批中心与治理视图-设计稿-执行层评审.md | 留档 | DeepSeek 执行层评审（15 阻断 + 10 强化）；事实抽查 6/6 成立；已全数吸收进设计稿 v2 与 ADR-004 v2 |
| reviews/C线-会话全量提取-首批三任务简报-执行层评审.md | 留档 | DeepSeek 执行层评审（13 阻断 + 11 强化）；关键事实抽查属实（双库分叉经 K3 直连两套 SQLite 亲测一致）；已全数吸收进简报 v2 |
| reviews/D5-统一工具层-首轮架构审核-Codex.md | 留档 | D5 v2 审核输入；已吸收 |
| reviews/D5-统一工具层-二次架构审核-Codex.md | 留档 | 生命周期、surface resolver、项目绑定与 retire receipt；已吸收进 D5 v3 |
| reviews/D5-统一工具层-第三次架构审核-Codex.md | 留档 | instance 身份、证据、缺省拒绝、幂等与真实终态；已吸收进 D5 v4 |
| reviews/B线-v3-K3复核与升级意见.md | 留档（已收口进 v4） | B 线 v3 事实复核、D-17～D-27 议题与实现边界 |
| reviews/B线-v3-拍板与讨论议程卡.md | 留档 | Cyrus × Codex 拍板议程；已使用完毕 |
| reviews/B线-v4-Codex拍板结论与K3落地升级任务书.md | 留档 | Cyrus 拍板口径与 v4 落稿任务书；已执行完毕 |
| reviews/B线-v4-K3复核与落地记录.md | 留档/开工证据 | v4 决策矩阵、真实 seam 盘点与命令证据；B1a 后续以新基线 receipt 为准 |

## 交接（目标目录 handoff/）

| 文档 | 状态 | 说明 |
|---|---|---|
| NEXT.md | 活跃（暂留根部） | 当前执行指针为 G2-P1 精确本地提交后进入 G3；G4 只授权 Amazon 试迁并暂停 |
| HANDOVER_TO_DEEPSEEK_HARNESS.md | 活跃 | 总交接入口（compat.json handoverEntry） |
| HANDOFF_WORKBENCH_LOCAL_FILE_IMAGE.md | 留档 | 工作台本地文件识图交接 |
| PROGRESS.md | 活跃 | 进度与机器验收记录；当前记录到 G2-P1 818/818 |
| handoff/项目统合-迁移-工具架构-整合材料包-2026-08-25.md | 输入材料，非权威 | K3 讨论包；只作溯源与对照，任何状态须经 governance index/current-state 重新确认 |
| HANDOVER_*（食溯侧在 meal_tracker 项目内） | — | 各项目自己的 docs 治理按 D3 同构执行 |

## 验收/评测（目标目录 verification/）

| 文档 | 状态 | 说明 |
|---|---|---|
| verification/统一项目治理文件闭环复核-2026-08-25.md | 复核输入 | 区分治理文件闭环与机器系统上线；其“F 盘尚未创建”等快照已被本轮 bootstrap 进度取代 |
| P4-2-验收方案.md | 留档 | P4-2 验收 |
| Markdown走查测试.md | 留档 | 走查记录 |

## 发布（目标目录 release/）

| 文档 | 状态 | 说明 |
|---|---|---|
| release-notes/（既有目录） | 活跃 | 发布记录；当前 Stable **v0.4.5**，A 线生产验收已完成；发布总账制度见 D2 §3.7 |
| compat.json | 权威 | 机器可读基线；升级为三向兼容矩阵见 D2 §3.3 |
| STABLE_INSTALL_PLAN.md | 待核实 | 稳定版安装计划 |
| D0-分发地基-实施计划.md | 留档 | D0 已完成交付 |

## 日志（目标目录 logs/）

| 文档 | 状态 | 说明 |
|---|---|---|
| DEVLOG.md | 活跃 | 开发日志（190K，追加式） |
| 经验.md | 活跃 | 经验沉淀 |
| BLOCKED.md | 活跃 | 活跃阻断与已关闭项；G2-P1 已关闭，跨 Harness context receipt 待 G3 验收 |

## 附件（attachments/）与既有子目录

| 目录 | 状态 | 说明 |
|---|---|---|
| p4-model-manifests/ | 权威 | 模型哈希清单（发布红线引用） |
| memory/ | 待清点 | 记忆系统工作文件 |
| agent-instructions/ | 待清点 | agent 指令集 |
| input/ | 待清点 | 输入材料 |
| codex-scan/ | 活跃 | Codex 会话挖掘管线与脱敏产物（原始副本已删，源目录未动） |

## 记忆系统权威文档

| 文档 | 状态 | 说明 |
|---|---|---|
| 记忆系统手册.md（v4） | **权威** | 记忆系统唯一权威；已吸收两轮评审/评测/Daydream 稿 |
| 记忆系统插件商业化-首发视频门槛与Benchmark路线.md | 待核实 | 商业化路线；与 D4 §8 定位决策并读 |
