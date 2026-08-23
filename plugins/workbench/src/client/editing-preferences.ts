/**
 * R-ED：Workbench 编辑偏好（阅读器/编辑器/布局/面板字体）。
 * 存 Workbench 本地设置（localStorage，重启保留）；不影响项目/Tab 事实（架构书 §10.1：
 * Workbench 模式偏好 = 本地设置；用户选择保留为 UI 偏好）。
 * 值语义：字体字段 'system' 表示不设置（继承），其余为 CSS font-family 串（含自定义）。
 */
export interface EditingPreferences {
  readerBackground: 'theme' | 'paper' | 'dark' | 'custom'
  /** 自定义背景色（hex，如 #f5f1e8）。 */
  customBackground: string
  /** 自定义背景不透明度 0–100。 */
  customBackgroundOpacity: number
  /** 审阅文字颜色：theme=跟随主题 / auto=按背景明暗自适应 / dark / light / custom(hex)。 */
  readerTextColor: 'theme' | 'auto' | 'dark' | 'light' | 'custom'
  /** 自定义文字色（hex）。 */
  customTextColor: string
  /** 阅读字号 6.0–22.0，步进 0.1。 */
  readerFontSize: number
  /** 阅读宽度：720 | 900 | 1080 | 0（不限制）。 */
  readerWidth: number
  readerFontFamily: string
  codeFontFamily: string
  remoteMediaNotice: boolean
  lineWrapping: boolean
  showLineNumbers: boolean
  panelFontFamily: string
}

export const DEFAULT_EDITING_PREFERENCES: EditingPreferences = {
  readerBackground: 'theme',
  customBackground: '#e8e4da',
  customBackgroundOpacity: 100,
  readerTextColor: 'auto',
  customTextColor: '#2b2b2b',
  readerFontSize: 13.5,
  readerWidth: 900,
  readerFontFamily: 'system',
  codeFontFamily: 'system',
  remoteMediaNotice: true,
  lineWrapping: true,
  showLineNumbers: true,
  panelFontFamily: 'system',
}

export const STORAGE_KEY = '@cyrus/dsh-workbench:v1:editing-preferences'

/** 预置字体表：key → CSS font-family 串（'system' 表示继承默认）。 */
export const READER_FONT_FAMILIES: Readonly<Record<string, string>> = {
  system: '',
  serif: '"Noto Serif SC", "Source Han Serif SC", "SimSun", serif',
  times: '"Times New Roman", "Times", serif',
  kai: '"Kaiti SC", "KaiTi", "STKaiti", serif',
  round: '"Microsoft YaHei UI", "PingFang SC", sans-serif',
  pingfang: '"PingFang SC", "Microsoft YaHei UI", sans-serif',
  georgia: '"Georgia", "Noto Serif SC", serif',
}

export const CODE_FONT_FAMILIES: Readonly<Record<string, string>> = {
  system: 'ui-monospace, Consolas, monospace',
  cascadia: '"Cascadia Code", Consolas, monospace',
  fira: '"Fira Code", Consolas, monospace',
  jetbrains: '"JetBrains Mono", Consolas, monospace',
  consolas: '"Consolas", monospace',
  menlo: '"Menlo", "SF Mono", Consolas, monospace',
  courier: '"Courier New", Courier, monospace',
}

export const PANEL_FONT_FAMILIES: Readonly<Record<string, string>> = {
  system: '',
  yahei: '"Microsoft YaHei UI", "Microsoft YaHei", sans-serif',
  pingfang: '"PingFang SC", sans-serif',
}

export const READER_WIDTH_OPTIONS = [720, 900, 1080, 0] as const
export const MIN_FONT_SIZE = 6
export const MAX_FONT_SIZE = 22

/** 预置色板（莫兰迪低饱和：paper 米灰纸面 / dark 灰蓝护眼）。 */
export const READER_BACKGROUND_PRESETS: Readonly<Record<string, string>> = {
  paper: '#e8e4da',
  dark: '#33363c',
}

/** 字体 key/自定义串 → CSS font-family（'system' → 继承默认）。 */
export function resolveFontFamily(presets: Readonly<Record<string, string>>, value: string): string {
  if (value === 'system') return ''
  return presets[value] ?? value
}

/** 自定义背景：hex + 不透明度 → rgba。 */
export function customBackgroundRgba(hex: string, opacityPercent: number): string {
  const normalized = /^#[0-9a-f]{6}$/iu.test(hex) ? hex : '#f5f1e8'
  const r = Number.parseInt(normalized.slice(1, 3), 16)
  const g = Number.parseInt(normalized.slice(3, 5), 16)
  const b = Number.parseInt(normalized.slice(5, 7), 16)
  return 'rgba(' + String(r) + ', ' + String(g) + ', ' + String(b) + ', ' + String(Math.round(opacityPercent) / 100) + ')'
}

/** 文字色计算：theme → ''（继承主题）；auto → 按背景明暗自适应；dark/light/custom 显式。 */
export function readerTextColorCss(preferences: EditingPreferences, background: string): string {
  if (preferences.readerTextColor === 'theme') return ''
  if (preferences.readerTextColor === 'dark') return '#1f1f1f'
  if (preferences.readerTextColor === 'light') return '#e8e8e8'
  if (preferences.readerTextColor === 'custom') {
    return /^#[0-9a-f]{6}$/iu.test(preferences.customTextColor) ? preferences.customTextColor : '#1f1f1f'
  }
  // auto：按背景亮度（YIQ 近似）选深/浅文字；透明背景无法判断 → 跟随主题
  if (background === 'transparent') return ''
  const hex = /^#[0-9a-f]{6}$/iu.test(background) ? background : '#f0f0f0'
  const r = Number.parseInt(hex.slice(1, 3), 16)
  const g = Number.parseInt(hex.slice(3, 5), 16)
  const b = Number.parseInt(hex.slice(5, 7), 16)
  const brightness = (r * 299 + g * 587 + b * 114) / 1000
  return brightness < 128 ? '#e8e8e8' : '#1f1f1f'
}

/** 阅读背景计算：theme → 透明（继承面板）。 */
export function readerBackgroundCss(preferences: EditingPreferences): string {
  if (preferences.readerBackground === 'paper') return READER_BACKGROUND_PRESETS.paper ?? '#f5f1e8'
  if (preferences.readerBackground === 'dark') return READER_BACKGROUND_PRESETS.dark ?? '#16181d'
  if (preferences.readerBackground === 'custom') {
    return customBackgroundRgba(preferences.customBackground, preferences.customBackgroundOpacity)
  }
  return 'transparent'
}

function clampFontSize(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_EDITING_PREFERENCES.readerFontSize
  return Math.round(Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, value)) * 10) / 10
}

function clampOpacity(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_EDITING_PREFERENCES.customBackgroundOpacity
  return Math.round(Math.min(100, Math.max(0, value)))
}

/** 逐字段清洗外部输入（坏数据回退默认；字体未知 key 视为自定义串保留）。 */
export function sanitizePreferences(raw: unknown): EditingPreferences {
  const value = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {}
  const backgrounds = ['theme', 'paper', 'dark', 'custom'] as const
  const hex = typeof value.customBackground === 'string' && /^#[0-9a-f]{6}$/iu.test(value.customBackground)
    ? value.customBackground
    : DEFAULT_EDITING_PREFERENCES.customBackground
  const widths = READER_WIDTH_OPTIONS as readonly number[]
  const readerWidth = typeof value.readerWidth === 'number' && widths.includes(value.readerWidth)
    ? value.readerWidth
    : DEFAULT_EDITING_PREFERENCES.readerWidth
  const textColors = ['theme', 'auto', 'dark', 'light', 'custom'] as const
  const customTextHex = typeof value.customTextColor === 'string' && /^#[0-9a-f]{6}$/iu.test(value.customTextColor)
    ? value.customTextColor
    : DEFAULT_EDITING_PREFERENCES.customTextColor
  return {
    readerBackground: backgrounds.includes(value.readerBackground as never)
      ? value.readerBackground as EditingPreferences['readerBackground']
      : DEFAULT_EDITING_PREFERENCES.readerBackground,
    customBackground: hex,
    readerTextColor: textColors.includes(value.readerTextColor as never)
      ? value.readerTextColor as EditingPreferences['readerTextColor']
      : DEFAULT_EDITING_PREFERENCES.readerTextColor,
    customTextColor: customTextHex,
    customBackgroundOpacity: clampOpacity(typeof value.customBackgroundOpacity === 'number' ? value.customBackgroundOpacity : DEFAULT_EDITING_PREFERENCES.customBackgroundOpacity),
    readerFontSize: clampFontSize(typeof value.readerFontSize === 'number' ? value.readerFontSize : DEFAULT_EDITING_PREFERENCES.readerFontSize),
    readerWidth,
    readerFontFamily: typeof value.readerFontFamily === 'string' && value.readerFontFamily !== '' ? value.readerFontFamily : 'system',
    codeFontFamily: typeof value.codeFontFamily === 'string' && value.codeFontFamily !== '' ? value.codeFontFamily : 'system',
    remoteMediaNotice: typeof value.remoteMediaNotice === 'boolean' ? value.remoteMediaNotice : true,
    lineWrapping: typeof value.lineWrapping === 'boolean' ? value.lineWrapping : true,
    showLineNumbers: typeof value.showLineNumbers === 'boolean' ? value.showLineNumbers : true,
    panelFontFamily: typeof value.panelFontFamily === 'string' && value.panelFontFamily !== '' ? value.panelFontFamily : 'system',
  }
}

export interface PreferencesStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export function loadPreferences(storage: PreferencesStorage): EditingPreferences {
  const raw = storage.getItem(STORAGE_KEY)
  if (raw === null) return { ...DEFAULT_EDITING_PREFERENCES }
  try {
    return sanitizePreferences(JSON.parse(raw))
  } catch {
    return { ...DEFAULT_EDITING_PREFERENCES }
  }
}

export function savePreferences(storage: PreferencesStorage, preferences: EditingPreferences): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(preferences))
}

function browserStorage(): PreferencesStorage {
  return {
    getItem(key) {
      if (typeof localStorage === 'undefined') return null
      return localStorage.getItem(key)
    },
    setItem(key, value) {
      if (typeof localStorage === 'undefined') return
      localStorage.setItem(key, value)
    },
  }
}

let sharedStore: EditingPreferencesStore | undefined

/** 运行时单例（浏览器 localStorage 承载；设置卡片/阅读器/编辑器共享）。 */
export function getEditingPreferencesStore(): EditingPreferencesStore {
  if (sharedStore === undefined) sharedStore = new EditingPreferencesStore(browserStorage())
  // smoke 探针钩子：页面标记 __DSH_SMOKE__ 时暴露 store，供探针走「设置卡片同款 update 路径」。
  if (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).__DSH_SMOKE__ === true) {
    (window as unknown as Record<string, unknown>).__wbPreferencesStore = sharedStore
  }
  return sharedStore
}

/** 模块级偏好 store：跨组件即时生效（设置卡片写入 → 阅读器/编辑器订阅更新）。 */
export class EditingPreferencesStore {
  #preferences: EditingPreferences
  readonly #storage: PreferencesStorage
  readonly #listeners = new Set<() => void>()

  constructor(storage: PreferencesStorage) {
    this.#storage = storage
    this.#preferences = loadPreferences(storage)
    // 跨标签/外部写入同步：storage 事件（同源 localStorage 变更）。
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('storage', (event) => {
        if (event.key !== STORAGE_KEY) return
        this.#preferences = loadPreferences(storage)
        for (const listener of [...this.#listeners]) listener()
      })
    }
  }

  get = (): EditingPreferences => this.#preferences

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  update(mutate: (draft: EditingPreferences) => void): EditingPreferences {
    const next: EditingPreferences = { ...this.#preferences }
    mutate(next)
    this.#preferences = sanitizePreferences(next)
    savePreferences(this.#storage, this.#preferences)
    for (const listener of [...this.#listeners]) listener()
    return this.#preferences
  }

  reset(): EditingPreferences {
    this.#preferences = { ...DEFAULT_EDITING_PREFERENCES }
    savePreferences(this.#storage, this.#preferences)
    for (const listener of [...this.#listeners]) listener()
    return this.#preferences
  }
}
