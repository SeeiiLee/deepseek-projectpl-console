# DeepSeek Harness Personal 治理总索引

> 状态：权威入口
> 机器源：`docs/governance/governance-index.json`
> 当前状态：`docs/governance/current-state.json`

## 一句话结论

当前唯一开发 workspace 位于 `F:\Projects\deepseek-harness-personal\workspace`；A 线生产链保持冻结，B1b 继续暂停。Amazon 正式身份是 `prj_01a01cb7-b3f5-7dd3-932f-1adc4d16a1dd`，canonical workspace 是 `F:\Projects\amazon-store\workspace`；旧 Kimi 目录仍在 Amazon Project Home 归档区。B-G4-0 `0.1.0-rc.9` 候选与 G2-P2 logical task/package-set 机器闭环已通过并形成产品提交 `2400410ca10e4a8e792d276bcde89faeb778e1e6`，正式全量 826/826；packed 复用现有 `f515424f...`，没有新增第四套。治理 release-gate 提交 `4658a6e337deaa5b4529f2fdc4066aabd487d787` 及其祖先已推送到 `codex/governance-alignment`，同名 tag `plugins-v2026.08.25.1` 精确指向该提交；现有 Release `376569643` 已公开，四项资产的 Project Control 包 SHA-256 为 `01e0a7785a13227422d6e5e5c3677c2b9cf50bc146e4821718c4b3cc598902ca`。真实 Stable 数据库、安装和 binding 均未改；下一步是单独授权 Stable 插件安装，安装验收后再重新只读核对候选并预览 rebind。

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
