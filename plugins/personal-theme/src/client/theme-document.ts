/** Durable personal-theme document served by personal-foundation. */

export const THEME_DOCUMENT_VERSION = 1 as const

export interface PersonalThemeConfig {
  fontFamily: string
  baseFontSize: number
  zoom: number
  accentColor: string
  backgroundColor: string
  sidebarColor: string
  textColor: string
  panelOpacity: number
}

export interface PersonalThemeDocument {
  version: typeof THEME_DOCUMENT_VERSION
  global: PersonalThemeConfig
  /** Normalized cwd key to a complete override. Missing means inherit global. */
  workspaces: Record<string, PersonalThemeConfig>
}

export type PersonalThemeField = keyof PersonalThemeConfig

export const DEFAULT_THEME_CONFIG: Readonly<PersonalThemeConfig> = Object.freeze({
  fontFamily: 'Inter, "Segoe UI", "Microsoft YaHei UI", sans-serif',
  baseFontSize: 14,
  zoom: 1,
  accentColor: '#4d6bfe',
  backgroundColor: '#f7f8fa',
  sidebarColor: '#f1f2f5',
  textColor: '#171719',
  panelOpacity: 0.96,
})

export function createDefaultThemeDocument(): PersonalThemeDocument {
  return {
    version: THEME_DOCUMENT_VERSION,
    global: { ...DEFAULT_THEME_CONFIG },
    workspaces: {},
  }
}

/**
 * Accept a persisted document defensively. Unknown/missing values fall back
 * field-by-field so a partially-written or older file never breaks the UI.
 */
export function normalizeThemeDocument(value: unknown): PersonalThemeDocument {
  if (!isRecord(value)) return createDefaultThemeDocument()
  const global = normalizeThemeConfig(value.global, DEFAULT_THEME_CONFIG)
  const workspaces: Record<string, PersonalThemeConfig> = {}
  if (isRecord(value.workspaces)) {
    for (const [rawKey, rawConfig] of Object.entries(value.workspaces)) {
      const key = normalizeWorkspaceKey(rawKey)
      if (key === '') continue
      workspaces[key] = normalizeThemeConfig(rawConfig, global)
    }
  }
  return { version: THEME_DOCUMENT_VERSION, global, workspaces }
}

export function normalizeThemeConfig(
  value: unknown,
  fallback: Readonly<PersonalThemeConfig> = DEFAULT_THEME_CONFIG,
): PersonalThemeConfig {
  const candidate = isRecord(value) ? value : {}
  return {
    fontFamily: normalizeText(candidate.fontFamily, fallback.fontFamily, 200),
    baseFontSize: clampNumber(candidate.baseFontSize, 12, 22, fallback.baseFontSize),
    zoom: clampNumber(candidate.zoom, 0.75, 1.5, fallback.zoom),
    accentColor: normalizeHexColor(candidate.accentColor, fallback.accentColor),
    backgroundColor: normalizeHexColor(candidate.backgroundColor, fallback.backgroundColor),
    sidebarColor: normalizeHexColor(candidate.sidebarColor, fallback.sidebarColor),
    textColor: normalizeHexColor(candidate.textColor, fallback.textColor),
    panelOpacity: clampNumber(candidate.panelOpacity, 0.35, 1, fallback.panelOpacity),
  }
}

/** Stable case-insensitive key for Windows cwd values emitted by sessions. */
export function normalizeWorkspaceKey(cwd: string | undefined): string {
  if (cwd === undefined) return ''
  let key = cwd.trim().replaceAll('/', '\\')
  if (key === '') return ''
  while (key.length > 3 && key.endsWith('\\')) key = key.slice(0, -1)
  return /^(?:[a-z]:\\|\\\\)/iu.test(key) ? key.toLocaleLowerCase('en-US') : key
}

export function effectiveThemeConfig(
  document: PersonalThemeDocument,
  workspaceKey: string,
): PersonalThemeConfig {
  return workspaceKey === '' ? document.global : (document.workspaces[workspaceKey] ?? document.global)
}

export function isHexColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/iu.test(value)
}

function normalizeHexColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !isHexColor(value.trim())) return fallback
  return value.trim().toLowerCase()
}

function normalizeText(value: unknown, fallback: string, maxLength: number): string {
  if (typeof value !== 'string') return fallback
  const normalized = value.trim()
  return normalized === '' ? fallback : normalized.slice(0, maxLength)
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === 'number' ? value : Number.NaN
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
