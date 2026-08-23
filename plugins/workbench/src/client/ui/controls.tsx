import type { ReactNode } from 'react'
import styles from './controls.module.css'

/**
 * 工作台公共控件（插件内部组件库 v1）：
 * 从富文本编辑器工具栏、悬浮菜单、浏览器地址栏三轮实战中沉淀的统一口径——
 * 24 视窗 stroke 线条图标、24/26px 图标按钮、卡片式弹出菜单。
 * 新 UI 一律从这里取件，不要再各写一套：视觉一致性靠单一出处保证。
 *
 * 治理位置：plugins/workbench/src/client/ui/（插件内部公共层，
 * 仅供本插件 client 侧复用；跨插件公共组件需另走平台层评审）。
 */

/** 24 视窗 stroke 线条图标（lucide 风格），尺寸由所在按钮的 CSS 控制。 */
export function UiIcon({ d }: { d: string }): ReactNode {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>
}

interface IconButtonProps {
  /** UiIcon 的 path d。 */
  readonly icon: string
  /** 同时用于 title 与 aria-label。 */
  readonly label: string
  readonly onClick: () => void
  readonly disabled?: boolean
  /** tool = 24×24 工具栏口径（默认）；bar = 26×26 地址栏口径。 */
  readonly size?: 'tool' | 'bar'
  /** data-* 挂钩（冒烟/测试选择器），原样展开到 button 上。 */
  readonly data?: Record<string, string>
}

/** 纯图标按钮：工具栏/地址栏/悬浮条统一件。 */
export function IconButton({ icon, label, onClick, disabled, size, data }: IconButtonProps): ReactNode {
  return (
    <button
      type="button"
      className={size === 'bar' ? styles.barButton : styles.toolButton}
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      {...data}
    >
      <UiIcon d={icon} />
    </button>
  )
}

/** 竖线分隔符：工具栏分组 / 悬浮条分区共用。 */
export function MenuDivider(): ReactNode {
  return <span className={styles.divider} />
}

interface PopupMenuProps {
  readonly children: ReactNode
  readonly data?: Record<string, string>
}

/**
 * 卡片式弹出菜单容器（深色卡片 + 圆角 + 阴影）。
 * 调用方负责提供 position:relative 的包裹元素与开/关状态；
 * 菜单项一律左对齐（早期版本曾因 CSS 层叠事故被压成居中，这里用高优先级钉死）。
 */
export function PopupMenu({ children, data }: PopupMenuProps): ReactNode {
  return (
    <div className={styles.popupMenu} {...data}>
      {children}
    </div>
  )
}

interface PopupMenuItemProps {
  readonly label: string
  /** 未选中时前导槽位的字符图标（如 ¶ / H1）；选中时显示 ✓。 */
  readonly icon?: string
  readonly checked?: boolean
  readonly onSelect: () => void
  readonly data?: Record<string, string>
}

/** 弹出菜单项：前导标记槽 + 左对齐标签；onMouseDown 阻止默认行为保住编辑器焦点。 */
export function PopupMenuItem({ label, icon, checked, onSelect, data }: PopupMenuItemProps): ReactNode {
  return (
    <button
      type="button"
      onMouseDown={event => { event.preventDefault() }}
      onClick={onSelect}
      {...data}
    >
      <span className={styles.itemMark}>{checked === true ? '✓' : icon ?? ''}</span>
      <span className={checked === true ? styles.itemLabelActive : undefined}>{label}</span>
    </button>
  )
}
