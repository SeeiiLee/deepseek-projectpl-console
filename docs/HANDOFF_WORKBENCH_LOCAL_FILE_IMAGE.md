# Workbench 富文本编辑器：本地文件/图片拖拽与保存往返问题（Handoff）

> 状态：待 Kimi K3 接手分析
> 日期：2026-08-19
> 关联：`docs/RICH_TEXT_EDITOR_REFACTOR.md`、`docs/NEXT.md`

## 环境

- 插件：`plugins/workbench`
- 编辑器：TipTap / ProseMirror 富文本 Markdown 编辑器
- 预览：插件内 `markdown-lite.tsx`
- 桌面桥：`src/preload.cjs` + `src/desktop-bridge.js`
- 相关文件：
  - `plugins/workbench/src/client/RichMarkdownEditor.tsx`
  - `plugins/workbench/src/client/file-attachment.ts`
  - `plugins/workbench/src/client/FileAttachmentView.tsx`
  - `plugins/workbench/src/client/image.ts`
  - `plugins/workbench/src/client/ImageView.tsx`
  - `plugins/workbench/src/client/markdown-lite.tsx`
  - `plugins/workbench/src/client/WorkspaceMarkdownDocument.tsx`
  - `plugins/workbench/src/client/desktopReveal.ts`

## 目标行为

1. 用户把本地文件/图片拖入编辑器正文。
2. 编辑器内：
   - 文件显示为“📎 文件名”卡片；
   - 图片显示为可缩放、居中的图片块。
3. 保存为 Markdown 后：
   - 文件序列化为 `[文件名](路径)`；
   - 图片序列化为 `![说明](路径)`。
4. 保存后：
   - 预览能显示文件链接和本地图片；
   - 重新进入编辑后，文件和图片仍能还原为卡片/图片块；
   - 点击文件卡片能用系统默认应用打开文件，且不退出编辑、不丢未保存内容。

## 当前问题

### 问题 1：点击文件卡片不能打开文件，还会退出编辑/跳预览

- 现象：
  - 拖入 md 文件后，编辑器内显示超链接；
  - 点击该超链接：
    - 没有用系统默认应用打开文件；
    - 自动退出编辑状态 / 跳到预览界面。
- 期望：
  - 点击文件卡片调用 `shell.openPath` 打开文件；
  - 不改变编辑状态，不丢失未保存内容。

### 问题 2：保存后重新进入编辑，文件卡片/超链接丢失

- 现象：
  - 保存后切到预览：md 文件超链接丢失（显示成纯文本或没有链接）；
  - 再次进入编辑：md 文件的“📎 文件名”卡片完全丢失。
- 期望：
  - 保存后的 Markdown 本地链接，重新进入编辑时能还原为文件附件卡片。

### 问题 3：保存后重新进入编辑，本地图片显示失败

- 现象：
  - 拖入/选择本地图片后，编辑器内能正常显示；
  - 保存后：
    - 预览看不到图片；
    - 重新进入编辑后图片只剩“图标 + 文件名”，实际图片不渲染。
- 期望：
  - 保存后预览能显示本地图片；
  - 重新进入编辑后仍能显示本地图片。

### 问题 4（已修复，但需确认）

- 重复拖拽插入两份的问题已修复。
- 但不确定是否完全稳定，建议检查 `handleDrop` 是否只走一条路径。

## 已尝试过的修复（但仍未完全解决）

### 已加的能力

- `src/preload.cjs` 暴露：
  - `getPathForFile(file)` → 用 `webUtils.getPathForFile` 拿真实绝对路径；
  - `openPath(path)` → 主进程 `shell.openPath`；
  - `readFileAsDataURL(path)` → 主进程读取本地文件为 data URL。
- 文件附件节点 `file-attachment.ts`：
  - 编辑器内 NodeView 显示“📎 文件名”；
  - 序列化为 `[name](<path>)`（路径含空格时加 `<>`）；
  - 尝试在 Markdown 解析时把本地链接 `<a>` 转回 `div[data-file-attachment]`。
- 图片节点 `image.ts`：
  - 增加 `dataPath` 属性；
  - Markdown 图片解析时把 `src` 同时写入 `dataPath`；
  - `ImageView` 对本地路径调用 `readFileAsDataURL` 显示。
- 预览：
  - `markdown-lite` 支持 `<...>` 包裹的链接/图片；
  - `WorkspaceMarkdownDocument` 对本地图片调用 `readFileAsDataURL` 转 data URL。

### 仍失败的怀疑点

1. **文件附件 Markdown 往返**：
   - `file-attachment.ts` 的 `parse.updateDOM` 把 `<a>` 替换成 `<div data-file-attachment>`，但该 `<div>` 在 `<p>` 内部，`MarkdownParser.normalizeBlocks` 是否真的能把块节点提取出来？
   - 如果提取失败，文件附件就无法还原成块节点。
2. **点击文件卡片**：
   - `FileAttachmentView` 已 `preventDefault + stopPropagation`，但仍会退出编辑/跳预览，说明可能有更上层的点击/导航拦截（ProseMirror `handleClick`、Workbench 页签逻辑、或 `<a href>` 默认行为没有被完全阻止）。
3. **图片显示**：
   - `ImageView` 对本地路径调用 `readFileAsDataURL`，但保存后再进入编辑时 `src` 可能是 URL 编码后的路径（如 `%20`），或 `dataPath` 仍为空/相对路径；
   - 预览中 `WorkspaceMarkdownDocument` 的 data URL 替换 effect 可能在图片渲染前/后被覆盖，或者相对路径无法解析。
4. **相对路径 vs 绝对路径**：
   - 新拖入的文件/图片现在应拿到绝对路径；
   - 但旧数据或手动输入的相对路径（`./xxx`）仍无法打开/显示。

## 请重点检查

1. `file-attachment.ts` 的 `parse.updateDOM` 是否真的能把本地链接还原成文件附件块节点。
2. `FileAttachmentView` 点击事件是否被更上层拦截，`openPath` 是否被调用。
3. `ImageView` 在“保存后重新进入编辑”时，`src`/`dataPath` 实际是什么值，为什么 `readFileAsDataURL` 没生效。
4. `WorkspaceMarkdownDocument` 的本地图片 data URL 替换是否稳定。
5. `RichMarkdownEditor` 的 `handleDrop` 与 DSH 原生拖拽逻辑是否还有冲突。

## 复现步骤

1. 启动开发版。
2. 打开一个 Markdown 文件，进入编辑。
3. 拖入一个本地 `.md` 文件和一个本地图片。
4. 保存。
5. 切到预览：检查文件链接和图片是否显示。
6. 重新进入编辑：检查文件卡片和图片是否还原。
7. 点击文件卡片：检查是否能打开文件、是否退出编辑。

---

## 修复结论（2026-08-20，已闭环）

**根因（一句话）**：`src/desktop-bridge.js` 的 IPC 白名单漏登记 `open-path` 和 `read-file-as-data-url` 两个 action——主进程 case 存在，但每次调用都在校验层抛错，渲染层静默吞掉，导致「点击打开」与「图片读 data URL」两条链路全断。

### 修复清单

1. **白名单补全 + 路径校验 + 64 MiB 读上限**（`src/desktop-bridge.js`）：`open-path`/`read-file-as-data-url` 放行，仅接受安全的本地绝对路径（拒绝 UNC、控制字符）；文件不存在/超大返回结构化错误而不是抛异常。
2. **统一路径解析**（`plugins/workbench/src/client/desktopReveal.ts`）：新增 `resolveLocalPath`——绝对路径归一化、相对路径按当前文档目录拼接（`..` 不越根）、`file:///` URL 还原（Typora 外链形式）、`%20`/`%5C` 解码。编辑器、预览、点击打开全部走这一个入口。
3. **保存往返硬化**（`file-attachment.ts` / `image.ts`）：只有「独占一个段落的本地链接」才还原为附件块（行内链接不再被撕裂）；序列化统一解码、正斜杠、含空白/括号用 `<>` 包裹，多次保存不漂移。
4. **点击打开体验**（`FileAttachmentView.tsx`）：点击彻底消费（preventDefault + stopPropagation + ProseMirror handleClick 守卫），不退出编辑、不跳页；相对路径可解析；打不开时卡片短暂显示 ⚠️ 内联反馈，不再静默。
5. **图片显示零破图零噪音**（`ImageView.tsx` / `markdown-lite.tsx` / `WorkspaceMarkdownDocument.tsx`）：本地图片不再把原始路径写进 `<img src>`（Chromium 会把 `F:/x` 重解释成 `file:///` 并拦截），统一经桥读成 data URL；读取中带呼吸占位，失败显示克制占位卡。
6. **拖拽收口**（`RichMarkdownEditor.tsx`）：只在真正有外部文件时拦截 drop，编辑器内部拖拽完整交还 ProseMirror；多文件单事务插入，无双份。

### 验证证据

- 单测：workbench 插件 111/111 通过（含新增 file:// 归一化用例）；desktop-bridge 14/14；全仓既有失败仅环境性（Git Bash 无 powershell 等），与本次无关。
- 类型检查：`tsc --noEmit` 干净。
- 端到端冒烟（`scripts/smoke.js`，新增 22 项本地文件/图片探针）：全部通过；渲染日志中 `Not allowed to load local resource` 与 `Invalid local file path` 均为 0 条。
- 探针覆盖：序列化/落盘原文/预览 data URL/重进编辑还原/点击不导航不退出+失败反馈/桥读真实 PNG/缺失文件返回 ok:false/相对路径被校验拒绝/拖入单份插入。

### 环境备注（与本次修复无关的既有问题）

在 Kimi Work 的 Git Bash 里直接跑 `node scripts/smoke.js` 会因两个 PATH 坑失败：① `where node` 首推 `node.cmd` 导致主进程 `spawn EINVAL`（可用 `DSH_NODE_EXECUTABLE=<真实 node.exe>` 绕过）；② PATH 缺 PowerShell 目录导致 memory 插件 DPAPI 初始化失败（把 `C:\Windows\System32\WindowsPowerShell\v1.0` 加进 PATH 即可）。普通终端/PowerShell 下无此问题。
