# Blocked

## 当前阻断（2026-08-25，G2-P1 已提交为 `535185b`、当前 G3）

- **checkout EOL 阻断已关闭**：仓库 `.gitattributes`、repo-local `core.autocrlf=false`/`core.safecrlf=true`、机器门禁和测试已经形成三层闭环；正式 `npm test` 786/786，launch/diff 通过。旧失败证据继续保留在 `local/receipts/op_canonical_workspace_import_20260825_01-validation-failed.json`，新闭环见 checkout 与 baseline receipts。
- **B1b 继续暂停，但不再因 B1a/G0.5/G1 代码阻断**：G0.5 与 G1 已依次提交；在 G2 retention 与 G3 跨 Harness 对齐完成前，仍不得开始 migration 0010、审批 DB、HTTP、UI、侧栏或收件箱。
- **G1 Git 可重建阻断已关闭**：`project-home/v1`、三套 `2.0.0` 模板、整屋 plan 与 `workspace` primary binding 已精确提交为 `f5c58e5874a977aa5104a092e2e7c03472b6a4d7`；候选 receipt 与 commit receipt 均位于 Project Home `local/receipts/`。该 commit 未 push、未发布；它不授权后续 commit、push 或发布。
- **remote 旧规则冲突已关闭**：机器索引只登记 canonical `origin=https://github.com/SeeiiLee/deepseek-projectpl-console.git`；额外 remote、URL 漂移或显式 `pushurl` 均失败关闭。登记仅提供来源追溯，不授权 commit、push 或发布，也没有修改现有 remote 配置。
- **G0.5 Git 可重建阻断已关闭**：精确候选已提交为 `28d7c8c25e7e879fba8b9170a4ecad8b4ad0d8ef`，其上的 G1 已提交为 `f5c58e5`；两者均未 push、未发布。
- **真实 Project Control 路径/身份尚未晋升**：Stable 权威 `project_id` 仍登记旧主路径 `D:\Deepseek Harness Personal`；Dev 数据库另有冲突身份 `prj_01a00cfd-1fe4-7bb3-9123-027765662055`。G1 只修通新建时“整屋文件目标 / workspace 主 location”的代码 seam，没有 migration 或真实数据库写入；真实 binding 与双 ID 仍须另发受控事务。
- **旧 workspace `artifacts` 继续作为历史证据保留，不再冒充 G2 未实现**：它位于 canonical workspace 的 ignored 历史位置，仍为 5233 文件 / 837,754,746 bytes，旧日志 SHA 未变；G2-P1 只管理 Project Home `local` 下带登记与 marker 的对象，不会跨区自动吞并或删除该历史证据。其迁移/删除需要单独清单和 Cyrus 删除授权，不阻断 G3。
- **G2-P0 packed 可变性阻断已关闭**：启动日志已改写各实例 `userData\logs\boot-error.log`；build receipt v3 校验完整 `win-unpacked`，正式测试创建并复用唯一 `local/package-sets/sha256-58ad…`，三次启动后整树 SHA 不变。旧 `artifacts` 仍为 5233 文件 / 837,754,746 bytes，原日志 4581 bytes/SHA 不变；没有覆盖历史证据。
- **G2-P1 local 生命周期机器闭环已本地关闭**：package set/run 创建登记、recent-count AND age retention、PINNED/引用保护、20 GiB 配额、5 GiB 磁盘底线、24h+12h 调度健康、cleanup plan/apply/verify/receipt 与中断续跑已通过 818/818 正式全量。真实删除只发生于 task-owned 临时 fixture；物理 managed set 仍为唯一 58ad…，同内容不同来源只增加小型 provenance JSON。Windows 计划任务未创建，逾期通过大型 run/build preflight 失败关闭；启用系统计划任务仍需单独授权。
- **G3 shadow 闭环已通过，但不能外推为所有 Harness active**：DSH Dev/Codex 的治理 Skill 投影、逐实例 receipt/rollback 与 memory-host fixture 双端 leak=0 已验收；真实宿主重启 discovery、真实 memory 数据和 Project Control binding 均未做。其他 Harness 仍是 unconfigured/not-applicable，必须逐实例接入与验收。
- **G4 批量迁移被 Amazon 试迁闸门主动截断**：连续授权只覆盖 G4 的 Amazon 单项目试迁；完成复制/校验/可回滚切换和人工观察后必须暂停。量化与 meal_tracker/食溯仍为未授权状态，不能因 Amazon 通过而自动继续；三个项目的旧源目录均不得在该授权下删除。

允许连续执行：当前治理对齐、G2、G3，以及 G4 的 Amazon 单项目试迁；每个独立候选通过 receipt 与门禁后可创建本地 commit，并可清理带任务所有权标记的临时 profile、失败半成品和一次性 fixture。仍禁止修改 A Release、真实 Stable/Dev 切换、F 盘受保护数据、`D:\Deepseek Harness`、发布面、remote 配置、旧项目源目录；push/发布仍需另行授权。packed E2E 还必须满足机器索引的临时单 package-set 规则。

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
