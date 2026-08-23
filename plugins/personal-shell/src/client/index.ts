import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ReactNode } from 'react'
import type {
  ConvOwnerProps,
  DetailsOwnerProps,
  ILayout,
  SidebarOwnerProps,
} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { AppFrame } from './AppFrame.tsx'
import { ProjectSidebarAction } from './ProjectSidebarAction.tsx'
import { LayoutController, type IPersonalShell, type PanelActions } from './service.ts'
import { createLayoutStore } from './stores.ts'
import type { DetailsCommand } from './stores.ts'
import { ThemePresenter } from './theme-presenter.ts'

export { LayoutController } from './service.ts'
export type { ILayout, IPersonalShell } from './service.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Gate 1 panel commands exposed to Personal Desktop plugins. */
    personalShell: IPersonalShell
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Personal Shell-owned Project Console column. */
    'project.control': { kind: 'single'; scope: 'root'; owner: ProjectControlOwnerProps }
    /** Personal Shell-owned Workbench column, including the official Details subtree. */
    'workbench.panel': { kind: 'single'; scope: 'root'; owner: WorkbenchOwnerProps }
  }
}

/** Project Console data remains owned by its independent plugin. */
export interface ProjectControlOwnerProps {}

/** Stable handoff from Shell into the independent Workbench plugin. */
export interface WorkbenchOwnerProps {
  legacyDetails: ReactNode
  detailsCommand: DetailsCommand
  /** Whether the transient fullscreen mode currently spans the Workbench column. */
  fullscreen: boolean
}

// These checks keep the replacement root pinned to the official rc.5 owner shares.
type CompatibleSidebarOwner = SidebarOwnerProps
type CompatibleConversationOwner = ConvOwnerProps
type CompatibleDetailsOwner = DetailsOwnerProps
void (undefined as CompatibleSidebarOwner | CompatibleConversationOwner | CompatibleDetailsOwner | undefined)

/** Client services required by the replacement shell. */
export const inject = ['slots', 'theme']

/**
 * Provide both shell services, occupy root, and declare all compatible child slots.
 * @param ctx - Personal Desktop client root context.
 */
export function apply(ctx: ClientContext): void {
  const layout: ILayout & LayoutController = new LayoutController()
  ctx.effect(() => {
    const disposeLayout = ctx.reflect.provide('layout', layout)
    const disposePersonalShell = ctx.reflect.provide('personalShell', layout)
    const disposeRoot = ctx.slots.register({
      name: 'root',
      children: {
        'sidebar': { kind: 'single', scope: 'root' },
        'project.control': { kind: 'single', scope: 'root' },
        'conversation': { kind: 'single', scope: 'session-maybe' },
        'details': { kind: 'single', scope: 'session' },
        'workbench.panel': { kind: 'single', scope: 'root' },
        'shell.overlay': { kind: 'list', scope: 'root' },
      },
      store: createLayoutStore,
      inject: (actions: PanelActions) => {
        layout.attachPanels(actions)
        return {}
      },
    }, AppFrame)
    return () => {
      disposeRoot()
      void disposePersonalShell()
      void disposeLayout()
    }
  }, 'personal-shell: Gate 1 services + root registration')

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'personal-project-control',
    order: -100,
    inject: () => ({ toggleProject: () => { layout.toggleProject() } }),
  }, ProjectSidebarAction))

  ctx.effect(() => {
    const presenter = new ThemePresenter()
    presenter.apply(ctx.theme.getTheme())
    const off = ctx.on('theme/change', snapshot => { presenter.apply(snapshot) })
    return () => {
      off()
      presenter.dispose()
    }
  }, 'personal-shell: theme presenter')
}
