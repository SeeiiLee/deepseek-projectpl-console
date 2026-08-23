import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { UsageBalanceControl } from './UsageBalanceControl.tsx'

export const inject = ['slots']

/** Add one compact, session-aware cost control beside the composer send path. */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right',
    id: 'personal-usage-balance',
    order: 40,
  }, UsageBalanceControl))
}

export { openBillingCenter, type BillingOpenResult } from './bridge.ts'
