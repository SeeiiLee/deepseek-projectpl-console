import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { UpdateCenterSection } from './UpdateCenterSection.tsx'
import { requireUpdateBridge } from './desktopBridge.ts'

export const inject = ['slots']

/** Register the desktop update center in Settings. */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'personal-update-center',
    order: 80,
    label: '更新中心',
    inject: () => ({ bridge: requireUpdateBridge() }),
  }, UpdateCenterSection))
}

export type {
  BundledPluginState,
  DesktopUpdateState,
  HarnessUpdateState,
  UpdateCenterBridge,
  UpdateCenterState,
  UpdateSettings,
  UpdateStatus,
} from './desktopBridge.ts'
