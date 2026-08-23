# A 线 · 插件独立更新通道：首批三任务简报（v2）

> 状态：草案 v2（已吸收执行层评审 12 项阻断 + 10 项强化；待 Cyrus 盖章后派发） ｜ 修订：2026-08-20 v2
> 作者：Kimi K3 ｜ 执行层评审：`reviews/A线-插件通道-首批三任务简报-执行层评审.md`（DeepSeek，评审事实已抽查复核 5/5 成立）
> **Cyrus 已拍板两项**：① V1 白名单 16→14（排除 update-center / plugin-organizer，依据 D2 §5.1）；② minClient 两条取值规则（测试 fixture=0.3.0，正式首发索引=0.4.0）。
> 架构依据：`docs/architecture/D1-插件独立更新通道-架构设计.md`（已定稿）
> 执行配置：实现 = DeepSeek v4 Flash；审查 = Codex（额度恢复前由 v4 Pro 代审）；Class A 闸门 = Cyrus

---

## 修订记录（v1 → v2）

| 评审项 | 落点 |
|---|---|
| P0-1 SMOKE_EXIT | A1 前置小项：给 `scripts/smoke.js` 增加一行显式 `SMOKE_EXIT=0/1` 输出（兼容全部历史文档口径）+ 测试 |
| P0-2 路径 | 共同上下文 D1 路径已修正为 `docs/architecture/...` |
| P0-3 跑道命令 | A2 交付物新增 `release:plugins` npm script + 完整命令链 + staging 目录约定 |
| P0-4 测试源 seam | A3 新增「下载源注入 seam」；A2 新增 `--local-fixture` 输出模式 |
| P0-5 minClient | 已拍板：入参化 + 两条取值规则；commit 用 40 位全 hex，从 `scripts/build-kit.mjs` 常量同源生成 |
| P0-6 白名单 14 | 已拍板：A1/A2 同步修订；本简报对 D1-09「16」数字的修正依据 D2 §5.1 登记 |
| P0-7 校验落点 | A1 重写：运行时校验模块随包（`src/personal-plugin-validation.js`），verify-launch 仅复用；helper env seam |
| P0-8 状态机 | A1 新增「外部目录与批次状态机契约」（A3 引用） |
| P0-9 内容级完整性 | `.install.json` 含解压期文件清单（逐文件 SHA-256），启动校验比对清单，不重打包 |
| P0-10 索引 schema | A2 交付 `protocol/plugin-index/v1/` schema + fixtures + 解析测试 |
| P0-11 preflight | A2 交付 preflight 规则模块化 + tgz 安全解包扫描 + 「改动未 bump」检测算法 |
| P0-12 packed smoke / doctor | A1 门禁加 packed smoke；doctor 定义为机器判读断言；A3 文件面显式含 plugin-organizer 改造 |
| 强化 1–10 | 分别并入 A1/A2/A3 要点（tag 解析器、URL 拼接、.sha256 格式、14 个 tgz 资产、白名单随包常量、回滚防更新循环、兼容 fail-closed、首真实 release 复核、离线可跑、降级可见性） |

## 切分逻辑（不变）

A1 装配运行时 → A2 发布管线 → A3 更新中心插件区，串行；A3 依赖 A1 的目录契约与 A2 的索引格式，最后做并跑端到端。

**三任务共同交接上下文（每次派发必带）**：

- 必读：`docs/architecture/D1-插件独立更新通道-架构设计.md` 全文、`docs/PUBLISHING_RULES.md`、`docs/NEXT.md`「关键坑」#3/#4/#7 与「开发隔离约定」「稳定版路径红线」、本简报 v2
- 红线：不改只读上游 `D:\Deepseek Harness`；自动化流程不写稳定版受保护路径（`scripts/protected-paths.js`：D 盘安装目录、F 盘稳定版数据、两个 %APPDATA% 遗留目录、`~/.dsh`）；dev 打包产物永不当发布资产；smoke 只用 `-Smoke.exe` 改名副本、按 PID 清理
- 门禁（输出必须重定向到日志文件再读，PowerShell 管道会吞退出码）：`node --test "test/*.test.js" "plugins/*/test/*.test.js"`、`node scripts/check-plugins.js`、`node scripts/verify-launch.js`、`node scripts/smoke.js`（退出码 0 + `SMOKE_EXIT=0` + 日志尾部探针全过）
- 诊断环境纪律：起开发版诊断前移除/显式设置 `PROJECT_CONTROL_HOME`（关键坑 #4）
- 一切管线/测试路径过 `assertAutomationSafe`

---

## 任务 A1：外部插件目录与装配运行时（V1 核心）

- **执行者**：v4 Flash ｜ **审查**：v4 Pro（代 Codex） ｜ **自报级别**：Class B
- **目标**：稳定版支持外部目录加载插件，优先级高于内置；安装 = 重启边界；任何失败显式回退内置基线且**用户可见**。对应 D1-04 / 05 / 09(V1 边界) / 10。

### 前置小项（先行落地）

给 `scripts/smoke.js` 成功/失败路径增加显式 `SMOKE_EXIT=0/1` 输出一行 + 对应断言测试（兼容既有文档口径，不改任何探针逻辑）。

### 架构要点

1. **白名单 14（已拍板）**：V1 可外部更新集合 = 18 − memory − project-control − **update-center − plugin-organizer**（后两者依据 D2 §5.1 插件中心自我更新从紧）。白名单做成**随包代码常量**（扩展 `PERSONAL_PLUGINS` 字段），不读用户可改文件；目标插件有 `dependencies` 硬拒。
2. **目录契约与批次状态机**（A3 引用此节）：
   - 布局：`plugins-external\<pkg-dir>\<version>\`；`<pkg-dir>` 名**只能**来自 `PERSONAL_PLUGINS.directoryName` 映射，永不从网络索引字段拼路径。
   - 唯一事实指针：`<pkg-dir>\active.json`（指向 active version）；`.install.json` 位于 `<pkg-dir>` 层。
   - **两段式更新**：在线段只做 全部下载 → 全部校验 → staging 全就绪 → 写**批次 pending 记录**，不动 junction；启动段解析批次记录，整批校验通过才整批重指 junction，**任一失败整批落回内置** + 失败项 quarantine（D1-09 all-or-none，杜绝半集合）。
   - `_backup`（上一外部版一档）/`_quarantine`（留证不删除）轮转规则；临时目录同盘原子 rename；崩溃恢复 = pending 存在但版本目录不完整 → 回内置；**回滚也走启动段，运行中永不动 junction**。
3. **内容级完整性**：装配时生成解压文件清单写进 `.install.json`（逐文件 路径+SHA-256，至少覆盖 `package.json / lib/index.js / lib/client.js / dsh.bundle.patch` 等关键文件）；启动校验 = manifest 名/版本一致 + 白名单 + 文件清单逐项存在且 hash 一致。**不在启动期重打包算 tgz hash。**
4. **运行时校验是权威**：校验逻辑放随包模块 `src/personal-plugin-validation.js`（`build.files` 不含 `scripts/`，verify-launch 不随包）；`src/personal-plugins.js` 启动解析时调用；`scripts/verify-launch.js` 只复用同一模块做开发树门禁，不新增第二套标准。
5. **helper 进程 seam**：helper 拿不到 `app.getPath('userData')`，由 main 注入 `DSH_PERSONAL_PLUGINS_EXTERNAL` env（稳定版 = userData/plugins-external；冒烟/测试必须 temp 值）。
6. **开发版豁免**：开发树/开发版 flavor junction 永指开发 checkout（复用 `src/app-flavor.js`），回归测试钉死。
7. **降级可见性**：落回内置不只写日志——per-plugin `source` + `degradedReason` 进状态，更新中心/插件整理页可见「外部插件校验失败，已回退内置」。

### 验收标准（可实测）

- [ ] 稳定 flavor 打包体 + 临时 `DSH_DESKTOP_USER_DATA`（**禁止碰 F 盘真实数据**）：手工放置合规外部插件 + 完整 `.install.json`（含文件清单）→ 重启 → junction 指外部、fiber ACTIVE、功能探针通过
- [ ] 删 bundle 中任一文件 → 重启 → 文件清单校验失败 → 落回内置 + `degradedReason` 可见
- [ ] 批次两件其一损坏 → 整批落回内置，无半集合
- [ ] 外部目录放 memory / update-center → 拒绝并说明原因
- [ ] 开发版启动 junction 仍指开发树（回归断言）
- [ ] 门禁：四项开发树门禁 + `pnpm run pack:dev:dir` + `pnpm run smoke:packed:dir:dev`（或等价命令）全绿

### 证据要求

门禁输出日志；新增测试与用例数；junction 指向断言；doctor 探针输出；NEXT.md 进展更新。

---

## 任务 A2：插件发布管线（`release:plugins` 跑道）

- **执行者**：v4 Flash ｜ **审查**：v4 Pro（代 Codex） ｜ **自报级别**：Class B
- **目标**：一条命令离线产出可发布 staging；Cyrus 手动建 `plugins-v*` release。对应 D1-01 / 02 / 03 / 07 / 08。

### 架构要点

1. **交付命令**：新增 npm script `"release:plugins": "node scripts/release-plugins.mjs"`；命令链 = `node scripts/generate-plugin-set.mjs --check` → 改动未 bump 检测 → npm pack → 索引生成 → preflight 扩展 → staging 输出。**离线可跑**：不得要求 push/tag（git 无 remote），tag 名只生成建议值写进发布清单。
2. **staging 约定**：`release-staging/plugins-vYYYY.MM.DD.N/`（仓库内，过 `assertAutomationSafe`）；含 14 个 tgz（externalEligible:false 的 4 包**不打包不上传**，避免 404）+ plugin-index.json + 逐资产 `.sha256`（格式 `<hash>  <name>`，对齐 `update-service.expectedSha256` 解析器）+ 发布清单（tag 建议值、资产清单、sha256、minClient、兼容基线）+ release notes 脱敏草稿。
3. **索引 schema v1**：交付 `protocol/plugin-index/v1/schemas/plugin-index.schema.json` + 合法/非法 fixtures + 解析测试。规则：`schemaVersion` 不可识别 → 「检查失败但可显示」绝不部分信任；包名必须命中 `PERSONAL_PLUGIN_PACKAGES`；`assetName` 文件名白名单正则；索引大小上限；`integrity` 必须 64 位 hex；`externalEligible:false` 条目**不携带** assetName/integrity（只展示）。资产 URL = 相对文件名 + 运行时按 release tag 拼 GitHub URL（host 白名单校验）。
4. **兼容基线**：`compatibleHarness = {version:"0.1.0-rc.7", commit:"99f6f02fecdb7dff40c3fbc9470f5907c29f74ca"}`，从 `scripts/build-kit.mjs` 常量同源生成；commit 必须 40 位全 hex。
5. **minClient 入参化（已拍板）**：管线入参/配置项，不写死；`--local-fixture` 模式 = 0.3.0；正式首发索引 = 0.4.0（仅随 v0.4.0 那次生产 release 写入）。
6. **「改动未 bump」检测**：基线 = 最近 `plugins-v*` tag（或首版基线 manifest 快照），`git diff --name-only` 命中 `plugins/<name>/` 且版本未升 → 拒绝；**首次发布无基线** → 显式 `--bootstrap` + Cyrus 批准，不静默放行。
7. **preflight 模块化**：导出 BLOCKING/REPORT 规则集；新增 tar 安全解包扫描（路径穿越防护、条目数/体积上限）；插件 tgz 内个人路径/密钥命中 = **BLOCKING**（区别于 docs 的报告级）；逐 tgz 与 `npm pack` files 白名单核对。
8. **`--local-fixture` 模式**：输出本地索引 + tgz 目录 + 最小静态服务/文件副本，供 A3 测试 seam 使用。

### 验收标准

- [ ] 任一叶子插件 bump → 管线跑通 → staging 产物齐全，索引逐字段过 schema 校验
- [ ] 索引 4 包 `externalEligible:false` 且无 assetName/integrity
- [ ] tgz 内植入个人路径 → preflight BLOCKING；植入超过体积上限 → 拒绝
- [ ] 改动未 bump → 拒绝；无基线时无 `--bootstrap` → 拒绝
- [ ] `.sha256` 格式被现有解析器正确读取（单测）
- [ ] 全程离线（无网络调用）；四项门禁全绿

### 证据要求

门禁输出；一次完整试跑的 staging 目录清单 + 索引全文 + schema/fixtures 测试输出；NEXT.md 更新。

---

## 任务 A3：更新中心插件区（消费侧闭环 + V1 出口验收）

- **执行者**：v4 Flash ｜ **审查**：v4 Pro（代 Codex） ｜ **自报级别**：Class B
- **前置**：A1（目录契约/状态机）、A2（索引 schema/fixture 模式）已交付
- **目标**：更新中心三通道并列卡，插件卡完成 检查 → 三态比对 → 下载 → 校验 → 装配 → 提示重启 → 回滚 全闭环。对应 D1-06 + §5.4/5.5/5.6 + §6。

### 架构要点

1. **下载源注入 seam**：生产钉死 GitHub（沿用现有 host 白名单）；**仅** dev flavor / smoke 模式允许 `DSH_PERSONAL_PLUGIN_UPDATE_BASE_URL` 指向本地 fixture；生产构建拒绝非 GitHub host。`checkPlugins`/下载函数给 fetcher 抽象（可 mock 200/404/篡改响应）。
2. **独立 tag 解析器**：`plugins-vYYYY.MM.DD.N` 四段日期格式的解析/排序/过滤（忽略 draft；V1 只认非 prerelease；分页上限写明）；现有 `selectRelease`/`parseVersion` 只认 `vX.Y.Z` 不得复用；客户端检查器不识别 `plugins-v*` 的回归测试钉死（两通道互不误触发）。
3. **三态比对状态字段**：内置版本 / 外部版本 / 可更新版本 + per-plugin `source` / `installedAt` / `degradedReason`；**plugin-organizer 改造列入文件面**（清单接口加 version/source/installedAt + 来源徽标 + 跳转更新中心）。
4. **批次装配**：下载 → SHA-256 逐字比对（不符拒装）→ staging → 写批次 pending → 提示重启；整批切换走 A1 状态机启动段（all-or-none）。
5. **回滚 UI + 防更新循环**：一键回内置 / 回上一外部版（`_backup` 档）；记录 `rolledBackFrom`/skip 标记，UI 显示「你已回滚过该版本」，不再自动弹可更新。
6. **兼容 fail-closed**：compatibleHarness / minClient 高于当前 → 不显示更新按钮，指向对应通道；**Harness commit 读取失败/未知时同样不显示更新按钮并给原因**（不得当成满足）。
7. **doctor 机器判读**：扩展后清单接口 + smoke 探针断言 目标插件 `fiberPhase=ACTIVE` + junction 目标 = 预期外部目录 + 版本 = 预期 bump 版本。
8. **入口纪律**：复用 rc.7 插件设置卡片官方 seam；期间**不发布 v0.4.0**；**首个真实 `plugins-v*` release 的实链路复核**（GitHub API/immutable/公开仓库）列为 Cyrus 手动建首版后的必做步骤——本地 fixture 通过 ≠ 全链路通过。

### 验收标准（= D1 §10 出口清单端到端，经本地 fixture）

- [ ] 叶子插件 bump → A2 `--local-fixture` 造本地索引 → 测试版检查到可更新（三态正确）
- [ ] 篡改 tgz 一字节 → 拒装；mock 404/篡改响应 → 显式失败
- [ ] 装配重启后 fiber ACTIVE + junction + 版本断言全过；回滚到内置版本回落、quarantine 留证
- [ ] 回滚后同版本不再弹可更新；开发版不受外部目录影响
- [ ] 兼容基线不满足 / commit 未知 → 拒装并提示
- [ ] plugin-organizer 显示 version/source/installedAt 且可跳转
- [ ] 四项门禁 + packed smoke（dev）全绿

### 证据要求

门禁输出；端到端逐步截图或录屏；D1 §10 清单逐项打勾；NEXT.md 勾销执行顺序第 3 项。

---

## 串行节奏

A1（含前置小项，约 1.5–2h）→ A2（约 1.5h）→ A3（约 2.5–3h）；每任务交付后 Pro 代审，审过再派下一个。首个真实 `plugins-v*` release 由 Cyrus 手动创建，随后执行一次 D1 §10 实链路复核。
