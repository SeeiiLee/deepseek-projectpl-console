import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const client = readFileSync(new URL('../src/client/index.ts', import.meta.url), 'utf8')
const frame = readFileSync(new URL('../src/client/AppFrame.tsx', import.meta.url), 'utf8')
const stores = readFileSync(new URL('../src/client/stores.ts', import.meta.url), 'utf8')
const layoutState = readFileSync(new URL('../src/client/layout-state.ts', import.meta.url), 'utf8')
const preferences = readFileSync(new URL('../src/client/preferences.ts', import.meta.url), 'utf8')
const sidebarAction = readFileSync(new URL('../src/client/ProjectSidebarAction.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../src/client/AppFrame.module.css', import.meta.url), 'utf8')

test('keeps official ui-layout out of the Personal Shell activation graph', () => {
  assert.deepEqual(manifest.dsh.client.inject, [
    '@deepseek-ai/dsh-client-runtime',
    '@deepseek-ai/dsh-client-ui-theme',
  ])
})

test('declares compatible slots plus stable project and Workbench seams', () => {
  for (const slot of ['sidebar', 'project.control', 'conversation', 'details', 'workbench.panel', 'shell.overlay']) {
    assert.match(client, new RegExp(`'${slot.replace('.', '\\.')}'\\s*:`))
  }
  assert.match(client, /legacyDetails:\s*ReactNode/)
  assert.match(client, /detailsCommand:\s*DetailsCommand/)
  assert.match(frame, /const legacyDetails = renderSlot\('details', \{\}\)/)
  assert.match(frame, /renderSlot\('workbench\.panel', \{[\s\S]*?legacyDetails,[\s\S]*?detailsCommand:/)
  assert.doesNotMatch(client, /ProjectPlaceholder/)
  assert.doesNotMatch(client, /register\(\{ name: 'project\.control' \}/)
})

test('provides official layout and the complete personalShell service', () => {
  assert.match(client, /reflect\.provide\('layout', layout\)/)
  assert.match(client, /reflect\.provide\('personalShell', layout\)/)
  for (const method of [
    'openProject', 'closeProject', 'toggleProject',
    'openWorkbench', 'closeWorkbench', 'toggleWorkbench',
    'focusConversation', 'resetLayout',
  ]) assert.match(client + readFileSync(new URL('../src/client/service.ts', import.meta.url), 'utf8'), new RegExp(`${method}\\(\\)`))
})

test('exposes Gate 1 panel markers, rails and no native-sidebar drag path', () => {
  assert.match(frame, /data-personal-shell="gate-1"/)
  assert.match(frame, /data-personal-sidebar-column/)
  assert.match(frame, /data-personal-project-panel/)
  assert.match(frame, /data-personal-workbench-panel/)
  assert.match(frame, /aria-label="收起项目控制台"/)
  assert.match(frame, /aria-label="展开项目控制台"/)
  // 工作台展开态头部由工作台插件负责（收起按钮/布局菜单在页签栏）；外壳保留收起态窄轨
  assert.match(frame, /aria-label="展开工作台"/)
  assert.match(sidebarAction, /data-personal-project-entry="sidebar"/)
  assert.match(client, /slots\.inject\('sidebar\.footer\.action'/)
  assert.match(frame, /side: 'project' \| 'workbench'/)
  assert.doesNotMatch(frame, /side: 'sidebar'/)
  assert.doesNotMatch(frame, /side: 'details'/)
})

test('makes both dividers mouse and keyboard operable', () => {
  assert.match(frame, /role="separator"/)
  assert.match(frame, /tabIndex=\{0\}/)
  assert.match(frame, /aria-valuemin=\{props\.min\}/)
  assert.match(frame, /aria-valuemax=\{props\.max\}/)
  assert.match(frame, /aria-valuenow=\{Math\.round\(props\.value\)\}/)
  assert.match(frame, /onDoubleClick=\{props\.onReset\}/)
  for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'Enter']) assert.match(frame, new RegExp(`event\\.key === '${key}'`))
})

test('focus and reset commands stay reachable through the panel action seam', () => {
  // 布局菜单已移入工作台插件页签栏；外壳仍通过布局 actions 提供专注会话/重置布局能力
  const shellService = readFileSync(new URL('../src/client/service.ts', import.meta.url), 'utf8')
  assert.match(shellService, /focusConversation\(\)/u)
  assert.match(shellService, /resetLayout\(\)/u)
  assert.match(shellService, /attachPanels/u)
  assert.match(css, /\.layoutMenuPopup\s*\{[\s\S]*?position:\s*absolute/)
})

test('uses cleansed versioned preferences without persisting derived concessions', () => {
  assert.match(preferences, /dsh\.personal-shell\.layout\.v1/)
  assert.match(preferences, /LAYOUT_PREFERENCES_VERSION = 1/)
  assert.match(preferences, /sanitizeLayoutPreferences/)
  assert.match(preferences, /project:\s*\{ open: state\.projectOpen, width: state\.projectWidth \}/)
  assert.match(preferences, /workbench:\s*\{ open: state\.workbenchOpen, width: state\.workbenchWidth \}/)
  assert.doesNotMatch(preferences, /preferredAuxiliary:\s*state\.preferredAuxiliary/)
  assert.match(layoutState, /openWorkbench\(draft:[\s\S]*?preferredAuxiliary = 'workbench'/)
  assert.match(layoutState, /openProject\(draft:[\s\S]*?preferredAuxiliary = 'project'/)
})

test('clears legacy Details selection on close and Session switch without collapsing Workbench', () => {
  assert.match(layoutState, /closeDetails\(draft:[\s\S]*?command\(draft, 'dismiss'\)[\s\S]*?workbenchOpen = false/)
  assert.match(layoutState, /clearDetails\(draft:[\s\S]*?command\(draft, 'dismiss'\)/)
  assert.match(layoutState, /detailsCommand = \{ kind, revision: nextRevision/)
  assert.match(frame, /lastSession\.current !== detailsSession[\s\S]*?actions\.clearDetails\(\)/)
})

test('previews pointer drags in memory and persists only at gesture end', () => {
  assert.match(frame, /actions\.previewProject\(projectBase\.current \+ dx\)/)
  assert.match(frame, /actions\.previewWorkbench\(workbenchBase\.current - dx\)/)
  assert.match(frame, /actions\.commitProject\(\)/)
  assert.match(frame, /actions\.commitWorkbench\(\)/)
  assert.match(stores, /previewProject:[\s\S]*?layoutMutations\.setProject\(draft, px\)[\s\S]*?commitProject:[^\n]*persist\(draft\)/)
  assert.match(stores, /previewWorkbench:[\s\S]*?layoutMutations\.setWorkbench\(draft, px\)[\s\S]*?commitWorkbench:[^\n]*persist\(draft\)/)
})

test('uses a CSS Module and keeps both auxiliary boundaries explicit', () => {
  assert.match(css, /\.projectCol\s*\{[\s\S]*?border-right:/)
  assert.match(css, /\.workbenchCol\s*\{[\s\S]*?border-left:/)
  assert.match(css, /data-slot='sidebar\.footer\.action'[\s\S]*?:has\(\.sidebarProjectAction\)/)
  assert.doesNotMatch(css, /(^|\n)\s*(html|body|button|input|textarea|select)(?:\s|,|\{)/)
})

test('ships the requested Host and Client build artifacts', async () => {
  for (const file of ['../lib/index.js', '../lib/client.js', '../lib/client.js.map']) {
    assert.equal(existsSync(new URL(file, import.meta.url)), true, `${file} is missing`)
  }
  const host = await import('../lib/index.js')
  assert.equal(host.apply(), undefined)
  const bundle = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.match(bundle, /@cyrus\/dsh-personal-shell/)
  assert.match(bundle, /data-personal-shell/)
})
