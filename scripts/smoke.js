import { resolveBuildRoot } from './build-kit.mjs'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { createConnection } from 'node:net'
import { join, resolve, sep } from 'node:path'
import { assertAutomationSafe, protectedRootOf } from './protected-paths.js'
import { prepareSmokeExecutable } from './smoke-executable.js'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { setTimeout as delay } from 'node:timers/promises'

const projectRoot = resolve(import.meta.dirname, '..')
const require = createRequire(import.meta.url)
const packagedExecutable = process.argv[2] === undefined ? undefined : resolve(process.argv[2])
// Packaged verification runs a RENAMED COPY so the smoke instance can never
// share a process name with the real installed client. Cleanup stays
// PID-based; the distinct "-Smoke.exe" name is a second safety layer.
const smokeExecutable = packagedExecutable === undefined ? null : prepareSmokeExecutable(packagedExecutable)
const electronExecutable = smokeExecutable?.executable ?? packagedExecutable ?? require('electron')
const tempRoot = mkdtempSync(join(tmpdir(), 'dsh-desktop-smoke-'))
const resultPath = join(tempRoot, 'result.json')
const workspaceRoot = join(tempRoot, 'workspace')
const dshHome = join(tempRoot, 'dsh-home')
const agentsHome = join(tempRoot, 'agents-home')
const userData = join(tempRoot, 'electron-user-data')
const projectControlHome = join(tempRoot, 'project-control')
// Cyrus 红线 tripwire: every smoke path must be automation-owned (temp), and
// the packaged executable under test must never live inside a protected root.
for (const [label, path] of [
  ['冒烟临时根目录', tempRoot],
  ['冒烟 DSH_HOME', dshHome],
  ['冒烟 userData', userData],
  ['冒烟工作区', workspaceRoot],
  ['冒烟项目库', projectControlHome],
]) {
  assertAutomationSafe(path, label)
}
if (packagedExecutable !== undefined) {
  assertAutomationSafe(packagedExecutable, '冒烟被测可执行文件')
  const protectedMatch = protectedRootOf(packagedExecutable)
  if (protectedMatch !== null) {
    throw new Error(`受保护路径拦截：冒烟被测可执行文件位于稳定版目录 ${protectedMatch} 之内。`)
  }
}
mkdirSync(workspaceRoot)
mkdirSync(agentsHome)
mkdirSync(userData)
// 合成项目夹具：intake e2e 探针的扫描对象（legacy 形态：README + docs 角色文档）
{
  const syntheticProject = join(workspaceRoot, 'synthetic-food-project')
  mkdirSync(join(syntheticProject, 'docs'), { recursive: true })
  writeFileSync(join(syntheticProject, 'README.md'), '# Synthetic Food Project\n\nSmoke fixture project for intake e2e.\n')
  writeFileSync(join(syntheticProject, 'docs', 'PRD.md'), '# PRD\n\n合成需求文档：食品溯源 SaaS。\n')
// 真实形态夹具：用户实际验收文件（docs/M9_DESIGN.md）——嵌套加粗/围栏/表格/中文列表
copyFileSync(join(projectRoot, 'test', 'fixtures', 'M9_DESIGN.md'), join(syntheticProject, 'docs', 'M9_DESIGN.md'))
  writeFileSync(join(syntheticProject, 'docs', 'ARCHITECTURE.md'), '# Architecture\n\n合成架构文档。\n')
  writeFileSync(join(syntheticProject, 'docs', 'sample.txt'), 'hello\nworld\n')
  // R-ED 本地文件/图片夹具：带空格与中文的目录名/文件名 + 一张真实 PNG，
  // 覆盖附件卡片与本地图片的拖入→保存→预览→再编辑→点击打开全链路。
  writeFileSync(join(syntheticProject, 'docs', '附件测试.md'), '# 附件测试\n\n本地文件与图片夹具。\n')
  writeFileSync(
    join(syntheticProject, 'docs', '测试图片.png'),
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
  )
  mkdirSync(join(syntheticProject, 'docs', '子 目录'), { recursive: true })
  writeFileSync(join(syntheticProject, 'docs', '子 目录', '目 标 文件.md'), '# 目 标 文件\n\n带空格路径的打开目标。\n')
  const conflictProject = join(workspaceRoot, 'synthetic-conflict-project')
  mkdirSync(join(conflictProject, 'docs'), { recursive: true })
  writeFileSync(join(conflictProject, 'README.md'), '# Synthetic Conflict Project\n\n带有文档角色冲突的夹具项目。\n')
  writeFileSync(join(conflictProject, 'docs', 'PRD.md'), '# PRD\n\n第一份需求文档。\n')
  writeFileSync(join(conflictProject, 'docs', '产品需求.md'), '# 产品需求\n\n第二份需求文档（与 PRD 角色冲突）。\n')
}

let passed = false
let output = ''
let child

try {
  const env = {
    ...withoutSecrets(process.env),
    DSH_DESKTOP_SMOKE: '1',
    DSH_DESKTOP_SMOKE_RESULT: resultPath,
    DSH_DESKTOP_USER_DATA: userData,
    DSH_HOME: dshHome,
    DSH_AGENTS_HOME: agentsHome,
    PROJECT_CONTROL_HOME: projectControlHome,
    DSH_SOURCE_ROOT: process.env.DSH_SOURCE_ROOT ?? resolveBuildRoot(),
    DSH_WORKSPACE_ROOT: workspaceRoot,
    DSH_TELEMETRY_DISABLED: '1',
    // 记忆插件启动自检：真实走一遍 DPAPI 解锁 + SQLCipher 打开 + 完整性校验
    DSH_MEMORY_SELF_TEST: '1',
    // P3-2 提取管线冒烟：轮末走一遍需求门/连接查找（无连接时静默跳过，验证接线不断会话）
    DSH_MEMORY_EXTRACTION: '1',
    // P4-2 嵌入：模型目录由 main.js 的 flavor 解析梯决定（env 覆盖 → 开发/稳定各自数据根），
    // 冒烟不再注入路径（避免把 F:\AI 等写死路径带进打包验证）。
  }
  delete env.ELECTRON_RUN_AS_NODE

  if (packagedExecutable !== undefined) {
    assert.equal(existsSync(packagedExecutable), true, `Packaged executable does not exist: ${packagedExecutable}`)
  }
  const extraArgs = (process.env.DSH_SMOKE_ELECTRON_ARGS ?? '').split(' ').filter(Boolean)
  child = spawn(electronExecutable, [...(packagedExecutable === undefined ? [projectRoot] : []), ...extraArgs], {
    cwd: projectRoot,
    env,
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', chunk => { output = `${output}${chunk}`.slice(-30_000) })
  child.stderr.on('data', chunk => { output = `${output}${chunk}`.slice(-30_000) })

  const outcome = await waitForProcess(child, 180_000)
  assert.equal(outcome.timedOut, false, `Electron smoke timed out.\n${output}`)
  assert.equal(outcome.code, 0, `Electron smoke exited ${String(outcome.code)}.\n${output}`)
  assert.equal(existsSync(resultPath), true, `Electron did not write a smoke result.\n${output}`)

  const result = JSON.parse(readFileSync(resultPath, 'utf8'))
  assert.equal(result.pageLoaded, true)
  assert.equal(result.stop?.graceful, true)
  assert.equal(result.stop?.forced, false)
  assert.equal(result.stop?.code, 0)
  assert.equal(result.stop?.signal, null)
  assert.equal(result.portClosed, true)
  assert.equal(result.personalState?.passed, true, JSON.stringify(result.personalState, null, 2))
  for (const resource of ['theme', 'skills', 'plugins', 'connections']) {
    assert.equal(result.personalState?.api?.[resource]?.ok, true, `${resource} API was unavailable.`)
  }
  assert.deepEqual(result.personalState?.missingEntries, [])
  assert.deepEqual(result.personalState?.unexpectedEntries, [])
  if (process.env.DSH_PERSONAL_PLUGINS_EXTERNAL !== undefined && process.env.DSH_PERSONAL_PLUGINS_EXTERNAL !== '') {
    assert.equal(result.personalState?.externalDoctor?.active, true, 'external generation doctor did not report active')
    for (const name of ['@cyrus/dsh-anysearch', '@cyrus/dsh-trajectory-island']) {
      assert.equal(result.personalState?.api?.plugins?.fiber?.[name], 'active', `${name} fiber is not active`)
    }
  }
  assert.equal(result.personalState?.gate1Shell?.rootPresent, true)
  assert.equal(result.personalState?.gate1Shell?.projectPanelPresent, true)
  assert.equal(result.personalState?.gate1Shell?.projectControlPresent, true)
  assert.equal(result.personalState?.gate1Shell?.projectControlStorageReady, true)
  assert.equal(result.personalState?.gate1Shell?.projectControlProjectCount, 0)
  assert.equal(result.personalState?.gate1Shell?.sourceScanPresent, true)
  assert.equal(result.personalState?.gate1Shell?.projectImportPresent, true)
  assert.equal(result.personalState?.gate1Shell?.projectEntryPresent, true)
  assert.equal(result.personalState?.gate1Shell?.projectEntryInSidebar, true)
  assert.equal(result.personalState?.gate1Shell?.projectFooterStacked, true)
  assert.equal(result.personalState?.gate1Shell?.projectCollapsePresent, true)
  assert.equal(result.personalState?.gate1Shell?.projectCollapseInPanel, true)
  assert.equal(result.personalState?.gate1Shell?.floatingProjectControlAbsent, true)
  assert.equal(result.personalState?.gate1Shell?.initialProjectWidth >= 320, true)
  assert.equal(result.personalState?.gate1Shell?.initialConversationWidth >= 560, true)
  assert.equal(result.personalState?.gate1Shell?.initialWorkbenchWidth, 44)
  assert.equal(result.personalState?.gate1Shell?.initialNoHorizontalOverflow, true)
  assert.equal(result.personalState?.gate1Shell?.projectArrowPresent, true)
  assert.equal(result.personalState?.gate1Shell?.projectArrowInPanel, true)
  assert.equal(result.personalState?.gate1Shell?.projectArrowRailWidth, 40)
  assert.equal(result.personalState?.gate1Shell?.projectArrowCollapsed, true)
  assert.equal(result.personalState?.gate1Shell?.projectArrowRestored, true)
  assert.equal(result.personalState?.gate1Shell?.projectArrowRestoredWidth >= 320, true)
  assert.equal(result.personalState?.gate1Shell?.projectSidebarCollapsed, true)
  assert.equal(result.personalState?.gate1Shell?.projectSidebarRestored, true)
  assert.equal(result.personalState?.gate1Shell?.projectSidebarRestoredWidth >= 320, true)
  assert.equal(result.personalState?.gate1Shell?.workbenchPanelPresent, true)
  assert.equal(result.personalState?.gate1Shell?.workbenchPresent, true)
  assert.equal(result.personalState?.gate1Shell?.workbenchTabCount, 1)
  assert.equal(result.personalState?.gate1Shell?.workbenchExpandPresent, true)
  assert.equal(result.personalState?.gate1Shell?.workbenchExpanded, true)
  assert.equal(result.personalState?.gate1Shell?.workbenchExpandedWidth >= 360, true)
  assert.equal(result.personalState?.gate1Shell?.workbenchExpandedProjectWidth, 40)
  assert.equal(result.personalState?.gate1Shell?.workbenchExpandedConversationWidth >= 560, true)
  assert.equal(result.personalState?.gate1Shell?.workbenchNoHorizontalOverflow, true)
  assert.equal(result.personalState?.gate1Shell?.projectYieldedToWorkbench, true)
  assert.equal(result.personalState?.gate1Shell?.workbenchCollapsePresent, true)
  assert.equal(result.personalState?.gate1Shell?.workbenchCollapsed, true)
  assert.equal(result.personalState?.gate1Shell?.workbenchRailWidth, 44)
  assert.equal(result.personalState?.gate1Shell?.workbenchRestored, true)
  assert.equal(result.personalState?.gate1Shell?.workbenchDividerPresent, true)
  assert.equal(result.personalState?.gate1Shell?.detailsTabActivated, true)
  assert.equal(result.personalState?.gate1Shell?.layoutMenuPresent, true)
  assert.equal(result.personalState?.gate1Shell?.focusConversationWorked, true)
  assert.equal(result.personalState?.gate1Shell?.resetLayoutWorked, true)
  assert.equal(result.personalState?.gate1Shell?.sidebarToggled, true)
  assert.equal(result.personalState?.gate1Shell?.sidebarRestored, true)
  assert.equal(result.personalState?.gate1Shell?.gridTrackCount, 4)
  assert.equal(result.personalState?.gate1Shell?.themePresenterPresent, true)
  assert.equal(result.personalState?.gate2cIntake?.scanButtonPresent, true, JSON.stringify(result.personalState?.gate2cIntake))
  assert.equal(result.personalState?.gate2cIntake?.candidateRowPresent, true, JSON.stringify(result.personalState?.gate2cIntake))
  assert.equal(result.personalState?.gate2cIntake?.detailsViewerPresent, true, JSON.stringify(result.personalState?.gate2cIntake))
  assert.equal(result.personalState?.gate2cIntake?.confirmButtonPresent, true, JSON.stringify(result.personalState?.gate2cIntake))
  assert.equal(result.personalState?.gate2cIntake?.projectRegistered, true, JSON.stringify(result.personalState?.gate2cIntake))
  assert.equal(result.personalState?.gate2cIntake?.workbenchCollapsedBeforeClick, true, JSON.stringify(result.personalState?.gate2cIntake))
  assert.equal(result.personalState?.gate2cIntake?.workbenchExpandedAfterClick, true, JSON.stringify(result.personalState?.gate2cIntake))
  assert.equal(result.personalState?.gate2cIntake?.conflictCandidate?.rowPresent, true, JSON.stringify(result.personalState?.gate2cIntake))
  assert.equal(result.personalState?.gate2cIntake?.conflictCandidate?.detailsViewerPresent, true, JSON.stringify(result.personalState?.gate2cIntake))
  assert.equal(result.personalState?.gate2cIntake?.conflictCandidate?.confirmPresent, true, JSON.stringify(result.personalState?.gate2cIntake))
  assert.equal(result.personalState?.gate2cIntake?.conflictCandidate?.detailsMatched, true, JSON.stringify(result.personalState?.gate2cIntake))
  assert.equal(result.personalState?.gate2cIntake?.conflictCandidate?.selectsFound >= 2, true, JSON.stringify(result.personalState?.gate2cIntake))
  // 关键断言：冲突候选初始灰 + 自动处理按钮存在 + 徽章可见
  assert.equal(result.personalState?.gate2cIntake?.conflictCandidate?.confirmDisabled, true, JSON.stringify(result.personalState?.gate2cIntake))
  assert.equal(result.personalState?.gate2cIntake?.conflictCandidate?.autoResolvePresent, true, JSON.stringify(result.personalState?.gate2cIntake))
  assert.equal(result.personalState?.gate2cIntake?.conflictCandidate?.conflictBadgesBefore >= 2, true, JSON.stringify(result.personalState?.gate2cIntake))
  // 一键处理后：按钮变可用、每角色只留一份、冲突徽章消失
  assert.equal(result.personalState?.gate2cIntake?.conflictCandidate?.confirmDisabledAfterResolve, false, JSON.stringify(result.personalState?.gate2cIntake))
  assert.equal(result.personalState?.gate2cIntake?.conflictCandidate?.conflictBadgesAfter, 0, JSON.stringify(result.personalState?.gate2cIntake))
  const conflictRolesAfter = result.personalState?.gate2cIntake?.conflictCandidate?.roleValuesAfterResolve ?? []
  assert.equal(conflictRolesAfter.filter(role => role === 'prd').length, 1, JSON.stringify(result.personalState?.gate2cIntake))
  assert.equal(conflictRolesAfter.filter(role => role === 'ignore').length, 1, JSON.stringify(result.personalState?.gate2cIntake))
  // 文件树停靠：默认展开，可折叠成窄轨，可再展开
  assert.equal(result.personalState?.gate2cIntake?.filesDock?.dockOpenBefore, true, JSON.stringify(result.personalState?.gate2cIntake))
  assert.equal(result.personalState?.gate2cIntake?.filesDock?.dockAfterCollapse, false, JSON.stringify(result.personalState?.gate2cIntake))
  assert.equal(result.personalState?.gate2cIntake?.filesDock?.railAfterCollapse, true, JSON.stringify(result.personalState?.gate2cIntake))
  assert.equal(result.personalState?.gate2cIntake?.filesDock?.dockAfterReopen, true, JSON.stringify(result.personalState?.gate2cIntake))
  // 文件树只属于右侧 dock：无 Files 标签；展开=1 个树、收起=0 个树
  assert.equal(result.personalState?.gate2cIntake?.filesDock?.filesTabPresent, false, JSON.stringify(result.personalState?.gate2cIntake))
  assert.equal(result.personalState?.gate2cIntake?.filesDock?.treeViewerCountOpen, 1, JSON.stringify(result.personalState?.gate2cIntake))
  assert.equal(result.personalState?.gate2cIntake?.filesDock?.treeViewerCountCollapsed, 0, JSON.stringify(result.personalState?.gate2cIntake))
  // 全屏：按钮存在、进入后会话轨道 0px、再点退出
  assert.equal(result.personalState?.gate2cIntake?.fullscreenProbe?.togglePresent, true, JSON.stringify(result.personalState?.gate2cIntake))
  assert.equal(result.personalState?.gate2cIntake?.fullscreenProbe?.fullscreenOn, true, JSON.stringify(result.personalState?.gate2cIntake))
  assert.equal(result.personalState?.gate2cIntake?.fullscreenProbe?.conversationTrackZero, true, JSON.stringify(result.personalState?.gate2cIntake))
  assert.equal(result.personalState?.gate2cIntake?.fullscreenProbe?.fullscreenOffAfterToggle, true, JSON.stringify(result.personalState?.gate2cIntake))
  // 项目工作区绑定：Host 端点只服务已登记项目；文件树跟随控制台选中项目
  assert.equal(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.hostStatusOk, true, JSON.stringify(result.personalState?.gate2cIntake))
  assert.equal(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.hostRootContainsProject, true, JSON.stringify(result.personalState?.gate2cIntake))
  assert.equal(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.openConsoleButtonPresent, true, JSON.stringify(result.personalState?.gate2cIntake))
  assert.equal(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.dockRootContainsProject, true, JSON.stringify(result.personalState?.gate2cIntake))
  assert.equal(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.dockTreeShowsDocs, true, JSON.stringify(result.personalState?.gate2cIntake))
  assert.equal(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.dockTreeShowsWorkspaceOnly, true, JSON.stringify(result.personalState?.gate2cIntake))
  // 点击树中文件 → 审阅区打开预览并显示内容
  assert.equal(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.readmeRowPresent, true, JSON.stringify(result.personalState?.gate2cIntake))
  assert.equal(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.previewOpened, true, JSON.stringify(result.personalState?.gate2cIntake))
  assert.equal(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.previewShowsContent, true, JSON.stringify(result.personalState?.gate2cIntake))
  // 路径栏悬浮窗：点目录段 → 悬浮窗出现并列出条目
  assert.equal(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.pathBarPresent, true, JSON.stringify(result.personalState?.gate2cIntake))
  assert.equal(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.pathPopupOpened, true, JSON.stringify(result.personalState?.gate2cIntake))
  assert.equal(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.pathPopupShowsEntries, true, JSON.stringify(result.personalState?.gate2cIntake))
  // 文件树搜索框：输入 → 结果出现、路径底色条隐藏
  assert.equal(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.searchBoxPresent, true, JSON.stringify(result.personalState?.gate2cIntake))
  assert.equal(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.searchResultsShowReadme, true, JSON.stringify(result.personalState?.gate2cIntake))
  assert.equal(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.pathChipHiddenDuringSearch, true, JSON.stringify(result.personalState?.gate2cIntake))
  // md 预览/代码切换
  assert.equal(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.viewSwitchPresent, true, JSON.stringify(result.personalState?.gate2cIntake))
  assert.equal(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.codeViewShownAfterToggle, true, JSON.stringify(result.personalState?.gate2cIntake))
  assert.equal(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.editorPresent, true, 'R-ED: 点击编辑后 TipTap 富文本编辑器应挂载')
  assert.equal(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.userPrefsApplied, 'ok', 'R-ED: 用户偏好复现探针应执行: ' + JSON.stringify(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.userPrefsApplied))
  assert.equal(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.editCrash, '', 'R-ED: 编辑点击不得崩溃')
  assert.equal(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.preferenceApplied, true, 'R-ED: 阅读器偏好（字号 17.2px）必须生效: ' + JSON.stringify(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.preferenceDetail))
  assert.equal(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.updatePathApplied, true, 'R-ED: 设置卡片 update 路径必须生效: ' + JSON.stringify(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.updatePathDetail))
  assert.equal(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.editorReaderStyleApplied, true, 'R-ED: 富文本编辑器必须应用阅读字号/正文字体: ' + JSON.stringify(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.editorReaderStyleDetail))
  assert.equal(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.livePreviewHiddenMarkers, true, 'R-ED: 富文本编辑必须隐藏 md 标记（所见即所得）: ' + JSON.stringify(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.livePreviewDetail))
  assert.equal(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.toolbarShown, true, 'R-ED: 富文本工具栏必须存在: ' + JSON.stringify(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.toolbarDetail))
  assert.ok(String(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.toolbarDetail ?? '').includes('boldButton=true'), 'R-ED: 富文本工具栏必须包含「加粗」按钮: ' + JSON.stringify(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.toolbarDetail))
  assert.equal(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.sourceModeProbe, 'ok', 'R-ED Phase3: 源码模式切换必须可用: ' + JSON.stringify(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.sourceModeProbe))
  assert.equal(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.outlineProbe, 'ok', 'Workbench 四页签: Outline 必须可打开: ' + JSON.stringify(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.outlineProbe))
  assert.equal(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.diffProbe, 'ok', 'Workbench 四页签: Diff 必须可打开: ' + JSON.stringify(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.diffProbe))
  assert.equal(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.browserProbe, 'ok', 'Workbench 四页签: Browser 必须可打开: ' + JSON.stringify(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.browserProbe))
  assert.equal(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.codeProbe, 'ok', 'Workbench 四页签: Code 查看器必须可打开: ' + JSON.stringify(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.codeProbe))
  assert.equal(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.bubbleShown, true, 'R-ED: 选中文字后浮动工具栏必须出现: ' + JSON.stringify(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.bubbleDetail))
  assert.equal(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.footnoteProbe, 'ok', 'R-ED: 脚注按钮必须生成脚注节点: ' + JSON.stringify(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.footnoteProbe))
  assert.equal(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.mathProbe, 'ok', 'R-ED: 行内公式按钮必须生成公式节点: ' + JSON.stringify(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.mathProbe))
  assert.equal(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.footnoteHtmlProbe, 'ok', 'R-ED: 脚注节点 getHTML() 不得触发 renderSpec Content hole 崩溃: ' + JSON.stringify(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.footnoteHtmlProbe))
  assert.ok(String(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.saveAfterFootnoteProbe ?? '').startsWith('saved-preview-ok') || String(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.saveAfterFootnoteProbe ?? '').startsWith('preview-ok'), 'R-ED: 插入新脚注后保存并渲染预览不得崩溃: ' + JSON.stringify(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.saveAfterFootnoteProbe))
  assert.equal(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.multiFootnoteProbe, 'ok', 'R-ED: 多个脚注定义必须序列化为独立行，不能串成一行: ' + JSON.stringify(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.multiFootnoteProbe))
  {
    const detail = String(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.realFileProbe ?? '')
    assert.ok(detail.includes('heading=true'), 'R-ED: 真实文件 M9_DESIGN.md 编辑态必须渲染标题节点: ' + JSON.stringify(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.realFileProbe))
    assert.ok(detail.includes('blockquote=true'), 'R-ED: 真实文件 M9_DESIGN.md 编辑态必须渲染引用节点: ' + JSON.stringify(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.realFileProbe))
    assert.ok(detail.includes('list=true'), 'R-ED: 真实文件 M9_DESIGN.md 编辑态必须渲染列表节点: ' + JSON.stringify(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.realFileProbe))
    assert.ok(detail.includes('code=true'), 'R-ED: 真实文件 M9_DESIGN.md 编辑态必须渲染代码块节点: ' + JSON.stringify(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.realFileProbe))
    assert.ok(detail.includes('quoteHidden=true'), 'R-ED: 真实文件 M9_DESIGN.md 编辑态必须隐藏引用 > 标记: ' + JSON.stringify(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.realFileProbe))
    assert.ok(detail.includes('scrollable=true'), 'R-ED: 真实文件 M9_DESIGN.md 编辑态必须可滚动全文: ' + JSON.stringify(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.realFileProbe))
    assert.ok(detail.includes('footerInside=true'), 'R-ED: 文档版本/字节数页脚必须位于正文右下角: ' + JSON.stringify(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.realFileProbe))
    assert.ok(detail.includes('footerRightAligned=true'), 'R-ED: 编辑态页脚必须右对齐正文右缘: ' + JSON.stringify(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.realFileProbe))
    assert.ok(!detail.includes('# M9'), 'R-ED: 真实文件 M9_DESIGN.md 编辑态必须隐藏 # 标记: ' + JSON.stringify(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.realFileProbe))
  }
  assert.equal(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.saveProbe, 'saved', 'R-ED: 项目视图内保存必须成功，不能提示项目文件只读: ' + JSON.stringify(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.saveProbe))
  const previewFeature = String(result.personalState?.gate2cIntake?.projectWorkspaceBinding?.previewFeatureProbe ?? '')
  assert.ok(previewFeature.includes('task=true'), 'R-ED: 预览模式必须显示待办列表: ' + previewFeature)
  assert.ok(previewFeature.includes('footnotes=true'), 'R-ED: 预览模式必须显示脚注区: ' + previewFeature)
  assert.ok(previewFeature.includes('localLink=true'), 'R-ED: 预览模式必须显示本地目录链接: ' + previewFeature)
  assert.ok(previewFeature.includes('math=true'), 'R-ED: 预览模式必须显示行内公式: ' + previewFeature)
  assert.ok(previewFeature.includes('footnoteHeadingCount=1'), 'R-ED: 预览模式只能有一个脚注标题（重复 ## 脚注 必须收敛）: ' + previewFeature)
  // R-ED 本地文件/图片全链路：插入 → 序列化 → 落盘 → 预览 → 再编辑还原 → 点击打开 → 桌面桥 → 拖拽单份
  {
    const lfi = result.personalState?.gate2cIntake?.projectWorkspaceBinding?.localFileImageProbe ?? {}
    const lfiJson = JSON.stringify(lfi)
    assert.equal(typeof lfi, 'object', 'R-ED 本地文件/图片探针必须执行: ' + lfiJson)
    assert.equal(lfi.serLinkOk, true, 'R-ED: 附件节点必须序列化为带 <> 包裹的 Markdown 链接: ' + lfiJson)
    assert.equal(lfi.serImgOk, true, 'R-ED: 图片节点必须序列化为真实相对路径: ' + lfiJson)
    assert.equal(lfi.serMissingOk, true, 'R-ED: 相对路径附件必须原样序列化: ' + lfiJson)
    assert.equal(lfi.diskLinkOk, true, 'R-ED: 保存后磁盘文件必须包含附件链接: ' + lfiJson)
    assert.equal(lfi.diskImgOk, true, 'R-ED: 保存后磁盘文件必须包含本地图片: ' + lfiJson)
    assert.equal(lfi.previewImgData, true, 'R-ED: 预览必须把本地图片渲染为 data URL: ' + lfiJson)
    assert.equal(lfi.previewLinkOk, true, 'R-ED: 预览必须显示本地文件链接: ' + lfiJson)
    assert.equal(lfi.restoredAttachment, 2, 'R-ED: 再编辑必须还原 2 个附件卡片: ' + lfiJson)
    assert.equal(lfi.restoredImage, 1, 'R-ED: 再编辑必须还原 1 个图片节点: ' + lfiJson)
    assert.equal(lfi.attachmentHrefOk, true, 'R-ED: 还原的附件必须带原始路径: ' + lfiJson)
    assert.equal(lfi.imageHrefOk, true, 'R-ED: 还原的图片必须带原始路径: ' + lfiJson)
    assert.equal(lfi.editorImgData, true, 'R-ED: 再编辑后本地图片必须显示为 data URL: ' + lfiJson)
    assert.equal(lfi.editorImgFailed, false, 'R-ED: 再编辑后本地图片不得加载失败: ' + lfiJson)
    assert.equal(lfi.clickDefaultPrevented, true, 'R-ED: 点击附件卡片必须阻止默认导航: ' + lfiJson)
    assert.equal(lfi.stillEditing, true, 'R-ED: 点击附件卡片不得退出编辑状态: ' + lfiJson)
    assert.equal(lfi.urlSame, true, 'R-ED: 点击附件卡片不得改变页面 URL: ' + lfiJson)
    assert.equal(lfi.openErrorShown, true, 'R-ED: 打开失败必须出现内联失败反馈: ' + lfiJson)
    assert.equal(lfi.bridgeReadOk, true, 'R-ED: readFileAsDataURL 必须读到真实 PNG: ' + lfiJson)
    assert.equal(lfi.bridgeOpenMissingOk, true, 'R-ED: openPath 对缺失文件必须返回 ok:false: ' + lfiJson)
    assert.equal(lfi.bridgeRejectsRelative, true, 'R-ED: openPath 必须拒绝相对路径: ' + lfiJson)
    assert.equal(lfi.dropInserted, 'ok', 'R-ED: 拖入文件必须且只插入一份附件节点: ' + lfiJson)
  }
  // R-UX 新建页签与链接体验：「＋」浮层 / 快捷键 / .md 工作台内开页签 / 外链桥门禁 / Details 空态
  {
    const ux = result.personalState?.gate2cIntake?.projectWorkspaceBinding?.newTabUxProbe ?? {}
    const uxJson = JSON.stringify(ux)
    assert.equal(typeof ux, 'object', 'R-UX 新建页签/链接探针必须执行: ' + uxJson)
    assert.equal(ux.mdCardOpensTab, true, 'R-UX: 编辑器附件卡片点 .md 必须在工作台内开预览页签: ' + uxJson)
    assert.equal(ux.mdPreviewLinkOpensTab, true, 'R-UX: 预览里的 .md 本地链接必须在工作台内开页签: ' + uxJson)
    assert.equal(ux.detailsEmptyPresent, true, 'R-UX: Details 无选中工具调用时必须显示引导空态: ' + uxJson)
    assert.equal(ux.newTabButtonPresent, true, 'R-UX: 页签栏必须存在「＋」新建页签按钮: ' + uxJson)
    assert.equal(ux.menuActionsOk, true, 'R-UX: 「＋」菜单必须提供 审阅/终端/浏览器/文件 四项: ' + uxJson)
    assert.equal(ux.menuShortcutsOk, true, 'R-UX: 「＋」菜单每行必须显示快捷键徽章: ' + uxJson)
    assert.equal(ux.ctrlPOpensFiles, true, 'R-UX: Ctrl+P 必须唤出文件快速打开: ' + uxJson)
    assert.equal(ux.escapeClosesPalette, true, 'R-UX: Escape 必须关闭新建页签浮层: ' + uxJson)
    assert.equal(ux.paletteOpensBrowser, true, 'R-UX: 「＋」菜单必须能打开受限浏览器页签: ' + uxJson)
    assert.equal(ux.ctrlTActivatesBrowser, true, 'R-UX: Ctrl+T 必须激活浏览器页签: ' + uxJson)
    assert.equal(ux.paletteOpensTerminal, true, 'R-UX: 「＋」菜单必须能打开会话终端页签: ' + uxJson)
    assert.equal(ux.paletteDiffLandingPicker, true, 'R-UX: 「＋」菜单点审阅必须落地到文件选择器: ' + uxJson)
    assert.equal(ux.paletteFilesOpenReadme, true, 'R-UX: 「＋」文件快速打开必须能搜索并打开 README: ' + uxJson)
    assert.equal(ux.openExternalPresent, true, 'R-UX: 桌面桥必须暴露 openExternal: ' + uxJson)
    assert.equal(ux.openExternalRejectsFile, true, 'R-UX: openExternal 必须拒绝 file:  scheme: ' + uxJson)
    assert.equal(ux.openExternalRejectsJs, true, 'R-UX: openExternal 必须拒绝 javascript: scheme: ' + uxJson)
    assert.equal(ux.browserBareDomainNormalized, true, 'R-UX: 浏览器地址栏裸域名必须自动补 https://: ' + uxJson)
    assert.equal(ux.browserNoErrorShown, true, 'R-UX: 裸域名导航不得显示地址错误: ' + uxJson)
    assert.equal(ux.externalMdSaveOk, true, 'R-UX: 根外 .md 夹具必须落盘成功: ' + uxJson)
    assert.equal(ux.externalMdOpensTab, true, 'R-UX: 根外 .md 链接必须在工作台内开页签（ad-hoc 显式根）: ' + uxJson)
    assert.equal(ux.externalMdCarriesRoot, true, 'R-UX: 根外 .md 页签必须携带显式 workspaceRoot: ' + uxJson)
    assert.equal(ux.externalMdContentLoaded, true, 'R-UX: 根外 .md 预览必须按显式根读到内容: ' + uxJson)
    assert.equal(ux.browserGuestReached, true, 'R-UX: 浏览器访客视图必须真实导航到目标页: ' + uxJson)
    assert.equal(ux.browserGuestRenders, true, 'R-UX: 浏览器访客视图必须真实渲染出非白屏内容: ' + uxJson)
  }
  assert.equal(result.personalState?.gate2cIntake?.selectChangeSurvival?.selectFound, true, JSON.stringify(result.personalState?.gate2cIntake))
  assert.equal(result.personalState?.gate2cIntake?.selectChangeSurvival?.shellPresent, true, JSON.stringify(result.personalState?.gate2cIntake))
  assert.equal(result.personalState?.gate2cIntake?.selectChangeSurvival?.workbenchPanelPresent, true, JSON.stringify(result.personalState?.gate2cIntake))
  assert.equal(result.personalState?.gate2cIntake?.selectChangeSurvival?.detailsViewerStillPresent, true, JSON.stringify(result.personalState?.gate2cIntake))
  assert.equal(result.personalState?.gate2cIntake?.selectChangeSurvival?.boundaryFallbackAppeared, false, JSON.stringify(result.personalState?.gate2cIntake))
  // 记忆加密自检：主密钥 v2 文件 + 一次性恢复口令文件 + catalog 密文落盘
  const memoryLive = join(userData, 'memory-live')
  const memoryKeyFile = join(memoryLive, 'memory.key.json')
  assert.equal(existsSync(memoryKeyFile), true, 'memory.key.json missing')
  const memoryKey = JSON.parse(readFileSync(memoryKeyFile, 'utf8'))
  assert.equal(memoryKey.version, 2)
  assert.ok(typeof memoryKey.dpapi?.blob === 'string' && memoryKey.dpapi.blob.length > 0)
  assert.ok(typeof memoryKey.recovery?.ciphertext === 'string' && memoryKey.recovery.ciphertext.length > 0)
  assert.equal(existsSync(join(memoryLive, 'recovery-passphrase.txt')), true, 'recovery-passphrase.txt missing')
  const catalogPath = join(memoryLive, 'catalog.sqlite3')
  assert.equal(existsSync(catalogPath), true, 'catalog.sqlite3 missing')
  const catalogHead = readFileSync(catalogPath).subarray(0, 16)
  assert.notEqual(catalogHead.equals(Buffer.from('SQLite format 3\u0000', 'utf8')), true, 'catalog must be ciphertext, not plaintext')
  assert.equal(result.personalState?.api?.projectControl?.ok, true)
  assert.equal(result.personalState?.api?.projectControl?.storageState, 'ready')
  assert.equal(result.personalState?.api?.projectControl?.schemaVersion, 9)
  assert.equal(result.personalState?.api?.projectControl?.projectCount, 0)
  assert.equal(result.personalState?.api?.projectControl?.candidateStatus, 200)
  assert.equal(result.personalState?.api?.projectControl?.candidateCount, 0)
  assert.equal(result.personalState?.api?.projectControl?.templateStatus, 200)
  assert.equal(result.personalState?.api?.projectControl?.templateCount >= 3, true)
  assert.equal(result.personalState?.api?.projectControl?.intakeCapabilities, true)
  assert.equal(result.personalState?.api?.projectControl?.documentCapabilities, true)
  assert.equal(existsSync(join(projectControlHome, 'project-control.sqlite3')), true)
  assert.equal(existsSync(join(dshHome, 'project-control.sqlite3')), false)
  assertProjectControlWriterLockReleased(projectControlHome)
  assert.equal(result.passed, true)
  assert.equal(isProcessAlive(result.helperPid), false, `Harness helper PID ${result.helperPid} is still running.`)
  for (const metric of result.electronMetrics ?? []) {
    assert.equal(isProcessAlive(metric.pid), false, `Electron ${metric.type} PID ${metric.pid} is still running.`)
  }
  const url = new URL(result.url)
  assert.equal(await canConnect(url.hostname, Number(url.port)), false, `Harness port ${url.port} is still reachable.`)

  passed = true
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
} catch (error) {
  process.stderr.write(`${error.stack ?? error}\n`)
  if (output.trim() !== '') process.stderr.write(`\nElectron output:\n${output}\n`)
  process.stderr.write(`Smoke artifacts retained at: ${tempRoot}\n`)
  process.exitCode = 1
} finally {
  if (child !== undefined && child.exitCode === null && child.signalCode === null) {
    terminateTree(child.pid)
  }
  smokeExecutable?.cleanup()
  if (passed) removeOwnedTempDirectory(tempRoot)
}

process.stdout.write(`SMOKE_EXIT=${passed ? 0 : 1}\n`)


function assertProjectControlWriterLockReleased(projectControlDirectory) {
  const lockDatabase = new DatabaseSync(join(
    projectControlDirectory,
    'project-control.sqlite3.writer-lock.sqlite3',
  ))
  try {
    lockDatabase.exec('BEGIN EXCLUSIVE')
    lockDatabase.exec('ROLLBACK')
  } finally {
    lockDatabase.close()
  }
}

/** @param {import('node:child_process').ChildProcess} processChild @param {number} timeoutMs */
function waitForProcess(processChild, timeoutMs) {
  return new Promise((resolvePromise, rejectPromise) => {
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      terminateTree(processChild.pid)
    }, timeoutMs)
    processChild.once('error', rejectPromise)
    processChild.once('close', (code, signal) => {
      clearTimeout(timer)
      resolvePromise({ code, signal, timedOut })
    })
  })
}

/** @param {number | undefined} pid */
function terminateTree(pid) {
  if (pid === undefined) return
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/pid', String(pid), '/t', '/f'], {
      shell: false,
      windowsHide: true,
      stdio: 'ignore',
    })
    return
  }
  try {
    process.kill(pid, 'SIGKILL')
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error
  }
}

/** @param {number | undefined} pid */
function isProcessAlive(pid) {
  if (!Number.isInteger(pid)) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code !== 'ESRCH'
  }
}

/** @param {string} host @param {number} port */
async function canConnect(host, port) {
  const connected = await new Promise(resolvePromise => {
    const socket = createConnection({ host, port })
    let settled = false
    const finish = value => {
      if (settled) return
      settled = true
      socket.destroy()
      resolvePromise(value)
    }
    socket.setTimeout(500, () => finish(false))
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
  })
  if (connected) await delay(50)
  return connected
}

/** @param {string} path */
function removeOwnedTempDirectory(path) {
  const realTempRoot = realpathSync.native(tmpdir())
  const realTarget = realpathSync.native(path)
  if (!realTarget.startsWith(`${realTempRoot}${sep}`)) {
    throw new Error(`Refusing to remove non-temporary path: ${realTarget}`)
  }
  unlinkLinks(realTarget)
  rmSync(realTarget, { recursive: true, force: true })
}

/** @param {string} directory */
function unlinkLinks(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name)
    const stat = lstatSync(entryPath)
    if (stat.isSymbolicLink()) {
      unlinkSync(entryPath)
    } else if (stat.isDirectory()) {
      unlinkLinks(entryPath)
    }
  }
}

/** @param {NodeJS.ProcessEnv} inherited */
function withoutSecrets(inherited) {
  return Object.fromEntries(Object.entries(inherited).filter(([name]) => {
    return !/(?:^|_)(?:API_?KEY|SECRET|TOKEN|PASSWORD)(?:_|$)/iu.test(name)
      && !/^(?:DEEPSEEK|OPENAI|ANTHROPIC|GEMINI|GOOGLE|AZURE|AWS|E2B)_/iu.test(name)
  }))
}
