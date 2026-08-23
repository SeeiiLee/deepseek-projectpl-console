# ADR-005 测试版升级 rc.8 与个人插件构建适配

- 状态：**生效（补登记，2026-08-20；稳定版 0.4.0 已随 rc.8 发布，2026-08-20）**
- 关联：docs/compat.json；architecture/D2 §3.3 兼容矩阵；architecture/D1 §8 rc.8 决策项；governance/LLM项目治理说明书 §5

## 背景

上游 `deepseek-ai/deepseek-harness` 于 2026-08-19 发布 `0.1.0-rc.8`，包含 SQLite 存储结构不兼容变更、多模态、Claude Code/Codex 子代理 Profile Bundle、持久 PowerShell PTY 等。测试版需要跟进 rc.8，同时保持 18 个个人插件可构建、可启动。

实施过程中发现两个适配点：

1. rc.8 `dsh web` 默认自动打开浏览器并多打印一行，导致当前测试版客户端 readiness 解析器拒绝该行。
2. rc.8 `packages/client/tsdown.client.ts` 新增“构建包必须在 `packages/*/*/package.json` 中声明”的校验；个人插件位于上游 workspace 之外，直接使用官方 client 构建预设会失败。

## 决策

1. 测试版 Harness 运行时升级到 `0.1.0-rc.8`，commit `141eb6fef83422698aef7a981029e843e8161534`；rc.7 保留为回滚位。
2. 测试版客户端 `src/harness-helper.js` 为 `dsh web` 增加 `--no-open`，避免桌面壳内启动时触发浏览器打开与 readiness 误判。
3. `scripts/build-kit.mjs` 的构建根基线从 rc.7 更新为 rc.8（版本 + commit）。
4. 18 个个人插件的 `package.json` 中 `0.1.0-rc.7` 批量更新为 `0.1.0-rc.8`，并全部强制重建。
5. 对 rc.8 托管运行时的 `packages/client/tsdown.client.ts` 打本地补丁：当包名不在上游 workspace 时，回退读取当前插件目录自己的 `package.json`。该补丁仅存在于测试版托管运行时，不进入上游发布物。
6. 新增 `@tt-a1i/archify-dsh@0.1.0` 到测试版 `web` profile（社区 DSH 插件，仅 Skill 能力）。

## 否决项

- **不改插件 tsdown.config.ts 为私有预设**：18 个插件逐一替换为自定义构建预设的改动面大、偏离官方 client 合同；优先在托管运行时内做最小 fallback 补丁。
- ~~**不立即升级稳定版**：rc.8 存储不兼容且插件链迁移尚未经过完整回归，稳定版继续使用原基线。~~ **已解除**：测试版验收通过后，稳定版 0.4.0 已基于 rc.8 打包发布（2026-08-20）。

## 影响

- 测试版构建根、插件 peerDependencies、`compat.json` 基线同步为 rc.8。
- 托管运行时包含一处本地补丁；后续重新 prepare/覆盖该运行时需重新评估。
- 完整测试套件尚未重跑；当前已通过 build-plugins、verify-launch、rc.8 + 测试版 dev home 实际启动。
- 需在 DEVLOG 与 compat.json 登记；后续若稳定版跟进，应基于本 ADR 的适配经验重新走正式升级流程。
