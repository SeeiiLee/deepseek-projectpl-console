# DeepSeek Harness Personal 治理总索引

> 状态：权威入口
> 机器源：`docs/governance/governance-index.json`
> 当前状态：`docs/governance/current-state.json`

## 一句话结论

当前唯一 canonical 开发入口是 `F:\Projects\deepseek-harness-personal\workspace`；A 线生产链保持冻结。Stable 仍运行 Project Control `0.1.0-rc.15`。食溯已完成旧文档哈希接受、managed upgrade、104,423 文件原子物理迁移、唯一 Host rebind，以及 Cyrus 人工完成的 Codex/Kimi canonical locator 对齐；Stable 仍为 revision=4、唯一 active root=`F:\Projects\meal-tracker\workspace`。managed `accept-current` 修复与 packed 生命周期隔离已精确提交为 `965f87ab1b8436547fa7039762a1ec3b3ea45b4a`，无 force 推送并发布为 Project Control `0.1.0-rc.16` / `plugins-v2026.08.30.2`。当前下一任务是另行授权后的 rc.16 Stable 安装验收，并只通过官方 Host 接受食溯 `docs/NEXT.md` 唯一冻结变化；尚未安装、尚未写 Stable。完成后才进入 UI 地基，再进入 B1b。

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
