import {
  clampWidth,
  PROJECT_DEFAULT,
  PROJECT_MAX,
  PROJECT_MIN,
  WORKBENCH_DEFAULT,
  WORKBENCH_MAX,
  WORKBENCH_MIN,
} from './columns.ts'

/** Versioned browser key owned only by Personal Shell. */
export const LAYOUT_STORAGE_KEY = 'dsh.personal-shell.layout.v1'
/** Current persisted preference schema. */
export const LAYOUT_PREFERENCES_VERSION = 1 as const

export interface LayoutPreferences {
  version: typeof LAYOUT_PREFERENCES_VERSION
  sidebarOpen: boolean
  project: { open: boolean; width: number }
  workbench: { open: boolean; width: number }
}

/** Persistent projection shared by the root store and pure storage helpers. */
export interface LayoutPreferenceState {
  sidebarOpen: boolean
  projectOpen: boolean
  projectWidth: number
  workbenchOpen: boolean
  workbenchWidth: number
}

/** Minimal storage face used to make sanitisation independently testable. */
export interface LayoutStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** Contract defaults used for first boot, corrupt storage and reset layout. */
export function defaultLayoutPreferences(): LayoutPreferences {
  return {
    version: LAYOUT_PREFERENCES_VERSION,
    sidebarOpen: true,
    project: { open: true, width: PROJECT_DEFAULT },
    workbench: { open: true, width: WORKBENCH_DEFAULT },
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
}

function cleanBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function cleanWidth(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? clampWidth(value, min, max)
    : fallback
}

/** Validate and clamp an untrusted localStorage payload into the current schema. */
export function sanitizeLayoutPreferences(value: unknown): LayoutPreferences {
  const fallback = defaultLayoutPreferences()
  const source = record(value)
  if (source?.version !== LAYOUT_PREFERENCES_VERSION) return fallback
  const project = record(source.project)
  const workbench = record(source.workbench)
  return {
    version: LAYOUT_PREFERENCES_VERSION,
    sidebarOpen: cleanBoolean(source.sidebarOpen, fallback.sidebarOpen),
    project: {
      open: cleanBoolean(project?.open, fallback.project.open),
      width: cleanWidth(project?.width, fallback.project.width, PROJECT_MIN, PROJECT_MAX),
    },
    workbench: {
      open: cleanBoolean(workbench?.open, fallback.workbench.open),
      width: cleanWidth(workbench?.width, fallback.workbench.width, WORKBENCH_MIN, WORKBENCH_MAX),
    },
  }
}

function browserStorage(): LayoutStorage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

/** Load preferences and immediately rewrite a clean, current-version payload. */
export function loadLayoutPreferences(storage = browserStorage()): LayoutPreferences {
  let candidate: unknown
  if (storage !== undefined) {
    try {
      const raw = storage.getItem(LAYOUT_STORAGE_KEY)
      candidate = raw === null ? undefined : JSON.parse(raw)
    } catch {
      candidate = undefined
    }
  }
  const clean = sanitizeLayoutPreferences(candidate)
  if (storage !== undefined) {
    try {
      storage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(clean))
    } catch {
      // Private mode/quota failures disable persistence without breaking layout.
    }
  }
  return clean
}

/** Extract, clamp and persist only user preferences, never derived viewport state. */
export function saveLayoutPreferences(state: LayoutPreferenceState, storage = browserStorage()): void {
  if (storage === undefined) return
  const clean = sanitizeLayoutPreferences({
    version: LAYOUT_PREFERENCES_VERSION,
    sidebarOpen: state.sidebarOpen,
    project: { open: state.projectOpen, width: state.projectWidth },
    workbench: { open: state.workbenchOpen, width: state.workbenchWidth },
  })
  try {
    storage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(clean))
  } catch {
    // Persistence is a convenience; layout remains live when storage is unavailable.
  }
}
