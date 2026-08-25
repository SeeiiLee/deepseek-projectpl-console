# AGENTS.md（历史投影输入，已被 Toolbox 规范源取代）

> 自 2026-08-25 G3 起，唯一规范源是 `F:\Projects\toolbox\workspace\global\AGENTS.md`。
> 本文件只为历史回放保留；不得再由 `scripts/project-global-agents.js` 直写宿主。真实投影必须经过 Toolbox 的 plan/apply/receipt/doctor/rollback。
> 不可协商红线由 System Prompt 的 personal:cross-project-policy section 承担，本文件不复制其全文（决策 8）。

## 一、适用与优先级

- 适用于所有项目会话；项目/子树专属规则在各项目自己的 AGENTS.md 或项目文档中，更具体的规则优先。
- 本文件与 System Policy 冲突时，以 System Policy 为准。

## 二、证据与授权

- 声称「完成」必须有可复现证据；始终区分：已验证事实 / 合理推断 / 待决定方案 / 未知。
- 删除、覆盖、不可逆变更、系统配置、安装、commit、push、发布、外发、付费、真实数据写入：必须获得 Cyrus 针对明确对象与范围的当前授权。
- 门禁（Gate）通过只表示技术条件满足，不代表用户已授权。

## 三、规则文件定位（按需读取，不默认全读）

- 长期行为规则与授权矩阵：Personal 仓库 docs/WORKING_RULES_AND_PITFALLS.md
- 跨项目方法沉淀（NutriSight）：docs/WORK_RULES_AND_PITFALLS.md
- 技术踩坑速查：docs/经验.md
- 架构边界与 seam 目录：docs/架构设计.md
- 记忆系统蓝图与决策：docs/记忆系统手册.md
- 发布红线与门禁：docs/PUBLISHING_RULES.md
- 当前指针 / 待决 / 历史证据：docs/NEXT.md、docs/BLOCKED.md、docs/DEVLOG.md、docs/compat.json

## 四、开工检查清单（每次任务开始先过一遍）

1. 识别当前项目与受保护范围：稳定版安装目录、F 盘数据目录、legacy 数据目录与 DSH_HOME 一律不碰，除非获得当次明确授权。
2. 读取适用规则；规则缺失、冲突或安全状态不明时，停止危险动作并显式报告。
3. 新逻辑一律先在临时 fixture 验证，再碰主线；进程清理只按已验证 PID，绝不按名字。
4. 发布/外发前过 preflight 与发布清单，等 Cyrus 明确说「发」。
5. 记忆路由：用户说「记住/记一下」→ 用 memory_record（重要事实 confirm=true）；问「之前/上次/按约定/经验/坑」→ 先 memory_summary 再 memory_query；**禁止用写普通文件的方式替代记忆库**；不得声称改变了审批/权限设置。

## 五、稳定命令（Personal 仓库根，Windows；无全局 pnpm）

- 全量测试：npx.cmd -y pnpm@11.19.0 run test
- 插件门禁：npx.cmd -y pnpm@11.19.0 run check:plugins
- 治理门禁：npx.cmd -y pnpm@11.19.0 run check:governance
- 打包：npx.cmd -y pnpm@11.19.0 run pack:win（稳定） / pack:dev:portable（测试）
- 冒烟：npx.cmd -y pnpm@11.19.0 run smoke:packed:dir
- 发布扫描：node scripts/preflight-publish.js
- 记忆 schema 验证：node scripts/memory-schema-fixture.mjs

## 六、事故应急（常驻）

发生数据或运行时事故：立即停止进一步写入 → 保留证据 → 确认恢复点 → 最小恢复 → 显式报告。
