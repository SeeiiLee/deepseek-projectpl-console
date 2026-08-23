import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const client = readFileSync(new URL('../src/client/index.ts', import.meta.url), 'utf8')
const panel = readFileSync(new URL('../src/client/WorkbenchPanel.tsx', import.meta.url), 'utf8')
const service = readFileSync(new URL('../src/client/service.ts', import.meta.url), 'utf8')
const css = readFileSync(new URL('../src/client/WorkbenchPanel.module.css', import.meta.url), 'utf8')

test('declares one clear manifest sentence and depends on Personal Shell', () => {
  assert.equal(manifest.name, '@cyrus/dsh-workbench')
  assert.match(manifest.description, /。$/)
  assert.deepEqual(manifest.dsh.client.inject, [
    '@cyrus/dsh-personal-shell',
    '@deepseek-ai/dsh-client-runtime',
  ])
})

test('registers exactly the shell-owned workbench.panel root and ctx.workbench', () => {
  assert.match(client, /slots\.inject\('workbench\.panel'/)
  assert.match(client, /name: 'workbench\.panel'/)
  assert.match(client, /reflect\.provide\('workbench', workbench\)/)
  assert.match(client, /legacyDetails: ReactNode; detailsCommand: WorkbenchDetailsCommand/)
  assert.doesNotMatch(client, /slots\.register\(\{[\s\S]*?name: 'details'/)
})

test('ships stable smoke markers, seven tabs, and the legacy Details route', () => {
  assert.match(panel, /data-personal-workbench="gate-1"/)
  assert.match(panel, /data-personal-workbench-tabs/)
  assert.match(panel, /data-workbench-gate="1"/)
  assert.match(panel, /data-personal-workbench-current-view/)
  assert.match(panel, /data-personal-workbench-current-family/)
  // 固定页签只保留 Details；文件审阅由右侧文件树打开预览页签
  for (const title of ['Details']) {
    assert.match(service, new RegExp(`(?:${title.toLowerCase()}|${title})`))
  }
  assert.match(panel, /props\.legacyDetails/)
  assert.match(panel, /renderedViewer\.render\(active\)/)
  assert.match(panel, /mainTabs/)
  assert.match(panel, /workbench\.workspace-files/)
  assert.match(panel, /workbench:files-dock/)
  assert.match(panel, /data-personal-workbench-pathbar/)
  assert.match(panel, /data-personal-workbench-plugin-view/)
  assert.match(panel, /workbench\.dismissDetails\(\)/)
  assert.doesNotMatch(panel, /<header/)
})

test('uses only CSS Module classes and has no global selector escape', () => {
  assert.doesNotMatch(css, /:global/)
  assert.doesNotMatch(css, /(^|\n)\s*(html|body|button|input|textarea|select)(?:\s|,|\{)/)
})

test('keeps Gate 1 intents descriptor-only with no file, URL, or PTY execution path', () => {
  assert.doesNotMatch(service, /\bfetch\s*\(|readFile|writeFile|WebSocket|node-pty|spawn\s*\(|openExternal/)
})

test('W1：Context 条 = 图钉 + 可点击目标标签（整合「打开文件」）+ 异常状态', () => {
  const panel = readFileSync(new URL('../src/client/WorkbenchPanel.tsx', import.meta.url), 'utf8')
  assert.match(panel, /data-workspace-context-bar/)
  assert.match(panel, /data-workspace-context-target/)
  assert.match(panel, /data-workspace-context-status/)
  assert.match(panel, /data-workspace-context-pin/)
  assert.match(panel, /aria-pressed=\{pinned\}/)
  assert.match(panel, /pinned \? '跟随（取消固定）' : '固定当前浏览目标'/)
  // 目标标签 = 按钮：点击在资源管理器中打开浏览根
  assert.match(panel, /data-workspace-context-target\n\s+title=\{context\.primaryPath/)
  assert.match(panel, /revealInExplorer\(context\.primaryPath\)/)
  // 「打开文件」按钮已删除（与目标标签整合）
  assert.doesNotMatch(panel, /openFolderButton/)
  assert.doesNotMatch(panel, /打开文件/)
  assert.doesNotMatch(panel, /parentDirAbsolute/)
  // 模式文字 Chip 已移除
  assert.doesNotMatch(panel, /data-workspace-context-mode/)
  assert.doesNotMatch(panel, /CONTEXT_MODE_LABELS/)
  assert.match(panel, /if \(context === undefined\) return null/)
})

test('W1：头部字号统一为 12px——PathBar/Context 条不再混用其他刻度', () => {
  const css = readFileSync(new URL('../src/client/WorkbenchPanel.module.css', import.meta.url), 'utf8')
  assert.doesNotMatch(css, /openFolderButton/)
  assert.match(css, /\.pathSegment \{[\s\S]*?font-size: 12px/)
  assert.match(css, /\.pathLeaf \{[\s\S]*?font-size: 12px/)
  assert.match(css, /\.pathSlash \{[\s\S]*?font-size: 12px/)
  assert.match(css, /\.contextTarget \{[\s\S]*?font-size: 12px/)
  assert.match(css, /\.contextStatus \{[\s\S]*?font-size: 12px/)
})

test('W1：预览/代码选择按 Tab 单独内存记忆（防静默回归）', () => {
  const viewer = readFileSync(new URL('../src/client/WorkspacePreviewViewer.tsx', import.meta.url), 'utf8')
  assert.match(viewer, /viewModes = useRef\(new Map<string, 'preview' \| 'code'>\(\)\)/)
  assert.match(viewer, /viewModes\.current\.get\(descriptor\.id\)/)
  assert.match(viewer, /viewModes\.current\.set\(descriptor\.id, mode\)/)
  assert.match(viewer, /setViewModeState\(remembered \?\? \(isMarkdownExtension\(extension\) \? 'preview' : 'code'\)\)/)
  // 加载 effect 不得重置 viewMode
  assert.doesNotMatch(viewer, /setViewMode\(isMarkdownExtension\(path\) \? 'preview' : 'code'\)/)
})

test('R-ED Step3：编辑态 = 所见即所得单面板（无分屏、无编辑内预览——用户裁决 2026-08-19）', () => {
  const viewer = readFileSync(new URL('../src/client/WorkspacePreviewViewer.tsx', import.meta.url), 'utf8')
  // Markdown 走 TipTap 富文本，非 Markdown 文本仍走 CodeMirror code 模式
  assert.match(viewer, /RichMarkdownEditor/)
  assert.match(viewer, /<RichMarkdownEditor/)
  assert.match(viewer, /language="plain"/)
  // 编辑态不得再出现分屏/编辑内预览切换
  assert.doesNotMatch(viewer, /data-edit-split/)
  assert.doesNotMatch(viewer, /data-edit-preview-toggle/)
  assert.doesNotMatch(viewer, /usePanelWidth/)
  assert.doesNotMatch(viewer, /useAdaptiveDebounced/)
  assert.doesNotMatch(viewer, /editLayout/)
})

test('R-ED Phase1：富文本编辑器标记已进入 bundle', () => {
  const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.match(client, /data-rich-markdown-editor/)
  assert.match(client, /RichMarkdownEditor/)
})

test('R-ED Phase2：富文本编辑器接入表格与链接扩展', () => {
  const src = readFileSync(new URL('../src/client/RichMarkdownEditor.tsx', import.meta.url), 'utf8')
  assert.match(src, /@tiptap\/extension-table/)
  assert.match(src, /@tiptap\/extension-link/)
  assert.match(src, /insertTable/)
  assert.match(src, /setLink/)
})

test('R-ED Phase2：富文本编辑器接入脚注/行内公式/搜索/浮动工具栏', () => {
  const src = readFileSync(new URL('../src/client/RichMarkdownEditor.tsx', import.meta.url), 'utf8')
  assert.match(src, /Footnote/)
  assert.match(src, /InlineMath/)
  assert.match(src, /searchSelection/)
  assert.match(src, /toggleMark\('inlineMath'\)/)
  assert.match(src, /data-rich-markdown-bubble/)
  assert.doesNotMatch(src, /BubbleMenu/)
})

test('R-ED Phase2：脚注定义 renderHTML 必须把 content hole 放进独立子容器', () => {
  const src = readFileSync(new URL('../src/client/footnote.ts', import.meta.url), 'utf8')
  // ProseMirror renderSpec 不允许 content hole 与编号 span 并列；必须嵌套为父节点唯一子节点。
  assert.match(src, /\['div', \{ class: 'footnote-def-content' \}, 0\]/)
})

test('R-ED Phase3：富文本编辑器提供可选源码模式切换', () => {
  const src = readFileSync(new URL('../src/client/RichMarkdownEditor.tsx', import.meta.url), 'utf8')
  assert.match(src, /data-rich-markdown-source-toggle/)
  assert.match(src, /data-rich-markdown-source/)
  assert.match(src, /sourceMode/)
})

test('R-ED Wolai：斜杠命令新增图片/文件/数据库视图', () => {
  const slash = readFileSync(new URL('../src/client/slash-command.ts', import.meta.url), 'utf8')
  assert.match(slash, /图片\/媒体/)
  assert.match(slash, /文件\/附件/)
  assert.match(slash, /数据库\/表格视图/)
  const image = readFileSync(new URL('../src/client/image.ts', import.meta.url), 'utf8')
  assert.match(image, /name: 'image'/)
  assert.match(image, /serialize/)
  assert.match(image, /parseHTML/)
})

test('R-ED Phase3：CodeMirror document/live-preview 已清理', () => {
  const markdownEditor = readFileSync(new URL('../src/client/MarkdownEditor.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(markdownEditor, /markdownLivePreview|markdown-live-preview/)
  assert.doesNotMatch(markdownEditor, /variant\?: 'code' \| 'document'/)
  assert.equal(existsSync(new URL('../src/client/markdown-live-preview.ts', import.meta.url)), false)
  assert.equal(existsSync(new URL('./markdown-live-preview.test.js', import.meta.url)), false)
})

test('R-ED Phase1：富文本编辑器保留 Ctrl+S 保存', () => {
  const src = readFileSync(new URL('../src/client/RichMarkdownEditor.tsx', import.meta.url), 'utf8')
  assert.match(src, /onSaveRef/)
  assert.match(src, /event\.key\.toLowerCase\(\) === 's'/)
})

test('R-ED bundle 纯净：lib/client.js 内联 CodeMirror（无外部 import/require）', () => {
  const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.doesNotMatch(client, /from "@codemirror\/|require\("@codemirror\//)
  // 内联证据：编辑器宿主标记存在
  assert.match(client, /data-codemirror-editor/)
})

test('R-PV1 bundle 纯净：lib/client.js 不出现第二份 markdown/shiki/katex 栈', () => {
  const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.doesNotMatch(client, /react-markdown|remark-parse|rehype-raw|katex\/dist|prismjs|react-syntax-highlighter/)
})

test('ships Host and Client bundle artifacts', async () => {
  for (const file of ['../lib/index.js', '../lib/client.js', '../lib/client.js.map']) {
    assert.equal(existsSync(new URL(file, import.meta.url)), true, `${file} is missing`)
  }
  const host = await import('../lib/index.js')
  assert.equal(host.inject[0], 'webServer')
  const registered = []
  host.apply({
    webServer: {
      register(route) {
        registered.push(route.path)
        return () => {}
      },
    },
    effect(factory) {
      factory()
    },
  })
  assert.deepEqual(registered, ['/__personal/workspace'])
  const bundle = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.match(bundle, /@cyrus\/dsh-workbench/)
  assert.match(bundle, /data-personal-workbench/)
  assert.match(bundle, /workbench\.workspace-files/)
  assert.match(bundle, /workbench\.workspace-preview/)
  assert.match(bundle, /workbench\.session-terminal/)
})
