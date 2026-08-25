# DeepSeek Harness Personal — 项目入口

本工作区的唯一项目身份是 `prj_01a0082e-fea8-7d6f-b6c2-08a259fba389`，canonical locator 是 `F:\Projects\deepseek-harness-personal\workspace`。路径只是 locator，不得据此创建新的 `project_id`。

## 每次任务的必读顺序

1. `docs/governance/governance-index.json`：权威链与文件角色；
2. `docs/governance/current-state.json`：当前基线、阶段、阻断和 freshness；
3. `docs/NEXT.md`、`docs/BLOCKED.md`、`docs/PROGRESS.md`：执行指针、阻断和证据；
4. 当前任务在 governance index 中列出的设计、ADR、评审与协议文件。

若聊天摘要、旧 handoff、旧目录文档或模型记忆与上述链冲突，以治理总索引及其当前状态为准。`D:\Deepseek Harness Personal` 和 `D:\CodexData\home\worktrees\ae51\Deepseek Harness Personal` 只作迁移/溯源输入，禁止继续扩建。

## 开工前失败关闭

- 核对 `.dsh-project/project.yaml`、Project Home marker 和 current-state 的 `projectId` 完全一致；
- 核对 Git HEAD 是 current-state 所列 `approvedParentCommit` 的后代；不一致时在任何写入前停止；
- 核对任务状态不是 `paused`/`blocked`，并读取所有 `blockingConditions`；
- 不把 imported/historical/input-only 文件当成当前权威；
- 未生成本任务的 context receipt 与测试 receipt，不得声称完成或交给下一 Harness 无缝续做。

## 当前红线

- A 线已经生产验收并冻结，不继续展开；
- B1b 暂停，禁止修改 migration、数据库、HTTP、UI、侧栏和审批收件箱；
- `D:\Deepseek Harness` 上游只读；不修改 A Release、真实 Stable、`F:\documents\Cyrus Deepseek Harness Data`；
- `local/`、旧 run/cache 和历史工作树不因“可重建”自动删除；清理必须 plan → approval/policy → apply → verify → receipt；
- 未经 Cyrus 单独授权，不 commit、不 push、不发布、不改 remote、不改系统计划任务或真实 Project Control binding。

人工或 packed E2E 必须从本 Project Home 的 canonical workspace 生成隔离 run。G2 机器闭环完成前，每个任务最多生成一套按内容寻址的只读测试包，所有 run 只能引用该共享包，不得逐 run 复制 Harness、Node 或安装包；任务没有明确 packed 测试范围和磁盘 preflight 时，不得开跑。

## 机器验收入口

- 正式全量测试只能运行 `npm test`；不得用裸 `node --test` 代替，后者会误发现 `test/fixtures/electron-*.js`；
- 每次交接前运行 `node scripts/check-checkout-contract.js`、`node scripts/verify-launch.js` 与 `git diff --check`；
- `node scripts/check-governance.js` 的任何失败必须逐项记录。Git remote 必须与机器治理索引逐项、逐 URL 完全一致；额外 remote、URL 漂移或显式 `pushurl` 一律失败关闭。登记 `origin` 只用于来源追溯，不构成 commit、push 或发布授权；
- `.gitattributes` 与 repo-local `core.autocrlf=false`/`core.safecrlf=true` 共同构成 checkout 合同。系统级 Git 设置不是项目真相。

## 文档治理

完整规则见 `docs/governance/LLM项目治理说明书.md`。一个主题只有一份权威文档；新增/修改/归档 docs 文件必须同步 `docs/INDEX.md`。ADR 只追加实施状态或由新 ADR supersede，不改写历史决策。
