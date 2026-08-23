# A 线 · 客户端回滚隔离 E2E 方案

> 状态：方案已按 2026-08-22 领导拍板修订；真实稳定客户端安装/回滚仍不在授权内。
> 目标：在不触碰真实稳定版数据/安装的前提下，验证 `rollbackDesktop()` 的可执行回滚语义，
> 并证明安装/回滚记录在未确认成功前不会丢失。

## 范围

- 验证 `UpdateService.downloadDesktop()` 保存 `previousDesktop`。
- 验证 `installDesktop()` 持久化 `installPending`；只有新版本真正启动并通过 readiness/doctor 后才确认。
- 验证 `rollbackDesktop()` 持久化 `rollbackPending` 且**不提前清理** `previousDesktop`；
  只有旧版本真正启动并通过兼容门、readiness、doctor 后才确认成功并清理状态。
- 验证安装包保留策略：当前候选 + 上一已知良好版，最多两个；未确认成功前禁止清理上一版。
- 验证启动失败、Dev-E2E 在安装器 spawn 前注入的取消（非 NSIS UI 点击）、SHA 篡改、重复回滚等负例不丢失回滚记录。
- 全程零写入真实稳定路径。

## 隔离环境

- 首选 **Windows Sandbox**，使用 Dev NSIS 身份。
- Dev NSIS 构建命令（二选一，推荐前者）：
  1. `node scripts/pack-desktop.js dev nsis`
  2. 在 `package.json` 增加明确的 `pack:dev:installer`（`node scripts/pack-desktop.js dev nsis`）
- `pack:win:installer` 是 stable 通道，禁止用于隔离回滚验证；隔离环境必须使用 Dev NSIS。

## 步骤（真实生命周期 C → A → B → 多次重启 → 回滚 A）

1. 准备三个 Dev NSIS 安装包：
   - `C`：初始安装客户端（例如 `0.4.0`）。
   - `A`：第一候选/当前已知良好客户端（例如 `0.4.1`）。
   - `B`：第二候选客户端（例如 `0.4.2`）。
2. 在隔离环境安装 `C`，记录安装目录、userData、Harness home。
3. 本地更新源 current.txt 指向 `A`；用 `UpdateService.downloadDesktop()` 下载 `A` 到隔离 userData，断言：
   - `previousDesktop` 保存 C（若 C 已登记 knownGood）；
   - `downloadedDesktop` 保存 A；
   - 总安装包数量不超过两个。
4. 调用 `installDesktop()`，断言：
   - 落盘 `installPending`；
   - `previousDesktop`（C）仍然存在；
   - 安装器被启动。
5. 第一次重启进入 A，兼容门/readiness/doctor 全部通过，断言：
   - `confirmDesktopLifecycle()` 清理 `installPending`；
   - `downloadedDesktop`（A）被清除，避免后续下载把 A 误当成上一良好版；
   - `previousDesktop`（C）**长期保留**。
6. 本地更新源 current.txt 指向 `B`；A 继续用 `UpdateService.downloadDesktop()` 下载 `B`，调用 `installDesktop()`，安装器启动。
7. 第一次重启进入 B，兼容门/readiness/doctor 全部通过，断言：
   - `confirmDesktopLifecycle()` 登记 `knownGoodDesktop=B`；
   - `previousDesktop`（A）**长期保留**。
8. 多次重启仍停留在 B，断言：
   - 每次 `ensureLoaded()` 都不会清除 `previousDesktop`（A）；
   - `canRollbackDesktop` 始终为 true。
9. 模拟 Dev-E2E 在安装器 spawn 前注入的取消（非 NSIS UI 点击）或安装器启动失败（在确认前的任意重启），断言：
   - `installPending`/`rollbackPending` 不丢；
   - `previousDesktop` 和 `downloadedDesktop` 均不丢失。
10. 模拟 SHA 篡改：
    - 修改 `previousDesktop`（A）安装包文件，调用 `rollbackDesktop()` 必须拒绝且不清理任何记录。
11. 调用 `rollbackDesktop()`，断言：
    - 落盘 `rollbackPending`；
    - `previousDesktop`（A）**未被清理**；
    - 安装器被启动。
12. 第二次重启回到 A，兼容门/readiness/doctor 全部通过，断言：
    - `confirmDesktopLifecycle()` 清理 `rollbackPending`；
    - 清理 `downloadedDesktop` 与 `previousDesktop`（回滚已确认，B 不再保留）。
13. 重复回滚负例：
    - 在未确认成功前再次调用 `rollbackDesktop()` 必须仍然可用（记录未丢）；
    - 若目标版本未启动（仍运行 B），`confirmDesktopLifecycle()` 不得清理 `rollbackPending`。
14. 全程在临时 userData 执行，并保留证据：
    - 启动日志含 `boot:page-ready`；
    - `confirmDesktopLifecycle` 前后 `update-center.json` 快照；
    - 对 `D:\Cyrus Deepseek Harness`、`F:\documents\Cyrus Deepseek Harness Data`、真实 `%APPDATA%` 稳定目录的访问计数为 0（测试探针在启动前记录路径集合，结束后比对）。

## 通过标准

- `rollbackDesktop()` 实际调用 `onInstallDesktop(previous.path)`，且调用前已持久化 `rollbackPending`。
- 回滚后系统可启动，不依赖“入口可达”之外的手工修复。
- 未确认成功前，`previousDesktop` 与 `rollbackPending` 一直存在；确认后才清理。
- 全程未触碰 `D:\Cyrus Deepseek Harness`、`F:\documents\Cyrus Deepseek Harness Data`、真实 `%APPDATA%` 稳定目录。

## 历史决策记录

- Dev NSIS 已用于 Windows Sandbox 隔离 E2E；Stable 宿主机安装/回滚与真实 Release 仍未授权。
- 当前按领导拍板：不静默自动安装旧版，由用户确认回滚。
- 安装包配额策略固定为“当前候选 + 上一已知良好版”两个、总计不超过 1 GiB。

## 2026-08-22 状态更新
- 历史状态（已解除）：本方案中的 Dev NSIS 真实安装/回滚仍未授权；stable packed E2E 当时因 `pack:win:dir` 无法重建 plugin-organizer 而 BLOCKED（详见 docs/BLOCKED.md）。函数级 stable-flavor 测试已改名 integration，未冒充真实进程闭环。该 BLOCKED 已在后续轮次解除。

## 2026-08-22 第二轮状态更新
- `pack:win:dir` 已成功，`test/stable-flavor-packed-e2e.test.js` 已通过：真实 Electron/Harness、临时 userData/DSH_HOME、真实 UpdateService 装配 pending、真实 fiber/doctor 提交 current、重启 ACTIVE、回滚回内置。此前 BLOCKED 解除。
- 真实稳定客户端安装/回滚、真实 Release 仍未授权；Cyrus 已选择“过桥版 + 第一跳人工回退”作为首次 bootstrap 方案。
## 2026-08-22 第三轮状态更新（Codex 复核后）
- stable packed E2E 已改为同一组临时 Profile 连续三次启动，并校验 `artifacts/build-receipt.json` 与当前源码/plugin-set/客户端版本/exe SHA-256 一致后才使用 EXE。
- 当前 packed E2E 状态：已通过。真实稳定安装/回滚仍未授权。
## 2026-08-22 Dev NSIS E2E 实施更新
- 方案已按 Cyrus 最新任务书修订为 C→A→B→回滚 A；新增 Task 0–5。
- 已实现：严格本地 URL、真实本地服务器合同、逐跳重定向安全、build receipt driver 证据、真实服务器集成测试、主进程 Dev-E2E-only driver、Sandbox 外层编排脚本。
- 已重新构建含 driver 的 C=0.4.0/A=0.4.1/B=0.4.2；旧无 driver 包仅作历史证据。
- Windows Sandbox 内真实生命周期与负例：**已全部通过**（正向 C→A→B→回滚 A；负例 SHA 篡改、安装器启动失败、Dev-E2E 在安装器 spawn 前注入的取消（非 NSIS UI 点击）、重复回滚、目标未启动不提前确认）。证据在 `artifacts-dev/e2e-runs/`。
## 2026-08-23 Codex 验收收口完成
- 严格证据闭环 run：`e2e-autorun-022`，使用最终 C/A/B SHA（50875153…/ee80596d…/1e243ac3…）。
- 时间顺序满足：`run-input-manifest/input SHA` → `artifact-set` → lifecycle journals → `real-window-verification-*` → `final-update-center-assertions.json` → `E2E_OK`。
- 真实窗口验证：四个正向启动阶段均记录主窗口句柄从引导壳窗口切换到真实 Harness 窗口，避免“停留在加载壳”被误判为成功。
- 最终 update-center 断言通过：`knownGoodDesktop.version=0.4.1`，`downloadedDesktop/previousDesktop/installPending/rollbackPending` 均不存在。
- run `e2e-autorun-016/020/021` 仅作过程/功能证据：016 的 JSON 为事后补充；020 未持久化真实窗口证据；021 有检查但未写证据文件。
- 早期 run `e2e-autorun-015` 使用旧 C/A/B，不再与最终三份 SHA 混写为同一批产物。