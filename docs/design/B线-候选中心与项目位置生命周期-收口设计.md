# B 线：候选中心与项目位置生命周期收口设计

> 状态：Candidate Center 第一批已获 Cyrus 授权；代码复核发现的失败关闭漏洞已修复并通过本地机器验收；已获本地提交授权，不代表 push、发布或安装
> 日期：2026-08-26
> 当前已获代码范围：G4.1 陈旧 relocation 原子关闭 + G4.2 服务端过滤/计数/搜索/游标分页 + G4.3 项目/待审阅/已忽略/历史四视图与批量 soft-ignore/restore；本地 commit 已单独获批；不含 migration、项目归档、主动换绑、Stable 写入、push、安装或发布。

## 1. 结论

现在的问题不是“候选太多看着不舒服”，而是三个概念混在了同一个列表：

1. **待处理候选**：真的需要 Cyrus 判断或操作；
2. **候选历史**：已登记、已换绑或被新扫描取代的证据；
3. **已登记项目**：正式项目事实，不属于候选队列。

如果继续按当前实现把 `imported` 也放进“待审阅”，候选达到 100 条时，真正要处理的项可能被终态记录淹没；当前 Host 查询先 `LIMIT 100` 再交给 UI，单纯在浏览器端隐藏终态仍会漏掉更早的待处理项。

正确收口是：**项目列表、待审阅、已忽略、历史记录四个视图分开；写事务仍只有注册/rebind/archive 等唯一 Host 合同。**

## 2. 四个视图

### 2.1 项目

- 只展示正式 `projects`；候选数量不影响项目可见性。
- 默认展示 active、未归档项目；归档项目进入可恢复的“已归档”。
- 项目行提供“更换工作区”和“归档项目”，不提供直接改路径或物理删除。

### 2.2 待审阅

只包含可行动状态：

- `discovered`：可登记；
- `conflict`：必须解决身份/路径冲突；
- `relocation_candidate`：可确认换绑。

不包含：

- `imported`：已经完成；
- `ignored`：用户已决定暂不处理。

默认按阻断级别、候选类型、更新时间排序；支持搜索、状态筛选和分页。Host 必须先按状态过滤再分页，不能取 100 条后让 UI 过滤。

### 2.3 已忽略

- 默认折叠，只显示数量；进入后分页查看。
- `ignore` 是软操作，保留记录和完整候选指纹；只有路径、扫描模式、manifest project_id 与 manifest hash 均未变化时，重扫才继承忽略。manifest 内容或项目身份变化后必须重新浮出审阅。
- 支持单项恢复和勾选批量恢复。
- “清空待审阅”实际语义为：预览后批量 soft-ignore 当前可行动候选，不物理删除证据。

### 2.4 历史记录

- `imported`、已被更新扫描取代的记录、成功 rebind 对应的候选只在这里出现。
- 支持按项目、路径、扫描任务和时间过滤。
- 历史记录不再提供登记/rebind 主按钮，避免重复执行。

## 3. 重复候选的收口规则

扫描任务是不可变证据，因此同一路径可以产生多份候选；但同一时刻只能有一份可行动的最新投影。

接受 rebind 时，在同一 SQLite 事务中：

1. 验证本次 candidate revision、路径、manifest identity 和 project revision；
2. 切换唯一 active primary location；
3. 写 path history、event、outbox 和 receipt；
4. 把本次候选设为 `imported`；
5. 把其他满足“同 `root_path_key` + 同 `manifest_project_id` + 尚未匹配项目”的 relocation 候选一并设为 `imported`，包括此前软忽略、但 `status_before_ignored=relocation_candidate` 的旧候选；
6. 不触碰不同 project_id、不同路径、`conflict`，以及并非 relocation 来源的 `ignored` 候选；任一步失败全部回滚。

这不是删除历史，而是把已经失去行动意义的历史候选改成正确终态。

## 4. 绑定、解绑、换绑的统一语义

### 4.1 绑定

- 正式身份只来自既有 `project_id`；路径不创建身份。
- 新项目登记和既有项目关联继续走现有 register 合同。
- 成功后项目进入项目列表，候选进入历史记录。

### 4.2 换绑

- 项目行“更换工作区”和扫描发现“位置待重绑”只是两个入口。
- 两个入口都先生成/确认 relocation candidate，再走唯一 `project.rebindLocation` 事务。
- 禁止按钮直接更新 `workspace_locations`，禁止第二套路径逻辑。
- rebind 必须保持：同一项目恰好一个 active primary、旧路径 inactive、path history 可回放、失败无半状态。

### 4.3 “解绑”推荐改名为“归档项目”

用户通常想要的是“不要再显示、不要再绑定新会话”，不是销毁项目身份。

推荐 V1：

- `project.archive`：使用既有 `archived_at`，默认项目列表隐藏，禁止新会话绑定，保留 project_id、位置和历史；
- `project.unarchive`：清除归档状态，完整恢复；
- 项目位置不因归档而删除，避免身份和审计链断裂。

不推荐 V1：

- 物理删除项目；
- 让正式项目在未归档时没有 active primary；
- 把“解绑”实现成直接删 `workspace_locations`。

如果 Cyrus 未来确实需要“仅解除这台 Harness 的使用，但项目仍活跃”，那是 `harness_instance_id × project_id` 的实例绑定生命周期，属于 D5 新能力，不能伪装成项目路径解绑。

## 5. 批量能力

### 候选批量处理

- 勾选批量忽略；
- 预览影响数量、状态和路径；
- 一次 Host 事务处理，revision 任一漂移则整批失败；
- 批量恢复同理；
- 不提供 UI 物理删除。

### 项目批量处理

- V1 不做批量归档或批量换绑，避免误伤；
- 单项目归档可恢复；
- 换绑始终逐项目确认身份与目标路径。

## 6. 失败关闭边界

任一命中即拒绝：

- marker、manifest、candidate、目标 project_id 不一致；
- candidate 或 project revision 漂移；
- 目标路径已被其他 active 项目占用；
- rebind 后不是恰好一个 active primary；
- 批量操作包含不可转换状态；
- 未知状态、未知路径权限、reparse point 越界；
- 试图通过 Renderer 或数据库工具直接写路径；
- 把归档、忽略或 receipt 当成执行授权。

## 7. 推荐开发顺序

1. **G4.1 陈旧 relocation candidate 原子关闭**：当前隔离候选；仅 storage/intake/tests，无 migration、HTTP、UI。
2. **G4.2 候选读模型**：Host 支持 `view=review|ignored|history`、服务端状态过滤、搜索和游标分页；默认 review 不含终态。
3. **G4.3 候选中心 UI**：四视图、数量徽标、分页、批量 soft-ignore/restore；项目列表保持独立。
4. **G4.4 项目归档/恢复**：复用 `archived_at`，补 Host/HTTP/UI/审计；不做物理删除。
5. **G4.5 主动换绑入口**：项目行选目录 → 候选验证 → 复用 `project.rebindLocation`。
6. **G4.6 实例级解除使用评审**：只有 Cyrus 明确需要时才进入 D5；不与项目归档或路径换绑混做。

本轮把 G4.1–G4.3 作为一个有界的 Candidate Center 第一批共同验收；G4.4–G4.6 仍须独立授权，不因本设计或第一批实现存在而自动获准实施。

## 8. 第一批机器验收（G4.1-G4.3）

- 构造 120 条候选，其中 5 条 actionable、50 imported、50 ignored、15 旧扫描；默认 review 精确返回 5 条且分页 total=5。
- 待审阅默认顺序固定为：阻断项优先，再按 `conflict`、`relocation_candidate`、`discovered`，同类按更新时间倒序；游标必须属于当前视图、搜索条件和扫描任务，否则返回稳定的“从第一页刷新”错误，不能变成 500。
- imported 不出现在待审阅，但可从 history 通过 candidate_id 查到。
- 历史视图必须区分“已完成”和“已被新扫描取代”，旧 `discovered` 记录不得继续显示为“待确认”。
- ignored 默认折叠；完整指纹相同的重扫仍 ignored；manifest hash 或 project_id 变化后重新进入待审阅；恢复需 revision 匹配。
- 同路径同 project_id 的 relocation candidate（含被软忽略的旧 relocation）：接受后一并 imported，且不能再恢复后重复 rebind；不同 project_id 或不同路径候选保持原状态。
- rebind 任一后续写失败：两个候选、active path、history、event、outbox、receipt 全部回滚。
- 项目数量和候选数量互不影响；100+ 候选时所有正式项目仍可搜索、打开。
- 批量忽略/恢复确认框必须预览本页所选候选的状态与路径；任一 revision 漂移则整批回滚。
- 全程无物理删除、无 Renderer 直写 DB、无路径字段旁路更新。

本地复核修复结果：上述反例先红后绿；120 条混合候选断言通过；Project Control 191/191、排除未获授权的 Stable packed package-set E2E 后仓库测试 831/831，skipped/todo 均为 0；TypeScript `--noEmit`、插件门禁、治理门禁、启动门禁和 checkout 合同均通过。完整命令证据见 `local/receipts/op_b_g4_candidate_center_review_fix_20260826_01.json`；没有创建 package-set。

## 9. 后续批次验收（当前未授权）

- G4.4：archive 后默认项目列表隐藏且禁止新会话绑定；unarchive 恢复；project_id、路径和历史不变。
- G4.5：主动换绑与扫描换绑生成相同 command 合同，最终只调用一个 storage 事务。
