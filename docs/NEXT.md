# Next Development

状态：**B-G4-0 与 G2-P2 已精确提交为 `2400410`，等待 push/`plugins-v*` Release 授权；B1b 暂停**
当前 Stable：**0.4.5 已发布并完成真实插件更新验收**
当前 canonical workspace：`F:\Projects\deepseek-harness-personal\workspace`，B-G4-0/G2-P2 本地提交=`2400410`，G4 Amazon 治理收口=`216cfc4`，G3=`1f8fcd6`（Toolbox=`600b296`，Memory=`c0a0b03`，G2-P1=`535185b`；A 线冻结父基线仍为 `c27e989381c34dc06d4f4af1845f6122c0b00c2b`）
旧 B 工作树：`6481c4794cb44b6020589b4aa52b9e7fc6095911 / 0.4.3`，只作迁移输入，不得继续扩建

> **2026-08-26 当前唯一执行顺序**：B-G4-0 产品候选与 G2-P2 package-set 机器闭环已在唯一一次正式全量 826/826 后精确提交为 `2400410ca10e4a8e792d276bcde89faeb778e1e6`；superseded 清理与 commit receipt 均已落盘 → 下一步单独授权 push/`plugins-v*` Release → 再单独授权真实 Stable 安装 → 重新只读核对候选并预览真实 rebind。push/发布、Stable 安装和真实 rebind 仍是分开的失败关闭闸门；量化、食溯与 B1b 继续暂停。

## G0：当前收口任务

1. [x] 在 `F:\Projects\deepseek-harness-personal` 建立三分区骨架和 marker；canonical workspace 独立克隆并固定父基线 `c27e989`。
2. [x] 对 B1a/治理/K3 输入建立 47 项 SHA-256 迁移计划；33 个 B1a 文件保持原字节，5 个治理新增文件与 1 个 K3 输入按“原样导入后允许追加状态横幅”单列审计。
3. [x] 完成 8 份共用文档的 hunk 合并；生成治理总索引、current-state、workspace 根 AGENTS 与项目 manifest。
4. [x] 生成 import apply receipt；33 个 B1a exact-copy 全部 hash 对齐，其他文件按 unchanged/annotated/hunk-reconciled 分栏，不再使用错误的“39 exact”口径。
5. [x] 三层 checkout 闭环完成：仓库 `.gitattributes` + repo-local Git 配置 + `check-checkout-contract`/测试/launch 接线；Workbench 20/20、B1a 28/28、Project Control 177/177，正式 `npm test` 786/786，launch/diff 全绿。
6. [x] 形成 baseline promotion receipt；在无 commit 授权下仅晋升为“本地已验证候选”，旧 D 盘树继续保留且不清理。治理脚本仅余 `origin` 与旧禁止-remote 规则冲突，留给后续治理决策，未擅改 remote。
7. [x] G0.1 只读对账 A 线清理：六个权威 run 与 Stable `E2E_OK` 保留、已批准删除目标不存在、证据 hash 匹配；只写 F 盘 receipt，不复制任何大证据。
8. [x] 以 Cyrus 已接受的治理方向把 remote 改为精确登记：只允许索引中的 `origin` 与固定 fetch URL，额外 remote、URL 漂移和显式 `pushurl` 失败关闭；remote 存在不授权 commit/push/publish。
9. [x] G0.5 冻结当前候选的逐文件清单与聚合 hash，确认 ignored `artifacts/`、package 和 run 均未进入候选；freeze receipt 位于 Project Home `local/receipts/`。
10. [x] Cyrus 单独授权并完成 G0.5 精确提交：`28d7c8c25e7e879fba8b9170a4ecad8b4ad0d8ef`；未 push、未发布。
11. [x] Cyrus 单独授权并完成 B-G4-0/G2-P2 28 文件精确提交：`2400410ca10e4a8e792d276bcde89faeb778e1e6`；blob 集与冻结候选一致，未 push、未发布、未安装 Stable、未 rebind。

G0.5、G1、G2、G3 与 B-G4-0/G2-P2 已成为 Git 可重建本地基线。G4 Amazon 文件复制和身份对齐已完成；旧源已同盘移动到 `F:\Projects\amazon-store\local\legacy-source\amazon-store-before-g4-20260825`，canonical workspace 未重做。Stable 项目仍 revision 1，数据库 active location 仍记录旧 Kimi 路径，path history 为空；候选 `can_01a038b2-d821-7fac-ae47-fe28a94a5c78` 正确指向 canonical workspace。Host 身份证据和 UI 可达性缺陷已在已提交但未发布/安装的 `0.1.0-rc.9` 候选关闭；真实 Stable 尚未安装该候选，不能声称 rebind 已可用。

### B-G4-0 边界

- 允许：Project Control intake 纯逻辑、CandidateDetails 局部 CSS、相关测试与 bundle、Project Control v2 独立发布元数据、发布脚本精确 allowlist/test、plugin lock、治理状态和本地 receipts。
-- 禁止：migration/DB schema、审批中心 B1b、第二套 rebind HTTP/存储逻辑、真实 Stable 安装或数据、既有 A 线 Release、Amazon 项目文件、量化/食溯，以及未经新授权的额外 commit/push/publish。
- 安全合同：`linked_legacy` rebind 使用已登记绑定的确定性 `legacy_fingerprint`，并要求至少一份已登记文档 hash 与新候选一致；没有交集就失败关闭。manifest 继续证明 candidate project_id，但不替代 legacy 身份证据。

## G1–G4：后续治理实现顺序

- **G1 Project Home（已提交完成）**：`project-home/v1` schema/fixtures、Host 纯函数、三分区 Write Plan、三套不可变 `2.0.0` 模板和 W1–W4 组合验证已落地并提交为 `f5c58e5`；旧 `1.0.0` 只保留回放，primary workspace 只指向 `workspace`，整屋 plan 目标指向 Project Home。未修改 migration/DB schema/HTTP/UI/侧栏/收件箱，也未写真实 binding；未 push、未发布。
- **G2 Local 生命周期（P0/P1 已本地全量验收）**：`boot-error.log` 位于各实例 `userData\logs`；完整 `win-unpacked` 受 hash 守护；package set/run 创建即登记；`recommended-v1` policy、20 GiB 登记配额、5 GiB 磁盘底线、24h+12h 调度健康、cleanup plan/apply/verify/receipt 和中断 journal 已实现。相同包体的不同来源证明写外部 provenance，不复制第二套 0.8 GiB 包。Windows 计划任务仍未创建；逾期时大任务入口失败关闭并要求补跑。
- **G2-P2 已本地关闭并提交**：人工/packed E2E 只从 F 盘 canonical 生成；logical task ID 必须与权威 `current-state.nextTask.id` 一致。同任务 append-only claim 最多允许一次物理构建尝试；相同来源只能复用，来源变化或失败后重试均失败关闭并要求先登记新任务。正式测试复用 `f515424f...`，没有新增第四套；当前物理包为 `58adf7b2...` RETIRED + `f515424f...` ACTIVE；实现随 `2400410` 本地提交，尚未 push/publish。
- **G3 跨 Harness（候选已验证）**：Toolbox 规范源已对 DSH Dev/Codex 完成可回滚 `applied_shadow` 投影；memory-host status/recall 单 host 双端结果一致、显式 `project_id`、leak=0。真实宿主 discovery、真实 Stable/binding 与记忆数据迁移未做，不能声称 active。
- **G4 存量迁移（Amazon 身份已对齐，binding/兼容切换待办）**：顺序仍为 Amazon Store → 量化 → meal_tracker/食溯。Amazon 的文件分类、复制、必要路径修复、治理入口和机器验收已完成；正式 Stable `project_id` 已确认且写入 Project Home marker，Dev 仅作测试。接下来依次是 Codex canonical 观察、Kimi 可回滚兼容联接、Kimi 人工验收、Stable rebind；量化和食溯不得自动开始，旧源目录删除不在本任务授权内。

## 历史计划（以下内容不再是当前执行指针）

> **2026-08-20 稳定版 v0.4.0 已发布**：基于 Harness `0.1.0-rc.8`，包含 Workbench 四页签/体验收口、浏览器 WebContentsView 重写、会话导航轨与 18 插件 rc.8 重建。GitHub Release：https://github.com/SeeiiLee/deepseek-projectpl-console/releases/tag/v0.4.0 （安装包/便携版 + SHA-256 + blockmap 已上传）。

### 当前执行顺序（Cyrus 2026-08-19 确认）
1. **Workbench 四页签（Code / Outline / Diff / Browser）升级收口**：✅ 已完成（2026-08-19）。按 `docs/WORKBENCH_VIEWERS_ARCHITECTURE.md` 接续 Kimi 已落地代码，补齐 `matchViewer` 接线、四页签单测、smoke 探针与全量门禁。
2. **Wolai 斜杠命令**：✅ 已完成（2026-08-19）。新增 `/image` `/media`、`/file` `/attachment`、`/database` `/view` 斜杠命令与图片节点、预览图片渲染、测试与门禁。
3. **工作台体验收口 + 浏览器架构重写**：✅ 已完成（2026-08-20，详见 DEVLOG 当日条目）。Browser 页签从渲染进程内嵌 `<webview>` 重写为主进程 `WebContentsView` 叠加（`src/browser-view-bridge.js`），白屏/嵌入限制/宿主崩溃三连问题一次清；编辑器工具栏与悬浮菜单图标化分组、段落下拉自定义化（回显当前类型）、文件树开合整合为单按钮；公共控件沉淀进 `plugins/workbench/src/client/ui/`。
4. **插件独立更新通道最小版**：外部插件目录 + `.tgz` 发布 + 更新中心下载/校验/装配，让简单插件不依赖客户端大更新。→ **已并入 A 线简报（A1–A3），见下方 v4 Flash 交接。**

### 工作台体验收口完成记录（2026-08-20 终版，Cyrus 当日验收通过）
- [x] 根外 .md 工作台内打开（显式 workspaceRoot 全链路 + ad-hoc 根兜底）；预览 http 外链转系统默认浏览器；裸域名自动补 https。
- [x] 浏览器页签 WebContentsView 化：冒烟 `browserGuestReached=true` / `browserGuestRenders=true`，Cyrus 实测 Google/百度/Kimi 通过。
- [x] 编辑器工具栏 12px 分组图标化；段落下拉卡片化并回显当前类型；悬浮菜单项左对齐事故修复并在组件层钉死。
- [x] 文件树收起/展开整合为路径行单按钮（`＞`/`＜` 随态翻转），三横杠窄轨删除。
- [x] 公共控件 `ui/controls.tsx`（UiIcon/IconButton/MenuDivider/PopupMenu/PopupMenuItem），编辑器与浏览器两处已复用；新增 `ui/FileIcon.tsx`（md/html/代码/图片/json/txt/pdf/目录），文件树/搜索结果/路径浮层三处共用。
- [x] 路径行图标化（文件夹图标按钮替代长文本 pill）；路径浮层行距 30px + 无边框筛选框；文件树长文件名不换行（省略号截断）+ 类型图标 + 搜索框去边。
- [x] 文件树 dock 可拖动分隔条（220–560px 钳制，localStorage `dsh-workbench-files-dock-width` 记忆）。
- [x] 轨迹岛废弃重写为**会话导航轨**（SessionMinimap，@cyrus/dsh-trajectory-island 包名不变）：贴会话右缘 14px 垂直细轨，刻度以中轴为中心向上下发散（layout 测试钉死）；用户轮/助手轮长短区分、running 脉冲、error 红、当前位置高亮拉长；悬停弹缩略卡（Turn 号 + 锚点已渲染文本前 180 字）；点击 jumpToChatAnchor 定位（数据层 model/jump/contracts 原样复用）。
- [x] 门禁：workbench 单测 122/122、trajectory-island 5/5、两插件 tsc=0、全量冒烟 SMOKE_EXIT=0。
- [ ] 下一候选（非阻塞）：页签栏「＋」菜单项图标化（复用 ui/controls）；Diff 审阅页签体验走查；详情面板信息密度设计；导航轨当前位置指示增强（小圆点/箭头，Cyrus 使用中再定）。

---

## v4 Flash 任务交接（2026-08-20，Cyrus 确认开工）

**执行配置**：实现 = DeepSeek v4 Flash；审查 = Codex（额度恢复前 v4 Pro 代审）；Class A 闸门 = Cyrus。
**状态**：三条线简报均为 v2 定稿、已吸收执行层评审，**待 Cyrus 盖章后按序派发**。

### 派发顺序与依赖（串行）

| 序 | 任务 | 简报 | 前置 |
|---|---|---|---|
| 1 | **A1 外部插件目录与装配运行时**（含前置小项：smoke.js 显式 `SMOKE_EXIT=0/1` 输出） | `docs/design/A线-插件通道-首批三任务简报.md` | 盖章即开 |
| 2 | **A2 插件发布管线**（`release:plugins` 跑道） | 同上 | A1 交付审过 |
| 3 | **A3 更新中心插件区**（消费侧闭环，= D1 §10 出口验收） | 同上 | A1+A2 |
| 4 | **B1 审批收件箱 MVP**（Class A：动 DB schema 9→10，Cyrus 闸门） | `docs/design/B线-控制台审批中心-首批三任务简报.md` | ADR-004 v2 随简报盖章生效 |
| 5 | **B2 治理视图** | 同上 | B1 + **ADR-005 由 K3 起草、Cyrus 拍板**（B1 执行期并行） |
| 6 | **B3 常备授权/门禁/会话上下文/日历指标**（首步 = session 路由 spike 0.5 天，含 rc.8 子代理通道核查） | 同上 | B1+B2 |
| 7 | **C0 前置步骤**（人工 0.5h，**Cyrus 本人参与**：稳定版补注册 Quant + Amazon Store；原型 out 移出仓库；导出注册表） | `docs/design/C线-会话全量提取-首批三任务简报.md` | Cyrus 时间 |
| 8 | **C1 盘点登记层**（308 会话，零内容提取） | 同上 | C0 |
| 9 | **C2 解析规范化层**（轮次级 + 白名单 + 脱敏） | 同上 | C1 |
| 10 | **C3 审批语料提取 + 盲评**（远程模型外发：闸门 1 已批，带三箍） | 同上 | C2 |

### 派发时必带（每条简报内「共同交接上下文」节有全文）
- 各线必读经文件、红线（不改只读上游、不碰稳定版受保护路径、日志零内容等）均已写死在简报首部，**派发时原样附上**。
- 门禁四件套每期必交：新增测试数 + 全量 `node --test` 绿 + 相关插件 tsc 0 错 + `check-plugins` / `verify-launch` / smoke 全过（输出重定向日志文件再读，PowerShell 管道吞退出码）。
- 每任务交付 → Pro 代审 → 审过派下一个；A 线估时 1.5–2h / 1.5h / 2.5–3h，B 线 2.5h / 2h / 2.5h，C 线 0.5h / 1.5h / 2h / 2h。
- 首个真实 `plugins-v*` release 由 Cyrus 手动创建，随后做一次 D1 §10 实链路复核（本地 fixture 通过 ≠ 全链路通过）。
- C 线记忆候选提取（C4）不在首批，闸门 1 已覆盖，另行派发。

### Workbench 四页签升级收口完成记录（2026-08-19）
- [x] `matchViewer` 接线：新增 `openWorkspaceFile()`，文件树/搜索/路径弹窗统一按扩展名自动选择 Markdown 预览或 Code catch-all 查看器。
- [x] 注册两级 preview viewer：Markdown（`exts: ['md','markdown','mdx']`，priority 10）与 Code（`exts: []`，priority -100）。
- [x] Outline/Diff/Browser 核心代码已确认在场；修复 `WorkspacePreviewViewer` reveal-line TDZ 崩溃。
- [x] 新增 `viewer-arch.test.js`：browser-url / browser-probe / outline / workspace-diff / matchViewer；`service.test.js` 补 `updateTab`。
- [x] smoke 新增 `outlineProbe` / `diffProbe` / `browserProbe` / `codeProbe`，全部 `ok`。
- [x] 门禁：`node --test` 584/584、`check-plugins.js` 通过、`verify-launch.js` 通过、smoke `SMOKE_EXIT=0`。

### Wolai 斜杠命令完成记录（2026-08-19）
- [x] 新增图片节点 `image.ts`：编辑器内显示 `<img>`，序列化 `![alt](src)`，预览 `markdown-lite` 支持图片渲染。
- [x] 新增斜杠命令：`/image` `/media`（图片/媒体）、`/file` `/attachment`（文件/附件链接）、`/database` `/view`（数据视图 = 标题 + 表格）。
- [x] `RichMarkdownEditor` 接入 Image 扩展；预览图片样式与编辑器图片样式已补。
- [x] `structure.test.js` 新增 Wolai 斜杠命令结构测试。
- [x] 门禁：`node --test` 585/585、`check-plugins.js` 通过、smoke `SMOKE_EXIT=0`。

## R-ED WYSIWYG 收尾交接（2026-08-19 换 Session 交接，先做这一段）

### 已完成并已由 Cyrus 实测认可
- 编辑态 = 所见即所得单面板编辑器（无分屏、无编辑内预览——用户裁决「编辑不需要预览」）；editLayout 偏好与设置卡片「编辑时布局」控件已整体删除，存量 split/auto 自动失效。
- live preview 装饰：标题 #/列表 -/引用 >/围栏行/行内 ** * \` ~~ 标记经 Decoration.replace 隐藏（文本不参与复制/选中），内容加排版类（cm-md-heading-N/bold/italic/strike/inline-code/quote/list-item/fence）。
- 挂载初期无条件全隐藏；用户交互后光标落在标记内暂显（Obsidian 语义）；标记样式始终生效。
- 浮动选中工具栏（标题层级 H1–H6/加粗/斜体/删除线/行内代码/行内公式/链接/[[双链]]/脚注/代码块/搜索选中），toggle 语义。
- \`\`\` 围栏自动补全（EditorView.inputHandler，零新依赖；纯函数 fenceAutoCloseInsert 在 markdown-format-tools.ts）。
- 自动保存（2s debounce + 冲突三态 + Ctrl+S）+ 磁盘图标保存 + 放弃 X。
- 布局：文件名行 + 滚动体 + 固定脚注（版本 sha256 hover + 字节数）；viewHost 确定高度链（.details min-height 问题根治）。
- 编辑态应用阅读字体/字号（editorHost 注入 --wb-reader-font-family）。
- 真实文件回归：test/fixtures/M9_DESIGN.md（用户验收文件冻结）+ smoke realFileProbe。
- 门禁：单测 581/581、workbench tsc=0、全量冒烟 SMOKE_EXIT=0。

### 已完成（2026-08-19 续）——编辑态排版对齐预览/Obsidian 质感
用户原话：「格式上还是不像预览一样，能达到 Obsidian 这种格式，还是有一种不完善的感觉」。本轮已对照本机 Obsidian 安装包解出的 `app.css` 与 docs 约束补齐：
1. **段落间距**：空行/块级边界通过 `cm-md-paragraph-start/end` 装饰 + CSS 形成块级 margin；同一段内连续行不加间距。
2. **引用块**：`cm-md-quote` 整行块级左边框/底色/缩进，`start/end` 控制首尾 margin。
3. **代码块**：围栏内容行 `cm-md-codeblock` 统一背景/圆角/等宽字体；围栏首尾行 `start/end` 圆角。
4. **列表**：`cm-md-list-item` 悬挂缩进 + `::before` 项目符号；有序列表带 `data-index`；续行 `cm-md-list-continuation` 对齐且不重复符号。
5. **标题**：h1–h6 块级 margin/字号/字重；不额外加下划线（按用户反馈与预览对齐）。
6. **分割线/表格/链接/脚注**：`cm-md-hr`、`cm-md-table`、`cm-md-link`、`cm-md-footnote/def` 装饰 + CSS。
- **阅读宽度**：编辑态 `.cm-content` 读取 `--wb-reader-width`，与预览同宽居中。
- **选区修复**：块级样式改挂 `.cm-line:has(...)`，不再给装饰 span 加 `display:block`；行级间距从 `margin` 改为 `padding`，避免 CM6 坐标/选区漂移。
- **预览正文设置修复**：覆盖 MarkdownText 的 `.markdown` 根样式，字号/颜色/字体现在真正作用到正文（之前被平台 MarkdownText 默认样式覆盖）。
- 实现约束：一律走装饰类 + CSS（WorkspaceViewers.module.css 的 [data-editor-variant='document'] 段），不改 React DOM 结构；**严禁 Decoration.line**（见坑 1）。
- 参考：Obsidian 本体 `D:\ImportantTools\obsidian\resources\obsidian.asar` 解出的 `D:\obsidian-extract\app.css`；`obsidian-releases`/`claude-obsidian`/`wolai-client` 已克隆到 `D:\` 下作参考。
- 验收：单测 584/584 + smoke `SMOKE_EXIT=0`；真实文件 M9 探针新增 `quoteHidden=true`（引用 `>` 已隐藏）。

### 下一步（Phase 2 进行中）
- **Phase 1 已完成并经 Cyrus 确认**：TipTap 富文本基础能力、保存、滚动、页脚、斜杠命令、Markdown 快捷键均已通过验收。
- **Phase 2 已开始**：
  - 表格：已接入 `@tiptap/extension-table` 系列，工具栏「⊞」和 `/table` 可插入 3×3 表格。
  - 链接：已接入 `@tiptap/extension-link`，工具栏「🔗」和 `/link` 可设置链接。
  - 待办列表：已在 Phase 1 接入 TaskList/TaskItem。
  - 脚注：行内用 `Footnote` node 渲染为上标（小一号、深灰，带 `id="fnref-n"`），序列化用 `state.write` 原样输出避免 `\[` 转义；选中文本再点脚注会在**选中文本末尾**插入上标，不删除原文字；文末自动加“脚注”小标题，并用 `FootnoteDefinition` NodeView 显示 `1: 脚注内容`（序列化为标准 `[^n]: 脚注内容`）；定义里的 `1:` 是超链接，指向文内 `fnref-n` 标记；smoke `footnoteProbe=ok`。
  - **预览模式待办/脚注/本地链接/行内公式**：已在 Workbench 插件内解决（不依赖平台 MarkdownText）：`WorkspaceMarkdownDocument` 改用插件内 `markdown-lite` 渲染器，任务列表显示 ☐/☑，脚注生成上标引用与文末脚注区，本地路径链接显示为链接，`$...$` 行内公式显示为 `.math-inline`；smoke `previewFeatureProbe=task=true|footnotes=true|localLink=true|math=true|footnoteHeadingCount=1`。
- **脚注保存后渲染崩溃修复**：`FootnoteDefinition.renderHTML` 原来把 content hole `0` 与编号 span 并列，违反 ProseMirror `renderSpec`「content hole 必须是父节点唯一子节点」约束，`getHTML()`/部分渲染路径会抛 `RangeError: Content hole must be the only child of its parent node`。已改为把内容洞放进独立 `.footnote-def-content` 容器；smoke 新增 `footnoteHtmlProbe=ok` 与 `saveAfterFootnoteProbe=saved-preview-ok` 防回归。
- **预览补齐本地链接/行内公式/脚注标题收敛**：`markdown-lite` 现在渲染本地相对/绝对路径链接（不再只显示纯文本）、`$...$` 行内公式（`.math-inline`），并把正文中多个 `## 脚注` 标题收敛为文末唯一脚注区；旧版误序列化的 `[1:](#fnref-1) 11111` 行也会被识别为脚注定义，不在正文重复显示。smoke `previewFeatureProbe` 新增 `localLink=true|math=true|footnoteHeadingCount=1`。
- **脚注 Markdown 重新解析**：`Footnote`/`FootnoteDefinition` 增加 `markdown.parse.updateDOM`，在 tiptap-markdown 渲染后把标准 `[^id]` 与 `[^id]: ...`（以及旧版 `[1:](#fnref-1)` 误产物）转换回脚注节点。这样保存后再进入编辑态，脚注不会退化成纯文本，也不会因“识别不到已有定义”而反复新增 `## 脚注` 标题。
- **脚注编号防冲突**：`insertFootnote` 新增 `nextFootnoteId()`，插入前扫描文档已有 footnote/footnoteDefinition 的数值 id，自动跳过已占用编号。避免文档已有 `[^1]` 时新脚注又生成 `1`，导致新旧脚注互相覆盖/“隐藏”。
- **历史脏数据自动收敛**：加载 Markdown 时 `convertFootnoteDefinitions` 会清理历史遗留的多个 `## 脚注` 标题——只要有脚注定义，就只保留一个 `## 脚注` 并放到第一条例定义前；旧版 `[1:](#fnref-1)` 误产物也会转成标准脚注定义。这样进入编辑态后不会看到一堆重复脚注标题，保存一次即可把磁盘源码洗成标准格式。
- **多脚注定义串行修复**：`FootnoteDefinition` 的 Markdown 序列化补上 `state.closeBlock(node)`，连续多个 `[^n]: ...` 定义会各自成行，不再串成 `[^3]: 3:11\[^4\]: ...` 这种单行脏数据；smoke 新增 `multiFootnoteProbe=ok` 防回归。
  - 行内公式：新增 `InlineMath` mark，工具栏「ƒx」和 `/sxgs` 可插入/切换 `$...$`；选中含 `$...$` 的文本再点按钮会剥离 `$` 并转为公式；smoke `mathProbe=ok`。
  - 搜索选中：工具栏「🔍」可在文档中定位下一处选中文本并滚动到可视区域；改为按文本节点精确映射位置，减少复杂文档偏移。
  - 浮动选中工具栏：自定义 fixed 定位实现（不依赖 tippy），包含“类目”菜单（已移到最前，灰底、左对齐、每项带 icon：列表/待办/数字列表/H1-H4/表格/代码块，选择后下次激活自动关闭）以及 B/I/S/行内代码/行内公式/脚注/搜索。
  - 表格操作：鼠标悬停单元格左/上边缘出现 `+` 按钮，可插入行/列；全选整行/整列后按 Delete/Backspace 可删除行/列；表格 `table-layout:fixed` 防长文本挤压。
- **测试示例**：已在 `test/fixtures/M9_DESIGN.md` 末尾追加表格/链接/脚注/行内公式/待办示例，便于直接查看效果。
- **待继续**：更完整 Wolai 斜杠命令（媒体、数据库视图等）。
- 详细方案与架构见：`docs/RICH_TEXT_EDITOR_REFACTOR.md`。
- 单测：`578/578`、workbench `95/95`、smoke `SMOKE_EXIT=0`。

### Phase 3 收尾已完成（2026-08-19）
- [x] 可选源码模式切换：富文本工具栏新增「源码/富文本」切换，源码模式用 textarea 直接编辑 Markdown，切回时同步回 TipTap。
- [x] 清理 CodeMirror document/live-preview：删除 `markdown-live-preview.ts` 与旧测试，`MarkdownEditor` 移除 document variant，`WorkspaceViewers.module.css` 移除 `data-editor-variant='document'` 全部样式。
- [x] 脚注 link-reference 冲突修复：markdown-it 会把 `[^id]: ...` 误当 link reference definition，导致脚注变链接；已通过 `parse.setup` 在渲染前保护定义行。
- [x] 长文档性能：smoke `realFileProbe` 仍覆盖 M9 长文档滚动/渲染；无回归。
- [x] 全量门禁：`node scripts/check-plugins.js` 通过（workbench typecheck 0 错误）、`node scripts/verify-launch.js` 通过、`node --test` 578/578、smoke `SMOKE_EXIT=0`。
- [ ] 打包验证：实际 `pack:dev:dir` / `pack:win` 留到发布/验收需要时再执行。


### 后续任务：插件独立更新通道（Cyrus 已确认方向，2026-08-19 记录；执行顺序排第 3）

目标：让**简单插件**可以单独发布到仓库，稳定版客户端通过“下载插件”方式更新，**不需要等客户端大更新**。

现状：目前插件随客户端包体一起发布，更新插件 = 更新客户端；`dev_install_package` / `dev_release_plugin` 已有热装/发布基础，但稳定版没有打通外部插件更新链路。

需要实现的最小闭环：

- [ ] 稳定版支持从用户数据目录加载外部插件（优先级高于内置插件）。
- [ ] 插件发布物：每个插件发布 `.tgz`（带版本 + SHA-256，可选签名）到 GitHub Releases / 私有仓库。
- [ ] 更新中心扩展：检查插件版本、下载、校验、解压到外部插件目录。
- [ ] 装配生效：Cordis loader 热重载或提示重启；失败回滚到内置版本。
- [ ] 兼容/安全：插件与客户端/其他插件兼容矩阵；来源校验，避免供应链风险。
- [ ] UI：插件管理页显示“可更新”状态与“更新”按钮（可复用现有 plugin-organizer / update-center）。

预期工作量（LLM/DSH 工时）：

- 最小可用版（外部目录 + 手动检查更新 + 重启生效）：约 2～4 小时。
- 完整版（自动检查、热重载、签名、兼容矩阵、回滚、UI）：约半天到 1 天。

### 架构定稿（2026-08-20 Kimi 设计、Cyrus 拍板，开发前必读）

本任务的完整架构与治理已定稿，开发范围与约束以以下文档为准（docs/ 已按 D3 治理骨架重组，根部旧文件原位不动，索引见 `docs/INDEX.md`）：

- **通道架构**：`architecture/D1-插件独立更新通道-架构设计.md`——V1 范围 = 零依赖插件；预构建 .tgz + 机器索引 + SHA-256 + GitHub Releases `plugins-v*` 标签；安装 = 重启边界；内置基线永远在场。memory 属 V2（前提：依赖供给 + 迁移感知回滚，D1 §9.3）。
- **治理约束**：`architecture/D2-插件体系治理与用户侧设计.md`——seam 白名单纪律（私改只读上游 = 红灯）；四层门禁（静态/契约/评测/红线）；Class A/B 分级授权（交付时自报级别）；**插件中心做成内置基线插件**（不可卸载、自身不自动更新、可回滚到内置基线；复用 plugin-organizer + update-center，不做客户端原生页）。
- **记忆发布路径**：D1 §9 + `architecture/D4-记忆系统跨Harness复用方案.md`——P0–P4+P6-1 已纯插件上线；P5/P6 全插件化可行；模型资产走 models-v* 独立通道。
- **决策档案**：`docs/adr/`（ADR-001 跨端定位，生效 / ADR-002 核心外壳拆分，预登记 / ADR-003 漏斗召回+留痕，生效）。

### P7 候选登记（2026-08-20，未排期，建议排在 P5/P6 收尾后、核心/外壳拆分前）

- **效用反馈闭环**：召回事件留痕 + 逐条记忆效用分（EMA）参与召回排序；食溯问卷闭环的同构迁移。
- **主动判别式召回**：漏斗③从零实现——多候选无法区分时追问最小判别特征，禁止兜底式多召回。
- 设计稿：`design/P7-记忆效用反馈与主动判别召回-设计稿.md`（含反馈数据结构、判别特征 schema、四个待决参数）。
- 配套：提取 schema 扩展（记类型/特征/解空间位置，V2 通道承载）；公共基准（SWE-context-bench / LoCoMo-Refined / LongMemEval）进评测门，只内测不打榜（ADR-003）。

### 治理门禁脚本任务（2026-08-20 登记，未排期）

- 把 `governance/LLM项目治理说明书.md` §10 的五个机器可查不变量（INDEX 双向一致 / 位置正确 / 状态头 / 取代必有横幅 / ADR 只追加）做成一条命令，进 preflight 门禁族。
- 脚本缺失期间，§10 给出的手动验证方法是底线，每次交付前必过。

### B 线登记：控制台审批中心与治理视图（2026-08-20，待 Cyrus 逐项拍板）

- 设计稿：`design/B线-控制台审批中心与治理视图-设计稿.md`——待拍板清单 D-1～D-9 在文首（三层模型 / 卡 schema / 卡型动作 / 质量门禁 / 常备授权 / 一图四投影 / 跨端摄入 / 分期 / ADR 方式）。
- 合同扩展：`adr/ADR-004-project-control合同族扩展-治理语义与审批队列.md`（预登记；只新增不改冻结本体；生效后 B1–B3 才允许开工）。
- 实证依据：`design/审批交互模式-本会话实证分析.md` + `design/审批交互模式-Codex会话对照挖掘.md`；路由名册与三线分解见 `design/执行者模型与任务路由.md`。
- A/C 线简报（待盖章派发）：`design/A线-插件通道-首批三任务简报.md`、`design/C线-会话全量提取-首批三任务简报.md`（含 3 个授权闸门待 Cyrus 决策）。

### 关键坑（换 Session 必读，勿重复踩）
1. **Decoration.line 禁用**：行装饰触发 CM6 measure 循环（"Measure loop restarted"）→ 长文档 viewport 渲染窗口永不更新（滚动到底仍显示开头）。围栏行已改 Decoration.mark；回归测试 test/markdown-live-preview.test.js 断言源码无 Decoration.line( 调用。
2. **烟测盲区**：合成 README 无围栏、探针从未滚动过长文档——新增探针必须覆盖「长文档 + 滚动到底」。
3. **用户验收入口**：双击「启动 DeepSeek Harness 开发版.cmd」（每次自动重建插件）；唯一事实源 = 开发树 plugins/workbench/lib；~/.dsh/profiles/web/node_modules/@cyrus/dsh-workbench junction 启动时自动指向开发树。
4. **本 agent 进程环境被稳定版应用污染**：PROJECT_CONTROL_HOME=F:\documents\Cyrus Deepseek Harness Data\project-control——诊断启动开发版必须移除该变量或显式设为 %APPDATA%\DeepSeek Harness Personal Dev\project-control，否则开发版抢稳定版 writer-lock → 「项目数据库暂不可用」（project-control 存储失败现已输出 console.warn 诊断）。
5. **CDP 实机调试法**：electron . --remote-debugging-port=9333（配 dev 环境变量）→ /json 拿 ws → Runtime.evaluate 驱动 UI；挂载前设 window.__DSH_SMOKE__=true 可拿到 __wbEditorViews（EditorView 实例）读 state.doc；测量 .cm-scroller scrollTop/scrollHeight 与 .cm-content 首末行判 viewport 是否更新；结束后恢复用户 localStorage（页签/偏好）并按 PID taskkill。
6. **用户环境事实**：偏好（已恢复）readerBackground custom #a08546 / readerFontSize 15.3 / readerWidth 1080 / readerFontFamily round / codeFontFamily fira / lineWrapping true / showLineNumbers true / readerTextColor custom #551111 / panelFontFamily yahei；工作台页签 BLOCKED.md/DEVLOG.md/经验.md（项目 DeepSeek Harness Personal Desktop prj_01a00cfd-1fe4-7bb3-9123-027765662055）；验收文件 F:\QClawData\workspace\meal_tracker\docs\M9_DESIGN.md（食溯App prj_01a00719-c9ca-7e51-8872-8aff6fdd0461）。
7. **门禁命令**：node --test "test/*.test.js" "plugins/*/test/*.test.js"（>580 全绿）+ node scripts/smoke.js（看 SMOKE_EXIT=0；PowerShell 管道会吞 $LASTEXITCODE，务必重定向到日志文件再读）。

## 历史基线（以下为既有计划，接续阅读）


## P0：接手验证（2026-08-15 完成）

- [x] 阅读 `HANDOVER_TO_DEEPSEEK_HARNESS.md` 及其中列出的规范。
- [x] 确认 `D:\Deepseek Harness` 仍处于 `0.1.0-rc.5` / `47f943...`，无漂移（唯一未跟踪文件仍是已知启动脚本）。
- [x] 运行 `pnpm test`，结果 `241/241` 与基线一致。
- [x] 运行 `pnpm run check:plugins`，十三个插件全部通过、退出码 0。
- [x] 运行 `pnpm run smoke`，通过（schema 5、四轨、十三插件、优雅退出、端口关闭）。
- [x] 未改动封装资产，本轮无需 `pack:win:dir` / `smoke:packed:dir`；进入 Gate 2D 且触及打包资产时再执行。
- [x] 环境备注：本机无全局 pnpm，门禁用 `npx pnpm@11.19.0`；门禁输出统一 `*> log` 重定向，避免 PowerShell 管道吞掉原生 stderr 造成的假退出码。

## P1：Gate 2D 合同补充（2026-08-15 冻结，见 `PROJECT_TEMPLATE_SPEC.md`）

- [x] 冻结 template registry 的 identity/version、来源和兼容规则：templateId/templateVersion 格式、发布后不可变、无 latest 别名、协议线版本独立、Host 随包资产、首批三模板。
- [x] 冻结 write plan DTO：沿用 Gate 2B lifecycle `$defs.writePlan`（planId/planHash/manifestHash/syncPolicy/operations，expectedState 仅 absent，禁止覆盖/移动/删除）；目标根只来自 Host 签发 ref；目录集合恰好覆盖文件祖先；TTL 300 秒、planId 单次使用。
- [x] 明确 `createFromTemplate` 和 `upgradeManaged` 的 crash/retry/replay 语义：W1–W4 崩溃窗口与启动恢复行为、replayed 只读 Receipt 不重跑文件计划。
- [x] 明确文件提交成功与 SQLite accepted 的一致性协议：文件先提交并复验 → SQLite 事务后提交；accepted 的 fileSync 只能是 committed；禁止“数据库成功、文件失败”。
- [x] 明确用户取消、路径占用、已有文件、非法 manifest、磁盘不足和进程崩溃的结果：结果表已冻结（TARGET_NOT_EMPTY / WRITE_PLAN_STALE / MANIFEST_INVALID / FILE_SYNC_FAILED / failed_recovery_required）。
- [x] 机器合同：`protocol/project-control/v1alpha1/templates/schemas/template-manifest.schema.json` + 8 例 fixtures + index；占位符、渲染、templateHash 规范化与确定性定义完成。

验收：Schema/fixtures/Ajv strict 全部通过（新增 `plugins/project-control/test/template-contract.test.js`，7/7），文档与数据模型无冲突；全量门禁随 P2 起每轮复验。

## P2：安全文件适配器（2026-08-15 完成，仅临时 fixture）

- [x] 只接受 Host 侧构造的受控路径（目标根/授权根由 Host 解析并做 containment 校验），拒绝 Renderer 裸绝对路径；journal 存储拒绝 UNC/非绝对路径。
- [x] 所有写入限定在目标 project root 与授权根内：relativePath 防逃逸正则、lstat 不跟随 symlink/junction（占用即 WRITE_PLAN_STALE）、staging 目录名以 planId 绑定、回滚只删除本次 rename 过的路径。
- [x] 同盘 staging（新建=父目录 .dsh-staging.<planId>；升级=目标根内同名目录）写入 fsync 并逐文件核对 contentHash，再原子 rename（整树/逐顶层路径），落盘后全量复验。
- [x] 已存在文件默认不覆盖：expectedState 仅 absent，执行前/rename 前双重 absent 检查；覆盖策略仍属新协议线版本。
- [x] 持久化 journal（迁移 `0006_file_sync_plans.sql`，schemaVersion 6）：planned→staging→staged→files_committed→accepted/rolled_back/recovery_required，乐观状态转移；失败可重试（rolled_back→staging）、可回滚、不留下半 manifest。
- [x] 启动恢复：`listFileSyncPlansForRecovery` + `recoverPlan`（staging/staged 残留删除并 rolled_back；files_committed 复验一致才可 resumable，不一致 quarantine 为 recovery_required 且不删文件）；scanner 跳过 `.dsh-staging.` 前缀目录。

验收：新增 `plugins/project-control/test/filesync.test.js` 15/15（成功创建/空目录创建/占用目标/TOCTOU 竞争/additive 升级/冲突/失败注入/W1-W2 恢复/W3 续跑与篡改 quarantine/重试/journal 规则/symlink/UNC/扫描跳过），全部在 mkdtemp 临时 fixture 上执行。

## P3：标准项目快速新建（2026-08-15 Host 管线完成；Console UI 待补）

- [x] 系统目录选择器选择父目录和项目名：新增 `create-parent` 单次授权票（桌面 main/bridge 与插件 verifier 同步支持）；`POST /intake/prepare-create` 校验目录名/名称/模板并生成签名 create 命令。
- [x] 预览将创建的目录、manifest、PRD、ARCHITECTURE、DEVLOG、NEXT：内置三模板（minimal/software/research）经 `templates/registry.js` 严格校验、占位符渲染并通过 project-manifest Schema；预览返回 template/templateHash/projectId/目标路径/完整 writePlan。
- [x] 显示 templateId/templateVersion 与最终 projectId：预览与 manifest `origin.template` 均记录精确版本，`templateHash` 由 Host 重算。
- [x] 用户确认后执行 write plan；复验 manifest/hash 后才提交 Project/Receipt/Event/Outbox：resolveCreate 复核签名/引用/planHash/渲染哈希后，文件先提交并复验（P2 适配器），再原子提交 `registerCreatedProject`（managed revision 1 + location + manifest mirror + bindings + Receipt + `project.managed.created` Event + Outbox + plan accepted）。
- [x] 创建完成后加入 Project Console（`GET /projects` 立即可见），不自动打开或抢占 Conversation 焦点（无 Session 副作用）。
- [x] Project Console 快速新建表单 UI 已完成：`create-parent` 系统目录选择、目录名/项目名输入、模板下拉（listTemplates）、预览页（templateId/templateVersion/templateHash、最终 projectId、目标路径、逐项操作清单）、确认提交（prepareCreate → lifecycle）；成功/失败/返回修改状态齐全；创建成功仅刷新项目列表，不切换会话。smoke 增加 `projectCreatePresent` 校验。

验收：`plugins/project-control/test/create.test.js` 9/9（模板清单、端到端创建、占用目标拒绝、TOCTOU、W3 续跑与重放、篡改拒绝、票据单次使用、引用过期、第二控制面凭项目文件恢复身份），全部在 mkdtemp 临时 fixture 上执行。

## P4：Legacy 安全升级为 Managed（2026-08-15 Host 管线完成）

- [x] 从现有 `linked_legacy` Project 生成升级预览：`POST /intake/projects/:id/prepare-upgrade` 返回 manifest 目标、文档数量、fingerprint、完整 writePlan 与签名命令。
- [x] 保留 projectId、PRD、DEVLOG 和现有目录结构：升级计划只含 `.dsh-project` 目录与 `project.yaml`（docsRoot `.`、entries 镜像 DB 绑定、origin imported），文件执行期逐份复验哈希。
- [x] 只新增必要 manifest/缺失文档，不静默重写用户文档：additive 计划 + expectedState 仅 absent；执行前后校验既有文档哈希不变。
- [x] 冲突时进入逐项处理；取消不改变项目文件或数据库 mode：文档变化/`.dsh-project` 已存在 → rejected `WRITE_PLAN_STALE` 且 mode 保持 `linked_legacy`、plan rolled_back；不执行即无任何写入。
- [x] 文件提交并复验后才把 mode 改为 `managed`：`registerUpgradeManaged` 在同一事务内完成 mode→managed、revision+1、manifest mirror、plan accepted、Receipt/`project.managed.upgraded` Event/Outbox。

验收：`plugins/project-control/test/upgrade.test.js` 5/5（端到端升级与重放、文档变化拒绝、篡改拒绝、`.dsh-project` 占用拒绝、二次升级 MODE_CONFLICT），全部在 mkdtemp 临时 fixture 上执行。

### B 档：启动门与构建产物校验（2026-08-15 完成）

- [x] `scripts/verify-launch.js`：启动前校验十三插件 Host/Client bundle 存在/非空/语法/client id 标记、桌面主进程四文件语法、migrations 0001–0007；不通过则以明确消息退出。
- [x] `pnpm start` 与双击 `.cmd` 启动器在 build 之后、Electron 之前执行启动门；`DSH_LAUNCHER_BUILD_ONLY` 测试缝隙保留。
- [x] `scripts/build-plugins.js` 在每个插件构建后立即 `node --check` 双 bundle 并核对 client id 标记，坏产物不可能成为磁盘上的最后状态。
- [x] C 档（运行时隔离）已完成：`scripts/sync-runtime-stable.js`（启动门绿 → staging → 同盘原子换入 `runtime-stable/`，换入前后两次检测运行中稳定版实例，检测到即拒绝——Windows 对使用中的目录不提供 rename 保护，文件按 delete-on-close 语义消失，曾因此把运行中的客户端打崩一次）、`启动 DeepSeek Harness 稳定版.cmd`（日常使用，只校验稳定版自身启动门后启动，不触碰开发树）、`启动 DeepSeek Harness 开发版.cmd`（插件开发验证，独立用户数据）、`pnpm run sync:stable` 与 `test/runtime-stable.test.js`（2/2：结构完整性 + 稳定版自身门禁 + 二次同步幂等）。

### C 档收尾：双包体拆分（2026-08-15 完成，按 Cyrus 要求）

- [x] 两个完全独立的桌面包体：测试版 `DeepSeek Harness Personal Dev`（AppId `…-personal-dev`、Portable 单文件，输出 `artifacts-dev/`）与稳定版 `DeepSeek Harness Personal`（安装版/Portable，输出 `artifacts/`）；应用名/AppId/userData 目录/快捷方式名全部独立，可同时运行。
- [x] 双身份机制：`src/build-flavor.js` + `src/app-flavor.js`（`scripts/pack-desktop.js` 打包前切 dev、结束恢复 stable）；`main.js`/`shortcuts.js` 全链路 flavor 化。
- [x] 打包脚本：`pack:dev:portable`/`pack:dev:dir`/`pack:win`/`pack:win:dir`；修复模板文件未进包（`build.files`）与 smoke 探针变量作用域两个打包期 bug。
- [x] 验证：开发版与稳定版 packed smoke 双通过；测试版 Portable 与运行中的稳定版**并存验证通过**（进程树/数据目录独立，关闭测试版不影响稳定版）。
- [ ] 后续：稳定版切换为安装版 + 更新中心发布通道（GitHub Releases 或本地产物人工安装，配置前需 Cyrus 确认）；验收流程固化为「开发 → 打测试版包 → Cyrus 验收 → 打稳定版包 → 发布」。安装版数据目录规则（`resolveUserDataOverride`：已安装＋稳定版身份 → `F:\documents\Cyrus Deepseek Harness Data`）与更新中心「未配置发布仓库 → 本地人工升级」提示已落地；完整产物清单/安装步骤/数据迁移/回滚方案见 `STABLE_INSTALL_PLAN.md`（执行前需 Cyrus 批准三处选择：旧数据迁移、会话去向、安装方式）。

### C 档补充：独立测试版副本（2026-08-15 完成）

- [x] `scripts/sync-runtime-test.js`（共享核心 `scripts/sync-runtime-copy.js`）：从开发树物化 `runtime-test/`（`TEST.json` 印章、自身启动门、换入前后运行中实例守护），`pnpm run sync:test`。
- [x] `启动 DeepSeek Harness 测试版.cmd`：独立用户数据（`DSH_DESKTOP_USER_DATA=%APPDATA%\DeepSeek Harness Personal Test`）与独立 Harness home（`DSH_HOME=…\harness-home`），会话/设置/项目数据库与日常客户端完全隔离，可与稳定版同时运行；纯 ASCII+CRLF。
- [x] `启动 DeepSeek Harness 开发版.cmd` 同样隔离用户数据（`…\DeepSeek Harness Personal Dev`），不再与日常客户端抢单实例锁、不触碰其数据。
- [x] 桌面与开始菜单新增“DeepSeek Harness Personal 测试版”快捷方式（快捷方式自修复只管理固定名的稳定版链接，不会误改它）。
- [x] 更新流程固化：开发树 → 全量门禁 → `sync:test` → Cyrus 验证测试版 → 关闭稳定版 → `sync:stable`。

验收：`test/runtime-test-sync.test.js` 2/2（临时目录）+ launcher 测试扩展（三启动器纯 ASCII/CRLF、隔离环境变量断言、稳定版保持原始数据位置）+ 运行中实例守护复用；全量测试通过。

> 发布节奏（Cyrus 2026-08-15 定）：GitHub 仓库 `SeeiiLee/deepseek-projectpl-console`（私有）已创建并验证可访问，token 已入库；但 **P6/P7/P8 功能开发与测试验收全部通过之前不发布任何 Release**。届时按 `docs/PUBLISHING_RULES.md` 的门禁与清单执行首次发布。

## P5：项目文档刷新与索引同步（2026-08-15 完成）

- [x] managed 以 manifest binding 为准；legacy 以确认过的 DB binding 为准。
- [x] 记录 document revision/hash/parse issue，不复制完整正文到全局数据库。
- [x] 文档变更只形成候选或诊断，不根据文本语气自动推进 WorkItem/Review。
- [x] 重命名通过 role binding/content hash 提议重绑，歧义必须人工确认。

验收：迁移 `0008_document_index.sql` 把 SQLite 升到 `schemaVersion=8`（`project_document_states` 逐绑定状态/哈希/解析诊断 + `project_document_rebind_proposals` 人工确认提案）；Host 管线 `src/document-index.ts` 有界读取绑定文档（单文件 8 MiB、总量 64 MiB、目录遍历 5000 项）记录 ok/changed/missing/unreadable 与 frontmatter/YAML 解析诊断，对缺失文档按内容哈希搜索重命名候选（无歧义才可一键重绑，多候选必须人工选择；managed 提案仅作诊断，重绑被 `managed_manifest_authoritative` 拒绝）；HTTP 新增 `GET /projects/:id/documents`、`POST /projects/:id/documents/refresh`、`POST /projects/:id/document-rebinds/:proposalId/resolve` 三端点与三项 capability；Console 新增文档索引面板（刷新核对、状态/哈希/诊断列表、重绑提案应用/忽略）。刷新不产生任何 Domain Event/Outbox，也不把正文写入全局数据库（测试直接扫库验证唯一标记不在 DB 字节中）。`plugins/project-control/test/document-index.test.js` 5/5（全部临时 fixture）。

## P6：Gate 2E 跨 Harness/Agent 管线（2026-08-15 完成）

- [x] 已认证 capability handshake。
- [x] External progress/blocker/completion 输入适配器。
- [x] 标准日志 frontmatter renderer。
- [x] Quarantine、修复、重放和审计。
- [x] Outbox dispatcher。
- [x] WorkItem、Decision、Review、Run 当前状态和投影。
- [x] Session 指令路由；必须明确目标 Session。

## P7：Project Console 正式业务页面（2026-08-15 完成）

- [x] 所有项目总览。
- [x] 单项目 Overview / Checklist / Reviews / Agent Runs / Activity / Documents / Sessions。
- [x] 通过、驳回、评论、暂停、执行等命令。
- [x] Follow current Session / Pin Project。
- [x] typed open intent 联动 Workbench；不重复实现查看器。

## P8：Workbench 业务能力（2026-08-15 完成）

按顺序实现：

1. [x] Workspace-root Host Remote（`/__personal/workspace`，单根、有界、防穿越、防符号链接逃逸）。
2. [x] Files 懒加载树。
3. [x] 只读 Code/Markdown/Image/PDF preview。
4. [x] Outline。
5. [x] Diff/Review（双文件行级 Diff）。
6. [x] 复用现有 terminal ID 的 Workbench placement。
7. [x] 受限 Browser（http(s) 白名单 + 沙箱 iframe + 外部打开）。
8. [x] 具备 dirty/version/conflict 的编辑器（expectedSha256 乐观并发）。

自由 split、跨 pane 拖拽、Git stage/discard/commit、Office 重型预览和复杂状态恢复继续后置。

## 识图插件 @cyrus/dsh-image-vision（2026-08-15 完成，v0.2）

- [x] 聊天旁上传入口（shell.overlay 浮层）。
- [x] 全能识别：OCR + 内容描述 + UI 分析（单次视觉模型调用）。
- [x] 多家模型可配置：连接中心新增「模型服务（识图等）」连接类型，密钥加密存储、UI 只显示已配置。
- [x] 结果在聊天旁回复（可复制、可继续追问）。
- [x] 无确认直接发送；单张 ≤ 15 MiB；暂不展示费用。
- [ ] 保存到项目（P7 已就绪，后续接入）。

## 开发隔离约定（2026-08-15 追加）

- 冒烟验证只启动 `*-Smoke.exe` 改名副本（`scripts/smoke-executable.js`），进程名与真实客户端永不重名；进程清理一律按 PID（冒烟脚本自带的 terminateTree）。
- 清理残留冒烟进程用 `node scripts/kill-smoke-orphans.js`：只按「`-Smoke.exe` 进程名」或「命令行含 `dsh-desktop-smoke-` 临时目录」两个标记匹配，匹配后仍按 PID 杀，永远不碰真实客户端（`test/kill-smoke-orphans.test.js`）。
- 禁止按进程名批量杀进程（`Stop-Process -Name` 会误伤同名真实客户端）。
- 冒烟实例使用独立的 temp userData / DSH_HOME / PROJECT_CONTROL_HOME（`DSH_DESKTOP_USER_DATA` 与显式 `DSH_HOME` 现在真正生效，见 `src/main.js` 与 `test/app-flavor.test.js` 回归断言）。
- 迁移脚本 `scripts/migrate-to-fdrive.js` 不再自动删除非空目标：必须先 `--force` 确认目标只是上次中断的残留（`test/migrate-to-fdrive.test.js`）。

### 稳定版路径红线（Cyrus 2026-08-15 明确）

以下路径属于稳定版客户端，**任何自动化流程不得写入或删除**（`scripts/protected-paths.js` 强制拦截，`test/protected-paths.test.js`）：

- 安装目录：`D:\Cyrus Deepseek Harness`（含 `…\DeepSeek Harness Personal\` 全部内容与插件）。
- 稳定版数据主目录：`F:\documents\Cyrus Deepseek Harness Data`（settings、project-control、harness-home、from-test-userdata 全在内）。
- 迁移前遗留数据（保留备份，不写不删）：`%APPDATA%\DeepSeek Harness Personal`、`%APPDATA%\DeepSeek Harness Personal Dev`、`%USERPROFILE%\.dsh`。

- 冒烟脚本启动前对全部临时路径与被测 exe 做 `assertAutomationSafe` 断言（碰红线即失败）。
- `kill-smoke-orphans.js` 对引用受保护路径的进程一律跳过（即使带 Smoke 标记）。
- 唯一例外：Cyrus 亲手运行的一次性迁移脚本 `migrate-to-fdrive.js`（删除仍需 `--force` + marker 防重入）。

## 暂不做

- 不因 npm rc.6 已发布就混装依赖。
- 不修改只读上游。
- 不自动导入四个真实项目。
- 不在没有预览/备份/回滚时写真实项目。
- 不让后台事件自动展开 Workbench 或抢焦点。
- 不新增第二套终端、Details、Review 或项目状态源。
