# DeepSeek Harness Personal 治理总索引

> 状态：权威入口
> 机器源：`docs/governance/governance-index.json`
> 当前状态：`docs/governance/current-state.json`

## 一句话结论

当前唯一 canonical 开发入口是 `F:\Projects\deepseek-harness-personal\workspace`；A 线生产链保持冻结。Project Control `0.1.0-rc.15` 已进入 Stable。食溯已完成旧文档哈希接受、managed upgrade、104,423 文件原子物理迁移、唯一 Host rebind，以及 Cyrus 人工完成的 Codex/Kimi canonical locator 对齐；Stable 仍为 revision=4、唯一 active root=`F:\Projects\meal-tracker\workspace`。rc.15 对 managed 项目的 `accept-current` 正确失败关闭，因此状态化 `docs/NEXT.md` 的唯一剩余绑定变化尚未写入 Stable。产品提交 `2588b6bd07a3cbfafd5a218b33dd6132d67a7d14` 已在同一官方事务中补齐 managed manifest/mirror 原子接受并 ff-only 合入 canonical；当前下一任务是只制作 Project Control rc.16 本地单插件候选并执行受治理 packed 验收。push、Release、Stable 安装与真实食溯 NEXT 接受仍是后续独立门；完成后才进入 UI 地基，再进入 B1b。

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
