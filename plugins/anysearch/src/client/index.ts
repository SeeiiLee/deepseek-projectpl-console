import type { ClientContext, SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { AnySearchSection, type AnySearchSectionInjected, type AnySearchSectionValue } from './AnySearchSection.tsx'

/** Runtime services used by the settings contribution. */
export const inject = ['slots', 'settingsScope']

/** Register the AnySearch provider settings section. */
export function apply(ctx: ClientContext): void {
  const binder = ctx.get('settingsScope')
  if (binder === undefined) return
  const scope: SettingsScope<AnySearchSectionValue> = binder.bind({
    namespace: 'anysearch',
  })
  const injected = (): AnySearchSectionInjected => ({ scope })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'personal-anysearch',
    order: 45,
    label: 'AnySearch 搜索',
    inject: injected,
  }, AnySearchSection))
}

