# DeepSeek Harness Personal 治理总索引

> 状态：权威入口
> 机器源：`docs/governance/governance-index.json`
> 当前状态：`docs/governance/current-state.json`

## 一句话结论

当前唯一开发 workspace 位于 `F:\Projects\deepseek-harness-personal\workspace`；G0.5 为 `28d7c8c`，G1 已在其上精确提交为 `f5c58e5874a977aa5104a092e2e7c03472b6a4d7`，候选与 commit receipts 分别为 `local/receipts/op_g1_project_home_20260825_01.json` 和 `local/receipts/op_g1_project_home_20260825_01-commit.json`。`project-home/v1`、三套 `2.0.0` 三分区模板、整屋原子 Write Plan 与 `workspace` primary binding 已成为本地 Git 可重建基线，同时保持 `1.0.0` 历史回放；未 push、未发布。Cyrus 已授予“治理与开发连续执行包 V1”：G2、G3 范围内通过 receipt 与门禁的本地 commit 不再逐项询问，push/发布、真实 Stable/Dev 切换和旧项目源删除仍未授权。packed 日志写回证据转 G2-P0。G4 只允许先做 Amazon 单项目试迁并在验证后暂停；量化、食溯等待 Amazon 复盘后的新决策。B1b 继续暂停。

## 权威链

1. Cyrus 已拍板决策与 ADR；
2. 三分区、文档、工具/记忆等权威合同；
3. `.dsh-project/project.yaml` 项目身份；
4. `current-state.json` 当前机器/任务状态；
5. `NEXT.md` 执行指针、`BLOCKED.md` 阻断、`PROGRESS.md` 证据；
6. 当前任务的设计稿、评审、协议、测试与 receipt。

旧 handoff、历史 verification、旧 D 盘工作树和聊天摘要只作输入。任何 Harness 续接前必须重新读取机器索引与 current-state，不能凭上一次会话记忆推断当前进度。

正式全量测试入口是 `npm test`。不得用裸 `node --test` 代替，因为 Node 25 的默认发现会把 `test/fixtures/electron-*.js` 当普通测试执行；这些 fixture 只能由专门的 Electron 集成测试调用。

在 G2 把 retention/cleanup 和磁盘阈值做成机器闭环前，人工与 packed E2E 只能从 F 盘 canonical 生成一套按内容寻址的共享只读测试包，隔离 run 引用它而不复制它。每任务最多新建一套 package set；没有显式范围和 preflight 就不开跑。此条当前是失败关闭的操作规则，不冒充 G2 已实现。
