import type { IncomingMessage, ServerResponse } from 'node:http'
import { createWorkspaceRequestHandler, WORKSPACE_API_PREFIX, resolveWorkspaceRoot } from './workspace-remote.ts'

interface WebServerLike {
  register(route: {
    kind: 'prefix'
    path: string
    handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
  }): () => void
}

interface HostContextLike {
  webServer: WebServerLike
  effect(factory: () => (() => void | Promise<void>) | void, label?: string): void
}

/** Required Harness services for the P8 workspace remote. */
export const inject = ['webServer']

export function apply(ctx: HostContextLike): void {
  const handler = createWorkspaceRequestHandler(resolveWorkspaceRoot())
  ctx.effect(() => {
    const unregister = ctx.webServer.register({ kind: 'prefix', path: WORKSPACE_API_PREFIX, handler })
    return () => { unregister() }
  }, 'workbench workspace root Host remote')
}

export { createWorkspaceRequestHandler, resolveWorkspaceRoot, workspaceError, WORKSPACE_API_PREFIX, MAX_BLOB_BYTES, MAX_TEXT_BYTES, MAX_TREE_ENTRIES } from './workspace-remote.ts'