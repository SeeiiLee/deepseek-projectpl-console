import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_EDITING_PREFERENCES,
  EditingPreferencesStore,
  loadPreferences,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  readerTextColorCss,
  sanitizePreferences,
  savePreferences,
  STORAGE_KEY,
} from '../src/client/editing-preferences.ts'

function memoryStorage(seed = {}) {
  const data = new Map(Object.entries(seed))
  return {
    getItem(key) { return data.get(key) ?? null },
    setItem(key, value) { data.set(key, value) },
    data,
  }
}

test('默认值：900px 宽度、13.5px 字号、跟随主题、自动布局', () => {
  assert.equal(DEFAULT_EDITING_PREFERENCES.readerWidth, 900)
  assert.equal(DEFAULT_EDITING_PREFERENCES.readerFontSize, 13.5)
  assert.equal(DEFAULT_EDITING_PREFERENCES.readerBackground, 'theme')

  assert.equal(DEFAULT_EDITING_PREFERENCES.remoteMediaNotice, true)
})

test('sanitize：坏数据回退默认、字号夹取到 6–22 且 0.1 步进、宽度只认档位', () => {
  const clean = sanitizePreferences({ readerFontSize: 99, customBackgroundOpacity: 500, readerWidth: 800, readerBackground: 'x' })
  assert.equal(clean.readerFontSize, MAX_FONT_SIZE)
  assert.equal(clean.customBackgroundOpacity, 100)
  assert.equal(clean.readerWidth, DEFAULT_EDITING_PREFERENCES.readerWidth)
  assert.equal(clean.readerBackground, 'theme')
  const small = sanitizePreferences({ readerFontSize: 1 })
  assert.equal(small.readerFontSize, MIN_FONT_SIZE)
  const step = sanitizePreferences({ readerFontSize: 13.26 })
  assert.equal(step.readerFontSize, 13.3)
  assert.deepEqual(sanitizePreferences(null), DEFAULT_EDITING_PREFERENCES)
})

test('sanitize：宽度档位白名单（720/900/1080/0），0 表示不限制', () => {
  for (const width of [720, 900, 1080, 0]) {
    assert.equal(sanitizePreferences({ readerWidth: width }).readerWidth, width)
  }
  assert.equal(sanitizePreferences({ readerWidth: 1000 }).readerWidth, 900)
})

test('hex 背景色严格校验；非法回退默认', () => {
  assert.equal(sanitizePreferences({ customBackground: '#f5f1e8' }).customBackground, '#f5f1e8')
  assert.equal(sanitizePreferences({ customBackground: '#12345' }).customBackground, DEFAULT_EDITING_PREFERENCES.customBackground)
  assert.equal(sanitizePreferences({ customBackground: 'red' }).customBackground, DEFAULT_EDITING_PREFERENCES.customBackground)
})

test('load/save 持久化与恢复', () => {
  const storage = memoryStorage()
  const prefs = { ...DEFAULT_EDITING_PREFERENCES, readerFontSize: 16, readerWidth: 1080 }
  savePreferences(storage, prefs)
  assert.equal(storage.data.get(STORAGE_KEY)?.includes('16'), true)
  const loaded = loadPreferences(storage)
  assert.equal(loaded.readerFontSize, 16)
  assert.equal(loaded.readerWidth, 1080)
  // 坏 JSON 回退默认
  const bad = memoryStorage({ [STORAGE_KEY]: '{oops' })
  assert.deepEqual(loadPreferences(bad), DEFAULT_EDITING_PREFERENCES)
})

test('store：订阅通知、update 持久化、reset 恢复默认', () => {
  const storage = memoryStorage()
  const store = new EditingPreferencesStore(storage)
  let notified = 0
  store.subscribe(() => { notified += 1 })
  store.update(draft => { draft.readerFontSize = 18 })
  assert.equal(notified, 1)
  assert.equal(store.get().readerFontSize, 18)
  assert.equal(JSON.parse(storage.data.get(STORAGE_KEY) ?? '{}').readerFontSize, 18)
  store.reset()
  assert.deepEqual(store.get(), DEFAULT_EDITING_PREFERENCES)
  assert.equal(notified, 2)
})

test('文字色：auto 按背景明暗选择深/浅；theme 返回空串（跟随主题）', () => {
  const light = readerTextColorCss({ ...DEFAULT_EDITING_PREFERENCES, readerBackground: 'paper', readerTextColor: 'auto' }, '#e8e4da')
  assert.equal(light, '#1f1f1f')
  const dark = readerTextColorCss({ ...DEFAULT_EDITING_PREFERENCES, readerBackground: 'dark', readerTextColor: 'auto' }, '#33363c')
  assert.equal(dark, '#e8e8e8')
  assert.equal(readerTextColorCss({ ...DEFAULT_EDITING_PREFERENCES, readerTextColor: 'theme' }, 'transparent'), '')
  assert.equal(readerTextColorCss({ ...DEFAULT_EDITING_PREFERENCES, readerTextColor: 'dark' }, '#fff'), '#1f1f1f')
})

test('sanitize：文字颜色白名单 + 莫兰迪默认色板', () => {
  assert.equal(sanitizePreferences({ readerTextColor: 'light' }).readerTextColor, 'light')
  assert.equal(sanitizePreferences({ readerTextColor: 'x' }).readerTextColor, 'auto')
  assert.equal(sanitizePreferences({ customTextColor: '#2b2b2b' }).customTextColor, '#2b2b2b')
  assert.equal(DEFAULT_EDITING_PREFERENCES.customBackground, '#e8e4da')
})

test('字体预置表含 system 默认（空串继承）', () => {
  const families = [DEFAULT_EDITING_PREFERENCES.readerFontFamily, DEFAULT_EDITING_PREFERENCES.codeFontFamily, DEFAULT_EDITING_PREFERENCES.panelFontFamily]
  assert.deepEqual(families, ['system', 'system', 'system'])
})
