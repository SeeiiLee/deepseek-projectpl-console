// Outbox dispatcher for Gate 2E: drains pending external runtime update events
// and mirrors them into the managed project's standard log directory
// (PROJECT_PROTOCOL.md section 8). The durable facts live in domain_events and
// progress_updates; the Markdown files are retryable side effects. Delivery is
// bounded per drain, single-flight per dispatcher, and failed messages are
// quarantined instead of retried forever.

import { dirname, join } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'

import { renderProgressUpdate } from './updates-renderer.js'

export const EXTERNAL_EVENT_SCHEMA_VERSION = 'normalized-event/v1alpha1'
export const EXTERNAL_EVENT_TYPES = Object.freeze(new Set([
  'progress.recorded',
  'blocker.raised',
  'completion.declared',
]))
export const OUTBOX_DISPATCH_BATCH = 25
export const OUTBOX_DISPATCH_MAX_ATTEMPTS = 5
export const OUTBOX_DISPATCH_RETRY_BASE_MS = 30_000

/**
 * Create a bounded, single-flight outbox dispatcher.
 * @param {{
 *   storage: {
 *     listOutbox(options: object): Array<Record<string, unknown>>,
 *     transitionOutboxMessage(outboxId: string, expectedStatus: string, next: object): Record<string, unknown> | null,
 *     getProject(projectId: string): Record<string, unknown> | null,
 *     getProgressUpdateByCommandId(commandId: string): Record<string, unknown> | null,
 *     recordQuarantineItem(input: object): Record<string, unknown>,
 *   },
 *   now?: () => string,
 *   logger?: (line: string) => void,
 *   fileSystem?: { mkdir: (path: string) => Promise<unknown>, writeFile: (path: string, content: string) => Promise<unknown> },
 *   batchSize?: number,
 *   maxAttempts?: number,
 *   retryBaseMs?: number,
 * }} options
 */
export function createOutboxDispatcher(options) {
  const {
    storage,
    now = () => new Date().toISOString(),
    logger = () => {},
    fileSystem = { mkdir: (path) => mkdir(path, { recursive: true }), writeFile },
    batchSize = OUTBOX_DISPATCH_BATCH,
    maxAttempts = OUTBOX_DISPATCH_MAX_ATTEMPTS,
    retryBaseMs = OUTBOX_DISPATCH_RETRY_BASE_MS,
  } = options
  if (typeof storage !== 'object' || storage === null) throw new TypeError('outbox dispatcher requires storage')
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 500) throw new TypeError('batchSize must be 1..500')
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) throw new TypeError('maxAttempts must be 1..20')
  if (!Number.isSafeInteger(retryBaseMs) || retryBaseMs < 1000) throw new TypeError('retryBaseMs must be at least 1000')

  let inFlight = null

  /** Deliver one event; returns a transition descriptor for the outbox row. */
  function planDelivery(message) {
    const outboxId = message.outboxId
    const event = message.payload
    const eventType = event?.eventType
    if (message.schemaVersion !== EXTERNAL_EVENT_SCHEMA_VERSION || !EXTERNAL_EVENT_TYPES.has(eventType)) {
      // Lifecycle and other event kinds have no standard-log renderer; a future
      // consumer owns them. They stay pending and never block the queue.
      return null
    }
    const project = storage.getProject(String(event.target.projectId))
    if (project === null) {
      throw new Error(`project ${event.target.projectId} does not exist`)
    }
    if (project.mode !== 'managed') {
      // The standard .dsh-project/updates directory only applies to managed
      // projects; legacy projects keep their own DEVLOG discipline. The
      // durable event remains queryable through the Host projections.
      return { kind: 'deliver_without_file' }
    }
    const location = (project.workspaceLocations ?? []).find(
      (candidate) => candidate.kind === 'primary' && candidate.isActive,
    )
    if (location === undefined || typeof location.displayPath !== 'string' || location.displayPath === '') {
      throw new Error('managed project has no active primary workspace location')
    }
    const update = storage.getProgressUpdateByCommandId(String(event.causation.commandId))
    if (update === null) {
      throw new Error('progress update row is missing for the accepted event')
    }
    const rendered = renderProgressUpdate({
      update,
      eventId: String(event.eventId),
      actor: event.actor,
      occurredAt: String(event.occurredAt),
      recordedAt: String(event.recordedAt),
      generatedBy: update.generatedBy,
    })
    return {
      kind: 'write_file',
      absolutePath: join(location.displayPath, rendered.relativePath),
      markdown: rendered.markdown,
    }
  }

  async function attemptDelivery(message) {
    const plan = planDelivery(message)
    if (plan === null) return { handled: false }
    if (plan.kind === 'deliver_without_file') {
      storage.transitionOutboxMessage(message.outboxId, 'pending', {
        status: 'delivered',
        attemptCount: Number(message.attemptCount) + 1,
        deliveredAt: now(),
      })
      return { handled: true }
    }
    await fileSystem.mkdir(dirname(plan.absolutePath))
    await fileSystem.writeFile(plan.absolutePath, plan.markdown)
    const transitioned = storage.transitionOutboxMessage(message.outboxId, 'pending', {
      status: 'delivered',
      attemptCount: Number(message.attemptCount) + 1,
      deliveredAt: now(),
    })
    if (transitioned === null) return { handled: false, raced: true }
    return { handled: true }
  }

  async function recordFailure(message, error) {
    const attempt = Number(message.attemptCount) + 1
    const messageText = String(error?.message ?? error).slice(0, 1000)
    const transitioned = attempt >= maxAttempts
      ? storage.transitionOutboxMessage(message.outboxId, 'pending', {
          status: 'failed',
          attemptCount: attempt,
          lastError: messageText,
        })
      : storage.transitionOutboxMessage(message.outboxId, 'pending', {
          status: 'pending',
          attemptCount: attempt,
          nextAttemptAt: new Date(Date.parse(now()) + retryBaseMs * 2 ** (attempt - 1)).toISOString(),
          lastError: messageText,
        })
    if (transitioned !== null && attempt >= maxAttempts) {
      storage.recordQuarantineItem({
        projectId: message.payload?.target?.projectId ?? null,
        sourceKind: 'outbox_delivery',
        sourceRef: message.outboxId,
        reasonCode: 'OUTBOX_DELIVERY_FAILED',
        details: {
          eventId: message.payload?.eventId ?? null,
          eventType: message.payload?.eventType ?? null,
          attempts: attempt,
          message: messageText,
        },
      })
    }
  }

  /**
   * Drain one bounded batch of pending external update messages. Overlapping
   * calls share the same single flight; a null/racy transition is skipped
   * rather than quarantined. Returns delivery counts.
   */
  function drain() {
    if (inFlight !== null) return inFlight
    inFlight = (async () => {
      const delivered = []
      const failed = []
      const nowIso = now()
      const candidates = storage.listOutbox({ status: 'pending', limit: 500 })
      const messages = candidates
        .filter((message) => message.schemaVersion === EXTERNAL_EVENT_SCHEMA_VERSION)
        .filter((message) => message.nextAttemptAt === null || message.nextAttemptAt <= nowIso)
        .slice(0, batchSize)
      for (const message of messages) {
        try {
          const outcome = await attemptDelivery(message)
          if (outcome.handled) delivered.push(message.outboxId)
        } catch (error) {
          failed.push(message.outboxId)
          try {
            await recordFailure(message, error)
          } catch (quarantineError) {
            logger(`outbox failure recording failed for ${message.outboxId}: ${String(quarantineError)}`)
          }
        }
      }
      return Object.freeze({ delivered, failed })
    })()
    inFlight.then(() => { inFlight = null }, () => { inFlight = null })
    return inFlight
  }

  return Object.freeze({ drain })
}
