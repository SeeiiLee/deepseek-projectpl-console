import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { ConnectionCenterSection, type ConnectionCenterSectionInjected } from './ConnectionCenterSection.tsx'
import { createConnectionCenterApi } from './connectionApi.ts'
import { requirePersonalApi } from './personalApi.ts'

export const inject = ['slots', 'personalApi']

/** Register the configuration-only Connection Center in Settings. */
export function apply(ctx: ClientContext): void {
  const api = createConnectionCenterApi(requirePersonalApi(ctx.get('personalApi')))
  const injected = (): ConnectionCenterSectionInjected => ({ api })
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'personal-connection-center',
    order: 60,
    label: '连接中心',
    inject: injected,
  }, ConnectionCenterSection))
}

export type { ConnectionCenterApi, ConnectionInput, ConnectionItem, ConnectionKind, McpTransport } from './connectionApi.ts'
export type { ConnectionCenterSectionInjected, ConnectionCenterSectionProps } from './ConnectionCenterSection.tsx'
