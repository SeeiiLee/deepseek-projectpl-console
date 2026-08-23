/** Resolved Gate 1 frame widths in pixels. */
export interface Columns {
  sidebar: number
  project: number
  conversation: number
  workbench: number
}

/** Auxiliary panel that wins when a narrow viewport cannot show both panels. */
export type PreferredAuxiliary = 'project' | 'workbench'

/** User preferences consumed by the pure concession solver. */
export interface ColumnPreferences {
  sidebarCollapsed: boolean
  projectOpen: boolean
  projectWidth: number
  workbenchOpen: boolean
  workbenchWidth: number
  preferredAuxiliary: PreferredAuxiliary
  /** Transient fullscreen: Workbench spans the project rail and the whole conversation region. */
  workbenchFullscreen: boolean
}

/** Target conversation width preserved by derived auxiliary-panel concessions. */
export const CONVERSATION_MIN = 560
/** Fixed expanded width of the native rc.5 sidebar. */
export const SIDEBAR_DEFAULT = 280
/** Fixed collapsed rail width of the native rc.5 sidebar. */
export const SIDEBAR_COLLAPSED = 56
/** Viewport breakpoint used by the rc.5 sidebar's automatic rail mode. */
export const SIDEBAR_AUTO_COLLAPSE = 1024
/** Project Console minimum draggable width. */
export const PROJECT_MIN = 320
/** Project Console maximum draggable width. */
export const PROJECT_MAX = 1000
/** Project Console initial and reset width. */
export const PROJECT_DEFAULT = 360
/** Structural rail retained when the Project Console is closed or concedes. */
export const PROJECT_COLLAPSED_RAIL = 40
/** Workbench minimum draggable width. */
export const WORKBENCH_MIN = 360
/** Workbench maximum draggable width; effectively viewport-limited so wide monitors can use all available space. */
export const WORKBENCH_MAX = 4000
/** Workbench initial and reset width（含加宽后的 352px 文件树仍留出预览空间）. */
export const WORKBENCH_DEFAULT = 640
/** Structural rail retained when Workbench is closed or concedes. */
export const WORKBENCH_COLLAPSED_RAIL = 44

/** Clamp and round a panel width. */
export function clampWidth(px: number, min: number, max: number): number {
  const rounded = Number.isFinite(px) ? Math.round(px) : min
  return Math.min(max, Math.max(min, rounded))
}

type MutableWidth = { value: number }

/** Spend a deficit by shrinking one open panel to minimum, then to its rail. */
function concede(
  width: MutableWidth,
  open: boolean,
  minimum: number,
  rail: number,
  deficit: number,
): number {
  if (!open || deficit <= 0) return deficit
  if (width.value > minimum) {
    const shrink = Math.min(deficit, width.value - minimum)
    width.value -= shrink
    deficit -= shrink
  }
  if (deficit > 0 && width.value > rail) {
    deficit -= width.value - rail
    width.value = rail
  }
  return Math.max(0, deficit)
}

/**
 * Resolve the four Gate 1 tracks without mutating user preferences.
 *
 * Workbench normally concedes before Project Console. A recent explicit
 * project/workbench operation transiently gives that panel priority, so a
 * rail click always has a visible result in a 1380px-class window. Widening
 * the viewport automatically restores both preferred widths. If even both
 * rails cannot preserve the 560px target, Conversation gets all remaining
 * space and no auxiliary panel overlays it.
 */
export function computeColumns(viewport: number, preferences: ColumnPreferences): Columns {
  const safeViewport = Number.isFinite(viewport) ? Math.max(0, viewport) : 0
  const sidebar = preferences.sidebarCollapsed ? SIDEBAR_COLLAPSED : SIDEBAR_DEFAULT
  const project = {
    value: preferences.projectOpen
      ? clampWidth(preferences.projectWidth, PROJECT_MIN, PROJECT_MAX)
      : PROJECT_COLLAPSED_RAIL,
  }
  const workbench = {
    value: preferences.workbenchOpen
      ? clampWidth(preferences.workbenchWidth, WORKBENCH_MIN, WORKBENCH_MAX)
      : WORKBENCH_COLLAPSED_RAIL,
  }

  // Fullscreen ignores remembered widths and the conversation target:
  // the console stays a rail and Workbench takes everything else.
  if (preferences.workbenchFullscreen) {
    return {
      sidebar,
      project: PROJECT_COLLAPSED_RAIL,
      conversation: 0,
      workbench: Math.max(0, safeViewport - sidebar - PROJECT_COLLAPSED_RAIL),
    }
  }

  let deficit = Math.max(
    0,
    sidebar + project.value + workbench.value + CONVERSATION_MIN - safeViewport,
  )

  if (preferences.preferredAuxiliary === 'workbench') {
    deficit = concede(project, preferences.projectOpen, PROJECT_MIN, PROJECT_COLLAPSED_RAIL, deficit)
    concede(workbench, preferences.workbenchOpen, WORKBENCH_MIN, WORKBENCH_COLLAPSED_RAIL, deficit)
  } else {
    deficit = concede(workbench, preferences.workbenchOpen, WORKBENCH_MIN, WORKBENCH_COLLAPSED_RAIL, deficit)
    concede(project, preferences.projectOpen, PROJECT_MIN, PROJECT_COLLAPSED_RAIL, deficit)
  }

  return {
    sidebar,
    project: project.value,
    conversation: Math.max(0, safeViewport - sidebar - project.value - workbench.value),
    workbench: workbench.value,
  }
}
