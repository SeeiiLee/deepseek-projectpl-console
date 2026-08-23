/** Browser half: settings UI, durable personalApi binding, and live theme projection. */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { PersonalThemeConfig } from './theme-document.ts'
// Type-only imports merge the official service and settings slot contracts.
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { createThemePersistence } from './api-adapter.ts'
import { PersonalThemeController } from './controller.ts'
import {
  buildThemeTokenOverrides,
  RootTypographyController,
  themeTokenSource,
} from './theme-runtime.ts'
import { PersonalThemeSection } from './PersonalThemeSection.tsx'
import type { PersonalThemeSectionInjected } from './PersonalThemeSection.tsx'

export {
  createDefaultThemeDocument,
  DEFAULT_THEME_CONFIG,
  effectiveThemeConfig,
  normalizeThemeConfig,
  normalizeThemeDocument,
  normalizeWorkspaceKey,
  type PersonalThemeConfig,
  type PersonalThemeDocument,
} from './theme-document.ts'
export { PersonalThemeController, type PersonalThemeState, type ThemeEditorScope } from './controller.ts'
export {
  buildThemeTokenOverrides, readableForeground, RootTypographyController, withAlpha,
} from './theme-runtime.ts'

/** Required Cordis services; module graph ordering is also declared in package.json. */
export const inject = ['personalApi', 'theme', 'sessions', 'slots']

export function apply(ctx: ClientContext): void {
  const personalApi = ctx.get('personalApi') as unknown
  const controller = new PersonalThemeController(createThemePersistence(personalApi))

  const syncWorkspace = (): void => {
    const sessions = ctx.sessions.list.getSnapshot()
    const current = sessions.current
    controller.setWorkspace(current === undefined ? undefined : sessions.byId[current]?.cwd)
  }
  syncWorkspace()
  ctx.effect(
    () => ctx.sessions.list.subscribe(syncWorkspace),
    'personal-theme: current workspace selection',
  )

  ctx.effect(() => {
    const typography = new RootTypographyController()
    let disposeOverride: (() => void) | undefined
    let lastConfig: PersonalThemeConfig | undefined
    const project = (): void => {
      const state = controller.getSnapshot()
      // Keep the official theme visible while durable state is in flight;
      // this avoids a default-theme flash for users with a saved light palette.
      if (state.status === 'idle' || state.status === 'loading') return
      const config = controller.effectiveConfig(state)
      if (config === lastConfig) return
      lastConfig = config
      // Re-registering the same source atomically replaces its layer. The old
      // disposer deliberately remains unused; ThemeRuntime makes it a no-op.
      disposeOverride = ctx.theme.overrideTokens(
        themeTokenSource(),
        buildThemeTokenOverrides(config),
      )
      typography.apply(config)
    }
    project()
    const unsubscribe = controller.subscribe(project)
    return () => {
      unsubscribe()
      disposeOverride?.()
      typography.dispose()
    }
  }, 'personal-theme: live theme projection')

  const injected = (): PersonalThemeSectionInjected => ({ controller })
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'personal-theme',
    order: 5,
    label: '个人主题',
    inject: injected,
  }, PersonalThemeSection))

  void controller.load()
}
