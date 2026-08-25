# DeepSeek Harness Personal 治理总索引

> 状态：权威入口
> 机器源：`docs/governance/governance-index.json`
> 当前状态：`docs/governance/current-state.json`

## 一句话结论

当前唯一开发 workspace 位于 `F:\Projects\deepseek-harness-personal\workspace`；G0.5=`28d7c8c`、G1=`f5c58e5`、G2-P0=`8dff0e3`。G2-P1 已完成本地机器验收：package set/run 登记、20 GiB 配额、5 GiB 磁盘底线、24h+12h 调度健康和 cleanup plan/apply/verify/receipt 全部落地；正式全量 818/818。相同包体只保留一套内容寻址 package set，不同来源证明进入小型 provenance ledger；旧 `artifacts` 证据零漂移。当前先按 receipt 精确本地提交 G2-P1，再执行 G3 toolbox Skill + memory-host 双端只读试点。Cyrus 的“治理与开发连续执行包 V1”继续有效；push/发布、真实 Stable/Dev 切换和旧项目源删除仍未授权。G4 只允许先做 Amazon 单项目试迁并在验证后暂停；量化、食溯等待新决策。B1b 继续暂停。

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
