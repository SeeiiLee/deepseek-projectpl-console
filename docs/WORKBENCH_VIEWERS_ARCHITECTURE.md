# Workbench 四页签（Code / Outline / Diff / Browser）架构升级设计

日期：2026-08-19
状态：Phase A 已完成（2026-08-19 接续 Kimi 代码收口：matchViewer 接线、四页签测试、smoke 探针、全量门禁通过）
参考：`refs/tmp-better-sidebar`（omdsh-dev/DSH-better-sidebar，临时克隆，插件开发完成后可废弃）

## 1. 背景与问题

P8 当时以"管线通"为验收标准，四个页签的骨架（viewer registry / open intent / workspace remote）是好的，但业务深度不足：

| 页签 | 现状 | 缺口 |
| --- | --- | --- |
| Code（Preview） | 306 行，真实实现，相对完整 | 查看器选择靠调用方手写 resourceKey，无按文件类型自动匹配 |
| Outline | 提取器 13 行正则扫 `#` | 不跳过围栏代码块内的 `#`；不支持代码文件符号；不能点击跳转；不跟随活动文件 |
| Diff | 简化 diff 算法，无前缀对齐 | 无 hunk/行号/折叠；无文件选择入口，resourceKey 只能手写 |
| Browser | 地址栏 + sandbox iframe | 无 URL 归一化/回环拦截；无嵌入性探测（X-Frame-Options 白屏无解释）；无前进后退/刷新；URL 不持久化 |

另：冒烟测试此前只覆盖 Markdown 编辑器，四页签无端到端回归保护。

## 2. 从参考仓库借鉴什么（不全抄）

参考仓库是"服务化侧边栏"，理念与我们不同（我们是 family + open intent 模型，它是扁平 tab + 服务注册模型）。**只借鉴四个经过验证的局部设计，不引入它的整体架构**：

1. **Viewer 描述符的文件匹配语义**（builtins/viewers.tsx + service.ts matchFileViewer）：
   - 描述符带 `exts` / `priority` / `detect(path, headBytes)`；匹配按 priority 降序、稳定；有 head 字节时 `detect` 先于 `exts`；带 detect 的 catch-all 是"嗅探专属"，没有 head 时不盲认领；无 detect 的 catch-all 兜底一切。
2. **Browser 的嵌入性探测**（browser-probe.ts + BrowserView.tsx）：
   - Host 侧 HEAD 取响应头，纯函数解析 `X-Frame-Options` 与 CSP `frame-ancestors` → 判 blocked；blocked 时显示原因面板（外部打开 / 仍然加载）而不是浏览器默认的"拒绝连接"白屏。
   - 地址栏归一化：只 http(s)，拒绝 loopback / 应用自身 origin。
   - sandbox 永不含 `allow-same-origin` 与 `allow-top-navigation`；前进/后退/刷新用 history stack + remount。
3. **Diff 的 VSCode 式渲染**（DiffView.tsx）：
   - 纯函数解析为 hunk 结构（`@@` 头 + 双侧行号 + ctx/del/add 行）；行数上限 + 展开按钮；未变区域折叠。
   - 它的 `parseUnifiedDiff` 面向 git 输出文本；我们的场景是"工作区两文件对比"，所以算法层用自己的 Myers，渲染层借鉴 hunk/gutter/折叠结构。
4. **它的 declarative settings / lazy chunks / Git 面板 / Office 预览不引入本轮**（记录为后续候选）。

我们没有借鉴 Outline（它没有），Outline 升级是原创设计。

## 3. 目标架构（Phase A）

### 3.1 Viewer 注册体系扩展（contracts.ts / viewers.ts）

`WorkbenchViewerDefinition` 增加可选字段（全部向后兼容，缺省即现状）：

```ts
interface WorkbenchViewerDefinition {
  id; family; title; canRestore; render?;        // 既有
  exts?: readonly string[]                       // 关联扩展名（小写、无点）
  priority?: number                              // 匹配优先级，默认 0，降序稳定
  detect?: (path: string, head: Uint8Array) => boolean  // 内容嗅探，先于 exts
}
```

Registry 新增 `matchViewer(path, head?)`：
- 只匹配 `family === 'preview'` 的查看器（文件预览匹配面）；
- 按 priority 降序（同序稳定）逐个尝试：`head` 可用时先 `detect`，再过 `exts`；
- `detect` 存在但 `head` 未提供 → 本轮跳过（sniff-only，不盲认领）；
- `exts` 为空数组且无 `detect` → catch-all，盲认领。

### 3.2 Browser 升级

- **新增纯函数模块 `browser-url.ts`**：`normalizeBrowserUrl(raw, ownOrigin)` → `ok(url)` / `invalid` / `blocked(scheme|loopback|self)`；拒绝 `file:`/`javascript:` 等非 http(s)、`localhost`/`127.*`/`::1`/应用自身 origin。
- **Host 新增路由 `GET /__personal/workspace/browser-probe?url=`**（workspace-remote.ts）：
  - 仅 http(s)、拒绝 loopback；5 秒超时；HEAD 失败回退 GET（立即 abort，只取头）；
  - 返回 `{ ok, embeddable: 'ok'|'blocked'|'unknown', reason? }`，解析逻辑放纯函数 `browser-probe.ts`（`extractFrameAncestors` / `xfoBlocks` / `frameAncestorsBlock`），可单测、不发请求。
- **Viewer 重写**：地址栏 + 后退/前进/刷新（history stack + cursor + iframe remount key）；导航前 probe，blocked 显示解释面板（在外部浏览器打开 / 仍然加载）；sandbox 保持无 `allow-same-origin`，补 `allow-downloads allow-modals`；`referrerPolicy="no-referrer"`；URL 变化经 `service.updateTab` 持久化到 descriptor（resourceKey + title=hostname），重启后恢复页面。

### 3.3 Diff 升级

- **`workspace-diff.ts` 重写**（纯函数，全部可单测）：
  - `diffLines(a, b)`：Myers O(ND) 最短编辑脚本（替换原简化算法），大输入（>20000 行）退化为整换对齐，保证有界；
  - `buildHunks(lines, contextLines=3)`：合并为 hunk（`oldStart/newStart` + 行列表），未变区域不进入 hunk；
  - 保留 `isWorkspaceDiffResourceKey` 兼容既有 resourceKey 格式。
- **Viewer 重写**：hunk 头（`@@ -a,b +c,d @@`）+ 左右行号 gutter + 增删配色；总行数 >500 折叠为头/尾 + 展开按钮；resourceKey 缺右文件时显示对比目标选择（走 `/search` 文件名搜索选择）。

### 3.4 Outline 升级

- **`outline.ts` 重写**（纯函数）：`extractOutline(text, path?)`
  - Markdown：扫描标题但**跳过围栏代码块**（``` 与 ~~~）内的 `#`；
  - 代码文件（按扩展名 ts/tsx/js/jsx/py/go/rs/java 等）：启发式符号提取（`function|class|interface|const … = (`, `def|class` 等），level 按缩进/种类推断；
  - 未知类型回退 Markdown 规则。
- **Viewer 重写**：
  - **跟随活动文件**：resourceKey 为 `workspace-outline:follow` 时，从 snapshot 找当前激活的 preview 页签，对其文件出大纲，活动页签切换自动跟随；
  - **点击跳转**：点击条目 → 若目标文件已有 preview 页签则激活并广播 `workbench:reveal-line`（CustomEvent，path+line）；否则打开 preview 页签并在 resourceKey 带 `#L<line>`，Preview/Code 查看器初始渲染后滚动到该行。

### 3.5 Preview/Code 配合改动

- `WorkspacePreviewViewer` 监听 `workbench:reveal-line`，对自身 path 匹配时滚动对应行（文本编辑器滚动 `.cm-scroller`；只读预览滚动容器）。
- Code 查看器注册为 preview family 的 catch-all（`exts: []`，priority -100）；Markdown 预览查看器 `exts: ['md','markdown']`，priority 10。

### 3.6 Service 小扩展

- `WorkbenchService` 新增 `updateTab(tabId, patch: { resourceKey?, title? })`：持久化并 publish（Browser 持久化 URL 用）。校验沿用 `normalizeText` / `safeIdentifier`。

## 4. 边界与不做

- 不引入参考仓库的服务注册总线（`ctx.betterSidebar`）、双工作台、lazy chunks、Git 面板、Office 预览、声明式设置页。
- Browser 不做多开网页 tab（用现有页签机制多开即可）、不做页内历史跟踪（iframe 跨域不可见，与参考仓库同样声明为已知限制）。
- Diff 不接 Git（stage/discard/commit 继续后置）；不做并排双栏（先单栏 hunk）。
- Outline 不做 LSP 级符号（无语言服务器），启发式覆盖主流语言即可。
- 冒烟新增四页签探针（outline/diff/browser/code 各一），只验证"能打开、核心结构在场"，不做交互级断言。

## 5. 验收

- `node --test` 既有套件全绿 + 新增纯函数测试（browser-url / browser-probe / outline / workspace-diff / viewers.matchViewer / service.updateTab）。
- `node scripts/check-plugins.js`（workbench tsc 0 错误）。
- `node scripts/smoke.js` 通过，新增 `outlineProbe` / `diffProbe` / `browserProbe` / `codeProbe`。
- 参考仓库目录 `refs/tmp-better-sidebar` 不进入任何构建/打包产物（已在 IGNORED 或未被引用；发布前删除）。
