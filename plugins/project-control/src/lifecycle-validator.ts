import { readFileSync } from 'node:fs'
import type { AnySchema, ValidateFunction } from 'ajv'
import Ajv2020, { type ErrorObject } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { runtimeSchemaPath } from './runtime-schema.ts'

const COMMAND_SCHEMA_PATH = runtimeSchemaPath('lifecycleCommand')
const RESULT_SCHEMA_PATH = runtimeSchemaPath('lifecycleResult')

let commandValidator: ValidateFunction<LifecycleCommand> | undefined
let commandValidatorUnavailable = false
let resultValidator: ValidateFunction<LifecycleCommandResult> | undefined
let resultValidatorUnavailable = false

export interface LifecycleCommand {
  protocolVersion: 'project-control.dsh/v1alpha1'
  schemaVersion: 'lifecycle-command-envelope/v1alpha1'
  commandId: string
  correlationId: string
  idempotencyKey: string
  kind:
    | 'project.registerLegacy'
    | 'project.registerManaged'
    | 'project.createFromTemplate'
    | 'project.rebindLocation'
    | 'project.upgradeManaged'
  occurredAt: string
  actor: {
    kind: 'human' | 'agent' | 'system' | 'application'
    id: string
    applicationId: string
    displayName?: string
  }
  target: { aggregateType: 'project'; projectId: string }
  expectedRevision: number
  provenance: Record<string, unknown>
  payload: Record<string, unknown>
  extensions?: Record<string, unknown>
}

export interface LifecycleValidationIssue {
  instancePath: string
  keyword: string
  message: string
}

export type LifecycleCommandValidation =
  | { ok: true; value: LifecycleCommand }
  | { ok: false; reason: 'schema_invalid'; errors: readonly LifecycleValidationIssue[] }
  | { ok: false; reason: 'validation_unavailable'; errors: readonly [] }

export type LifecycleCommandResult = Record<string, unknown>
export type LifecycleResultValidation =
  | { ok: true; value: LifecycleCommandResult }
  | { ok: false; reason: 'schema_invalid'; errors: readonly LifecycleValidationIssue[] }
  | { ok: false; reason: 'validation_unavailable'; errors: readonly [] }

/** Validate the canonical command envelope without maintaining a second schema copy in runtime code. */
export function validateLifecycleCommand(value: unknown): LifecycleCommandValidation {
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

/** Validate storage output against the canonical result conditions before exposing it over HTTP. */
export function validateLifecycleResult(value: unknown): LifecycleResultValidation {
  const validateResult = getResultValidator()
  if (validateResult === null) {
    return { ok: false, reason: 'validation_unavailable', errors: [] }
  }
  if (validateResult(value)) return { ok: true, value }
  return {
    ok: false,
    reason: 'schema_invalid',
    errors: (validateResult.errors ?? []).map(publicValidationIssue),
  }
}

function getCommandValidator(): ValidateFunction<LifecycleCommand> | null {
  if (commandValidator !== undefined) return commandValidator
  if (commandValidatorUnavailable) return null
  try {
    commandValidator = compileSchema<LifecycleCommand>(COMMAND_SCHEMA_PATH)
    return commandValidator
  } catch {
    commandValidatorUnavailable = true
    return null
  }
}

function getResultValidator(): ValidateFunction<LifecycleCommandResult> | null {
  if (resultValidator !== undefined) return resultValidator
  if (resultValidatorUnavailable) return null
  try {
    resultValidator = compileSchema<LifecycleCommandResult>(RESULT_SCHEMA_PATH)
    return resultValidator
  } catch {
    resultValidatorUnavailable = true
    return null
  }
}

function compileSchema<T>(schemaPath: string): ValidateFunction<T> {
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as AnySchema
  const ajv = new Ajv2020({ allErrors: true, strict: true })
  addFormats(ajv)
  return ajv.compile<T>(schema)
}

function publicValidationIssue(error: ErrorObject): LifecycleValidationIssue {
  return {
    instancePath: error.instancePath,
    keyword: error.keyword,
    message: error.message ?? 'schema validation failed',
  }
}
