## 2026-08-20：稳定版 v0.4.0 发布（rc.8 基线 + Workbench/Browser/导航轨收口）

- **版本与基线**：稳定版客户端升级到 `0.4.0`，Harness 运行时 `0.1.0-rc.8`（commit `141eb6f`）；18 个个人插件全部按 rc.8 重建并随包。
- **门禁全绿后打包**：全量测试 608/608、workbench 122/122、trajectory-island 5/5、`check-plugins` 通过、`verify-launch` 通过、dev/稳定版 packed smoke 通过。
- **发布物**：`artifacts/DeepSeek-Harness-Personal-0.4.0-setup-x64.exe`（约 196.4 MB）与 `-portable-x64.exe`（约 195.8 MB），含 `.sha256` 与 `.blockmap`；发布说明 `docs/release-notes/0.4.0.md`。
- **GitHub Release**：`SeeiiLee/deepseek-projectpl-console` 已发布 `v0.4.0`（5 个资产全部上传）：https://github.com/SeeiiLee/deepseek-projectpl-console/releases/tag/v0.4.0
- **发布脚本坑（已修）**：PowerShell `ConvertTo-Json` 会序列化 `Get-Content -Raw` 返回的带 ETS 附加属性的字符串为对象，导致 GitHub "Problems parsing JSON"；改为 `[string]` 强转 + `[System.Text.Encoding]::UTF8.GetBytes(...)` 显式 UTF-8 发送。上传 URL 拼接必须写 `${uploadUrl}?name=...`，否则 `$uploadUrl?name` 被 PowerShell 当作变量名解析成空串。
- **治理同步**：`docs/compat.json` 基线更新为 rc.8 stable 0.4.0；ADR-005 状态标记稳定版已随 rc.8 发布；本日志与 `docs/NEXT.md` 同步。

## 2026-08-20：测试版 Harness 升级 rc.8 + 个人插件构建链适配 + Archify 安装（治理补登记）

- **测试版运行时升级 rc.8**：commit `141eb6fef83422698aef7a981029e843e8161534`，已激活并置 `pendingHarnessActivation=true`；rc.7（`99f6f02f`）保留为回滚位。构建命令：`pnpm install --frozen-lockfile && pnpm run build`，均通过。
- **rc.8 预检适配**：rc.8 `dsh web` 默认自动打开浏览器并多打印一行，导致 readiness 解析器拒绝；`src/harness-helper.js` 增加 `--no-open`。修复后 `preflightHarnessRuntime` 通过。
- **构建链基线迁移 rc.7→rc.8**：`scripts/build-kit.mjs` 的期望版本/commit 更新为 rc.8；15 个含 rc.7 声明的插件 `package.json` 批量更新为 `0.1.0-rc.8`。
- **rc.8 tsdown 外部插件适配**：rc.8 `packages/client/tsdown.client.ts` 新增 workspace 包名校验，个人插件不在上游 workspace 导致首次构建失败；在测试版托管运行时内打本地 fallback 补丁（找不到 workspace 包名时回退读当前插件目录 `package.json`）。
- **全部插件强制重建**：删除 18 个插件旧 `lib/` 后执行 `node scripts/build-plugins.js`，全部构建通过；`node scripts/verify-launch.js` 输出 `launch-gate: tree is launch-ready`。
- **启动验证**：使用 rc.8 + 测试版 dev home 实际启动成功：`DEV_BOOT_READY http://127.0.0.1:64670/`，优雅退出 `{"graceful":true,"forced":false,"code":0,"signal":null}`。
- **Archify 安装**：`@tt-a1i/archify-dsh@0.1.0` 装入测试版 `web` profile；`dump-config` 可见 `archify-plugin`；Archify CLI smoke 返回 `"ok": true`。
- **治理补登记**：新增 `docs/adr/ADR-005-测试版升级rc8与个人插件构建适配.md`；同步 `docs/INDEX.md`；更新 `docs/compat.json` 至 rc.8 基线。完整测试套件尚未在 rc.8 上重跑，平台导出复核待办。

## 2026-08-20：工作台浏览器架构重写（webview→WebContentsView）+ 编辑器/文件树体验收口 + 公共控件沉淀

- **浏览器白屏根因实锤与路线切换**：旧 `<webview>` 无 `src` 时访客永不初始化（探针实测 15 秒 62 次方法调用全抛错）= Cyrus 看到的白屏；强制初始化（补 `src`）后宿主渲染进程直接崩（blink.mojom.Widget 拒绝访客注册，连续 6 轮冒烟复现）。纯净最小复现（同 Electron 43、同机器）一切正常——判定为壳环境与渲染进程内嵌 webview 犯冲，路线判死刑。
- **决策**：重写为 VS Code 式主进程 `WebContentsView` 叠加架构。新增 `src/browser-view-bridge.js`（create/set-bounds/navigate/go-back/go-forward/reload/get-state/capture/dispose，严格 payload 校验、http(s) 白名单、访客 window.open 一律转系统浏览器）；`src/preload.cjs` 暴露 `browserView` 子桥；`WorkspaceBrowserViewer` 改为占位 div + ResizeObserver/rAF 矩形同步。访客独立持久会话（persist:workbench-browser），前进/后退历史保留，登录态跨重启保留。
- **冒烟步骤 N 升级**：经 preload 桥等 get-state 到达目标页，主进程 capturePage 采样暗像素证非白屏；隐藏窗口无合成器表面（UnknownVizError）时自动降级为访客 DOM 探针（title/innerText 非空）。实测 `browserGuestReached=true`、`browserGuestRenders=true`，零崩溃。Cyrus 验收通过（Google/百度/Kimi 均可开）。
- **冒烟基建**：`scripts/smoke.js` 新增 `DSH_SMOKE_ELECTRON_ARGS` 环境变量透传（本次用于 --disable-gpu 对照实验，保留作通用排查钩子）；smoke 模式补 `paintWhenInitiallyHidden: true` 与遮挡检测开关（后者对崩溃无效，保留无害）。
- **MD 编辑器工具栏重设计**：整体缩至 12px，按功能 5 组竖线分隔（段落 | B/I/S/行内代码/公式 | 列表/引用/代码块 | 链接/表格/脚注/搜索 | 源码切换），全部图标化（lucide 风格 stroke 图标）；悬浮选中工具栏同套风格；categoryMenu 硬编码颜色改主题变量。
- **段落类型下拉自定义化**：原生 `<select>` 弹层在深色主题下白底白字不可用 → 换卡片式自定义下拉；按钮实时回显当前段落类型（selectionUpdate 跟踪），当前项带 ✓。顺带修复悬浮菜单项被 `.bubbleMenu button` 的 `justify-content:center` 层叠压成居中的事故（公共组件层钉死左对齐，防复发）。
- **文件树开合整合**：收起（`＞`）/展开（`＜`）合并为路径行同一位置的同一按钮，图标随态翻转；删除右侧三横杠窄轨（filesRail）及其 CSS；冒烟探针语义同步更新（railAfterCollapse → 折叠态按钮仍原位且 aria-label 翻转）。
- **公共控件沉淀**：新增 `plugins/workbench/src/client/ui/controls.tsx` + `controls.module.css`——`UiIcon`（24 视窗 stroke 图标）、`IconButton`（24 工具栏 / 26 地址栏两档口径）、`MenuDivider`、`PopupMenu`/`PopupMenuItem`（卡片式下拉，左对齐钉死、✓ 选中态、onMouseDown 保编辑器焦点）。`RichMarkdownEditor`（工具栏图标、段落下拉、悬浮类目菜单）与 `WorkspaceBrowserViewer`（地址栏五钮）已切换复用，删除三处重复 CSS。后续新 UI 一律从 ui/ 取件。
- **HANDOFF_WORKBENCH_LOCAL_FILE_IMAGE.md 登记的问题全部关闭**：根外 .md 内开（descriptor 显式 workspaceRoot 全链路 + ad-hoc 根兜底）、预览 http 外链转系统浏览器、裸域名自动补 https、文件树标题栏删除、Details 空态直给文案、白屏（见上）。
- **门禁**：workbench 单测 122/122、tsc=0、全量冒烟 SMOKE_EXIT=0。
- **追加（同日）**：新增 HTML 预览查看器 `WorkspaceHtmlViewer`（`.html/.htm`，priority 20，高于代码兜底）——本地 HTML 读到文本后进 sandbox iframe 渲染（allow-scripts 跑图表 JS；opaque origin 隔离应用数据）；顶栏复用 ui/controls 的 IconButton（刷新 / 在外部打开，绝对路径走 api.status() 根 + Windows 反斜杠口径）。已知边界：srcDoc 模式不加载 HTML 里相对路径引用的本地资源，单文件自包含 HTML 不受影响。门禁同上全绿。

## 2026-08-20：工作台 UI 批量收口（第七轮）+ 轨迹岛重写为会话导航轨

- **路径行图标化**：ContextBar 的长文本浏览目标标签（完整文件名 pill）改为 22px 文件夹图标按钮，与图钉同口径；完整路径收进 title/aria-label 悬停提示，点击行为（资源管理器打开）与冒烟探针 `data-workspace-context-target` 不变。
- **路径浮层美化**：PathPopup 行内 emoji（▸/📄）换公共 FileIcon/FolderIcon stroke 图标；行标签省略号截断；筛选框去硬边框（无边框 + 底色悬停/聚焦口径，与文件树搜索框统一）。
- **文件树四项**：长文件名不再自动换行（`.treeLabel` nowrap + ellipsis，行高回到 32px 舒展态）；搜索框去边框；按扩展名分类型图标（新增公共组件 `ui/FileIcon.tsx`：md/html/代码/图片/json/txt/pdf/目录/默认，文件树、搜索结果、路径浮层三处共用）；文件行补 chevron 占位与目录行对齐。
- **文件树可拖动分隔**：`.view` 与 `.filesDock` 之间新增 5px drag handle（col-resize，悬停高亮），pointermove 实时调宽（钳制 220–560px），宽度存 localStorage `dsh-workbench-files-dock-width`；`.filesDock` 固定 352px 改为行内 style。
- **轨迹岛废弃重写**：旧顶部悬浮胶囊（TrajectoryIsland）整体删除，重写为 Codex 式会话导航轨（SessionMinimap）——贴会话滚动容器右缘内侧的 14px 垂直细轨（按容器实测 getBoundingClientRect 定位，ResizeObserver + 轮询跟随侧栏开合/窗口缩放），每轮一条横刻度（用户轮长亮、助手轮短暗、运行中脉冲、错误红色），点击刻度沿用 jumpToChatAnchor 定位（锚点精确命中→滚动近似→比例兜底）；当前位置高亮由滚动监听 + 锚点几何计算。数据层 model.ts/jump.ts/contracts.ts 原样复用，插件包名不变（@cyrus/dsh-trajectory-island），描述更新为「会话页右侧细垂直导航轨」。
- **门禁**：workbench 单测 122/122、trajectory-island 单测（含新 layout 断言）通过、两插件 tsc=0、全量冒烟 SMOKE_EXIT=0（browserGuest 探针不受影响）。
- **追加（同日，Cyrus 验收反馈修正）**：路径浮层行距加宽（行 min-height 30px、padding 6px 9px、列表 gap 2px）、行内图标与标签对齐；导航轨刻度改为水平居中、刻度间距 3px，默认长度收到 3–4px（约为悬停 12px 的 1/3，悬停/当前位置拉长形成动态对比）；新增悬停缩略卡——悬停刻度时在轨道左侧弹卡片，显示 Turn 号 + 该轮问答内容片段（直接读聊天锚点已渲染文本，前 180 字、最多 4 行截断），复验门禁同上全绿。再修正：刻度群从「铺满整条轨道」改为「以轨道垂直中轴为中心聚集、轮次增多向上下发散」（layout 测试钉死 justify-content:center，防回归），悬停缩略卡位置改为取悬停刻度实测坐标（与刻度严格对齐）。

## 2026-08-19：R-ED Phase 2 开始——表格与链接接入

- 接入 `@tiptap/extension-table` / table-row / table-cell / table-header，工具栏「⊞」与 `/table` 可插入 3×3 表格；tiptap-markdown 自带 Table 序列化支持。
- 接入 `@tiptap/extension-link`，工具栏「🔗」与 `/link` 可设置链接；保留安全 `rel`。
- 新增 `Footnote` 节点：工具栏 `[^1]` 与 `/footnote` 插入脚注引用并在文末追加定义；序列化为 `[^n]`。
- 新增 `InlineMath` mark：工具栏 `ƒx` 与 `/sxgs` 切换 `$...$`，编辑态以 `span[data-math]` 样式显示。
- 新增“搜索选中”：工具栏 `🔍` 定位下一处选中文本。
- 浮动选中工具栏改为自定义 fixed 定位（原先 TipTap BubbleMenu 在 smoke 与实机均未出现，已替换为自行监听 selectionUpdate 的 fixed 浮层），smoke `bubbleShown=true`，并加入脚注/搜索按钮、缩小 UI。
- 表格改为悬停单元格边缘出现 `+` 插入行/列；全选整行/整列按 Delete/Backspace 删除行/列；`table-layout:fixed` 防长文本挤压。
- 脚注：行内用 Footnote node + `state.write` 原样输出避免 `\[` 转义；选中文本再点脚注会在选中文本末尾插入上标（不删除原文字）；文末自动加“脚注”小标题，并用 `FootnoteDefinition` NodeView 显示 `1: 脚注内容`（序列化为标准 `[^n]: 脚注内容`）；定义里的 `1:` 是超链接，指向文内 `fnref-n`；smoke `footnoteProbe=ok`。
- 预览模式待办/脚注：在 Workbench 插件内解决（不依赖平台 MarkdownText）：`WorkspaceMarkdownDocument` 改用插件内 `markdown-lite` 渲染器，任务列表显示 ☐/☑，脚注生成上标引用与文末脚注区；smoke `previewFeatureProbe=task=true|footnotes=true`。
- 行内公式修复：选中 `$...$` 文本再点按钮会剥离 `$` 并转公式；空选区插入公式占位；支持 `$...$` 输入规则；使用 `toggleMark('inlineMath')` 确保命令可用；smoke `mathProbe=ok`。
- 浮动工具栏“类目”改为自定义菜单：移到最前、灰底、左对齐、每项带 icon（列表/待办/数字列表/H1-H4/表格/代码块），选择后下次激活自动关闭，并缩小 UI。
- 搜索选中改为按文本节点精确映射位置，减少复杂文档偏移。
- 在 `test/fixtures/M9_DESIGN.md` 末尾追加表格/链接/脚注/行内公式/待办示例，便于 Cyrus 直接查看。
- 待继续：更完整 Wolai 斜杠命令（媒体、数据库视图等）、搜索定位精度优化。
- 门禁：单测 588/588、workbench 105/105、smoke SMOKE_EXIT=0。

## 2026-08-19：R-ED Phase 1 完成——CodeMirror 行式 live preview 切换为 TipTap/ProseMirror 富文本

- **决策背景**：CodeMirror 装饰方案已无法根本解决选区错位、标记 reveal 错乱、软换行等块级语义问题；Cyrus 确认接受 Markdown 保存时格式规范化，并确认脚注参考 wolai、版本/字节数放页脚右下角。
- **Phase 1 落地**：
  - 新增 `RichMarkdownEditor.tsx` + `RichMarkdownEditor.module.css`，基于 TipTap v2 + `tiptap-markdown`。
  - Markdown 编辑态从 `MarkdownEditor` document 模式切换为富文本；非 Markdown 文本仍走 CodeMirror code 模式。
  - 基础节点：段落、标题、列表、引用、代码块、加粗/斜体/删除线/行内代码。
  - 静态格式工具栏（H1–H6、B/I/S、行内代码、有序/无序列表、引用、代码块）。
  - 阅读偏好（字号/字体/颜色/宽度）继续通过 CSS 变量注入 `.ProseMirror`，与预览一致。
  - 版本 `sha256` 与字节数继续位于文档页脚右下角（未移动到右上角）。
- **依赖**：新增 `@tiptap/react`、`@tiptap/starter-kit`、`@tiptap/pm`、`prosemirror-markdown`、`tiptap-markdown`。
- **探针更新**：smoke 的 R-ED 探针从 `data-codemirror-editor` / `.cm-md-*` 改为 `data-rich-markdown-editor` / `.ProseMirror` 语义节点断言。
- 门禁：单测 586/586、workbench 103/103、全量冒烟 SMOKE_EXIT=0。
- **Cyrus 首轮审核反馈已修**：①富文本全文滚动（`.editor` 高度 100%，smoke 断言 `scrollable=true`）；②项目工作区保存复用通用 workspace 保存，不再提示“项目文件只读”（smoke 断言 `saveProbe=saved`，并修复通用 workspace 带 root 的 query 拼接）；③版本/字节数页脚移入正文右下角（`data-document-footer`，smoke 断言 `footerInside=true`）；④根目录测试/临时日志迁入 `cache/logs/`。
- **斜杠命令**：新增 `slash-command.ts`（基于 @tiptap/suggestion 的轻量 DOM 菜单），支持 `/h1`–`/h6`、`/p`、`/ul`、`/ol`、`/todo`、`/quote`、`/code`、`/hr`；同时接入 TaskList/TaskItem 支持待办列表。
- **Markdown 快捷键补充**：新增 `markdown-input-rules.ts`，补齐 `> ` 引用、` ``` ` 代码块、`---` 分割线；标题/无序/有序列表由 StarterKit 自带；并支持无空格形式 `#1`/`##2`/`###3`/`-1`。修复连续 `#` 被提前转换的问题（无空格标题规则改为 `(?=[^#\s])`）。
- **页脚右对齐**：编辑态页脚用 `.footer` 包裹并 `justify-content:flex-end`，smoke 断言 `footerRightAligned=true`。
- **待 Cyrus 复测**；确认后进入 Phase 2（表格/任务列表/链接/脚注/行内公式/浮动选中工具栏）。

## 2026-08-19：Cyrus 验收——方向正确、功能可用；剩余「排版对齐 Obsidian」待办（换 Session 交接）

- **验收结论（Cyrus 原话归纳）**：已经好很多；编辑态所见即所得成立、长文档可滚动全文；但**格式上仍不像预览/Obsidian 的质感，有不完善感**——剩余工作为排版逐项对齐，不再是功能/渲染问题。
- 本日根因链（全部闭环，详见前两条日志）：editLayout=split 残留 → 分屏左代码编辑器（已按用户裁决删除预览/分屏）→ Decoration.line 行装饰卡死 viewport（长文档只显示开头，已改 mark + 回归测试）→ 编辑态字体未跟随阅读字体（已注入 --wb-reader-font-family）。
- 门禁：单测 581/581、workbench tsc=0、全量冒烟 SMOKE_EXIT=0（livePreview/realFileProbe/toolbar/编辑器高度/editorReaderStyle 全过）。
- **交接**：待办清单、关键坑、CDP 验证法与用户环境事实已写入 `docs/NEXT.md` 顶部「R-ED WYSIWYG 收尾交接」段；新 Session 开工先读该段 + 本日志最近三条。

## 2026-08-19：「长文档只显示开头」根因——Decoration.line 行装饰卡死 viewport 渲染（CDP 实测闭环）

- **现象（用户实测 + CDP 复现）**：M9_DESIGN.md（289 行）编辑态只显示前 ~38 行，滚动到底渲染窗口纹丝不动（scrollTop 变化、DOM 窗口仍停在开头）；编辑器内部 doc 是完整的 11235 字符——问题在渲染层而非内容层。
- **根因**：live preview 的围栏行用了 `Decoration.line({class:'cm-md-fence'})` 行装饰——触发 CM6 measure 循环不稳定（"Measure loop restarted more than 5 times"，此前烟测日志已反复出现但短文档不显形），长文档滚动时 viewport 窗口永不更新。**二分实证矩阵**（CDP 控制变量）：无 live preview + wrap 开/关均正常；有 live preview 无论 replace/mark 装饰均卡死；把围栏行从 `Decoration.line` 换成 `Decoration.mark` 后**立即恢复**（滚到底=文档结尾）。replace 空 widget 无罪（之前误判），已恢复使用（隐藏后文本不参与复制/选中）。
- **修复**：围栏行改 `Decoration.mark`（同范围、同类名）；顺带把插件 update 条件收敛为 docChanged/selectionSet（装饰覆盖全文、与视口无关，不再在 viewportChanged 每帧重建）；回归测试断言源码中不再出现 `Decoration.line(` 实际调用。
- **探针复原**：livePreview/realFile 探针回到 textContent 断言（replace 隐藏后标记不在 textContent 中）。
- 合成夹具 README 无围栏、烟测从未滚动过长文档——两重盲区叠加导致此前全绿但用户侧持续失败。
- 门禁：workbench 单测 10/10（含新回归）；全量门禁复核中。

## 2026-08-19：「编辑还是纯代码」根因与架构修正——编辑态去预览、去分屏（用户裁决）

- **根因（CDP 实机复现）**：用户本地存储的编辑偏好为 `"editLayout":"split"`（早期设置过「分屏」），编辑态渲染分屏分支——左栏 variant="code" 代码编辑器（行号+标记+可编辑）+ 右栏只读渲染预览。用户看到/编辑的正是左栏代码。多文件「一模一样」是因为分屏对所有 md 生效，与文件内容无关；工具栏正常是因为新 bundle 已在跑。此前烟测永远绿 = 烟测夹具偏好是默认 single，从未覆盖用户真实存储的 split。
- **用户裁决（2026-08-19）**：「编辑不需要预览，所见即所得不需要预览」→ 架构修正：编辑态 = 唯一所见即所得文档编辑器（variant=document + live preview）。移除编辑态分屏（split 分支/分隔线/拖拽/usePanelWidth/useAdaptiveDebounced）、移除编辑态「编辑/预览」切换（编辑内不再有预览概念）；editLayout 偏好字段与设置卡片「编辑时布局」控件整体删除（存量 'split'/'auto' 自动失效）。非编辑态的「预览/代码」浏览切换保留（只读浏览场景）。
- **诊断方法（本轮新增武器）**：以 CDP（--remote-debugging-port）启动用户同环境开发版实例，直接读真实 DOM——确认 variant/gutters/deco 真相，结束多轮盲猜。真机验证结果：variant="document"、gutters none、cm-md-heading 存在、# /> /** 全隐藏、无分屏、无编辑内预览。
- **顺带根治的环境坑**：本 agent 进程环境继承自稳定版应用，`PROJECT_CONTROL_HOME=F:\documents\Cyrus Deepseek Harness Data\project-control` 污染了诊断启动 → 开发版抢稳定版 writer-lock → storage=unavailable（"项目数据库暂不可用"）。用户从资源管理器双击 .cmd 不受影响。project-control 存储打开失败原先**静默吞错**（degradedRuntime 不带原因），现加 console.warn 持久诊断，不再无痕降级。
- **编辑态正文字体修复**：编辑器曾继承代码字体（--wb-reader-font-family 未在编辑容器链上定义 → 落到 --wb-code-font-family，用户感观「纯代码」的排版因素）。修复：editorHost 显式注入 --wb-reader-font-family（阅读字体偏好）→ 编辑态排版 = 阅读排版。
- 探针更新：splitPreviewStyleApplied → editorReaderStyleApplied（断言所见即所得编辑器 computed 17.2px+楷体）；structure 测试反转断言编辑态无分屏/无预览切换/无 editLayout。
- 门禁：单测 580/580；workbench tsc=0；全量冒烟 SMOKE_EXIT=0（livePreview / realFileProbe / toolbar / 编辑器高度 / editorReaderStyle 全过）。
- 说明：诊断启动曾清空并已恢复用户工作台页签（BLOCKED.md/DEVLOG.md/经验.md，项目 DeepSeek Harness Personal Desktop）。

## 2026-08-18：WYSIWYG「依然老样子」根因——真实文件触发装饰排序崩溃（已复现并根治）

- **根因（Node 级复现）**：用户真实验收文件 docs/M9_DESIGN.md 中「列表行 + 行内代码」组合（如 `- ` + 行内代码 + ` 继续只负责档案读取与数学求和；`）——块级 mark 与行内 replace 在 markerEnd 处同起点，按分支顺序直接 builder.add 违反 RangeSetBuilder 的 (from, startSide) 排序约束，抛 "Ranges must be added sorted by from position and startSide"。该异常发生在 ViewPlugin 构造/更新路径 → **整个文件的装饰全部失效 → 编辑页退回纯代码形态**；合成夹具 README 无此组合所以 smoke 一直绿——用户「永远老样子」不是渲染/缓存/旧包，是内容触发的逻辑崩溃。
- **修复**：buildDecorations 改为「统一收集 PendingAdd（块级+行内）→ 按 (from, startSide) 全局排序 → 一次性入 builder」；addInline 改 collectInline（收集，不直接 add）。排序约束从根上不可能违反。
- **防御**：插件构造/更新走 buildSafe——异常内容降级为无装饰 + console.error 可诊断日志，绝不让编辑器崩溃或静默退化。
- **回归测试**：最小失败行 + M9_DESIGN.md 全文件（冻结在 test/fixtures/M9_DESIGN.md）——构建成功且含 h1/列表/引用装饰；单测 9/9。
- **烟测新增 realFileProbe**：smoke 合成项目带真实形态夹具 docs/M9_DESIGN.md，走「文件树打开 → 编辑 → 断言标题装饰存在且 # 隐藏」全流程（含清空前序搜索过滤器）。
- 门禁：单测 580/580；workbench tsc=0。冒烟复核中（前一轮遇平台 MarkdownText tile 渲染竞态 flake：renderer "Cannot destructure property 'tile' of parents.pop()"，与本次修复无关、历史日志未复现，已重跑复核）。
- **架构答疑（用户质疑）**：编辑/预览是两个独立视图——「编辑」= MarkdownEditor(document 变体 + live preview 装饰)= Obsidian 式所见即所得且可编辑，是编辑态的默认视图；「预览」= WorkspaceMarkdownDocument 只读渲染。此前用户看到的「编辑=代码、预览=渲染」是上述崩溃导致的降级外观，不是设计如此。

## 2026-08-18：R-ED WYSIWYG 全链路收口——悬浮工具条 / 围栏补全 / 布局根治 / live preview 乱序修复

- **live preview 无效果根因根治**：inlineRanges 按标记类型分四轮扫描后乱序 push，RangeSetBuilder 抛 "Ranges must be added sorted by from position and startSide"（行内标记交错时触发）→ 运行时零装饰。修复：addInline 内排序 + 重叠丢弃 + 单 range 内 replace/mark/replace 顺序校正；buildDecorations 重构为纯函数（接收 EditorState）+ 7 项 Node 单测（标题/加粗斜体删除线行内码/列表引用/围栏/挂载初期/光标暂显/围栏补全）。
- **默认即预览态**：挂载初期（无任何用户交互）无条件隐藏全部标记（revealOnCursor=false）；用户交互后转 Obsidian 语义——光标/选区落在标记范围内才暂显。标题/列表/引用/行内标记的排版样式始终生效（只有 replace 受光标影响）。围栏行 ``` 字符透明隐藏（块样式保留）。
- **选中文字浮动工具条**（markdown-format-toolbar，选中起点上方、靠顶自动放下方）：标题层级 H1–H6/正文（同层级再点还原）+ 加粗/斜体/删除线/行内代码/行内公式（toggle 包裹，再次点击解包，多光标 changeByRange）+ 链接（选中文字作链接文字、URL 预置 https:// 并选中待输入）+ [[双链]] + 脚注（自动编号 [^n]、文末追加定义行、光标落定义处）+ 代码块（整行包/解围栏）+ 搜索选中（openSearchPanel 预填关键词）。按钮 mousedown preventDefault 保持编辑器焦点。下划线/文字颜色仍因平台不渲染 HTML 未提供。
- **围栏自动补全**：```lang 行按回车自动补闭合围栏+空行（EditorView.inputHandler，零新依赖——@codemirror/autocomplete 不再需要）；纯函数 fenceAutoCloseInsert 独立模块（markdown-format-tools.ts）可单测。
- **布局根治**（rect=101x6760 → 109x626 实证）：根因 WorkbenchPanel .details{min-height:100%} 无确定高度 → .preview height:100% 退化为 auto、整体随内容膨胀、脚注随滚。修复：插件查看器加 .viewHost（确定高度链）+ .preview overflow:hidden（文件名行+滚动体+固定脚注）+ textBody/codeBlock 成为滚动体（flex:1）。smoke 增加编辑器高度 <3000 断言防回归。
- **探针**：toolbarShown（选中→工具栏出现）+ 点「加粗」→ doc 含 ** 包裹 + 编辑器 rect 高度约束；smoke 环境 hasFocus=false 佐证工具栏不依赖窗口焦点（选区驱动）。编辑器暴露 window.__wbEditorViews（仅 smoke 模式）供脚本驱动选区。
- 门禁：workbench tsc=0；单测 578/578；全量冒烟 SMOKE_EXIT=0（livePreviewHiddenMarkers / toolbarShown / 编辑器高度约束全过）。结构测试修复一处 TDZ 测试 bug（viewer 声明在使用后）。

## 2026-08-18：Markdown live preview——Obsidian 式所见即所得编辑（方向修正）

- **方向修正（用户明确）**：编辑状态 ≠ 「预览(只读渲染) + 代码(源码编辑)」两个概念；编辑默认状态 = 渲染后的 md 页面，直接在该状态下打字。
- **实现：CodeMirror live preview 装饰**（Obsidian 同原理，零新依赖）——markdown-live-preview.ts：ViewPlugin + DecorationSet 隐藏标记字符（标题 #/列表 -/引用 >/围栏 ``` 行/行内 ** * ` ~~），内容加排版样式（标题层级/粗体/斜体/删除线/行内代码底色/引用灰字）；**光标进入隐藏范围时标记暂显**（可编辑源码），移开恢复渲染——所见即所得。
- 编辑态默认单面板 = variant=document 编辑器 + live preview（markdown 语言时）；分屏模式左侧 code 编辑器保持源码形态。
- 门禁：全量绿、冒烟过。
- 下一步：选中文字悬浮工具条（B/I/S/行内代码/公式/链接/标题层级/列表/引用/代码块/搜索），``` 补全（@codemirror/autocomplete 待装）。
## 2026-08-18：编辑态文档式 md 编辑 + 布局两档 + 图标化 + 分屏右侧探针

- **编辑态默认单面板「文档式 md 编辑」**（WYSIWYG 走查修正）：MarkdownEditor 增加 variant=document（无行号、正文字体变量、1.7 行距、无活动行背景、自动换行）——点编辑直接看到「纯 md 页面」打字；分屏仅显式选择（编辑布局改两档：单面板默认 / 分屏）；分屏时左侧 code 编辑器 + 右侧渲染预览。
- **保存/放弃图标化**：保存=磁盘图标（统一普通色，不再蓝）；放弃=X 图标（尺寸缩小，无文字）；hover 提示。
- **探针实证**：编辑态分屏右侧 computed = 17.2px + "Kaiti SC", KaiTi...（楷体）生效——右侧文档同样应用字号/正文字体（用户环境差异需重启最新构建确认）。
- 门禁：全量绿、冒烟过（splitPreviewStyleApplied=true）。
- 待实施：选中文字悬浮工具条；``` 代码块自动补全（@codemirror/autocomplete）。
## 2026-08-18：偏好链路实证 + 编辑布局/自动保存/磁盘图标

- **偏好不生效排查（实证闭环）**：新增 update 路径探针（window.__wbPreferencesStore.update 走设置卡片同款路径）——真实渲染器断言 17.2px + rgb(31,31,31) 生效；面板字体探针（yahei → section computed fontFamily 含 YaHei）生效。结论：全链路无 bug；用户侧不生效需重启最新构建确认。顺带修复：标题/引用颜色改继承（文字色全局生效）；审阅容器统一设置 --wb-reader-font-size/--wb-code-font-family（代码视图也随字号/字体偏好）。
- **编辑布局改造**：第一行 = 文件名 + 右侧操作（审阅：预览/代码切换 + 编辑；编辑：磁盘图标保存 + 放弃）；正文滚动区；固定页脚 = 版本（hover 显示完整 sha256）+ 字节数。
- **自动保存**：停止输入 2s 自动保存；conflict/saving 期间暂停；Ctrl+S 手动保存仍可用；撤销（Ctrl+Z）保留可回退内容。
- **保存按钮**：换成小磁盘图标（stroke SVG，title=保存 Ctrl+S）。
- 门禁：全量绿、冒烟过（updatePath/panelFont/editor 探针全 true）。
- 待实施（下一轮）：选中文字悬浮工具条（标题层级/加粗/斜体/删除线/行内代码/行内公式/链接/[[引用/脚注/代码块/搜索选中）；``` 代码块自动补全（需补装 @codemirror/autocomplete）；下划线/字体颜色因平台 Markdown 不渲染 HTML 需说明替代（GFM ==高亮== 或跳过）。
## 2026-08-18：记忆系统架构 v4 收口——P5 统一为 Memory Intelligence Layer

- 文档范围更新：新增 `docs/P5-记忆智能层统一架构.md`，把原“P5=可选图”修正为 Context Compiler、Recall Orchestrator、四 Profile Memory Intelligence Engine、Memory Admission Controller、Observation/Procedure/Outcome；graph/Reflection 降为可选 R4 增强。
- 写入治理：保留人工确认，同时增加 A0–A4 分级；只有低风险、同项目、可确定性复核、无冲突且可撤销的内容允许 Agent 按 `policy_auto` 批准，且必须与 `user_confirmed` 分开、可降级、可批量撤销。
- 上下文治理：system/记忆按 Kernel、Catalog、Task Pack、Deep Evidence 四层装载；Recall 子代理按 Light/Standard/Deep 获取检索任务包，以总任务成本和成功率而不是首轮 prompt 最短为优化目标。
- 竞品吸收：Hindsight 用作多路召回、RRF/rerank、observation refresh 的 challenger；Letta Code 用作 History Analyzer、Memory Doctor、Reflection 和 diff/commit 审计参考；两者均不成为 DSH 构建依赖，SQLCipher 和 Project Control project_id 继续是本地事实/隔离基础。
- 路线同步：手册更新为 v4；P5 检索稿改为 R0/R1 子方案，Daydream 改为 R4 Reflection 子方案，P4/P6 路线图改为 S0→R0→R1→R2→R3→R4；商业化文档加入 Hindsight/Letta 竞争格局、Memory Diff/Doctor/Curator UI 与 BEAM 100K→500K/1M 路线。
- 当前事实保持：v0.3.0/P6-1/329 candidates/20 条盲评 GO 是已实现证据；P6-2、factual_at v5/backfill、规模召回修复和全部 P5 能力仍为待办。本文档更新没有修改运行时代码、Stable 数据、依赖、发布或远程模型配置。

## 2026-08-18：R-ED 偏好链路实证 + 编辑体验增强

- **偏好链路实证**：新增 smoke 探针（storage 事件注入偏好 → computed style 断言）——真实渲染器验证 17.2px + rgb(31,31,31) 生效（store→storage 同步→组件→CSS 全链路）；偏好 store 增加 storage 事件同步（跨标签/外部写入）。
- **文字色提示**：深色主题背景下选「深色文字」可能看不清，卡片加提示（建议「自适应」）。
- **编辑体验**：分屏右侧预览点击 → 左侧编辑器获得焦点（无缝编辑入口）；点编辑直接进编辑器（此前窄栏 md 停留在预览不可编辑——已修）。
- **用户需求评估（未实施，待拍板）**：在带格式的 md 视图内直接输入（WYSIWYG/Typora 式）需要 contentEditable + md 反向映射，工程与风险大；当前为「代码/预览双视图实时同步 + 点击聚焦编辑」。
- 门禁：全量绿、冒烟过（preferenceApplied=true）。
## 2026-08-18：R-ED 走查修复——审阅区背景/文字色/莫兰迪/字体扩充 + 编辑崩溃根治

- **背景作用域**：阅读背景与文字色从「900px 阅读列」提升到整个审阅容器（WorkspacePreviewViewer 根），文档组件透明继承；新增 readerTextColor 偏好（theme/auto 按背景明暗/dark/light/custom hex）——白背景自动深字，解决「白底白字看不清」。
- **莫兰迪色板**：paper #e8e4da（米灰纸面）、dark #33363c（灰蓝护眼）；自定义默认 #e8e4da。
- **字体扩充**：正文 +Times New Roman / Georgia；代码 +Consolas / Menlo / Courier New；面板保持 3 项。
- **编辑崩溃根治**（smoke 编辑探针复现 + 修复）："Duplicate use of compartment in extensions"——reconfigure 传入了 `compartment.of(内容)`（把自身再包一层），flatten 时同一 compartment 嵌套出现。修复：内容构造与 of/reconfigure 分离（reconfigure 只传内容）；另将 compartment 组改为每实例新建。**Node 级测试证明同 compartment 跨 state 合法**，问题只在同配置嵌套。新增 smoke 探针（点「编辑」→ 编辑器挂载 + 零崩溃断言）+ 结构防回归断言（reconfigure 不得传 of() 包装）。
- 门禁：全量绿、冒烟过（editorPresent=true、editCrash 空）。
## 2026-08-18：R-ED Step4 完成——编辑偏好设置卡片（含阅读器个性化）

- **偏好模块**（editing-preferences.ts）：类型/默认值/sanitize（字号 6–22 步进 0.1 夹取、宽度档位白名单 720/900/1080/0、hex 校验、透明度 0–100 夹取）/load/save（localStorage 键 @cyrus/dsh-workbench:v1:editing-preferences）/模块级 store（subscribe，跨组件即时生效）+ 浏览器单例；测试 8 项。
- **设置卡片**（EditingPreferencesSection，settings.section 插槽，order 46）：阅读背景（跟随主题/浅色纸面/深色护眼/自定义=色值选择器+hex 输入+透明度滑条）；阅读字号滑块 6.0–22.0/0.1 + 重置按钮；阅读宽度档位；正文字体/代码字体/面板字体（预置下拉 + 自定义 CSS font-family 输入）；远程图片提示开关；自动换行/行号开关；编辑布局（自动/始终单面板/始终分屏）；恢复全部默认。
- **应用点**：WorkspaceMarkdownDocument 通过 CSS 变量即时生效（--wb-reader-font-size/width/bg/font-family/code-font-family，CSS var 默认值与偏好默认一致）；MarkdownEditor 主题走 var（偏好变化不重建 EditorView）；viewer 编辑布局三态 + 换行/行号；WorkbenchPanel 面板字体。
- 坑：settings.section 槽类型需本地 SlotMap 合并且形状对齐平台（kind list + owner { close }）；noUncheckedIndexedAccess 下 Record 索引返回 string|undefined。
- 门禁：workbench tsc/测试绿、全量绿、冒烟过（consoleErrors 空）。**R-ED 全部完成**。
## 2026-08-18：R-ED Step3 完成——编辑态窄栏切换 / 宽栏分屏 / 预览自适应 debounce

- **布局（§8.10.2）**：usePanelWidth（ResizeObserver）判定编辑态布局——面板宽 <720px 单面板「编辑/预览」切换（复用 per-tab viewMode 记忆）；≥720px 或全屏自动左右分屏（编辑 | 预览），分隔线 pointer 拖拽（25%–75%，内存态）。
- **分屏预览用 Document Session draft**（不重新读盘）：预览侧渲染 debouncedDraft；单面板预览同。
- **自适应 debounce（§8.9.5）**：<4KB 150ms / <32KB 300ms / 更大 500ms；输入路径零等待（本地 transaction），预览异步最终一致。
- 结构测试：分屏/切换/debounce 阈值断言；门禁全绿、冒烟过（consoleErrors 空）。
- 剩余 R-ED：编辑偏好设置卡片（含阅读器个性化背景/字号/宽度，用户此前登记）。
## 2026-08-18：R-ED 第二步完成——CodeMirror 编辑器接入（Document Session 驱动）

- **DocumentSessionStore 补全**：externalText 字段（三方冲突需要外部完整文本）；resolveConflict reload 直接用外部文本实现（不再要求调用方取文本）。
- **MarkdownEditor.tsx**（§8.10.1）：直接 EditorView adapter——无 basicSetup 黑盒，显式组合 lineNumbers/highlightActiveLine/drawSelection/history/scrollPastEnd + defaultKeymap/historyKeymap/searchKeymap/indentWithTab + Ctrl+S；Compartment 动态切换 theme/wrap/语言(markdown/plain)/readOnly/行号（不重建 EditorView）；DSH token 主题（--dsw-* 变量，Personal Theme 切换自动生效）；外部文档更新只在内容不同时 dispatch（编辑循环安全）。
- **WorkspacePreviewViewer 编辑区替换**：裸 textarea → MarkdownEditor，草稿经 DocumentSessionStore（updateDraft/save/discardDraft/conflict 处理）；保存走 store（expectedEtag 409 → conflict UI：保留草稿继续编辑 / 重新加载外部版本）；dirty 联动 workbench.markDirty；保存成功后 file.sha256 更新。
- **bundle**：workbench lib/client.js 128.9KB → 1.20MB（CodeMirror 内联，gzip 3.48MB 总产物；结构测试断言无 @codemirror 外部 import/require、无 theme-one-dark、无 basicSetup import）。
- **坑**：class 方法传给 useSyncExternalStore 被脱绑定导致 #listeners 读 undefined（渲染器崩溃）——get/subscribe/has 改箭头函数字段；注释里的字样会误伤结构断言（断言用 import 形态）。
- 门禁：workbench tsc/测试绿、全量绿、构建绿、冒烟过（consoleErrors 空）。
- 下一步：窄栏（<720px）编辑/预览切换、宽栏/全屏左右分屏、Preview 自适应 debounce（渲染 draft）、编辑偏好设置卡片。
## 2026-08-18：R-ED 第一步完成——DocumentSessionStore + Resource Adapter（CodeMirror 已授权安装）

- **授权**：Cyrus 批准安装 CodeMirror 6 六包（全部 MIT，精确版本锁入根依赖）：@codemirror/state 6.7.1 / view 6.43.9 / commands 6.11.0 / language 6.12.4 / lang-markdown 6.5.2 / search 6.7.1；安装后全量测试 0 回归。
- **DocumentSessionStore**（plugins/workbench/src/client/document-session.ts）：内存态会话（baseText/baseEtag/draftText/dirty/saveState/selection/scrollTop/revision）；Tab 只引用 documentId；base 只在加载/保存成功/显式 reload 时改变；clean 外部更新自动 reload、dirty 外部更新进 conflict（externalEtag 保留）；conflict 支持 keep-draft（回 idle 继续编辑）/reload（取外部版本）；discardDraft/close；草稿与 selection/scroll 不落 localStorage、不进 Tab descriptor。
- **DocumentResourceAdapter**：load/saveText 抽象 + createWorkspaceResourceAdapter（接现有 workspaceApi，保存带 expectedSha256；W2/W5 换 Hub save 时 Store 与编辑器不感知）。
- 测试 11 项（open/编辑脏净转换/保存成功与 409 冲突/错误/外部更新两态/冲突两种解决/放弃草稿/selection+scroll+close/订阅通知/重复 open 重载/workspaceApi 适配）。
- 坑：exactOptionalPropertyTypes 下可选字段清除必须 delete（clearOptional helper）；dirty=false 时 saveState 归 saved（与磁盘一致语义）。
- 门禁：workbench tsc/测试/构建绿、全量测试绿、冒烟过。
- 下一步：EditorView React Adapter（直接 adapter、CSS token 主题、Compartment 动态切换）→ Markdown 语言 + Ctrl+S/Ctrl+F/撤销重做/行号 → 窄栏切换/分屏 → 保存冲突 UI → 编辑偏好卡片。
## 2026-08-18：W1 Step D 完成——「在工作台浏览」+ Tab 自动绑定浏览目标

- Project Header 新增「在工作台浏览」按钮（data-browse-in-workbench）：显式 setProjectWorkspace(projectId) + workbench.reveal()（Hub 在场自动转译为 follow-console，root 由 Hub 索引解析）。
- Workbench open() 强化：Tab 打开时未显式指定项目 → 自动绑定当前浏览目标（hub 投影 projectId）——从项目文件树/浏览目标打开的预览自动固定到自己的项目根，切换控制台/会话不失效；显式指定仍优先；无投影不绑定。测试 +1。
- project-control 跨插件类型：workbench-client.d.ts 本地声明补 reveal()（跨插件 @cyrus type-import 在本仓库无法解析，本地结构面是既有约定）。
- 坑：管道后 $LASTEXITCODE 反映的是管道末命令（Select-Object）的退出码——之前 PC_TSC 的 0 是假象；typecheck 结果一律落盘读真实退出码。
- 门禁：全量绿、构建绿、冒烟过。W1 全部完成（Step A-D）。
## 2026-08-18：W1 走查修复三连——viewMode 记忆 / 命令路径匹配丢失 / 会话根显式化

- **问题 3（预览↔代码被切换重置）**：WorkspacePreviewViewer 的 viewMode 由组件 state 承担，加载 effect 在 path/api 变化时重置默认值。修复：per-tab 内存记忆（Map<tabId, mode>，不落持久化，符合 §8.10.2「用户选择保留为 UI 偏好」）；加载 effect 不再碰 viewMode；切换 Tab/会话/项目保持用户选择，无记忆时 md→预览、其他→代码。
- **问题 4（点固定后文件树变 C 盘）**：根因 = hub 命令路径（pinMount/setMode/clearPin/setConsoleProject）的重算用裸 projectInputs，**丢失 follow-session 的项目匹配**；pinMount 第一步重算就把匹配丢掉，后续快照全错。修复：抽出 withProjectMatch 纯函数，ProjectIndex 与命令/订阅共用；client apply 统一 currentInputs()。
- **问题 5（非项目会话显示 C 盘）**：会话工作区 API 的 Host 根是固定值。修复（过渡方案，W2 收紧 handle registry）：workspace-remote 支持显式 root 查询参数（存在性+目录校验、containment 基于显式根、save 同支持）；createWorkspaceApi 支持 root 选项；useWorkspaceApi 三态（项目 API → 会话根 API → 默认 Host 根）。测试 +2（显式根读/status/ROOT_INVALID/越界）。
- 门禁：hub 41/41、workbench 61/61、全量绿、构建绿、冒烟过。
## 2026-08-18：W1 Step A-C——三模式接线 + Task D 紧凑索引（修复 follow-session 文件树根错位）

- **Step A/B（workbench 消费 Hub）**：contextLink.ts 订阅 workspace-hub Context → 投影（模式/状态/主 Mount/项目）；setProjectWorkspace/clearProjectWorkspace 转译为 follow-console/follow-session（Hub 在场）；新增 setWorkbenchMode/toggleWorkbenchPin；Panel Header 加三模式 Context Chip 栏（[跟随会话 ▾][目标][状态][固定]，Hub 缺失不显示）；projectWorkspaceLink 停用（文件保留）。workbench manifest 声明 Hub 必需依赖并重生成 plugin-set.lock.json。测试 +8（context-link/service 转译）。
- **用户走查暴露真 bug**：W1 停用旧联动后，follow-session 文件树落到 C 盘 AppData——根因：会话工作区 API 的 Host 根是固定值（DSH_WORKSPACE_ROOT 未设时 = harness 运行时目录），不随当前会话变化；旧版靠 projectWorkspaceLink 的「会话→项目根匹配」掩盖了这一点。
- **Step C（Task D）修复**：project-control 新增 GET /projects/workspace-index（一次返回全部已登记项目的 projectId/root/updatedAt，替代 N+1）+ ETag 条件请求（"wsidx-<指纹>"，304 零更新）；workspace-hub 新增 projectIndex.ts（拉取 + 指纹/ETag 缓存 + 并发单飞 + forceRefresh）与「会话工作区→项目根」匹配（与旧联动同规则：相等/包含/分隔符边界/最长根优先），匹配结果作为 Context 投影建议（resolvedProjectId + mount.path=项目根，不写库不建绑定，W3 正式化）；reducer 增加 projectRootMatch 轴。测试 +10（projectIndex 7 + adapter 匹配 2 + reducer 1 + project-control http 1）。
- **行为语义**：follow-session 下切会话 → 文件树跟随会话（会话工作区命中项目根 → 走项目 API，根正确）；未命中项目 → 回落会话 API（Host 根）；已打开的预览/审阅 Tab 保持固定（设计行为，防同名串根）；控制台「打开控制台」已自动走 follow-console 转译。
- **坑**：strip-only 模式不支持 TS 参数属性（constructor(private ...)）；etag 304 测试不能用 json 解析 helper；meal_trackerX 命中 workspace 项目根是正确行为（分隔符边界针对具体项目根）。
- 门禁：hub 40/40、workbench 60/60、全量测试绿、构建绿、dev 冒烟 18 插件通过。
## 2026-08-18：W0 Workspace Hub 骨架 + R-PV1 Markdown 排版完成（架构书双线首批）

- **W0（新插件 @cyrus/dsh-workspace-hub，从出生即标准 bundle）**：Task A 骨架 + Task B Context Reducer + Task E 影子对比。
  - contracts.ts：WorkspaceContextSnapshot / WorkbenchTargetMode / Mount / revisionKey（内部语义签名）/ WorkspaceHubClient 服务面（W0 子集）。
  - reducer.ts（纯函数，12 项测试）：follow-session / follow-console / pinned 三轴互不混淆；status 稳定态 unbound/missing/ready（conflict/untrusted/degraded 留 W2/W5）；同语义返回原引用、变化单调 revision+1；pinned 只接受已解析 mount（未知 pin → missing）。
  - adapter.ts（7 项测试）：订阅 sessions.list/workspaces.list 投影 currentSession+nativeWorkspace（工作区成员优先于 cwd）；100 次切换无重复订阅/泄漏；dispose 后不再触发；影子对比只读观察旧 workbench 绑定（reflect.get('workbench', false)），差异仅 console.warn 不切换。
  - Host 侧 W0 最小骨架（无资源能力，W2 上 Resource Host）；无 UI、无数据库写（结构测试断言无 fetch/writeFile/localStorage/value-import）。
  - 接线：personal-plugins.js 18 包、共享 overlay 加 row、smoke 自动纳入；全量 512/512、冒烟 18 插件通过。
  - **坑**：cordis Context 的 module augmentation 放 contracts.ts 会破坏实例类型（effect 消失）——必须放 apply 所在文件（workbench 同款）；exactOptionalPropertyTypes 下可写目标对象字段用显式 undefined；reflect.get 读他人服务必须传 strict=false。
  - compat.json 已更新为 rc.7 基线事实（active 99f6f02f / rollback 47f9438 / 18 插件 / verified platform exports / 基线决策记录）。
- **R-PV1（Workbench Markdown 排版）**：复用平台 @deepseek-ai/dsh-client-ui-primitives 的 MarkdownText/CodeBlock，不新增任何解析/高亮依赖。
  - 新模块 markdown-heading.ts（heading identity = contentHash+ordinal+normalized text；远程图片保守检测仅作「可能联网加载」提示，绝不阻断）；WorkspaceMarkdownDocument.tsx + scoped CSS（容器内标题定位 scrollIntoView + IntersectionObserver 当前章节回调；:global 仅容器后代选择器）；R-PV1 不传 fileMentions（无 N+1 探测，R-PV2 接 Hub statMany）。
  - fixture 集 7 份（中英混排/GFM 表格任务/嵌套列表脚注/数学公式/长代码/raw HTML 危险链接/Unicode 路径）。
  - 集成：WorkspacePreviewViewer 的 md 预览分支换为 WorkspaceMarkdownDocument（预览/代码切换、256 KiB 截断、编辑保存路径不变）；workbench package.json 增加 ui-primitives peer + tsconfig project reference（d.ts 相对源码引用需引用项目才能干净 typecheck）。
  - 测试 9 项新增（身份/哈希/远程提示/fixture 齐备/无第二套解析栈/bundle 纯净：lib/client.js 无 react-markdown/remark/rehype/katex/prism）；workbench 53/53；全量 521/521；冒烟通过；bundle 128.9 KiB（较基线 130.0 略降，markdown-lite 退出预览主路径）。
  - markdown-lite.tsx 保留未删（16.2 迁移纪律：删除条件未满足）。
- **待人工走查（R-PV1 验收）**：420px/全屏/100-150-200% DPI 排版；四个真实项目各一份 Markdown 走查；远程图片提示与危险链接行为确认。
- **遗留**：W1 三模式 UI 接线（Header Context Chip、在工作台浏览、Task D 紧凑索引）；共享 patch 降级 + PERSONAL_PLUGINS 退役；其余 14 包 bundle 化（已登记待办）。
## 2026-08-18：D0 分发地基开工——rc.7-only 基线迁移 + PoC A/B 通过 + 合同冻结

- **基线决策（Cyrus 拍板）**：① rc.7-only（17 包 peer/构建合同迁到 rc.7，回滚 rc.5 时 Personal 插件降级停用）；② 仅本地 .tgz 分发（不注册 npm）；③ PoC A 按计划开工。
- **合同冻结**：protocol/personal-plugin-contract/v1/——dshComposable/v1 与 preset-lock schema（含 valid/invalid 示例，Ajv strict 校验）；scripts/check-bundle-identity.js（name=handoff=row + dsh.bundle 门禁，7/7 测试）：基线 0/17 bundle、handoff 全对、row 全短名 → 本轮后 anysearch/shell/workbench 3 包 ready。
- **build-kit（scripts/build-kit.mjs）**：构建根解析 = DSH_SOURCE_ROOT 显式（校验 commit 99f6f02f + version 0.1.0-rc.7 + tsdown 在位）或开发版 update-center.json activeHarnessRoot，缺失 fail closed；仓库根 harness-src junction（gitignore 的 dev seam，check-governance/preflight 已跳过）承载插件 tsconfig/tsdown 相对引用。build-plugins/check-plugins/smoke 全部接入。
- **rc.5→rc.7-only 迁移**：17 包 tsconfig/tsdown `../../../Deepseek Harness` → `../../harness-src`，peer/version 0.1.0-rc.5 → 0.1.0-rc.7；**17/17 typecheck 对 rc.7 全绿**（无 API 破坏）；bundle 全部重建；verify-launch 绿；check-governance 绿（refs/ 第三方参考克隆加入跳过——既存问题，此前未跑该门禁）；全量 **487/487**；dev Electron smoke 绿（rc.7 运行时 + 17 插件 + 探针全过，修复冒烟默认指向 rc.5 源码树的基线偏差）。
- **PoC A（anysearch 叶子）**：bundle 化（dsh.bundle.patch + 单 row 全名 id/name + MIT LICENSE + README 脱敏 + files 白名单 7 文件，pack dry-run 无个人路径，SHA-256=D231FFAF…8358）；干净 DSH_HOME + 官方 `dsh plugin --profile web add <tgz>`（pnpm shim 前置）→ 依赖入 profile、reconcile 自动入 bundles；冷启动 readiness 正常、loader.entries() 显示 include:@cyrus/dsh-anysearch **fiber=ACTIVE**（searchProviderId=deepseek-official 属预期：provider 选择是 suite 配置层职责）；remove → bundles 回退、依赖与 node_modules 清除；PoC home 零 checkout 引用。
- **PoC B（shell+workbench 必需组合）**：双 bundle（shell=adapter；workbench=core + requires.packages=[@cyrus/dsh-personal-shell]）；scripts/plugin-installer.mjs（dshComposable 感知 installer/doctor：graph/add-check/remove-check，7/7 测试）——**remove-check shell 拒绝**（依赖者 workbench 在位）、workbench 放行；冷启动双 fiber=ACTIVE。官方 CLI 裸 remove 不拦截（pnpm forwarder 性质），闭包门禁由本层承担（ADR-09 B）。
- **D0.6 生成器**：scripts/generate-plugin-set.mjs（collect/buildInstallOrder 依赖先行+环报错/packPlugin npm pack+sha256/computeLock/--check，4/4 测试）；已生成 **plugin-set.lock.json**（17 包、无个人路径、compatibleHarness=rc.7；workbench 带 requires）→ schema 校验通过、--check 一致。
- **坑**：PowerShell here-string 写 JS 探针会因转义产生坏文件（改用 write 工具）；spawnSync('npm') 在 Windows 必须 shell:true（npm.cmd shim）；loader 挂载证据应以 loader.entries() 为准（ctx.web.searchProviders 空 ≠ 未挂载，registerProvider 走 ctx.effect）；`cmd /c dir /s /b` 在沙箱会卡死（改用 node 遍历）。
- **遗留（下轮）**：共享 cordis.patch.yml 降为生成产物 + PERSONAL_PLUGINS 退役（改启动链，需完整 smoke）；其余 14 包 bundle 化；installer 接 --apply（现为只读门禁）；W0 Workspace Hub 与 R-PV1 Markdown 双线开工。

## 2026-08-18：架构书 v5——独立分包与开箱即用复核

- Cyrus 补充硬约束：插件必须能独立分包、依赖感知地拔插，并让其他 rc.7 DSH 用户无需 Personal checkout 即可安装使用。Codex 复核 DSH-F 后接受方向，但否决“当前已接近可分发”的隐含前提。
- 实测基线：`plugins/` 有 17 个 package，17/17 `private:true`、0/17 声明 `dsh.bundle.patch`；激活仍依赖共享 `plugins/cordis.patch.yml` 与启动器 `PERSONAL_PLUGINS`；7 个包存在 `@cyrus/*` Client/peer 边；若干能力直接读取 Personal Electron bridge。因此当前是源码目录分包，不是标准 DSH 可安装插件。
- 架构书升级 v5：标准 DSH Bundle、稳定 package/handoff/row 身份、显式必需依赖、可选 Bridge、Core/Adapter/Preset 角色、Stock DSH/Personal Desktop 支持矩阵、包外数据与卸载保留、`.tgz` 干净 Profile 验收。
- 新增 D0 前置门禁：AnySearch 叶子包 + Shell/Workbench 依赖组合两类 PoC；官方 `dsh plugin --profile web add/remove/update` 为底层，插件集合变化后重启，不承诺 Client 热插拔。D0 通过后才进入 W0/R-PV1。
- 修正文档结构：原 §23 被插入 §13.3 Approval 中间，已移到全文末尾并改为 v5 开工指引。

## 2026-08-18：架构书 v4（Codex 调优版）——DSH 复核通过，待新 Session 开工

- v3（DSH 修订：rc.7 基线 + 编辑器/预览并行）经 Codex 调优为 v4：核心变化 = 不装 react-markdown 栈，复用平台 @deepseek-ai/dsh-client-ui-primitives 的 MarkdownText/CodeBlock（GFM/KaTeX/Shiki/文件提及）；编辑器经 DocumentSessionStore + CodeMirror 6 直接 EditorView 接入。
- DSH 实测验证 Codex 全部关键主张：ui-primitives 导出齐全且位于 PLATFORM_MODULES（client bundle 共享 external）；rc.5/rc.7 的 MarkdownText/render/CodeBlock/highlight 源码哈希一致；compat.json 不存在（W0 必须创建）；插件 manifest 确实仍精确声明 rc.5（双基线问题成立）。
- C-28 验证清单全部通过或为实施期验收项；无阻断问题。两个待裁决：① 双基线策略（DSH 建议 rc.7-only，回滚 rc.5 时 Personal 插件降级停用）；② CodeMirror 依赖安装授权（R-ED 阶段，根 lockfile 锁定 + 版本一致性测试）。

## 2026-08-17：Harness rc.7 更新走备用方案完成——手动构建托管运行时 + 标记 prepared

- 更新器 prepare 在 pnpm 步骤静默失败（cmd.exe 退出 4294963232，stderr 为空）：沙箱完整环境复现 rc.7 安装+构建均成功（install 38.7s / build 2.33s，exit 0），定位为更新器执行上下文（cmd 包装/最小环境）问题；环境允许列表已补 HOME/APPDATA 系变量（9426ee4）。
- 备用方案：临时目录完整 clone（core.longpaths）+ pnpm install + pnpm run build → 冒烟预检通过（rc.7 运行时 + 17 插件 passed:true）→ 移入 `%APPDATA%\DeepSeek Harness Personal Dev\harness-runtimes\99f6f02f…` → update-center.json 写 prepared 状态（root/commit/repository）。
- 待 Cyrus 在更新中心点「激活」重启切换；激活后 previousHarnessRoot 记录 rc.5 支持回滚。

## 2026-08-17：盲评通过（P6-2 质量 GO）+ 0.3.1 推迟 + 下一主线：工作台/控制台完善

- Cyrus 盲评随机 20/329 条试点候选：**满意，可按此质量提取**——P6-2 全量提取质量门槛通过（GO），但**执行推迟**：先完善工作台/控制台功能，再发 0.3.1（含 factual_at v5 + 回填 + P6-2 全量一起）。
- 工作台 MD 现状（实测代码）：预览 = 自研 renderMarkdownLines 只读渲染；代码视图 = 纯 pre；编辑 = 裸 textarea（无高亮/无行号/无分屏/无快捷键），有 sha256 版本冲突保存 + dirty 标记；WorkbenchPanel 注释确认「Monaco 与编辑能力后续接入」尚未做。
- 候选时间戳：盲评表 `docs/Codex试点盲评-2026-08-17.md` 已存仓；329 条候选的 factual_at 回填待 0.3.1 发布后执行（守卫脚本已就位）。

## 2026-08-17：Codex 提取试点（修订版 B）完成——正式版落库 329 条候选

- 会话选择（修订版 B，避开 fork 同源）：07-29 主根（539,860 字符/1072 轮）+ 07-25 最早根（17,353）+ 08-14 最新（10,587），共 173 批。
- 实测成本：**¥0.704**（缓存命中后远低于全未命中估 ¥1.03；预算上限 ¥2 未触发），调用 173 次，candidate 产出 329 条全部写入正式库（rejected=0），带 codex:// 证据、14 天 TTL。
- 密钥解析坑：cyrus-keyring 中 DeepSeek 密钥名为 `api.deepseek.v4.key`（非 DEEPSEEK_API_KEY）；脚本经 keyring_tool.py get 取用，不落盘不打印。
- 试点工具 scripts/codex-pilot-extract.mjs：3 会话确定性选择（最大根/最早根/最新）+ 官方 API + 预算闸门 + 断点 + 稳定库 MemoryService 直写候选；可复用（改 BUDGET/会话选择即续跑）。
- 抽样质量抽查（前 8 条）：N1 拍板 1A2A3A4A、unittest 误触付费 API 教训、Session 自报 PASS 需独立复跑、Git 卫生检查等——类型分布 project_fact/event/pattern 合理。
- 下一步：Cyrus 盲评接受率；通过后按验收结论调提取合同（如需）再进 P6-2 全量（全量 198 会话 ≈ 580 批量级、估 ¥2.5–4 区间）。

## 2026-08-17：v0.3.0 统一发布完成——记忆系统全量上线稳定版

- 发布内容：P4 本地嵌入 + hybrid 默认开、P6-1 稳定化硬门、P6-0C Codex 导入工具、启动加速/白闪收口、工作区联动、审阅页签持久化、固定端口、窗口边界记忆等（含 Cyrus session 全部修复）。
- 发布前门禁：全量 458/458、四插件 tsc 干净、build+check 插件过、dev 打包冒烟过、stable 打包冒烟过、preflight-publish 通过（零密钥/会话/数据库）。
- 模型落地：干净版（manifest SHA-256 三件一致 `0826f8c1…0b77d`，MIT 许可）复制至稳定数据根 `F:\documents\Cyrus Deepseek Harness Data\models\bge-m3-onnx` 并复验 PASS（9 文件 559.6MB）。
- 发布：tag `v0.3.0`（release id 371806392，公开），资产 5 件（setup + portable + 2×sha256 + blockmap），GitHub digest 与本地产物逐一一致；正文与 docs/release-notes/v0.3.0.md 完全一致（node 复验）。
- 坑：PS 5.1 Invoke-RestMethod 发 JSON body 按 Latin-1 编码致 400，ConvertTo-Json + UTF-8 文件 → 422；改用 node JSON.stringify + curl --data-binary 成功；读回响应需 node 解码 UTF-8（PS 控制台显示乱码是显示层，非数据层）。
- 下一步：稳定版应用内「检查更新」→ 升级 0.3.0 → 首次启动确认 hybrid/页签/窗口记忆 → 正式版试点 20 会话（待 Cyrus 安排）。

## 2026-08-17：白闪确认收口 + 打包前准备核查

- 用户实测确认：白闪已从「白底 HARNESS 转圈」变为「深色 HARNESS 转圈」，接受现状，白闪排查收口（根因 = 隐藏窗口残留旧帧，见上一条）。
- 打包管线核查（今天全部改动的覆盖情况）：
  - src/**（main.js 窗口/端口/引导窗、desktop-settings.js、window-bounds.js、harness-helper.js、harness-process.js）→ build.files「src/**/*.js」已覆盖；引导页为 data URL 无新增资产。
  - 插件 lib/（已重建）、migrations、templates → build.files「plugins/*/lib|migrations|templates」已覆盖；新建源文件（projectWorkspaceLink.ts 等）只进 bundle，不进包。
  - scripts/（build/verify/stage）为开发工具不进包；boot-error.log 运行时产物已被 .gitignore 覆盖。
  - 修复一处打包隐患：memory package.json files 停在 0003，漏掉 0004_project_reset.sql，改为 migrations/*.sql 通配（与 project-control 一致）。
  - 稳定版模型缺失：F:\documents\Cyrus Deepseek Harness Data\models\bge-m3-onnx 不存在（开发版已有）→ 稳定版打包后嵌入默认关闭，模型入包/数据根落地属统一发布轮，需按 PUBLISHING_RULES 干净版 + SHA-256 校验执行。
- 建议打包顺序：先 pack:dev:dir + packed smoke + 走查，再 stable（自动跑 preflight-publish 门禁）+ packed smoke + stage-releases。

## 2026-08-17：白闪定位到「隐藏窗口残留旧帧」——引导期深色兜底 + 显示前强制新帧

- 用户走查确认：白闪发生在约 8 秒后切入 UI 的瞬间，闪的内容是「白底 + HARNESS 转圈」的原生加载卡。根因：真实窗口在隐藏期间先画出了 harness 引导卡（主题变量注入前背景为白色兜底值 #f9fafb），show() 时 Electron 把这张隐藏期旧帧呈现出来，随后才补上新 UI 帧——DOM 已就绪（waitForHarnessUi 通过）但合成器表面是旧帧。
- 修正（src/main.js，双保险）：
  1. 引导期深色兜底：harness 页面 dom-ready 时 insertCSS（html/body 与 #root 引导卡深色、文字浅色；用结构选择器避开哈希类名），UI 就绪后 removeInsertedCSS——只覆盖引导卡阶段，不影响任何主题。
  2. 显示前强制新帧：waitForThemeApplied 后执行 rAF 双帧等待 + webContents.invalidate()，确保 show() 呈现「当前 UI」帧而非隐藏期残留。
- 验证：全量 458/458；冒烟 passed:true。

## 2026-08-17：白闪根因修正——首帧呈现与隐藏窗口绘制

- 此前白闪并非主题/时机问题，而是 Windows 上「窗口显示早于渲染器首帧」的经典现象：原生窗口面先以白色呈现，直到渲染器交出第一帧。修正两处：
  - 引导等待窗改为监听 ready-to-show 后才 show()（1.5s 兜底），保证首帧（深色加载页）就绪才显示。
  - 真实窗口启用 paintWhenInitiallyHidden + backgroundThrottling:false：隐藏加载期间持续绘制，show() 直接呈现已绘制的真实 UI，而非白色空面；showMainWindow 前 invalidate() 强制重绘一帧；切换顺序改为「先显示真实窗、再关引导窗」，任何时刻都有已绘制窗口面。
  - 冒烟窗口（全程隐藏）不开 paintWhenInitiallyHidden，避免无谓绘制成本。
- 验证：全量 458/458；冒烟 passed:true。

## 2026-08-17：启动加速——引导等待窗 + 启动器增量构建 + 启动耗时实测

- 实测启动耗时（boot-error.log 埋点）：Electron 启动后 harness 引导约 8.0s（页面加载 +0.4s、客户端 UI 挂载几乎瞬时）；此前窗口在 harness 就绪后才创建，8 秒里桌面上没有任何窗口 → 「启动慢」的主要来源。
- 引导等待窗（src/main.js createShellWindow + loadingPageUrl）：应用启动即以恢复的窗口边界显示深色启动页（旋转指示 + 「正在启动 DeepSeek Harness…」，data: URL，无打包资产）；harness 就绪后在隐藏的真实窗口加载页面，UI 就绪且主题应用后才整块切换并关闭引导窗——启动即有反馈、无白闪、无 HARNESS 加载页闪烁。冒烟路径不变。
- 启动器提速：scripts/build-plugins.js 新增 isFreshBuild——产物（lib/index.js、lib/client.js）比全部输入（src/**、package.json、tsconfig.json、tsdown.config.ts）新则跳过 tsdown 重建（6.3s → 0.7s）；scripts/verify-launch.js 校验并行化（2.4s → 0.4s）。开发版每次启动的启动器开销从约 8.7s 降至约 1.1s。
- 实验记录：去掉 tsx 加载器（DSH_DESKTOP_NO_TSX 试验）harness 无法引导（上游依赖 tsx 转换），已回滚；harness 引导 8s 属上游引导成本，本轮用等待窗覆盖，后续如需进一步压缩需上游引导剖析。
- 修复：appendBootLog 在 ESM 下用 require 静默失效（boot 日志从未落盘），改为 appendFileSync + import.meta.url 定位。
- 验证：全量 458/458；冒烟 passed:true（两次，含引导窗改造后）；boot 埋点确认 harness-ready 8.0s / page-loaded +0.4s / ui-settled +0.03s。

## 2026-08-17：修复启动白闪与审阅页签启动失忆

- 白闪修复：窗口显示时机改为「主题呈现器写入 colorScheme 之后再 show」——首帧底色在主题变量注入前是白色，早显示即白闪；waitForThemeApplied 轮询 documentElement.style.colorScheme（超时 3s 兜底，不阻塞启动）。窗口本身的 backgroundColor '#111318' 保留。
- 审阅页签启动失忆根因（用户走查发现）：WorkbenchController 构造时即从 localStorage 恢复页签，而插件查看器（预览/文件树/浏览器等）此时尚未注册，canRestore 全部落空 → 已打开的审阅页签在恢复时被当成未知查看器过滤，且干净的存储立即写回，页签被永久丢弃。修复：查看器注册改为在构造控制器之前同步完成（registry 先建、六个查看器先注册，disposer 在服务 effect 拆除时统一释放；构造器接受注入的 registry），恢复时全部查看器就绪。回归测试：预注册查看器 + 带 workspaceProjectId 的预览页签从存储恢复后仍存在且保持激活、存储不被清洗。
- 验证：workbench 38/38；全量 458/458；tsc 干净；build:plugins 通过；冒烟 passed:true。

## 2026-08-17：审阅页签跨会话/跨控制台存活 + 固定 Web 端口修复渲染层状态失忆 + 搜索框路径化

- P1/P2 走查反馈修正：审阅页签不再绑死打开它的会话——
  - 快照改为合并投影（固定页签 + 当前会话页签 + 全局页签），全局页签在任何会话下可见；未指定 scope 的 open 意图恢复默认全局；会话切换时激活页签若在全局 scope 则保持激活（审阅不被打断，测试断言跨会话激活存活）。
  - 预览页签携带 workspaceProjectId（打开自项目工作区时，文件树/搜索结果/路径栏悬浮窗透传）；预览与路径栏按页签自身项目根解析（useWorkspaceApiFor），不再依赖「当前绑定」——控制台返回总览/进入其他项目后，已打开审阅不再报「目标不是文件。」。字段进持久化 schema（sanitize/serialize，旧记录兼容）。
  - activateTab/markDirty/closeTab 在合并页签列表上跨 scope 定位。回归测试 +4，workbench 31/31。
- P3：文件树搜索框占位符改为工作区根路径（搜索框本身即显示路径，去掉了下方路径底色条）；搜索框字号统一 14px（与树行一致）。
- P4 根因修复：harness 以 --port 0 随机端口启动，每次 origin 变化导致 localStorage（会话选择/布局偏好/工作台页签/控制台偏好）每次启动清零。现在按 flavor 固定端口（开发 50681 / 稳定 50682，冒烟保留随机隔离）；会话/工作区/项目控制台状态随 origin 稳定自动跨启动持久（上游 dsh.sessions.current 等持久化即生效）。
- P4：窗口边界恢复抽为纯模块 src/window-bounds.js（尺寸/位置钳制到可见显示器、最大化标记），+6 测试；退出路径（托盘退出、窗口已隐藏）兜底保存窗口边界。项目控制台新增 consoleProjectId 持久化：重启恢复上次打开的项目控制台（项目已删除时回落总览）。
- 验证：全量 457/457；workbench/project-control/personal-shell tsc 干净；build:plugins 通过；冒烟 passed:true。

## 2026-08-17：原生侧栏工作区→工作台文件树联动落地 + 审阅页签/字体/布局四连修

- 联动实施（方案 docs/原生工作区-项目联动-方案.md，Cyrus 确认 ①A「标题只展开/折叠不触发」②A「跨项目会话自动跟随」）：
  - workbench 客户端新增 projectWorkspaceLink.ts：订阅 ctx.sessions.list + ctx.workspaces.list，当前会话工作区路径变化即重算；项目根来自只读 Host API（/projects + 按 updatedAt 缓存的 /projects/{id}/workspace/status，无 Host 改动、不写数据库）。
  - 路径匹配：大小写不敏感、去尾分隔符、分隔符边界前缀、最长根优先；命中 → setProjectWorkspace，未命中/无会话 → clearProjectWorkspace；拉取失败保持现有绑定；拉取期间控制台改写绑定 → 放弃本次应用（last-write-wins，按 projectWorkspace 字段引用比较，不随页签发布误判）。
  - 实现位置偏离方案文字（personal-shell → workbench）：绑定状态所有者在 workbench，避免 shell→workbench 反向耦合与启动竞态，已在方案文档标注。
  - 测试 +12：归一化/边界前缀/最长根/workspace 成员优先于 cwd/缓存命中/updatedAt 失效重拉/失败保持绑定/改写守卫/dispose。
- P2 修「审阅页签打不开」根因：未指定 scope 的 open 意图原先固定落全局 scope；会话从空白转非空白后，文件树/路径栏/控制台打开的预览等页签落进不可见的全局 scope，工作台只剩 Details 空占位（“详情：点击消息流中的工具行查看详情”）。现在默认 scope 跟随当前激活 scope（有会话→会话页签；无会话→全局页签），5 个意图入口去掉显式 scope:'global'。回归测试 +2。
- P3 文件树排版与原生侧栏工作区统一：treeRow 14px/20px、32px 行高、8px 圆角；搜索结果行 14/20 与 12/17（上游 Rows.module.css 口径）。
- P4 启动布局：窗口边界记忆（desktop-shell.json windowBounds：resize/move/maximize 防抖 400ms 落盘 + 关闭时同步保存，恢复时钳制到可见显示器、支持最大化恢复；冒烟固定 1380×900 不受影响）；工作台默认宽度 420→640；文件树 dock 264→352（+1/3）。
- 验证：workbench 29/29、personal-shell 14/14、desktop-settings 5/5、全量 449/449；workbench/personal-shell/project-control 三插件 tsc --noEmit 干净；build:plugins 通过；冒烟 passed:true。
- 待开发版走查：侧栏点食溯/量化/非项目会话 → 右树分别切 meal_tracker/量化根/回会话工作区；重启后窗口尺寸与工作台宽度保持上次状态。

## 2026-08-17：试点落点修订（Cyrus 拍板）——统一发布后在正式版上做

- Cyrus 指出：正式版才是食溯项目的实际开发环境；在开发版全跑试点、候选进开发库没有意义（不会被使用），还会造成跨库迁移成本。
- 修订：P6-0C 试点与 P6-2 全量导入整体移到统一发布之后、在正式版上执行；开发库不写食溯候选；路线图文档已同步（试点 20 会话、¥0.5 上限、空闲时段不变，落点改为正式库）。

## 2026-08-17：P6-0C 试点提取器完成——memory_import_codex 工具 + 有界提取管线

- 新增 plugins/memory/src/core/codex-import-extractor.ts：readStagingPackage / locatorTextReader（按 codex://locator 懒读源文件，绝不复制正文）/ sampleSessions（LCG 确定性混合采样：最新/最老/最大）/ buildBatches（4000 字符/批 + 12 字符预筛）/ isOffPeak（北京 9-12、14-18 高峰闸）/ callCostYuan（官方空闲价：命中 0.05 / 未命中 1.5 / 输出 4.5）/ runExtraction（顺序限速、预算硬上限、断点续跑、重试≤3、usage 优先供应商口径）。
- 新工具 memory_import_codex：dry_run 默认 true（零成本零写入，报抽样/批次/成本预估）；正式运行 fail closed 三连（必须 project_id + 项目已登记 + DEEPSEEK_API_KEY 已解析），budget 0.1–5 元硬上限，只写 candidate + llm_extracted + codex:// 证据，候选仍须人工确认才 active。
- 修 2 个真实缺陷：runExtraction 未透传 projectId 导致 scope=project 候选被 parse 全丢；extractCandidates usage 的 exactOptionalPropertyTypes 溢出。测试 6 项新增（抽样确定性/切块/时段/成本/假 fetch 预算+断点/文本读取）。
- 成本预估（scripts/codex-extract-budget.mjs，官方空闲价）：全量食溯 580 调用 ≈ ￥3.42；试点 20 会话 ≈ ￥0.35。试点方案：20 会话、￥0.5 硬上限、空闲时段、候选进开发库待确认。
- 验证：memory 73/73；全量 434/434（canonical test 脚本口径）；tsc --noEmit 干净；check:plugins 17 插件全过；冒烟 passed:true。

# DeepSeek Harness Personal Desktop 开发日志

## 2026-08-17：P6-1 收尾——memory.reset_project + shadow import + 并发/隔离验证

- memory.reset_project 落地（手册登记→实现）：preview（条目构成+确认令牌 10 分钟 TTL）→ execute（archive=全部转归档保留审计 / delete=逐条 tombstone 后物理删除）；catalog 新增 project_reset_receipts 审计回执（令牌只存 SHA-256）；迁移 0004、SCHEMA_VERSION 4；未登记项目 fail closed。
- shadow import 脚本（memory-shadow-import.mjs）：临时新库 → 迁移 → 模拟导入 → 计数/FTS/外键/schema/召回回归对账 → 原子切换（rename 双段）→ 旧库回滚；加密与明文两态全过，receipt 持久化。
- 并发/隔离测试 +2：快照反映备份时点且可重启核对；单项目分片损坏不影响全局与其他项目（fail closed 单点）。
- memory 65/65；全量 423/423；check:plugins + 冒烟全绿。P6-1 六项硬门全部闭环。

## 2026-08-17：模型路径政策定稿——flavor 解析梯 + 非系统盘数据根 + 干净版发布要求

- Cyrus 拍板：模型不写死路径、不放项目根（更新会搅动）、放各版本自己的数据根且非系统盘——开发版 `F:\Cyrus Dev Harness Data\models\bge-m3-onnx`；稳定版 `F:\documents\Cyrus Deepseek Harness Data\models\bge-m3-onnx`；env 显式覆盖优先。main.js 已按 flavor 解析实现，smoke 不再注入模型路径。
- 开发版模型已迁移至新根并 SHA-256 复验与 manifest 一致（559.6MB）；F:\AI 原目录保留作资产归档。
- 发布纪律补充：更新包内模型必须来自「干净版」（manifest 哈希一致的原下载副本），禁止打包开发版运行目录中的模型（PUBLISHING_RULES 已登记）。

## 2026-08-17：P6-1 恢复演练通过——加密库灾难恢复 + 整机迁移口令重建端到端验证

- 新增 scripts/memory-restore-drill.mjs（fixture-only）：建加密库（双项目+证据+supersede+候选）→ 快照 → 演练 A「库文件全毁，密钥文件存活」快照恢复 → 演练 B「整机迁移：密钥文件也丢失，用恢复口令重建 DPAPI 解锁（memory-recover CLI）」→ 每步对账 integrity/计数/FTS/schemaVersion/召回输出一致性。
- 结果：12 项检查全 PASS；可复核 receipt 持久化到 F:\AI\memory-drill-receipts\。这补齐了「有快照 ≠ 能恢复」的发布硬门。
- 下一步（P6-1 剩余）：shadow import（临时新库迁移对账+原子切换设计）、memory.reset_project（预览/双重确认/审计回执）、多项目并发与边界验证。

## 2026-08-17：P6-0A/B 完成 + 项目确认 + 原生工作区联动需求登记

- P6-0A 盘点（308 JSONL / 3.32GiB / 0 未说明 / 哈希确定性）+ 合同 v1 冻结；P6-0B 流式解析/fork 去重/项目映射 dry-run（33,622 条消息、mapped 260、quarantine 48、重跑零差异）；实测修正三处：junction realpath、rollout 键（308 文件 ≠ 57 逻辑会话）、cwd 零宽字符。
- Cyrus 确认：食溯项目根 = F:\QClawData\workspace\meal_tracker；亚马逊、量化盯盘已在 Project Control 关联注册（导入映射后续经 Host API 取 project_id）。
- 新需求登记（**不开工，新 session 做**）：原生侧栏工作区点击 → 右侧工作台文件树联动（方案 docs/原生工作区-项目联动-方案.md，含 2 个待确认问题）。

## 2026-08-17：P4 收尾——hybrid 双版本默认开 + 统一发布决策

- Cyrus 拍板：hybrid 召回开发版/稳定版**都默认开启**（DSH_MEMORY_HYBRID=0 一键关断保险丝保留）；删除冗余的 Hybrid 专用启动脚本（默认已含）。
- 发布决策：**不单独为 P4 发版**——整个记忆系统（含 P5 可选图、P6 稳定化）完成后统一更新；模型打包（+570MB）与 hybrid 开启随该次统一发布落地（发布清单已登记）。

## 2026-08-17：P4-2 验收收官——A/B/D 全部实测通过，真实数据门初判通过

- 最终复验：噪声查询（火花塞）零召回；「发布门禁」召回 3 条全部相关（发布流程规则 + 两条 UTF-8 导出约定），体检/食溯类弱噪声已消除；跨 scope 零串味。
- 验收期间共修 3 个实测问题：统计漏报（reconcileEmbeddingJobs）、全库噪声（HYBRID_STRICT_FLOOR=0.45 双层门槛）、弱相关噪声（HYBRID_TOP_RATIO 0.6→0.75）。
- 待 Cyrus 拍板：① 开发版是否默认开启 hybrid；② 稳定版发布轮（模型打包 +570MB 已登记发布清单、hybrid 默认关）。
- 遗留：验收测试记忆「出包之前的闸门」仍在项目分片，建议记忆归档。

## 2026-08-17：P4-2 阶段 D 实测暴露全库噪声召回 + 语义门槛修复

- 实测：hybrid 查询「如何更换摩托车火花塞」返回了全部 10 条记忆——原实现把向量 top-k 无门槛并集，bge-m3 的中文句对基线分普遍 0.35–0.45，噪声查询也会全员通过。
- 校准数据（真模型实测）：噪声查询 top≈0.374（fixture）/0.446（含闸门 claim 库）；弱信号 0.489；强信号 0.629。绝对阈值无法分离 0.428 真命中与 0.446 噪声 → 双层门槛：HYBRID_STRICT_FLOOR=0.45（FTS 零命中时语义通道兜底必须达标）+ HYBRID_TOP_RATIO=0.6（同查询内相对剪枝，只留 top 分 60% 强簇）。
- 修复后门 fixture：FTS 10/11 → Hybrid 11/11 不变；噪声查询零召回；注入查询不产生 claim 正文。
- 实测微调：HYBRID_TOP_RATIO 0.6 → 0.75（复验发现「发布门禁」查询仍混入体检/食溯类弱相关条目；fixture 最低真命中/top 之比 0.907，0.75 安全）。
- 测试 +2（vectorCandidates 门槛/噪声断言）；memory 61/61；全量 423/423；check:plugins 与冒烟全绿。

## 2026-08-17：P4-2 验收阶段 A/B 通过 + 修复统计漏报

- 验收进展：状态块全对；回填管线验证通过；发现 jobs 统计漏报（迁移前旧条目有向量但无作业行，ready 只报 1/9）——已修：storeEmbedding 作业行无则补行 + 每轮 drain 对账 reconcileEmbeddingJobs；修复后 ready 9/9 与 active 数一致。
- Cyrus 发布要求登记：F:\AI\bge-m3-onnx 是临时目录，发布稳定版时必须打包进更新（已写入 PUBLISHING_RULES.md 发布前核对清单；打包路径解析设计待发布轮实施）。
- 记忆写入说明：本环境（Web GUI 会话）的记忆库未登记 prj_01a00719，项目级记忆按 fail-closed 未写入；发布门禁以仓库文档为准。

## 2026-08-17：P4-2 step 4+5 完成——异步回填 + 混合召回 + 功能门 fixture 通过

- 迁移 0003：embeddings 表重建（generation INTEGER → TEXT 语义合同哈希）+ 新增 embedding_jobs 作业状态机（pending/ready/failed/stale + 重试计数，失败只记错误码）；SCHEMA_VERSION 3。
- 存储管线：record confirm / review confirm 入队；pendingEmbeddings（含 retries<3 重试回队 + 缺行回填）；storeEmbedding（scope 双写校验 + ON CONFLICT 更新）；markEmbeddingFailed；retireStaleEmbeddings（generation 变更 → 退役 + stale 重嵌）；activeEmbeddingVectors（查询侧 brute-force ≤1024）；embeddingStats。
- 回填 drain（embedding-pipeline.ts）：批处理 ≤16、单飞、坏向量防护（有限值 + 单位范数）、失败按作业记状态；插件 30s 周期 + 启动 3s 首跑，worker 就绪/回填失败进宿主日志。
- 混合召回（hybrid.ts + service.query）：FTS 与向量候选并集 + RRF(k=60) 名次融合 + 预算门；memory_query 在 hybridRecallEnabled（默认关）时走向量通道，嵌入不可用显式降级纯 FTS。
- 功能门 fixture（memory-p4-gate.test.js）：14 条合成脱敏记忆 + 11 查询（低字面重合/缩写/中英/路径/否定/旧事实冲突/注入/跨项目同词异义/无需历史）——**FTS 10/11，Hybrid 11/11**，跨项目串味 0，注入惰性。真实数据门留 Dev 试用阶段。
- 测试 +13（p4-pipeline 6 + p4-gate 1 + 既有 6）；memory 59/59；全量 420/420；check:plugins 与冒烟全绿。

## 2026-08-17：P4-2 step 1+2 完成——manifest/generation 合同 + worker-thread CPU 最小嵌入运行时

- 依赖落地（Cyrus 批准）：根依赖 @huggingface/transformers@4.2.0 + onnxruntime-node@1.24.3（与 spike 同版本）；pnpm-workspace allowBuilds 补 onnxruntime-node/sharp/protobufjs；npx pnpm 11.19.0 安装（本机无全局 pnpm）。
- core/embedding-manifest.ts：MODEL_MANIFEST.json 形状校验 + 文件大小恒查 + SHA-256 开关校验 + generation 语义合同哈希（模型/分词器/预处理/运行时全锁定）。
- core/embedding-worker.ts（独立 tsdown 入口 → lib/core/embedding-worker.js）：worker thread 内持有 tokenizer+ONNX session，CPU 默认、allowRemoteModels=false、批嵌入返回扁平 Float32Array 缓冲。
- core/embedding.ts：懒加载 worker、单飞初始化、队列上限 32（busy 显式报错）、60s/120s 超时、drain/terminate 关闭；purpose=query 按 manifest 前缀。
- 观测：memory_status 追加「向量嵌入（P4-2）」块（开关/模型目录/manifest/generation/worker 状态），不新增工具面；配置 embeddingEnabled（默认关）/embeddingModelDir。step 2 不接召回，功能门通过后再接线。
- 测试 +6（memory-p4-embedding）：manifest 校验/错误路径/generation 确定性/状态渲染/worker 路径/**真 bge-m3 离线集成**（加载 1.8s、1024 维、L2 范数、同义>无关）；memory 52/52；全量 413/413；check:plugins + 冒烟全绿。
- 备注：TS 6.0.3 与 node amaro 对「as 断言 + 嵌套接口」组合有解析怪癖（esbuild 却接受），embedding-manifest 已用无 as 断言风格重写规避。

## 2026-08-17：完成 Daydream 调研——定位为 P5 可选记忆反思层，交 DSH 架构整合

- 核验对象不是 Anthropic 官方记忆功能，而是社区 `glebis/claude-skills/daydream`（审阅基线 main `46edb03cc915adbd78ee81e3406bc4480aefcaba`，MIT）：按近期权重抽取笔记对，Sonnet 生成联系、Haiku 评分过滤、结果写回 Obsidian；原项目自报 50 pairs 每轮约 0.40–0.50 美元。
- 结论：不直接安装/照搬；它不服务 P4 语义召回，而应作为 P5 可选 Reflection 子层。P3 提供 candidate/TTL/人工确认，P4 embedding 只辅助 pair selection，P5 负责从决定↔结果、事故↔Gate、重复问题等关系中生成待验证洞察。
- 交付 `docs/P5-Daydream记忆反思层评估与架构整合交接.md`：包含 eligible 硬过滤、规则/vector/随机对照采样、generator/critic 合同、`candidate + llm_extracted` 落地、禁止自反馈、建议 `SYNTHESIZED_FROM` 来源链、R0–R3 顺序、盲评/成本/缓存/停止门以及手册逐节整合位置。
- 边界：本轮未安装第三方 Skill、未调用付费模型、未修改 memory 代码/Schema/依赖/稳定数据；工作区已有的 P4 开发改动保持原样。Reflection 必须等 P4 功能门后做无写入 spike，且不得算作 P4 完成项。

## 2026-08-17：P4 三模型离线评估完成——保留 bge-m3，CPU 默认，交接 DSH 正式开发

- 下载并锁定三款 INT8 ONNX：bge-m3（正式推荐，`F:\AI\bge-m3-onnx`）、Qwen3-Embedding-0.6B（公开基准更强的质量挑战者）、gte-multilingual-base（效率对照）；model/tokenizer 均对照 Hugging Face LFS SHA-256 通过，目录含 README、上游 README、许可文本与 `MODEL_MANIFEST.json`。`F:\AI\.ollama`/`F:\AI\Ollama` 未改。
- spike 固定 `@huggingface/transformers@4.2.0` + `onnxruntime-node@1.24.3`，完全离线跑 CPU/DirectML 六种组合。本项目 12 条合成非敏感召回集：bge CPU Top-1 11/12、Recall@3 100%、MRR .9444、单句中位 15.3 ms；Qwen3 为 10/12、91.67%、.8750、33.9 ms；gte 为 7/12、75%、.7250、9.9 ms。
- DirectML 在 RTX 4090 上三款都能运行但全部慢于 CPU（bge 单句 140.0 vs 15.3 ms），所以方案从“GPU 优先”修正为“CPU 默认，实测证明收益才开 DML”。固定余弦阈值也经反例废弃：模型分数分布不同，且否定/反义仍可高相似。
- 架构评审修正：推理放同进程 worker thread、模型懒加载；接口带 query/document purpose 与完整 generation；FTS/vector 两路先取候选并集再做 RRF/名次融合，不能只 rerank FTS 结果；写后异步嵌入，失败显式降级 FTS，禁止运行时下载与远程回退。
- 交付：`docs/P4-内嵌向量插件三轮评审与交接.md`、三份 `docs/p4-model-manifests/*.json`、`scripts/p4-embedding-eval.mjs`、`F:\AI\embedding-eval\results\*.json`。未开发正式插件、未改 memory schema/召回、未碰真实记忆数据；P4 模型门已过，FTS-only vs Hybrid helpful-hit 功能门仍待 DSH 实现后验证。

## 2026-08-16：P4 方案定稿——内嵌 ONNX embedding 插件（弃 Ollama）+ 选型任务书交 Codex

- Cyrus 拍板：本地、不付费、不用 Ollama 独立进程（OpenClaw 教训：伺候 Ollama + 断线卡顿），要零感知——只开 DSH 一个东西。形态定为内嵌 DSH 的 embedding 插件（transformers.js + onnxruntime-node，进程内加载 ONNX 权重），GPU 走 DirectML（可用性 spike 实测）。
- 模型：bge-m3 首选（本机 F:\AI\.ollama 已有 Ollama 格式副本，但需 ONNX 格式另下载；F:\AI\Ollama\ollama.exe 与模型库保持不动）；候选池 Qwen3-Embedding/multilingual-e5/gte-multilingual/jina-v3/nomic 交 Codex 对比。
- 产出 docs/P4-内嵌向量插件方案.md（给 Codex 的完整任务书：约束/架构/评估标准/下载规范/spike 脚本/验收清单）；手册 §9.11.3 与 §9.13 P4 行同步更新（弃 Ollama、否决远程嵌入）。
- 分工：Codex 负责下载权重 + 选型评估；评估通过后 DSH 侧才启动 embedding 插件与向量管线正式开发。

## 2026-08-16：待办登记——工具速查面板（排队，不着急）

- 痛点：插件用户命令（13 个 memory_* 工具 + 项目控制台/识图/连接中心等入口）记不住。Cyrus 已批准「工具速查面板」方向，但展示位置未定，不着急做，先排队。
- 待决定：放哪（聊天侧命令面板 / 工作台页签 / 独立浮层）。开工前先出设计文档，不直接动工。

## 2026-08-16：P3-2 实测闭环 + 修复自反馈重复提取

- Cyrus 实测完整闭环：SQLite 问答轮提取 2 条候选 → 拒绝 3 条归档（含一条「自动提取配置」候选，来自统计轮助手复述）→ 显式记忆「发布流程」入项目分片（project_fact + user_confirmed）→ memory_review confirm 提升 1 条。五个环节全部真实走通。
- 实测暴露自反馈 bug：拒绝轮助手复述候选内容（含经验信号词）被再次提取出同内容候选。修法：提取需求门排除记忆管理轮（memory_* 工具名 / 候选·评审·记忆库·自动提取话题 / 短管理指令「拒绝/确认」）。
- 测试 +1（管理轮跳过门）；memory 46/46。

## 2026-08-16：修复运行时 peer 依赖解析——提取/识图插件按文件路径加载 personal-foundation

- 根因（Cyrus 实测 memory_status 抓到）：插件内 `import('@cyrus/dsh-personal-foundation/...')` 按包名解析失败（Cannot find package）——源码态与打包态都不存在插件内可用的 node_modules 链接（个人仓库根无 @cyrus scope；打包 app 亦无）。image-vision 同款隐患一并修复。
- 修法：personal-foundation 主机包新增 re-export PersonalStore；memory（core/foundation-runtime.ts）与 image-vision 改用「候选路径按文件定位兄弟包 lib/index.js」（源码态 src 三级上溯 / 打包态 lib 二级上溯，与 migrationsDir 同套路），失败显式报错进统计。
- 连带修复：foundation ConnectionKind 白名单补 memory-extraction 与 personal-wechat（否则连接中心新建「记忆提取」连接会被拒）。
- 测试 +4（foundation kind 白名单、memory 运行时加载、image-vision 路径解析与导出）；memory 45/45；全量 406/406；check:plugins 与冒烟全绿。

## 2026-08-16：P3-2 提取观测落地（memory_status 统计 + 失败日志）

- 背景：Cyrus 首轮实测，候选队列零产出。提取管线此前完全静默（设计上不打断会话），失败/跳过无迹可查。
- turn-extractor 增加 onOutcome 观测回调：paused / gate-skip / no-connection / ok（含写入条数与连接）/ failed（含错误原文）；ok 按「非幂等命中」计数写入条数。
- memory_status 追加「自动提取（P3-2）」统计块：开关/模型/回退状态 + 成功/失败/需求门跳过/暂停跳过/无连接跳过计数 + 最近结果；失败同时 console.warn 进宿主日志。不新增工具面。
- 测试 +1（失败观测）+ 观测断言若干；memory 44/44。

## 2026-08-16：P3-2 提取模型定稿——deepseek-v4-flash + 关思考 + 官方默认密钥回退

- 按 Cyrus 拍板：提取默认模型 deepseek-v4-flash（非思考小模型）；请求体显式 thinking:{type:'disabled'}（官方规范最低思考强度，与上游 session-title 轻量任务同策略）；「记忆提取」连接为空时自动回退 DeepSeek 官方接口 + DEEPSEEK_API_KEY 环境变量（开发版默认密钥，不复制密钥、不写连接数据；DSH_MEMORY_EXTRACTION_OFFICIAL=0 可关）。
- 回退优先级：Connection Center「记忆提取」连接（自定义端点/密钥）→ 官方回退 → 都没有则静默跳过。
- 新增 core/official-fallback.ts（纯函数 + 测试）；extractor 增加 disableThinking（wire 断言测试）；memory 43/43。

## 2026-08-16：P3-2 自动候选提取管线完成（轮末提取 + 独立「记忆提取」连接 + 项目绑定桥）

- 提取器 core/extractor.ts：有界 OpenAI 兼容调用（30s 超时、可注入 fetch）→ 严格 JSON 解析（围栏/整体/切片三级回退）→ 逐条校验（kind×scope 配对、敏感硬拦截、12–4000 字符、去重、≤2 条）；需求门 extractionGate（助手≥20 字符 + 教训/约定/修复类信号或显式「记住」）；上下文预算 buildExtractionContext（默认 1500 字符，用户留头、助手结论留尾）。text-only（决策①：不做图像识别）。
- 轮末管线 core/turn-extractor.ts：订阅 session/event（user/message 只收 source.kind=user、assistant/message 取最后一步回复、turn/end reason=completed 触发）；fire-and-forget、吞错、暂停门、子代理会话（delegationDepth>0）不提取、会话缓冲上限 64；幂等键 project|session|turn|extractor_version|candidate_index 写入 candidate_idempotency，同轮重放不重复。
- 连接（决策②：独立不混用）：Connection Center 新增 memory-extraction 连接类型；取第一个已启用且密钥齐备的连接；密钥经 ctx.credentials 解析，Host 侧发起。
- 项目绑定桥（决策③：全项目试点、新项目自动适配）：POST /__personal/memory/context（x-dsh-console 头门禁）——Project Control 控制台打开/切换项目时把会话↔项目写入绑定表并幂等 registerProject；未绑定会话只提全局 pattern 类，绑定后开放 project_fact/event。
- 配置：extractionEnabled（开发版默认开，稳定版默认关，DSH_MEMORY_EXTRACTION=1 显式开启）/ extractionModel / extractionMaxContextChars / extractionTimeoutMs；record() 增加 idempotencyKey + evidenceKind（提取证据记 evidence_sources.kind=session）。
- 测试 +9（memory-p3-extract.test.js）：需求门/解析有界/上下文预算/模型调用与错误映射/幂等写入/轮末管线（绑定+重放+各门）/绑定桥（403/405/400 拒绝路径）；memory 42/42，check:plugins 与冒烟全绿。
- 待 P3-3：试点真实使用 → 提示词/阈值调优 → 候选确认率观察。

## 2026-08-16：P3-1 候选治理闭环完成（无 LLM 骨架：暂停 / 候选队列 / 评审 / TTL / 摘要块）

- 迁移 0002_candidate_expiry.sql：claims 增加 expires_at（SCHEMA_VERSION 1→2）；编号迁移支持 catalog/shard 分半标记；基线应用后继续追加编号迁移（修复此前基线提前 return 跳过 0002+ 的问题）。
- MemoryService：isPaused/setPaused（暂停自动候选与自动召回）、listCandidates（最老优先 + 到期时间）、reviewCandidate（confirm→active+user_confirmed / reject→archived，写 promotion_events，幂等键 outcome 同步）、expireCandidates（过期清理，保留幂等键 outcome）、candidateDigest（挂入 memory_summary：待处理数/最老 3 条/近 7 天评审统计）。
- 工具 +3：memory_pause / memory_candidates / memory_review；quick-pass 注入加暂停门；维护定时器每小时过期清理（unref + 可卸载）。record() 候选写入设置 expires_at（TTL 默认 14 天，1–90 可配）。
- 测试 +5（memory-p3.test.js）：候选 TTL / 评审确认与拒绝 / 过期清理与幂等 outcome / 暂停态 / 摘要块；memory 33/33；全量 392/392；check:plugins 与冒烟全绿。
- P3-2（提取器 + LLM 连接）待开工：按 Cyrus 拍板——独立「记忆提取」连接、不掺识图插件；试点全项目开启、新项目自动适配。

## 2026-08-16：补丁版 v0.2.1 发布（修复稳定版加密初始化时机）

- 根因：工作区 main.js 的「自检默认开启（全 flavor）」编辑曾因批量编辑中断而未落盘，v0.2.0 打进去的是「仅开发版自检」——稳定版加密初始化被推迟到首次使用记忆时，恢复口令文件出现时机不可预期（Cyrus 报告 memory-live 为空）。
- 修复：DSH_MEMORY_SELF_TEST 默认 '1'（显式环境变量仍优先）；版本 0.2.0 → 0.2.1；preflight → pack → 打包态冒烟全绿 → 暂存 → GitHub Release v0.2.1（id 371203608，5 资产）。
- 经验：发布前必须 diff「工作区 main.js ↔ 打包产物 resources/app/src/main.js」核对关键配置行，防止编辑丢失被带进发布（已在本轮用 Select-String 核对）。

## 2026-08-16：第二次稳定版 v0.2.0 发布（记忆系统上线 + 工作台审阅重构）

- 版本 0.1.1 → 0.2.0；preflight（378 文件零密钥）→ pack:win（nsis + portable）→ 打包态冒烟全绿（含记忆加密自检：SQLCipher 原生模块随包验证）→ 暂存 分发包\稳定版 → GitHub Release v0.2.0（id 371200595，5 资产）。
- 打包修复：better-sqlite3-multiple-ciphers 提为应用根依赖（原生模块随生产 node_modules 进包）；pnpm.onlyBuiltDependencies 批准其构建脚本；重建后 pnpm install 退出码归零。
- 加密启动自检改为全部 flavor 默认开启：稳定版首次启动即初始化加密（生成恢复口令文件 + 明文库升级）。
- 发布说明 docs/release-notes/v0.2.0.md（无个人路径；含包体 SHA-256）。

## 2026-08-16：文件树搜索框 + 审阅区「预览/代码」切换

- 文件树顶部改为扁平圆角搜索框（data-workspace-files-search）：输入即搜索文件名（Host 新增 /workspace/search：会话与项目工作区两侧，深度≤8、每目录≤200、结果≤100、忽略目录黑名单、防抖 180ms）；搜索时隐藏路径，路径平时以底色样式条显示在搜索框下；结果行点击直接打开预览。
- 审阅区「预览/代码」切换（md/markdown/mdx 专用，其他文本文件保持代码视图）：预览 = Notion/Obsidian 式排版（标题层级/引用/表格/任务清单/代码块等）；代码 = 纯代码视图（md 原文）。默认 md 开预览，切换为分段胶囊样式。
- 冒烟新增探针：搜索框输入 README → 结果出现 + 路径条隐藏；md 视图切换器存在 + 点「代码」出现纯代码视图。全量 387/387、check:plugins、冒烟全绿。

## 2026-08-16：工作台顶栏按 Cyrus 版式定稿 + Markdown 阅读排版升级

- 顶栏定稿为两行：第一行 = 审阅页签（可滚动）+ 全屏/收起（右）；第二行 = 「打开文件夹」按钮 + 文件路径段（点目录段弹悬浮窗筛选）+ Details/文件/⋯（右）。
- 路径栏新增「打开文件夹」：在资源管理器中打开当前文件所在目录（主进程桌面桥 reveal-in-explorer，本地绝对路径校验）。
- Markdown 渲染器重写（markdown-lite）：标题层级 h1-h4、粗体/斜体/删除线/行内代码、有序/无序/任务清单、引用块、代码块（语言标签）、表格、水平线；链接仅放行 http(s)。阅读排版（Obsidian/Notion 风格）：860px 阅读栏居中、行高 1.7、标题分栏线、引用左边线、表格斑马表头。
- 探针更新：页签计数改为整个面板内 role=tab（Details 在第二行）；新增悬浮窗/路径栏探针全绿；全量 387/387。

## 2026-08-16：工作台头部重构——页签上移、路径栏 + 目录悬浮窗、终端页签移除

- 按 Cyrus 方案重构工作台头部：外壳展开态头部（工作台图标/标题）取消，收起态窄轨保留；页签栏接管顶部——文件页签 + Details + 布局菜单（专注会话/重置布局，动作经 workbench 服务回外壳）+ 收起按钮 + 全屏 + 文件开关。
- Terminal 固定页签移除（右下角会话终端已覆盖该功能）；Details 移至全屏按钮左侧（页签栏尾部分隔区内）。
- 新增路径栏：当前审阅文件显示「根（项目名/工作区）› 目录 › … › 文件名」；点击任一目录段弹出悬浮窗，可筛选/搜索该目录下文件并直接打开预览（按需懒加载，支持进入子目录）。
- 外壳移除展开态头部后，布局菜单与收起按钮移入工作台插件（PersonalShellWorkbench 契约 +focusConversation/resetLayout）；相关探针保持原 aria-label/data 属性，冒烟全绿。
- 固定页签从 2 → 1（Details）；全量 387/387、check:plugins、冒烟全绿。

## 2026-08-16：工作台审阅体验收尾——响应预算、标签精简、文件树右键菜单、恢复口令轮换

- 大文件预览修复：项目工作区 /workspace/file 响应预算放大到 512KB（文本内容上限仍 256KB）；sendJson 支持按路由指定上限。DEVLOG.md 等长文不再报「响应超过安全上限」。
- 固定页签精简：移除无实际功能的 Code/Outline/Diff/Browser 占位页签，只保留 Terminal（会话终端）与 Details（legacy 工具详情，控制台/工具联动用）；文件审阅由右侧文件树点击打开预览页签。
- 文件树右键菜单：复制相对路径 / 复制完整路径 / 在资源管理器中显示（主进程新增 reveal-in-explorer 桌面桥：仅接受本地绝对路径，shell.showItemInFolder）。
- 恢复口令轮换：memory-recover.mjs 新增 --rotate（DPAPI 解锁后重新包裹并打印新口令；口令曾出现在对话中时可用它轮换）。memory 测试 28/28（新增轮换测试）。
- 开发版启动即初始化加密（DSH_MEMORY_SELF_TEST 默认开：生成主密钥与恢复口令文件、明文旧库升级）；显式环境变量优先，冒烟注入不受影响。

## 2026-08-16：Bug B 完成——工作台文件树绑定控制台选中项目

- Host：Project Control 新增项目工作区端点（/projects/:id/workspace/status|tree|file|blob），只服务已登记项目的 activeLocation 根目录；有界读取（条目/字节上限）、路径逃逸与符号链接逃逸防护、忽略目录黑名单——与 workbench 会话工作区同约束（plugins/project-control/src/project-workspace.ts）。
- 客户端：控制台点击「打开控制台」→ 经 workspaceStatus 取根 → workbench.setProjectWorkspace(projectId, root)；文件树/预览经 useWorkspaceApi() 动态切换（项目工作区只读：save 拒绝；blob 走流式端点支持图片/PDF）；树组件按 scope 重挂载避免旧目录状态残留。
- 控制台返回（onBack）或项目工作区不可用时回到会话工作区；dock 标题区分「项目文件/工作区文件」。
- 冒烟新增 projectWorkspaceBinding 探针：Host 端点只服务已登记项目 + 点击项目行后 dock 根与目录树切换为项目内容（docs 可见、会话目录不再泄漏）——全绿；全量 386/386。

## 2026-08-16：记忆加密 P2 收尾完成（DPAPI + 恢复口令 + 明文库升级 + 打包规则）

- 主密钥 v2：每个记忆库根目录一把 memory.key.json——DPAPI 自动解锁（powershell.exe 内建 ProtectedData + 应用专属 entropy，零第三方依赖；koffi 路线放弃）+ 恢复口令包裹（12 词 BIP-39 → scrypt(N=16384,r=8,p=1) → AES-256-GCM）。
- 一次性恢复口令文件 recovery-passphrase.txt（首次生成时写入根目录，用户转存 cyrus-keyring 后删除）；恢复 CLI plugins/memory/scripts/memory-recover.mjs <根目录> <口令>（--verify 只校验；ELECTRON_RUN_AS_NODE 可走应用运行时）。
- 迁移：v1 十六进制 .key 自动收养为主密钥后删除；明文旧库经 rekey 原地升级（保留 .pre-encrypt.bak，校验失败自动还原；sqlcipher_export 在该构建不可用，弃用 ATTACH 路线）。
- encryptionEnabled 默认开启；DSH_MEMORY_SELF_TEST=1 启动自检（解锁+打开+完整性，失败拒绝启动）；冒烟断言 memory.key.json v2 / 恢复口令文件 / catalog 密文落盘。
- 打包：files 规则带 plugins/memory/node_modules/better-sqlite3-multiple-ciphers/**；随第二次稳定版打包时由 packaged smoke 终验。
- 测试：memory 插件 27/27（新增 keys 6 组：DPAPI 往返/口令包裹/主密钥/v1 收养/明文库升级/恢复 CLI）；check:plugins 与冒烟全绿。
- cyrus-keyring skill 已复制进开发版技能库（%USERPROFILE%\.dsh\skills\cyrus-keyring，补 YAML frontmatter；原 F: 路径保留为唯一权威源）。

## 2026-08-16：修复开发版启动自动弹「选择文件夹」——冒烟探针泄漏到真实会话

- 现象（Cyrus 报告）：cmd 启动开发版，窗口出现后未做任何操作即自动弹出目录选择框；选一个文件夹后按「扫描来源目录」模式扫出两个项目，而非「导入单个项目」。
- 根因：inspectPersonalFeatures（冒烟探针）在 start() 中无条件执行——它内部第一步就是自动点击控制台「扫描来源目录」按钮。烟测模式里目录选择器被桩替换（自动返回 DSH_WORKSPACE_ROOT），所以从未暴露；开发版用真实 dialog，于是每次启动都弹窗。同一泄漏还意味着整个探针链（点候选、登记、切标签、dock/全屏开关）在真实会话启动时都会跑一遍。
- 修复：探针调用改为 smokeMode 专属（personalState = smokeMode ? await inspectPersonalFeatures(...) : undefined）；真实会话启动不再执行任何探针操作。
- 验证：烟测仍全量执行探针链并通过；开发版启动不再有任何自动点击。

## 2026-08-16：工作台文件树停靠、宽度放宽与全屏模式；登记「统一 UI / 排版体系」待开发项目

- 文件树停靠（提交 9145074）：工作台最右缘新增持久化文件树 dock（默认展开，标签栏「文件」按钮折叠为 30px 窄轨，状态存 localStorage）；dock 展开且切到 Files 标签时主区显示引导占位，避免双份树。宽放上限：工作台 1440→视口限制（内部 4000）、控制台 760→1000；会话区保底 560 与让步算法不变。字号：候选详情/工作台查看器/标签整体提升一档，并全部 rem 化（根 14px）——主题插件的基础字号设置从此可全局缩放插件文字。
- 全屏模式（提交 874c4d0）：工作台标签栏右端新增全屏图标按钮（左下/右上双尖角 SVG，无文字）——点按后工作台横跨控制台窄轨 + 会话区 + 工作台三区域（会话轨道 0px）；再点、展开控制台或「专注会话」即退出；瞬态不持久化。
- 验证：新增烟测探针（dock 展开/折叠/再展开、全屏进入/退出/轨道 0px）；单测 +3（全屏列计算、状态切换、服务委托）；全量 379/379；check:plugins 全过。过程中修复两个探针自身缺陷：模板字符串吞 `\s`（改字面空格正则）、控制台刷新竞态（周期性重试点击）。
- 待开发（Cyrus 拍板记录）：① 全部插件 + 客户端 UI 统一美化；③ 排版体系——一/二/三级标题与正文/辅助文字的分级字号、字重、行高（行高按 1.5–1.7 重定，解决行距过挤）、统一中文字体栈、颜色/字号/粗细令牌化 + 主题设置面板全局生效（rem 地基已铺）。开工时先出设计文档供 Cyrus 拍板。

## 2026-08-15：修复「改下拉框 → 整个工作台消失」崩溃（event.currentTarget null 读取）

- 复现：冒烟探针驱动候选详情文档角色 select 变更 → 稳定复现 TypeError: Cannot read properties of null (reading 'value')，堆栈指向 @cyrus/dsh-project-control client.js 的 onChange（CandidateDetails 文档角色下拉框）。
- 根因：React 合成事件的 event.currentTarget 在元素重渲染/事件处理窗口外为 null；CandidateDetails 与各插件设置面板共 32 处直接读 event.currentTarget.value/checked——同一隐患遍布全部插件 UI（含 Cyrus 报告的旧稳定版同类现象）。
- 修复：9 个插件客户端的 value/checked 读取统一改为 event.target（指针捕获类用法保留 currentTarget）；personal-shell 新增 PanelErrorBoundary（面板级错误边界：子插件崩溃只隔离该面板并显示错误，不再整块消失）；ErrorBoundary 补齐 override 修饰符。
- 回归：冒烟新增 selectChangeSurvival 探针（改下拉框后断言 shell/工作台/详情视图全存活、无边界回退、无控制台错误）——修复前稳定 FAIL、修复后 PASS；全量 374/374；check:plugins 全过。
- 待办：Cyrus 用「启动 DeepSeek Harness 开发版.cmd」复核真实控制台登记流程（Bug A 场景）与下拉框交互。

## 2026-08-15：恢复「开发版直接启动」快速通道（Cyrus 要求，免打包）

- 新增 启动 DeepSeek Harness 开发版.cmd（纯 ASCII+CRLF，符合 GBK 控制台纪律）：DSH_DESKTOP_FLAVOR=dev + 显式 Dev 数据目录 + DSH_HOME，随后走 pnpm run start（build:plugins → verify-launch → electron .）。构建失败即拒绝启动。
- main.js 支持 DSH_DESKTOP_FLAVOR 环境覆盖 flavor（loadAppFlavor(env)）；与打包流程互不影响（双包体发布流程保留给稳定版/发布）。
- 用法：开发验证不再需要 pack:dev:portable + stage；我改完代码跑 check:plugins + pnpm run smoke（开发态冒烟，无打包）后，Cyrus 双击该 cmd 即得最新开发版。隔离纪律不变（独立实例锁/数据目录，与稳定版、测试版 Portable 并存）。
- 验证：launcher 测试扩展覆盖新 cmd（ASCII+CRLF 断言）、app-flavor 测试 9/9、开发态 smoke 通过。

## 2026-08-15：控制台/工作台联动 bug——e2e 探针建成，Bug A 在开发版不可复现

- 新增 intake e2e 冒烟探针（scripts/smoke.js + src/main.js）：合成两个夹具项目（干净项目 + 文档角色冲突项目）；smoke 模式下目录选择器注入 DSH_WORKSPACE_ROOT；探针在「工作台收起为轨道」的真实布局下走完整链路：扫描来源目录 → 候选行出现 → 点击 → 工作台自动展开 → candidate-details 视图出现 → 只关联按钮 → 登记成功（/projects 非空）；冲突候选断言 details 视图 + 确认按钮存在。
- 结果：开发版冒烟全绿（含 collapse-first 与冲突候选场景）——Bug A（确认导入不显示）在当前代码上无法复现。剩余假设：① 用户客户端持久化状态陈旧（localStorage 恢复路径）；② 用户操作的是旧包。下一步请 Cyrus 在新测试版 0.1.1 重试控制台登记流程；仍失败则加持久化状态自愈 + 诊断导出。
- Bug B（Files 显示 D:\Deepseek Harness）根因确认：WorkspaceFilesViewer 只绑定会话 cwd（workspace-remote 的 workspaceRoot），没有任何项目绑定；选中项目不会切换。修复方案：Files/预览绑定控制台选中项目，目录树由 Project Control Host 以「已登记项目根」校验后提供（含路径逃逸保护），下轮实施。
- 记忆系统主体状态不变（P2 就绪、加密引擎已接入）；此 bug 修复与下一次稳定版发布挂钩。

## 2026-08-15：控制台/工作台联动 bug 静态诊断（复现细节来自 Cyrus）

- Bug A（登记流程）：候选点击 → workbench.open(details, project-control.candidate-details) 链路静态检查存在（ProjectControlPlaceholder.openCandidate → service.open → WorkbenchPanel 渲染插件 viewer），但用户侧「确认导入/只关联」从未出现、只有忽略可点——怀疑 pinned/details 视图解析或 auxiliary 轨道切换环节断裂，需 e2e 探针复现。
- Bug B（Files 不跟项目）：Files 页签绑定的是会话 cwd（上游源码根），从未绑定 Project Control 选中项目的 workspace_locations；且 pinned 页签 viewer id（workbench.files.placeholder / workbench.workspace-files / workbench:files 三处命名）存在映射不一致嫌疑。
- 计划：① smoke 探针 e2e 复现 Bug A（预置合成候选 + 驱动点击 + 断言 details viewer 出现）；② 修复 linkage；③ Files/Code/Outline 绑定选中项目工作区（Host 有界只读目录树）；④ 重建开发版包交 Cyrus 验证。
- 记忆系统主体状态不变：P2 代码就绪、quick-pass 验证通过、加密引擎接入；此 bug 修复是项目级记忆通道与下一版稳定版的前置。

## 2026-08-15：quick-pass 真人验证最终通过（第三轮）+ 新问题：项目控制台联动 bug

- 第三轮验证通过：跨项目业务事实自动归 global_user/global_fact；项目专属内容被分类合同正确拦截、经用户提问确认后才暂存 global pattern 并注明迁移计划；显式/新会话召回与无干扰测试均通过。docs/memory/QUICKPASS_VERIFICATION_SCRIPT.md 已记最终结论。
- Cyrus 报告新问题：项目控制台与右侧边栏联动有 bug，导致「导入单个项目 → 候选详情 → 只关联」登记流程走不完——直接卡住记忆系统项目级通道（食溯未登记 → 项目级记忆无法写入）。
- 决策：先修控制台联动 bug（记忆系统 P2 主体已就绪；bug 修复是项目级记忆的前置 + 下一版稳定版质量项）。待 Cyrus 提供具体复现步骤后开工。

## 2026-08-15：加密引擎接入记忆插件（SQLCipher 双引擎 + 每库数据密钥）

- @cyrus/dsh-memory 新增存储引擎抽象（src/core/engine.ts）：plain（node:sqlite，默认）与 cipher（better-sqlite3-multiple-ciphers 13.0.3，SQLCipher）同窄接口；依赖登记进插件 package.json。
- 每库随机 32 字节 data key（<db>.key，用户数据目录）；加密模式读写 catalog 与分片；密文落盘、无钥匙/错钥匙打开失败（fail closed）、VACUUM INTO 快照同样加密——测试 3 项（memory-encrypted.test.js）全过；全量 374/374、check:plugins 全过。
- 暂态与剩余（真实数据门槛前必须完成）：① data key 的 DPAPI 封装（koffi v3 API 与文档不一致，已移除临时模块，待适配）；② recovery passphrase 包裹与恢复演练；③ cipher 原生模块随包打包（files 规则 + 打包后冒烟）。未完成前 encryptionEnabled 保持默认 false，dev 验证包不受影响。
- 状态固化：docs/memory/MEMORY_CRYPTO_AND_KEY_RECOVERY.md 新增「4.4 实现状态」。

## 2026-08-15：quick-pass 真人验证第 2 轮通过 + 归类合同增补（kind×scope 硬规则）

- 第 2 轮全部通过：工具自检（9 工具描述准确）、红线自检（8 条）、播种 3 条真实落盘（ID 与报告一致，已只读核验）、新会话 quick-pass 答对根因、翻译无干扰、跨会话召回带不可信语气。fail-closed（未登记项目拒绝写入）首次真实生效。
- Cyrus 归类反馈：项目事实被暂存全局、通用教训被带项目上下文——增补三件套：① service.record 加 kind×scope 配对硬规则（global_user 拒收 project_fact/event/task；project 拒收 global_fact/user_profile）；② 新工具 memory_classify（前置归类建议 + 项目事故双记录建议：项目 event + 全局 pattern）；③ 工具指引与 AGENTS 路由更新（先归类再写入、禁止擅自降级落全局）。
- 验证：memory 测试 17/17（新增 classify 3 项）；docs/memory/MEMORY_DATA_CLASSIFICATION.md 增补 §2.5；手册 §9.5 同步一行。
- 待办：Cyrus 关闭运行中的开发版后重新 stage 新包（EBUSY）；加密引擎接入继续。

## 2026-08-15：quick-pass 真人验证第 1 轮失败归因与修复

- 现象：Cyrus 在测试版说「记住…」，agent 却回复「工作区为空」、声称创建 PROJECT_CONTEXT.md 并「批准策略已切换为 never」。
- 归因（只读排查）：旧 0.1.0 测试版仍在运行（EBUSY，PID 锁定）；记忆库目录从未创建；PROJECT_CONTEXT.md 在候选位置均不存在；批准设置无任何落盘变化——「写文件」与「切换审批」两句均为模型幻觉（旧包既无记忆工具也无红线插件，天然不可信）。
- 修复：① memory 插件新增 systemPrompt 工具指引（order 150：记住→memory_record、之前/上次→summary→query、禁止用文件替代记忆库、不得声称改审批）；② Global AGENTS 新增第 5 条路由规则并已投影 Dev home（哈希校验 PASS）；③ 重建开发版包 0.1.1（冒烟通过，staged 到 分发包\测试版）。
- 验证脚本新增「第 0 段装包自检」（问记忆工具/问红线条数），见 docs/memory/QUICKPASS_VERIFICATION_SCRIPT.md。
- 待办：Cyrus 用新包重测；加密引擎接入（SQLCipher 进插件 + 恢复演练）继续。

## 2026-08-15：记忆系统 P2 完成（渐进披露 + quick-pass seam 接入）

- memory_summary 工具：紧凑摘要（active 按 kind 计数、importance 前 5、最近验证 3 条、CONFLICTS_WITH 冲突对成对呈现，≤4KB 预算 + 截断标记）——渐进披露第一层。
- memory_query 强化：召回字节预算（8KB，超出按预算呈现并回写 recall_runs.injected_bytes）、每条带 evidence source locator 行、untrusted 标记头。
- 需求门 needsMemory（纯函数启发式：延续/经验词触发，翻译/改写类跳过）+ buildQuickPassText（预算截断）单测覆盖。
- quick-pass 接入：agent/pre-step seam（plan-mode 先例；ephemeral、不落历史、token 不膨胀）——config quickPassEnabled 默认 false、quickPassMaxBytes 2000、quickPassMaxItems 3；验证结论与剩余人工验证项写入 MEMORY_RECALL_SEAM_SPIKE.md §2.1。
- 验证：插件测试 14/14（新增 P2 5 项：需求门/预算/摘要/证据行/脱敏真实任务回归含跨项目 leak=0）；全量 368/368；check:plugins 17 插件全过；packed dir smoke 通过。
- 边界：quick-pass 默认关闭（真实会话验证后再按项目启用）；无真实数据；P3（自动候选）未做。

## 2026-08-15：记忆系统 P1 完成（@cyrus/dsh-memory 上架 + 加密 spike 通过）

- 新插件 @cyrus/dsh-memory（17 号，四处上架，cordis.patch.yml 配置 dbRoot:''=临时目录）。核心：src/core/store.ts（node:sqlite 单写者 + append-only 迁移框架 + schemaVersion fail-closed）、gates.ts（凭据/身份证/银行卡硬拦截 + canonicalize + searchable_text 派生：ASCII 词 + 中文二元组，解决 FTS5 unicode61 不切 CJK）、service.ts（record 候选→确认、query scope 硬过滤 + 召回审计、list/status/explain/correct/archive、VACUUM INTO 一致性快照 + manifest、JSONL 导出/导入往返）。
- 工具面：memory_record / memory_query / memory_list / memory_status / memory_explain / memory_correct / memory_archive / memory_export（defineTool，Host 有界）。project 写入 fail-closed（未登记项目拒绝）；跨项目召回 0（测试断言）。
- schema：searchable_text 列 + fts5(searchable_text) 触发器同步；docs/memory/MEMORY_SCHEMA_V1.sql、migrations/0001_initial.sql、手册 §9.4.3、scripts/memory-schema-fixture.mjs 全部同步（fixture 25/25）。
- 加密 spike（临时目录，未装进项目依赖）：better-sqlite3-multiple-ciphers 在本机 Node 25/Windows 原生构建成功；密文落盘、无钥匙读不出、VACUUM INTO 快照同样加密；注意 key pragma 与 VACUUM INTO 目标需单引号。证据写入 MEMORY_CRYPTO_AND_KEY_RECOVERY.md。
- 验证：插件测试 9/9；全量测试 363/363；check:plugins 17 插件全过；治理门禁 20/20（测试夹具豁免凭据模式）；packed dir smoke passed（observed 含 dsh-memory）。冒烟两次抓到真实启动缺陷并修复：ctx.config 需经 cordis Config schema 传入（inject 'config' 服务不存在）。
- 边界：仍无真实数据（dbRoot 临时目录）；P2（渐进披露 + 注入 seam 验证）待申请；记忆插件随第二次稳定版发布才到客户端。

## 2026-08-15：治理线四项完成（System Policy 上架 / Dev AGENTS 投影 / git 基线 / Gate Wave 1）

- System Policy 插件：新增 plugins/personal-policy（@cyrus/dsh-personal-policy，16 号插件，四处上架），注册 personal:cross-project-policy（order -50，普通 section，无 complete）；8 条红线文本与手册 §3.1 一致，版本号仅导出不入正文；test 3/3、check:plugins（16 插件）通过、packed dir smoke 实测 observed 含该插件且 passed:true。
- Dev AGENTS 投影：规范源 docs/agent-instructions/global-AGENTS.md → 受控脚本 scripts/project-global-agents.js 投影到 %USERPROFILE%\.dsh\AGENTS.md（稳定版 home 一律拒绝；旧副本保留 .previous；回读 SHA-256 校验 PASS）。脚本入口守卫修正（相对 argv 经 resolve 后比对）。
- git 基线：git init -b main，repo-local 身份 Cyrus/cyrus@local.invalid，无 remote；首次提交 cf30c7f（477 文件，含 16 插件与治理文档），二次提交 e273ddf（治理线四项）。提交前密扫：token 值 0 命中。
- Gate Wave 1：scripts/stage-releases.js 写入路径接入 assertAutomationSafe；新增 scripts/check-governance.js（package.json check:governance，20 项：受保护根/政策上架/AGENTS 哈希/密扫/git 无 remote/自动化守卫在位），20/20 全过；test/project-global-agents.test.js 4/4。密扫改为从安全区读 token 精确比对（仓库存片段会自伤）。
- 边界：这些改动在下一次稳定版发布时随客户端到达；Wave 2–4 门禁、后续 commit、后续投影仍逐次申请（手册 §12.3 已标注完成态）。

## 2026-08-15：记忆系统 P0 交付物全部产出（线 B 启动）

- 按 Cyrus 指示（线 B：先文档与合成 fixture，零稳定数据接触）产出 8 份 P0 交付物于 docs/memory/：MEMORY_DATA_CLASSIFICATION.md、MEMORY_PROJECT_IDENTITY_CONTRACT.md、MEMORY_SCHEMA_V1.sql、MEMORY_CRYPTO_AND_KEY_RECOVERY.md、MEMORY_BACKUP_RESTORE_CONTRACT.md、MEMORY_RECALL_SEAM_SPIKE.md、MEMORY_THREAT_MODEL.md、MEMORY_DECISION_RECORD.md；手册 §12.2 已标注完成。
- MEMORY_SCHEMA_V1.sql 用 node:sqlite 在临时目录合成数据验证：scripts/memory-schema-fixture.mjs 25/25 断言通过（catalog 唯一键、CHECK/STRICT 拒绝、FTS 同步、状态机两轴、外键 RESTRICT/CASCADE/SET NULL、tombstone 单事务、删除级联）。
- 验证中发现并修正一处真实 schema 缺陷：recall_items 的 PRIMARY KEY(recall_id, claim_id) 使 claim_id 隐式 NOT NULL，ON DELETE SET NULL 被挡——改为 UNIQUE(recall_id, claim_id)；手册 §9.4.3 内联 schema 同步修正。
- 执行边界不变：任何 P1 动作（建库、装依赖、上架、注册 System Policy、投影、git init、Gate）仍按手册 §12.3 逐项申请；本批交付物未碰稳定数据、未装依赖。

## 2026-08-15：v0.1.1 发布——应用内更新通道打通（仓库转公开 + 出厂预置仓库名）

- Cyrus 将仓库 SeeiiLee/deepseek-projectpl-console 转为公开并确认使用更新中心。v0.1.1 已正式发布（Release id 371107196，tag v0.1.1，5 资产逐一校验；URL https://github.com/SeeiiLee/deepseek-projectpl-console/releases/tag/v0.1.1 ）。同版本不会提示更新——此前「收不到更新信息」即 0.1.0 == v0.1.0 所致。
- 源码变更：package.json 版本 0.1.0→0.1.1；src/update-core.js 更新中心默认仓库预置为 SeeiiLee/deepseek-projectpl-console（环境变量 DSH_PERSONAL_UPDATE_REPOSITORY 仍可覆盖）；src/build-flavor.js 恢复 'stable'（残留 dev 导致全量测试失败）。
- 测试修正：test/update-service.test.js 两个「未配置仓库」用例显式写入空仓库设置（默认值变化）；plugins/project-control/test/outbox-dispatcher.test.js 修复时点依赖（mock 时钟锚定真实时间，next_attempt_at 用真实时间戳，硬编码 13:00Z 在当天 13:00 后必挂）。
- 门禁：全量 test 347/347、check:plugins、pack:win、smoke:packed:dir（passed:true）、stage:releases 稳定版、preflight-publish 全部通过；0.1.1 资产 sha256：setup dac68d104f3990e10690cbb783aede0f5e6135af2ce4a66e5acabe00d2bb0f8e、portable 357152b4879642b12444b15e593e399e27ce5a52a6c9a0416b4b7969dc7dcb70。
- 发布流程：Draft 创建 → curl 上传（大文件一次 Connection reset，带重试后成功）→ API 校验 → 正式发布；凭据从 F:\QClawData\workspace\secure\github_token.txt 读取，全程未回显。
- 经验沉淀：见 经验.md「新坑（2026-08-15：发布与更新通道）」。

## 2026-08-15：稳定版 v0.1.0 首次 GitHub Release（私有仓库）发布

- 按 Cyrus 拍板（渠道 GitHub Release、仓库 SeeiiLee/deepseek-projectpl-console 私有、发布方式委托 DeepSeek 决定）完成首次发布：https://github.com/SeeiiLee/deepseek-projectpl-console/releases/tag/v0.1.0 ，Release id 371102104，tag v0.1.0；流程为 Draft 创建 → 上传 5 资产 → API 校验 → 正式发布，全程未回显 token。
- 资产 5 件，与本地 分发包\稳定版 逐一哈希一致：setup-x64.exe（102,706,490 B，sha256 71c1d3bc4fcb1dba4d81882f5dcab173de366b5a953dd3a0a5e8bc6b6cbf1cdb）、portable-x64.exe（102,146,170 B，sha256 f526e277cf5653510b5ee6f60daa4b6f444f38a74b54c38591e3c3e7d890ba34）、两件 .sha256、setup blockmap。
- 门禁：scripts/preflight-publish.js 通过（350 随包文件零密钥/零会话/零数据库）；发布说明正文不含个人路径（docs/release-notes/v0.1.0.md）。
- 凭据纪律：Cyrus 提供的新 fine-grained PAT 已存入 F:\QClawData\workspace\secure\github_token.txt（ACL 仅当前用户），旧 token 保留为 github_token.txt.previous；未写入仓库/日志/发布物。secrets.encrypted.json（cyrus-keyring 加密库）本轮未改动（本机未找到可用的 keyring 工具），待 Cyrus 提供工具后同步入加密库。
- 更新通道说明：仓库为私有，更新中心「公开 Releases」通道不适配（保持未配置），稳定版走人工下载安装；应用内更新方案（私有仓库凭据化 或 转公开）留待 Cyrus 另行拍板。
- 未决：本机未安装 gh CLI，发布经 HTTPS API 完成；token 轮换提醒沿用 2026-11-15。

## 2026-08-15：AnySearch 第三方网络搜索插件（测试版）开发与验收

- 新增 `plugins/anysearch`（`@cyrus/dsh-anysearch`，版本 `0.1.0-beta`）：Host 实现 AnySearch JSON-RPC `tools/call` 搜索适配、Markdown/JSON 结果到 `WebSearchResult` 的规整、credentials 解析、设置命名空间与 provider 注册；Client 新增独立设置页 `设置 → AnySearch 搜索`，可保存接口地址、API Key、API Key 引用并清除已保存密钥。
- 接入：`src/personal-plugins.js` 登记为第十四个个人插件；`plugins/cordis.patch.yml` 覆盖 `web.searchProvider: anysearch` 并插入 `cyrus-anysearch`。
- 验证：`check:plugins` 通过（anysearch typecheck / Host syntax / Client syntax 全过），`pack:dev:portable` 成功，测试版 Portable 已 stage 到 `分发包\测试版`；最新测试版 SHA-256 `a3da0c010342d1a23d2628bfc1fddb6d61bddbd5d071218e67f5fe687f8f32ff`。Cyrus 已在测试版中完成真实 `web_search` 搜索验收。
- 当前状态：测试版功能已通过，不单独封装稳定版；稳定版统一封装将在全部测试完成后按既有发布流程执行。


## 2026-08-15：GitHub 发布红线固化（凭证入库 + 发布前强制门禁）

- Cyrus 提供新的 GitHub PAT，已按其 keyring 方式加密入库（api.github.integration.token，旧 token 无损保留为 .previous，轮换提醒 2026-11-15，全程未回显未写入仓库）。
- 按 Cyrus 要求固化发布红线：新增 `scripts/preflight-publish.js` 门禁——扫描随包发布的全部文件（src/assets/plugins/protocol），命中任何密钥模式（github_pat_/ghp_/gho_/ghs_/sk-/AKIA/私钥块/Slack）或数据库/密钥文件名即阻断打包（exit 1）；docs 中的个人路径只报告不阻断，供发布 Notes 脱敏复核。已接入 `pack-desktop.js`（stable 身份打包前自动执行）。`.gitignore` 扩展覆盖 artifacts-dev/分发包/密钥/数据库/残留目录。规则文档见 `docs/PUBLISHING_RULES.md`；`test/preflight-publish.test.js` 4/4。

## 2026-08-15：收口——两包体终局（目录式副本退役，仅保留安装版稳定版 + 测试版 Portable）

- 按 Cyrus 要求收口：删除 `runtime-stable/`、`runtime-test/` 两个目录式副本、三个旧启动器（稳定版/开发版/测试版 .cmd）、同步脚本（sync-runtime-*、stable-instance-detect）及其测试；`package.json` 移除 sync:stable/sync:test。测试版入口统一为 `分发包\测试版\…Dev-…portable-x64.exe`（桌面/开始菜单「测试版」图标直指该文件），重复的 Dev.lnk 图标删除；「DeepSeek Harness Personal」图标保持指向已安装稳定版。`test/launcher.test.js` 重写为门禁/打包脚本/残留脚本断言 + 剩余 .cmd 编码检查；README 改为双包体布局说明。测试版 Portable 已从最新源码重建并通过开发版 packed smoke，分发包同步完成。

## 2026-08-15：双根目录方案完成（稳定版安装版 + F 盘数据正式启用）

- 结果：Cyrus 采用手动迁移（脚本自动迁移此前两次受阻：探测自匹配 + 迁移脚本自身 electron 宿主被误判），数据三份无损到位后安装版稳定版从 `D:\Cyrus Deepseek Harness` 启动，userData 与 DSH_HOME 均指向 `F:\documents\Cyrus Deepseek Harness Data`（渲染器进程参数验证），会话恢复成功（本开发会话在安装版内继续运行）。
- 修复：①探测匹配改到 Node 侧按进程名精确识别并**排除调用者自身进程**（electron-as-node 宿主不再自匹配）；②新增 `--finalize` 登记模式：对手动迁移好的树只核对并写 `迁移报告.txt` 与 `MIGRATED.marker`，不复制不删除；③修正默认 F: 路径在字符串求值中丢反斜杠的问题并加回归测试。已对真实 F 盘数据执行 finalize：数据 3034 文件/161MB、harness-home 280 文件/16MB、测试版存档 243 文件/18MB。`test/migrate-to-fdrive.test.js` 6/6、`test/client-process-detect.test.js` 3/3。

## 2026-08-15：双包体拆分落地（测试版/稳定版两个独立桌面端）

- 事故与加固（迁移工具第一跑）：Cyrus 在客户端未关闭时运行了迁移，进程探测在双击环境下失败被静默跳过，复制中途因文件占用中断，F 盘留下无标记的残缺目录（源数据零损失）。修复：①探测失败/不可读改为**拒绝迁移**（fail-safe，不再跳过）；②复制中途失败自动删除残缺目标，重试一键完成；③非空无标记目标视为上次残留，自动清理后继续。`test/migrate-to-fdrive.test.js` 扩到 4/4（含真实文件锁中断 + 残留自愈 + 探测失败拒绝）。重试步骤不变：关闭两个客户端 → 双击 一键迁移数据到F盘.cmd → 安装。

## 2026-08-15：双包体拆分落地（测试版/稳定版两个独立桌面端）

- 补充（Cyrus 三处选择已确认后的收尾）：①旧数据复制到 F 盘；②会话搬到 F 盘；③Cyrus 自己运行安装向导。为此：安装版稳定版的 DSH_HOME 规则内置（`resolveHarnessHomeOverride`：已安装＋稳定版身份 → `F:\documents\Cyrus Deepseek Harness Data\harness-home`，显式 `DSH_HOME` 优先，测试/目录式不受影响）；新增无损迁移工具 `scripts/migrate-to-fdrive.js` + 双击入口 `一键迁移数据到F盘.cmd`（纯 ASCII+CRLF）：复制旧稳定版用户数据 → F 盘根、复制 .dsh（排除 profiles 的 node_modules 启动基建）→ harness-home、测试版用户数据 → from-test-userdata 存档；运行中客户端防护、非空目标/防重跑标记、迁移报告含关键文件 SHA-256；`test/migrate-to-fdrive.test.js` 2/2。稳定版安装包已按新规则重建（setup `d4543437…`、portable `6d767c5a…`）并通过 packed smoke，分发包\稳定版 已更新。执行顺序（先关两个客户端 → 双击迁移 → 安装向导选 D:\Cyrus Deepseek Harness → 启动安装版核对）已写入 `docs/STABLE_INSTALL_PLAN.md`。

## 2026-08-15：双包体拆分落地（测试版/稳定版两个独立桌面端）

- 补充（第 5 轮）：`scripts/stage-releases.js` 对「文件被运行中包体占用」改为部分同步——跳过被占用文件（EBUSY/EPERM）、其余照常入包，以 exit 2 + 明确警告收尾（支持 `node scripts/stage-releases.js 稳定版` 单组同步）；新增真实 Windows 文件锁测试（powershell FileShare.None 持锁 + 轮询确认 + 部分同步断言，2/2）。更新中心对「已安装版 + 未配置发布仓库」提示改为「最新安装包人工升级」并加测试；全量 **302/302**。安装方案文档 `docs/STABLE_INSTALL_PLAN.md` 就绪（含产物清单、SHA-256、数据迁移、回滚与验收清单），执行前等 Cyrus 确认三个选择。

## 2026-08-15：双包体拆分落地（测试版/稳定版两个独立桌面端）

- 补充（Cyrus 定案的双根目录方案落地第一步）：`app-flavor.js` 新增 `resolveUserDataOverride`——仅当「已安装（app.isPackaged）＋稳定版身份＋无 `DSH_DESKTOP_USER_DATA` 覆盖」时，把 userData 指到 `F:\documents\Cyrus Deepseek Harness Data`（已核实 F: 为本地固定盘/NTFS/健康/剩余 238GB）；目录式稳定版与测试版保持原数据位置，过渡期安全；`test/app-flavor.test.js` 覆盖全部分支。安装版将安装到 `D:\Cyrus Deepseek Harness`（待 Cyrus 确认安装方式），测试版根目录维持 `D:\Deepseek Harness Personal` 不变。

## 2026-08-15：双包体拆分落地（测试版/稳定版两个独立桌面端）

- 补充：新增 `scripts/stage-releases.js`（`pnpm run stage:releases`）把已验证的两个包体分放到根目录下命名清晰的 `分发包\测试版\` 与 `分发包\稳定版\`，各带 `说明.txt`（包体用途、应用名、数据目录、校验方式、分辨方法）；`test/stage-releases.test.js` 1/1。用户以后只认这两个文件夹：文件名带 `-Dev-` 的是测试版，不带的是稳定版，运行后的托盘提示与设置页应用名、数据目录也各自独立。

### 本轮实现

- 双身份机制：`src/build-flavor.js`（打包时由 `scripts/pack-desktop.js` 切换的构建期常量）+ `src/app-flavor.js`（stable/dev 两套身份：应用名、AppId、快捷方式名/所有权标记、制品前缀）。`main.js` 启动时用 flavor 决定 `setName`/AppUserModelId/托盘标题/快捷方式路径与归属判断，Electron 的 userData 目录名随应用名自动隔离（dev 数据落在 `…\DeepSeek Harness Personal Dev`）。
- 打包脚本：`pnpm run pack:dev:portable` / `pack:dev:dir`（输出 `artifacts-dev/`，产物名带 `-Dev-`）与 `pack:win` / `pack:win:dir`（稳定版，输出 `artifacts/`）统一走 `scripts/pack-desktop.js`；dev 差异全部用 electron-builder `-c.` 覆盖（`${env.*}` 宏在 productName 上不展开，已弃用该方案）。打包结束把 flavor 恢复为 stable。
- 修了两个打包期 bug：① 根 `build.files` 漏了 `plugins/*/templates/**/*` → 封装版 `/templates` 返回 409、packed smoke 失败；② smoke 探针里把主进程变量 `appFlavor` 当渲染器变量引用 → ReferenceError；③ 通过 node 直启 electron-builder 时 pnpm 收集器找不到 pnpm → 统一经 `npx pnpm run` 执行。
- 验证：开发版解包 smoke 与稳定版解包 smoke 双双通过（schema 8、模板 200、双能力探针）；**并存验证通过**——测试版 Portable（PID 4744 树）与用户正在运行的稳定版（PID 42788 树）同时存活，进程树/数据目录完全独立，关闭测试版后稳定版 4+1 进程无恙。

## 2026-08-15：独立测试版副本 + 三入口用户数据隔离

### 本轮实现

- 起因：开发版与稳定版此前共用同一 userData 与 `DSH_HOME`（单实例锁互斥、共享会话/设置/项目数据库），插件开发期间两者互相干扰；上一轮「运行中热换目录」的崩溃也要求给测试提供真正独立、可验证的副本。
- `scripts/sync-runtime-copy.js` 抽出稳定版/测试版共用的物化核心（启动门 → staging → 原子换入 → 换入前后运行中实例守护）；`scripts/sync-runtime-test.js` 生成 `runtime-test/`（`TEST.json` 印章），`pnpm run sync:test`。
- 新增 `启动 DeepSeek Harness 测试版.cmd`：从 `runtime-test/` 启动并设置独立用户数据（`DSH_DESKTOP_USER_DATA=%APPDATA%\DeepSeek Harness Personal Test`）与独立 Harness home（`DSH_HOME=…\harness-home`）——会话、设置、项目数据库、单实例锁全部与日常客户端隔离，**可与稳定版同时运行**；纯 ASCII+CRLF。
- `启动 DeepSeek Harness 开发版.cmd` 同样隔离到 `…\DeepSeek Harness Personal Dev`，开发预览不再与日常客户端抢单实例锁。
- 桌面与开始菜单新增“DeepSeek Harness Personal 测试版”快捷方式；快捷方式自修复只管理固定名的稳定版链接，不会误改。
- 更新流程固化：开发树 → 全量门禁 → `sync:test` → Cyrus 验证测试版 → 关闭稳定版 → `sync:stable` 才更新日常客户端。

### 验证

- `test/runtime-test-sync.test.js` 2/2（临时目录：结构完整性 + 测试树自身门禁 + 幂等二次同步 + 启动器隔离断言）；launcher 测试扩展三启动器纯 ASCII/CRLF 与隔离环境变量断言；稳定版启动器保持原始数据位置。全量测试随 Gate 2D 基线一起通过。

## 2026-08-15：稳定版被同步换目录打崩 + 运行中实例守护

### 事故与根因

- 在稳定版客户端运行期间执行 `sync:stable`：Windows 对「进程仍在使用」的目录**不提供 rename 保护**——目录树里的文件按 delete-on-close 语义删除（rm 先成功、句柄关闭时文件才消失），运行中的旧实例后续读取时命中已消失文件而整体崩溃。此前同步脚本注释假设「在用时 rename 会干净失败并保留旧目录」，该假设在 Windows 上不成立。
- 恢复：用户重启后（06:01:31）新实例加载已换入的新构建，真实数据库在 06:01:37 干净完成 v7→v8 迁移并保留 pre-v8 在线备份，当前实例健康。

### 修复

- 新增 `scripts/stable-instance-detect.js` 纯匹配器（区分稳定版主进程的相对参数 `"runtime-stable"` 与子进程的 `--app-path=<target>`，大小写不敏感、带 token 边界，开发版实例/无关 Electron 不误报）；`scripts/sync-runtime-stable.js` 在开始与换入前各检测一次，发现运行中实例即以 exit 2 拒绝并保留旧目录。
- 新增 `test/stable-instance-detect.test.js` 4/4；并用真实运行中实例做了端到端验证（拒绝、exit 2、`STABLE.json` 未被触碰）。

## 2026-08-15：Gate 2D P5 文档索引与重命名重绑定完成

### 本轮实现

- 迁移 `0008_document_index.sql` 把 SQLite 升到 `schemaVersion=8`：`project_document_states`（逐绑定 ok/changed/missing/unreadable、观测哈希、字节数、有界解析诊断、revision 在哈希或状态变化时递增）与 `project_document_rebind_proposals`（proposed/accepted/rejected/superseded、候选路径列表、unambiguous 标记、唯一 (project, role, missing_path)）。两表都不保存正文，`boundedJson` 之外的任何内容字段被结构拒绝。
- Host 管线 `src/document-index.ts`：managed 以 manifest mirror 为准、legacy 以确认过的 DB binding 为准；逐绑定 `lstat→realpath` 容器检查后按 8 MiB/64 MiB 预算读取哈希；`.md/.yaml` 文本再尝试 frontmatter/YAML 子集解析并把失败记录为 `FRONTMATTER_UNTERMINATED/FRONTMATTER_PARSE_FAILED/DOCUMENT_PARSE_FAILED/TEXT_ENCODING_UNSUPPORTED` 诊断；对缺失且携带已知哈希的绑定做有界目录遍历（5000 项/6 层/跳过忽略目录）按内容哈希搜重命名候选。
- 重绑语义：无歧义候选可直接人工应用；多候选必须显式选择路径；accepted/rejected 结果跨刷新粘滞，绑定恢复后提案 superseded；应用重绑在单事务内换绑 `project_document_bindings`、bump 项目 revision 并关闭提案；managed 项目接受重绑被 `managed_manifest_authoritative` 拒绝（manifest 是唯一事实源，需先改 manifest）。
- HTTP：`GET /projects/:id/documents`、`POST /projects/:id/documents/refresh`、`POST /projects/:id/document-rebinds/:proposalId/resolve`；capabilities 增加 `project.documents.read/refresh` 与 `project.document-rebind.resolve`。Console 在项目列表每项增加“文档索引”面板：刷新核对、来源（manifest/已确认）、逐文档状态/哈希/解析诊断、重绑提案的应用（无歧义一键、歧义下拉选择）/忽略，managed 提案显示“先更新 manifest”提示。
- 边界：文档刷新只形成候选与诊断，不产生 Domain Event/Outbox，不根据文本语气推进 WorkItem/Review；正文永不进入全局数据库。

### 验证

- `plugins/project-control/test/document-index.test.js` 5/5（仅临时 fixture）：状态修订与非法输入拒绝、legacy 重绑接受/拒绝粘滞与项目 revision、歧义候选人工确认与 managed 权威、管线端到端（哈希核对/重命名/歧义/supersede/内容变化/解析诊断/无正文入 DB 字节级验证/零事件）、HTTP 三端点与错误映射。全量 `pnpm test` 现为 **289/289**（含运行中实例守护 4/4）、`check:plugins` 十三插件全过、开发态 smoke（schema 8 + 文档能力探针）通过。

## 2026-08-15：稳定版启动确认（Cyrus 已签收）

- 桌面图标 / `启动 DeepSeek Harness 稳定版.cmd` 双击后正常进入客户端，稳定版启动问题宣告修复。此前三项根因（漏拷 `cordis.patch.yml`、GBK 代码页破坏 cmd 解析、单实例锁静默退出）均已处置；`boot-error.log` 启动日志继续作为永久诊断。

## 2026-08-15：启动器编码修复（中文注释在 GBK 控制台破坏 cmd 解析）

### 根因与修复

- 稳定版/开发版两个 `.cmd` 之前包含 UTF-8 中文注释。在中文 Windows 的默认控制台（GBK 代码页 936）中执行时，UTF-8 中文字节被按 GBK 双字节对解析，某些尾字节落在 ASCII 特殊字符区间，会“吞掉”后续行中的 `%`、`[` 等字符——用户看到的 `'CTRON_EXE'`（`%ELECTRON_EXE%` 被吃）、`'ERROR]'`（`[ERROR]` 被吃）和“系统找不到指定的路径”就是这种跨行解析损坏。桌面图标通过 cmd.exe 执行同一脚本，所以同样失败；而开发版之所以“能用”，只是因为用户在资源管理器中双击时……实际同源，本应同样受影响，一旦在 GBK 控制台执行都会坏。
- 修复：两个 `.cmd` 全部改为 **纯 ASCII + CRLF**（中文注释换成英文，`WriteAllText` 按 ASCII 编码落盘并规范化换行），彻底消除代码页交互；用 `cmd /c` 模拟执行验证通过（verify-launch → LAUNCH_OK）。
- 补充：主程序新增永久启动日志（`boot-error.log`：uncaughtException/unhandledRejection/failAndExit/启动关键步骤），稳定版与开发版各自目录各写一份；单实例锁冲突改为弹出明确提示框。

### 验证

- 两个 cmd 校验：0 个非 ASCII 字节、CRLF 行尾；模拟执行通过。`pnpm test` **280/280**。

## 2026-08-15：稳定版启动失败修复（漏拷 cordis.patch.yml）

### 根因与修复

- 稳定版（`runtime-stable/`）此前每次启动都在 Harness 就绪前崩溃退出：`harness-helper.js` 需要仓库根目录 `plugins/cordis.patch.yml`（Personal 插件 overlay 补丁），而 `scripts/sync-runtime-stable.js` 只拷贝了各插件目录下的 `lib/package.json/migrations/templates`，漏掉了插件根目录的这个补丁文件——窗口还没出现进程就退了，所以用户看到的只有“没反应”。
- 修复：同步脚本显式拷贝 `plugins/cordis.patch.yml`；`scripts/verify-launch.js` 启动门新增该校验（仓库与稳定版两侧都检查）；`test/runtime-stable.test.js` 增加补丁文件断言（目录计数改为只统计目录）。
- 验证方式升级：用隔离环境（临时 `DSH_HOME`/userData/workspace）真实启动稳定版实例并抓取 stderr，确认 Harness 就绪、页面加载、50 秒无崩溃后才宣告修复；此类“启动即崩”今后会被启动门 + 实例级启动诊断两道关卡挡住。
- 另：主程序在单实例锁冲突时改为弹出明确提示框（不再静默退出）；诊断产生的临时文件已清理。

### 验证

- `pnpm test` **280/280**；`runtime-stable` 已重新同步并通过启动门 + 真实启动验证。

## 2026-08-15：入口统一为稳定版/开发版 + 仓库整理 + 旧制品清理

### 本轮变更

- 启动入口统一为根目录两个双击脚本：`启动 DeepSeek Harness 稳定版.cmd`（日常使用，从 `runtime-stable/` 启动，与开发树隔离）与 `启动 DeepSeek Harness 开发版.cmd`（插件开发验证，构建+启动门后从开发树启动）。原“桌面版.cmd”与“（快照）.cmd”删除；同步脚本更名为 `scripts/sync-runtime-stable.js`（`pnpm run sync:stable`），目录/印章统一为 `runtime-stable/STABLE.json`。
- 文档归位：10 份规范/状态文档与 `compat.json` 移入 `docs/`，根目录只保留 `README.md` 入口；所有交叉链接已修正（README→docs/*、docs→../README、docs→../plugins/...）。
- 制品归位与清理：散落在根目录的 Portable EXE 移入 `artifacts/` 后与旧 NSIS/Portable 制品一并删除；`artifacts/README.md` 建立产物清单。
- **重要发现**：清理时发现用户当时运行的客户端是 `artifacts\win-unpacked\DeepSeek Harness Personal.exe`（Gate 2C 旧主程序 + 联接加载的最新插件）——这解释了此前若干次“新 UI 可见但行为异常/崩溃”的现象（旧主程序与新插件的组合并非受支持形态）。`win-unpacked` 因运行中进程锁定残留 8 个文件，待应用退出后删除。
- 桌面与开始菜单的 `DeepSeek Harness Personal` 快捷方式已重新指向稳定版入口（cmd 包装、窗口最小化、应用图标不变）。

### 验证

- `pnpm test` **280/280**；`runtime-stable` 已按最新门禁生成并通过自身启动门。上游零修改。

## 2026-08-15：C 档运行时快照隔离 + 模板路径/字体修复

### 本轮实现

- **C 档运行时隔离（稳定版/开发版双入口）**：新增 `scripts/sync-runtime-stable.js`——启动门全绿后把 `src/`、`assets/`、`package.json`、十三插件的 `lib/package.json/migrations/templates` 复制到 staging 目录，再同盘原子换入 `runtime-stable/`（在用时 rename 会干净失败并保留旧目录）；新增 `启动 DeepSeek Harness 稳定版.cmd`（只对稳定版自身跑启动门后启动，完全不读开发树）与 `启动 DeepSeek Harness 开发版.cmd`（构建+启动门+从开发树启动，用于插件开发验证）；`pnpm run sync:stable` 与 `test/runtime-stable.test.js`（2/2）同步接入。此后日常使用走稳定版入口，仓库内的编辑与 bundle 重建不会再影响运行中的客户端（这正是此前两次客户端崩溃的根因）。
- **模板清单回归修复**：模板目录解析在构建产物（`lib/index.js`）与源码（`src/templates/registry.js`）下的相对层级不同，且 `src/templates/` 因存在 `registry.d.ts` 让“目录存在”判定误中——真实桌面因此读到空模板清单（模板下拉禁用、预览按钮禁用、新建失败）。改为按“目录内存在 `<id>/<version>/template.json`”选择候选目录，源码与 bundle 两种运行形态都正确；插件 `files` 增加 `templates/**/template.json` 以便未来打包。
- **smoke 补盲区**：新增 `templateStatus/templateCount` 校验（真实 Host bundle 必须能返回 ≥3 个模板），并保留上一轮的 renderer console 转发——这次回归如果再发生，smoke 会直接红。
- **字体放大**：Project Console 全套字号上调（8/9/10/11/15px → 11/12/13/14/17px，行高同步），解决控制台文字过小的问题。

### 验证

- `pnpm test` **280/280**、`check:plugins` 退出码 0、开发态 smoke 通过（模板接口 200/≥3、`projectCreatePresent`、schema 7）；`runtime-snapshot` 已按最新门禁生成并通过自身启动门。上游零修改；未重建打包制品。

## 2026-08-15：Gate 2D P3 收尾：快速新建 Console 表单 UI

### 本轮实现

- Project Console 新增“快速新建标准项目”入口与完整表单流：`create-parent` 系统目录选择（`directoryBridge`）、目录名/项目名输入、模板下拉（`GET /templates`，显示 displayName·version 与 description）、预览页（templateId/templateVersion/templateHash、最终 projectId、目标路径、逐项 create_directory/create_file 操作清单与内容哈希前缀、明确的“已存在路径会阻止创建，不覆盖任何文件”提示）、确认提交（`prepareCreate` → `submitLifecycle`）以及成功/失败/返回修改/取消的状态机。创建成功仅刷新项目列表，不打开 Workbench、不切换会话。
- 客户端类型与 normalizer 同步（`PrepareCreateInput/PrepareCreateResult/ProjectTemplateSummary`）；目录选择桥、桌面 main/bridge 与插件 verifier 的 `create-parent` kind 早已打通，本轮只是 UI 消费。
- smoke 增加 `projectCreatePresent` 校验（main.js 的 passed 门禁要求“快速新建标准项目”按钮真实渲染），并在 smoke 模式新增 renderer console 转发（`console-message` → 捕获输出），后续任何渲染期异常都会直接出现在 smoke 日志里。
- 修复：main.js 中 `projectCreatePresent` 因分步编辑产生的重复声明（渲染器 `Uncaught SyntaxError: Identifier has already been declared`，正是这轮 smoke 失败的直接原因——现在此类问题会被启动门前的 smoke 立刻抓出）。

### 验证与当前边界

- `pnpm test` **278/278**、`pnpm run check:plugins` 退出码 0、开发态 Electron smoke 通过（`projectCreatePresent: true`、schema 7、优雅退出、端口关闭）。
- 表单流的人工端到端（真实点击创建）建议 Cyrus 在桌面端用临时父目录验证一次；自动化覆盖在 Host 侧（create.test.js 9/9）。未重建 `win-unpacked`/Portable/NSIS；上游零修改；零真实项目写入。

## 2026-08-15：Gate 2D P4 Legacy 安全升级 + B 档启动门完成（仅临时 fixture）

### 本轮实现

- **P4 升级管线**：`POST /intake/projects/:id/prepare-upgrade` 从 `linked_legacy` 项目生成最小升级计划（只新增 `.dsh-project/project.yaml`，docsRoot `.`、entries 镜像已确认 DB 绑定、origin imported、标准输出目录声明；manifest 生成后经 YAML 子集解析 + project-manifest Schema 校验）；legacy fingerprint = 规范化 JSON `{projectId, documentBindings[{role,relativePath,contentHash}]}` 的 SHA-256；计划绑定 `srt_` 授权行（TTL）承载升级时间窗，冻结 upgrade payload 不含 sourceRootRef 的合同得到尊重（解析时按计划取 source_root 授权行 + 按 `locationRef` 核对活动位置）。
- `resolveUpgrade` 复核签名/计划状态/命令形状/planHash 重算/DB 绑定指纹/逐份文档文件哈希/确定性重渲染；文档变化、修订变化抛 `WRITE_PLAN_STALE`（携带 currentRevision）。`storage.registerUpgradeManaged` 在文件 `files_committed` 复验后同一事务内完成 mode→managed、revision+1、origin imported、manifest mirror、plan accepted、Receipt/`project.managed.upgraded` Event/Outbox。
- 升级文件同步复用 P2 适配器（atomic_additive、授权根=项目根、回滚只删本次落盘路径）；域拒绝后回滚并置 plan rolled_back，mode 保持不变。
- **B 档启动门**：新增 `scripts/verify-launch.js`（十三插件双 bundle 存在/非空/语法/client id 标记、桌面主进程四文件语法、migrations 0001–0007）；`pnpm start` 与双击 `.cmd` 在 build 后、Electron 前执行；`scripts/build-plugins.js` 每个插件构建后立即语法校验双 bundle 并核对 client id，坏产物不会成为磁盘最后状态。`test/launcher.test.js` 新增启动门实测。
- 新增 `plugins/project-control/test/upgrade.test.js` **5/5**：端到端升级（manifest 解析/Schema 校验、PRD/README 逐字节不变、事件与重放）、文档变化拒绝、篡改拒绝、`.dsh-project` 占用拒绝（占位文件保留）、二次升级 MODE_CONFLICT。

### 验证与当前边界

- `pnpm test` **278/278**、`pnpm run check:plugins` 退出码 0、开发态 Electron smoke 通过（schema 7、启动门 green）。
- 本轮修复：升级 payload 不含 sourceRootRef（遵循冻结 Schema）导致的引用解析失败；displayPath（8.3 短名）与 normalizedPath（realpath 长名）不一致导致的计划目标校验失败；documentCount 数字经过文本化 normalizer。
- 未做：快速新建 Console 表单 UI（P3 收尾）、P5 文档刷新/索引同步、C 档运行时快照隔离（Gate 2D 完成后暂停执行）。没有写任何真实项目目录、没有重建 `win-unpacked`/Portable/NSIS、上游 `D:\Deepseek Harness` 零修改。

## 2026-08-15：Gate 2D P3 标准项目快速新建 Host 管线完成（仅临时 fixture）

### 本轮实现

- 内置三模板 `minimal-standard/software-standard/research-standard@1.0.0` 落盘于 `plugins/project-control/templates/<id>/<version>/template.json`；新增 `src/templates/registry.js`（Schema 严格校验、Host 规则：唯一 project.yaml 全五占位符、目录恰好覆盖文件祖先、无未定义 token、总字节上限；`templateHash` 规范化定义与确定性渲染；渲染后 project.yaml 经真实 YAML 子集解析并通过 project-manifest Schema）。
- 迁移 `0007_file_sync_plan_refs.sql`：`file_sync_plans.render_params_json` 列 + 计划绑定 `loc_`/`srt_` 引用表（instance/scope/有效期/撤销校验，目标严格位于父目录内）；SQLite `schemaVersion=7`。
- storage 新增 `issueFileSyncPlanRefs/resolveFileSyncPlanRefs` 与 `registerCreatedProject`：新建在文件 `files_committed` 复验后于同一事务提交 managed Project(revision 1)/location/manifest mirror/document bindings/Receipt/`project.managed.created` Event/Outbox，并把 plan 置为 accepted；计划哈希/命令归属/状态/位置冲突全部在事务内复核。
- intake 新增 `prepareCreate`（`create-parent` 单次授权票、目标空目录预检、渲染、planHash/manifestHash 计算、计划+引用签发、签名 create 命令）与 `resolveCreate`（签名/引用/计划状态/命令形状/模板哈希/planHash 重算/重渲染逐文件哈希复核）；桌面 main/bridge 与插件 verifier 的 selection ticket 同步支持 `create-parent`。
- `GET /templates` 与 `POST /intake/prepare-create` 路由 + 双端脱敏/白名单 normalizer；Client API 增加 `listTemplates/prepareCreate`；scanner 跳过 `.dsh-staging.` 前缀目录。
- lifecycle 执行器接入 create 分支；`storageLifecycleAdapter.createProject` 编排“计划状态机（planned/rolled_back 重执行，files_committed 复验续跑）→ registerCreatedProject → 域拒绝时回滚文件并置 rolled_back”；启动恢复 `recoverPendingFileSyncPlans` 在 Host 打开时处理残留。
- 新增 `plugins/project-control/test/create.test.js` **9/9**：模板清单、端到端创建与重放、占用目标拒绝、TOCTOU 竞争、W3 续跑、篡改拒绝（REFERENCE_UNRESOLVED）、票据单次使用、引用过期、第二控制面凭项目文件恢复身份（portability）。全部在 mkdtemp 临时 fixture 上执行。

### 验证与当前边界

- `pnpm test` **272/272**、`pnpm run check:plugins` 退出码 0、开发态 Electron smoke 通过（`schemaVersion=7`）。
- 本轮修复：`return await` 保证 create 拒绝进入业务错误映射；`boundedJson` 返回字符串导致 renderParams 二次字符串化（改为校验后存原对象）；目录操作不带 contentHash（冻结 Schema additionalProperties 约束）；插件内 selection-ticket verifier 与桌面 issuer 的 kind 枚举同步。
- Project Console 的快速新建表单 UI 尚未实现（Client API 契约已就绪）；`upgradeManaged` 仍返回 `CAPABILITY_NOT_NEGOTIATED`（P4）。没有写任何真实项目目录、没有重建 `win-unpacked`/Portable/NSIS、上游 `D:\Deepseek Harness` 零修改。

## 2026-08-15：Gate 2D P2 受控文件适配器完成（仅临时 fixture）

### 本轮实现

- 新增迁移 `0006_file_sync_plans.sql`：`file_sync_plans` 持久化 write plan journal（planId/commandId/kind/projectId/syncPolicy、目标根与 staging 路径、planHash/manifestHash、operations/created_paths JSON、root_preexisted_empty、error_code），状态机 planned→staging→staged→files_committed→accepted/rolled_back/recovery_required，`rolled_back→staging` 允许同 commandId 重试；SQLite `schemaVersion` 升至 **6**。
- `plugins/project-control/src/host/storage.js` 新增 `createFileSyncPlan/getFileSyncPlan/listFileSyncPlansForRecovery/setFileSyncPlanState`：输入严格校验（pln_/cmd_/prj_ UUIDv7、sha256: 线格式、operations 1..500、relativePath 防逃逸、create_file 必须带 contentHash、create_directory 禁止 contentHash、UNC/非绝对路径拒绝）、乐观状态转移（transition_invalid/state_conflict/plan_id_conflict）。
- 新增 `plugins/project-control/src/filesync/plan-executor.js`：写盘领域校验（路径唯一、目录集合⊆文件祖先、恰一个 `.dsh-project/project.yaml` 且 contentHash=manifestHash、原子化规范执行顺序、`planHash` 由 Host 重算）；同盘 staging（新建=父目录 `.dsh-staging.<planId>` 整树 rename；升级=目标根内同名目录逐顶层 rename，既有父目录仅作空透传镜像）；文件 `wx` 写入 + fsync + 逐文件哈希核对；rename 前二次 absent 检查（TOCTOU）；落盘后全量复验；回滚逆序删除且**只删本次 rename 过的路径**，绝不删除占用目标的既有内容；启动恢复 `recoverPlan`（staging/staged 残留删除→rolled_back；files_committed 复验一致→resumable，不一致→recovery_required 且不删文件）。symlink/junction 占用一律视为路径已存在，绝不跟随。
- scanner 跳过 `.dsh-staging.` 前缀目录，崩溃残留不会污染候选/文档索引；`parseYamlSubset` 导出供合同测试复用。
- 新增 `plugins/project-control/test/filesync.test.js` **15/15**：全量成功创建、空目录内创建、占用目标拒绝（占位文件原样保留）、stage 与 commit 之间出现目标的 TOCTOU 竞争、additive 升级只增不改、additive 冲突不覆盖、内容缺失失败注入、W1/W2 中断重启恢复、W3 复验续跑与篡改 quarantine、rolled_back 后同计划重试、journal 转移/唯一性/乐观冲突、symlink 占用、UNC 拒绝、扫描跳过；全部在 mkdtemp 临时 fixture 上执行，无真实项目写入。

### 验证与当前边界

- `pnpm test`：**263/263**（新增 filesync 15 例）。`pnpm run check:plugins`：十三插件全过、退出码 0。`pnpm run smoke`：开发态 Electron 通过，Project Control `schemaVersion=6`、四轨、优雅退出、端口关闭、写者锁释放。
- `scripts/smoke.js` 与 `src/main.js` 的 schema 断言随迁移升为 6；`storage.test.js` 的 fresh-DB 断言与探针迁移编号同步（探针改为 `0007_probe.sql`），v4→v5 迁移测试仍按当时迁移集校验 5。
- 本轮仍是 P2 适配器层：没有接线 lifecycle（`createFromTemplate`/`upgradeManaged` 仍返回 `CAPABILITY_NOT_NEGOTIATED`）、没有新增客户端 UI、没有重建 `win-unpacked`/Portable/NSIS、没有写任何真实项目目录；上游 `D:\Deepseek Harness` 零修改。
- 下一项为 P3：把模板渲染、ref 签发与 `createFromTemplate` lifecycle 接线接通（仍先用临时 fixture 验收）。

## 2026-08-15：Gate 2D P1 合同冻结完成

### 本轮实现

- 新增 [`PROJECT_TEMPLATE_SPEC.md`](PROJECT_TEMPLATE_SPEC.md)，冻结 Gate 2D 全部执行合同：模板注册表身份/版本/来源/兼容规则、五个渲染占位符、templateHash 规范化定义；write plan 沿用 Gate 2B 已冻结的 lifecycle `$defs.writePlan`（expectedState 仅 absent，v1alpha1 禁止覆盖/移动/删除）并补齐 Host 领域规则；W1–W4 崩溃窗口与启动恢复；文件先提交并复验 → SQLite 后提交的一致性协议；用户取消/路径占用/已有文件/非法 manifest/磁盘不足/进程崩溃的结果表。
- 新增机器合同 `protocol/project-control/v1alpha1/templates/schemas/template-manifest.schema.json`（JSON Schema 2020-12，templateId/templateVersion 严格格式、64 项/64 KiB 上限、路径防逃逸、additionalProperties 关闭），以及 2 份 valid + 6 份 invalid fixtures 和 `examples/index.json`。
- 新增 [`plugins/project-control/test/template-contract.test.js`](../plugins/project-control/test/template-contract.test.js)（7/7）：Schema 严格编译、fixtures 全量核对、Host 规则（唯一 project.yaml、五占位符、目录集合恰好覆盖文件祖先、非法 token 拒绝）、替换后 project.yaml 经真实 YAML 子集解析并通过 project-manifest Schema、templateHash 键序无关/files 排序/目录项无 content/内容与版本敏感。
- `plugins/project-control/src/discovery/runtime.js` 导出 `parseYamlSubset`，供合同测试与后续 P2/P3 渲染器复用，无行为变化。

### 验证与当前边界

- `pnpm test`：**248/248**（新增 7 例）。`pnpm run check:plugins`：十三插件全部通过、退出码 0。
- 本轮只冻结合同、Schema、fixtures 与测试，没有改动已冻结 lifecycle Schema 字节、没有新增数据库迁移、没有写任何项目目录；`createFromTemplate` 与 `upgradeManaged` 仍返回 `CAPABILITY_NOT_NEGOTIATED`。
- 下一项为 P2：按本合同在仅临时 fixture 上实现同盘 staging/fsync/哈希复验/原子 rename/回滚/启动恢复的文件适配器。

## 2026-08-15：DeepSeek Harness 接手验证（P0）完成

- DeepSeek Harness 已按 [`HANDOVER_TO_DEEPSEEK_HARNESS.md`](HANDOVER_TO_DEEPSEEK_HARNESS.md) 第二节顺序读完移交入口、README、PROGRESS、NEXT、四份规范、DEVLOG 与 `compat.json`，并把本机状态与移交文档逐项核对。
- 上游无漂移：`D:\Deepseek Harness` HEAD 仍为 `47f943859bef60e4160492346772ded9b24f765a`（rc.5），tracked/staged diff 为零，唯一未跟踪文件仍是已知的 `启动 DeepSeek Harness.cmd`。
- `pnpm test`：**241/241 通过**，skipped 0、todo 0。
- `pnpm run check:plugins`：十三个插件 build/typecheck/Host+Client 语法与专项测试全部通过，退出码 0。
- `pnpm run smoke`：开发态真实 Electron 通过；boot graph 为十三个个人插件且不含官方 layout，四轨网格、Project Console `schemaVersion=5`、真实空项目列表、Workbench 页签/布局恢复、终端 dock、优雅退出 `graceful=true` 与 `portClosed=true` 全部通过。
- 本轮环境说明：本机 PATH 中没有全局 `pnpm`（`corepack` 也未启用），门禁通过 `npx pnpm@11.19.0` 执行，与 `compat.json` 的 pnpm 版本一致。`pnpm test` 使用 PowerShell `2>&1 | Select-Object` 管道会因原生 stderr 产生假的退出码 1，改用 `*> log` 重定向后确认退出码 0；后续门禁统一用重定向方式记录。
- 本轮只做只读验证，没有修改上游、没有改动功能代码、没有重建 Portable/NSIS，也没有 commit、push 或发布。
- 下一项按 [`NEXT.md`](NEXT.md) 进入 Gate 2D P1：冻结 template registry 身份/版本与 write plan DTO 的 crash/retry/replay 语义，随后只在临时 fixture 上实现文件适配器。

## 2026-08-15：开发正式移交给 DeepSeek Harness

- Cyrus 决定以后不再在 Codex 线程中继续本项目开发，全部开发工作交由 DeepSeek Harness 自主完成。
- 新增 [`HANDOVER_TO_DEEPSEEK_HARNESS.md`](HANDOVER_TO_DEEPSEEK_HARNESS.md)，集中记录产品构想、四轨架构、Project Control/Workbench 边界、数据事实归属、流水线、十三插件现状、四项目本机接入信息、关键代码地图、验证证据、已知风险和接手纪律。
- 新增 [`NEXT.md`](NEXT.md)，把下一阶段锁定为 Gate 2D，并按合同、文件适配器、标准新建、legacy 升级、文档刷新、Gate 2E、Project Console 和 Workbench 排列执行顺序与验收。
- README、PROGRESS、compat 和 BLOCKED 已同步移交状态；当前 `win-unpacked` 是 Gate 2C 最新验证制品，Portable/NSIS 仍是 Gate 2C 前旧制品。
- 本次只完成文档移交和状态校准，没有继续开发功能、修改只读上游、安装制品、重建 Portable/NSIS、commit、push 或发布。

## 2026-08-15：Project Control Gate 2C 现有项目只读接入完成

### 本轮实现

- Project Control 数据库升级到 `schemaVersion=5`。不可变迁移 `0003_intake_discovery.sql` 让来源目录、扫描任务、候选、候选文档、导入问题以及限时 `loc_`/`srt_` 引用进入全局控制面；`0004_windows_path_nocase.sql` 保留无法归属到单一候选的来源级 `import_job_issues`，并作为 v4 阶段的 ASCII `NOCASE` 防线；`0005_windows_unicode_path_key.sql` 引入由 Host 生成的版本化 Unicode `path_key`（Windows 分隔符规范化、NFC、稳定 Unicode lower），统一覆盖 source root、active workspace、候选 latest/ignore 以及 register/rebind 的路径身份判断。若 v4 旧库已有 Unicode 等价重复路径，v5 升级会失败回滚并保留 pre-v5 backup，而不是静默选择、合并或删除记录。重复扫描继续保留审计记录，默认列表按项目 `path_key` 折叠到最新候选，忽略状态可以恢复且不在项目中落隐藏文件。
- 桌面主进程新增系统目录选择入口。Renderer 取得的是由进程内秘密签发、单次使用、短期有效且绑定 `source-root`/`project-root` 用途的授权，不具备提交任意绝对路径要求 Host 扫描的能力；HTTP 和 lifecycle 业务输入也不把绝对路径当作可信事实。
- 只读 scanner 支持来源目录的直接子项目扫描和单项目扫描，识别受支持 manifest、版本库/清单标记以及 README、PRD、DEVLOG、PROGRESS、NEXT、架构和 ADR 等候选文档。扫描有目录/文件数量、读取大小和响应大小上限，跳过依赖/构建目录，不跟随会逃出授权边界的符号链接或 junction；不可读、超大、二进制或编码异常内容只形成问题，不写项目目录。Managed manifest 声明的文档会按相对路径直接做 containment/read/hash，不受 heuristic `maxDepth` 影响；必需文档缺失会在扫描期阻断，可选文档缺失保留声明与 null hash。
- `/__personal/project-control/v1alpha1` 已增加来源目录列表、授权扫描、候选列表/详情、忽略/恢复和确认准备接口。扫描只保存 `discovered`/`conflict`/`relocation_candidate` 候选，不自动创建 Project；用户可以在 Project Console 选择候选，并在 Workbench 的 `project-control.candidate-details` viewer 中审阅证据、问题、短预览，修改 legacy 显示名称和文档角色或将文件排除出索引。Managed 文档绑定由已验证 manifest 锁定，只读显示并支持同一 role 的多个路径。候选列表/扫描响应只返回计数与轻量摘要，点击详情才读取完整文档和问题 DTO。
- 确认操作会重新扫描候选并核对所选文档 SHA-256，再由 Host 签发绑定当前应用实例、候选与 revision 的限时 `loc_`/`srt_`。lifecycle resolver 在执行前再次验证候选状态、路径、身份、actor/provenance、命令 kind/target 和文档哈希；Host 对完整签发命令做 HMAC 绑定，候选转为 `imported` 与 `registerLegacy`、`registerManaged` 或 `rebindLocation` 的 accepted 事务原子提交，失败不会留下半登记候选。响应丢失后的相同 signed command 会从持久化 Receipt 返回 `replayed`，同 commandId 的篡改请求返回 `IDEMPOTENCY_CONFLICT`，不重复写 Event/Outbox。
- `linked_legacy` 仍是既有项目的默认确认结果，不写 manifest 或任何项目文件。有效且受支持的 manifest 可以按其稳定身份登记为 `managed`；managed 重新绑定只有在新位置身份完全一致、旧 active 位置确实不可访问时才成为候选，两个位置同时可访问时继续报冲突，不把复制品误认成移动。

### 真实项目只读验收

- 食溯 App：扫描成功，识别 51 份候选文档，建议 `linked_legacy`。
- Amazon Store：扫描成功，识别 6 份候选文档，建议 `linked_legacy`。
- Cyrus 量化模拟：扫描成功，识别 14 份候选文档，建议 `linked_legacy`。
- Cyrus Music：扫描成功，识别 2 份候选文档，建议 `linked_legacy`。
- 验收只记录项目名称、数量、分类、证据和问题，不在开发日志写入绝对私有路径或正文；扫描前后保持项目目录零写入。四项只是候选发现验收，没有替用户自动登记到正式项目总览。

### 验证与当前边界

- scanner、storage、签名授权、HTTP、Client、Workbench viewer 和 lifecycle resolver 已通过专项自动验证；最终全量 `241/241`，十三插件构建/类型/语法门禁通过。开发态与 `artifacts\win-unpacked` Electron smoke 均验证 schema 5、API/UI 入口、优雅退出、端口关闭与进程树清理；封装目录内已核对 preload、最新 Project Control Host/Client bundle 和 `0005` migration。
- Gate 2D 尚未开始：没有模板原子写盘、标准项目快速新建、legacy 升级、项目文档刷新/同步或受控内容写回。`createFromTemplate` 与 `upgradeManaged` 仍应返回 `CAPABILITY_NOT_NEGOTIATED`，不能把 write plan 当成已经执行。
- Gate 2E 及以后仍未实现 Outbox dispatcher、WorkItem/Run/Review 写入、跨 Harness 已认证 handshake、Agent 调度、审核闭环以及 Workbench Files/Code/Diff/Browser/PTY 正式能力。
- 本轮没有修改 `D:\Deepseek Harness` 上游，没有更新 `compat.json`，也没有重建 Portable/NSIS。仅 `artifacts\win-unpacked` 已重建为 Gate 2C 并通过 packed smoke；现有 Portable/NSIS 仍不能描述为 Gate 2C 制品。

## 2026-08-14：Project Control Gate 2B 完成（数据库事务内核、Host API 与真实状态 UI）

> 历史记录：本节描述 Gate 2B 完成时的边界；当前扫描、引用解析与 schema 状态以上方 Gate 2C 条目为准。

### 本轮实现

- `@cyrus/dsh-project-control` 已从 Gate 1 占位升级为可运行的 Gate 2B 基础层。唯一 Host 从稳定的 Electron `userData\project-control`（可由显式 `PROJECT_CONTROL_HOME` 覆盖）打开全局 SQLite；数据库不跟随 `DSH_HOME`。当前 `schemaVersion=2`，按顺序执行 `0001_core_control_plane.sql` 与 `0002_registration_state.sql`。
- 迁移器校验不可变 checksum，在已有数据库升级前使用 SQLite online backup；更高版本、checksum 漂移和无迁移历史的非空数据库会停止打开。数据库文件派生唯一 writer lock，调用方不能通过另一 lock path 绕过；Host 卸载/退出会关闭数据库并释放锁。
- 已实现 Project 注册/重绑所需的最小事务状态：幂等 command hash、optimistic revision、Project 当前状态、CommandReceipt、Domain Event 与 Outbox 同事务提交；任一步失败整体回滚。`0002` 增加用户确认的 document bindings 与 managed manifest mirror，重复活动路径或位置身份冲突持久化为可重放的 `LOCATION_CONFLICT`。
- 独立 Host API 前缀为 `/__personal/project-control/v1alpha1`，固定要求 `x-dsh-personal-client: 1`。当前开放 `GET /status`、`GET /projects` 与 `POST /lifecycle`；请求体有方法、媒体类型和大小边界，内部数据库路径、SQL 与 stack 不返回 Renderer。
- Lifecycle Command 与 Result 都从 `protocol/project-control/v1alpha1/lifecycle/` 惰性加载 JSON Schema，由 Ajv 2020 strict + formats 校验；Schema 资产异常只让 POST 安全失败，不拖死只读状态接口。Result 通过正式 Schema 后还要做字段白名单与错误消息脱敏。
- Project Console 保留固定导航，但状态区只显示真实数据库状态、schema、可写性、真实项目数量和真实项目列表；空数据库明确显示空列表，不伪造项目、计数或运行记录。

### 当前边界

- Gate 2C 的来源扫描、导入 UI 和 Host 签发/解析 `loc_`、`srt_` 引用尚未实现。`registerLegacy`、`registerManaged` 与 `rebindLocation` 在默认运行时会持久化、幂等重放 `REFERENCE_UNRESOLVED`，不会接受外部传入的绝对路径。
- Gate 2D 的模板文件同步、标准项目新建和 legacy 安全升级尚未实现。`createFromTemplate` 与 `upgradeManaged` 会持久化 `CAPABILITY_NOT_NEGOTIATED` 并保留已经过 Schema 校验的 write plan，不伪造 `committed` 或成功 Event。
- 当前没有 Outbox dispatcher、WorkItem 写入、Run/Review/Agent 调度、跨 Harness 已认证 capability handshake 或 external runtime update dispatcher。七个 Workbench 页签仍只是工具壳、路由与状态契约，不代表文件、代码、Diff、浏览器或 PTY 业务已经完成。
- 存储层拒绝 UNC/extended UNC；但盘符形式的映射网络盘不能由当前字符串校验可靠识别，因此 `PROJECT_CONTROL_HOME` 和未来 trusted workspace location 必须使用已知本机固定磁盘。系统 Node 的 `node:sqlite` 当前仍会输出 ExperimentalWarning。

### 验证与制品状态

- `pnpm test`：188/188 通过，skipped 0、todo 0。
- `pnpm run check:plugins`：十三个插件的构建、类型、语法和专项门禁全部通过。
- 开发态真实 Electron smoke 通过；重新执行 `pnpm run pack:win:dir` 后，新的 `artifacts\win-unpacked` 也通过 `pnpm run smoke:packed:dir`。两条真实路径均确认 Project Control `schemaVersion=2`、真实空列表、四轨 Shell、个人 API、优雅退出、端口关闭与数据库锁释放。
- 当前 `artifacts\win-unpacked` 是 Gate 2B 产物。最终 Portable 与 NSIS 没有重建或重新验证，不能称为 Gate 2B 制品；`compat.json` 也不更新，兼容基线仍为 Harness `0.1.0-rc.5`、提交 `47f943859bef60e4160492346772ded9b24f765a`。
- 本轮仍未修改 `D:\Deepseek Harness` 上游 tracked 文件；自动 smoke 使用隔离数据目录，不读取真实模型密钥或调用模型。

## 2026-08-14：Project Control Gate 2A 合同冻结完成（仅规范，无运行时）

> 历史记录：本节描述 Gate 2A 完成时的边界；当前运行时状态以上方 Gate 2B 条目为准。

### 本轮冻结内容

- [`PROJECT_INTAKE_SPEC.md`](PROJECT_INTAKE_SPEC.md) 固定三种接入入口：扫描项目来源目录、导入单个已有项目、快速新建标准项目。已有项目默认只读进入 `linked_legacy`，只有显式确认标准化或从模板新建时才写项目目录并进入 `managed`。
- [`PROJECT_CONTROL_DATA_MODEL.md`](PROJECT_CONTROL_DATA_MODEL.md) 固定字段级唯一事实源、一份全局 SQLite 控制面、每项目可移植资料、Harness 原生 Session 引用和单写者 Host 边界。全局数据库未来放在稳定的 Electron userData，并允许显式 `PROJECT_CONTROL_HOME` 覆盖；它不跟随 `DSH_HOME`，其他 Harness 应用不得直接打开 SQLite。
- [`PROJECT_PROTOCOL.md`](PROJECT_PROTOCOL.md) 与 `protocol/project-control/v1alpha1/` 固定版本化输入输出合同。机器资产包括项目 manifest、外部 progress/blocker/completion 更新 envelope、标准化事件和进展更新 frontmatter 的 JSON Schema 2020-12，以及对应有效/无效示例；未知核心字段默认拒绝，扩展只能进入明确的命名空间。项目注册、新建、重绑和升级的 lifecycle command 已冻结事务语义，精确 DTO/Schema 必须在 Gate 2B 写代码前补齐。
- 导入文本只产生候选、映射和问题，不能根据日志语气静默推进 WorkItem、Run 或 Review；Agent 声明完成也不等于验证通过或 Cyrus 批准。状态、Domain Event、Outbox 和 CommandReceipt 的原子事务边界已经冻结，但实现仍在后续 Gate。
- 新增开发期 Ajv `8.20.0` 与 `ajv-formats` `3.0.1`，并加入可执行协议合同测试：严格编译 4 份 JSON Schema、验证 8 个正反例，并锁定事实不重复、UUIDv7/`wrk_`、无效日期、路径逃逸/ADS/控制字符、aggregate 前缀、correlation、producer 版本和 completion evidence 等边界。
- 验证结果：`pnpm test` 145/145；`pnpm run check:plugins` 的十三个插件 build/typecheck/syntax/test 门禁全部通过。因本轮只有规范、Schema、测试和开发依赖变化，没有重跑 Electron smoke，也没有重打 EXE。

### 当前边界与后续顺序

- Gate 2A 的交付物是产品契约、数据契约、协议 Schema 和验收样例，不是可用的项目管理功能。当前 `@cyrus/dsh-project-control` 仍是 Gate 1 占位，没有 SQLite、迁移器、扫描器、模板创建器、Host API、Agent 工具或业务 UI。
- 后续按依赖顺序推进：Gate 2B 数据库运行时与事务内核；Gate 2C 现有项目发现、只读导入和文档索引；Gate 2D 标准项目快速新建与 legacy 安全升级；Gate 2E 跨 Harness/Agent 强类型输入、标准输出和 Quarantine 修复管线。
- 本轮不改上游 `D:\Deepseek Harness`，不更新 `compat.json`，也不重建 NSIS/Portable；现有封装仍不能描述为 Gate 2A 运行时制品。

## 2026-08-14：Workbench Gate 1 通过（四轨 Shell 与稳定接口完成）

### 本轮实现

- 外置插件包由十一个增至十三个：新增用户可见的 `@cyrus/dsh-project-control` 与 `@cyrus/dsh-workbench`；两个内部基础模块仍是 `personal-foundation` 与 `personal-shell`，其余十一项均为用户可见插件。
- Personal Shell 正式承载四条真实网格轨道：Harness 原生 Sidebar、`project.control`、完整 Conversation 和 `workbench.panel`。Project Console 与 Workbench 分别有 40px/44px 收起轨道、独立开关与宽度持久化；两处分隔线支持拖拽、双击复位和键盘操作，布局菜单提供“专注会话”和“重置布局”，窄窗按最近操作优先级让出辅助栏。
- `@cyrus/dsh-project-control` 已占用 Shell 声明的真实 single slot，并展示未来导航占位。Gate 1 的 Host 入口刻意为空，不提供存储、项目 API、领域状态或项目文件。
- `@cyrus/dsh-workbench` 已占用独立的真实 single slot，固定 `Files / Code / Outline / Diff / Browser / Terminal / Details` 七个页签。它提供 viewer registry、统一 open intent、全局/Session 作用域、可恢复页签描述符、活动页签持久化、脏页签关闭保护，以及可扩展 viewer 的注册与清理契约；恢复数据会按固定 schema 重写，清除未知字段并拒绝非字符串 ID。
- 官方 Details 子树不再作为竞争的第五列：Personal Shell 把它交给 Workbench，`openDetails/closeDetails` 通过单调命令流驱动唯一的临时 selection；Session 切换会清理临时详情，`Details` 关闭后回到 `Files`。rc.5 ChatView/工具卡仍未从真实点击调用 `openDetails`，因此本轮只证明兼容路由，不宣称上游工具详情已接通。

### 验证结果

- `pnpm test` 141/141 通过。
- `pnpm run check:plugins` 通过：十三个插件包全部完成构建与门禁检查。
- 开发态真实 Electron smoke 通过：使用 1380px BrowserWindow（Renderer 内容区 1366px），初始 Project/Conversation/Workbench 三段宽度为 `360 / 682 / 44`；展开 Workbench 后为 `40 / 626 / 420`，Project Console 按让步规则收至轨道，Conversation 仍大于 560px，两个状态都没有横向溢出。
- 同一 smoke 实际完成 Project Console 的标题栏收起、40px 轨道恢复和 Sidebar footer 双向切换，Workbench 的展开、44px 收起和恢复，`Details` 激活后回到 `Files`，以及“专注会话/重置布局”。原生 Sidebar 开关、四轨数量、Theme presenter、桌面 bridge、`theme/skills/plugins/connections` API 也全部通过。
- Harness 优雅退出，未强制终止；随机端口随后关闭。

### 当前边界与制品状态

- Gate 1 完成的是 Shell、真实 slot、Workbench 页签/路由/持久化契约和 Project Control 占位。尚未实现项目数据库、项目文件与领域 API，也尚未实现 Workbench 的实际文件读写、代码编辑、Diff/审核、浏览器加载或右栏 PTY；底部现有 Session PowerShell 仍是唯一已实现终端。
- 本轮没有重建或重新验证 NSIS、Portable 和解包 EXE，也没有更新 `compat.json`。这些现有制品与兼容记录均早于 Gate 1，不能描述为当前源码产物。
- 下方 Gate 0 与架构定案条目保留为当时的历史记录；Gate 1 的运行时状态仍以本节为准，最新 Project Control 合同状态见上方 Gate 2A 条目。

## 2026-08-14：Personal Shell Gate 0 通过（真实会话与双 Session 已签收）

> 历史记录：本节描述 Gate 0 当时的实现与验收；当前 Gate 1 状态见上节。

### 本轮实现

- 新增内部插件包 `@cyrus/dsh-personal-shell`。Personal Desktop overlay 只在桌面组合中停用官方 `@deepseek-ai/dsh-client-ui-layout` 并激活该 Shell；普通 `dsh web` 不受影响。
- Personal Shell 继续提供 rc.5 `ctx.layout` 的 `toggleSidebar/openDetails/closeDetails`，按原 scope 声明 `sidebar`、`conversation`、`details`、`shell.overlay`，接管官方 Theme presenter，并新增 `project.control`。
- 根布局已经是真实四轨网格：固定 280/56px 的原生 Harness Sidebar、可折叠/拖拽的空 Project Console、完整官方 Conversation、原官方 Details。原生 Sidebar 没有拖拽手柄；项目栏和 Details 各自保留明确分隔线。
- 调整 Project Console 的开关语义与排版：展开时在项目栏自身 48px 标题栏内提供收起按钮；收起后保留 40px 栏内轨道和展开箭头。原生 Sidebar 的 `sidebar.footer.action` 始终提供“项目控制台”双向切换入口，兼容宽栏文字行与 56px rail 图标态；footer 有其他动态贡献时按纵向堆叠，不增加覆盖 Conversation 的根级悬浮按钮。
- 本轮只证明 Shell seam 和空项目列，不创建项目数据库、项目页面、调度、审核或 Workbench 业务。

### 验证结果

- `pnpm run check:plugins` 通过：十一个插件包全部完成 typecheck、Host/Client bundle、语法与专项测试；Personal Shell 专项 14/14，通过且 bundle 中没有被禁用官方 layout 的 runtime require。
- `pnpm test` 104/104 通过，skipped 0、todo 0。
- 修复资源管理器双击入口依赖 Codex 终端 `pnpm` PATH 的问题：启动脚本改用项目自带 Electron 的 Node 直接运行 `scripts/build-plugins.js`，启动 GUI 前再清除 `ELECTRON_RUN_AS_NODE`。已在 PATH 仅含 `C:\Windows\System32` 的普通 `cmd.exe` 中调用同一脚本并成功构建十一个插件包；回归测试同时禁止恢复 `call pnpm run build:plugins`。
- 加严的开发态隔离 Electron smoke 通过：boot graph 含 Personal Shell、不含官方 layout；四轨网格、项目列/占位、项目分隔线和 Theme presenter 存在；Project Console 已分别完成“标题栏收起 → 40px 栏内轨道恢复”和原生侧栏入口双向切换，两条路径都从 360px 展开态收至 40px 并恢复，根节点不存在悬浮项目按钮；原生 Sidebar 也完成开关与恢复，官方 Conversation 与会话终端 dock 正常加载。
- Cyrus 已在真实资料中完成一轮聊天，并创建、切换两个 Session；原生侧栏展开/收起、项目栏开关和拖拽均未发现其他问题。这两项人工动作证明 Shell 根替换没有破坏真实消息链路、Session 当前项切换和会话状态隔离。
- Harness 正常优雅退出，未强制终止；随机端口关闭，Helper 与 Electron 进程无残留，Windows Job Object active。
- `D:\Deepseek Harness` 提交仍为 `47f943859bef60e4160492346772ded9b24f765a`，tracked diff 和 staged diff 均为零；原有未跟踪 `启动 DeepSeek Harness.cmd` 未被修改。

### rc.5 Details 缺口与制品状态

rc.5 的 Conversation 注入面仍定义 `openDetails(target)`，Personal Shell 也保留 `details` slot 和兼容 layout 方法；但当前 ChatView 没有把该回调传给工具节点，工具卡的 Inspect 实际切换到 trajectory，而不是打开 Details。因此用户在普通聊天中看不到 Details 是上游既存行为，不是本轮回归，也没有可供人工执行的“打开/关闭 Details”动作。该能力将在 Workbench 阶段以明确入口统一承接。Gate 0 按 rc.5 的真实可达行为记为通过。现有 NSIS/Portable 仍是 Gate 0 之前的十插件封装；本轮没有覆盖正式 EXE、安装器、快捷方式或 `compat.json` 的封装基线。

## 2026-08-14：项目控制台、四栏 Shell 与 Workbench 架构定案（尚未实现）

> 历史记录：本节描述 Gate 0 开工前的方案状态，“尚未实现”只对应记录当时；当前 Gate 1 状态见本文最上方。

### 定案结果

- 下一阶段目标布局确定为“Harness 原生侧栏｜Project Console｜完整 Harness 会话｜Workbench”四栏同时显示。原生侧栏保留官方 Workspace、Session、Agent、搜索、排序和折叠行为，展开/收起分别沿用 rc.5 默认的 280/56px，不渲染宽度拖拽手柄，也不替换内部列表。
- Project Console 位于原生侧栏与 Conversation 之间；Workbench 位于最右侧。新增的可拖拽边界只有 `Project Console | Conversation` 与 `Conversation | Workbench`，两个辅助栏独立折叠并分别记忆宽度。
- Conversation 始终保留官方完整会话，不改成摘要或迷你聊天。窗口过窄时优先收起辅助栏，不能把会话压到不可读宽度。
- Project Control 负责 Project、WorkItem、Run、Artifact、Review、Decision 与审计事件；Harness Session 继续是完整对话的唯一事实来源；Workbench 只呈现文件、代码、Diff、浏览器、终端和审核证据，不建立第二套项目状态。
- `Run succeeded`、验收通过和 Cyrus 批准被定义为不同事实。审核绑定具体版本，材料实质变化后旧批准过期；评论或 Agent 自报完成不能代替正式批准。
- 项目更新采用结构化 `project_event` 与人可阅读 Markdown/ADR；运行状态、审核与审计使用版本化本地数据库，项目目录保存长期文档。凭据只保存 Connection Center 引用，不进入项目库、日志或指令。

### 已验证约束与开工门槛

- Harness rc.5 的官方 `ui-layout` 是三栏 AppFrame；`root/sidebar/conversation/details` 为 single slot，`shell.overlay` 不参与网格尺寸，因此普通新增插件无法产生可拖拽真实第四栏。
- 计划以桌面专用 Personal Shell 兼容层替代 Personal 组合中的官方 layout，继续声明并承载官方 Sidebar、Conversation、Details、Theme 与 overlay，同时增加 Project Console 和 Workbench 容器。`D:\Deepseek Harness` 继续只读，普通 `dsh web` 不应受影响。
- 第一项实现工作锁定为 `PROJECT_CONTROL_SPEC.md` 的 Gate 0：只做空 Project Console 列，在隔离临时 `DSH_HOME` 中验证官方 client 插件全部 settled、原生左栏与详情行为不回归、Project Console 可开关和拖拽、真实聊天与退出 smoke 通过。
- 如果 Gate 0 不能满足上述条件，停止继续铺 UI，改走版本化薄布局补丁或正式 slot 路径；不接受 DOM 查询、CSS 位移或全屏浮层伪造第四栏。

### 文档与范围状态

- 新增 `PROJECT_CONTROL_SPEC.md`，记录固定布局、模块边界、领域模型、状态机、结构化日志、存储安全、Workbench 目标、Gate 0–6 和完整验收定义。
- 本节更新的是下一阶段已批准方案，不改写本日志中此前“延期”的历史记录；此前记录在当时仍然成立。
- 本次只更新规划文档，没有新增插件、修改运行时代码、重建 EXE 或改变 `compat.json`。当前可交付版本仍是十插件、88/88 测试和已登记的 NSIS/Portable 产物。

## 2026-08-14：鲸鱼女仆 A 定稿为正式应用图标

- 正式图标采用用户选定的 A 版蓝鲸女仆形象；底板基色为 `#3A4A35`，基础 Alpha 为 153/255（约 60%），带轻量静态毛玻璃高光。
- `assets/app-icon.png` 为 1024×1024 RGBA；`assets/app-icon.ico` 包含 16/20/24/32/40/48/64/96/128/256px 共十档 32bpp 图标。16–64px 缩放已人工检查，托盘和任务栏尺寸仍可辨识。
- BrowserWindow、Tray、NSIS 安装器、Portable 和快捷方式继续共用正式图标入口；候选图、中间抠图和合成脚本已从发布文件白名单排除。
- `pnpm test` 88/88 通过；解包 EXE 与 Portable 的真实 smoke 均通过，Harness 优雅退出、端口关闭且未留下残留进程。三个 EXE 均可由 Windows Shell 提取出 A 版图标，包内 PNG/ICO 与源资产 SHA-256 完全一致。

本次重建产物：

- NSIS：`artifacts\DeepSeek-Harness-Personal-0.1.0-setup-x64.exe`，102,084,245 bytes，SHA-256 `FC7AB30D58152AE8A99C8708962C716B7103AE128ADAF2B1B11ED8A7696A716B`。
- Portable：`artifacts\DeepSeek-Harness-Personal-0.1.0-portable-x64.exe`，101,524,005 bytes，SHA-256 `04D558499997A9766D5CCCE9967975B3C1D0FC9D7431A79C39EEB546F2025F69`。
- 两个制品仍为 `NotSigned`；配套 `.sha256` 均与重算值一致。本轮没有运行安装器或改动系统快捷方式。

## 2026-08-14：桌面扩展第二阶段完成并通过最终封装验证

### 本轮已实现

在原有个人底座、主题、Skill 资料库、插件整理和连接中心之上，新增五个外置插件，并补齐 Windows 桌面壳能力。当前共十个个人插件，仍只由桌面专用 overlay 激活：

- `@cyrus/dsh-desktop-integration`：托盘、关闭行为、快捷方式和退出进程守护的可视化设置。
- `@cyrus/dsh-session-terminal`：绑定 Harness session 的底部可折叠、多标签持久 PowerShell，支持历史、清屏、中断、重启、关闭和游标重连；Windows rc.5 复用上游 `subprocess-local` 的 `node-pty`。
- `@cyrus/dsh-usage-balance`：当前轮次与会话预计费用、Host 侧官方余额查询，以及隔离的 DeepSeek 充值入口。
- `@cyrus/dsh-trajectory-island`：顶部可悬停展开的会话轨迹浮层，按轮次展示运行、工具、错误与压缩状态，并跳转到聊天锚点。
- `@cyrus/dsh-update-center`：Personal 客户端、Harness 运行时和随客户端发布的个人插件更新管理。

桌面壳新增统一应用图标、NSIS 安装版与 Portable 打包目标、托盘快捷操作、桌面/开始菜单快捷方式维护，以及 Windows Job Object 进程树守护。退出时仍先走 Harness 官方优雅关闭；Job Object 不可用时保留精确 PID 的进程树终止兜底。

### 关键实现边界

- 快捷方式自修复只在 Windows 已封装版本运行。Portable 始终指向外层 EXE；移动后必须从新位置启动一次才会修复。只更新本应用管理、或原本就指向本应用的快捷方式，不覆盖第三方同名链接。
- 会话终端的工作目录由 Host 从当前 session 确认，Renderer 不能指定任意可执行文件或目录；子进程环境剔除常见凭据变量。它是有界纯文本控制台，不支持依赖完整 VT 光标控制的全屏程序，也不能跨 Harness Host 重启保留操作系统 PTY。
- 用量金额是基于版本化 DeepSeek 价格快照的估算，不是账单；官方余额只在 Host 内解析 `DEEPSEEK_API_KEY` 并请求固定余额接口。充值中心使用隔离 BrowserWindow，仅允许 DeepSeek HTTPS 页面，内置加载失败时才退回系统浏览器。
- Personal 桌面更新只从配置的公开 GitHub Releases 读取 Windows 资产，并要求 Release digest 或配套校验文件提供 SHA-256；没有校验值时停止下载/安装。当前尚需为 Personal 项目配置实际发布仓库。
- Harness 更新不覆盖当前 `D:\Deepseek Harness`：候选提交进入 Electron userData 下的独立版本目录，完成依赖安装、构建和隔离预检后才允许重启切换，并保留上一运行时用于回滚。安装、构建与预检使用隔离的 home、temp、npm/Corepack/pnpm 缓存和最小环境白名单，不继承 API Key、GitHub PAT、AWS 凭据、SSH Agent、用户 npm/git 配置或 `NODE_OPTIONS`。更新网络仅允许受信任 GitHub HTTPS 主机，并限制响应大小和超时。
- 个人插件作为与客户端绑定的兼容集合发布，不在程序运行时单独覆盖插件文件。

### 范围决定

- 右侧工作台侧栏延期到下一轮。代码、文件、浏览器、终端、代码审查和文件结构树将作为一个整体一次性设计，本轮不先做残缺版。
- 项目管理控制台仍是后续概念，继续排在主题、资料管理、连接、桌面能力和右侧工作台稳定之后。

### 最终验证与封装结果

- `pnpm test`：88/88 通过，skipped 0、todo 0。
- `pnpm run check:plugins`：十个插件的 typecheck、Host/Client bundle、语法与专项测试全部通过。
- `pnpm run smoke`：开发态真实 Electron 启动通过；十个个人插件全部加载，theme/skills/plugins/connections/usage-balance/session-terminal API、桌面与更新 bridge、终端面板均通过检查。
- `pnpm run smoke:packed:dir`：最终解包 EXE 启动通过。
- `pnpm run smoke:packed`：最终 Portable 单文件启动通过。
- 三次最终 smoke 均由 Harness 确认优雅退出，未进入强制终止；随机端口关闭，Windows Job Object 保护处于 active，未留下 Helper/Electron 残留。
- 会话终端另完成真实 Windows ConPTY 专项：跨命令状态与中文输出正常，关闭后 PID 已退出。
- 包内检查确认 `src/preload.cjs`、十个插件和 Koffi win32-x64 原生文件均存在；两个 `.sha256` 与重算结果一致。
- 首次最终打包因 electron-builder 下载工具时 TLS 连接中断而退出；未把该次产物作为结果。原命令重试后完整成功。

最终 Windows 产物：

- NSIS 安装版：`artifacts\DeepSeek-Harness-Personal-0.1.0-setup-x64.exe`
  - 100,986,437 bytes（96.31 MiB）
  - SHA-256：`735182E187A8278E763AF0FD23F377A97ACDAF9F416A09F98FF50C091FB7EF29`
- Portable：`artifacts\DeepSeek-Harness-Personal-0.1.0-portable-x64.exe`
  - 100,594,136 bytes（95.93 MiB）
  - SHA-256：`A93F5E4C51AFD8269D9B11AF57489551374EF2616F289A7B72E72B2F4E8CDF08`
- 两个文件的 Authenticode 状态均为 `NotSigned`，旁边各有对应 `.sha256` 文件。

自动 smoke 没有读取真实 `DEEPSEEK_API_KEY`、调用模型、查询真实余额或打开充值页面；余额未配置路径、固定充值桥接与导航边界已验证。Personal 发布仓库仍需由使用者填写，因而本轮没有执行真实客户端 Release 下载或安装；NSIS 文件也未在本机实际安装，避免未经授权改变系统。当前上游兼容基线仍为 Harness `0.1.0-rc.5`、提交 `47f943859bef60e4160492346772ded9b24f765a`，Electron `43.4.0`。

## 2026-08-14：个人插件第一阶段与便携版完成

### 本阶段结果

在不修改上游仓库的前提下，新增一个共用底座和四个真实 Harness 双端插件，并通过桌面专用 Cordis overlay 激活：

- `@cyrus/dsh-personal-foundation`：私有 HTTP API、原子 JSON 存储、Skill 文件操作、Loader 清单投影和官方 credentials 接入。
- `@cyrus/dsh-personal-theme`：全局/工作区主题，支持字体、字号、缩放、四项颜色和面板透明度。
- `@cyrus/dsh-skill-library`：Skill 搜索、分类、一句话简介、添加、编辑和可恢复删除。
- `@cyrus/dsh-plugin-organizer`：实时插件清单、自定义分类和一句话简介；不重复实现原生安装/卸载。
- `@cyrus/dsh-connection-center`：飞书、企业微信、Webhook、MCP 的配置管理，以及个人微信预留位置。

这套实现没有改写 web profile manifest，也不会让普通 `dsh web` 自动加载个人插件。桌面启动时只创建包解析所需的 junction，并传入本项目自己的 overlay。

### 产品与安全边界

- 连接中心当前是配置中心，不执行真实连接、Webhook 调用或 MCP 进程启动；界面始终明确显示“仅配置 · 尚未实际连接”。
- Webhook URL 和 MCP 目标也按敏感信息处理，与 Token 一起存入官方 credentials provider；GET 只返回脱敏说明和 configured 状态。
- Skill 删除只对个人 DSH Skill 开放，并移动到 `%DSH_HOME%\personal\trash\skills`；共享 Agent Skill 只读。
- 插件整理只维护分类和简介；安装、更新、卸载继续使用 Harness 原生能力。
- 项目管理控制台仍是后续概念，不进入本阶段范围。

### 自动验证记录

- 五个插件 typecheck、Host/Client bundle 和 bundle handoff id 检查全部通过。
- Foundation 7/7 专项测试通过；主题 5/5 专项测试通过。
- 项目完整单元测试 39/39 通过，skipped 0、todo 0。
- 开发版真实 Electron smoke 通过：五个个人客户端插件全部出现，theme/skills/plugins/connections 四个 API 均为 HTTP 200。
- 解包版 `DeepSeek Harness Personal.exe` 实际启动 smoke 通过。
- 便携单文件 `DeepSeek-Harness-Personal-0.1.0-portable-x64.exe` 实际启动 smoke 通过。
- 三次真实 smoke 均完成优雅退出，未强制结束；Harness 端口关闭，Electron/Helper 无残留。
- 中文乱码特征扫描 0 命中；上游仓库仍只有原先未跟踪的 `启动 DeepSeek Harness.cmd`，提交保持 `47f943859bef60e4160492346772ded9b24f765a`。

### Windows 产物

- 便携文件：`artifacts\DeepSeek-Harness-Personal-0.1.0-portable-x64.exe`
- 大小：89,682,615 bytes（85.53 MiB）
- SHA-256：`2CE50EE790D81F0AAB87E4F5FFD6BF4C349AB6D0E8AC764211B5C32C424513A4`
- 签名：`NotSigned`
- 解包目录：347.89 MiB，103 个文件。

封装显式使用 `asar: false`：Harness 由系统 Node 从物理路径加载 helper 和插件，ASAR 会破坏这条执行路径。当前便携包仍依赖本机 `D:\Deepseek Harness`（或 `DSH_SOURCE_ROOT`）及系统 Node。

## 2026-08-14：桌面 MVP 完成并通过真实使用验收（阶段 1）

### 项目目标

为个人、临时使用的 DeepSeek Harness 建立独立桌面入口，并为后续个人皮肤、Skill 管理和插件管理保留扩展位置。个人功能与官方仓库分离，以降低 DeepSeek Harness 预览版频繁更新带来的维护成本。

### 已确定的边界

- 官方源码保留在 `D:\Deepseek Harness`，个人桌面项目位于 `D:\Deepseek Harness Personal`。
- 不复制 Harness 的聊天、Agent、会话或模型业务代码。
- 桌面程序直接复用官方 Web profile 和现有 `DSH_HOME`；自动测试使用隔离的临时目录。
- 当前仅供个人使用，不制作安装器、不签名、不发布，也不实现自动更新。
- 后续个人功能优先通过外置 theme/client/host plugin 实现；只有缺少必要扩展点时才考虑小型上游补丁。

### 当前实现

- Electron 43.4.0 独立窗口和双击启动入口。
- 使用系统 Node 启动官方源码中的 Web profile。
- 固定绑定 `127.0.0.1`，传入 `--port 0` 自动选择空闲端口。
- 同时等待官方 readiness URL 和 helper 的 boot 完成确认，再加载窗口。
- 单实例运行；第二次启动会聚焦已有窗口。
- Renderer 禁用 Node integration，启用 context isolation 和 sandbox。
- 禁止外部导航和新窗口；只允许当前 Harness origin 的剪贴板安全写入权限。
- 关闭窗口时通过 IPC 调用 Harness 自己的 `shutdown.shutdown(0)`；7 秒未结束才按已记录 PID 终止进程树。
- 启动、页面加载和客户端插件装配均设有超时及明确错误提示。

### 主要文件

- `启动 DeepSeek Harness 桌面版.cmd`：双击启动入口。
- `src/main.js`：Electron 窗口、安全策略和应用生命周期。
- `src/harness-process.js`：Node helper 启动、readiness、IPC 与退出监督。
- `src/harness-helper.js`：接入 Harness 源码并调用官方关闭控制器。
- `src/readiness.js`：严格解析回环 readiness URL。
- `test/`：readiness 与进程生命周期测试。
- `scripts/smoke.js`：真实 Electron + Harness 隔离冒烟。
- `compat.json`：最近一次验证通过的 Harness、Electron、Node 和 pnpm 版本。

### 自动验证记录

运行：

```powershell
cd "D:\Deepseek Harness Personal"
pnpm test
pnpm run smoke
```

结果：

- 单元测试 23/23 通过，skipped 0、todo 0。
- 真实冒烟完成 `window-close → Harness graceful shutdown → helper exit → port closed`。
- Helper 退出码为 0，signal 为 null，未进入强制终止分支。
- Electron Browser、GPU、Utility、Tab 进程均确认退出。
- 冒烟使用临时 `DSH_HOME`、`DSH_AGENTS_HOME`、workspace 和 Electron userData，不读取真实模型密钥，不调用模型。
- 验证结束后没有残留 helper/Electron 进程或冒烟临时目录。

### 人工验收

2026-08-14，Cyrus 已确认：桌面版正常启动，并且可以完成真实聊天。

### 上游状态

- 已验证 Harness 版本：`0.1.0-rc.5`。
- 已验证提交：`47f943859bef60e4160492346772ded9b24f765a`。
- 本次没有修改官方仓库 tracked 文件。
- 官方仓库原有未跟踪文件 `启动 DeepSeek Harness.cmd` 保持不变。

### 使用与更新

日常从资源管理器双击 `启动 DeepSeek Harness 桌面版.cmd`。默认 Harness 工作目录为 `D:\Deepseek Harness`；需要其他工作目录时设置 `DSH_WORKSPACE_ROOT`。

上游更新时：

1. 停止桌面程序。
2. 在 `D:\Deepseek Harness` 拉取目标版本。
3. 运行 `pnpm install` 和 `pnpm run build`。
4. 在本项目运行 `pnpm test` 和 `pnpm run smoke`。
5. 实际打开并进行一次聊天、关闭检查。
6. 全部通过后更新 `compat.json` 和本日志；失败则继续使用上一已验证提交。

Harness 仍处于预览阶段，磁盘格式没有稳定兼容承诺。更新前应备份真实 `DSH_HOME`，不得把 credentials、`.env`、会话内容或诊断日志上传到仓库或外部服务。

### 当时的后续建议顺序

个人主题、Skill 资料库、插件整理、连接中心和便携包已在阶段 2 实施。项目管理控制台继续推迟到这些基础能力经过实际使用之后再讨论。

### 后续工作纪律

- 默认只修改 `D:\Deepseek Harness Personal`；`D:\Deepseek Harness` 作为只读上游。
- 开工前读取 `README.md`、`DEVLOG.md`、`compat.json` 和 `PROGRESS.md`。
- 每次功能完成后记录：变更、验证命令、实际结果、遗留问题和上游兼容版本。
- 自动测试必须使用临时数据目录；不得读取、打印或覆盖真实凭据和会话。
- 未经 Cyrus 明确同意，不提交、不推送、不发布，也不执行系统级配置修改。

## 2026-08-24：v0.4.4 生产缺陷修复与发布资料收口

- 修复真实 Stable pending 插件 generation 无法激活：main→helper 可信传递 userData 派生的 `plugins-external`；Stable 缺路径 fail-closed。
- runtime-preflight 注入隔离临时 `externalPluginsRoot` 与可信 `desktopFlavor`；真实 preflight 输出 `PREFLIGHT_OK` 且 `PREFLIGHT_CLEANUP_OK`。
- Dev flavor 保持 dev 行为，新增「Dev + pending 仍用内置插件」反向测试。
- 全量测试 731/731，fail 0，skipped 0；packed 激活/重启/回滚三启动 E2E 通过；四项门禁通过。
- 发布资料收口：`docs/release-notes/0.4.4.md` 新增；`compat.json`/`PROGRESS.md`/`BLOCKED.md` 同步。
- 插件 Release 收口：现有 `plugins-v2026.08.24.1`（.1）不修改、不删除；后续发布 `.2`，两个插件递增版本，`minClient=0.4.4`。
- 已授权并完成 commit、push、v0.4.4 GitHub Release：https://github.com/SeeiiLee/deepseek-projectpl-console/releases/tag/v0.4.4
- 未安装 v0.4.4 到宿主机，未创建 plugins-v .2 Release；`release-staging/` 仅作上传来源，不 git add/提交其中的大文件。

## 2026-08-24：v0.4.5 发布候选（更新中心有效版本识别与 pending 安全收口）

- 修复更新中心将 external 插件误显示为“随客户端更新”：`effectivePluginVersions()` 读取并验证 current generation，`checkPlugins()` 以实际生效版本比较。
- pending 存在时禁止准备新 generation，提示“已有插件更新待重启激活”，UI 不显示“下载并准备插件更新”按钮。
- current/pending 统一 `assertExternalPackagePath()`：目录包含、版本安全、junction/symlink 越界拒绝。
- 全量测试 751/751，fail 0，skipped 0；stable packed E2E 与四项门禁通过。
- 已构建 `release-staging/v0.4.5-final` 并发布：https://github.com/SeeiiLee/deepseek-projectpl-console/releases/tag/v0.4.5
- 未覆盖 v0.4.4 Release，未创建 plugins-v*.2，未操作真实 Stable 数据，未安装到宿主机。
