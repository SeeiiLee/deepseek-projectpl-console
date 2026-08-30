# Progress

## 2026-08-30：linked-legacy 文档绑定哈希接受能力完成代码复核、提交与 canonical 合入

- 食溯迁移 Task 1 的旧路径活动入口收口与新旧路径回归已完成；Task 2 的官方 `prepare-upgrade` 因 DEVLOG、NEXT、PRD 三条 Stable 登记哈希与当前已验收权威文件不一致而失败关闭。没有提交 `project.upgradeManaged`，也没有直接修改 Stable 数据库。
- `B-G4-LEGACY-DOCUMENT-BINDING-HASH-ACCEPTANCE` 新增能力 `project.document-bindings.accept-current`。它只允许 `linked_legacy`，由 Host 重新读取全部登记文档，并要求 project revision、完整 changed 集合、旧登记哈希和新观察哈希精确一致；缺失、不可读、阻断诊断、重绑提案或并发漂移均拒绝。
- 事务只更新既有 `project_document_bindings`、对应 document state 和项目 revision，并写一份 CommandReceipt 与一条 append-only event；不保存文档正文、不写 outbox、不加 migration、不制造第二套 rebind。代码复核未发现阻断项。
- 产品提交 `cf479676636caab52801bc339d3399eb90912e2b` 精确包含 6 个 Project Control 源码/测试/bundle 文件，并从 `4b1bc2553f2e3c85505ea55aea464f70566544d8` 严格 ff-only 合入 canonical。6 个文件与验收收据 SHA 全匹配，定向复跑 5/5；完整既有验收为 Project Control 207/207、安全仓库套件 848/848、build/plugins/checkout/launch/governance/diff 通过。
- 实现验收 receipt=`../local/receipts/op_b_g4_legacy_document_binding_hash_acceptance_20260830_02-acceptance.json`，SHA-256=`acf5f8f10ce8d4edb7995f4de25f4468e5a3a15aaee720768d4dc06d3cd64bc1`；提交/合入 receipt=`../local/receipts/op_b_g4_legacy_document_binding_hash_acceptance_20260830_03-commit-and-integration.json`，SHA-256=`b5a01834b1bd81738d718b39112845a7ff07431fe9680a732d877aec28415522`。
- 当前下一任务为 `B-G4-LEGACY-DOCUMENT-BINDING-HASH-ACCEPTANCE-RC15-LOCAL-CANDIDATE`，只制作一份本地单插件候选。candidate commit/push/Release、Stable 安装、真实食溯哈希接受、`prepare-upgrade`、迁移/rebind、UI 与 B1b 均未授权进入。

## 2026-08-30：GitHub 深层清除改为异步收尾，食溯迁移与 UI/B1b 顺序重新冻结

- Cyrus 已通过登录态 GitHub Support 提交工单 [#4708849](https://support.github.com/ticket/personal/0/4708849)，状态 open。服务器 GC、内部引用/fork 和缓存视图清除仍未验证，继续保持事故未关闭；Cyrus 当前决定不再让该外部等待阻断食溯迁移，不删除或重建 GitHub 仓库。
- 只读重冻结确认旧源 `F:\QClawData\workspace\meal_tracker` 存在、目标 `F:\Projects\meal-tracker` 不存在；正式 `master` 与 `origin/master` 均为清洁提交 `a278843dae95c08285f2c03c535ef6eba5f86d78`，旧 First Changed Commit 与旧 tip 均不在清洁主线可达。
- 六个 worktree HEAD 全部为 `a278843...`，既有 dirty/untracked 继续按各自 status hash 保护；未覆盖、清理或提交。tracked 文件中仍有 27 个旧绝对路径引用，比旧预检的 20 个更多，迁移前必须分类收口并通过新旧路径回归，不能直接移动后再补救。
- 后续顺序正式改为：`G4-MEAL-TRACKER-MIGRATION-REBIND` → `B-G4-CONSOLE-UI-FOUNDATION-PRE-B1B` → `B1B-APPROVAL-INBOX-MVP` → `B2-GOVERNANCE-VIEW`。UI 地基只稳定项目身份、导航、列表/详情、搜索筛选、状态反馈和危险操作交互，不提前实现审批 DB/收件箱。
- 本轮只更新 DSH canonical 六份治理文件并写本地对齐 receipt；未修改食溯源、目标路径、Stable、GitHub 仓库或任何 binding，未 commit/push。receipt=`../local/receipts/op_g4_meal_tracker_support_async_decoupling_20260830_01.json`，SHA-256=`21042afe51607cbee3219c67fe9e2faee27ef40885130642fb66ca88b93d05b0`。

## 2026-08-29：食溯 GitHub 深层清除已证明必要，Support 材料就绪

- `project-governance-context` 开工为 `ready`，6/6 authority hash 匹配；Cyrus 明确授权 `G4-MEAL-TRACKER-GITHUB-SENSITIVE-DATA-PURGE-CLOSURE`。
- 官方 `filter-repo` 证据为 1 个 First Changed Commit、changed refs 仅 `master`、affected PR count=0、LFS 未使用。匿名 GitHub 页面因私有仓库返回 404，不能作为清除证据。
- 在 task-owned bare repo 中请求 blob filter 并各只执行一次 fetch：旧 First Changed Commit `d4b9bb6...` 与旧 tip `e2dab202...` 均被 GitHub 成功按 SHA 返回，证明未公布的服务器对象仍存在；正式食溯 repo、refs、六工作树与远端均未修改。
- 已生成不含原始个人数据或凭据值的 Support 正文、结构化证据和 first-changed-commits attachment。pre-support receipt=`../local/receipts/op_g4_meal_tracker_github_sensitive_data_purge_closure_20260829_01-pre-support.json`，SHA-256=`81a31bfe79fbdafa86537f9ec920d5520047f7559f184096f5f9bd84ab4850ad`。
- GitHub Support 必须使用 Cyrus 的已登录网页会话提交；代理没有该登录态，Codex 内浏览器入口已排队，系统默认浏览器启动被宿主策略在启动前拒绝。当前未生成 ticket、未冒充提交完成。
- 最终门禁同时观察到多个新的未跟踪 Skill/plugin 目录由并行外部活动出现；本任务严格只修改既有六份治理文档与 Project Home `local` 下的 task-owned 材料，没有触碰、暂存或清理这些目录。

## 2026-08-29：食溯 advertised master 完成清洁替换，GitHub 深层清除另行闭环

- 远端只读预检确认 `origin=https://github.com/SeeiiLee/nutrisight.git`、无 `pushurl`、远端只有 `master@e2dab202...` 且无 tag；精确 `force-with-lease` dry-run 退出 0，远端未变化。六个 worktree、R3/local-integration receipt、refs 与 Git 锁全部匹配冻结基线。
- 先原子创建本地恢复 ref `refs/dsh/recovery/g4-meal-tracker-pre-remote-replacement-20260829@e2dab202...`，随后只进行一次 `master` 精确 lease 替换。GitHub receive-pack 接受，远端和本地 `origin/master` 均变为清洁提交 `a278843dae95c08285f2c03c535ef6eba5f86d78`；未重试、未创建或修改其他远端 ref/tag。
- 替换后 advertised 远端仍只有一个 `master` ref；其 90 个可达提交的禁止历史路径 0、tip 禁止路径 0、GitHub token/URL userinfo 凭据位置 0，额外 advertised `refs/pull/*` 查询为 0，未输出匹配值。六工作树状态哈希、29 个 `outputs/**` 文件 / 35,047,644 bytes、remote 配置与源文件保持不变；`fsck` 退出 0、锁和操作 marker 均为 0。
- 最终复核依据 GitHub 官方敏感数据移除说明纠正结论：force push 只证明主分支可达历史已替换，不能单独证明缓存提交页、内部 PR refs、fork/clone 或服务器对象已被物理清除。所以下一步新增 `G4-MEAL-TRACKER-GITHUB-SENSITIVE-DATA-PURGE-CLOSURE`；GitHub Support 未联系，另需外部动作授权。
- 本地恢复 ref 仍可到达旧远端历史，专用于另行授权的恢复；没有 GC/prune。GitHub 对既有 `data/ref/dris2023_full.pdf`（66,464,175 bytes）给出超过推荐 50 MiB 的警告，本任务仅登记，未做 LFS 转换或再次改写历史。
- receipt=`../local/receipts/op_g4_meal_tracker_remote_history_replacement_20260829_01.json`，SHA-256=`a7356ecd35ef8b2c6f45ce47d6c7078797226ae10a246bbe236d888fc9281ca4`。最终门禁期间另有外部活动创建未跟踪 `demos/ui-craft-pilot`，本任务按边界未触碰并已在收据排除。当前下一任务为 GitHub 深层清除闭环，必须另行授权；迁移/rebind、审核证据迁入、恢复历史清理、Stable 直接写入和 B1b 均未执行。

## 2026-08-29：食溯 R3 清洁历史完成正式本地接入

- 写入前冻结 `master`、5 个 linked-worktree HEAD、全部 refs、六个 index hash、status 条数与 status SHA；task-owned fixture 完成原子多 ref 事务的正向、回滚验证。fixture 首次测试暴露 PowerShell native pipeline 末行编码问题，但 fixture refs 未变化、无锁残留；改用显式 UTF-8 stdin 后正反事务均通过，源仓库从未参与该失败尝试。
- R3 对象仅从 task-owned 本地候选导入，未访问网络或私有远端。一次 `git update-ref --stdin` prepare/commit 事务创建 `refs/dsh/candidates/g4-meal-tracker-clean-history-r3@cc23e344...`，并把正式 `master` 与 5 个 detached worktree HEAD 从 `46c395c1...` 映射为树完全相同的清洁提交 `a278843d...`。
- 六个工作树的 index SHA、tracked/dirty/untracked 条数和 status SHA 与冻结值逐项一致，0 个 Git 锁残留；`master` 与候选 ref 的禁止路径、凭据扫描均为 0，22 个已知旧 blob 从二者均不可达，`fsck --full --no-reflogs` 退出 0。当前 `outputs/**` 29 个文件 / 35,047,644 bytes 原地不变。
- `origin/master=e2dab202...` 和 remote 配置完全未变；3 个已知旧敏感 blob 仍可从 remote-tracking ref 到达。为保留回滚与远端替换证据，没有运行 GC/prune，也没有 force/push、联网、写 Stable、迁移/rebind、修改业务/个人数据或删除源文件。
- receipt=`../local/receipts/op_g4_meal_tracker_clean_history_local_integration_20260829_01.json`，SHA-256=`4322162341c725413917af07fca52c53da0cea84f2ed1fdc3858fa193b272238`。下一任务为 `G4-MEAL-TRACKER-REMOTE-HISTORY-REPLACEMENT`，必须单独授权私有远端访问与 force-with-lease；食溯物理迁移/rebind 仍是另一道门。

## 2026-08-29：食溯 R3 清洁历史候选通过，正式本地接入待授权

- 在新的 task-owned staging 中从原始本地源重新制作 R3；R2 收据 SHA、候选 HEAD 与 pack SHA 均保持不变。R3 使用冻结的 `git-filter-repo v2.47.0`，全程未联网、未访问私有远端。
- 全历史删除范围为 R2 五个隐私路径，加 `data/output/**` 与 `outputs/**`。90/90 源提交一一映射，授权删除范围以外树差异 0、元数据差异 0；一个提交说明里的 7 位旧提交号由工具确定性映射为新提交号。
- 候选 HEAD=`cc23e344faec89564148cddbf78a0eda84b0fe7b`、tree=`aac900299ccc05d2df3a6b7a451bcb329d0c408e`；7 类禁止路径历史命中 0，22 个已知旧 blob 在 GC 后物理存在数 0，91 个候选提交凭据扫描命中 0，独立 clone 状态 0，`fsck` 0，唯一 gitlink 仍为 `data/china_fct@1cd312b...`。
- 当前 `outputs/**` 29 个审核生成物（35,047,644 bytes）原地保留且不进 Git；候选只新增 `outputs/` 忽略规则。未来迁入 `F:\Projects\meal-tracker\local\evidence` 仅登记，未创建、复制或移动。
- 六个源 worktree 的 HEAD、status 条数与 status SHA 逐项等于冻结值；源 `master`、linked worktree、refs、`.gitignore` 与源文件零漂移。候选 `git log --check` 仍有 816 条 / 70 文件的既有非安全格式债务，本任务未改写内容掩盖它。
- receipt=`../local/receipts/op_g4_meal_tracker_credential_git_integrity_closure_r3_20260829_01.json`，SHA-256=`7c3fb089af18ab2bd99597e4ab133c2b3734851df72c48ca4d33920c94e4ef84`。当前只证明本地候选通过，不代表已接入正式项目；下一任务 `G4-MEAL-TRACKER-CLEAN-HISTORY-LOCAL-INTEGRATION` 仍需单独授权，force/push、远端替换、迁移/rebind、Stable、源删除和 B1b 均未执行。

## 2026-08-29：量化 canonical 迁移与治理权威链闭环

- 量化正式项目 `prj_01a01cb8-5e2c-7c76-90ae-54e8f97bf99a` 已完成保留 wrapper 的物理迁移、managed upgrade 和唯一 `project.rebindLocation`：Stable 项目 revision 3，`F:\Projects\cyrus-quant-trading\workspace` 为唯一 active primary location，旧含 U+200C 路径 inactive 且只留在路径历史。
- Codex saved-project 与 Kimi workspace locator 均已指向 canonical workspace；Cyrus 已确认 Kimi 可以把旧项目会话移动到新项目。验收未读取或改写聊天正文。
- 量化外层新增人工/机器治理索引、current-state、NEXT、BLOCKED、PROGRESS 与文档索引；`project-governance-context` 返回 `ready`，Project Home/manifest/index/current-state 的 ID 一致，6 份固定 authority hash 全部 matched。
- 内层 Git 继续是 `main@c8b0e6b1e06b561507dfca3abd9a5383446da138`，53 项既有 dirty/untracked 的规范化 SHA-256 仍为 `7f2953882ba51b64abe62539d3e092e213cdedc123c1b88c39d5b24bba4ed4ea`；本轮没有清理、覆盖、提交、运行付费/联网任务或写业务状态。
- DSH canonical 权威链已将量化的预检、迁移/rebind 与治理初始化标记为完成；下一任务晋升为 `G4-MEAL-TRACKER-CANONICAL-MIGRATION-READ-ONLY-PREFLIGHT`，只读范围仍需 Cyrus 新授权，真实迁移不自动开始。
- 收据：`../local/receipts/op_g4_quant_governance_authority_bootstrap_and_dsh_alignment_20260829_01.json`。本轮未 commit、push、发布、安装或修改 `release-staging/`。

## 2026-08-28：Project Control rc.14 Stable 验收与空文档升级生产治理收口完成

- rc.14 交付提交 `6e2a1d0c09bb78140a4f99929acf2242a9635bfa` 已无 force 推送并发布为 [plugins-v2026.08.28.2](https://github.com/SeeiiLee/deepseek-projectpl-console/releases/tag/plugins-v2026.08.28.2)（Release `378493785`）；仅 Project Control `0.1.0-rc.14`，tgz 310,029 bytes，SHA-256=`7d068ae6aa5c2552f8b389bd77e06f1442922af418cf6fb9c40d75de7df65a21`。
- Cyrus 已完成手动安装并重启。Stable 当前 generation=`pending-1787924242823`，上一 rc.13 generation=`pending-1787905720701` 继续保留；pending/activating 指针不存在，25 个安装文件逐一复算为 0 缺失/不符，最新启动到 `harness-ready` 与 `page-ready`。
- 验收把“Release 精确包 → Stable 当前 generation → 已安装文件”的身份链闭合，并用既有 rc.14 空文档回归测试证明修复代码位于该包中。没有调用会写计划/引用的 `prepare-upgrade`，也没有对真实量化项目执行 `project.upgradeManaged`，因此真实量化迁移仍不是已验收事实。
- Stable 验收 receipt=`../local/receipts/op_b_g4_empty_document_managed_upgrade_rc14_stable_acceptance_20260828_01.json`，SHA-256=`e70813412cadb479200c0f999bf74e93b6d36b8eeaf20e9b02d67e9f3bf2c7dc`。本轮治理提交只含 7 份权威文档，`release-staging/` 继续排除，未再次安装/写 Stable，未操作量化、食溯或 B1b。
- 下一任务为 `G4-QUANT-CANONICAL-MIGRATION-READ-ONLY-PREFLIGHT`：刷新量化正式身份、Stable binding/路径历史、旧 Kimi/Codex 路径与 U+200C、文件结构、目标占用和迁移/回滚方案；开工仍需新的只读授权。

## 2026-08-28：空文档 managed upgrade 修复已提交并合入 canonical（rc.14 发布前快照）

- 旧项目没有任何文档 binding 时，升级器原先生成裸 YAML `entries:`；解析后为 `null`，因此官方 `project.upgradeManaged` 路径被 schema 以 409 `MANIFEST_INVALID` 拒绝。修复后空列表明确输出 `entries: []`，非空 block list 的既有序列化保持不变。
- 红测先稳定复现 `6 tests / 5 pass / 1 fail` 与 409；修复后定向 `6/6`、Project Control `207/207`、安全仓库套件 `848/848`，skipped/todo=0。正式全量 `846/849` 中，受保护 packed Stable E2E 在非 canonical Project Home worktree 按合同失败关闭；另两项 Windows 并发波动定向复跑 `7/7` 通过。
- typecheck、直接 build、18 插件门禁、checkout `1280`、launch、governance `22/22`、diff 均通过；双路径构建仅产生预期窄幅 bundle 差异。实现 receipt=`../local/receipts/op_b_g4_empty_document_managed_upgrade_closure_20260828_01.json`，SHA-256=`af7c0ec82126d4d47b778389322d56f51173b86c6f2c6c3e6a6c50cd2f82ad1f`。
- 产品提交 `613f53588bcd3585b7298db323f682c46d6129df` 精确包含 3 个文件，并从 `7594834fe1e7ff8b5c596ff330c25c073d176985` 严格 ff-only 合入 `codex/governance-alignment`。未 push、发布、安装或写 Stable，未操作量化项目，既有 `release-staging/` 未纳入提交。
- Stable 仍运行 Project Control rc.13；下一任务为 `B-G4-EMPTY-DOCUMENT-MANAGED-UPGRADE-RC14-LOCAL-CANDIDATE`，只制作一份本地单插件候选。commit/push/Release、Stable 安装验收与量化预检继续分门授权。

## 2026-08-28：Project Control rc.13 Stable 验收与原生工作区历史治理收口完成

- rc.13 候选提交 `3780d159efc3a294b4fd01bb92ff4fe7942e7c82` 已无 force 推送并发布为 [plugins-v2026.08.28.1](https://github.com/SeeiiLee/deepseek-projectpl-console/releases/tag/plugins-v2026.08.28.1)（Release `378348305`）；仅 Project Control `0.1.0-rc.13`，tgz 310,006 bytes，SHA-256=`e97b60323d0c26bf90f2db5ea250c55d39a3ee1bec9c47d56f93e46257bd3afe`。
- Stable 已激活 generation=`pending-1787905720701`，rc.12 generation=`pending-1787848154807` 继续作为回滚点；pending/activating 指针不存在，25 个安装文件逐一复算为 0 缺失/不符，已安装 metadata 与 Release 身份一致，启动到 `page-ready`。
- Cyrus 人工验收通过：项目“打开控制台”→“会话”内可见旧位置历史；旧会话可正常打开；“在新工作区继续”成功使用 `F:\Projects\deepseek-harness-personal\workspace`；返回后原旧会话仍存在，未观察到原始会话改写。
- Stable 验收 receipt=`../local/receipts/op_b_g4_native_workspace_history_rc13_stable_acceptance_20260828_01.json`，SHA-256=`b52c7738aaeb517c333bfb6d18a427a33081b7aa4061f0ecd11a5d6362711b00`。本治理收口不再访问或写 Stable，不操作会话、binding、旧目录或其他项目，`release-staging/` 继续排除。
- DSH 的 G4 canonical rebind 与原生会话连续性现在完成产品、发布和生产闭环。下一任务为 `G4-QUANT-CANONICAL-MIGRATION-READ-ONLY-PREFLIGHT`：只读核对量化身份、旧 Kimi 路径（含 U+200C）、文件和治理状态，先形成迁移/回滚计划；任何物理迁移或 Stable rebind 仍需新授权。

## 2026-08-28：DSH canonical rebind 与原生工作区历史闭环进入 canonical 线性历史（rc.13 发布前快照）

- 外部一次性切换器 R3 已把旧目录原子改名为 `D:\Deepseek Harness Personal.legacy-pre-rebind-20260828` 并修复 linked worktree Git 指针；未复制、删除或建立 junction。runtime receipt=`../local/receipts/op_g4_dsh_canonical_rebind_20260828_06-external-switch-r3-runtime.json`，SHA-256=`1863568a5667c0841c2b865c1b92f9cee88efcde241d7f5bab5f9a391f300eac`。
- 目录切换暴露的 Stable web profile 失效绝对 link 已通过官方离线插件流程修复；最终 receipt=`../local/receipts/op_g4_stable_web_profile_self_containment_repair_20260828_01.json`，SHA-256=`28da74b1fd21a5c6027257a37d9c49d41d13fc5a42e39e1b9ede202f6593ea67`。随后 Cyrus 在 Stable 使用唯一主动入口完成 DSH 正式项目换绑并确认 canonical 目标；本次治理对齐不直接读写 Stable 数据库，也不重复 rebind。
- 换绑后发现 Project Control binding 与原生 Workspace/会话索引是两个事实面。`G4-NATIVE-WORKSPACE-HISTORY-CLOSURE` 现在在换绑前检查原生会话，在项目路径历史中只读显示“旧位置历史”，并通过公开 Workspace/Session 服务为 canonical 路径创建或复用新会话；不改写原始/压缩会话，不建 junction，不新增 migration/DB schema，不制造第二套 rebind。
- 产品提交 `1d00c8fdb8748d89d2ec7b0b837d2c14d3a258d1` 已由 canonical `d858a25` 纯 fast-forward 合入；16 个产品/测试/bundle 文件，Project Control `206/206`，checkout `1280`、launch、governance `22/22`、diff、typecheck、build 均通过。实现 receipt=`../local/receipts/op_g4_native_workspace_history_closure_20260828_01.json`（SHA-256=`14472313...2cd0`），提交 receipt=`../local/receipts/op_g4_native_workspace_history_closure_20260828_01-commit.json`（SHA-256=`15068f5f...a1c6`）。
- Stable 仍运行 Project Control `0.1.0-rc.12`，因此旧位置历史 UI 尚未进入生产。下一任务为 `B-G4-NATIVE-WORKSPACE-HISTORY-RC13-LOCAL-CANDIDATE`：只制作一份本地单插件候选；commit/push/Release、Stable 安装、量化/食溯迁移与旧目录清理均需后续独立授权。既有 `release-staging/` 未纳入本轮提交。

## 2026-08-28：Project Control rc.12 Stable 安装与非写入验收完成

- Cyrus 已通过更新中心安装 Project Control `0.1.0-rc.12` 并重启 Stable。当前 generation=`pending-1787848154807`、source tag=`plugins-v2026.08.27.1`、tgz SHA-256=`7d3e75adf9e691e69e15bf7b397ac017cfd9eee424d65b765710531187e78302`；25 个安装文件逐一复算，缺失/不符均为 0，pending/activating 指针不存在。
- Live Host storage=`ready`、schemaVersion=9；active 项目 4、archived 项目 0，候选视图为待审阅 1 / 已忽略 3 / 历史 10；`projects.archive`、`projects.unarchive` 和唯一 lifecycle submit 能力可见。Cyrus 确认“归档”和“更换工作区”入口正常，但没有点击，因此没有真实项目状态变化。
- 搜索实测：`亚马逊`=1、`亚马`=1、`Amazon`=0。源码合同只对 `project_id` 与当前项目名称做不区分大小写的字面子串匹配；中英文别名、翻译和拼音不在 rc.12 已实现范围，登记为后续体验改进而非本轮阻断。
- 验收 receipt=`../local/receipts/op_b_g4_project_lifecycle_rc12_stable_acceptance_20260828_01.json`，SHA-256=`51f254b303900580befe5ee2b35e15ac058c44d5d59df43915a7f14d42033f37`。未归档/恢复/换绑任何真实项目，未直接写 Stable 数据库或 userData，未迁移项目、push、发布、修改 `release-staging/` 或进入 B1b。下一任务为 `G4-DSH-CANONICAL-REBIND`，当前只允许只读预检。

## 2026-08-28：Project Control rc.12 已精确提交、push 并发布单插件 Release

- rc.12 候选提交 `4052ae90559c9ba206344a31be1cc380b37b68f2` 仅包含 `plugin-set.lock.json`、Project Control `package.json` 和两份 rc.12 验收脚本；20 insertions / 20 deletions，`release-staging/` 未进入提交。canonical 从 `c2659a9` ff-only 前进，远端 `codex/governance-alignment` 从 `9d8c1a7` 线性前进到 `4052ae9`，无 force。
- 新 Release [plugins-v2026.08.27.1](https://github.com/SeeiiLee/deepseek-projectpl-console/releases/tag/plugins-v2026.08.27.1)（ID=`377962312`）仅含 Project Control `0.1.0-rc.12` 四项资产；tgz 297,592 bytes，SHA-256=`7d3e75adf9e691e69e15bf7b397ac017cfd9eee424d65b765710531187e78302`。远端 tag 精确指向 `4052ae9`，四项资产的正式 staging、GitHub digest 和公开下载 SHA-256 全部一致。
- 发布复用现有单插件管线，先做 public dry-run；凭据只通过内存命名管道提供，没有写入文件、日志或 receipt。第一次 commit 因新 worktree 无提交者身份在写入前被 Git 拒绝，随后只用一次性 `git -c` 复用父提交身份，没有修改全局/仓库 Git 配置。
- 发布 receipt=`../local/receipts/op_b_g4_project_lifecycle_rc12_commit_push_release_20260828_01.json`，SHA-256=`49fddb1a7412f382cced754bb0e9491df7a0bd11b3556987785ec5fbcef7f77b`。Stable 仍为 Project Control rc.11；未安装、直接写库、真实项目归档/换绑/迁移、客户端 package-set 或 B1b。下一门是另行授权的 rc.12 Stable 安装与人工验收。

## 2026-08-27：项目生命周期第二批完成本地提交并进入 canonical 线性历史

- canonical `codex/governance-alignment` 从 `f594627e7d997debefb7356248134683be70f8c2` 以 ff-only 依次前进到 checkout 前置修复 `0daac278c0d99866ab24c576efda53fecb4adaf2` 和产品提交 `213e553e98bf6c0b2e8256d26f8246974a1a4ba5`，没有 merge commit；`release-staging/` 保持未跟踪且未进入提交。
- 本地产品已包含：可恢复的项目归档/恢复、服务端过滤后搜索与分页、覆盖全部 active 项目的 workspace 索引、由 scanner 同口径构造 relocation candidate 的主动“更换工作区”入口，以及唯一现有 `project.rebindLocation` 校验/事务复用。复核中补齐了超过 100 个 workspace 时仍能找到目标项目及主动候选状态投影两项窄修复。
- 机器证据：Project Control `199/199`；正式 `npm test` `841 tests / 840 pass / 1 fail`，唯一失败是受保护 packed Stable E2E 在非 canonical 任务 worktree 中于创建 package-set/run 前失败关闭；排除该受保护测试的安全仓库套件、build、typecheck、check-plugins、canonical/task-worktree bundle 同 SHA、checkout、launch、governance 与 diff 均通过。未把安全套件误报为正式全绿。
- 实现 receipt=`../local/receipts/op_b_g4_project_lifecycle_second_batch_20260827_01.json`（SHA-256=`df0abe2f...ac63`）；复核修复 receipt=`../local/receipts/op_b_g4_project_lifecycle_second_batch_review_fixes_20260827_01.json`（SHA-256=`6c09442a...1708`）；提交复核 receipt=`../local/receipts/op_b_g4_project_lifecycle_second_batch_review_commit_20260827_01.json`（SHA-256=`2f9e5b22...759a`）。
- Stable 仍是 Project Control rc.11。本轮只闭合本地历史与权威治理指针；下一步必须依次经过 rc.12 本地候选、commit/push/Release、Stable 安装验收三道独立门，之后才可单独授权 DSH 正式换绑。未发布、安装、写 Stable、迁移/换绑真实项目、进入 B1b 或清理现有 staging。

## 2026-08-26：rc.11 构建可复现性闭环与替代候选完成

- 根因已收口在 Project Control 的 CSS Modules 构建插件：旧共享 fallback 把物理 checkout 绝对路径同时用作 Rolldown virtual id 和 lightningcss `filename`，导致同一源码在不同 worktree 产生不同 class 名、bundle 注释与 SHA。修复只在 Project Control 自己的 tsdown 包装层，把物理路径限制为读取/监听目标，进入编译器与 bundle 的身份统一改为包内相对路径；未修改只读 Harness 上游。
- 红证据：修复前 canonical `client.js` SHA-256=`b836232674d0d50b5e943b209d7f7c6013463ebf8383464d2818bdf177eb33f5`，任务 worktree 为 `344cdc9a3b74a6e96aeb1a606423766f6708655315590a00636aa032aad1103a`，两边 bundle 均内嵌各自 `F:\Projects\...` 路径。新增测试先以 `1 fail / 0 pass` 钉住绝对 virtual id，再修复为 `2/2`。
- 双路径机器验收通过：canonical 与 `wt_project_control_candidate_closure_20260826` 的 task-owned 临时源码根分别重建，`lib/index.js`、`lib/client.js`、`lib/client.js.map` 三份产物逐字节同 SHA；任务临时源码、依赖子集和 junction 已清空。receipt=`../local/receipts/op_b_g4_rc11_build_reproducibility_closure_20260826_01-dual-path.json`。
- 新 rc.11 单插件候选位于 `release-staging/plugins-v2026.08.26.3`，仍为 `localFixture=true`、`minClient=0.4.6`、仅一个 Project Control 资产。tgz 288,537 bytes，SHA-256=`80476bafe305c6885dbd2d14b6348dfce829f85bb918d26b791206f26eb84963`，与 plugin index 和 `plugin-set.lock.json` 一致；隔离 generation/激活/回滚全过。
- 机器验收：Project Control `193/193`；安全仓库套件（排除会制造客户端 package-set 的 packed Stable E2E）`833/833`、117 个 test file；Project Control typecheck、18 插件门禁、清理后的 checkout 1,288 文件、launch、governance 22/22、plugin lock 与 `git diff --check` 全过，skipped/todo=0。
- Cyrus 授权的替代清理已按旧候选 5 文件聚合 SHA-256=`bbb7189e444c3bbc0c30e19b4bb4fb045fc2f0524424757b3c6e293741c11956` 复核后，仅删除 `release-staging/plugins-v2026.08.26.2`；未触碰预存 `.1` 或新 `.3`。旧 staging 不可直接恢复，但其来源提交和历史 receipt 仍可追溯，新 `.3` 是当前唯一 rc.11 本地候选。
- 本轮未 commit、push、Release、安装或写 Stable，未换绑/迁移任何项目，未创建客户端 package-set，未进入 migration、B1b 审批数据库或收件箱。下一门是另行授权的 `B-G4-CANDIDATE-CENTER-RC11-COMMIT-PUSH-RELEASE-AUTHORIZATION`。

## 2026-08-26：rc.11 本地候选通过，发现并隔离绝对路径构建可复现性债务

- 权威治理状态已先提交为 `3c918fb57677b9ed99535cde541daa17b2ab666f`；随后以无 force 普通 merge 将 Candidate Center 产品提交 `7337bb3` 合入，merge commit=`c0ababd95ebeaf3951bb5453ac108e02be2dba1f`。两条历史和 rc.10 源码 `ef41ea4` 均已验证为 merge HEAD 祖先；旧 `release-staging/` 未进入提交。
- Project Control 已在未提交的本地候选中版本化为 `0.1.0-rc.11`，release batch=`B-G4-CANDIDATE-CENTER-FIRST-BATCH`。本地 staging `release-staging/plugins-v2026.08.26.2` 精确含一个插件资产和四份元数据文件；tgz 288,655 bytes，SHA-256=`f21eed76f3c1b24397ab309b2bd6587dc4fc16ebdb0fc73b882441bd53eb6324`，与 plugin lock 一致。
- 隔离 generation 验收通过：rc.10 builtin → rc.11 external 检测、装配、Host Schema 自包含导入、pending activation、commit、builtin rollback、临时 profile 清理全部 pass。Project Control `191/191`；116 文件安全仓库套件 exit 0；插件门禁、typecheck、build、checkout 1,285 文件、launch、governance 22/22、lock 与 diff 均通过。未运行 packed E2E、未创建客户端 package-set。
- 候选 receipt=`../local/receipts/op_b_g4_candidate_center_rc11_local_candidate_20260826_01.json`；隔离 receipt=`../local/receipts/op_b_g4_candidate_center_rc11_local_candidate_20260826_01-isolated.json`；merge receipt=`../local/receipts/op_b_g4_candidate_center_post_commit_alignment_rc11_20260826_01-merge.json`。
- 构建复核发现：同一 client 源码从任务 worktree 与 canonical workspace 构建时，生成 bundle 内嵌不同绝对 CSS 源路径，并派生不同 CSS Module class 名和 SHA。功能不受影响，本次 rc.11 已用 canonical 字节重新构建并冻结；但跨路径可复现性不成立，推荐在 commit/push/Release 前做 `B-G4-RC11-BUILD-REPRODUCIBILITY-CLOSURE`。
- 未 commit rc.11 源码候选、未 push、未创建 Release、未安装/写 Stable、未换绑/迁移项目、未进入 B1b。生成 plugin lock 时的一次性 18-tgz task temp 已清除；rc.11 staging 作为候选证据保留。

## 2026-08-26：Candidate Center 第一批已提交，进入 canonical 历史合并与 rc.11 本地候选

- Candidate Center 第一批已在隔离 worktree 精确提交为 `7337bb36624672983e51f4229d3f96a43d4fe63e`，父提交为 Project Control rc.10 源码 `ef41ea4624347116a183294c1904c28cfa261b31`；提交主题为 `feat(project-control): close candidate center first batch`。
- 实现范围严格保持第一批：服务端过滤后分页、状态计数与已登记/待审阅/已忽略/历史四类视图、批量软忽略/恢复与指纹继承、同路径同身份陈旧 relocation duplicate 原子关闭、至少 120 条混合候选验收。未进入 migration/DB schema、B1b 审批数据库/收件箱、第二套 rebind 事务或其他项目迁移。
- 复核修复后的机器验收：Project Control `191/191`；安全仓库套件 `831/831`；插件检查、Project Control build/tsc、checkout、launch、governance 与 `git diff --check` 均通过，skipped/todo=0。为避免本治理/单插件任务再制造大型测试包，没有重复触发 packed E2E。
- 第一批验收 receipt=`../local/receipts/op_b_g4_candidate_center_review_fix_20260826_01.json`，SHA-256=`fca3960b560899d1d149604d87767a5102213ab2f88c7a3a4fcad29b30bd0635`；commit receipt=`../local/receipts/op_b_g4_candidate_center_first_batch_20260826_01-commit.json`，SHA-256=`9e2ad39fd003e52ab155ff106edfc723d748b5bff7c8215dafebc23a2d1496fc`；提交文件聚合 SHA-256=`71a2475832b859dc0a51753eb8badcba04292aab3061f0a2342b4af4f1a9274b`。
- Cyrus 已授权：把上述事实和完整后续队列写回 canonical 权威链、精确 docs-only 提交、以普通本地 merge 合成产品与治理历史、随后制作并隔离验收 Project Control `0.1.0-rc.11` 本地单插件候选。context receipt=`../local/receipts/op_b_g4_candidate_center_post_commit_alignment_rc11_20260826_01-context.json`。
- 当前明确未授权：push、GitHub Release、Stable 安装/写入、项目换绑/迁移、B1b、删除或覆盖现有 `release-staging/`。因此 `7337bb3` 是已验收本地产品事实，不是生产已上线事实。

## 2026-08-26：K3 canonical Workspace 只读验收完成

- Cyrus 已在 K3 侧新建对应 `F:\Projects\deepseek-harness-personal\workspace` 的 Workspace；没有继续使用旧路径做新工作。
- K3 完整读取 AGENTS、governance-index、current-state、NEXT、BLOCKED，并运行 canonical toolbox context-status；结果 `ready`，projectId=`prj_01a0082e-fea8-7d6f-b6c2-08a259fba389`、canonicalWorkspace、governancePhase、nextTask 与本项目机器状态一致，6 份权威文件 hash 全部 matched。
- K3 观察到 branch=`codex/governance-alignment`、HEAD=`e6308706b015c905c5114f50da33891ba5a5ebef`；dirty 仅来自本轮 docs-only 治理对齐与既有 `release-staging/`，未修改任何文件。
- 旧 K3/Kimi Workspace 处置固定为 history-only：不建 junction、不继续写、不删除。K3 后续代码只能进入任务专属 worktree。
- `G4-K3-CANONICAL-CONTEXT-ALIGNMENT` 已关闭；唯一 nextTask 推进为 `B-G4-CANDIDATE-CENTER-FIRST-BATCH-AUTHORIZATION`。候选中心产品代码尚未获授权、尚未开始。
- 验收 receipt：`../local/receipts/op_k3_canonical_context_alignment_20260826_01.json`。

## 2026-08-26：生产事实与跨 Harness 指针完成治理对齐

- canonical 身份保持 `prj_01a0082e-fea8-7d6f-b6c2-08a259fba389` / `F:\Projects\deepseek-harness-personal\workspace`；治理 HEAD `e630870` 已验证为 rc.10/候选中心基线 `ef41ea4` 的祖先，没有新的 A/B 基线分叉。
- 依据安装收据对齐生产事实：Stable 客户端为 0.4.6；Project Control 0.1.0-rc.10 已安装并 active，Release tag=`plugins-v2026.08.26.1`、commit=`ef41ea4`、包 SHA-256=`a6496244...0008`。rc.9 继续作为历史 Release 保留，不再是当前安装门。
- 依据 Amazon 换绑后收据和 Stable SQLite `readOnly + PRAGMA query_only=ON` 复核：Amazon 正式项目 revision 2，唯一 active location=`F:\Projects\amazon-store\workspace`；旧 Kimi 路径 inactive，path history=`pth_01a03cf6-feaf-7abd-9c9e-686d14931b61`。
- Stable 当前四个正式项目仍为 Amazon、DeepSeek Harness Personal、Cyrus Quant Trading、mealtracker。除 Amazon 外，其余三项继续保留原绑定；候选中心上线前不批量扫描或换绑。
- 当前候选分布为 conflict 1、discovered 3、ignored 4、imported 5、relocation_candidate 1。注册项目不会因此消失，但现有“先 LIMIT 100、后客户端过滤”会让历史/终态候选淹没真正待办，已登记为 Candidate Center 第一批阻断。
- 该治理对齐时间点 K3 尚未完成 canonical 上下文验收；随后已按本页上方 `K3 canonical Workspace 只读验收完成` 记录关闭。K3 做控制台开发必须从本项目 canonical workspace 读取权威链；做 Amazon 时使用独立 Amazon workspace；旧 Workspace 只作历史，不建 junction、不删除。
- 本轮只改治理索引/current-state/NEXT/BLOCKED/PROGRESS/绑定盘点并写本地收据；`release-staging/` 原样保留，未改产品代码、Stable 数据库、项目 binding 或 Amazon/量化/食溯文件，未 commit、push、发布或安装。
- 治理对齐收据：`../local/receipts/op_dsh_governance_alignment_20260826_01.json`。

## 2026-08-26：B-G4-0 source push 与 Project Control `0.1.0-rc.9` Release 已公开

- Cyrus 精确授权后，`codex/governance-alignment` 与 tag `plugins-v2026.08.25.1` 已无 force、无覆盖地指向 `4658a6e337deaa5b4529f2fdc4066aabd487d787`；产品提交 `2400410ca10e4a8e792d276bcde89faeb778e1e6` 是其父提交。现有祖先提交因此可从该远端 branch 追溯；Toolbox/Memory 各自仓库仍无 remote、没有被一并发布。
- 首次发布流程在 Release `376569643` 已创建为 draft 且四项资产上传后，因 draft 的 public `browser_download_url` 返回 404 而失败关闭；没有公开、自动重试、重传、创建第二个 Release 或重建 refs。失败 receipt=`../local/receipts/op_b_g4_0_project_control_rc9_release_20260826_01-failed.json`。
- Cyrus 随后明确批准只恢复该 Draft Release。GitHub API 的四项 asset digest 与本地 staging SHA-256 全匹配后，仅把现有 draft 转为公开；Release=`https://github.com/SeeiiLee/deepseek-projectpl-console/releases/tag/plugins-v2026.08.25.1`，非 draft、非 prerelease，四项资产，Project Control 包 271,580 bytes，SHA-256=`01e0a7785a13227422d6e5e5c3677c2b9cf50bc146e4821718c4b3cc598902ca`。
- 发布恢复 receipt=`../local/receipts/op_b_g4_0_project_control_rc9_release_resume_20260826_01.json`，SHA-256=`83d798639bc7e6be155feb96aea117260529a1ad1595f2ac71a332cba6fc1cdd`。本地 staging 5 文件 / 273,461 bytes 保留且未跟踪，因为没有清理授权。
- 本次只把 live governance 从“等待 push/Release”推进到“Release 已公开、等待 Stable 安装授权”。未安装或写真实 Stable、未执行 Amazon rebind、未开始 B1b、未删除 staging；本次治理文档尚未获得 commit/push 授权。
- docs-only 状态对齐门禁：checkout contract 1,270 files、governance 22/22、launch、`git diff --check` 与 `project-governance-context` 均通过；正式 `npm test` 未重跑，避免为纯文档任务触发 packed E2E/run，继续引用候选已有的 826/826。验收 receipt=`../local/receipts/op_b_g4_0_release_state_alignment_20260826_01.json`。

## 2026-08-26：B-G4-0/G2-P2 精确提交与 post-commit 指针对齐

- Cyrus 明确授权后，将冻结的 28 文件候选精确提交为 `2400410ca10e4a8e792d276bcde89faeb778e1e6`（parent=`f3fba16c...`，tree=`18a8b9a...`，subject=`feat(governance): close B-G4 and G2-P2 validation`）。commit path 集、逐 blob SHA-256/bytes 与候选 receipt 完全一致，聚合 SHA-256=`607de09501acf9e0ad9b9a7151206b9268fcde723df01639d1a6d9d13b3e8952`；提交后工作树干净。
- 首次 commit 因环境没有作者配置而失败关闭，未生成提交；随后只在单次命令复用仓库最近提交作者 `Cyrus <cyrus@local.invalid>`，没有修改全局或 repo-local Git 配置。commit receipt=`../local/receipts/op_b_g4_0_project_control_rebind_hotfix_20260825_01-commit.json`，SHA-256=`a21b4f9e3108bc9bbc8d277230f07903e113e0f35c208af686ff8b5ad505abf3`。
- 提交后轻量门禁：checkout 1265 files、governance 22/22、launch、`git diff --check` 全过；未重复运行正式 `npm test`，因为提交 blob 与此前唯一一次 826/826 验收候选逐字节一致，也没有生成新 package set/run。
- 本次只推进治理指针：B-G4-0/G2-P2 状态改为 committed-local，下一门为 `B-G4-0-PUSH-RELEASE-AUTHORIZATION`。未 push、publish、安装 Stable、写真实 Stable 数据、执行 Amazon rebind、删除文件或开始 B1b。

## 2026-08-26：G2-P2 package-set 任务身份与精确清理闭环完成

- packed E2E 不再用 PID/时间戳冒充任务身份：`resolvePackedLogicalTaskId` 从 Project Home 已验证身份和 `docs/governance/current-state.json::nextTask.id` 取得稳定 logical task ID；可选环境覆盖若与权威指针不一致，返回 `PACKED_LOGICAL_TASK_ID_MISMATCH`。
- 新增 append-only `package-set-build-task/v1` claim ledger：同一 logical task 跨 Node 进程只能 claim 一次物理构建，来源变化返回 `PACKAGE_SET_TASK_SOURCE_CHANGED`，同来源重复 claim 返回 `PACKAGE_SET_TASK_ALREADY_CLAIMED`，失败 claim 不自动重试。G2-P2 真实 claim revision 2=`completed`，`physicalCreated=false`，正式 packed 复用了既有 `f515424f...`，物理包始终没有增加到第四套。
- 新增 `authorized-superseded-package-set/v1` 清理计划：只接受 Project Home receipts 内 hash 固定、精确允许完整 package tree hash 的 Cyrus 授权；目标必须 RETIRED、零 live run 引用，superseder 必须 ACTIVE。apply 仍复用原有 registry revision、marker/tree hash、journal、verify 和 append-only receipt 合同。
- 红测试为 5 tests / 0 pass / 5 fail；实现后 G2-P2 7/7，lifecycle/package-set 组合最终 25/25。唯一一次正式 `npm test` 为 826/826，fail/cancelled/skipped/todo=0；18 插件门禁通过，Project Control 保持 185/185。
- 精确清理预览最初因 context receipt 只写了 `496b3357` 缩写而以 `AUTHORIZED_CLEANUP_SCOPE_MISSING` 失败关闭，未写计划、未删除；随后追加完整 hash 授权 supplement，未覆盖原 receipt。最终 plan 只含 `pkg_496b3357...8512d`，registry revision 36、838,063,243 bytes、RETIRED、引用 0，`f515424f...` ACTIVE。
- lifecycle apply receipt=`local/receipts/op-g2-p2-superseded-496b-cleanup-20260826-01-cleanup-receipt.json`，状态 `applied-and-verified`，只删除批准的 `496b3357...`，释放的计划字节 838,063,243；registry revision 37。后验仅余 `58adf7b2...` RETIRED 与 `f515424f...` ACTIVE，两者各精确命中一条 live registry，unknown/missing=0。B-G4 验收 run 已完成为 RETIRED/successful-run，registry revision 38。
- 删除对象不能直接恢复，但它是 superseded 中间 build；可在恢复其 source receipt 对应源码状态后重新构建。未删除 A 线证据、Amazon 文件、真实 Stable 数据或另外两套 package set；该验收阶段未 commit/push/publish/install/rebind。后续精确 commit 已单列记录在上方，push/发布/安装/rebind 仍未发生。

## 2026-08-25：B-G4-0 收口发现 G2 package-set 任务身份漏洞，发布暂停

- B-G4-0 产品候选和本地验收本身保持通过，但在写最终 receipt 前发现正式 `npm test` 的 packed E2E 使用 `g2-p0-formal-${process.pid}` 作为 `operationId`；同一逻辑任务的两次全量运行因此被生命周期系统误判为两个任务，没有执行“每任务最多新增一套物理 package set”的限制。
- 本任务新增了两套已登记、可审计的 package set：`sha256-496b3357...`（838,063,243 bytes，`taskId=g2-p0-formal-44820`，RETIRED）与 `sha256-f515424f...`（838,063,627 bytes，`taskId=g2-p0-formal-30088`，ACTIVE），合计 1,676,126,870 bytes；任务前既有 `sha256-58adf7b2...` 保持 RETIRED。三套均有 `package-set.json`、build receipt 和 registry 记录，不是 unknown/unmanaged 文件。
- 两套新包来自候选在 typecheck 修复前后的真实字节差异；首套与最终套的源码证明差异包含 `plugin-set.lock.json`。最终候选仍是 `f515424f...` 对应状态，不能把首套 `496b3357...` 当成最终发布依据。
- 没有删除、覆盖或手工改台账；B-G4 run 继续保持 ACTIVE，最终任务 receipt 暂不生成。发布、commit、push、Stable 安装和真实 rebind 全部暂停，先等待 Cyrus 批准 G2-P2：稳定逻辑 task identity、同任务物理包上限的跨进程失败关闭、机器回归测试，以及通过生命周期计划处理 superseded same-task set 的受控路径。

## 2026-08-25：B-G4-0 本地候选完成并停在真实发布/安装闸门

- `linked_legacy` relocation 不再伪造 `managed_manifest`：Host 使用所有已登记 binding 的稳定排序摘要生成 `legacy_fingerprint`，并要求新候选至少一份文档 SHA-256 与已登记文档相交；无交集返回 `IDENTITY_EVIDENCE_REQUIRED`，不提交 lifecycle。
- CandidateDetails 已补内部纵向滚动和底部 sticky action，长候选的确认操作可达；没有新增第二套 rebind HTTP/存储路径。
- Project Control 升为未发布的 `0.1.0-rc.9` v2 独立候选；Ajv 及其运行依赖只打入 Host bundle，发布 allowlist 只精确开放 Project Control，默认发布集合未扩大，Memory 仍禁止外置。
- 最终本地单插件资产 `cyrus-dsh-project-control-0.1.0-rc.9.tgz` 为 271,580 bytes，SHA-256=`01e0a7785a13227422d6e5e5c3677c2b9cf50bc146e4821718c4b3cc598902ca`；index、release manifest、plugin lock 一致。
- 最终隔离验收完成 `rc.8 builtin → rc.9 external generation → Host import → activation commit → builtin rollback`，临时 profile 已删除；PASS receipt 位于受管 run `b-g4-0-project-control-rc9-20260825/isolated-generation-final-receipt.json`。
- 验收脚本第一次把 profile scope 组合视图错当成插件实体而失败；失败 receipt 与修正后 PASS receipt 均保留，未覆盖。随后 typecheck 又发现 8 个 Project Control 既有/本次可空值错误，全部做最小收窄并重建最终资产，旧 `15c36c...` fixture 只作 superseded 证据。
- 最终门禁：`npm test` 819/819（fail/cancelled/skipped/todo=0）；`npm run check:plugins` 全部 18 插件通过，Project Control 185/185；governance 22/22、checkout 1,264 files、launch、lock check、`git diff --check` 全绿。
- 全程未改 migration/DB schema/B1b/真实 Stable/A 线 Release/Amazon 文件，未 commit/push/publish/install/rebind/delete。下一步必须由 Cyrus 单独授权候选提交、发布、真实 Stable 安装和真实 rebind。

## 2026-08-25：B-G4-0 rebind hotfix 开工基线

- Cyrus 批准先走治理闭环，再复用 A 线 generation 逻辑修复 Project Control；真实发布和 Stable 安装保留为独立门禁。
- Amazon 旧目录已同盘移动到 `F:\Projects\amazon-store\local\legacy-source\amazon-store-before-g4-20260825`，未删除、未复制；文件系统 receipt 与预操作 DB 备份位于 Amazon Project Home `local`。
- Stable 只读复核：候选 `can_01a038b2-d821-7fac-ae47-fe28a94a5c78` 为 `relocation_candidate`，manifest project_id 与正式 ID 一致，目标是 canonical workspace；项目仍 revision 1、旧 location active、path history 为空、integrity=`ok`。
- 唯一一次获批 prepare 在 lifecycle 提交前返回 `INTERNAL_ERROR`；失败后立即停止且未重试。根因是 `linked_legacy` relocation 固定构造 `managed_manifest`，同时 CandidateDetails 缺少内部滚动。
- 本任务不改 migration/DB schema/审批 B1b/真实 Stable/受保护 F 数据，不 commit/push/publish；先红测试，再实现，再做一套共享 package set 的隔离插件更新验收。

## 2026-08-25：Amazon 正式身份与治理权威状态纠偏

- Cyrus 明确：Dev 只作测试，所有正式项目身份以 Stable 或正式宿主为准；因此旧 `dev_and_stable_project_id_conflict_unresolved` 不再是正式身份阻断。
- 对 Stable Project Control SQLite 以 `readOnly + PRAGMA query_only=ON` 复核：`prj_01a01cb7-b3f5-7dd3-932f-1adc4d16a1dd` 唯一命中「亚马逊运营主架构 · PRD」，`mode=linked_legacy`、`origin_kind=imported`、`lifecycle=active`、revision 1；active primary location 为 `loc_01a01cb7-efbd-700e-92e0-59aec8ea1bb2`，仍指向 `F:\documents\Kimi\Workspaces\Amazon Store`。
- Amazon Project Home 已写入与 Stable ID 一致的正式 `project-home/v1` marker 和 `.dsh-project/project.yaml`；原 `project-home.pending.json` 原样保留为迁移前历史证据，不再作为当前入口。
- 当前只完成治理身份对齐，没有修改 Stable 数据库、binding、Kimi 配置或目录，没有创建 junction，没有移动/删除旧 Amazon 目录。下一步是让 Amazon 的 Codex 任务从 canonical workspace 做观察；Kimi 兼容切换和 Stable rebind 仍分别失败关闭。

## 2026-08-25：G4 Amazon 文件系统试迁完成并按约暂停

- Cyrus 明确把本轮缩回简单文件迁移：Amazon 的 Skill、MCP/工具、课程和调研/业务资料进入 `F:\Projects\amazon-store\workspace`，3 个加密文件只进入 `local/secure`；Project Control 注册/binding 不再作为复制前置条件，也没有伪造 `project_id`。
- 复制阶段逐文件 SHA-256 验证 5,255 个文件 / 3,246,852,499 bytes 全部一致。旧 `Temp/tmp` 的 16,037 个临时/缓存文件 / 1,133,347,993 bytes 没有制造第二份，继续只留在旧源作历史回查；新 `local/runtime/Temp` 验收时为空。
- 只修复 9 个实际入口的旧根路径、secure 与 runtime 路径；5 个 Python 模块解析/导入和 7 个路径常量通过，SellerSprite Skill 30/30、3 份 MCP/Skill JSON、Keyring CLI `--help` 均通过，没有读取密钥正文或发起付费 MCP 调用。
- Amazon 已补最小治理入口 `GOVERNANCE_INDEX/AGENTS/PRD/NEXT/BLOCKED/PROGRESS`；旧源 21,292 文件 / 4,380,200,492 bytes 保持原状。复制与验收 receipt 分别为 `local/receipts/op_g4_amazon_migration_20260825_01.json`、`op_g4_amazon_migration_20260825_01-acceptance.json`。
- 主仓闭环复核通过：正式 `npm test` 816/816（fail/skipped/todo=0），治理 22/22，checkout 1,263 文件，launch 与 `git diff --check` 全绿；packed 长测复用 G2 现有唯一 package set，未新增测试包。
- Amazon G4 的 7 份主仓治理状态文件已按白名单提交为 `216cfc481dd7084872272b51795864bd39443d14`（父提交 `76197c8`），commit 后工作树干净；commit receipt 为 `local/receipts/op_g4_amazon_migration_20260825_01-governance-commit.json`。未改 Git 配置、未 push、未发布。
- 按 Cyrus 边界现已暂停：量化、meal_tracker/食溯、B1b、真实 Stable/Dev 切换、Project Control binding、旧源删除均未开始。

## 2026-08-25：G4 Amazon 试迁此前在复制前因范围与身份冲突失败关闭（历史闸门，现已由 Cyrus 缩范围解除）

- 只读盘点确认旧源 `F:\documents\Kimi\Workspaces\Amazon Store` 实际为 21,292 文件 / 4,380,200,492 bytes / 3,201 目录，不是治理文档所写的“主要是 Skill 和调研报告”。其中 `Temp` 1.13 GB、`courses` 1.09 GB、`tools` 2.14 GB（`video_pipeline` 2.12 GB），并有 3 个加密 `secure` 文件；未读取密钥正文。
- 源目录没有 Git、manifest 或完整 project_id。Dev 只把 `tools` 作为另一个项目的 primary location；AppData Stable DB 为 0 项目，旧盘点仅保留独立 Amazon Stable ID 的截断前缀。真实 Stable 外部数据仍受保护，未读取；因此不得生成新 ID 冒充或直接写 Project Home marker。
- `F:\Projects\amazon-store` 仍不存在，源目录零写入，量化/食溯零触碰。推荐在 Cyrus 合并批准“只读取精确 Stable Amazon ID + 分区式两阶段迁移”后再复制；preflight receipt 为 `local/receipts/op_g4_amazon_preflight_20260825_01.json`。

## 2026-08-25：G3 跨 Harness shadow 试点通过，等待本地基线提交

- G3 主仓 11 文件候选已按 receipt 精确提交为 `1f8fcd6d2d7d3aba88f8fe9af4f0bbe4daac84c7`（父提交 `834f7bb`）；commit blob 与候选逐文件一致，未 push、未发布。候选与 commit receipt 分别为 Project Home `local/receipts/op_g3_cross_harness_20260825_01.json` 和 `op_g3_cross_harness_20260825_01-commit.json`。
- 新建标准 Project Home：`F:\Projects\toolbox` 与 `F:\Projects\memory-system`，均使用 `workspace/worktrees/local` 三分区；UUIDv7 只在本地 manifest/marker 保留，未写真实 Project Control DB。两仓分别形成干净本地提交 `600b296` 与 `c0a0b03`，无 remote、未 push、未发布。
- D5-0 最小工具层已冻结七份 schema、surface registry、七类 Harness descriptor、base/项目 profile、六态 resolver、retire receipt 语义拒绝器、逐实例投影 adapter 和完整 `project-governance-context` Skill。Toolbox 测试 18/18、Skill 结构校验通过。
- DSH Dev 与 Codex 均完成 apply → doctor → rollback → re-apply；最终 Skill 树 SHA-256 均为 `998e3d...2089c`，状态仅为 `applied_shadow`。执行中发现 doctor 错拿 registry 首实例检查 Codex receipt 的 bug，已改为按 `harnessInstanceId` 精确选择并补回归测试。
- `memory-host/v1` 只发布 `memory_status`/`memory_recall`。同一 stdio host 进程并发服务 DSH Dev/Codex，结果 hash 一致；缺身份 recall、未知 instance、跨项目查询稳定拒绝，负控 sentinel 泄漏为 0。Memory 测试 6/6，最终 receipt 为 `F:\Projects\memory-system\local\receipts\op_g3-memory-host-pilot-20260825-02.json`。
- DSH settings、Codex config.toml、Dev/Stable Project Control DB 的前后 SHA-256 均完全一致；未修改真实 Stable、真实 binding、凭据、B1b、A Release 或受保护 F 数据。Global AGENTS 唯一规范源已转到 Toolbox；Personal 仓库旧副本留档，旧无 receipt 直写入口失败关闭。

## 2026-08-25：G2-P1 local 生命周期机器闭环本地验收通过

- G2-P1 的 14 文件候选已按外部 receipt 的逐文件 hash 精确提交为 `535185b01fe6be76d7256665029be774b77b5d27`（父提交 `8dff0e3`）；commit blob 集与候选完全一致，提交后工作树干净，未 push、未发布。候选与 commit receipt 分别为 Project Home `local/receipts/op_g2_p1_20260825_01.json` 和 `op_g2_p1_20260825_01-commit.json`。
- 新增 `scripts/local-lifecycle.mjs`：Project Home `local` 对象使用 append-only registry snapshot，package set/run 创建或受控对账即登记 `project_id`、owner、task、状态、预计字节、retention class、marker hash 与来源 hash；路径越界、身份不符、未知目录、symlink/junction/reparse point 和 marker/包体漂移均失败关闭。
- 固化可版本化 `recommended-v1` 本机 policy：成功 run 取“最近 2 次且 7 天内全部保留”的 AND 语义；失败 run 最近 3 次、至少 14 天且 issue 未关闭不删；中断 run 72 小时；package set 最近 2 套且 7 天内全部保留；PINNED/ACTIVE/QUARANTINED 与被 run 引用的 package set 永不进入自动目标。登记总量上限 20 GiB，大任务后仍须保留至少 5 GiB 空间。
- cleanup 实现 plan → hash/policy/revision check → apply → verify → append-only receipt；apply 每删一个对象即写 append-only journal，中断后只能从同一 plan hash 续跑。真实递归删除只在 `dsh-local-lifecycle-*` 一次性 task-owned fixture 中验收，现有 package set、旧 `artifacts` 和任何真实项目源均未作为删除目标。
- run 创建前强制验证调度健康、未知对象、磁盘和总配额；package-set build 同样强制 preflight。健康周期为 24 小时，另有 12 小时补跑宽限；关机期间不冒充准点执行，逾期后任何新大型 run/build 失败关闭。Windows 计划任务未创建，符合当前系统配置禁令。
- 首次真实 packed 发现“来源哈希变化但 win-unpacked 字节完全相同”会命中相同内容地址，旧代码误报 destination invalid。失败 staging 自动清零、旧包未变。修复为外部 append-only package-set provenance ledger：同一 58ad… 包体只保留一份，不同源码证明分别登记；当前物理 package set 仍为 1 套，provenance 为 2 个小 JSON。
- 红测试：`test/local-lifecycle.test.js` 初始 12/12 fail；修复后定向组合最终 29/29。真实 packed 定向 1/1；正式 `npm test` 818/818，fail/cancelled/skipped/todo 均为 0。governance 21/21、checkout 1263 文件（LF 1235 / CRLF 10 / binary 18）、launch 与 diff 全绿。
- 后验卫生：`win-unpacked` 仍为 5244 文件 / 837,790,443 bytes，package sets=1、staging=0、local runs=0、临时 packed profile=0、Smoke 残留=0。旧 workspace `artifacts` 仍为 5233 文件 / 837,754,746 bytes，旧日志 4581 bytes、SHA `90FDCDF2C16C89074806A141C9950EB55884C812BB7229242D0A881A2A487535`，零漂移。
- G2-P1 未创建系统计划任务，未开始 B1b，未触碰 migration/DB/HTTP/UI/侧栏/收件箱、真实 Stable/Dev binding、A Release、上游或受保护 F 数据。下一步按既定顺序进入 G3 toolbox Skill + memory-host 双端只读试点；G4 仍只允许 Amazon 单项目试迁并在验收后暂停。

## 2026-08-25：G2-P0 packed package set 不可变性本地验收通过

- 根因关闭：`src/main.js::appendBootLog` 不再按应用源码目录推导日志位置，新增纯函数/写入 seam，把日志固定到当前 Electron 实例的绝对 `userData\logs\boot-error.log`；Stable、Dev、smoke 因 userData 不同自然隔离。
- build receipt 升级为 schema v3：新 writer/build 工具加入 source hash，除 `resources/app` 外新增完整 `win-unpacked` 文件数与树 SHA-256；`boot-error.log` 不再是排除项，任何 package set 文件增删改均失败关闭。
- 新增 Project Home managed package-set seam：只在 `local/package-sets/.staging/<operation>` 构建，F 盘低于 5 GiB 失败关闭；成功后按完整树 hash 固化为 `local/package-sets/sha256-<hash>`，相同 source/package receipt 自动复用，失败 staging 只按所有权边界清理。`pack-desktop.js` 的输出覆盖只允许落在该 `.staging` 根，不能借环境变量写任意路径。
- 红测试证据：初次定向运行 13 项中 4 项失败，分别证明缺少 boot-log 模块、缺少 package-set 模块、完整包外层文件漂移未检出、`boot-error.log` 被错误排除。修复后定向组合 22/22，全量正式 `npm test` 802/802，fail/cancelled/skipped/todo 均为 0。
- 真实 packed 验收只新建一套 `sha256-58adf7b2c17a51a330116919375dcc7562db059323602d696b88299d78af7c3d`：5244 文件 / 837,790,443 bytes。激活、重启 ACTIVE、回滚三次启动全部引用同一套；每次结束后的完整树逐文件 SHA 与启动前一致，日志只出现在临时 userData。正式全量再次复用该套，没有第二次构建。
- 后验卫生：managed sets=1、staging=0、临时 `dsh-packed-e2e-profile-*`=0、Smoke 进程=0；旧 workspace `artifacts` 仍为 5233 文件 / 837,754,746 bytes，旧 `boot-error.log` 4581 bytes、SHA `90FDCDF2C16C89074806A141C9950EB55884C812BB7229242D0A881A2A487535`，零漂移且未删除/截断。
- G2-P0 没有修改 B1b migration/DB/HTTP/UI/侧栏/收件箱，没有触碰真实 Stable/Dev binding、A Release、上游或受保护 F 数据。下一步为 G2-P1：registration、retention、quota 与 cleanup plan/apply/verify/receipt，只在 task-owned fixture 上做删除验收。

## 2026-08-25：G1 精确提交完成，live-state 转向 G2-P0

- Cyrus 授予“治理与开发连续执行包 V1”：当前治理收口及 G2/G3 内通过 receipt 与门禁的本地 commit、任务自有临时文件清理不再逐项询问；push、发布、真实 Stable/Dev 切换与旧项目源删除不在授权内。G4 进一步收紧为 Amazon 单项目试迁，Amazon 验证后必须暂停，量化和 meal_tracker/食溯等待新决策。
- Cyrus 明确授权 receipt 冻结的一个 G1 commit；Git index 的 35 个路径、逐 blob 字节与聚合 SHA-256 `728414A24D740258AD7482AB6E2D146118552FF7B1BF521E0B4F2004ACD3ADA2` 均与候选 receipt 一致后，提交为 `f5c58e5874a977aa5104a092e2e7c03472b6a4d7`（父提交 `28d7c8c25e7e879fba8b9170a4ecad8b4ad0d8ef`）。未 push、未发布。
- 首次 `git commit` 因本机没有作者配置而失败，未产生中间 commit；随后只用上一笔 canonical commit 的既有身份 `Cyrus <cyrus@local.invalid>` 作为一次性参数完成提交，没有修改 repo-local 或 global Git 配置。
- 外部提交结果 receipt：`local/receipts/op_g1_project_home_20260825_01-commit.json`，记录授权范围、commit/tree/parent、候选 receipt hash、提交后门禁和未 push/发布边界。
- 提交后轻量门禁复核：governance 21/21、checkout 1257 文件、launch ready、`git diff --check` 通过；工作树与暂存区为空，`artifacts` 仍为 5233 文件 / 837,754,746 bytes，临时 packed profile 与 Smoke 进程均为 0。
- 本次 live-state 对齐只把人机入口从“等待 G1 commit”推进为“G1 已提交、G2-P0 下一步”；不修改产品代码，不开始 G2/B1b，不产生 package/run。新的治理收口 commit、push、发布仍是独立授权闸门。

## 2026-08-25：G1 Project Home 本地实现完成，发现 packed 资产可变性 bug 后停在决策闸门

- Cyrus 后续拍板：G4 迁移顺序改为 Amazon Store → 量化 → meal_tracker/食溯；packed 日志追加保留为证据，不扩大 G1，修复转为 G2-P0；G1 生成 `local/receipts/op_g1_project_home_20260825_01.json` 后停在独立 commit 授权闸门，本轮不 commit。

- G0.5 已按冻结清单提交为 `28d7c8c25e7e879fba8b9170a4ecad8b4ad0d8ef`（父提交 `c27e989381c34dc06d4f4af1845f6122c0b00c2b`），未 push、未发布；G1 全部工作落在该 canonical 基线上。
- 新增 `project-home/v1` 严格 schema、8 个 valid/invalid fixtures、Host 纯函数 validator；固定 `.project-home/project-home.json`、`workspace`、`worktrees`、`local`，marker 与 workspace manifest 的 `project_id` 不一致时失败关闭。
- 三个旧 `1.0.0` 模板字节未改且仍可加载/回放；新增 minimal/software/research `2.0.0`，新建列表只展示三分区版本。模板创建 workspace/AGENTS、INDEX/PROGRESS/NEXT/BLOCKED、D3 文档骨架、worktrees/local receipts，并把未知 token、布局混用和伪造 zone 拒绝在 Host。
- create Write Plan 的文件目标改为整个 Project Home，primary location ref 精确指向 `Project Home\workspace`；storage 只允许历史 target 本身或其固定 `workspace` 子路径，拒绝 `local`、`worktrees` 和任意子目录。未新增 migration/table，未修改 HTTP/UI/侧栏/收件箱，未写真实 Stable/Dev binding。
- 兼容性回归已闭环：旧 legacy upgrade 在 Windows 8.3 短路径与长 normalized path 组合下曾被新 location 约束误拒；修复为继承 target normalized path 后，upgrade 5/5 与 Project Control 183/183 全绿。
- 机器验证：三项定向组合 30/30；`node --test "plugins/project-control/test/*.test.js"` 183/183；`node scripts/build-plugins.js` 成功并重建/校验 Project Control bundles；正式 `npm test` 796/796，fail/cancelled/skipped/todo 均为 0。插件目录单独 typecheck 因该目录没有自己的 node_modules/tsc 无法启动，但实际 tsdown 构建已成功，不将失败命令伪报为通过。
- 正式全量门禁没有生成新安装包或持久 run：`dsh-packed-e2e-profile-*`=0、Smoke 进程=0、`artifacts` 文件数仍为 5233。但 packed 应用的 `appendBootLog` 把启动记录写回 `artifacts/win-unpacked/resources/app/boot-error.log`，使该既有文件追加 1,527 bytes，目录总量从 837,753,219 变为 837,754,746 bytes。未删除、截断或覆盖该证据。
- 该行为说明“共享只读 package set”尚未真正只读：正确方向是把 boot log 写到隔离 userData/local，而不是应用资源目录；这会触及 A 线共享 `src/main.js`，超出 G1 狭义白名单。Cyrus 已拍板保留日志证据并把修复转入 G2-P0；G1 receipt 完成后只等待单独 commit 授权，B1b 继续暂停。

## 2026-08-25：G0.1 A 线清理对账与 remote 治理收口

- A 线清理结果已从 `D:\Deepseek Harness Personal\artifacts-dev\e2e-runs\A-LINE-EVIDENCE` 做只读复核：六个权威 A 线 run、Stable 最终 `E2E_OK` 和五份 JSON 证据存在且可解析；清理前验证 hash 与 wave2 receipt 一致；被批准删除的三个失败 Stable run、旧 artifacts/cache 和旧 `D:\dsh-v0.4.3-clean` 均不存在。
- F 盘只新增小型 reconciliation receipt 并登记来源 SHA-256，没有复制 A 线 Harness、Node、安装包或 run。workspace 已有 ignored `artifacts/` 仍是 5233 文件 / 837,753,219 bytes，本轮不删除也不扩增，继续交给 G2。
- `check-governance` 的旧“必须没有 remote”规则已改为“只允许机器索引精确登记的 remote”：当前只允许 canonical `origin` 固定 URL；额外 remote、URL 漂移和显式 `pushurl` 均失败关闭。remote 存在只用于来源追溯，不构成 commit/push/publish 授权，现有 Git remote 配置未修改。
- 已登记 G2 前临时 packed 测试边界：人工测试只从 F 盘 canonical 生成；每任务最多一套按内容寻址的共享只读 package set，run 只引用、不逐 run 复制；无磁盘 preflight 和明确 packed 范围不开跑。本 G0.1 只运行轻量治理门禁，不生成 package 或 E2E run。
- G0.5 已冻结候选逐文件清单和聚合 hash，确认 ignored `artifacts/`、package 与 run 未进入候选；freeze receipt 单独放在 Project Home `local/receipts/`，不加入源码候选形成自引用。当前停在 Cyrus 的单独 commit 授权闸门；push/publish 仍未授权。B1b 继续暂停。

## 2026-08-25：F 盘权威基线与 B1a 治理收敛（此前阶段）

- 已按 Cyrus 决策创建 `F:\Projects\deepseek-harness-personal\{workspace,worktrees,local}`，Project Home marker 绑定 Stable Project Control 权威身份 `prj_01a0082e-fea8-7d6f-b6c2-08a259fba389`；当前仍标记 `bootstrapping`，不冒充 Console 机器能力已上线。
- `workspace` 是从 GitHub 独立克隆的 canonical 候选，分支 `codex/governance-alignment`，父基线精确为 A 线最终 `c27e989381c34dc06d4f4af1845f6122c0b00c2b`；不依赖旧 D 盘 worktree 的 Git common-dir。
- 已建立 47 项带来源 SHA-256 的迁移计划：33 个 B1a 文件保持来源字节/hash；5 个新增治理文件先原样导入，其中 3 个仅追加当前实施状态；1 个 K3 输入包原样导入后追加“非权威/过期口径”横幅；8 份 A/B 共用文档按 hunk 合并。禁止把追加治理注释的文件伪报为 exact-copy。
- B1a 33 个协议/校验器/测试文件已完整迁入新基线。其来源验收为定向 28/28、Project Control 全量 177/177、skipped/todo 均为 0；迁入后的组合测试尚待本轮重新执行，因此 B1b 仍暂停。
- 已合并 ADR-009、三分区治理合同、路径绑定盘点、D3/D4/D5 与 Prompt/AGENTS 治理增量；已生成机器可读治理总索引、current-state、workspace 根 AGENTS 与 `.dsh-project/project.yaml`。下一步生成导入/晋升 receipt 并执行 A+B 组合门禁。
- 导入 apply receipt 已生成于 Project Home `local/receipts/op_canonical_workspace_import_20260825_01-apply.json`：33 个 B1a 文件全部 exact hash 对齐；35 个文件保持来源 hash；4 个文件在原样导入后仅追加状态/非权威横幅；8 个冲突文档按 hunk 合并。此前“39 exact”是统计口径错误，已在 NEXT/current-state 更正。
- 组合验证失败关闭：manifest PASS；B1a 28/28；Project Control 177/177；全仓 783 tests / 780 pass / 3 fail / 0 skipped。根因是 system `core.autocrlf=true` 且仓库无 `.gitattributes`，导致新 clone 的源码由 Git blob LF 变成工作区 CRLF，破坏 Workbench LF 正则和 A 线 build receipt 字节 hash；Electron EBUSY 属首次并发懒下载，定向重跑 1/1 已通过。未生成 baseline promotion receipt，B1b 继续暂停。
- 已按 Cyrus 拍板完成 checkout 三层闭环：第一层新增仓库 `.gitattributes` 并将本仓 repo-local Git 固定为 `core.autocrlf=false`、`core.safecrlf=true`；第二层对 1105 个文本文件做有计划、拒绝裸 CR、逐文件复核的纯换行归一化，不覆盖修改内容、不碰未跟踪 B1a；第三层新增 `scripts/check-checkout-contract.js`、3 个机器测试并接入 `verify-launch`。门禁最终扫描 1240 文件：LF 1212、CRLF 10、binary 18，PASS。
- EOL 修复后的回归：Workbench 20/20、B1a 28/28、Project Control 177/177；正式仓库入口 `npm test` 为 786/786，fail/cancelled/skipped/todo 均为 0，含 stable packed Electron/Harness 外部插件激活、重启 ACTIVE、回滚 builtin 的真实 E2E。一次裸 `node --test` 得到 787/789，是 Node 25 把两个 Electron fixture 当普通测试误发现；真正 Electron 集成测试通过，故已把正式入口与禁用裸命令写入治理索引和 AGENTS。
- `node scripts/check-checkout-contract.js` PASS，`node scripts/verify-launch.js` PASS，`git diff --check` PASS；`check-governance` 仅余 1 项：canonical clone 存在 `origin`，与旧“禁止 remote”规则冲突。未删除 remote、未放宽脚本，已作为显式治理决策项保留。
- G0 已形成 checkout apply receipt 与 baseline promotion receipt；Project Home marker 只晋升为 `canonical-workspace-locally-validated`，不冒充 G1 Project Home 产品合同、真实 binding、retention 或跨 Harness 已完成。B1b 继续暂停，下一执行指针为 G1。
- 正式 packed E2E 的临时 `dsh-packed-e2e-profile-*` 已自行清零；但 workspace ignored `artifacts/` 当前登记为 5233 文件 / 837,753,219 bytes（约 799 MiB）。因 G2 retention/cleanup 机器合同和删除授权均未具备，本轮保留并写入 current-state/BLOCKED/receipt，不把它伪报为“无残留”。
- 未修改 A Release、真实 Stable、`F:\documents\Cyrus Deepseek Harness Data`、只读上游 `D:\Deepseek Harness`；未删除旧目录，未 commit、未 push、未发布。

- R-ED WYSIWYG 编辑态：方向已获 Cyrus 认可（编辑=所见即所得单面板、无预览/分屏；长文档渲染卡死已根治——Decoration.line→mark；工具栏/围栏补全/自动保存/布局齐全）。剩余：排版逐项对齐 Obsidian 质感——待办与坑清单见 [`NEXT.md`](NEXT.md) 顶部「R-ED WYSIWYG 收尾交接」段（2026-08-19 换 Session 交接）。
- 项目已于 2026-08-15 正式移交给 DeepSeek Harness 自主维护。移交入口为 [`HANDOVER_TO_DEEPSEEK_HARNESS.md`](HANDOVER_TO_DEEPSEEK_HARNESS.md)，下一阶段执行清单为 [`NEXT.md`](NEXT.md)；后续状态必须回写仓库文档，不能只保留在 Session 中。
- AnySearch 第三方网络搜索插件（测试版）已落地并验收：`plugins/anysearch` Host 注册 `ctx.web` provider `anysearch`，Client 注册独立设置页 `设置 → AnySearch 搜索`，`cordis.patch.yml` 显式把 `web.searchProvider` 切到 `anysearch`。`check:plugins`、`pack:dev:portable` 与测试版 stage 均通过，Cyrus 已在测试版完成真实 `web_search` 搜索验收；稳定版不做单独封装，留待全部测试完成后的统一发布。
- DeepSeek Harness 已于同日完成 P0 接手验证：上游 `D:\Deepseek Harness` 无漂移（`47f943`/rc.5），`pnpm test` 241/241、`check:plugins` 十三插件全过、开发态 Electron smoke 通过（schema 5、四轨、优雅退出、端口关闭）；本机无全局 pnpm，门禁以 `npx pnpm@11.19.0` 执行。验证结果已记入 DEVLOG。
- Gate 2D P1 合同已冻结：新增 [`PROJECT_TEMPLATE_SPEC.md`](PROJECT_TEMPLATE_SPEC.md) 与模板机器 Schema/fixtures/合同测试（7/7），write plan 沿用已冻结 lifecycle Schema 并补齐 Host 规则、W1–W4 崩溃恢复、文件先提交复验再进 SQLite 的一致性协议与结果表。
- Gate 2D P2 受控文件适配器已完成：迁移 `0006_file_sync_plans.sql` 把 SQLite 升到 `schemaVersion=6` 并持久化 write plan journal；`src/filesync/plan-executor.js` 实现同盘 staging、`wx`+fsync、逐文件哈希核对、原子 rename、TOCTOU 二次 absent 检查、只删本次 rename 路径的回滚与启动恢复（resumable/quarantine）；scanner 跳过 `.dsh-staging.` 残留。`plugins/project-control/test/filesync.test.js` 15/15（仅临时 fixture）。
- Gate 2D P3 标准项目快速新建已完成（Host 管线 + Console 表单 UI）：内置三模板（minimal/software/research@1.0.0）+ `templates/registry.js` 校验渲染；迁移 `0007_file_sync_plan_refs.sql` 把 SQLite 升到 `schemaVersion=7`；`GET /templates` 与 `POST /intake/prepare-create` 签发签名 create 命令，`createProject` 在文件提交复验后原子登记 managed 项目并产生 `project.managed.created` Event；启动恢复与 `create-parent` 授权票同步接入；Project Console 提供父目录选择、名称输入、模板下拉、逐项预览与确认创建（成功仅刷新列表、不切换会话），smoke 校验 `projectCreatePresent`。`plugins/project-control/test/create.test.js` 9/9（含第二控制面凭项目文件恢复身份的 portability 验收）。
- Gate 2D P4 Legacy 安全升级已完成：`POST /intake/projects/:id/prepare-upgrade` 生成最小计划（只新增 `.dsh-project/project.yaml`，fingerprint 绑定已确认文档绑定），`resolveUpgrade` 复核签名/指纹/逐份文档哈希/确定性重渲染，`registerUpgradeManaged` 在文件提交复验后原子完成 mode→managed/revision+1/mirror/`project.managed.upgraded` Event；文档变化与路径占用均 rejected 且 mode 不变。`plugins/project-control/test/upgrade.test.js` 5/5。
- B 档启动安全已完成：`scripts/verify-launch.js` 启动门（十三插件双 bundle 语法/client id、桌面主进程文件、migrations 0001–0008）接入 `pnpm start` 与双击 `.cmd`；`build-plugins.js` 逐插件构建后即校验产物。
- Gate 2D P5 项目文档刷新与索引同步已完成：迁移 `0008_document_index.sql` 把 SQLite 升到 `schemaVersion=8`（`project_document_states` 逐绑定状态/哈希/解析诊断 + `project_document_rebind_proposals` 人工确认重绑提案）；Host 管线 `src/document-index.ts` 有界读取并核对（managed 以 manifest mirror 为准、legacy 以确认绑定为准），记录 ok/changed/missing/unreadable 与 frontmatter/YAML 解析诊断，缺失文档按内容哈希搜重命名候选；无歧义可一键应用、多候选必须人工选择、managed 提案仅诊断（重绑被拒，需先改 manifest）、结果粘滞且恢复后 superseded；刷新不产生 Event/Outbox、不推进 WorkItem/Review、正文绝不入库。HTTP 新增 `GET /projects/:id/documents`、`POST /projects/:id/documents/refresh`、`POST /projects/:id/document-rebinds/:proposalId/resolve` 与三项 capability；Console 新增文档索引面板。`plugins/project-control/test/document-index.test.js` 5/5（仅临时 fixture）。
- C 档运行时隔离已完成（稳定版/开发版双入口统一在仓库根目录）：`scripts/sync-runtime-stable.js` + `启动 DeepSeek Harness 稳定版.cmd`（日常使用，从 `runtime-stable/` 启动，与开发树完全隔离）+ `启动 DeepSeek Harness 开发版.cmd`（插件开发验证）+ `test/runtime-stable.test.js`（2/2）；开发编辑/重建与日常客户端完全隔离（修复了两次开发期客户端崩溃的根因）。模板目录解析修复（源码/bundle 双形态）+ 控制台字号放大同步完成；smoke 新增模板接口校验。稳定版启动的三项根因（漏拷 `cordis.patch.yml`、GBK 代码页破坏 `.cmd` 解析、单实例锁静默退出）已修复并由 Cyrus 双击桌面图标确认正常启动；`boot-error.log` 作为永久启动诊断。另新增运行中实例守护：`scripts/stable-instance-detect.js` + `sync-runtime-stable.js` 换入前检测，稳定版运行期间同步会拒绝（exit 2）而不是把运行实例脚下的目录换掉（曾因此把运行中的客户端打崩一次，已修复并端到端验证）。全量 `pnpm test` 现为 **293/293**、`check:plugins` 与开发态 smoke（schema 8）通过。
- 独立测试版副本已完成（按 Cyrus 要求）：`scripts/sync-runtime-copy.js` 共享核心 + `pnpm run sync:test` 生成 `runtime-test/`（`TEST.json`、自身门禁、运行中实例守护）；新增 `启动 DeepSeek Harness 测试版.cmd`（独立用户数据 `DSH_DESKTOP_USER_DATA=%APPDATA%\DeepSeek Harness Personal Test` 与独立 `DSH_HOME=…\harness-home`，会话/设置/项目库/单实例锁全隔离，可与稳定版同时运行）+ 桌面/开始菜单“测试版”快捷方式；开发版启动器同样隔离到 `…\Dev`。更新流程固化：开发树 → 全量门禁 → `sync:test` → Cyrus 验证测试版 → 关闭稳定版 → `sync:stable` 才更新日常客户端。`test/runtime-test-sync.test.js` 2/2 + launcher 编码/隔离断言（纯 ASCII+CRLF）。
- 双包体拆分已完成（Cyrus 拍板的方向）：两个独立桌面包体——测试版 `DeepSeek Harness Personal Dev`（AppId `…-personal-dev`、Portable 单文件、输出 `artifacts-dev/`）与稳定版 `DeepSeek Harness Personal`（NSIS/Portable、输出 `artifacts/`）。双身份由 `src/build-flavor.js`+`src/app-flavor.js` 驱动（`scripts/pack-desktop.js` 打包前切 dev、结束恢复 stable），main.js/shortcuts 全链路 flavor 化；修复模板未进包与 smoke 探针作用域两个打包期 bug。开发版与稳定版 packed smoke 双通过，且已做真实并存验证：测试版 Portable 与正在运行的稳定版同时存活、进程树/数据目录独立、关闭测试版不影响稳定版。
- 双根目录方案已完成：稳定版已安装到 `D:\Cyrus Deepseek Harness` 并从 F 盘数据目录（`F:\documents\Cyrus Deepseek Harness Data`，含会话目录 harness-home 与测试版存档 from-test-userdata）正式运行；会话无损恢复（本开发会话已在安装版内继续），数据已登记（迁移报告 + MIGRATED.marker，finalize 模式核对：数据 3034 文件/161MB、会话 280 文件/16MB、存档 243 文件/18MB）。迁移工具经三轮加固：探测改为 Node 侧按进程名精确识别并排除调用者自身进程（消除 PowerShell 自匹配与 electron-as-node 宿主误判）、复制失败自动清理、支持 `--finalize` 登记手动迁移；`test/migrate-to-fdrive.test.js` 6/6、`test/client-process-detect.test.js` 3/3。测试版根目录维持 `D:\Deepseek Harness Personal` 继续开发；更新中心发布通道（GitHub Releases）留待 Cyrus 后续确认。
- 桌面启动壳已完成：随机回环端口、单实例、安全 Renderer、受限导航和优雅退出。
- 十三个外置 Harness 插件包已经接入：两个内部基础模块（个人底座、Personal Shell）与十一项用户功能（个人主题、桌面设置、Skill 资料库、插件整理、连接中心、会话 PowerShell、用量余额、轨迹岛、更新中心、Project Control、Workbench）。
- Windows 桌面能力已经接入：应用图标、NSIS 与 Portable 目标、托盘菜单、受边界保护的快捷方式自修复、Windows Job Object 进程树守护。
- 用量与余额通过 Host 查询官方余额；预计费用与官方余额明确区分，充值页面使用隔离窗口并限制官方 HTTPS 域名。
- 更新中心支持 Personal GitHub Releases 检查与 SHA-256 校验、Harness 独立运行时准备/预检/切换/回滚，以及个人插件随客户端整体更新。
- 个人插件仅由桌面 overlay 激活；`D:\Deepseek Harness` 上游仓库和普通 `dsh web` 不受影响。
- 当前兼容基线为 Harness `0.1.0-rc.5`、提交 `47f943859bef60e4160492346772ded9b24f765a`。
- Gate 1 已完成真实四轨 Personal Shell：Harness 原生 Sidebar、Project Console、完整 Conversation 与 Workbench 同时由网格承载；Project/Workbench 分别有真实 single slot、分隔线、40px/44px 收起轨道、独立宽度持久化、窄窗让步，以及“专注会话/重置布局”。
- Gate 2A 合同冻结已完成：[`PROJECT_INTAKE_SPEC.md`](PROJECT_INTAKE_SPEC.md) 固定现有项目扫描/只读导入与标准项目快速新建，[`PROJECT_CONTROL_DATA_MODEL.md`](PROJECT_CONTROL_DATA_MODEL.md) 固定事实归属、全局 SQLite 模型与迁移边界，[`PROJECT_PROTOCOL.md`](PROJECT_PROTOCOL.md) 和 `protocol/project-control/v1alpha1/` 固定 manifest、lifecycle、外部 progress/blocker/completion 更新及标准输出的版本化合同。
- Gate 2B 数据库运行时与事务内核已完成；Gate 2C 在其上把 SQLite 升级为 `schemaVersion=5`，顺序执行 `0001 + 0002 + 0003 + 0004 + 0005` 并保持 checksum/升级前 online backup。`0003` 新增来源目录、扫描任务、候选、候选文档、候选问题和限时路径引用；`0004_windows_path_nocase.sql` 保留来源级 `import_job_issues` 并作为 v4 阶段的 ASCII `NOCASE` 防线；`0005_windows_unicode_path_key.sql` 引入由 Host 生成的版本化 Unicode `path_key`（Windows 分隔符规范化、NFC、稳定 Unicode lower），统一覆盖 source root、active workspace、候选 latest/ignore 以及 register/rebind。v4 若已有 Unicode 等价重复路径，v5 升级会失败回滚并保留 pre-v5 backup，不会静默合并或删除。数据库派生的单写者锁、幂等/revision、Project 当前状态 + CommandReceipt + Event + Outbox、document bindings、managed manifest mirror、`LOCATION_CONFLICT` 和退出锁释放继续保留。
- `@cyrus/dsh-project-control` 的 `/__personal/project-control/v1alpha1` Host API 除 `GET /status`、`GET /projects` 与 `POST /lifecycle` 外，已开放来源目录列表、签名授权扫描、候选列表/详情、忽略/恢复和确认准备。Client 不生成示例数据，也不在扫描后自动注册 Project。
- Gate 2C 现有项目接入已实现：系统目录选择器签发单次、短期且绑定用途的扫描授权；只读 scanner 有界识别 manifest、项目标记和文档候选；Project Console 显示候选状态，Workbench `Details` 显示证据、问题、短预览与角色映射。确认前和 lifecycle resolver 都会重新扫描并核对哈希，`loc_`/`srt_` 只能由 Host 签发和解析；候选变为 `imported` 与正式登记/重绑在同一事务提交。
- 四个现有项目的只读验收均成功：食溯 App、Amazon Store、Cyrus 量化模拟和 Cyrus Music 分别识别 51、6、14、2 份候选文档，全部得到 `linked_legacy` 建议；没有自动导入，也没有改写项目目录或在记录中复制正文。
- Gate 2D 已整体完成（P1 合同、P2 受控文件同步、P3 快速新建、P4 legacy 升级、P5 文档索引），全部验收在临时 fixture 上执行，未写任何真实项目。Outbox dispatcher、WorkItem 写入、跨 Harness 已认证 handshake、Agent 调度和审核闭环仍未实现（Gate 2E）。
- 后续顺序为 Gate 2E 跨 Harness/Agent 管线，以及 Gate 2D 后的封装制品重建；之后再进入完整 Project Console、审核闭环与 Workbench 能力。
- Project Control 全局 SQLite 已位于稳定 Electron `userData\project-control`，并允许显式 `PROJECT_CONTROL_HOME` 覆盖；它不跟随 `DSH_HOME`，其他 Harness 应用不得直接打开数据库。UNC/extended UNC 被拒绝；盘符形式的映射网络盘目前不能仅凭字符串可靠识别，因此必须使用已知本地固定磁盘。
- `@cyrus/dsh-workbench` 当前提供 `Files / Code / Outline / Diff / Browser / Terminal / Details` 七个稳定页签、viewer registry、统一 open intent、按作用域恢复的页签描述符、脏页签保护和唯一 Details selection 路由；Gate 2C 已接入候选详情 viewer。其余工具页仍不执行文件、Diff、网页或 PTY 操作。
- Gate 2C 的 scanner、storage、HTTP、Client、Workbench viewer、桌面签名授权和四项目只读扫描均已完成验证：全量 `241/241`、十三插件构建/类型/语法门禁通过，开发态与 `win-unpacked` Electron smoke 均验证 schema 5、Project Control API/UI、优雅退出、端口关闭与进程树清理。`node:sqlite` 仍会输出 ExperimentalWarning。
- Gate 1 的 141/141 与 1380px 四轨布局 smoke 继续作为历史证据：初始 `360 / 682 / 44`、Workbench 展开后 `40 / 626 / 420`，无横向溢出；七个 Workbench 页签只证明工具壳、路由和状态契约，不代表文件、代码、Diff、浏览器或 PTY 业务已实现。
- Gate 0 的普通 `cmd.exe` 无 pnpm PATH 双击入口、真实聊天和双 Session 切换已经签收，继续作为历史证据；它们不替代 Gate 1 当前源码门禁。
- rc.5 ChatView/工具卡仍未从真实点击调用 `openDetails`。Gate 1 已把官方 Details 子树与 `openDetails/closeDetails` 兼容命令统一路由到 Workbench 的 `Details` 页签，但这只是详情容器与状态契约，不是工具卡业务已接通。
- `compat.json` 仍保持 Harness rc.5/`47f943`，本轮不更新。`artifacts\win-unpacked` 已按 Gate 2C 重建并通过 packed smoke；NSIS 和 Portable 没有重建，仍是此前 Gate 的制品。

## 2026-08-30 G4 食溯物理迁移与 Stable 单次 rebind 验收

- Project Control `0.1.0-rc.15` 已发布为 `plugins-v2026.08.30.1`（Release `379266339`）并进入 Stable；tgz SHA-256=`ab12d00aae86329f7825db4020e187a8f6a200ce4e22e9b58f709b1e5b0f515e`，Stable storage=`ready`、schemaVersion=`9`。
- 食溯五份旧文档 binding 已通过官方 Host 接受，`prepare-upgrade` 闭环后 managed upgrade 已完成。物理迁移 Forward R2 验证 104,423 个冻结文件和六个 Git worktree，通过后旧根消失、新 workspace=`F:\Projects\meal-tracker\workspace`。
- Cyrus 在 Stable 使用唯一“更换工作区”入口完成单次 rebind。只读复核确认 `prj_01a0109b-0dd8-7bfb-be07-ee80c768640d` 为 managed/active、revision `3 → 4`；新 location `loc_01a052aa-6afb-7ff1-8b64-2c635fdc41fb` active，旧 location `loc_01a0109b-7f15-792d-924c-77a583958186` inactive；审计事件=`evt_01a052aa-6c13-7a7b-ba7c-f4e554f9321f`。
- 食溯 canonical 已补齐 human/machine governance index、current-state、BLOCKED、PROGRESS，`project-governance-context` 返回 `ready` 且五份 authority hash 全 matched。现有业务 dirty/untracked 与六工作树均保留；未 commit、push、发布、删除、复制、建 junction 或直接读写 Stable 数据库。
- 只读外部定位器审计发现 Codex 项目 `cc6d16fb-6bee-4d1d-817c-4b9b34048bb3` 与 Kimi Workspace 均仍指向已经不存在的旧 QClaw 路径；因此下一任务为 `G4-MEAL-TRACKER-EXTERNAL-LOCATOR-ALIGNMENT`。本轮状态化 `docs/NEXT.md` 的新哈希也待另行授权后由官方 Host 精确接受。
- 物理迁移验收 receipt：`../local/receipts/op_g4_meal_tracker_migration_rebind_20260830_08_post_physical_verification.json`，SHA-256=`8929d6622e975f4962db4be7aad5f91a7ee71694ddcf879c4835ef2261798627`。换绑与治理 bootstrap receipt 写入 Project Home `local/receipts`，不进 Git。

## 2026-08-30 managed 文档绑定接受修复与 canonical 合入

- Cyrus 已把 Codex 与 Kimi locator 对齐到 `F:\Projects\meal-tracker\workspace`；rc.15 的官方 `accept-current` 对 managed 项目返回 `MODE_CONFLICT`，因此没有写 Stable、没有重复 rebind，也没有直接改数据库。
- `B-G4-MANAGED-DOCUMENT-BINDING-ACCEPTANCE-CLOSURE` 在任务 worktree 中复用同一 Host 命令：写前复核活动 manifest 的普通文件边界、真实路径、project_id、冻结 manifest hash 和文档声明集合；同一 storage transaction 更新 `project_document_bindings` 与 `project_manifest_mirrors`，project/mirror revision 和审计事件同步推进，失败整笔回滚且不产生 outbox。
- Project Control `208/208`、全插件 manifest/lock/typecheck/syntax/tests、checkout、launch、governance 与 diff 门禁通过；正式 `npm test` 的产品测试全部通过，packed 测试按治理合同拒绝任务 worktree，Electron `EBUSY` 单测复跑通过。收据=`../local/receipts/op_b_g4_managed_document_binding_acceptance_closure_20260830_01.json`，SHA-256=`d153ca126f3f9e659ecf8ddc7f4222807dc62e9b1676f06a79bf82cbf643af42`。
- 产品提交 `2588b6bd07a3cbfafd5a218b33dd6132d67a7d14` 精确包含 4 个 Project Control 文件，并从 `d935f30e4fe8ef6934bff89de96ee4ae6db55191` 严格 ff-only 合入 canonical；既有 UI 实验目录和 `release-staging/` 未纳入提交。下一门为一份 rc.16 本地单插件候选与 canonical governed packed；push、Release、Stable 安装和真实食溯 NEXT 接受仍未授权。

## 2026-08-30 Project Control rc.16 packed 隔离、提交与单插件发布

- 代码复核确认 QUARANTINED package-set 只放宽已登记事故对象的事故前整树哈希，不放宽唯一 registry 身份、project_id、objectId、路径与 marker；PINNED/ACTIVE、删除目标、未知对象和 marker 漂移继续严格失败关闭。source checkout 与 canonical lifecycle checkout 分离，避免 packed 验收再次把生成物污染产品提交。
- Project Control `208/208` 全绿、skipped/todo=0；非 packed 正式套件有效 `352/352`，唯一首次 `shortcuts-electron` Windows `spawn EBUSY` 定向重跑 `1/1`；launch、governance `22/22`、syntax 与 diff 门禁通过。governed packed 在干净 task worktree 中唯一一次通过，receipt=`../local/receipts/op_b_g4_rc16_packed_checkout_isolation_closure_20260830_01.json`，SHA-256=`7ba7c002040c1782958de0ebe36165106a2c3b3a31485c6f9a6c591a6ae9784d`。
- 产品提交 `965f87ab1b8436547fa7039762a1ec3b3ea45b4a` 精确包含 10 个 rc.16 源码/测试/版本文件；canonical 从 `2588b6b` 严格 ff-only 合入。既有 `release-staging/`、UI/设计实验目录、`tmp/` 和 task worktree 生成物均未进入产品提交。
- 远端 branch 与新 tag `plugins-v2026.08.30.2` 均指向 `965f87a`，无 force、无覆盖；公开 Release [plugins-v2026.08.30.2](https://github.com/SeeiiLee/deepseek-projectpl-console/releases/tag/plugins-v2026.08.30.2) ID=`379317536`，仅四项 Project Control 资产。tgz=`cyrus-dsh-project-control-0.1.0-rc.16.tgz`，313,426 bytes，SHA-256=`7eaafc2080ecac528755c4aa19f2ef2f10f931b6141ffd7ce961025d5295dd7f`；四项资产均独立下载并与本地字节及 GitHub API digest 一致。
- 发布 receipt=`../local/receipts/op_b_g4_managed_document_binding_acceptance_rc16_commit_push_release_20260830_01.json`，SHA-256=`8952b7d663583d00e8cb42bc190f2b62007fce2be300c479ddeb0c88765b0233`。本轮未安装或写 Stable、未接受食溯 NEXT、未重复 rebind、未进入 UI/B1b。

## 2026-08-24 v0.4.4 生产缺陷修复（main→helper 外部插件根未注入）
- 目标：修复 v0.4.3 真实 Stable 重启后 pending 不激活（helper 拿不到 userData/plugins-external），产出 v0.4.4 候选与红→绿真实进程证据。
- 顺序：①基线 727/727（skipped=0）②写 packed 回归（不注入 DSH_PERSONAL_PLUGINS_EXTERNAL）在旧代码红 ③修复 resolveExternalRoot userData 优先 + main 注入 helper + stable 缺路径 fail-closed ④全量门禁 + 构建 v0.4.4 Stable 候选 ⑤文档/评估 minClient；最终全量 731/731（新增 4 项）。
- 最大风险：packed E2E 重建 stable win-unpacked 与真实进程验证耗时；必须全程临时 userData/DSH_HOME，禁止触碰真实 Stable/F 盘 pending。
- Codex 复核三项已修复：runtime-preflight 隔离注入（真实 PREFLIGHT_OK + CLEANUP_OK）、Dev+pending 反向测试、`release-staging/v0.4.4-final` 独立 0.4.4 资产全集（无 0.4.3 混入）。
- minClient 收口：现有 plugins-v2026.08.24.1（.1）Release 不修改、不删除；后续发布 .2 已改为单插件灰度：只更新轨迹岛 0.1.2，minClient=0.4.5，AnySearch 保持 0.1.1-beta。
- 已发布 v0.4.4：https://github.com/SeeiiLee/deepseek-projectpl-console/releases/tag/v0.4.4 （commit/push 已授权并完成；v0.4.5 后续已由 Cyrus 通过应用内更新安装）。

## 2026-08-24 v0.4.5 发布候选（更新中心有效版本识别与 pending 安全收口）
- 目标：修复 v0.4.4 更新中心将 external 插件误显示为“随客户端更新”，并完成 current/pending 统一路径与证据校验。
- 内容：effectivePluginVersions 读取 current generation；checkPlugins 以实际生效版本比较；pending 存在时禁止新 prepare 并显示“已有插件更新待重启激活”；current/pending 共用 assertExternalPackagePath 目录/版本/junction 校验。
- 验证：全量 751/751、stable packed E2E、check-plugins、generate-plugin-set、verify-launch、git diff --check 全过。
- 状态：已发布并安装 v0.4.5：https://github.com/SeeiiLee/deepseek-projectpl-console/releases/tag/v0.4.5 （commit/push 已授权并完成；Cyrus 已通过应用内更新安装并正常启动；真实 Stable 更新中心确认 AnySearch 0.1.1-beta 与轨迹岛 0.1.1 为独立更新源，其余插件随客户端更新；未覆盖 v0.4.4 Release）。

## 2026-08-24 plugins-v2026.08.24.2 单插件灰度已发布
- 目标：用真实发布格式证明“只更新轨迹岛时，AnySearch 独立插件不会丢失或退回内置”。
- 内容：release 脚本支持显式白名单插件选择（`--plugin/--plugins`），bootstrap 与 follow-up 分离；轨迹岛升至 0.1.2、minClient=0.4.5；AnySearch 源码/版本/包未改动。
- 验证：新增 release 单插件/未知/重复/空/bootstrap/资产混入测试与组合 generation 保留 AnySearch 测试；.2 测试使用 index/entry/app minClient=0.4.5，并新增 0.4.4 客户端 blocked 负例；全量 755/755、stable packed E2E、check-plugins、generate-plugin-set --check、verify-launch、git diff --check 全过。
- 产物：`release-staging/plugins-v2026.08.24.2` 仅含轨迹岛 0.1.2 资产；`bootstrap=false`。
- `plugin-set.lock.json` 除轨迹岛 0.1.2 外，还按生成器结果修正了 v0.4.5 后 update-center 的当前 tgz integrity：`101659537af66014ab60aab7323c0096a3d02fcd8c2c7746e598f92e46d0764`。
- 状态：已发布：https://github.com/SeeiiLee/deepseek-projectpl-console/releases/tag/plugins-v2026.08.24.2 （Release ID 375909010，非 draft、非 prerelease）。

## 2026-08-24 A线最终验收收口（文档只读确认）
- 开工回执：基线核验通过——HEAD `e3f888a`，tag `.2`→`a6d0c2a`，Release `375909010` 四资产非 draft/prerelease，tracked worktree 干净。
- Cyrus 人工 UI 验收：Stable 只提示轨迹岛 `0.1.1→0.1.2`，重启后正确生效；AnySearch 保持 `0.1.1-beta` 独立更新源。
- 只读落盘证据：`current.json`=`pending-1787596673068`，`committedAt=2026-08-24T18:38:33.132Z`；batch 中轨迹岛 external `0.1.2`、AnySearch external `0.1.1-beta`、其余 16 个 builtin；轨迹岛 `.install.json` 的 `sourceTag=.2`、`tgzSha256=67905069...`、`minClient=0.4.5`；AnySearch `.install.json` 仍来自 `.1`；`pending.json`/`activating.json` 不存在；`previous.json`=`pending-1787517223819`；Profile `@cyrus` junction 指向当前 generation `scope\@cyrus`。
- `previous.json` 是上一 generation 的正常回滚目标，保留为可回滚证据，不清理、不视为异常。
- A 线三条生产 happy path 均完成：客户端升级（v0.4.5）、整批插件更新（.1）、单插件更新（.2）。
- A 线进入“生产主链路完成并冻结观察”，无当前阻塞；B/C 线和记忆系统可继续开发。本轮不重跑全量/packed E2E，复用已完成的 755/755 与真实发布证据。

## 2026-08-26 Candidate Center rc.11 精确提交、push 与单插件 Release

- 发布前精确冻结 14 个提交文件；`release-staging/` 明确排除。Project Control `193/193`，双路径三产物同 SHA，checkout `1288` 文件、launch、governance `22/22`、plugin lock `18` 包、diff 全部通过。
- 候选提交：`e67e50150ff42e1dab504898b86301b2bcc8ad44`（`fix(project-control): freeze reproducible rc.11 candidate`）；远端 `codex/governance-alignment` 从 `e630870` 普通 fast-forward 到 `e67e501`，无 force，合并历史完整。
- 公开 Release：[plugins-v2026.08.26.3](https://github.com/SeeiiLee/deepseek-projectpl-console/releases/tag/plugins-v2026.08.26.3)，ID=`377215143`，tag 与远端分支均指向 `e67e501`。仅 4 项 Project Control 资产，tgz 288,537 bytes，SHA-256=`80476bafe305c6885dbd2d14b6348dfce829f85bb918d26b791206f26eb84963`；四项资产逐项下载后与 GitHub API digest 一致。
- 先执行 public publish dry-run 验证同一 tgz SHA，再通过既有插件发布通道创建、验资并公开 Release。task-owned 临时凭据和 staging 已精确清理，未新增 package-set。
- 主 receipt：`../local/receipts/op_b_g4_candidate_center_rc11_commit_push_release_20260826_01.json`，SHA-256=`08fa56024c4a7f3189a63119224eca5b00b3d3d012afaddf33e3ea04a77e7c4e`。
- 未安装/写 Stable，未执行项目 rebind/迁移，未进入第二批位置生命周期或 B1b。Stable 仍为客户端 `0.4.6` + Project Control `0.1.0-rc.10`；下一门是另行授权的 rc.11 Stable 安装与人工验收。

## 2026-08-26 Candidate Center rc.11 Stable 安装与人工验收

- Cyrus 已通过更新中心完成 Project Control `0.1.0-rc.11` 安装并重启 Stable；当前 generation=`pending-1787755854103`，source tag=`plugins-v2026.08.26.3`，tgz SHA-256=`80476bafe305c6885dbd2d14b6348dfce829f85bb918d26b791206f26eb84963`，25 个安装文件逐一复算无缺失/不符，pending/activating 均不存在。
- Live Host storage=`ready`、schemaVersion=9、项目数=4；四类视图计数为项目 4、待审阅 1、已忽略 3、历史 10。Cyrus 人工确认页签、计数、唯一 `docs` 待审阅项和 Amazon 陈旧候选只在历史中出现，均与机器结果一致。
- 经明确授权，仅对 `can_01a00149-75d0-71be-95c4-b0ffa7762d7c` 调用 Host 批量接口：`discovered r1 → ignored r2 → discovered r3`，计数 `1/3/10 → 0/4/10 → 1/3/10`；另外 13 条候选的状态、revision 与路径未变化。
- Amazon 正式项目继续是 `prj_01a01cb7-b3f5-7dd3-932f-1adc4d16a1dd`、revision 2，唯一 active location=`F:\Projects\amazon-store\workspace`，旧路径 inactive，path history=1；未重复 rebind、未直接改库、未 migration、未改 Amazon 文件。
- 验收 receipt：`../local/receipts/op_b_g4_candidate_center_rc11_stable_acceptance_20260826_01.json`，SHA-256=`9390338401662aee317eb503f17530c50841d26daad7c1b74ad5abe3d19a555e`。当前下一任务晋升为 `B-G4-PROJECT-LIFECYCLE-SECOND-BATCH`。
