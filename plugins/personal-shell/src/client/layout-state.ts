import {
  clampWidth,
  PROJECT_MAX,
  PROJECT_MIN,
  WORKBENCH_MAX,
  WORKBENCH_MIN,
} from './columns.ts'
import type { PreferredAuxiliary } from './columns.ts'
import { defaultLayoutPreferences } from './preferences.ts'
import type { LayoutPreferences } from './preferences.ts'

export type DetailsCommand = {
  kind: 'open' | 'dismiss'
  revision: number
}

export type LayoutState = {
  sidebarOpen: boolean
  projectOpen: boolean
  projectWidth: number
  workbenchOpen: boolean
  workbenchWidth: number
  /** Narrow-window winner; deliberately transient and never persisted. */
  preferredAuxiliary: PreferredAuxiliary
  narrow: boolean
  narrowExpanded: boolean
  /** Transient Workbench fullscreen; never persisted. */
  workbenchFullscreen: boolean
  /** Observable command stream unifying official Details with Workbench selection. */
  detailsCommand: DetailsCommand
}

/** Build clean in-memory state from the already-sanitised preference schema. */
export function layoutStateFromPreferences(preferences: LayoutPreferences): LayoutState {
  return {
    sidebarOpen: preferences.sidebarOpen,
    projectOpen: preferences.project.open,
    projectWidth: preferences.project.width,
    workbenchOpen: preferences.workbench.open,
    workbenchWidth: preferences.workbench.width,
    preferredAuxiliary: 'project',
    narrow: false,
    narrowExpanded: false,
    workbenchFullscreen: false,
    detailsCommand: { kind: 'dismiss', revision: 0 },
  }
}

/** Build the complete first-boot/reset state for reducer-level tests and store init. */
export function defaultLayoutState(): LayoutState {
  return layoutStateFromPreferences(defaultLayoutPreferences())
}

function nextRevision(current: number): number {
  return current >= Number.MAX_SAFE_INTEGER || current < 0 ? 1 : current + 1
}

function command(draft: LayoutState, kind: DetailsCommand['kind']): void {
  draft.detailsCommand = { kind, revision: nextRevision(draft.detailsCommand.revision) }
}

/** Pure mutable reducers shared by the engine store and action-level tests. */
export const layoutMutations = {
  setProject(draft: LayoutState, px: number): void {
    draft.projectWidth = clampWidth(px, PROJECT_MIN, PROJECT_MAX)
    draft.projectOpen = true
    draft.preferredAuxiliary = 'project'
    draft.workbenchFullscreen = false
  },
  toggleProject(draft: LayoutState): void {
    draft.projectOpen = !draft.projectOpen
    draft.preferredAuxiliary = draft.projectOpen ? 'project' : 'workbench'
    if (draft.projectOpen) draft.workbenchFullscreen = false
  },
  openProject(draft: LayoutState): void {
    draft.projectOpen = true
    draft.preferredAuxiliary = 'project'
    draft.workbenchFullscreen = false
  },
  closeProject(draft: LayoutState): void {
    draft.projectOpen = false
    draft.preferredAuxiliary = 'workbench'
  },
  setWorkbench(draft: LayoutState, px: number): void {
    draft.workbenchWidth = clampWidth(px, WORKBENCH_MIN, WORKBENCH_MAX)
    draft.workbenchOpen = true
    draft.preferredAuxiliary = 'workbench'
    draft.workbenchFullscreen = false
  },
  toggleWorkbench(draft: LayoutState): void {
    draft.workbenchOpen = !draft.workbenchOpen
    draft.preferredAuxiliary = draft.workbenchOpen ? 'workbench' : 'project'
  },
  setWorkbenchFullscreen(draft: LayoutState, fullscreen: boolean): void {
    if (draft.workbenchFullscreen === fullscreen) return
    draft.workbenchFullscreen = fullscreen
    if (fullscreen) {
      draft.workbenchOpen = true
      draft.preferredAuxiliary = 'workbench'
    }
  },
  openWorkbench(draft: LayoutState): void {
    draft.workbenchOpen = true
    draft.preferredAuxiliary = 'workbench'
  },
  closeWorkbench(draft: LayoutState): void {
    draft.workbenchOpen = false
    draft.preferredAuxiliary = 'project'
    draft.workbenchFullscreen = false
  },
  toggleSidebar(draft: LayoutState): void {
    if (draft.narrow) draft.narrowExpanded = !draft.narrowExpanded
    else draft.sidebarOpen = !draft.sidebarOpen
  },
  setNarrow(draft: LayoutState, narrow: boolean): void {
    if (draft.narrow === narrow) return
    draft.narrow = narrow
    draft.narrowExpanded = false
  },
  openDetails(draft: LayoutState): void {
    draft.workbenchOpen = true
    draft.preferredAuxiliary = 'workbench'
    command(draft, 'open')
  },
  closeDetails(draft: LayoutState): void {
    command(draft, 'dismiss')
    draft.workbenchOpen = false
    draft.preferredAuxiliary = 'project'
  },
  clearDetails(draft: LayoutState): void {
    command(draft, 'dismiss')
  },
  focusConversation(draft: LayoutState): void {
    draft.projectOpen = false
    draft.workbenchOpen = false
    draft.preferredAuxiliary = 'project'
    draft.workbenchFullscreen = false
  },
  resetLayout(draft: LayoutState): void {
    const revision = nextRevision(draft.detailsCommand.revision)
    Object.assign(draft, defaultLayoutState())
    draft.detailsCommand = { kind: 'dismiss', revision }
  },
} as const
