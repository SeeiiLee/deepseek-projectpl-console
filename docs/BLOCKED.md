# Blocked

## Codex 复核阻断项（2026-08-24）：三项已全部修复并验证
1. runtime-preflight：已注入隔离临时 externalPluginsRoot 与可信 desktopFlavor；真实 preflight 输出 `PREFLIGHT_OK`，`PREFLIGHT_CLEANUP_OK`。
2. Dev flavor：harness-helper 不再无条件用 BUILD_FLAVOR 覆盖主进程传入的可信 flavor；新增 Dev + pending 反向测试通过。
3. 发布资产：已在 `release-staging/v0.4.4-final` 独立目录生成最终 8 个 0.4.4 Release 资产（含 blockmap），无 0.4.3 混入；`release-staging/` 仅作上传来源，不 git add/提交其中的大文件。

- 插件 Release 收口：现有 plugins-v2026.08.24.1（.1）不修改、不删除；后续发布 .2，两个插件递增版本，minClient=0.4.4。
- 已授权并完成：commit、push、v0.4.4 GitHub Release（https://github.com/SeeiiLee/deepseek-projectpl-console/releases/tag/v0.4.4）。
- 仍未执行（按授权边界）：未创建 plugins-v .2 Release，未安装 v0.4.4 到宿主机，未读写/移动/删除真实 F 盘 pending generation，未修改 `D:\Deepseek Harness`。

## 2026-08-24 v0.4.5 发布候选（等待 Cyrus 授权发布）
- v0.4.5 已完成：更新中心有效版本识别、pending 安全收口、751/751 全量、stable packed E2E、全部门禁通过。
- 发布候选资产位于 `release-staging/v0.4.5-final`；未 commit/push/release，未覆盖 v0.4.4 Release，未创建 plugins-v*.2，未操作真实 Stable 数据。

后续若出现规范冲突、真实项目写入授权、上游修改、覆盖/删除、安装/发布或外部凭据需求，必须先在此记录并请求 Cyrus 决策，不能自行扩大权限。
