import { useSyncExternalStore, type ReactNode } from 'react'
import {
  CODE_FONT_FAMILIES,
  DEFAULT_EDITING_PREFERENCES,
  getEditingPreferencesStore,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  PANEL_FONT_FAMILIES,
  READER_FONT_FAMILIES,
  READER_WIDTH_OPTIONS,
  type EditingPreferences,
} from './editing-preferences.ts'
import css from './EditingPreferencesSection.module.css'

/**
 * R-ED：Workbench 编辑偏好设置卡片（设置页 settings.section）。
 * 直接读写偏好 store（Workbench 本地设置），不经过 settingsScope（偏好属 UI 而非项目事实）。
 */
export function EditingPreferencesSection(): ReactNode {
  const store = getEditingPreferencesStore()
  const preferences = useSyncExternalStore(store.subscribe, store.get, store.get)
  const update = (mutate: (draft: EditingPreferences) => void): void => { store.update(mutate) }

  const fontOptions = (presets: Readonly<Record<string, string>>): { key: string; label: string }[] =>
    Object.keys(presets).map(key => ({ key, label: key === 'system' ? '系统默认' : key }))

  return (
    <section className={css.section} data-workbench-editing-section>
      <header className={css.header}>
        <div>
          <h2>Workbench 编辑</h2>
          <p>阅读器排版、编辑器与布局偏好。即时生效（编辑器/布局项下次进入编辑态生效）。</p>
        </div>
      </header>

      <div className={css.group}>
        <h3>阅读器（Markdown 预览）</h3>

        <label className={css.field}>
          <span>阅读背景</span>
          <div className={css.radioRow}>
            {(['theme', 'paper', 'dark', 'custom'] as const).map(mode => (
              <label key={mode} className={css.radioItem}>
                <input
                  type="radio"
                  name="reader-background"
                  checked={preferences.readerBackground === mode}
                  onChange={() => { update(draft => { draft.readerBackground = mode }) }}
                />
                {mode === 'theme' ? '跟随主题' : mode === 'paper' ? '浅色纸面' : mode === 'dark' ? '深色护眼' : '自定义'}
              </label>
            ))}
          </div>
        </label>

        {preferences.readerBackground === 'custom' && (
          <div className={css.subFields}>
            <label className={css.field}>
              <span>自定义颜色</span>
              <input
                type="color"
                data-custom-bg-color
                value={preferences.customBackground}
                onChange={event => { update(draft => { draft.customBackground = event.target.value }) }}
              />
              <input
                type="text"
                data-custom-bg-hex
                value={preferences.customBackground}
                onChange={event => {
                  const value = event.target.value
                  update(draft => { draft.customBackground = value })
                }}
              />
            </label>
            <label className={css.field}>
              <span>不透明度 {preferences.customBackgroundOpacity}%</span>
              <input
                type="range"
                min="0"
                max="100"
                data-custom-bg-opacity
                value={preferences.customBackgroundOpacity}
                onChange={event => { update(draft => { draft.customBackgroundOpacity = Number(event.target.value) }) }}
              />
            </label>
          </div>
        )}

        <label className={css.field}>
          <span>文字颜色</span>
          <select
            data-reader-text-color
            value={preferences.readerTextColor}
            onChange={event => { update(draft => { draft.readerTextColor = event.target.value as EditingPreferences['readerTextColor'] }) }}
          >
            <option value="auto">自适应（按背景明暗）</option>
            <option value="theme">跟随主题</option>
            <option value="dark">深色文字</option>
            <option value="light">浅色文字</option>
            <option value="custom">自定义…</option>
          </select>
          {preferences.readerTextColor === 'custom' && (
            <div className={css.subFields}>
              <input type="color" data-custom-text-color value={preferences.customTextColor} onChange={event => { update(draft => { draft.customTextColor = event.target.value }) }} />
              <input type="text" data-custom-text-hex value={preferences.customTextColor} onChange={event => { update(draft => { draft.customTextColor = event.target.value }) }} />
            </div>
          )}
          <small className={css.hint}>提示：深色主题背景下选择「深色文字」可能看不清，建议用「自适应」。</small>
        </label>

        <label className={css.field}>
          <span>阅读字号 {preferences.readerFontSize.toFixed(1)}px</span>
          <div className={css.sliderRow}>
            <input
              type="range"
              min={String(MIN_FONT_SIZE)}
              max={String(MAX_FONT_SIZE)}
              step="0.1"
              data-reader-font-size
              value={preferences.readerFontSize}
              onChange={event => { update(draft => { draft.readerFontSize = Number(event.target.value) }) }}
            />
            <button
              className={css.smallButton}
              type="button"
              data-reset-font-size
              title="重置字号为 13.5px"
              onClick={() => { update(draft => { draft.readerFontSize = DEFAULT_EDITING_PREFERENCES.readerFontSize }) }}
            >
              重置
            </button>
          </div>
        </label>

        <label className={css.field}>
          <span>阅读宽度</span>
          <select
            data-reader-width
            value={String(preferences.readerWidth)}
            onChange={event => { update(draft => { draft.readerWidth = Number(event.target.value) }) }}
          >
            {READER_WIDTH_OPTIONS.map(width => (
              <option key={String(width)} value={String(width)}>
                {width === 0 ? '不限制（全宽）' : width + 'px'}
              </option>
            ))}
          </select>
        </label>

        <label className={css.field}>
          <span>正文字体</span>
          <select
            data-reader-font-family
            value={preferences.readerFontFamily in READER_FONT_FAMILIES ? preferences.readerFontFamily : 'custom'}
            onChange={event => {
              const key = event.target.value
              update(draft => {
                draft.readerFontFamily = key === 'custom' ? draft.readerFontFamily : key
              })
            }}
          >
            {fontOptions(READER_FONT_FAMILIES).map(option => (
              <option key={option.key} value={option.key}>{option.label}</option>
            ))}
            <option value="custom">自定义…</option>
          </select>
          {!(preferences.readerFontFamily in READER_FONT_FAMILIES) && (
            <input
              type="text"
              data-reader-font-family-custom
              placeholder="CSS font-family，如 &quot;Noto Serif SC&quot;, serif"
              value={preferences.readerFontFamily}
              onChange={event => { update(draft => { draft.readerFontFamily = event.target.value }) }}
            />
          )}
        </label>

        <label className={css.field}>
          <span>代码字体</span>
          <select
            data-code-font-family
            value={preferences.codeFontFamily in CODE_FONT_FAMILIES ? preferences.codeFontFamily : 'custom'}
            onChange={event => {
              const key = event.target.value
              update(draft => { draft.codeFontFamily = key === 'custom' ? draft.codeFontFamily : key })
            }}
          >
            {fontOptions(CODE_FONT_FAMILIES).map(option => (
              <option key={option.key} value={option.key}>{option.label}</option>
            ))}
            <option value="custom">自定义…</option>
          </select>
          {!(preferences.codeFontFamily in CODE_FONT_FAMILIES) && (
            <input
              type="text"
              data-code-font-family-custom
              placeholder="如 &quot;Cascadia Code&quot;, Consolas, monospace"
              value={preferences.codeFontFamily}
              onChange={event => { update(draft => { draft.codeFontFamily = event.target.value }) }}
            />
          )}
        </label>

        <label className={css.field}>
          <span className={css.checkRow}>
            <input
              type="checkbox"
              data-remote-media-notice
              checked={preferences.remoteMediaNotice}
              onChange={event => { update(draft => { draft.remoteMediaNotice = event.target.checked }) }}
            />
            远程图片「可能联网加载」提示
          </span>
        </label>
      </div>

      <div className={css.group}>
        <h3>编辑器</h3>
        <label className={css.field}>
          <span className={css.checkRow}>
            <input
              type="checkbox"
              data-line-wrapping
              checked={preferences.lineWrapping}
              onChange={event => { update(draft => { draft.lineWrapping = event.target.checked }) }}
            />
            自动换行
          </span>
        </label>
        <label className={css.field}>
          <span className={css.checkRow}>
            <input
              type="checkbox"
              data-show-line-numbers
              checked={preferences.showLineNumbers}
              onChange={event => { update(draft => { draft.showLineNumbers = event.target.checked }) }}
            />
            显示行号
          </span>
        </label>
        
      </div>

      <div className={css.group}>
        <h3>面板字体（Workbench 界面）</h3>
        <label className={css.field}>
          <span>界面字体</span>
          <select
            data-panel-font-family
            value={preferences.panelFontFamily in PANEL_FONT_FAMILIES ? preferences.panelFontFamily : 'custom'}
            onChange={event => {
              const key = event.target.value
              update(draft => { draft.panelFontFamily = key === 'custom' ? draft.panelFontFamily : key })
            }}
          >
            {fontOptions(PANEL_FONT_FAMILIES).map(option => (
              <option key={option.key} value={option.key}>{option.label}</option>
            ))}
            <option value="custom">自定义…</option>
          </select>
          {!(preferences.panelFontFamily in PANEL_FONT_FAMILIES) && (
            <input
              type="text"
              data-panel-font-family-custom
              placeholder="如 &quot;Microsoft YaHei UI&quot;, sans-serif"
              value={preferences.panelFontFamily}
              onChange={event => { update(draft => { draft.panelFontFamily = event.target.value }) }}
            />
          )}
        </label>
      </div>

      <div className={css.actions}>
        <button
          className={css.smallButton}
          type="button"
          data-reset-all-preferences
          onClick={() => { store.reset() }}
        >
          恢复全部默认
        </button>
      </div>
    </section>
  )
}
