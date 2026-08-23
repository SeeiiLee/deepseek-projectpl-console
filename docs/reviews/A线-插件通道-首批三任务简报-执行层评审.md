# A 线 · 首批三任务简报 · 执行层评审建议

> 评审对象：`docs/design/A线-插件通道-首批三任务简报.md`（Kimi K3，2026-08-20 草案）
> 评审范围：**只审执行层**——按简报原文逐字执行会卡在哪里、证据要求是否可产出、与仓库现状是否一致。不重新论证 D1 架构。
> 核对方式：逐条对照仓库现有文件（`docs/architecture/D1-*.md`、`package.json`、`scripts/*`、`src/*`、`plugins/*`）。
> 结论：任务切分（A1 装配 / A2 管线 / A3 消费闭环）与 D1 对应关系正确，总思路可用；但存在 **14 项执行阻断级问题**，其中 6 项会让执行端“照做后验收不通过或验收项根本无法产出”。建议 K3 按本文修订后再派发。

---

## 一、执行阻断级问题（K3 修订时必须解决）

### P0-1 门禁证据“看 `SMOKE_EXIT=0`”与现状不符

- **简报位置**：共同交接上下文·门禁、各任务证据要求。
- **核实事实**：`scripts/smoke.js` 全文**没有** `SMOKE_EXIT` 字样；成功路径是 `assert.equal(outcome.code, 0, …)`（smoke.js:130），通过 = 进程 exit 0。`SMOKE_EXIT=0` 只存在于历史文档（NEXT.md/DEVLOG）。
- **问题**：执行端按“看 `SMOKE_EXIT=0`”去找证据会找不到，审查方也会因证据名不存在而无法验收。
- **改法（二选一）**：
  1. 给 `scripts/smoke.js` 增加一行显式输出 `SMOKE_EXIT=0/1`（推荐，兼容既有文档口径），并把这个小改动列进 A1 或作为派发前置；
  2. 或把简报措辞改为“`node scripts/smoke.js` 退出码 0 + 日志尾部探针全过”。
- 同时保留 NEXT.md 关键坑 #7 的纪律：PowerShell 管道吞 `$LASTEXITCODE`，门禁输出必须重定向到日志文件再读。

### P0-2 必读文档路径写错

- **简报位置**：第 4 行“架构依据”、第 16 行“必读：architecture/D1 全文”。
- **核实事实**：D1 实际路径是 `docs/architecture/D1-插件独立更新通道-架构设计.md`；仓库根目录**不存在** `architecture/` 目录。
- **改法**：两处路径改为 `docs/architecture/D1-插件独立更新通道-架构设计.md`（`docs/PUBLISHING_RULES.md`、`docs/NEXT.md` 无误）。

### P0-3 A2 的跑道命令不存在，任务无法一键执行

- **简报位置**：A2 架构要点 4 “`generate-plugin-set --check`”。
- **核实事实**：实际脚本是 `scripts/generate-plugin-set.mjs`，必须 `node scripts/generate-plugin-set.mjs --check`；`package.json` 里**没有** `release:plugins` 脚本，也没有任何 `generate-plugin-set` npm script。
- **改法**：A2 交付物明确为：
  1. 新增 npm script（建议 `"release:plugins": "node scripts/release-plugins.mjs"`）；
  2. 简报写明完整命令链（generate-plugin-set --check → 改动未 bump 检测 → npm pack → 索引生成 → preflight 扩展 → 输出 staging）；
  3. 写明 staging 输出目录的绝对约定（如 `release-staging/plugins-vYYYY.MM.DD.N/`，必须在仓库内，受 `protected-paths` 守护）。

### P0-4 A3 “指向本地/测试 release 的索引”没有任何承载机制

- **简报位置**：A3 验收标准第 1 条。
- **核实事实**：`src/update-service.js` 的下载函数 `fetchBuffer` 硬性白名单 `api.github.com / github.com / objects.githubusercontent.com / release-assets.githubusercontent.com`，且 release 仓库来自 `update-center.json` 设置；**没有**本地 fixture、file:// 或测试索引 URL 的任何 seam。
- **问题**：A3 的端到端验收“用 A2 管线造一个指向本地/测试 release 的索引 → 测试版检查到可更新”按现状**无法执行**——执行端要么硬造 GitHub release（污染公开仓库、且与 A2“发布动作保持手动”矛盾），要么卡住。
- **改法**：在 A3 架构要点中新增“检查/下载源注入 seam”：
  - 生产路径钉死 GitHub `plugins-v*` release；测试/开发 flavor 下允许 `DSH_PERSONAL_PLUGIN_UPDATE_BASE_URL`（或等效 env）指向本地 fixture HTTP 服务；
  - 单测另给 `checkPlugins`/下载函数注入 fetcher 的抽象（可 mock 200/404/篡改响应）；
  - 明确 env seam **只**在 dev flavor / smoke 模式生效，生产构建拒绝非 GitHub host（沿用现有 host 白名单口径）。
  - 同时写明本地 fixture 的构造步骤：A2 管线加 `--local-fixture` 输出本地索引 + tgz 目录 + 一个最小静态服务/直接文件副本。

### P0-5 minClient 与“v0.4.0 bootstrap”自相矛盾，A3 happy path 会先被兼容门挡死

- **核实事实**：当前客户端版本 `0.3.0`（package.json）；简报 A3 要点 7 说本能力随 `v0.4.0` 落地、执行期间不发布 v0.4.0。
- **问题**：如果 A2 生成的首份索引把 `minClient` 写成 `0.4.0`（能力本身的最低客户端），A3 用当前 0.3.0 测试版做“bump → 检查到可更新 → 下载装配”时，兼容执行会判定“需先升级客户端”而拒装——happy path 验收直接失败，而 A3 又要测“兼容基线不满足时拒装”这一条，两者互相打架。
- **改法**：K3 明确两条规则：
  1. `minClient` 是 A2 管线的**入参/配置项**，不写死；
  2. A3 本地测试 fixture 的 `minClient=0.3.0`；正式首发索引的 `minClient=0.4.0` 只在“随 v0.4.0 一起发布”那一次生产 release 时写入。
- 附带要求：`compatibleHarness.commit` 必须存**完整 40 位 hex**（`99f6f02fecdb7dff40c3fbc9470f5907c29f74ca`），从 `scripts/build-kit.mjs` 常量同源生成；简报里的 `99f6f02` 只是缩写，不能作为实现依据（update-service 的 `validateCommit` 要求 40 位）。

### P0-6 “16 个零依赖插件全放行”与 D2 插件中心护栏冲突

- **核实事实**：18 包中仅 `memory`、`project-control` 有 `dependencies`（已复核）；但零依赖清单**包含 `update-center` 与 `plugin-organizer`**。D2 §5.1 已定：插件中心是内置基线插件，**自身更新策略从紧**（不自动更新，跟随客户端版本或经 Cyrus 手动确认）。
- **问题**：A1 按“16 个零依赖全放行”执行，会把更新中心自己纳入外部更新通道——管理界面自我换血，且与 D2 拍板冲突。
- **改法**：A1 白名单在 V1 明确排除 `update-center`、`plugin-organizer`（V1 可外部更新集合 = 14 个），A2 索引同样把这 4 个（memory / project-control / update-center / plugin-organizer）标 `externalEligible:false`。这是对 D1-09“16 个”数字的修正，请在简报里注明依据 D2 并经 Cyrus 点头。

### P0-7 启动门的落点写错了：`verify-launch.js` 不会随稳定版包体走

- **核实事实**：`package.json` `build.files` 只打包 `package.json / src/** / assets / plugins/** / protocol/**`，**不含 `scripts/`**；打包后的稳定版运行时不会执行 `scripts/verify-launch.js`。真正随包执行、决定 junction 目标的是 `src/personal-plugins.js`（由 `src/harness-helper.js:62` 调用）。
- **问题**：A1 要点 5 把“外部插件校验”挂在 `verify-launch.js` 上，照做会让稳定版**没有任何外部插件运行时校验**，只在开发树门禁里校验一次。
- **改法**：
  1. 校验逻辑放进一个随包模块（如 `src/personal-plugin-validation.js`），`personal-plugins.js` 启动解析时调用——**运行时校验才是权威**；
  2. `scripts/verify-launch.js` 只复用同一模块做开发树门禁，不新增第二套标准；
  3. 明确 main → helper 进程的外部目录注入 seam：helper 只能看到 env，拿不到 `app.getPath('userData')`，需要由 main 注入类似 `DSH_PERSONAL_PLUGINS_EXTERNAL` 的环境变量（或等价参数），冒烟/测试必须用 temp 值，稳定版用 userData/plugins-external。

### P0-8 外部目录状态机完全未定义：active 指针、多版本选择、批量全回滚都悬空

- **简报位置**：A1 要点 1/2、A3 要点 4/5。
- **问题（三个具体悬空点）**：
  1. 布局是 `plugins-external\<pkg-dir>\<version>\`，但**启动时怎么从多个 `<version>` 里选“当前”**？简报没写。`.install.json` 是写在 version 目录里还是 `<pkg-dir>` 层？没有定义。
  2. “junction 重指 + 重启生效”：更新时若在运行中重指 junction，正在运行的进程对新文件的**惰性加载会混版本**；若全部推迟到下次启动，那么“一次 release 多插件任一失败全部回滚”在启动阶段就需要**批次级 all-or-none**，而现在每个插件是各自独立解析的——照字面实现会得到“部分新、部分内置”的半集合状态，正好违反 D1-09。
  3. `_backup` 一档的轮转规则、quarantine 的落点与清理、`.install.json` 写入与 junction 切换之间崩溃后的恢复路径，都没有定义。
- **改法**：K3 必须在简报里补一张状态机/目录契约（可放在 A1，A3 引用）：
  - 定义唯一事实指针（建议 `<pkg-dir>\active.json`，或明确 `.install.json` 位于 `<pkg-dir>` 层并指向 active version）；
  - 更新流程拆两段：**在线段**只做“全部下载 → 全部校验 → staging 全就绪 → 写批次 pending 记录”，不改 junction；**启动段**解析批次记录，全部插件校验通过才整批重指 junction，任一失败则整批落回内置 + 失败项 quarantine；
  - 定义 `<pkg-dir>` 名只能来自 `PERSONAL_PLUGINS.directoryName` 映射，**永不**从网络索引字段拼路径；
  - 定义 `_backup`/`_quarantine` 轮转、临时目录同盘原子 rename、崩溃后“pending 记录存在但版本目录不完整 → 回内置”的恢复语义；
  - 明确回滚也走启动段，不在运行中动 junction。

### P0-9 内容级完整性算法未定义——tgz 的 SHA-256 只能证明下载没篡改，不能证明解压后目录没篡改

- **问题**：A1 要点 2 说校验“`.install.json` 与目录内容一致”，A3 说“SHA-256 与索引逐字比对”。但 tgz 的 SHA-256 校验的是**下载缓冲**；解压落地后的文件可以事后被改（A1 验收第 2 条正是“删掉 bundle 中任一文件”）。照字面实现，验收第 2 条过不了：删一个文件后，重新 npm pack 得到的 tgz hash 未必等于原 hash，而且实现里没人要求重打包比对。
- **改法**：`.install.json` 增加**解压期生成的文件清单**（每文件路径 + SHA-256，或至少覆盖 `package.json / lib/index.js / lib/client.js / dsh.bundle.patch` 等关键文件）；启动校验 = manifest 名/版本一致 + 白名单通过 + 文件清单逐项存在且 hash 一致。不要在启动期重打包算 tgz hash（慢且不可靠）。

### P0-10 `plugin-index.json` 没有 schema、版本、安全边界——而它是“唯一信任事实源”

- **问题**：索引来自 GitHub Release（网络输入，不可信），但简报只列了字段名，没有：
  - `schemaVersion` 与不可识别版本的拒收策略；
  - JSON Schema（D0 已有先例：`protocol/personal-plugin-contract/v1/`）与 fixtures；
  - 未知包名拒绝、`assetName` 文件名白名单正则、索引大小上限、`integrity` 必须 64 位 hex 等硬校验；
  - `externalEligible:false` 的条目是否还携带 tgz 资产名——如果带但不上传，点击/下载会 404；如果不带，更新中心必须按此渲染。
- **改法**：A2 增加交付物“`protocol/plugin-index/v1/schemas/plugin-index.schema.json` + 合法/非法 fixtures + 解析测试”；规则建议：`externalEligible:false` 的条目**不携带** assetName/integrity，只做展示；索引包名必须命中 `PERSONAL_PLUGIN_PACKAGES` 才进入候选；未知 schemaVersion 一律“检查失败但可显示”，绝不部分信任。

### P0-11 “复用现有 preflight 规则集”不成立；且“改动未 bump”检测算法目前不存在

- **核实事实**：
  - `scripts/preflight-publish.js` 只扫描仓库 `src/assets/plugins/protocol` 明文文件，**不解包 tgz**；个人路径模式（`F:\QClawData` 等）当前只对 `docs/` 报告、对发布物不阻断。
  - `scripts/generate-plugin-set.mjs --check` 在 checkOnly 分支**直接采用锁里已有 integrity，不重新 npm pack**（generate-plugin-set.mjs:135-142），所以“代码改了但版本没 bump”时它依然会通过。
- **改法**：
  1. A2 明确交付“preflight 规则模块化重构”：导出 BLOCKING/REPORT 规则集 → 新增 tar 安全解包扫描（路径穿越防护、条目数/体积上限）→ 对插件 tgz 的**个人路径/密钥命中一律 BLOCKING**（不同于 docs 的报告级）→ 逐 tgz 与 `npm pack` files 白名单核对；
  2. “有改动未 bump”必须有明确算法：以最近一个 `plugins-v*` tag（或首版基线 manifest 快照）为基线，`git diff --name-only` 命中 `plugins/<name>/` 且该插件版本未升 → 拒绝；**首次发布没有基线时**规定走显式 `--bootstrap` + Cyrus 批准，不静默放行；
  3. staging 目录与临时目录全部走 `assertAutomationSafe`，任何管线脚本不得写出仓库/temp 之外。

### P0-12 A1 验收缺 packed smoke，且“功能探针 / doctor 复核”没有定义

- **核实事实**：A1 改变的是启动链路，但 A1 验收只有四项开发树门禁；打包态差异（资源根、`app.isPackaged`、flavor 注入）不经过 `pack:dev:dir + smoke:packed:dir:dev` 是验不到的。另外“doctor 复核 fiber ACTIVE”没有对应命令：现有 `scripts/plugin-installer.mjs` 的 doctor 是安装期图校验，不是运行时 fiber 检查；`PluginOrganizer` 的清单接口目前**不含 version/来源/安装时间**（`pluginApi.ts` 的 `PluginItem` 只有 category/description/enabled/fiberPhase）。
- **改法**：
  1. A1 门禁加入 `pnpm run pack:dev:dir` + `pnpm run smoke:packed:dir:dev`（或等价 explicit 命令），并规定外部插件验收在**稳定 flavor 打包体 + `DSH_DESKTOP_USER_DATA` 临时目录**下进行，禁止碰 F 盘真实数据；
  2. 定义“doctor 复核”= 可机器判读的断言：扩展 plugin-organizer 清单接口返回 version/source/installedAt（这正是 D1 §6 要求但简报没列进 A3 交付），并新增 smoke 探针断言目标插件 `fiberPhase=ACTIVE` + junction 目标 = 预期外部目录 + 版本 = 预期 bump 版本；
  3. A3 范围显式加入 `plugins/plugin-organizer`（来源徽标/安装时间/跳转更新中心），并加对应验收项；不要用“联动跳转”四个字把文件面藏起来。

---

## 二、高优先级强化（不修会返工或留下隐患）

1. **插件 tag 解析不能用现有 `selectRelease`**：`plugins-v2026.08.20.1` 是 4 段日期格式，现有 `parseVersion` 只认 `vX.Y.Z`。A3 要写独立 tag 解析/排序/过滤（忽略 draft；V1 只认非 prerelease 或明确策略；per_page/分页上限说明）。同时确认客户端检查器对 `plugins-v*` 的过滤已有测试覆盖（现状 `selectRelease` 天然丢弃，但要加回归测试钉死）。
2. **索引资产 URL 采用“相对资产文件名 + 运行时按 release tag 拼 GitHub URL”**：索引在 release 创建前生成，不可能含 `browser_download_url`；明确拼接规则与 host 白名单校验。
3. **`.sha256` 文件格式对齐现有解析器**：`update-service.expectedSha256` 认 `<hash> *<name>` / `<hash>  <name>`；A2 产物命名建议 `<tgz名>.sha256`，内容格式写进简报。
4. **`externalEligible:false` 但索引要覆盖全部 18 包时，明确“不打包/不上传其 tgz”**；V1 release 资产 = 14 个 tgz（随 P0-6 修订）或写明“全量 18 也打包但 UI 禁装”二选一，不要留下 404。
5. **白名单配置的落点**：V1 建议做成随包代码常量（`PERSONAL_PLUGIN` 扩展字段），不读用户可改文件；V2 再加配置化与客户端升级路径，避免“改配置就等于扩攻击面”。
6. **回滚后防“更新循环”**：回滚到内置后，检查器会再次发现同一版本。需要在状态里记录 `rolledBackFrom`/skip 标记，UI 显示“你已回滚过该版本”，不自动弹“可更新”。
7. **兼容矩阵 fail-closed**：当前 Harness commit 未知（非 git 目录/读取失败）时，插件更新检查必须 fail closed（不显示更新按钮并给原因），不能当“满足”。
8. **首次真实 `plugins-v*` release 的实链路验证要单独列步骤**：A3 的本地 fixture 只能验证代码路径，GitHub API/immutable release/公开仓库实链路只能在 Cyrus 手动建首个 release 时验证。简报要写明“首个真实 release 后执行一次 D1 §10 出口清单复核”，避免把本地通过误当全链路通过。
9. **A2 的“一条命令”要离线可跑**：当前 git 无 remote，管线不得要求 push/tag；tag 名只生成建议值写进发布清单，由 Cyrus 手建。
10. **外部落回内置的警告不能只进日志**：helper stderr 会被用户忽略。A1/A3 状态里加 per-plugin `source` + `degradedReason`，更新中心/插件整理页可见“外部插件校验失败，已回退内置”。

---

## 三、按任务的最小修订清单（供 K3 直接勾对）

### A1 需补
- [ ] 白名单 14 个（排除 memory/project-control/update-center/plugin-organizer），来源与默认值写明。
- [ ] `plugins-external` 目录契约 + active 指针 + `.install.json` schema（含文件清单 hash）+ `_backup`/quarantine 轮转 + 崩溃恢复。
- [ ] 共享校验模块 + 运行时权威校验 + verify-launch 复用；helper 进程外部目录 env seam。
- [ ] 手动验收 fixture 的完整构成（**必须含 .install.json**，写明如何生成其 sha/清单）。
- [ ] “删 bundle 文件 → 重启落回内置”的警告可见性。
- [ ] A1 门禁加 packed smoke（稳定 flavor + temp userData）；“开发版豁免”回归断言保留。

### A2 需补
- [ ] `release:plugins` npm script 与完整命令链；staging 输出路径约定。
- [ ] `plugin-index.json` schema v1 + fixtures + 解析测试；完整 40 位 commit；`externalEligible` 4 包。
- [ ] minClient 入参化 + 测试/生产两条取值规则（P0-5）。
- [ ] “改动未 bump”检测算法 + 首版 bootstrap 规则。
- [ ] preflight 规则模块化 + tgz 安全解包扫描 + 个人路径 BLOCKING + files 白名单核对。
- [ ] `.sha256` 命名/格式、release notes 脱敏扫描、发布清单字段（tag 建议值、资产清单、sha256、minClient、兼容基线）。

### A3 需补
- [ ] 插件检查/下载源注入 seam + 本地 fixture 构造步骤（生产仍钉 GitHub）。
- [ ] 独立 tag 解析器；三态比对状态字段（内置/外部/可更新 + source + installedAt + degradedReason）。
- [ ] 下载→校验→staging→批次 pending→重启整批切换 的状态机（对应 P0-8）。
- [ ] 回滚 UI 的 skip/pin 语义；quarantine 留证路径。
- [ ] plugin-organizer 改造（version/source/installedAt/跳转）列进文件面与验收。
- [ ] doctor/探针的机器判读定义（fiber ACTIVE + junction 目标 + 版本断言）。
- [ ] 明确 A3 期间不发布 v0.4.0，但首个真实 `plugins-v*` release 的实链路复核列为后续必做步骤。

---

## 四、给 K3 的事实速查（评审时已逐项核对）

| 项 | 现状 |
|---|---|
| D1 实际路径 | `docs/architecture/D1-插件独立更新通道-架构设计.md` |
| 客户端版本 | `0.3.0`（package.json） |
| Harness 基线 | `0.1.0-rc.7` / commit `99f6f02fecdb7dff40c3fbc9470f5907c29f74ca`（build-kit.mjs:15-16） |
| 插件总数 / 依赖插件 | 18 个；仅 memory、project-control 有 `dependencies` |
| 插件中心两包 | update-center、plugin-organizer 均零依赖，D2 要求其更新策略从紧 |
| 插件锁 | 根目录 `plugin-set.lock.json`，`generate-plugin-set.mjs --check` 不重打包 |
| 现有门禁脚本 | `check-plugins.js` / `verify-launch.js` / `smoke.js` 均存在；smoke 无 `SMOKE_EXIT` 输出 |
| 打包内容 | `build.files` 不含 `scripts/`，verify-launch 不随稳定版包体 |
| 更新下载白名单 | update-service 只允许 GitHub 相关 host，无本地 fixture seam |
| 插件整理清单 | `PluginItem` 无 version/source/installedAt |
| preflight | 只扫明文源目录，不解 tgz；个人路径对 docs 只报告 |
| 受保护路径 | `scripts/protected-paths.js`：D 盘安装目录、F 盘稳定版数据、两个 %APPDATA% 遗留目录、`~/.dsh` |

---

## 五、给 Cyrus 的两个拍板项（不影响 K3 先改文档）

1. **P0-6 是否接受 V1 白名单 16→14**（排除插件中心两包）：建议接受，保守且与 D2 一致。
2. **P0-5 的 minClient 两条取值规则**：测试 fixture 用 0.3.0、正式首发索引用 0.4.0 的约定是否认可：建议认可。

这两个点确定后，K3 改完简报即可进入执行。
