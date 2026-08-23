# 富文本编辑器重构方案（ProseMirror / TipTap）

> 状态：Phase 2 已完成并经 Cyrus 确认；Phase 3 收尾已完成；Wolai 斜杠命令（图片/媒体、文件/附件、数据库/表格视图）已初步完成。下一步为插件独立更新通道最小版。
> 关联交接：`docs/NEXT.md` 顶部 R-ED 段落。

## 1. 背景与动机

当前 Workbench 的 Markdown 编辑态基于 CodeMirror 6 行式编辑器 + 装饰隐藏标记实现“所见即所得”。该方案存在以下固有问题：

- 选区/坐标漂移：行级 `padding`、装饰 span、`Decoration.replace` 组合后，CodeMirror 的 selection 几何仍可能错位。
- 标记显示错乱：标题 `#`、引用 `>`、列表 `1.` 的 reveal 与 CSS 叠加会互相干扰，出现 `1.1`、多余 `*`、引用行首“日”字被吞等问题。
- 块级语义缺失：段落、标题、列表、引用、表格在编辑器里不是真实节点，格式无法与预览完全对齐。
- 软换行：同一段落内的单个换行在编辑器里仍显示为换行，而预览会按空格处理。

结论：继续在 CodeMirror 上行级装饰方案上修补，边际成本高且无法根本解决。转向真正的块级富文本编辑器。

## 2. 已确认决策

- 使用 **TipTap（基于 ProseMirror）** 作为编辑器内核。
- 使用 **Markdown 解析/序列化桥接** 实现 `.md` 文件加载与保存。
- **接受保存时 Markdown 源文件格式被规范化**，例如：
  - `-` / `*` / `+` 统一为 `-`
  - `1)` 统一为 `1.`
  - 自动补充标题前后空行
  - `__加粗__` 统一为 `**加粗**`
  - 列表缩进统一
- 保留“源码模式”作为可选项，方便需要精确查看原始 Markdown 时使用。
- 版本 `sha256` 与字节数放在**文档页脚右下角**，不放到页面右上角。
- 脚注交互参考 **wolai 的脚注实现**（行内上标引用 + 文档底部脚注编辑/展示）。

## 3. 总体架构

### 3.1 组件结构

```
WorkspacePreviewViewer
└── RichMarkdownEditor (新，替换 MarkdownEditor 的 document 分支)
    ├── TipTap EditorProvider / useEditor
    ├── 自定义 Extension：
    │   ├── MarkdownBridge (load/save)
    │   ├── Footnote (自定义 node)
    │   ├── InlineMath (自定义 mark)
    │   └── 现有工具栏命令适配
    ├── 浮动选中工具栏（重写为 TipTap 版本）
    └── 文档页脚（右下角：版本 sha256 + 字节数）
```

### 3.2 数据流

```
.md 文本
  → MarkdownParser (prosemirror-markdown / tiptap-markdown)
  → ProseMirror 文档节点
  → 用户编辑
  → 任意变更触发 onChange(markdown)
  → DocumentSession.updateDraft(text)
  → 自动保存 / Ctrl+S / 冲突处理（保持现有逻辑不变）
```

### 3.3 与现有模块的边界

- `DocumentSession`：不变。RichMarkdownEditor 只负责把 ProseMirror 文档序列化为 Markdown 字符串交给 `onChange`。
- `WorkspacePreviewViewer`：布局基本不变，编辑态渲染 RichMarkdownEditor。
- `editing-preferences.ts`：不变。CSS 变量继续通过 editor host 注入。
- `markdown-live-preview.ts`：在 document 模式下停用/删除；code 模式仍可用 CodeMirror。
- `MarkdownEditor.tsx`：保留给 code/plain 模式；document 模式改走 RichMarkdownEditor。

### 3.4 样式与主题

- 编辑区复用阅读设置：`--wb-reader-font-size`、`--wb-reader-font-family`、`--wb-reader-width`、`--wb-reader-color`、`--wb-code-font-family`。
- 预览与编辑共用同一套 Markdown 排版 CSS，目标：打开编辑后视觉上与预览基本一致。
- 编辑器内元素使用真实语义标签：`h1`–`h6`、`blockquote`、`ul/ol/li`、`pre > code`、`table`、`a`、`sup` 等，不再需要装饰隐藏。

## 4. 功能设计

### 4.1 基础节点

由 `@tiptap/starter-kit` 提供：

- paragraph
- heading (h1–h6)
- bulletList / orderedList / listItem
- blockquote
- codeBlock
- bold / italic / strike / inlineCode
- hardBreak
- horizontalRule

### 4.2 表格

- 使用 `@tiptap/extension-table` + `table-row` + `table-cell` + `table-header`。
- 支持插入/删除行列、表头、对齐。
- 序列化回 GFM 表格。

### 4.3 任务列表

- 使用 `@tiptap/extension-task-list` + `task-item`。
- 序列化回 `- [ ]` / `- [x]`。

### 4.4 链接

- 使用 `@tiptap/extension-link`。
- 显示颜色/下划线跟随当前主题。
- 仅允许安全协议（http/https/mailto 等），与预览安全策略一致。

### 4.5 脚注（参考 wolai 风格）

- 行内显示为上标数字：`[1]` 渲染为 `1` 上标。
- 点击上标可定位到文档底部对应脚注内容。
- 文档底部脚注区可编辑，格式为 `[^n]: 内容`。
- 序列化回 Markdown 标准脚注语法。
- 具体 DOM/交互细节在 Phase 2 实现前，先对照 wolai 客户端实际交互再冻结。

### 4.6 行内公式

- 自定义 `inlineMath` mark，使用 KaTeX 渲染。
- 保留现有“行内公式”工具栏按钮。
- 序列化回 `$...$`。

### 4.7 浮动选中工具栏

- 基于 TipTap `useEditor` + `selection` 重写。
- 保留 H1–H6、加粗、斜体、删除线、行内代码、行内公式、链接、双链、脚注、代码块、搜索选中。
- 语义改为对 ProseMirror 节点/mark 执行 toggle。

### 4.8 文档页脚

- 版本 `sha256`（短哈希 + hover 完整值）与字节数放在编辑区/预览区**右下角页脚**。
- 不放入页面右上角头部。
- 保持现有 `.viewerFooter` 的右下对齐语义。

## 5. 实施阶段

### Phase 1：核心替换（最小可用 WYSIWYG）—— 已完成

范围：

- 引入 TipTap 核心依赖。
- 新增 `RichMarkdownEditor.tsx`。
- Markdown 加载/保存桥接。
- 基础节点：段落、标题、列表、引用、代码块、加粗/斜体/删除线/行内代码。
- 保留 DocumentSession、自动保存、冲突、放弃。
- 重写浮动工具栏。
- 文档页脚右下角。
- 停用 document 模式下的 `markdown-live-preview` 装饰。

验收：

- 打开 M9_DESIGN.md 点编辑，标题/段落/列表/引用/代码块视觉与预览基本一致。
- 选中文本不再错位。
- 保存后 Markdown 语义不变（格式可规范化）。
- 单测与 smoke 中 R-ED 相关断言更新为 TipTap 版本。

### Phase 2：补齐复杂节点（进行中）

范围：

- [x] 表格
- [x] 任务列表
- [x] 链接
- [x] 脚注（wolai 风格，简化版）
- [x] 行内公式（编辑态 span 样式，序列化 `$...$`）
- [x] 搜索选中

### Phase 3：收尾（✅ 2026-08-19 完成）

- [x] 可选源码模式切换。
- [x] 长文档性能验证（M9 smoke realFileProbe 覆盖滚动/渲染）。
- [x] 清理 CodeMirror document 模式相关 CSS/逻辑/测试。
- [x] 全量门禁与启动门验证；打包验证留到发布/验收需要时执行。

## 6. 测试影响

需要修改的现有测试/探针：

- `plugins/workbench/test/markdown-live-preview.test.js`
  - 改为 Markdown roundtrip / 富文本节点断言。
- `plugins/workbench/test/structure.test.js`
  - bundle 纯净断言允许 TipTap 依赖。
- `scripts/smoke.js` / `src/main.js` R-ED 探针
  - `livePreviewHiddenMarkers` → WYSIWYG 节点探针。
  - `toolbarShown` → TipTap 工具栏探针。
  - `realFileProbe` → 检查真实 `h2`、`blockquote`、`ul > li`、`pre` 等 DOM 节点。

新增测试：

- Markdown → ProseMirror → Markdown roundtrip。
- 脚注序列化/反序列化。
- 表格、任务列表 roundtrip。
- 保存规范化行为快照。

## 7. 风险

1. **Markdown 往返规范化**：已确认接受；`##1.` 这类写法按 Markdown 语法会被解析为标题文字 `1.`，不是“二级标题下的列表”。
2. **脚注/公式无现成扩展**：需要自定义 node/mark，并保证与现有预览渲染兼容。
3. **依赖体积**：引入 TipTap/ProseMirror 生态，需要过 bundle 纯净与打包门禁。
4. **R-ED 相关测试**：需要同步改造，不能只换编辑器不换断言。

## 8. 工作量

- Phase 1：3～5 个工作日。
- Phase 2：约 1 周。
- Phase 3：2～3 天。
- 合计：约 1.5～2 周。
