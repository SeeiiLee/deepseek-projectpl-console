# Progress

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
