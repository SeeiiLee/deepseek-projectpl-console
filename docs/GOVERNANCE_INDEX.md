# DeepSeek Harness Personal 治理总索引

> 状态：权威入口
> 机器源：`docs/governance/governance-index.json`
> 当前状态：`docs/governance/current-state.json`

## 一句话结论

当前唯一 canonical 开发入口是 `F:\Projects\deepseek-harness-personal\workspace`；A 线生产链保持冻结。食溯清洁本地/远端主线与 GitHub Support 异步事故收尾状态不变；真实物理迁移尚未开始。迁移 Task 1 已完成旧路径活动入口收口，但官方 `prepare-upgrade` 因 DEVLOG、NEXT、PRD 登记哈希落后于已验收权威合并而正确失败关闭。Project Control 产品提交 `cf479676636caab52801bc339d3399eb90912e2b` 已提供 linked-legacy 专用、Host 新鲜重读且精确匹配的 `project.document-bindings.accept-current` 事务，并已 ff-only 合入 canonical；未写 Stable、未操作真实食溯。当前下一任务为 `B-G4-LEGACY-DOCUMENT-BINDING-HASH-ACCEPTANCE-RC15-LOCAL-CANDIDATE`，只制作一份本地单插件候选；其后依次经过 candidate commit/push/Release、Stable 安装与官方食溯哈希接受/prepare-upgrade，才恢复迁移/rebind。迁移闭环后先做 UI 地基，再进入 B1b。完整队列见 `docs/NEXT.md` 与机器治理索引。

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
