# Blocked

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
