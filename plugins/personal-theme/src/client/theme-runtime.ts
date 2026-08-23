import type { ThemeTokenOverrides } from '@deepseek-ai/dsh-client-ui-theme/client'
import type { PersonalThemeConfig } from './theme-document.ts'

const TOKEN_SOURCE = '@cyrus/dsh-personal-theme'

/** ThemeRuntime override layer for the user's current effective configuration. */
export function buildThemeTokenOverrides(config: PersonalThemeConfig): ThemeTokenOverrides {
  const same = (value: string) => ({ light: value, dark: value })
  const panel = withAlpha(config.backgroundColor, config.panelOpacity)
  const nestedPanel = withAlpha(config.backgroundColor, Math.min(1, config.panelOpacity + 0.035))
  const sidebar = withAlpha(config.sidebarColor, config.panelOpacity)
  const borderSubtle = withAlpha(config.textColor, 0.07)
  const borderStrong = withAlpha(config.textColor, 0.14)
  const interactiveHover = withAlpha(config.textColor, 0.08)
  const interactiveActive = withAlpha(config.textColor, 0.14)
  const accentForeground = readableForeground(config.accentColor)
  const accentHover = mixHex(
    config.accentColor,
    accentForeground === '#ffffff' ? '#ffffff' : '#000000',
    0.12,
  )
  return {
    '--dsw-font-family': same(config.fontFamily),
    '--dsw-alias-brand-primary': same(config.accentColor),
    '--dsw-alias-brand-primary-new-colorprimary-new-color': same(config.accentColor),
    '--dsw-alias-brand-text': same(config.accentColor),
    '--dsw-alias-brand-primary-invert': same(accentForeground),
    '--dsw-alias-button-info-fill': same(config.accentColor),
    '--dsw-alias-button-info-hover': same(accentHover),
    '--dsw-alias-button-primary-fill': same(config.accentColor),
    '--dsw-alias-button-primary-hover': same(accentHover),
    '--dsw-alias-button-primary-dimmed': same(withAlpha(config.accentColor, 0.35)),
    '--dsw-alias-button-elevated-fill': same(nestedPanel),
    '--dsw-alias-button-floating-fill': same(nestedPanel),
    '--dsw-alias-button-floating-hover': same(interactiveHover),
    '--dsw-alias-button-ghost-active-border': same(borderStrong),
    '--dsw-alias-button-ghost-active-fill': same(interactiveActive),
    '--dsw-alias-button-ghost-active-hover': same(withAlpha(config.textColor, 0.18)),
    '--dsw-alias-label-primary-foreground': same(accentForeground),
    '--dsw-alias-bg-base': same(config.backgroundColor),
    '--dsw-alias-bg-layer-1': same(panel),
    '--dsw-alias-bg-layer-2': same(nestedPanel),
    '--dsw-alias-bg-layer-3': same(nestedPanel),
    '--dsw-alias-bg-overlay': same(nestedPanel),
    '--dsw-alias-bg-module-platform': same(nestedPanel),
    '--dsw-alias-bg-multi-select': same(nestedPanel),
    '--dsw-alias-bg-skeleton': same(withAlpha(config.textColor, 0.08)),
    '--dsw-alias-border-l1': same(borderSubtle),
    '--dsw-alias-border-l2-darkmode-thin': same(borderSubtle),
    '--dsw-alias-border-l2': same(borderStrong),
    '--dsw-alias-border-l3': same(withAlpha(config.textColor, 0.18)),
    '--dsw-alias-border-l4': same(withAlpha(config.textColor, 0.24)),
    '--dsw-alias-interactive-bg-active': same(interactiveActive),
    '--dsw-alias-interactive-bg-hover-accent': same(withAlpha(config.accentColor, 0.2)),
    '--dsw-alias-interactive-bg-hover-solid': same(interactiveHover),
    '--dsw-alias-interactive-bg-hover': same(interactiveHover),
    '--dsw-specific-sidebar-fill': same(sidebar),
    '--dsw-specific-sidebar-nav-item-active-accent': same(withAlpha(config.accentColor, 0.22)),
    '--dsw-specific-sidebar-nav-item-active': same(interactiveActive),
    '--dsw-specific-sidebar-nav-item-hover': same(interactiveHover),
    '--dsw-alias-label-primary': same(config.textColor),
    '--dsw-alias-label-primary-dimmed': same(withAlpha(config.textColor, 0.88)),
    '--dsw-alias-label-primary-inverted': same(accentForeground),
    '--dsw-alias-label-secondary': same(withAlpha(config.textColor, 0.72)),
    '--dsw-alias-label-tertiary': same(withAlpha(config.textColor, 0.56)),
    '--dsw-alias-label-caption': same(withAlpha(config.textColor, 0.42)),
    '--dsw-alias-label-dimmed': same(withAlpha(config.textColor, 0.25)),
    '--dsw-alias-markdown-citation': same(interactiveActive),
    '--dsw-alias-markdown-code-block-banner': same(nestedPanel),
    '--dsw-alias-markdown-code-block': same(panel),
    '--dsw-alias-markdown-code-segment-selected': same(interactiveActive),
    '--dsw-alias-markdown-code-segment-unselected': same(interactiveHover),
    '--dsw-alias-markdown-inline-code': same(interactiveActive),
    '--dsw-alias-markdown-placeholder': same(panel),
    '--dsw-alias-markdown-tag': same(interactiveHover),
    '--dsw-alias-scrollbar-bg-l1': same(withAlpha(config.textColor, 0.16)),
    '--dsw-alias-scrollbar-bg-l2': same(withAlpha(config.textColor, 0.16)),
    '--dsw-alias-scrollbar-hover-l1': same(withAlpha(config.textColor, 0.28)),
    '--dsw-alias-scrollbar-hover-l2': same(withAlpha(config.textColor, 0.28)),
    '--dsw-specific-bubble-highlight': same(withAlpha(config.accentColor, 0.24)),
    '--dsw-specific-bubble': same(withAlpha(config.accentColor, 0.12)),
    '--dsw-specific-input-major': same(panel),
    '--dsw-specific-login-input': same(nestedPanel),
    '--dsw-specific-menu': same(nestedPanel),
    '--dsw-specific-selector': same(nestedPanel),
    '--dsw-specific-tip': same(nestedPanel),
  }
}

export function themeTokenSource(): string {
  return TOKEN_SOURCE
}

/** Convert the editor's strict #rrggbb colors to an rgba token. */
export function withAlpha(hex: string, alpha: number): string {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu.exec(hex)
  if (match === null) return hex
  const red = Number.parseInt(match[1] ?? '0', 16)
  const green = Number.parseInt(match[2] ?? '0', 16)
  const blue = Number.parseInt(match[3] ?? '0', 16)
  const normalizedAlpha = Math.round(Math.min(1, Math.max(0, alpha)) * 1000) / 1000
  return `rgba(${red}, ${green}, ${blue}, ${normalizedAlpha})`
}

/** WCAG-style luminance choice for labels placed on the accent color. */
export function readableForeground(hex: string): '#111318' | '#ffffff' {
  const rgb = parseHex(hex)
  if (rgb === undefined) return '#ffffff'
  const channels = rgb.map((channel) => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  const luminance = 0.2126 * (channels[0] ?? 0)
    + 0.7152 * (channels[1] ?? 0)
    + 0.0722 * (channels[2] ?? 0)
  return luminance > 0.2 ? '#111318' : '#ffffff'
}

function mixHex(left: string, right: string, ratio: number): string {
  const a = parseHex(left)
  const b = parseHex(right)
  if (a === undefined || b === undefined) return left
  const weight = Math.min(1, Math.max(0, ratio))
  const channels = a.map((value, index) => Math.round(value * (1 - weight) + (b[index] ?? 0) * weight))
  return `#${channels.map(value => value.toString(16).padStart(2, '0')).join('')}`
}

function parseHex(hex: string): [number, number, number] | undefined {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu.exec(hex)
  if (match === null) return undefined
  return [
    Number.parseInt(match[1] ?? '0', 16),
    Number.parseInt(match[2] ?? '0', 16),
    Number.parseInt(match[3] ?? '0', 16),
  ]
}

/**
 * Own the three documentElement declarations that are not Harness theme
 * tokens. Disposal restores the exact pre-plugin inline values, but only
 * while the current value is still ours (a later owner is never clobbered).
 */
export class RootTypographyController {
  private readonly root: HTMLElement
  private readonly original = new Map<string, { value: string; priority: string }>()
  private readonly applied = new Map<string, { value: string; priority: string }>()

  constructor(root: HTMLElement = document.documentElement) {
    this.root = root
    for (const property of ['font-family', 'font-size', 'zoom']) {
      this.original.set(property, this.read(property))
    }
  }

  apply(config: PersonalThemeConfig): void {
    this.write('font-family', config.fontFamily)
    this.write('font-size', `${config.baseFontSize}px`)
    this.write('zoom', String(config.zoom))
  }

  dispose(): void {
    for (const [property, applied] of this.applied) {
      const current = this.read(property)
      if (current.value !== applied.value || current.priority !== applied.priority) continue
      const original = this.original.get(property)
      if (original === undefined || original.value === '') this.root.style.removeProperty(property)
      else this.root.style.setProperty(property, original.value, original.priority)
    }
    this.applied.clear()
  }

  private write(property: string, value: string): void {
    this.root.style.setProperty(property, value)
    this.applied.set(property, this.read(property))
  }

  private read(property: string): { value: string; priority: string } {
    return {
      value: this.root.style.getPropertyValue(property),
      priority: this.root.style.getPropertyPriority(property),
    }
  }
}
