# DeepSeek Harness Personal 治理总索引

> 状态：权威入口
> 机器源：`docs/governance/governance-index.json`
> 当前状态：`docs/governance/current-state.json`

## 一句话结论

当前唯一 canonical 开发入口是 `F:\Projects\deepseek-harness-personal\workspace`；A 线生产链保持冻结，B1b 继续暂停。DSH 正式 Project Control binding 已切换到 canonical workspace；旧目录保留为可回滚历史且 Stable web profile 的失效绝对 link 已离线修复。原生 Workspace/旧会话连续性已随 Project Control `0.1.0-rc.13` 完成生产验收；空文档 managed upgrade 修复随后随 `0.1.0-rc.14` 发布，Stable 已重启并完成精确包与 25 个安装文件的机器验收。真实量化项目尚未调用 `prepare-upgrade` 或执行升级。当前唯一下一任务为 `G4-QUANT-CANONICAL-MIGRATION-READ-ONLY-PREFLIGHT`，只读刷新量化项目身份、路径历史、旧路径、U+200C、目录占用和回滚方案；真实迁移/rebind、食溯和 B1b 仍分门授权。项目搜索仍只支持 project_id 与已存名称的字面子串匹配。完整队列见 `docs/NEXT.md::权威后续任务队列` 与 `docs/governance/current-state.json::futureTasks`。

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
