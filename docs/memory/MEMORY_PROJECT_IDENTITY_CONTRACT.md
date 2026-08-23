# MEMORY_PROJECT_IDENTITY_CONTRACT.md（项目身份与 Session 绑定合同）

> 状态：P0 交付物 #2（2026-08-15）。依据：手册 v3 第 9.3.1 节与第 11 章决策 6（方案 D，Cyrus 拍板）。
> 已核验事实（2026-08-15 只读核验）：docs/PROJECT_CONTROL_DATA_MODEL.md（L15/L46/L112）与 plugins/project-control/migrations/0001_core_control_plane.sql（projects 表 L9–31、workspace_locations 表 L33–45）。

## 1. 身份唯一来源

1. **Project Control 的 project_id 是唯一项目身份**。已核验：两个项目入口（导入已有/快速新建）收敛同一种稳定 project_id；projectId 创建后不可修改、不可复用；路径、文件夹名、Git remote 只能用于发现，不能当 ID。
2. **记忆系统不得创建第二套 projects/project_uuid 注册表**。catalog.sqlite3 的 memory_projects 表只保存记忆自身事实（见 §4）。
3. 分支是项目视图，不默认独立项目；worktree 同 project_id（可带 workspace 覆盖）；stable/dev/test 是 deployment flavor，不是项目身份。

## 2. Session 绑定（方案 D）

- Session 创建或切换项目时，**显式绑定 project_id + locationRef/workspaceRoot**。
- 输入顺序（任一命中即绑定）：
  1. Project Control Host API 已认证的 Session/thread 绑定；
  2. launcher / Project Control 传入的 workspaceRoot → 经 workspace_locations 解析为 project_id；
  3. managed 项目目录的 project.yaml（.dsh-project/project.yaml）中 projectId 与 DB 一致 → 验证通过；
  4. 以上皆无 → Personal 默认根仅作**安全 fallback**（只读工作区，不默认写入任何项目）。
- 切换项目：刷新 memory scope，不沿用旧项目召回结果。

## 3. managed / linked_legacy

- managed：manifest（project.yaml）声明 projectId 为身份；记忆绑定其 project_id 与活动 primary 路径。
- linked_legacy：全局 DB 注册记录为身份；记忆同样只认 project_id，不重写项目目录。
- 两者对记忆系统无差异：都只消费 project_id + 路径绑定。

## 4. 记忆侧 catalog（memory_projects，v1）

| 字段 | 规则 |
|---|---|
| project_id | 引用 Project Control projects.project_id；PRIMARY KEY |
| memory_policy_id | 自动提取/保留期/召回范围策略引用 |
| sensitivity_class | public/internal/sensitive/restricted（CHECK） |
| retention_policy | 文本 |
| shard_locator | 相对 locator：projects/<project_id>/memory.sqlite3（不写绝对路径主键） |
| source_revision | 最近同步的 Project Control revision（cache 用途） |
| is_cache | 显示信息缓存标记；为 1 时必须带 source_revision 且可随时重建 |

- 项目显示名称/别名/路径/生命周期以 Project Control 为 canonical；需要展示时经 Host API 读取，或维护显式 is_cache=1 的可重建投影。
- 路径迁移：验证新根身份 → 更新 Project Control workspace_locations → 不改 claim scope 与历史 provenance；provenance 保留 portable locator（project://<project_id>/docs/NEXT.md#x）。

## 5. 冲突与 fail-closed

| 情形 | 行为 |
|---|---|
| 身份不明（无绑定、无 marker、无 DB 记录） | 只读检查；禁止长期写入；禁止跨项目召回；提示选择/注册项目 |
| marker 与 DB 冲突 | quarantine：停止长期写入，事件上报，人工处理 |
| 路径绑定 stale | 只读 + 提示重新解析；不自动重绑 |
| Project Control Host API 不可用 | fail closed：只读、不写记忆、不跨项目召回 |
| 记忆插件直连 Project Control SQLite | 禁止（其控制面约定仅唯一 Host 可读写） |

## 6. 验收断言（P0/P1 必须可测）

1. 同项目两条入口（导入/新建）最终获得同一 project_id 且记忆写入同一分片。
2. 路径改名/移动后：不产生新 project_id；新路径绑定生效；claim scope 不变。
3. 身份不明时：写入工具被拒；召回仅限 global_user。
4. 切换项目后：召回不含旧项目 claim（cross-project leak = 0）。
