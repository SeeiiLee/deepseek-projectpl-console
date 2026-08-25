# Blocked

## 当前阻断（2026-08-25，G1 本地实现已收口）

- **checkout EOL 阻断已关闭**：仓库 `.gitattributes`、repo-local `core.autocrlf=false`/`core.safecrlf=true`、机器门禁和测试已经形成三层闭环；正式 `npm test` 786/786，launch/diff 通过。旧失败证据继续保留在 `local/receipts/op_canonical_workspace_import_20260825_01-validation-failed.json`，新闭环见 checkout 与 baseline receipts。
- **B1b 继续暂停，但不再因 B1a/G0.5/G1 代码阻断**：G0.5 已提交，G1 已本地实现并验证；在 G1 独立提交、G2 retention 与 G3 跨 Harness 对齐完成前，仍不得开始 migration 0010、审批 DB、HTTP、UI、侧栏或收件箱。
- **G1 已形成 receipt 但尚未提交，不能冒充可重建正式基线**：`project-home/v1`、三套 `2.0.0` 模板、整屋 plan 与 `workspace` primary binding 已本地通过测试，receipt 位于 Project Home `local/receipts/op_g1_project_home_20260825_01.json`；当前仍是 dirty candidate，必须由 Cyrus 单独授权精确 commit。未授权前不 commit，push/publish 继续是独立闸门。
- **remote 旧规则冲突已关闭**：机器索引只登记 canonical `origin=https://github.com/SeeiiLee/deepseek-projectpl-console.git`；额外 remote、URL 漂移或显式 `pushurl` 均失败关闭。登记仅提供来源追溯，不授权 commit、push 或发布，也没有修改现有 remote 配置。
- **G0.5 Git 可重建阻断已关闭**：精确候选已提交为 `28d7c8c25e7e879fba8b9170a4ecad8b4ad0d8ef`；未 push、未发布。当前 dirty 内容只属于 G1 候选，不与 G0.5 混报。
- **真实 Project Control 路径/身份尚未晋升**：Stable 权威 `project_id` 仍登记旧主路径 `D:\Deepseek Harness Personal`；Dev 数据库另有冲突身份 `prj_01a00cfd-1fe4-7bb3-9123-027765662055`。G1 只修通新建时“整屋文件目标 / workspace 主 location”的代码 seam，没有 migration 或真实数据库写入；真实 binding 与双 ID 仍须另发受控事务。
- **local 生命周期机器闭环尚未实现**：当前只创建了隔离分区与 receipt 目录，尚无 register → cleanup-plan → apply → verify → receipt、保留上限、磁盘阈值和调度健康实现。正式 packed E2E 已登记留下 workspace ignored `artifacts/` 5233 文件 / 837,753,219 bytes；临时 E2E profile 已清零。该目录留待 G2 按合同迁入/清理，本轮不擅自删除，也不批量迁移旧 run/cache。
- **G2 前只具备临时防扩增规则，不等于机器清理已上线**：人工/packed 测试从 F 盘 canonical 出发，每任务最多一套共享、按内容寻址的只读 package set，run 只引用而不复制；无 preflight 不运行。该规则能阻止本轮继续制造副本，但自动登记、配额、到期清理和调度健康仍须 G2 实现。
- **共享 packed package set 会被启动日志写回，已拍板保留证据并转 G2-P0**：G1 正式 `npm test` 796/796 后，临时 profile 和 Smoke 进程已清零、`artifacts` 文件数仍为 5233，但 `artifacts/win-unpacked/resources/app/boot-error.log` 被 `src/main.js::appendBootLog` 追加 1,527 bytes，总量变为 837,754,746 bytes。Cyrus 已决定不扩大 G1、不截断日志；G2 首步把 boot log 改写到隔离 userData/local，并证明共享 package set 只读。
- **跨 Harness 无缝续接尚未验收**：权威索引和 project_id 已对齐，但 toolbox 投影、memory-host、真实 binding 与逐端 context receipt 属 G3/G4，不能把当前单 workspace 通过外推为所有 Harness 已无缝接入。

允许继续：治理文件合并、只读审计、hash/receipt、一次性 fixture 和本 workspace 内的轻量测试。仍禁止修改 A Release、真实 Stable、F 盘受保护数据、`D:\Deepseek Harness`、发布面、remote 配置、commit/push；packed E2E 还必须满足机器索引的临时单 package-set 规则。

## 历史 A 线状态（已完成并冻结）

## Codex 复核阻断项（2026-08-24）：三项已全部修复并验证
1. runtime-preflight：已注入隔离临时 externalPluginsRoot 与可信 desktopFlavor；真实 preflight 输出 `PREFLIGHT_OK`，`PREFLIGHT_CLEANUP_OK`。
2. Dev flavor：harness-helper 不再无条件用 BUILD_FLAVOR 覆盖主进程传入的可信 flavor；新增 Dev + pending 反向测试通过。
3. 发布资产：已在 `release-staging/v0.4.4-final` 独立目录生成最终 8 个 0.4.4 Release 资产（含 blockmap），无 0.4.3 混入；`release-staging/` 仅作上传来源，不 git add/提交其中的大文件。

- 插件 Release 收口：现有 plugins-v2026.08.24.1（.1）不修改、不删除；`.2` 按 Cyrus 新拍板改为单插件灰度——只发布 `@cyrus/dsh-trajectory-island` 0.1.2，`minClient=0.4.5`，AnySearch 保持独立更新源 0.1.1-beta。
- 已授权并完成：commit、push、v0.4.4 GitHub Release（https://github.com/SeeiiLee/deepseek-projectpl-console/releases/tag/v0.4.4）。
- 真实 Stable 已由 Cyrus 通过应用内更新安装并正常启动 v0.4.5；已创建 plugins-v .2 GitHub Release，仍按授权边界：未写/移动/删除真实 F 盘 generation（本轮仅只读核验），未修改 `D:\Deepseek Harness`。

## 2026-08-24 v0.4.5 已发布并安装
- v0.4.5 已完成：更新中心有效版本识别、pending 安全收口、751/751 全量、stable packed E2E、全部门禁通过。
- 已发布：https://github.com/SeeiiLee/deepseek-projectpl-console/releases/tag/v0.4.5
- Cyrus 已通过应用内更新安装并正常启动 v0.4.5；真实 Stable 更新中心确认 AnySearch 0.1.1-beta 与轨迹岛 0.1.1 为独立更新源，其余插件随客户端更新。
- 未覆盖 v0.4.4 Release，未写/移动/删除真实 F 盘 generation（本轮仅只读核验）。

## 2026-08-24 plugins-v2026.08.24.2 单插件灰度已发布
- 已生成可复核本地 staging：`release-staging/plugins-v2026.08.24.2`，仅含轨迹岛 0.1.2 tgz/sha256、plugin-index、release-manifest、release-notes；`bootstrap=false`、`minClient=0.4.5`。
- 已用真实 UpdateService/generation 接口证明：只升级轨迹岛时 AnySearch 0.1.1-beta 仍作为 external 被复制保留，激活后版本正确、重复检查不再提示、回滚恢复上一代；.2 测试使用 index/entry/app minClient=0.4.5，并新增 0.4.4 客户端 blocked 负例。
- 全量测试 755/755，fail 0，skipped 0；check-plugins、generate-plugin-set --check、verify-launch、git diff --check 全部通过。
- `plugin-set.lock.json` 除轨迹岛 0.1.2 外，还按生成器结果修正了 v0.4.5 后 update-center 的当前 tgz integrity：`101659537af66014ab60aab7323c0096a3d02fcd8c2c7746e598f92e46d0764`。
- 已发布：https://github.com/SeeiiLee/deepseek-projectpl-console/releases/tag/plugins-v2026.08.24.2 （Release ID 375909010，非 draft、非 prerelease）。

## 2026-08-24 A线最终验收收口（无当前阻塞）
- Cyrus 人工 UI 验收：Stable 只提示轨迹岛 `0.1.1→0.1.2`，重启后正确生效；AnySearch 保持 `0.1.1-beta` 独立更新源。
- 只读落盘证据与任务要求完全一致：`current.json`=`pending-1787596673068`/`committedAt=2026-08-24T18:38:33.132Z`；batch 中轨迹岛 external `0.1.2`、AnySearch external `0.1.1-beta`、其余 16 个 builtin；轨迹岛 `.install.json` 的 `sourceTag=.2`、`tgzSha256=67905069...`、`minClient=0.4.5`；AnySearch `.install.json` 仍来自 `.1`；`pending.json`/`activating.json` 不存在；`previous.json`=`pending-1787517223819`；Profile `@cyrus` junction 指向当前 generation `scope\@cyrus`。
- `previous.json` 是上一 generation 的正常回滚目标，保留为可回滚证据，不清理、不视为异常。
- A 线客户端升级、整批插件更新、单插件更新三条生产 happy path 均完成；进入冻结观察。
- 无当前阻塞。后续若出现规范冲突、真实项目写入授权、上游修改、覆盖/删除、安装/发布或外部凭据需求，必须先在此记录并请求 Cyrus 决策，不能自行扩大权限。
