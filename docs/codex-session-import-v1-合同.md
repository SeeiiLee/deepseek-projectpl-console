# Codex 会话导入合同 v1（codex-session-import/v1）

> 依据：docs/P4完成后路线图-Codex历史导入-P6稳定化-P5后置.md 阶段 1（P6-0A）。
> 状态：已冻结为导入适配器合同；未来源格式变化必须显式升版（v2…），禁止静默适配。

## 1. 源格式观察（本机实测，2026-08-17）

- 源根：%USERPROFILE%\.codex\sessions\<年>\<月>\<日>\rollout-<时间戳>-<uuid>.jsonl（uuid = session id）。
- **junction 观察（2026-08-17 实测）**：%USERPROFILE%\.codex\sessions 是指向 D:\CodexData\home\sessions 的 junction；canonical 根记为两者，`source_file` 用遍历根相对路径（可穿过 junction 读取），`source_realpath` 用 canonical 去重/哈希。
- 行结构：每行一个 JSON 对象，键为 timestamp / type / payload。
- 实测事件类型（7 种）：session_meta、event_msg、response_item、world_state、turn_context、compacted、inter_agent_communication_metadata。
- session_meta.payload 关键字段：session_id、cwd、forked_from_id、parent_thread_id、originator、cli_version、source、thread_source、memory_mode、agent_nickname 等（base_instructions/dynamic_tools/git/context_window 为对象，默认不进记忆提取）。
- **血缘命名空间（2026-08-17 实测）**：forked_from_id / parent_thread_id 引用「逻辑会话 id」，与文件名 rollout uuid 不是同一空间；同一逻辑会话可有多个 rollout 文件。去重按逻辑 id 血缘，祖先集合 = 父逻辑 id 传递闭包下的全部 rollout。
- 语料规模（盘点结果以最新 inventory 输出为准）：约 308 个唯一 JSONL、3.09 GiB、31 个 cwd；含 fork/subagent、工具事件、压缩与其他非对话记录。

## 2. 适配器字段合同（每条输出记录必含）

| 字段 | 语义 | 来源 |
|---|---|---|
| source_file_sha256 | 源文件哈希（追责与去重） | 盘点/解析时计算 |
| source_session_id | 会话 id（文件名 uuid；与 session_meta.session_id 核对） | 文件名 + session_meta |
| parent_session_id | 血缘（forked_from_id 优先，其次 parent_thread_id） | session_meta.payload |
| event_id / turn_id | 事件序号（行号）+ payload 内 id | 行序 + payload |
| timestamp | 事件时间 | 行级 timestamp |
| role | 角色（user/assistant/tool/…，P6-0B 细化） | payload |
| event_type | 事件类型白名单枚举 | 行级 type |
| cwd | 会话工作目录 | session_meta.payload.cwd |
| project_resolution | mapped / unmapped / ambiguous / rebind | 项目映射表 |
| portable_locator | codex://<session_id>#<line_seq> 可回溯引用 | 构造 |
| content_hash | 内容哈希（去重/幂等） | sha256(规范化正文) |
| parser_version | 解析器版本 | 适配器常量 |
| format_observation | codex-session-import/v1 | 合同版本 |
| status | processed / quarantined / retryable / skipped_with_reason | 处理结果 |

## 3. 事件白名单（决定什么能进入记忆提取候选通道）

- **允许进入（P6-0B 再按 payload 细分）**：event_msg 与 response_item 中的用户消息、助手最终答复、必要的阶段结论。
- **默认排除**：world_state、inter_agent_communication_metadata、compacted（派生物，不作为来源真相）、token/usage 统计、base_instructions 与 system/developer 指令、reasoning 内部思考。
- 排除项不进入提取，但仍保留在证据索引层（可追溯），不复制进记忆库。

## 4. 活跃/被锁文件策略

- 盘点或解析时无法稳定读取的文件 → status=retryable，记录原因；会话关闭后重跑。
- 禁止静默漏掉：任何文件都必须有确定状态，未说明的跳过 = 0（验收线）。

## 5. 覆盖率语义

- 本合同的「全量」= 本机可见语料 100% 登记处理；云端/其他设备不存在于本机的会话不计入，报告必须写明「本机可见语料覆盖率」。

## 6. 三层落点（对应路线图 §3）

- A 原始档案层：源文件只读引用/加密归档（live memory root 之外），不进召回。
- B 证据索引层：session/turn 哈希、时间、角色、项目归属、locator；记忆库只存 evidence pointer 与短摘录。
- C 长期记忆层：只提炼决定/偏好/约束/事故根因/方法/未决事项 → candidate + llm_extracted，人工确认才 active。

## 7. 项目映射规则（关键治理）

- 映射唯一依据：cwd → Project Control 已登记 project_id 的绑定；路径迁移用显式 alias/rebind 表。
- 唯一匹配 → 对应项目 staging；无匹配/多匹配 → unmapped/quarantine。
- 禁止凭内容猜测项目；禁止未登记时自动写入 global_user（fail closed）。
- 当前登记状态（2026-08-17）：仅食溯（mealtracker）已注册；亚马逊店铺、量化盯盘尚未注册——导入前需先在 Project Control 注册身份，否则该部分语料进入 quarantine。

## 8. 敏感与隐私门禁

- 全部导入内容在写入前过既有写入门禁（密钥/PAT/身份证/银行卡硬拦截）；候选提取调用远程模型前必须 fail closed 并单独授权（路线图阶段 4）。
- 原始会话不得作为调试日志输出；日志只含计数与哈希。

## 9. 升版规则

- Codex 源格式变化（行结构/事件类型/血缘字段语义变化）→ 新观察版本 v2 + 新适配器；旧版本输出必须标注其格式观察版本，不混用。
