# D5 · 统一工具层：跨 Harness 技能/插件/MCP/CLI 共用架构

> 状态：v4.1（v4 审核结论不变；2026-08-22 增补与 Project Control Work Board/路由策略的薄接缝，待 K3 复核） ｜ 日期：2026-08-22 ｜ 原作者：Kimi K3 ｜ 本轮修订：Codex
> 定位：**跨端三支柱之三**——D1（插件独立更新通道，DSH 内）× D4（记忆跨端复用）× D5（工具能力跨端复用）
> 审核留档：`docs/reviews/D5-统一工具层-首轮架构审核-Codex.md`、`docs/reviews/D5-统一工具层-二次架构审核-Codex.md`（v3 已吸收；逐项复核表见 §13）、`docs/reviews/D5-统一工具层-第三次架构审核-Codex.md`（v4 已吸收；逐项复核表见 §14）
> 上游依据：DSH rc.8 subagent 家族；ACP 生态注册表；OpenAI Codex Skills/MCP 官方文档；Zcode 官方 Plugin 文档；腾讯 WorkBuddy 官方 Skills/连接器文档；MCP 2026-07-28 规范（transport/versioning）
> 关联：`docs/architecture/D1-插件独立更新通道-架构设计.md`、`docs/architecture/D4-记忆系统跨Harness复用方案.md`、`docs/design/B线-控制台审批中心与治理视图-设计稿.md`、`docs/adr/ADR-004-project-control合同族扩展-治理语义与审批队列.md`、`docs/governance/项目路径绑定盘点表.md`

## 修订记录

- **v4.1（2026-08-22）**：不改变 v4 控制面、生命周期或分期，补齐 D5 与 Project Control 的最小接口（§11.1）：Project Control 拥有 WorkItem/Run/Review/route policy 与原子 claim；D5 只做 capability/surface/instance 解析并返回 resolution receipt；Harness 新增/替换/退役只改变候选解析，不改工具 manifest、项目身份或历史 Run；workflow 的供应商节点降为能力节点 + provider binding。明确工具层不接管任务队列、不依据额度直接派发。
- **v4（2026-08-21）**：吸收第三次审核（有条件通过）。补齐四类最小合同 + 两项加固，不开新一轮宽泛发散：①**产品与实例双层身份**——保留不可变 `harness_id`，新增机器本地 `harness_instance_id` + instance inventory/receipt，binding 唯一键改 `(harness_instance_id, project_id)`（§7.1/§7.2）；②**版本化 surface registry**——新增 `schemas/surfaces.v1.json` 冻结 canonical surface 词汇表，逐 surface 保存 probe evidence，resolver 硬门顺序冻结（§4.1/§7.1/§7.3）；③**项目缺省拒绝与身份冲突**——base profile 不得授权项目、无 profile = unconfigured、六态对账、既有双 `project_id` 标 `identity_conflict` 交回 Project Control（§7.2）；④**可证明的 retire receipt**——区分本地引用清零与远端授权撤销，终态 `clean / exceptions_approved / incomplete`（§7.5）；⑤幂等与实例级并发互斥、`rollback_coverage` 如实标注（§5.1）；⑥管线机器可判定终态（§7.8）。新增两个强制反例验收（§7.10）。同步修正 D4 §3/§4/§5 非 DSH 端项目身份口径（D4 口径修正②）。Codex 结论：本版修完即可进入 D5-0。
- **v3 + 第三次审核注记（2026-08-21）**：Codex 复核确认 v3 主架构有条件通过；登记 4 项 P1 合同缺口与 2 项 P2 加固项；把 D5-0 遗留的固定"五端"字样改为"已登记端"。（注记已被 v4 吸收）
- **v3（2026-08-21）**：吸收二轮审核。新增 **D5-8 Harness 生命周期与能力协商**（§7）：工具 manifest 从枚举 Harness 改为能力/surface 声明；新增 harness descriptor / 项目能力 profile / binding receipt 三个最小 schema 与 retire 流程；adapter 与路线图改 descriptor 驱动；新增接入/退役/替换流程。Cyrus 治理补充落位：**卸载默认不变更原则**（§7.6）、**re-onboard 路径**（§7.7）、**一句话配置管线**（§7.8）。修正两处过度推断：D4 seam 对齐手册 v4；AnySearch 服务端能力改"未知，待 handshake 实测"（§8）。
- **v2（2026-08-21）**：吸收首轮审核。控制面定位；manifest/lock/receipt 三层；投影五段生命周期；端能力矩阵；记忆 Host 合同；副作用分级；分期重排 D5-0→3。否决 v1 三处设计（唯一正本/五端同上线/手工版本账）。
- **v1（2026-08-21）**：初稿。

---

## 0. 待拍板决策清单（v4.1）

| # | 决策 | 建议 |
|---|---|---|
| D5-1 | 统一的是**目录/控制面**；工具自身仓库与 manifest 保持权威 | 采纳（§2） |
| D5-2 | toolbox 按 ADR-009 落为标准 Project Home：`F:\Projects\toolbox\{workspace,worktrees,local}`；声明/合同进 workspace，实例/receipt/锁进 local | 采纳（§3） |
| D5-3 | manifest（声明）/ toolbox.lock.json（生成期望）/ receipt（机器实装）三层分离 + 版本化 surface registry 作共同词汇表 | 采纳（§4） |
| D5-4 | 投影生命周期 doctor→plan→apply→receipt→rollback，只改适配器拥有的对象；操作幂等 + 实例级互斥 | 采纳（§5/§5.1） |
| D5-5 | 治理按**真实副作用**分级，不按文件类型 | 采纳（§9） |
| D5-6 | 插件跨端出口：五问过滤，AnySearch 直连 handshake 优先验证 | 采纳（§8） |
| D5-7 | 分期 D5-0→D5-1（DSH Dev+Codex 两端闭环）→D5-2（记忆只读）→D5-3（受控写+逐端扩，descriptor 驱动不写死名单） | 采纳（§10） |
| D5-8 | **Harness 生命周期与能力协商**：descriptor（产品家族）+ instance inventory（安装实例）+ surface 解析 + 项目绑定 receipt + retire receipt；新增端工具 manifest 零修改 | 采纳（§7；v4 已补实例层/surface registry/缺省拒绝/retire receipt 四项合同） |
| D5-9 | **Project Control 薄接缝**：Project Control 管任务/审批/认领，D5 只解析实例/能力并回 receipt；Harness 生命周期变化不改工作流模板 | 采纳（§11.1；v4.1 新增） |

**红线（三轮审核确立，v4.1 延续）**：D5 不建中央数据库、不建常驻任务编排服务、不做双向自动同步、不要求各端同时上线、工具层不保存任务/记忆正文与密钥；D5 只定义工具投影 plan、能力解析、证据与 receipt。Project Control 的既有本地 DB 仍是工作状态权威，不属于 D5 新建中央服务；安装/卸载/迁移/撤凭据/上传/付费调用均须 Cyrus 单独批准。

## 1. 定位与问题

Cyrus 多端并用且**端名单会随时间变化**（新增 Zcode、退役 QClaw、换用 WorkBuddy、旧端回归）。D5 解决两件事：①一套统一的能力目录与控制面，各端经薄适配器接入；②**Harness 的新增、替换、退役、回归是可重复的标准流程**，不靠临时记忆和手工搬运。

v4 进一步明确：**「Harness 产品」与「Harness 实例」不是一回事**（实测事实：本机 DSH 稳定版与开发版拥有不同 AppId/userData/DSH_HOME/Project Control DB；Zcode 本地与 SSH/WSL 远程工作区插件互不同步）。D5 所有 binding/apply/retire/receipt 均对准**实例**，产品家族只承担 adapter 与 provenance 命名。

## 2. 事实源模型：三类事实 + 一类运行数据（D5-1）

1. **资产事实源 = 工具自己的仓库与 manifest**。D5 只引用，不复制版本/哈希。
2. **期望状态 = `toolbox.lock.json`**（由 manifests + profiles + descriptors + surface registry 聚合生成，可审查可复建，非手写）。
3. **实装状态 = 机器本地 receipt**（专用数据根，不反写 Git）。
4. **运行数据**（密钥/token/记忆库/模型/缓存/日志/备份/队列锁/实例 inventory）全部外置专用数据根，不进 toolbox Git。

**漂移样例（实测留证）**：`plugin-set.lock.json` 声明 rc.7 vs `plugins/anysearch/package.json` peerDeps rc.8——手填版本账的必然结局；处置列入 D5-0，D5 不再新增手工版本账。

## 3. toolbox 控制面目录（D5-2，v4 修订）

```text
F:\Projects\toolbox\workspace\           # Git 仓库：声明与合同层
├── manifests/              # 工具能力/surface 声明（不枚举 Harness 名单）
├── harnesses/              # 每端产品家族一个 descriptor：harnesses/<harness_id>/harness.json
├── adapters/               # 薄适配器，由 descriptor 引用，代码里不写死端名单
├── profiles/
│   ├── base.json           # 通用能力偏好（不得授予任何项目访问，§7.2）
│   └── projects/<project_id>.json   # 项目能力需求与数据边界
├── schemas/                # manifest / lock / receipt / harness / instance / profile / retire-receipt schema
│   └── surfaces.v1.json    # 版本化 canonical surface 注册表（§7.1）
├── scripts/                # doctor / plan / apply / rollback / retire / onboard / reactivate
└── toolbox.lock.json       # 生成物
```

机器本地专用数据根（**不进 Git**）：`F:\Projects\toolbox\local\`，保存 `instances/<harness_instance_id>.json`（实例 inventory）、receipts、retire receipts、operation 互斥锁和 probe 证据正文。toolbox 自身的开发 checkout 进入 `F:\Projects\toolbox\worktrees\`。

不进 toolbox：大型/独立工具源码、CLI 本体、模型、记忆数据、任何运行数据。

## 4. 三层清单（D5-3，v4 修订）

### 4.1 manifest（手写声明层）——surface 声明制 + 注册表词汇

```jsonc
{
  "id": "anysearch",
  "kind": "mcp | skill | cli | prompt | plugin-mcp-candidate",
  "capabilities": ["web_search"],
  "provides": ["mcp-tool/web-search"],
  "requires_surfaces": ["mcp/streamable-http", "auth/bearer-env"],  // 仅可引用 schemas/surfaces.v1.json 已冻结 ID
  "source": "权威仓库/制品引用",
  "version": "由权威源生成或校验",
  "integrity": "source 完整性",
  "risk": { "exec": false, "network": true, "external_write": false, "sensitive_data": false, "paid": true },
  "adapter": "adapters/...",
  "host_compat": "宿主兼容范围",
  "target_overrides": {}    // 仅确有证据的宿主特例，常态为空
}
```

**v3 关键改动**：删除逐端手写的 `supported_targets`——兼容矩阵由 resolver 计算生成（§7.3），写进 lock/报告；manifest 只声明"我提供什么能力、我需要什么标准 surface"。**新增标准兼容 Harness 的目标：工具 manifest 修改数 = 0。**

**v4 加固**：`requires_surfaces` 不再是自由字符串，只允许引用 `schemas/surfaces.v1.json` 中的 canonical ID；registry 本身版本化（v1/v2…），新增 surface 需走 schema 评审，防止"字符串碰巧匹配"产生假 `exact`。

### 4.2 lock（生成期望层）

lock 聚合生成，**生成头必须包含 manifest / profile / descriptor / surface-registry / resolver 五方的版本或哈希**——否则兼容矩阵不可复现（v4）。

### 4.3 receipt（机器实装层）

```jsonc
{
  "operation_id": "op_...",
  "harness_instance_id": "hinst_...",
  "desired_lock_hash": "sha256:...",
  "plan_hash": "sha256:...",
  "precondition_hash": "sha256:...",
  "adapter_version": "...",
  "managed_objects": ["..."],
  "output_hash": "sha256:...",
  "rollback_coverage": "full | partial | manual | none",
  "result": "applied | failed | rolled_back",
  "ts": "..."
}
```

观察状态（实装端、时间戳）一律生成不手填。`rollback_coverage` 如实标注：涉及宿主 UI 人工步骤（如 WorkBuddy）只能是 `partial/manual/none`，不因管线有 rollback 命令就承诺外部动作可自动撤回（v4）。

## 5. 投影生命周期（D5-4）

```text
doctor（只读）→ plan/diff → apply（只改受管对象；写前备份；原子落盘）→ receipt → rollback
```

受管对象原则：不重写宿主完整配置；优先宿主 CLI/项目级配置/受管条目/可验证结构化合并；Codex `config.toml` 的 MCP 启停/超时/OAuth/env/逐工具审批属宿主私有策略必须保留。junction 仅限已实测支持、本地可达、不跨受保护数据根的目录型资产。新鲜度 = desired lock + adapter version + receipt + 当前输出四方对账。skill 按**目录包**（SKILL.md + scripts/references/assets/依赖声明）处理。

### 5.1 幂等与并发前置（v4 新增）

1. 每个 `harness_instance_id` **同时只允许一个 mutation operation**（实例级互斥锁，锁存于机器数据根）。
2. plan 与 receipt 必带 `operation_id / plan_hash / precondition_hash`；**相同 operation 重试返回同一结果或安全续跑**，不重复写受管对象。
3. 执行前校验 `precondition_hash`：当前状态与批准时不同（drift）→ **必须重新 plan、重新出审批卡**，不得沿用旧批准。
4. `adapter_version` 记入 receipt：adapter 升级后旧 receipt 自动失效待复核。

## 6. 端能力矩阵（endpoint 五分类，descriptor 驱动）

endpoint 类型：①本地文件型 ②本地进程型（stdio，**各端各自起进程**）③远程 HTTP MCP/插件型 ④托管/Web 型（读不到 F 盘，接入属外部动作）⑤ACP 子代理型。

| harness_id | 类型 | 关键能力 | 核实状态（2026-08-21） |
|---|---|---|---|
| `dsh`（稳定/开发 = 两个实例） | ①② | plugins/ + Profile；进程内/stdio | **verified**（本仓库实测） |
| `codex` | ①② | skill 目录包（支持链接）；config.toml MCP 段（含私有策略） | **verified**（官方文档 + 本机实测） |
| `kimi-work` | ①②? | skills 目录存在 | **unverified**（D5-0 实测） |
| `kimi-desktop` | 未核实 | — | **unverified** |
| `qclaw` | ①? | skills 目录存在 | **unverified**（加载语义未核实） |
| `kimi-cli-acp`（作 DSH 子代理） | ⑤ | `kimi acp` | 协议存在 **verified**；本机可用性 **unverified**（B3 spike ④） |
| `zcode` | ①② | 插件可打包 Skills/Commands/Subagents/Hooks/MCP；本地目录/Git/Marketplace 安装；**本地与 SSH/WSL 远程工作区为独立实例** | **verified**（官方 Plugin 文档，2026-08-21） |
| `workbuddy-tencent` | ①? | 官方确认可导入本地 Skill 包、可装自定义 MCP 连接器（均有启停/卸载） | 文档 **verified**；**无 UI 批量安装/CLI/API 未核实 → unverified** |

**本表行 = 产品家族快照**；实例级逐 surface 证据存于 instance inventory（§7.1），版本升级后须重新 probe，旧验证结论不自动继承。

## 7. D5-8 · Harness 生命周期与能力协商（核心章，v4 合同补齐）

### 7.1 双层身份：产品 descriptor + 实例 inventory

**产品 descriptor**（Git：`harnesses/<harness_id>/harness.json`，描述产品/adapter 家族）：

```jsonc
{
  "harness_id": "zcode",               // 一旦产生 receipt 或 memory provenance 即不可变
  "display_name": "Zcode",
  "adapter": "adapters/zcode/...",
  "config_scope": ["user", "project"],
  "reload": "宿主重载方式",
  "permission_model": "审批/沙箱摘要",
  "descriptor_version": "sha256:..."
}
```

**实例 inventory**（机器本地数据根：`instances/<harness_instance_id>.json`，不进 Git）：

```jsonc
{
  "harness_id": "dsh",                    // 产品/adapter 家族；历史 provenance 不可变
  "harness_instance_id": "hinst_...",     // 本机专用数据根生成的非敏感稳定 ID
  "deployment_flavor": "stable | test | dev | desktop | cli | web | remote",
  "environment": "local | wsl | ssh | hosted",
  "host_version": "本实例本轮核实版本",
  "descriptor_hash": "sha256:...",
  "lifecycle": "candidate | shadow | active | retiring | retired",
  "reactivates_instance_id": null,         // 干净重装/新 profile 时留关系；无证据不得猜测复用
  "surfaces": {                            // 逐 surface 独立证据；未知就是 unknown，不继承其他字段的 verified 状态
    "mcp/streamable-http": { "status": "verified | unknown | absent", "probe_id": "probe_...", "verified_at": "...", "host_version": "...", "evidence_hash": "sha256:..." }
  },
  "replaced_by": null
}
```

**surface 注册表**（Git：`schemas/surfaces.v1.json`，冻结少量 canonical ID，manifest 与 descriptor 共用同一结构）：每个 surface 最少表达 `id`、`transport/format`、`protocol_range_or_era`、`auth_modes`、`locality`、`platform`、`required_features`。示例：`mcp/stdio`、`mcp/streamable-http`（modern）、`mcp/sse-legacy`（legacy，协议代际不同不得与 modern 互判 exact）、`skill-package/v1`、`auth/bearer-env`、`acp/stdio`。

**实例 ID 规则**：同一 profile 恢复安装可沿用原 instance ID；干净重装/新 profile 生成新 instance ID，用 `reactivates_instance_id` 留关系；**无证据时不得猜测复用**。apply/rollback/retire 全部对准 `harness_instance_id`；审批卡同时展示产品名、flavor、environment、版本与目标配置范围。

### 7.2 项目能力 profile、缺省拒绝与绑定 receipt

项目 profile（不复制项目事实，只描述能力需求与数据边界）：

```jsonc
{
  "project_id": "prj_...",
  "required_capabilities": ["memory_recall", "web_search", "repo_read"],
  "optional_capabilities": ["repo_write"],
  "data_class": "internal",
  "allow_hosted_execution": false,       // 高风险字段缺省一律 false
  "allow_upload": false,
  "allow_memory_write": false
}
```

**缺省拒绝纪律（v4）**：

1. `base.json` 只表达通用能力偏好，**不得授予任何项目访问**——base 被误当授权 = 新端在未确认项目上获得 repo/记忆访问，禁止。
2. Project Control active inventory 中**每个项目都必须进 gap report**：无 profile = `unconfigured`（不生成 binding、不开放 repo/记忆）；archived/不可达 = `not_applicable`；**不得静默跳过任何项目**。
3. 未知数据等级 fail closed；高风险字段缺省 `false`。
4. resolver 必须经 Project Control 的 `project_id + workspace_location_id` 解析本机位置；**不得用路径、Git remote、文件夹名或本地用户 ID 创造项目身份**。
5. 既有同一物理项目双 `project_id`（稳定/开发库分叉）标 **`identity_conflict`** 并阻止绑定，交回 Project Control 治理/重绑流程处理；**D5 不自行 merge、改号或挑选"看起来像"的 ID**。
6. **"全部项目接入"完成定义**：`Project Control active inventory 总数 = exact + adapted + degraded + blocked + unconfigured + not_applicable 六态总数`，左右对账必须相等。

端侧接入成功后写 binding receipt（唯一键 = `(harness_instance_id, project_id)`；项目多 location 时加 `workspace_location_id`）：

```jsonc
{
  "harness_id": "zcode",
  "harness_instance_id": "hinst_...",
  "project_id": "prj_...",
  "workspace_location_id": "wloc_...",     // Project Control 颁发
  "resolved_local_path": "F:\\Projects\\products\\meal-tracker",  // 仅 locator，由身份解析而来，不作身份
  "binding_state": "shadow | active | retired",
  "tool_coverage": { "exact": 0, "adapted": 0, "degraded": 0, "blocked": 0 },
  "operation_id": "op_...",
  "plan_hash": "sha256:...",
  "precondition_hash": "sha256:...",
  "adapter_version": "...",
  "rollback_coverage": "full | partial | manual | none",
  "receipt_ts": "生成时间"
}
```

**Project Control 继续拥有项目身份与 workspace locations；D5 只读 `project_id`，不建第二套项目注册表，不复制项目源码。** 本地 Harness 优先打开项目正本；托管 Harness 只能 Git/上传时，必须单独检查未提交内容、敏感等级与外传授权，不得静默上传或把 clone 当新 `project_id`。

### 7.3 解析数据流（能力协商，硬门顺序冻结）

```text
项目能力需求 × 工具能力目录 × Harness 实例已验证 surfaces
  → resolver 硬门顺序（固定，v4 冻结）：
      ① 项目身份（identity_conflict → blocked；无 profile → unconfigured）
      ② lifecycle / 实例状态
      ③ 数据外传与 locality（data_class / allow_hosted_execution / allow_upload）
      ④ 权限 / 凭据 / 付费门
      ⑤ 协议 / 版本 / surface（逐 surface evidence；代际不符 ≠ exact）
      ⑥ adapter 可用性
      ⑦ coverage 汇总
  → 兼容矩阵：exact / adapted / degraded / blocked / unconfigured / not_applicable
  → plan（工具投影 + 项目绑定 + 权限/数据差距）
  → apply / receipt / doctor / rollback / retire
```

**任何硬门未知或不满足 = `blocked`，不得降成 `adapted/degraded` 继续自动 apply**（v4）。

"快速匹配"的准确定义：**自动接入适用能力，如实列出降级与阻塞项**——不是强迫所有工具进所有端。

### 7.4 新端接入流程（candidate → shadow → active，按实例执行）

1. `candidate`：新增产品 descriptor；只读 probe——**每个安装实例分别生成 instance inventory**（本地/WSL/SSH/hosted 各自独立）。
2. resolve：用版本化 surface registry 逐项证据 resolve；先过项目身份/数据/权限硬门；对 base profile + Project Control 全量 active 项目生成六态差距报告；不改宿主。
3. adapter：只为 `adapted` 项实现薄适配；`blocked` 如实保留。
4. `shadow`：选一个低风险项目，只开只读工具与记忆 recall；不接管默认路由。
5. 验收：工具发现/调用、项目身份、权限、记忆隔离、rollback、宿主重启后状态。
6. `active`：逐项目 apply，每个项目各有精确到实例的 binding receipt。

**验收目标**：标准工具 manifest 修改数 = 0；项目源码搬迁数 = 0；`project_id` 变化数 = 0；一份完整 gap report（六态对账相等）；一个真实 pilot 项目；每个活动绑定有 receipt；memory cross-project leak = 0；多实例反例通过（§7.10）。

### 7.5 退役与替换流程（QClaw → WorkBuddy 范式）

**不做"宿主副本互搬"**——新端从工具与项目权威源重新物化，再退役旧端：

1. 新端以 `candidate` 接入（新产品 ID + 新 instance ID），生成与旧端当前 profile 的差距报告；**关键能力未达标前旧端保持 active，不先卸旧端**。
2. 新端在一个项目进 `shadow`，验证 Skills/MCP/项目读取/记忆只读/rollback；UI-only 能力保留 `manual_action_required`。
3. gap report 关键能力未达标，不得切默认路由。
4. 新端达标后逐项目转 `active`，再切默认 Harness 路由。
5. 旧端**指定实例**进 `retiring`：冻结新增投影，保留只读与回滚窗口。
6. 生成 retire plan：受管 Skills/MCP/配置、项目绑定、进程、自动化、凭据、远端授权、宿主独有数据逐项列明，附 `rollback_coverage`。
7. **经 Cyrus 对准确目标批准后**，执行禁用/卸载、停止进程、撤销授权；**不自动删除项目、会话或旧端数据根**；删除宿主独有数据是另一次准确目标审批。
8. `doctor --retire` 验收 + 出具 **retire receipt**（见下）；本地零项与远端 revoke 证据**分开验收**。
9. 保留回滚观察期与最终 receipt；确认无需恢复后标 `retired`，descriptor 记 `replaced_by`。

**retire receipt 最小 schema（v4 新增）**：

```jsonc
{
  "retire_operation_id": "op_...",
  "harness_id": "qclaw",
  "harness_instance_id": "hinst_...",
  "plan_hash": "sha256:...",
  "managed_objects": { "before": 0, "after": 0 },
  "active_bindings_after": 0,
  "local_credential_refs_after": 0,
  "process_and_autostart_after": { "processes": 0, "autostarts": 0 },
  "remote_authorizations": [
    { "ref": "opaque", "state": "revoked | expired | retained_approved | unverified", "evidence_ref": "..." }
  ],
  "data_disposition": "retained | exported | deleted_approved",
  "residuals": [],
  "rollback_until": "...",
  "result": "clean | exceptions_approved | incomplete"
}
```

终态纪律：**`clean` 只允许所有必需证据闭环；Cyrus 明确保留项用 `exceptions_approved`；远端状态（OAuth grant/token/Webhook/供应商侧连接）未知 = `incomplete`，不得写成五零成功**。`doctor --retire` 检查进程、service/scheduled task/startup/webhook/remote grant 的适用集合，并**标明扫描范围、时间与不可见边界**；receipt 只记处置结论与证据引用，不装密钥或会话正文。

**provenance 不可变**：历史 memory/receipt 中的 `qclaw` 永久保留；新数据标 `workbuddy-tencent`；`replaced_by` 只记关系，不改历史。

### 7.6 卸载 Harness 时的变更矩阵（Cyrus 治理问题）

**默认原则：不变更。** 工具正本在 toolbox、记忆核心库宿主无关、项目身份在 Project Control——三者都不住在 Harness 里。**卸载 Harness = 拆外壳，核心不动。** 实际发生的只有五件事（全部对准**指定实例**）：

| 层 | 卸载时的变更 | 不变的部分 |
|---|---|---|
| 工具 | 撤销该实例投影（按受管对象清单），路由摘除该实例 | toolbox 正本、其他端/其他实例投影 |
| 记忆 | 撤销该实例访问凭据/适配器；来源标记 `harness_id` + `harness_instance_id` 永久保留 | **记忆库本体零改动** |
| 项目 | binding receipt 标 retired | `project_id`、源码、docs |
| 宿主独有数据 | 会话/工作流导出归档（须单独批准） | 不归我们管的部分不动 |
| descriptor / instance | lifecycle → retiring/retired | descriptor 与 instance inventory 永久保留，永不删除 |

### 7.7 退役回归（re-onboard）路径（QClaw 未来变好又装回的场景）

descriptor、instance inventory 与历史 provenance 都在，回归不是新建：

```text
retired → re-probe（版本/能力可能已变，旧验证结论不继承）→ shadow → active
```

- `harness_id` **沿用旧 id**（历史记忆/收据自动恢复可解释性，不产生第二个身份）；
- **同一 profile 恢复安装沿用原 `harness_instance_id`；干净重装/新 profile 生成新 instance ID 并以 `reactivates_instance_id` 留关系；无证据不得猜测复用**（v4）；
- 能力结论以**新 probe** 为准——它离开期间版本在演进，不假设它还是那个它；
- `replaced_by` 关系在回归时复核：若原替代端仍在用，两端可并存（descriptor/实例各自独立），路由按项目 profile 分配。

### 7.8 快速配置管线（"一句话配置完毕"的落地形态）

一句话做不到的地方不在技术而在**决策**——接什么端、给什么权限、动哪些项目，必须你点头。所以落地形态 = **一句话发起 + 一张卡决策 + 管线自动跑完**：

```text
你说："把 Zcode 接上"（一句话发起）
  → toolbox onboard zcode（管线自动：probe 各实例 → resolve → gap report）
  → 生成一张审批卡（完整 plan：实例清单、工具投影清单、项目绑定清单、权限差距、风险分级）
  → 你一键批（或逐项裁）
  → apply → receipt → doctor → shadow pilot 报告
```

配套命令族：`onboard / retire / reactivate / doctor [--retire] / plan / rollback`。这与 B 线审批卡天然合体——管线产物就是卡，卡的批准触发管线后半段。卸载同理：`toolbox retire qclaw` 一句话发起，retire plan 进卡，批准后执行 + `doctor --retire` 验收。

**机器可判定终态（v4 新增）**：审批卡/CLI 统一输出 `planned | awaiting_approval | manual_action_required | applied_shadow | active | blocked | retiring | retired_clean | retired_exceptions_approved | retired_incomplete`。只有 **pilot 验收 + 活动 binding receipt + memory 隔离 + 宿主重启复核** 全部通过才可显示 `active/配置完成`；只生成 WorkBuddy 人工清单、只装 Zcode marketplace 或只完成 shadow 时必须显示对应未完成状态——**产出包 ≠ 配置完成，shadow ≠ active**。

### 7.9 Zcode 与腾讯 WorkBuddy 适配判断（2026-08-21）

- **Zcode**：官方插件体系可把 Skills/Commands/Subagents/Hooks/MCP 打包，支持本地目录/Git/Marketplace 安装与启停；**插件组件随当前工作台启停，本机插件不默认进入 SSH/WSL 远程工作区——远程工作区按独立实例另出 plan，不假设自动跟随**（v4）。adapter 形态建议：**toolbox 生成一个 Cyrus 私有 Zcode Marketplace/Plugin，批量承载适用 Skills 与 MCP 声明**，不逐工具手装；先本地 marketplace shadow，验收后再定是否用 Git 源。
- **WorkBuddy（腾讯）**：官方文档确认可导入本地 Skill 包、可装自定义 MCP 连接器（均有启停/卸载/解绑）。**但无 UI 批量安装/CLI/API 无官方证据 → 标 `unverified`**：若有受支持 CLI/API，adapter 自动 plan/apply；若只有 UI，adapter 只生成签名/校验后的包 + 人工操作清单，apply 属需确认的外部动作，对应步骤 `rollback_coverage = manual/none`（v4）。不得以"UI 可操作"推断"无人值守可行"。

### 7.10 两个强制反例验收（v4 新增，进 D5-1/D5-2 验收单）

1. **多实例反例**：DSH stable 与 dev 同时 active，分别绑定同一 canonical `project_id`，receipt 互不覆盖；只 retire dev 实例后，stable 实例的工具、项目、记忆访问**零变化**。Zcode 本地与 WSL 实例同按两实例验收。
2. **假退役反例**：本地密钥引用已删但远端 OAuth/Webhook 状态未知时，retire 结果必须是 `incomplete`，不得显示"五零/clean"；只有证据闭环或 Cyrus 明确批准例外（`exceptions_approved`）后才可结束。

## 8. MCP 化策略：五问过滤，直连优先（D5-6）

五问：①能否直连已有标准 MCP/HTTP 服务；②是否已有宿主原生等价能力；③是否确有跨端价值；④确需导出→抽宿主无关 core、DSH adapter 与 MCP adapter 共用；⑤是否应留 P3 不可携。

**AnySearch 试点（v3 修正口径）**：本地实测仅能证明"现有 adapter 向 endpoint 发送 `tools/call` 并带 Bearer Token"；**远端是否支持完整 MCP initialize/tools/list = 未知**，待 D5-1 handshake 实测：通过则各端直接配置（零包装），不通过才加本地薄 wrapper。不以本地调用面反推服务端能力。

**协议代际纪律（v4）**：MCP 2026-07-28 规范已区分 modern/legacy 代际与 stdio/Streamable HTTP transport，官方兼容矩阵明确不同代际组合可能失败——所以 surface 必须带 `protocol_range_or_era`（§7.1），resolver 不得把 legacy SSE 与 modern Streamable HTTP 互判 exact。

## 9. 治理分级：按副作用（D5-5）

| 副作用 | 级别 |
|---|---|
| 只读 inventory / doctor / diff / probe / resolve | Class B |
| 普通 skill/prompt 内容修改且不扩大权限 | 常规 Git diff + 测试 + 人工复核 |
| 安装/升级可执行代码、改 PATH、写宿主全局配置、开放网络服务、付费调用、读敏感数据、扩大工具审批权限、开放 memory 写入、**Harness 安装/卸载/替换/迁移项目/撤销凭据/上传数据** | Class A 或专项确认（逐项对准确目标批准） |
| 下线/回滚/撤销授权 | 影响预览 + receipt |

Harness 无权反向修改 toolbox；改进回流走 proposal/diff，不做自动同步。

## 10. 分期与验收（D5-7 + D5-8 合并路线）

| 阶段 | 内容 | 可复核出口 |
|---|---|---|
| D5-0 | 已登记端只读盘点 + descriptor/**instance inventory**/schema（含 `surfaces.v1.json`、retire-receipt schema）落位 + resolver v1（硬门顺序冻结）+ 处置 plugin-set.lock.json 漂移 + **登记既有 identity_conflict（稳定/开发库双 project_id）并交回 Project Control 治理** | 不改任何宿主配置；所有事实带核实状态与日期 |
| D5-1 | 只在 **DSH Dev + Codex** 两端闭环：投影一个完整 skill 目录包 + 只读 MCP（AnySearch handshake 实测）；**多实例反例验收（§7.10-1）** | 两端发现/调用成功；plan=diff 一致；无密钥落盘；rollback 恢复原状；双实例 receipt 不覆盖 |
| D5-2 | 记忆 MCP 只读（status+recall）；冻结 memory-host/v1（v4 provenance：harness_id + harness_instance_id + project_id） | project_id 隔离正确；双端并发；身份不明阻止（fail closed 只允许 status）；leak=0；DSH Stable 不受影响 |
| D5-3 | 受控 memory_store；**逐端 descriptor 驱动扩端**（路线图不写死产品名，按"逐个已验证 Harness"推进）；**假退役反例验收（§7.10-2）随首次 retire 执行** | 写入/崩溃/恢复/回滚有 receipt；每端单独验收；retire 终态诚实（clean/exceptions_approved/incomplete） |

B2 治理视图非前置：首期 `toolbox doctor --json`；CLI 合同稳定后再接治理 UI。

## 11. 记忆系统接口合同（memory-host/v1，不变更）

沿用 v2 §7 全七条：可验证 harness_id/session_id/project_id；身份不明 fail closed；服务端自强制 scope/分级/限长/审计；单写入者+短事务+排队幂等+崩溃恢复；首期只开 status/recall；各端召回分别评测；memory-shell 只放适配描述。

v4 补充（三次审核接缝，与 D4 口径修正②同一合同）：

1. **新 provenance 同时记录 `harness_id + harness_instance_id + project_id`**；历史只有 `harness_id` 的记录保持可读，**不回填伪造**。
2. `harness_instance_id` 映射 Project Control 既有 `harness_instance_ref` 语义，D5 不另造冲突身份。
3. **任何端（含非 DSH）调 memory-host 必须携带显式 Project Control `project_id`**；工作区路径/本地用户标识只作 locator 与发现证据，不作身份；身份不明只允许 `memory_status`，禁止 recall/store。
4. `harness_id` 遵循 §7.5 provenance 不可变规则。

### 11.1 与 Project Control 工作面的薄接缝（D5-9，v4.1 新增）

职责只在一个位置拥有：

| 事实/动作 | 唯一拥有者 | D5 / Project Control 接缝 |
|---|---|---|
| `project_id`、workspace location | Project Control | D5 只读解析，身份冲突 fail closed |
| WorkItem、依赖、Decision、Review、Run、claim | Project Control | D5 不建队列、不推进状态 |
| harness product/instance、surface/capability、工具投影状态 | D5 | Project Control 不复制 adapter/receipt 状态 |
| route policy | Project Control | 把获批约束交给 D5 resolver，不把选择权下放给 D5 |
| route resolution | D5 | 返回候选/选中实例与证据；Project Control 再原子 claim + 创建 Run |
| memory provenance/scope | memory-host + Project Control identity | WorkItem 只存 memory query/record locator，不复制记忆正文 |

最小调用是 `resolve(request) → route_resolution_receipt`。request 至少携带 `{work_item_id, project_id, route_policy_hash, required_capabilities, allowed_surfaces, max_cost_tier, forbidden_effects, quota_max_age}`；receipt 至少携带 `{resolution_id, harness_id, harness_instance_id, selected_surface, matched_capabilities, descriptor/profile/lock hashes, quota_evidence_ref, rejected_candidates+reason, resolver_version, resolved_at}`。receipt 是解析证据，不是开工授权；只有 Project Control 以 expected revision 原子 claim 并创建 Run 后才开工。

新增 Zcode 等 Harness：按 §7.4 完成 descriptor/instance/profile/shadow/active 后自动成为满足 policy 的候选，**标准工具 manifest、WorkItem 与 workflow template 修改数均为 0**。QClaw→WorkBuddy：按 §7.5 先激活新实例再移除旧候选；未认领任务重新 resolve，在途 Run 不自动夺权，必须由 Project Control 显式完成/迁移/停工；历史 receipt 与 memory provenance 保留旧 identity。

流程编排只保存 provider-neutral capability（如 `media.image.generate`、`test.run`、`deploy.preview`）；D5 resolver 在实例化/认领时绑定 Nano Banana、即梦、Vercel 等具体 provider。工具调用结束返回 tool/effect receipt 与 artifact locator 给 Run；D5 不保存任务正文、Review 结论或看板列。

## 12. 风险与否决项（v4.1）

- 否决"唯一正本/各端同上线/手工版本账/插件直移植/直指同一文件夹/端混为一谈"（前两轮）。
- **否决"宿主副本互搬"**（v3）：替换 Harness = 新端重新物化 + 旧端按合同退役（§7.5）。
- **否决"provenance 改名"**：harness_id 不可变，`replaced_by` 只记关系（§7.5）。
- **否决"路径/Git remote/文件夹名/本地用户 ID 创造项目身份"**（v4）：身份权威只有 Project Control；冲突标 `identity_conflict` 交回治理（§7.2）。
- **否决"base profile 授予项目访问"**（v4）：缺省拒绝，无 profile = unconfigured（§7.2）。
- **否决"本地凭据清零冒充远端撤销"**（v4）：retire 终态必须区分本地事实与远端证据，未知 = incomplete（§7.5）。
- **否决"同一实例并发 mutation"**（v4）：实例级互斥 + precondition_hash，drift 必须重新 plan（§5.1）。
- **否决“D5 根据额度直接认领/派发任务”**（v4.1）：D5 只返回满足获批 policy 的解析证据；原子 claim、Run 与审核隔离由 Project Control 拥有（§11.1）。
- **否决“workflow 模板写死 Harness/供应商名”**（v4.1）：模板只写 capability，provider binding 由 descriptor-driven resolver 完成；新增/替换/退役 Harness 不改模板。
- 风险：新端接入靠记忆手工搬运 → descriptor + 管线 + 卡（§7.8）。
- 风险：退役残留凭据/孤儿进程 → `doctor --retire` + retire receipt 验收（§7.5）。

## 13. 二次审核逐项复核表（K3，历史留档）

| 审核发现 | 结论 | 落点 |
|---|---|---|
| P1 manifest 枚举 Harness | 采纳 | §4.1 改 surface 声明 + target_overrides；新增端 manifest 零修改写入 §7.4 验收 |
| P1 缺项目库接入合同 | 采纳 | §7.2 项目 profile + binding receipt；Project Control 保持项目身份权威 |
| P1 rollback ≠ 退役合同 | 采纳 | §7.5 九步退役流程 + 五零验收（v4 升级为 retire receipt 三终态） |
| P2 端名单写死 | 采纳 | §3/§7.1 descriptor 驱动；§10 D5-3 改"逐个已验证 Harness" |
| P2 provenance 不可变 | 采纳 | §7.5 + harness_id 不可变规则 |
| P2 两处证据收紧 | 采纳 | D4 seam 对齐手册 v4（T0 改"memory.query + 有界 quick-pass，召回不进 System section"）；§8 AnySearch 改"未知待实测" |
| §6 交付要求 1-10 | 全部落位 | 本表 + v3 正文 + INDEX 同步 |
| Cyrus 补充：卸载变更矩阵 | 落位 | §7.6 默认不变更原则 |
| Cyrus 补充：退役回归 | 落位 | §7.7 re-onboard 路径 |
| Cyrus 补充：快速配置 | 落位 | §7.8 一句话发起 + 一张卡决策 + 管线自动跑 |
| 被否决项 | 无 | 全部采纳或按修正口径采纳，审计链保留于两份 reviews 留档 |

## 14. 第三次审核逐项复核表（K3，2026-08-21）

> 审核结论：v3 主架构**有条件通过**，不增加中央数据库或常驻服务；补四类最小合同 + 两项加固后即可进入 D5-0。K3 复核：6 项全部采纳，无一否决；两个反例验收列入 D5-1/D5-3 验收单。审核原文冻结留档：`docs/reviews/D5-统一工具层-第三次架构审核-Codex.md`。

| # | 审核发现 | 结论 | v4 落点 |
|---|---|---|---|
| P1-1 | `harness_id` 混合产品与安装实例，receipt 会碰撞 | 采纳 | §1/§7.1 双层身份：`harness_instance_id` + flavor/environment + instance inventory（机器数据根不进 Git）；binding 唯一键 `(harness_instance_id, project_id)`；apply/rollback/retire 对准实例；实例 ID 复用规则（同 profile 沿用/干净重装新建 + `reactivates_instance_id`/无证据不猜测） |
| P1-2 | surface 自由字符串 + 证据粒度过粗 → 假 exact | 采纳 | `schemas/surfaces.v1.json` 版本化注册表（§4.1/§7.1）；逐 surface `{status, probe_id, verified_at, host_version, evidence_hash}`，未知=unknown 不继承；resolver 硬门顺序冻结（§7.3）；lock 生成头含五方版本/哈希（§4.2）；MCP 代际纪律（§8） |
| P1-3 | profile 无缺省拒绝 + 既有双 project_id 冲突 | 采纳 | §7.2 六条缺省拒绝纪律（base 不授权/unconfigured/六态对账/fail closed/身份解析只走 Project Control/identity_conflict 交回治理） |
| P1-4 | retire receipt 无 schema + 远端撤销不可本地证明 | 采纳 | §7.5 retire receipt 最小 schema；`clean/exceptions_approved/incomplete` 三终态；本地零项与远端 revoke 分开验收；doctor --retire 标明扫描范围与不可见边界 |
| P2-1 | 缺幂等与并发前置、rollback 覆盖度 | 采纳 | §5.1：operation_id/plan_hash/precondition_hash/adapter_version/rollback_coverage；实例级 mutation 互斥；重试同结果或安全续跑；drift 重新 plan 不沿用旧批准卡 |
| P2-2 | 管线缺机器可判定终态 | 采纳 | §7.8 状态枚举；active 四要件（pilot/binding/隔离/重启复核）；产出包与 shadow 不显示为完成 |
| 接缝-1 | Project Control `harness_instance_ref` 映射 | 采纳 | §11-2 |
| 接缝-2 | memory provenance 双记 + 历史不回填 | 采纳 | §11-1；D4 §4 来源标记同步修正 |
| 接缝-3 | D4 §3/§5 身份降级口径冲突 | 采纳 | D4 口径修正②（§3 Zcode/Codex 行、§4 来源标记、§5 身份风险四处已改）；§11-3 |
| 接缝-4 | 六态对账 | 采纳 | §7.2-6；§7.4 验收目标 |
| 反例-1 | 多实例（DSH stable/dev、Zcode local/WSL） | 采纳 | §7.10-1；列入 D5-1 验收 |
| 反例-2 | 假退役（远端未知 ≠ clean） | 采纳 | §7.10-2；列入 D5-3 首次 retire 验收 |
