# DeepSeek Harness Personal 治理总索引

> 状态：权威入口
> 机器源：`docs/governance/governance-index.json`
> 当前状态：`docs/governance/current-state.json`

## 一句话结论

当前唯一 canonical 开发入口是 `F:\Projects\deepseek-harness-personal\workspace`；A 线生产链保持冻结，B1b 原审批中心任务继续暂停。真实 Stable 客户端是 `0.4.6`、Project Control 是 `0.1.0-rc.10`；Amazon 已稳定换绑到 `F:\Projects\amazon-store\workspace`，K3 canonical 上下文已验收。Candidate Center 第一批已由本地产品提交 `7337bb36624672983e51f4229d3f96a43d4fe63e` 完成并通过 Project Control `191/191`、安全仓库套件 `831/831`，但尚未进入 Stable。当前唯一下一门是把产品与治理分支合成一条本地历史并制作/隔离验收 Project Control `0.1.0-rc.11` 单插件候选；push、Release、Stable 安装和项目换绑仍需分别授权。完整后续任务可随时从 `docs/NEXT.md::权威后续任务队列` 与 `docs/governance/current-state.json::futureTasks` 查询。

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
