import { useId, useSyncExternalStore } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PersonalThemeController } from './controller.ts'
import type { PersonalThemeConfig, PersonalThemeField } from './theme-document.ts'
import { readableForeground } from './theme-runtime.ts'
import css from './PersonalThemeSection.module.css'

export interface PersonalThemeSectionInjected {
  controller: PersonalThemeController
}

export type PersonalThemeSectionProps =
  PropsRuntime<'settings.section'> & PersonalThemeSectionInjected

const COLOR_FIELDS: readonly {
  field: Extract<PersonalThemeField, `${string}Color`>
  label: string
  description: string
}[] = [
  { field: 'accentColor', label: '强调色', description: '按钮、选中态和重要提示' },
  { field: 'backgroundColor', label: '背景色', description: '主内容区域的底色' },
  { field: 'sidebarColor', label: '侧栏色', description: '会话与导航侧栏' },
  { field: 'textColor', label: '文字色', description: '正文及其弱化层级' },
]

export function PersonalThemeSection({ controller }: PersonalThemeSectionProps) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const config = controller.editingConfig(state)
  const workspaceEnabled = controller.hasWorkspaceOverride(state)
  const editingDisabled = state.scope === 'workspace' && !workspaceEnabled
  const fontListId = useId()

  return (
    <section className={css.section} aria-labelledby="personal-theme-title">
      <header className={css.heading}>
        <div>
          <h2 id="personal-theme-title">个人主题</h2>
          <p>为 Harness 设置统一外观，也可以让当前工作区拥有独立主题。</p>
        </div>
        <span className={css.liveBadge}>实时预览</span>
      </header>

      <div className={css.scopeTabs} role="tablist" aria-label="主题配置范围">
        <button
          type="button"
          role="tab"
          aria-selected={state.scope === 'global'}
          className={state.scope === 'global' ? css.activeTab : undefined}
          onClick={() => { controller.setScope('global') }}
        >
          全局配置
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={state.scope === 'workspace'}
          className={state.scope === 'workspace' ? css.activeTab : undefined}
          disabled={state.workspaceKey === ''}
          onClick={() => { controller.setScope('workspace') }}
        >
          当前工作区
        </button>
      </div>

      {state.scope === 'workspace' && (
        <div className={css.workspaceCard}>
          <div className={css.workspaceCopy}>
            <strong title={state.workspaceCwd}>{state.workspaceCwd ?? '当前 Session 没有工作目录'}</strong>
            <span>{workspaceEnabled ? '正在覆盖全局主题' : '当前继承全局主题'}</span>
          </div>
          <label className={css.switchLabel}>
            <input
              type="checkbox"
              checked={workspaceEnabled}
              disabled={state.workspaceKey === ''}
              onChange={(event) => {
                if (event.target.checked) controller.enableWorkspaceOverride()
                else controller.disableWorkspaceOverride()
              }}
            />
            使用独立主题
          </label>
        </div>
      )}

      <ThemePreview config={config} />

      <fieldset className={css.form} disabled={editingDisabled || state.status === 'loading'}>
        <legend className={css.hiddenLegend}>主题参数</legend>

        <label className={css.wideField}>
          <span className={css.fieldTitle}>字体族</span>
          <span className={css.fieldHint}>支持系统字体名或完整 CSS 字体列表</span>
          <input
            type="text"
            list={fontListId}
            value={config.fontFamily}
            onChange={(event) => { controller.updateField('fontFamily', event.target.value) }}
          />
          <datalist id={fontListId}>
            <option value={'Inter, "Segoe UI", "Microsoft YaHei UI", sans-serif'} />
            <option value="'Segoe UI', 'Microsoft YaHei', sans-serif" />
            <option value="'Microsoft YaHei UI', 'Microsoft YaHei', sans-serif" />
            <option value="'Inter', 'Segoe UI', sans-serif" />
            <option value="'JetBrains Mono', Consolas, monospace" />
          </datalist>
        </label>

        <RangeField
          label="基础字号"
          hint={`${formatNumber(config.baseFontSize)} px`}
          min={12}
          max={22}
          step={0.5}
          value={config.baseFontSize}
          onChange={(value) => { controller.updateField('baseFontSize', value) }}
        />
        <RangeField
          label="整体缩放"
          hint={`${Math.round(config.zoom * 100)}%`}
          min={0.75}
          max={1.5}
          step={0.05}
          value={config.zoom}
          onChange={(value) => { controller.updateField('zoom', value) }}
        />

        <div className={css.colorGrid}>
          {COLOR_FIELDS.map(item => (
            <label className={css.colorField} key={item.field}>
              <span className={css.colorSwatch} style={{ backgroundColor: config[item.field] }}>
                <input
                  type="color"
                  value={config[item.field]}
                  aria-label={item.label}
                  onChange={(event) => { controller.updateField(item.field, event.target.value) }}
                />
              </span>
              <span>
                <strong>{item.label}</strong>
                <small>{item.description}</small>
              </span>
              <code>{config[item.field]}</code>
            </label>
          ))}
        </div>

        <RangeField
          wide
          label="面板透明度"
          hint={`${Math.round(config.panelOpacity * 100)}%`}
          min={0.35}
          max={1}
          step={0.01}
          value={config.panelOpacity}
          onChange={(value) => { controller.updateField('panelOpacity', value) }}
        />
      </fieldset>

      {state.error !== undefined && <p className={css.error} role="alert">{state.error}</p>}
      <footer className={css.actions}>
        <span className={css.saveState} aria-live="polite">
          {state.status === 'loading'
            ? '正在读取…'
            : state.saving
              ? '正在保存…'
              : state.dirty
                ? '有未保存的修改'
                : state.savedAt !== undefined ? '已保存' : ''}
        </span>
        <button
          type="button"
          className={css.secondaryButton}
          disabled={state.saving || (state.scope === 'workspace' && !workspaceEnabled)}
          onClick={() => { controller.restoreDefaults() }}
        >
          {state.scope === 'workspace' ? '恢复继承全局' : '恢复默认'}
        </button>
        <button
          type="button"
          className={css.primaryButton}
          disabled={state.saving || !state.dirty}
          onClick={() => { void controller.save() }}
        >
          保存主题
        </button>
      </footer>
    </section>
  )
}

function ThemePreview({ config }: { config: PersonalThemeConfig }) {
  return (
    <div
      className={css.preview}
      style={{
        backgroundColor: config.backgroundColor,
        color: config.textColor,
        fontFamily: config.fontFamily,
        fontSize: `${Math.max(12, config.baseFontSize * 0.875)}px`,
      }}
    >
      <aside style={{ backgroundColor: config.sidebarColor }}>
        <span className={css.previewDot} style={{ backgroundColor: config.accentColor }} />
        <i />
        <i />
        <i />
      </aside>
      <div className={css.previewBody}>
        <strong>让复杂工作保持清晰</strong>
        <span style={{ opacity: 0.7 }}>主题会随当前工作区自动切换。</span>
        <span
          className={css.previewButton}
          style={{ backgroundColor: config.accentColor, color: readableForeground(config.accentColor) }}
        >
          预览按钮
        </span>
      </div>
    </div>
  )
}

function RangeField(props: {
  label: string
  hint: string
  min: number
  max: number
  step: number
  value: number
  wide?: boolean
  onChange: (value: number) => void
}) {
  return (
    <label className={props.wide ? css.wideField : css.rangeField}>
      <span className={css.rangeHeading}>
        <span className={css.fieldTitle}>{props.label}</span>
        <output>{props.hint}</output>
      </span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(event) => { props.onChange(Number(event.target.value)) }}
      />
    </label>
  )
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}
