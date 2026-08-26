# DeepSeek Harness Personal 治理总索引

> 状态：权威入口
> 机器源：`docs/governance/governance-index.json`
> 当前状态：`docs/governance/current-state.json`

## 一句话结论

当前唯一 canonical 开发入口是 `F:\Projects\deepseek-harness-personal\workspace`；A 线生产链保持冻结，B1b 继续暂停。真实 Stable 客户端是 `0.4.6`、Project Control 仍是 `0.1.0-rc.10`；Amazon binding 与 K3 canonical 上下文已对齐。Candidate Center 产品 `7337bb3`、治理 `3c918fb` 已由本地 merge `c0ababd` 合成一条历史；Project Control `0.1.0-rc.11` 的 checkout 绝对路径构建依赖已经关闭，canonical/任务 worktree 三份产物同 SHA。当前本地单插件候选为 `release-staging/plugins-v2026.08.26.3`，资产 SHA-256=`80476baf...4963`，但本轮 rc.11 源码候选未提交、未发布、未安装。当前唯一下一门是另行授权的 rc.11 精确 commit/push/单插件 Release；完整后续任务可随时从 `docs/NEXT.md::权威后续任务队列` 与 `docs/governance/current-state.json::futureTasks` 查询。

## 权威链

1. Cyrus 已拍板决策与 ADR；
2. 三分区、文档、工具/记忆等权威合同；
3. `.dsh-project/project.yaml` 项目身份；
4. `current-state.json` 当前机器/任务状态；
5. `NEXT.md` 执行指针、`BLOCKED.md` 阻断、`PROGRESS.md` 证据；
6. 当前任务的设计稿、评审、协议、测试与 receipt。

旧 handoff、历史 verification、旧 D 盘工作树和聊天摘要只作输入。任何 Harness 续接前必须重新读取机器索引与 current-state，不能凭上一次会话记忆推断当前进度。

正式全量测试入口是 `npm test`。不得用裸 `node --test` 代替，因为 Node 25 的默认发现会把 `test/fixtures/electron-*.js` 当普通测试执行；这些 fixture 只能由专门的 Electron 集成测试调用。

G2 已把 retention/cleanup、登记配额和磁盘阈值做成机器闭环。人工与 packed E2E 必须从 F 盘 canonical 生成或复用按内容寻址的共享只读测试包，隔离 run 只引用它，不逐 run 复制；每任务最多新增一套物理 package set。Windows 计划任务尚未创建，但大型 run/build 在维护逾期、对象未知、配额或磁盘不足时会失败关闭；启用系统级定时任务仍须单独授权。
