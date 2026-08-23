import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import {
  layoutMutations,
  layoutStateFromPreferences,
} from './layout-state.ts'
import type { LayoutState } from './layout-state.ts'
import {
  loadLayoutPreferences,
  saveLayoutPreferences,
} from './preferences.ts'

export type { DetailsCommand, LayoutState } from './layout-state.ts'

type LayoutActions = {
  /** Pointer-preview mutation; commitProject persists once at gesture end. */
  previewProject: (draft: LayoutState, px: number) => void
  commitProject: (draft: LayoutState) => void
  setProject: (draft: LayoutState, px: number) => void
  toggleProject: (draft: LayoutState) => void
  openProject: (draft: LayoutState) => void
  closeProject: (draft: LayoutState) => void
  /** Pointer-preview mutation; commitWorkbench persists once at gesture end. */
  previewWorkbench: (draft: LayoutState, px: number) => void
  commitWorkbench: (draft: LayoutState) => void
  setWorkbench: (draft: LayoutState, px: number) => void
  toggleWorkbench: (draft: LayoutState) => void
  openWorkbench: (draft: LayoutState) => void
  closeWorkbench: (draft: LayoutState) => void
  /** Transient mode; never persisted. */
  toggleWorkbenchFullscreen: (draft: LayoutState) => void
  toggleSidebar: (draft: LayoutState) => void
  setNarrow: (draft: LayoutState, narrow: boolean) => void
  openDetails: (draft: LayoutState) => void
  closeDetails: (draft: LayoutState) => void
  clearDetails: (draft: LayoutState) => void
  focusConversation: (draft: LayoutState) => void
  resetLayout: (draft: LayoutState) => void
}

function persist(draft: LayoutState): void {
  saveLayoutPreferences(draft)
}

/** Create the Gate 1 root layout store with cleansed, versioned preferences. */
export function createLayoutStore(): EngineStoreHandle<LayoutState, LayoutActions> {
  return defineStore({
    init: (): LayoutState => layoutStateFromPreferences(loadLayoutPreferences()),
    actions: {
      previewProject: (draft, px: number) => {
        layoutMutations.setProject(draft, px)
      },
      commitProject: (draft) => { persist(draft) },
      setProject: (draft, px: number) => {
        layoutMutations.setProject(draft, px)
        persist(draft)
      },
      toggleProject: (draft) => {
        layoutMutations.toggleProject(draft)
        persist(draft)
      },
      openProject: (draft) => {
        layoutMutations.openProject(draft)
        persist(draft)
      },
      closeProject: (draft) => {
        layoutMutations.closeProject(draft)
        persist(draft)
      },
      previewWorkbench: (draft, px: number) => {
        layoutMutations.setWorkbench(draft, px)
      },
      commitWorkbench: (draft) => { persist(draft) },
      setWorkbench: (draft, px: number) => {
        layoutMutations.setWorkbench(draft, px)
        persist(draft)
      },
      toggleWorkbench: (draft) => {
        layoutMutations.toggleWorkbench(draft)
        persist(draft)
      },
      openWorkbench: (draft) => {
        layoutMutations.openWorkbench(draft)
        persist(draft)
      },
      closeWorkbench: (draft) => {
        layoutMutations.closeWorkbench(draft)
        persist(draft)
      },
      toggleWorkbenchFullscreen: (draft) => {
        layoutMutations.setWorkbenchFullscreen(draft, !draft.workbenchFullscreen)
      },
      toggleSidebar: (draft) => {
        const persistWidePreference = !draft.narrow
        layoutMutations.toggleSidebar(draft)
        if (persistWidePreference) persist(draft)
      },
      setNarrow: (draft, narrow: boolean) => {
        layoutMutations.setNarrow(draft, narrow)
      },
      openDetails: (draft) => {
        layoutMutations.openDetails(draft)
        persist(draft)
      },
      closeDetails: (draft) => {
        layoutMutations.closeDetails(draft)
        persist(draft)
      },
      clearDetails: (draft) => {
        layoutMutations.clearDetails(draft)
      },
      focusConversation: (draft) => {
        layoutMutations.focusConversation(draft)
        persist(draft)
      },
      resetLayout: (draft) => {
        layoutMutations.resetLayout(draft)
        persist(draft)
      },
    },
  })
}
