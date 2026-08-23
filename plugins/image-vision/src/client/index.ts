import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { ImageVisionDock } from './ImageVisionDock.tsx'

export const inject = ['slots']

/** Register the chat-adjacent image vision dock. */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'personal-image-vision',
    order: 70,
  }, ImageVisionDock))
}

export { ImageVisionDock } from './ImageVisionDock.tsx'
export { createImageVisionApi } from './imageVisionApi.ts'
export type { ImageVisionResult, ModelConnectionSummary } from './imageVisionApi.ts'