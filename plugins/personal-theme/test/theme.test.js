import assert from 'node:assert/strict'
import test from 'node:test'
import { PersonalThemeController } from '../src/client/controller.ts'
import { createThemePersistence, PERSONAL_THEME_ENDPOINT } from '../src/client/api-adapter.ts'
import {
  DEFAULT_THEME_CONFIG,
  effectiveThemeConfig,
  normalizeThemeDocument,
  normalizeWorkspaceKey,
} from '../src/client/theme-document.ts'
import {
  buildThemeTokenOverrides,
  readableForeground,
  RootTypographyController,
  withAlpha,
} from '../src/client/theme-runtime.ts'

test('normalizes unsafe persisted values and Windows workspace identity', () => {
  const document = normalizeThemeDocument({
    global: {
      fontFamily: '',
      baseFontSize: 99,
      zoom: 0,
      accentColor: 'red',
      backgroundColor: '#ABCDEF',
      sidebarColor: '#123456',
      textColor: '#ffffff',
      panelOpacity: -1,
    },
    workspaces: {
      'D:/Work/Project/': { accentColor: '#00ff88' },
    },
  })
  assert.equal(document.global.fontFamily, DEFAULT_THEME_CONFIG.fontFamily)
  assert.equal(document.global.baseFontSize, 22)
  assert.equal(document.global.zoom, 0.75)
  assert.equal(document.global.accentColor, DEFAULT_THEME_CONFIG.accentColor)
  assert.equal(document.global.backgroundColor, '#abcdef')
  assert.equal(document.global.panelOpacity, 0.35)
  assert.equal(normalizeWorkspaceKey('D:/WORK/Project/'), 'd:\\work\\project')
  assert.equal(effectiveThemeConfig(document, 'd:\\work\\project').accentColor, '#00ff88')
})

test('controller previews edits, inherits global, and persists one workspace override', async () => {
  let persisted = normalizeThemeDocument(undefined)
  const persistence = {
    async read() { return persisted },
    async write(document) {
      persisted = structuredClone(document)
      return persisted
    },
  }
  const controller = new PersonalThemeController(persistence)
  await controller.load()
  controller.setWorkspace('D:/Work/Theme')
  controller.setScope('workspace')
  assert.equal(controller.hasWorkspaceOverride(), false)
  assert.equal(controller.effectiveConfig().accentColor, persisted.global.accentColor)

  controller.enableWorkspaceOverride()
  controller.updateField('accentColor', '#ff3366')
  assert.equal(controller.effectiveConfig().accentColor, '#ff3366')
  assert.equal(controller.getSnapshot().dirty, true)
  await controller.save()
  assert.equal(controller.getSnapshot().dirty, false)
  assert.equal(persisted.workspaces['d:\\work\\theme']?.accentColor, '#ff3366')

  controller.restoreDefaults()
  assert.equal(controller.hasWorkspaceOverride(), false)
  assert.equal(controller.effectiveConfig().accentColor, persisted.global.accentColor)
})

test('personalApi adapter uses the dedicated theme GET and PUT endpoint', async () => {
  const calls = []
  const api = {
    async request(path, options) {
      calls.push([options.method, path, options.body])
      if (options.method === 'GET') {
        return { global: { accentColor: '#123456' }, workspaces: {} }
      }
      return { document: options.body }
    },
  }
  const persistence = createThemePersistence(api)
  const loaded = await persistence.read()
  assert.equal(loaded.global.accentColor, '#123456')
  const written = await persistence.write(loaded)
  assert.equal(written.global.accentColor, '#123456')
  assert.deepEqual(calls.map(call => call.slice(0, 2)), [
    ['GET', PERSONAL_THEME_ENDPOINT],
    ['PUT', PERSONAL_THEME_ENDPOINT],
  ])
})

test('token projection applies opacity and supplies both palette modes', () => {
  const config = { ...DEFAULT_THEME_CONFIG, panelOpacity: 0.5 }
  const tokens = buildThemeTokenOverrides(config)
  assert.equal(withAlpha('#112233', 0.5), 'rgba(17, 34, 51, 0.5)')
  assert.equal(readableForeground('#f6d365'), '#111318')
  assert.equal(readableForeground('#2341a8'), '#ffffff')
  assert.deepEqual(tokens['--dsw-alias-bg-layer-1'], {
    light: 'rgba(247, 248, 250, 0.5)',
    dark: 'rgba(247, 248, 250, 0.5)',
  })
  for (const modes of Object.values(tokens)) {
    assert.equal(typeof modes.light, 'string')
    assert.equal(typeof modes.dark, 'string')
  }
})

test('typography teardown restores prior values without overwriting a later owner', () => {
  const style = new FakeStyle({ 'font-size': '15px', zoom: '0.9' })
  const root = { style }
  const controller = new RootTypographyController(root)
  controller.apply({ ...DEFAULT_THEME_CONFIG, baseFontSize: 18, zoom: 1.2 })
  assert.equal(style.getPropertyValue('font-size'), '18px')
  assert.equal(style.getPropertyValue('zoom'), '1.2')
  style.setProperty('font-family', 'Later Owner')
  controller.dispose()
  assert.equal(style.getPropertyValue('font-size'), '15px')
  assert.equal(style.getPropertyValue('zoom'), '0.9')
  assert.equal(style.getPropertyValue('font-family'), 'Later Owner')
})

class FakeStyle {
  #values = new Map()
  constructor(initial) {
    for (const [name, value] of Object.entries(initial)) this.setProperty(name, value)
  }
  getPropertyValue(name) { return this.#values.get(name)?.value ?? '' }
  getPropertyPriority(name) { return this.#values.get(name)?.priority ?? '' }
  setProperty(name, value, priority = '') { this.#values.set(name, { value, priority }) }
  removeProperty(name) { this.#values.delete(name) }
}
