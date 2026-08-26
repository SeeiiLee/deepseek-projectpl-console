import { readFileSync } from 'node:fs'
import type { AnySchema, ValidateFunction } from 'ajv'
import Ajv2020, { type ErrorObject } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { runtimeSchemaPath } from './runtime-schema.ts'

const COMMAND_SCHEMA_PATH = runtimeSchemaPath('externalCommand')

let commandValidator: ValidateFunction<ExternalUpdateCommand> | undefined
let commandValidatorUnavailable = false

export interface ExternalUpdateCommand {
  protocolVersion: 'project-control.dsh/v1alpha1'
  schemaVersion: 'command-envelope/v1alpha1'
  commandId: string
  correlationId: string
  idempotencyKey: string
  kind: 'progress.report' | 'blocker.raise' | 'completion.declare'
  occurredAt: string
  actor: {
    kind: 'human' | 'agent' | 'system' | 'application'
    id: string
    applicationId: string
    displayName?: string
  }
  target: {
    projectId: string
    workItemId: string
    runId: string
    threadId: string
    aggregateType: 'work_item' | 'run'
    aggregateId: string
  }
  expectedRevision: number
  provenance: Record<string, unknown>
  payload: Record<string, unknown>
  extensions?: Record<string, unknown>
}

export interface ExternalValidationIssue {
  instancePath: string
  keyword: string
  message: string
}

export type ExternalUpdateCommandValidation =
  | { ok: true; value: ExternalUpdateCommand }
  | { ok: false; reason: 'schema_invalid'; errors: readonly ExternalValidationIssue[] }
  | { ok: false; reason: 'validation_unavailable'; errors: readonly [] }

/** Validate the canonical external update envelope without a second schema copy in runtime code. */
export function validateExternalUpdateCommand(value: unknown): ExternalUpdateCommandValidation {
  const validateCommand = getCommandValidator()
  if (validateCommand === null) {
    return { ok: false, reason: 'validation_unavailable', errors: [] }
  }
  if (validateCommand(value)) return { ok: true, value }
  return {
    ok: false,
    reason: 'schema_invalid',
    errors: (validateCommand.errors ?? []).map(publicValidationIssue),
  }
}

function getCommandValidator(): ValidateFunction<ExternalUpdateCommand> | null {
  if (commandValidator !== undefined) return commandValidator
  if (commandValidatorUnavailable) return null
  try {
    commandValidator = compileSchema<ExternalUpdateCommand>(COMMAND_SCHEMA_PATH)
    return commandValidator
  } catch {
    commandValidatorUnavailable = true
    return null
  }
}

function compileSchema<T>(schemaPath: string): ValidateFunction<T> {
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as AnySchema
  const ajv = new Ajv2020({ allErrors: true, strict: true })
  addFormats(ajv)
  return ajv.compile<T>(schema)
}

function publicValidationIssue(error: ErrorObject): ExternalValidationIssue {
  return {
    instancePath: error.instancePath,
    keyword: error.keyword,
    message: error.message ?? 'schema validation failed',
  }
}
