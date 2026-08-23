import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { PluginOrganizerSection, type PluginOrganizerSectionInjected } from './PluginOrganizerSection.tsx'
import { createPluginOrganizerApi } from './pluginApi.ts'
import { requirePersonalApi } from './personalApi.ts'

export const inject = ['slots', 'personalApi']

/** Register a metadata organizer beside, rather than in place of, the native Plugins page. */
export function apply(ctx: ClientContext): void {
  const api = createPluginOrganizerApi(requirePersonalApi(ctx.get('personalApi')))
  const injected = (): PluginOrganizerSectionInjected => ({ api })
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'personal-plugin-organizer',
    order: 50,
    label: '插件整理',
    inject: injected,
  }, PluginOrganizerSection))
}

export type { PluginFiberPhase, PluginItem, PluginOrganizerApi } from './pluginApi.ts'
export type { PluginOrganizerSectionInjected, PluginOrganizerSectionProps } from './PluginOrganizerSection.tsx'
