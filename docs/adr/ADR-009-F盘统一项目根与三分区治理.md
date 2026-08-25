# ADR-009：F 盘统一项目根与三分区治理

> 状态：生效
> 拍板人：Cyrus
> 拍板日期：2026-08-25
> 影响范围：所有现有及新建项目、Project Control、跨 Harness Skill/记忆投影、项目迁移与本地生成物治理
> 详细合同：`docs/governance/统一项目目录与三分区治理合同.md`

## 背景

当前项目分散在 D/F/C 多处，源码、开发工作树、安装包、E2E run、缓存和运行数据经常混在同一目录。DeepSeek Harness Personal 还出现了 A/B 基线分叉、旧目录持续承接新产物、证据只增不收以及 Dev/Stable/测试入口混淆。

既有 D3 已定义项目内部文档骨架；D4 已定义跨 Harness 记忆核心/外壳；D5 已定义统一 Skill/工具控制面；K3 已实测盘点主要项目路径并记录 `F:\Projects\` 新根。本 ADR 把这些设计收敛为一个物理目录合同。

## 决策

1. 所有受管项目的目标物理总根统一为 `F:\Projects\`。本轮只冻结合同，不立即移动任何既有项目、Stable 数据或 F 盘真实数据。
2. 目录第一层直接使用稳定、唯一的项目 slug：`F:\Projects\<project-slug>\`。项目性质、生命周期和归档状态进入 Project Control 元数据，不通过 `platform/products/business/lab/archive` 等物理分类层表达，避免分类变化再次触发搬家。
3. 每个项目 Home 固定三个功能分区：
   - `workspace\`：唯一 canonical 项目工作区，承载源码、项目文档、项目级 `AGENTS.md` 与 `.dsh-project/project.yaml`；
   - `worktrees\`：开发分支/代理工作树，只承载可追溯的源码 checkout；
   - `local\`：运行时、构建产物、E2E、缓存、隔离区和本机 receipt；默认不进 Git、不进发布包、不进记忆正文扫描。
4. 三个分区属于同一个不可变 `project_id`。路径、slug、Git remote、Harness、工作树和本机用户都只作 locator，不创造第二个项目身份。
5. Project Control 新建项目时必须创建 Project Home 与三分区，并仅把 `workspace\` 注册为 primary workspace。现有 v1alpha1 模板只会在单一项目根内写文件，不得原地修改已发布模板；必须新增版本化合同和模板版本后才能实现三分区新建。
6. 跨 Harness Skill 的规范源由 toolbox 平台项目管理；各 Harness 只接收受控投影和 receipt，不手工复制、互相搬运或共享可变宿主目录。
7. 跨 Harness 记忆使用一个宿主无关 memory-host 和一个共享数据根；所有 Harness 经适配器访问，不允许多端直接并发打开同一数据库。调用必须携带 `harness_id + harness_instance_id + project_id`，身份不明时只允许 status。
8. Global AGENTS、可复用 Skill 和记忆是跨项目资产；项目级 AGENTS、项目事实和本地生成物是项目资产。三者不得混成一份必读长文件或复制到每个项目形成多源漂移。
9. 任何工作树、run、artifact 或隔离对象在创建时即登记 owner、来源、状态、保留策略与 receipt；没有登记的本地生成物属于治理异常。清理执行必须 plan → apply → verify → receipt，越界、reparse point、未知对象和受保护路径一律失败关闭。
10. 存量迁移采用逐项目事务：盘点/哈希 → 选择 canonical `project_id` 与源码基线 → 建新 Home → 复制/检出 → 复验 → 更新各 Harness binding → 观察期 → 旧路径退役。不得用整盘批量移动或“测试绿了”代替唯一文件审计。
11. DeepSeek Harness Personal 的治理升级和 B1a 必须先收敛到 `c27e989` 父基线；B1b、数据库 migration、HTTP 与 UI 在基线晋升 receipt 完成前继续暂停。
12. 桌面只保留 Stable 快捷方式。Dev/测试候选由治理/构建流程显式启动并带版本 receipt，不再作为长期桌面入口。

## 被否决方案

1. **把项目性质写进物理目录层**：分类会变化，导致重复搬迁；改为 Project Control 元数据和 UI 分组。
2. **把工作树和大型生成物放进 canonical workspace**：会污染 Git、治理扫描、打包和凭据检查。
3. **各 Harness 各自维护一份 Skill、Global AGENTS 和记忆库**：会形成版本漂移、身份分叉与并发写风险。
4. **让所有 Harness 直接共享一个可写文件夹/数据库**：宿主行为和锁语义不同，无法证明并发安全。
5. **先批量搬项目，再补治理文件**：绑定、历史 cwd、项目 ID、回退与删除条件都没有证据闭环。
6. **原地修改已发布模板 1.0.0**：违反 Template Registry 不可变合同。

## 影响

- `docs/governance/项目路径绑定盘点表.md` 的五类物理目录建议被本 ADR 取代；其中实测资产、绑定和迁移顺序继续有效。
- D3 继续负责 `workspace/docs` 内部十二目录；本 ADR 负责项目 Home 外层三分区，两层不冲突。
- D4/D5 的共享记忆和 toolbox 路线保留，但物理位置改为各自项目 Home 的 `workspace/worktrees/local` 合同。
- Project Control 需要新增 Project Home/zone 机器合同，不能把 `worktrees` 或 `local` 硬塞进现有 `workspace_locations(kind=primary|mirror|archive)`。
- `F:\Projects\` 尚未创建；现有项目、Stable 数据、Codex/Kimi/QClaw 配置和历史会话均未迁移。

## 验收

只有以下证据同时成立，才能宣称本 ADR 已从“文件生效”升级为“机器实施完成”：

1. Project Home schema、三分区模板、Host plan 与失败关闭测试通过；
2. 错误基线、错误 `project_id`、路径越界、工作树污染、local 进入发布包等反例全部被拒；
3. toolbox Skill 在至少 DSH Dev 与 Codex 两端完成 doctor/plan/apply/receipt/rollback；
4. memory-host 在至少两端完成同一 `project_id` 的只读召回、身份不明拒绝与单写者测试；
5. 清理策略用一次性 fixture 完成时间/次数/PINNED/越界/中断恢复验收；
6. 首个存量项目完成迁移、binding 更新、旧路径观察期和退役 receipt；
7. DeepSeek Harness Personal 完成基线收敛后，B1a 在新基线回归全绿。

## 实施状态更新（2026-08-25，不改变本 ADR 决策）

- 已创建 `F:\Projects\deepseek-harness-personal\{workspace,worktrees,local}` 与 `.project-home/project-home.json`；marker 仍为 `bootstrapping/canonicalWorkspaceReady=false`。
- canonical workspace 已从 GitHub 独立克隆，父基线固定为 A 线最终 `c27e989381c34dc06d4f4af1845f6122c0b00c2b`；B1a 与治理包正按 47 项 hash plan 收敛。
- 这只是 DeepSeek Harness Personal 的受控 bootstrap，不代表 G1 Project Home schema/Host/template、G2 retention、G3 跨 Harness 或 G4 批量迁移能力已经上线。
- Project Control 的旧路径 binding 与 Dev/Stable 双 `project_id` 尚未写入修复；旧目录继续只读保留，不清理。
