import type { ILayout } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
import type { createLayoutStore } from './stores.ts'

/** Store actions wired into both shell services by the root entry. */
export type PanelActions = BoundActions<ReturnType<typeof createLayoutStore>>

/** Gate 1 layout commands available to Personal Desktop plugins. */
export interface IPersonalShell {
  openProject(): void
  closeProject(): void
  toggleProject(): void
  openWorkbench(): void
  closeWorkbench(): void
  toggleWorkbench(): void
  /** Toggle transient fullscreen: Workbench spans the console rail and conversation region. */
  toggleWorkbenchFullscreen(): void
  /** Collapse both auxiliary panels while retaining their last widths. */
  focusConversation(): void
  /** Restore contract defaults for sidebar, panels and remembered widths. */
  resetLayout(): void
}

/** rc.5 layout compatibility plus the Personal Shell Gate 1 service face. */
export class LayoutController implements ILayout, IPersonalShell {
  #panels: PanelActions | undefined

  /** Attach the current root entry's bound actions. */
  attachPanels(actions: PanelActions): void {
    this.#panels = actions
  }

  /** Toggle the native sidebar between its full form and 56px rail. */
  toggleSidebar(): void {
    this.#require().toggleSidebar()
  }

  /** Expand Workbench and signal that its legacy Details surface was requested. */
  openDetails(): void {
    this.#require().openDetails()
  }

  /** Preserve the official close contract by collapsing the containing Workbench. */
  closeDetails(): void {
    this.#require().closeDetails()
  }

  openProject(): void {
    this.#require().openProject()
  }

  closeProject(): void {
    this.#require().closeProject()
  }

  toggleProject(): void {
    this.#require().toggleProject()
  }

  openWorkbench(): void {
    this.#require().openWorkbench()
  }

  closeWorkbench(): void {
    this.#require().closeWorkbench()
  }

  toggleWorkbench(): void {
    this.#require().toggleWorkbench()
  }

  toggleWorkbenchFullscreen(): void {
    this.#require().toggleWorkbenchFullscreen()
  }

  focusConversation(): void {
    this.#require().focusConversation()
  }

  resetLayout(): void {
    this.#require().resetLayout()
  }

  #require(): PanelActions {
    if (this.#panels === undefined) {
      throw new Error('personal-shell: panel actions not wired (root entry not mounted)')
    }
    return this.#panels
  }
}

export type { ILayout } from '@deepseek-ai/dsh-client-ui-layout/client'
