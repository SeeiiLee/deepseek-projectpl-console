import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { DesktopIntegrationSection } from './DesktopIntegrationSection.tsx'
import { requireDesktopBridge } from './desktopBridge.ts'

export const inject = ['slots']

/** Register desktop-native controls as one visible built-in plugin surface. */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'personal-desktop-integration',
    order: 70,
    label: '桌面集成',
    inject: () => ({ bridge: requireDesktopBridge() }),
  }, DesktopIntegrationSection))
}

export type { DesktopIntegrationBridge, DesktopIntegrationState } from './desktopBridge.ts'
