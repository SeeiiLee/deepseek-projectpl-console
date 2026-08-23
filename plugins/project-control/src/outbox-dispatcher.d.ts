export declare const EXTERNAL_EVENT_SCHEMA_VERSION: 'normalized-event/v1alpha1'
export declare const EXTERNAL_EVENT_TYPES: ReadonlySet<string>
export declare const OUTBOX_DISPATCH_BATCH: number
export declare const OUTBOX_DISPATCH_MAX_ATTEMPTS: number
export declare const OUTBOX_DISPATCH_RETRY_BASE_MS: number

export interface OutboxDispatcherStorage {
  listOutbox(options?: {
    status?: 'pending' | 'dispatching' | 'delivered' | 'failed' | null
    limit?: number
  }): ReadonlyArray<Record<string, unknown>>
  transitionOutboxMessage(
    outboxId: string,
    expectedStatus: string,
    next: Record<string, unknown>,
  ): Record<string, unknown> | null
  getProject(projectId: string): Record<string, unknown> | null
  getProgressUpdateByCommandId(commandId: string): Record<string, unknown> | null
  recordQuarantineItem(input: Record<string, unknown>): Record<string, unknown>
}

export declare function createOutboxDispatcher(options: {
  storage: OutboxDispatcherStorage
  now?: () => string
  logger?: (line: string) => void
  fileSystem?: {
    mkdir: (path: string) => Promise<unknown>
    writeFile: (path: string, content: string) => Promise<unknown>
  }
  batchSize?: number
  maxAttempts?: number
  retryBaseMs?: number
}): {
  drain(): Promise<{ delivered: readonly string[]; failed: readonly string[] }>
}
