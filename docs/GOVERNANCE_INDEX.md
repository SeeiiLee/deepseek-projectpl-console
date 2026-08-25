# DeepSeek Harness Personal 治理总索引

> 状态：权威入口
> 机器源：`docs/governance/governance-index.json`
> 当前状态：`docs/governance/current-state.json`

## 一句话结论

当前唯一开发候选位于 `F:\Projects\deepseek-harness-personal\workspace`，父基线是 A 线最终 `c27e989`；B1a 已按 hash 导入并通过正式全量 786/786。A 线清理证据已用 hash 和存在性检查只读登记，没有把六个大 run 再复制到 F 盘。canonical `origin` 已改为精确登记、漂移失败关闭，但登记不授权 commit/push。G0.5 候选逐文件清单已冻结，当前停在单独 commit 授权闸门；B1b、真实 Project Control binding、跨 Harness 与 local retention 仍未晋升。

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
