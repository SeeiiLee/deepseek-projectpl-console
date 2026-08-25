import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { AnySchema, ErrorObject, ValidateFunction } from 'ajv'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

const SCHEMA_DIR = fileURLToPath(new URL(
  '../../../protocol/project-control/v1alpha1/approval/schemas/',
  import.meta.url,
))

export type ApprovalClass = 'A' | 'B'
export type ApprovalCardType = 'decision' | 'fyi_challenge' | 'option_pick' | 'gate_go'
export type ApprovalAction =
  | 'approve'
  | 'approve_with_constraints'
  | 'request_changes'
  | 'reject_with_direction'
  | 'reject_final'
  | 'delegate'
  | 'snooze'
  | 'note'

export interface ApprovalValidationIssue {
  code: string
  path?: string
  message: string
}

export type ApprovalValidationResult =
  | { ok: true; value?: unknown }
  | { ok: false; errors: ApprovalValidationIssue[] }

const EFFECT_TYPES = new Set([
  'db.migration',
  'protocol.change',
  'template.change',
  'permission.change',
  'install.remove',
  'delete.overwrite',
  'external.write',
  'external.publish',
  'file.write',
  'read.only',
])

const CLASS_A_EFFECTS = new Set([
  'db.migration',
  'protocol.change',
  'template.change',
  'permission.change',
  'install.remove',
  'delete.overwrite',
  'external.write',
  'external.publish',
])

const EXECUTOR_IDS = new Set(['k3', 'codex', 'v4pro', 'v4flash'])

const HOST_ONLY_FIELDS = [
  'status',
  'revision',
  'actor',
  'effective_class',
  'response',
  'decided_at',
  'created_at',
  'updated_at',
  'source_decision_status',
]

const MAX_EXTENSION_DEPTH = 16
const MAX_EXTENSION_BYTES = 8192
const MAX_EXTENSION_PROPERTIES = 20
const REVERSE_DOMAIN_KEY = /^(?:[a-z][a-z0-9-]*\.)+[a-z][a-z0-9-]*$/
const DECISION_ID_PATTERN = /^dec_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const CONSOLE_ACTOR = 'CONSOLE_ACTOR'
const MAX_CARD_UTF8_BYTES = 64 * 1024
const MAX_STRING_UTF8_BYTES = 8 * 1024

const ACTIONABLE_STATUSES = new Set(['queued', 'snoozed'])
const RESPONDED_STATUSES = new Set([
  'approved',
  'approved_with_constraints',
  'rejected_with_direction',
  'rejected_final',
  'delegated',
  'snoozed',
  'noted',
])
const NON_RESPONDED_STATUSES = new Set([
  'queued',
  'pending_clarification',
  'machine_rejected',
  'auto_effective',
])
const LOW_CLASS_ALLOWED_STATUSES = new Set(['machine_rejected', 'pending_clarification'])

const STATUS_ACTION_MAP: Record<string, ApprovalAction> = {
  approved: 'approve',
  approved_with_constraints: 'approve_with_constraints',
  rejected_with_direction: 'reject_with_direction',
  rejected_final: 'reject_final',
  delegated: 'delegate',
  snoozed: 'snooze',
  noted: 'note',
}

const ALL_ACTIONS: readonly ApprovalAction[] = [
  'approve',
  'approve_with_constraints',
  'request_changes',
  'reject_with_direction',
  'reject_final',
  'delegate',
  'snooze',
  'note',
]

const CARD_TYPE_ACTIONS: Record<ApprovalCardType, ReadonlySet<ApprovalAction>> = {
  decision: new Set(ALL_ACTIONS),
  option_pick: new Set(ALL_ACTIONS),
  fyi_challenge: new Set<ApprovalAction>([
    'approve',
    'request_changes',
    'reject_with_direction',
    'reject_final',
    'delegate',
    'snooze',
    'note',
  ]),
  gate_go: new Set<ApprovalAction>([
    'approve',
    'approve_with_constraints',
    'request_changes',
    'reject_with_direction',
    'reject_final',
    'delegate',
    'snooze',
  ]),
}

let ajv: Ajv2020 | undefined
let submissionValidator: ValidateFunction<unknown> | undefined
let stateValidator: ValidateFunction<unknown> | undefined
let actionCommandValidator: ValidateFunction<unknown> | undefined
let actionResultValidator: ValidateFunction<unknown> | undefined

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function ok(value?: unknown): ApprovalValidationResult {
  return value === undefined ? { ok: true } : { ok: true, value }
}

function fail(code: string, message: string, path?: string): ApprovalValidationResult {
  return { ok: false, errors: [{ code, message, ...(path === undefined ? {} : { path }) }] }
}

function failAll(issues: ApprovalValidationIssue[]): ApprovalValidationResult {
  return { ok: false, errors: issues }
}

function getAjv(): Ajv2020 {
  if (ajv !== undefined) return ajv
  const next = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true })
  addFormats(next)
  for (const name of [
    'impact-classification.schema.json',
    'executor-registry.schema.json',
    'approval-card-submission.schema.json',
    'approval-card-state.schema.json',
    'approval-action-command.schema.json',
    'approval-action-result.schema.json',
  ]) {
    next.addSchema(readSchema(name))
  }
  ajv = next
  return next
}

function readSchema(name: string): AnySchema {
  return JSON.parse(readFileSync(`${SCHEMA_DIR}${name}`, 'utf8')) as AnySchema
}

function getSubmissionValidator(): ValidateFunction<unknown> {
  submissionValidator ??= getAjv().getSchema('urn:dsh-personal:project-control:v1alpha1:approval-card-submission')!
  return submissionValidator
}

function getStateValidator(): ValidateFunction<unknown> {
  stateValidator ??= getAjv().getSchema('urn:dsh-personal:project-control:v1alpha1:approval-card-state')!
  return stateValidator
}

function getActionCommandValidator(): ValidateFunction<unknown> {
  actionCommandValidator ??= getAjv().getSchema('urn:dsh-personal:project-control:v1alpha1:approval-action-command')!
  return actionCommandValidator
}

function getActionResultValidator(): ValidateFunction<unknown> {
  actionResultValidator ??= getAjv().getSchema('urn:dsh-personal:project-control:v1alpha1:approval-action-result')!
  return actionResultValidator
}

function schemaIssues(validate: ValidateFunction<unknown>): ApprovalValidationIssue[] {
  return (validate.errors ?? []).slice(0, 20).map((error: ErrorObject) => ({
    code: 'SCHEMA_INVALID',
    path: error.instancePath === '' ? '$' : error.instancePath,
    message: error.message ?? 'schema validation failed',
  }))
}

export function classifyRequiredClass(impact: unknown): ApprovalClass {
  if (!isObject(impact) || !Array.isArray(impact.effect_types)) return 'B'
  const effects = impact.effect_types as unknown[]
  if (effects.some((effect) => CLASS_A_EFFECTS.has(String(effect)))) return 'A'
  if (effects.includes('file.write') && Array.isArray(impact.affected_paths)) {
    const hasSensitivePath = (impact.affected_paths as unknown[]).some(
      (rawPath) => typeof rawPath === 'string' && isSensitivePath(rawPath),
    )
    if (hasSensitivePath) return 'A'
  }
  return 'B'
}

export function validateApprovalCardSubmission(value: unknown): ApprovalValidationResult {
  if (!isObject(value)) return fail('SCHEMA_INVALID', 'Approval card submission must be an object.')

  const forged = HOST_ONLY_FIELDS.filter((field) =>
    Object.prototype.hasOwnProperty.call(value, field),
  )
  if (forged.length > 0) {
    return fail(
      'HOST_FIELD_FORBIDDEN',
      `Submission must not carry Host-authoritative fields: ${forged.join(', ')}.`,
      forged[0],
    )
  }

  const issues: ApprovalValidationIssue[] = []
  collectSubmissionSemanticIssues(value, issues)
  if (issues.length > 0) return failAll(issues)

  const validate = getSubmissionValidator()
  if (!validate(value)) return failAll(schemaIssues(validate))
  return ok(value)
}

export function validateApprovalCardState(value: unknown): ApprovalValidationResult {
  if (!isObject(value)) return fail('SCHEMA_INVALID', 'Approval card state must be an object.')

  const issues: ApprovalValidationIssue[] = []
  collectStateSemanticIssues(value, issues)
  if (issues.length > 0) return failAll(issues)

  const validate = getStateValidator()
  if (!validate(value)) return failAll(schemaIssues(validate))
  return ok(value)
}

export function validateApprovalActionCommand(value: unknown): ApprovalValidationResult {
  if (!isObject(value)) return fail('SCHEMA_INVALID', 'Approval action command must be an object.')

  const issues: ApprovalValidationIssue[] = []
  collectActionCommandSemanticIssues(value, issues)
  if (issues.length > 0) return failAll(issues)

  const validate = getActionCommandValidator()
  if (!validate(value)) return failAll(schemaIssues(validate))
  return ok(value)
}

export function validateApprovalActionResult(value: unknown): ApprovalValidationResult {
  if (!isObject(value)) return fail('SCHEMA_INVALID', 'Approval action result must be an object.')

  const issues: ApprovalValidationIssue[] = []
  collectActionResultSemanticIssues(value, issues)
  if (issues.length > 0) return failAll(issues)

  const validate = getActionResultValidator()
  if (!validate(value)) return failAll(schemaIssues(validate))
  return ok(value)
}

export function validateApprovalAction(
  state: unknown,
  command: unknown,
): ApprovalValidationResult {
  const stateResult = validateApprovalCardState(state)
  if (!stateResult.ok) return stateResult

  const commandResult = validateApprovalActionCommand(command)
  if (!commandResult.ok) return commandResult

  const stateValue = state as Record<string, unknown>
  const commandValue = command as Record<string, unknown>

  if (commandValue.card_id !== stateValue.id) {
    return fail('CARD_ID_MISMATCH', 'Command card_id does not match the state card id.', 'card_id')
  }
  if (commandValue.expected_revision !== stateValue.revision) {
    return fail('REVISION_MISMATCH', 'Command expected_revision does not match state revision.', 'expected_revision')
  }

  const cardType = stateValue.card_type as ApprovalCardType
  const status = stateValue.status as string
  const action = commandValue.action as ApprovalAction

  if (!ACTIONABLE_STATUSES.has(status)) {
    return fail('ACTION_NOT_ALLOWED', `Card status ${status} does not accept actions.`, 'status')
  }

  const allowedActions = CARD_TYPE_ACTIONS[cardType]
  if (!allowedActions.has(action)) {
    return fail(
      'ACTION_NOT_ALLOWED',
      `Action ${action} is not allowed for card_type ${cardType}.`,
      'action',
    )
  }

  if (
    cardType === 'gate_go' &&
    (action === 'approve' || action === 'approve_with_constraints') &&
    !gateChecklistPassed(stateValue.checklist)
  ) {
    return fail(
      'GATE_CHECKLIST_NOT_PASSED',
      'gate_go approve requires a non-empty checklist with every item passed=true.',
      'checklist',
    )
  }

  const optionIssue = validateActionOptionReference(stateValue, commandValue)
  if (optionIssue !== null) return optionIssue

  if (
    stateValue.effective_class === 'A' &&
    (action === 'request_changes' || action === 'reject_with_direction' || action === 'reject_final') &&
    typeof commandValue.reason_text !== 'string'
  ) {
    return fail('ACTION_FIELD_REQUIRED', 'Class A rejections require reason_text.', 'reason_text')
  }

  return ok()
}

function collectSubmissionSemanticIssues(
  value: Record<string, unknown>,
  issues: ApprovalValidationIssue[],
): void {
  collectSizeIssues(value, issues)

  if (typeof value.card_type !== 'string') return

  const cardType = value.card_type as ApprovalCardType
  const impact = value.impact
  if (isObject(impact)) {
    collectImpactIssues(impact, issues)
  }

  const extensions = value.extensions
  if (extensions !== undefined) {
    collectExtensionIssues(extensions, issues)
  }

  collectDuplicateIds(value.options, 'DUPLICATE_OPTION_ID', 'options', issues)
  collectDuplicateIds(value.checklist, 'DUPLICATE_CHECKLIST_ID', 'checklist', issues)

  if (cardType === 'gate_go' && (!Array.isArray(value.checklist) || value.checklist.length === 0)) {
    issues.push({
      code: 'GATE_CHECKLIST_NOT_PASSED',
      path: 'checklist',
      message: 'gate_go cards require a non-empty checklist.',
    })
  }

  if (isObject(value.impact) && Array.isArray(value.impact.effect_types) && value.impact.effect_types.length > 0) {
    const requiredClass = classifyRequiredClass(value.impact)
    if (value.class === 'B' && requiredClass === 'A') {
      issues.push({
        code: 'CLASS_UNDERREPORTED',
        path: 'class',
        message: 'Declared class B is lower than required class A derived from impact.',
      })
    }
  }

  if (cardType === 'fyi_challenge' && typeof value.source_decision_id !== 'string') {
    issues.push({
      code: 'FYI_SOURCE_DECISION_REQUIRED',
      path: 'source_decision_id',
      message: 'fyi_challenge cards must reference the already-made source Decision.',
    })
  }

  if (typeof value.source_decision_id === 'string' && !DECISION_ID_PATTERN.test(value.source_decision_id)) {
    issues.push({
      code: 'INVALID_DECISION_ID',
      path: 'source_decision_id',
      message: `source_decision_id ${value.source_decision_id} is not a dec_<uuidv7> id.`,
    })
  }

  if (isObject(value.routing) && typeof value.routing.proposed_executor === 'string' &&
      !EXECUTOR_IDS.has(value.routing.proposed_executor)) {
    issues.push({
      code: 'UNKNOWN_EXECUTOR',
      path: 'routing/proposed_executor',
      message: `Unknown logical executor_id: ${value.routing.proposed_executor}.`,
    })
  }

  if (cardType === 'decision' || cardType === 'option_pick') {
    if (!Array.isArray(value.options) || value.options.length < 2 || !isObject(value.recommendation)) {
      issues.push({
        code: 'OPTION_REQUIRED',
        path: 'options',
        message: `${cardType} cards require options >= 2 and a recommendation.`,
      })
    } else {
      const optionIds = collectIds(value.options)
      const recommendation = value.recommendation as Record<string, unknown>
      if (typeof recommendation.option_id === 'string' && !optionIds.has(recommendation.option_id)) {
        issues.push({
          code: 'OPTION_NOT_FOUND',
          path: 'recommendation/option_id',
          message: `recommendation.option_id ${recommendation.option_id} is not one of the declared options.`,
        })
      }
    }
  }
}

function collectStateSemanticIssues(
  value: Record<string, unknown>,
  issues: ApprovalValidationIssue[],
): void {
  collectSizeIssues(value, issues)

  if (typeof value.card_type !== 'string') return

  const cardType = value.card_type as ApprovalCardType
  const impact = value.impact
  if (isObject(impact)) {
    collectImpactIssues(impact, issues)
  }

  const extensions = value.extensions
  if (extensions !== undefined) {
    collectExtensionIssues(extensions, issues)
  }

  collectDuplicateIds(value.options, 'DUPLICATE_OPTION_ID', 'options', issues)
  collectDuplicateIds(value.checklist, 'DUPLICATE_CHECKLIST_ID', 'checklist', issues)

  if (cardType === 'gate_go' && (!Array.isArray(value.checklist) || value.checklist.length === 0)) {
    issues.push({
      code: 'GATE_CHECKLIST_NOT_PASSED',
      path: 'checklist',
      message: 'gate_go cards require a non-empty checklist.',
    })
  }

  if (isObject(value.impact) && Array.isArray(value.impact.effect_types) && value.impact.effect_types.length > 0) {
    const requiredClass = classifyRequiredClass(value.impact)
    const declaredClass = value.class
    const effectiveClass = value.effective_class
    const expectedEffective = declaredClass === 'A' || requiredClass === 'A' ? 'A' : 'B'
    if (declaredClass === 'B' && requiredClass === 'A') {
      if (!LOW_CLASS_ALLOWED_STATUSES.has(value.status as string)) {
        issues.push({
          code: 'LOW_CLASS_NOT_REJECTED',
          path: 'status',
          message: 'A card whose declared class is lower than required must be machine_rejected or pending_clarification.',
        })
      }
      if (effectiveClass !== 'A') {
        issues.push({
          code: 'CLASS_UNDERREPORTED',
          path: 'class',
          message: 'Declared class B is lower than required class A; Host must set effective_class A.',
        })
      }
    }
    if (effectiveClass !== expectedEffective) {
      issues.push({
        code: 'EFFECTIVE_CLASS_MISMATCH',
        path: 'effective_class',
        message: `effective_class ${String(effectiveClass)} does not equal max(declared, required) ${expectedEffective}.`,
      })
    }
  }

  if (cardType === 'fyi_challenge') {
    if (typeof value.source_decision_id !== 'string') {
      issues.push({
        code: 'FYI_SOURCE_DECISION_REQUIRED',
        path: 'source_decision_id',
        message: 'fyi_challenge cards must reference the already-made source Decision.',
      })
    }
    if (value.status === 'auto_effective' && value.source_decision_status !== 'accepted') {
      issues.push({
        code: 'AUTO_EFFECTIVE_SOURCE_NOT_ACCEPTED',
        path: 'source_decision_status',
        message: 'auto_effective is only allowed when the source Decision is accepted.',
      })
    }
  }

  if (typeof value.source_decision_id === 'string' && !DECISION_ID_PATTERN.test(value.source_decision_id)) {
    issues.push({
      code: 'INVALID_DECISION_ID',
      path: 'source_decision_id',
      message: `source_decision_id ${value.source_decision_id} is not a dec_<uuidv7> id.`,
    })
  }

  if (value.status === 'auto_effective' && cardType !== 'fyi_challenge') {
    issues.push({
      code: 'AUTO_EFFECTIVE_CARD_TYPE_INVALID',
      path: 'status',
      message: 'Only fyi_challenge cards may reach auto_effective.',
    })
  }

  if (isObject(value.response) && typeof value.response.action === 'string') {
    const expectedAction = STATUS_ACTION_MAP[value.status as string]
    if (expectedAction !== undefined && value.response.action !== expectedAction) {
      issues.push({
        code: 'STATUS_RESPONSE_MISMATCH',
        path: 'response/action',
        message: `Status ${String(value.status)} requires response.action ${expectedAction}.`,
      })
    }
    if (NON_RESPONDED_STATUSES.has(value.status as string)) {
      issues.push({
        code: 'STATUS_RESPONSE_MISMATCH',
        path: 'response',
        message: `Status ${String(value.status)} must not carry a response object.`,
      })
    }
    if (value.response.actor !== CONSOLE_ACTOR) {
      issues.push({
        code: 'ACTOR_NOT_ALLOWED',
        path: 'response/actor',
        message: `response.actor must be ${CONSOLE_ACTOR}.`,
      })
    }
  }

  if (RESPONDED_STATUSES.has(value.status as string) && value.decided_at == null) {
    issues.push({
      code: 'DECIDED_AT_REQUIRED',
      path: 'decided_at',
      message: 'Responded states require a non-null decided_at timestamp.',
    })
  }

  if (
    cardType === 'gate_go' &&
    (value.status === 'approved' || value.status === 'approved_with_constraints') &&
    !gateChecklistPassed(value.checklist)
  ) {
    issues.push({
      code: 'GATE_CHECKLIST_NOT_PASSED',
      path: 'checklist',
      message: 'Approved gate_go cards must have every checklist item passed=true.',
    })
  }

  if (isObject(value.routing) && typeof value.routing.proposed_executor === 'string' &&
      !EXECUTOR_IDS.has(value.routing.proposed_executor)) {
    issues.push({
      code: 'UNKNOWN_EXECUTOR',
      path: 'routing/proposed_executor',
      message: `Unknown logical executor_id: ${value.routing.proposed_executor}.`,
    })
  }

  if (cardType === 'decision' || cardType === 'option_pick') {
    if (!Array.isArray(value.options) || value.options.length < 2 || !isObject(value.recommendation)) {
      issues.push({
        code: 'OPTION_REQUIRED',
        path: 'options',
        message: `${cardType} cards require options >= 2 and a recommendation.`,
      })
    } else {
      const optionIds = collectIds(value.options)
      const recommendation = value.recommendation as Record<string, unknown>
      if (typeof recommendation.option_id === 'string' && !optionIds.has(recommendation.option_id)) {
        issues.push({
          code: 'OPTION_NOT_FOUND',
          path: 'recommendation/option_id',
          message: `recommendation.option_id ${recommendation.option_id} is not one of the declared options.`,
        })
      }
    }
  }
}

function collectActionCommandSemanticIssues(
  value: Record<string, unknown>,
  issues: ApprovalValidationIssue[],
): void {
  collectSizeIssues(value, issues)

  if (value.actor !== CONSOLE_ACTOR) {
    issues.push({
      code: 'ACTOR_NOT_ALLOWED',
      path: 'actor',
      message: `actor must be ${CONSOLE_ACTOR}.`,
    })
  }

  const action = value.action
  if (action === 'approve_with_constraints' && typeof value.constraints_text !== 'string') {
    issues.push({
      code: 'ACTION_FIELD_REQUIRED',
      path: 'constraints_text',
      message: 'approve_with_constraints requires constraints_text.',
    })
  }
  if (action === 'reject_with_direction' &&
      (typeof value.reason_tag !== 'string' || typeof value.direction_text !== 'string')) {
    issues.push({
      code: 'ACTION_FIELD_REQUIRED',
      path: 'reason_tag',
      message: 'reject_with_direction requires reason_tag and direction_text.',
    })
  }
  if (action === 'delegate' && typeof value.delegatee !== 'string') {
    issues.push({
      code: 'ACTION_FIELD_REQUIRED',
      path: 'delegatee',
      message: 'delegate requires delegatee.',
    })
  }
  if (action === 'snooze' && typeof value.snooze_until !== 'string') {
    issues.push({
      code: 'ACTION_FIELD_REQUIRED',
      path: 'snooze_until',
      message: 'snooze requires snooze_until.',
    })
  }
}

function collectActionResultSemanticIssues(
  value: Record<string, unknown>,
  issues: ApprovalValidationIssue[],
): void {
  collectSizeIssues(value, issues)

  if (value.applied === false && (value.status !== undefined || value.revision !== undefined)) {
    issues.push({
      code: 'RESULT_APPLIED_MISMATCH',
      path: 'applied',
      message: 'applied=false results must not carry status or revision.',
    })
  }
  if (value.applied === true && Array.isArray(value.error_codes) && value.error_codes.length > 0) {
    issues.push({
      code: 'RESULT_APPLIED_MISMATCH',
      path: 'error_codes',
      message: 'applied=true results must not carry error_codes.',
    })
  }
}

function validateActionOptionReference(
  state: Record<string, unknown>,
  command: Record<string, unknown>,
): ApprovalValidationResult | null {
  const cardType = state.card_type as ApprovalCardType
  const action = command.action as ApprovalAction
  if ((action !== 'approve' && action !== 'approve_with_constraints') ||
      (cardType !== 'decision' && cardType !== 'option_pick')) {
    return null
  }
  if (typeof command.selected_option_id !== 'string') {
    return fail('OPTION_REQUIRED', `${cardType} ${action} requires selected_option_id.`, 'selected_option_id')
  }
  if (!Array.isArray(state.options)) {
    return fail('OPTION_NOT_FOUND', 'State has no options to select from.', 'selected_option_id')
  }
  const optionIds = collectIds(state.options)
  if (!optionIds.has(command.selected_option_id)) {
    return fail(
      'OPTION_NOT_FOUND',
      `selected_option_id ${command.selected_option_id} is not one of the declared options.`,
      'selected_option_id',
    )
  }
  return null
}

function collectImpactIssues(
  impact: Record<string, unknown>,
  issues: ApprovalValidationIssue[],
): void {
  if (Array.isArray(impact.effect_types)) {
    for (const effect of impact.effect_types) {
      if (typeof effect !== 'string' || !EFFECT_TYPES.has(effect)) {
        issues.push({
          code: 'UNKNOWN_EFFECT_TYPE',
          path: 'impact/effect_types',
          message: `Unknown effect_type: ${String(effect)}.`,
        })
      }
    }
  }

  if (Array.isArray(impact.affected_paths)) {
    for (const rawPath of impact.affected_paths) {
      if (typeof rawPath !== 'string') continue
      const issueCode = pathIssue(rawPath)
      if (issueCode !== null) {
        issues.push({
          code: issueCode,
          path: 'impact/affected_paths',
          message: `Invalid affected path: ${rawPath}.`,
        })
      }
    }
  }
}

function pathIssue(rawPath: string): string | null {
  if (/^[A-Za-z]:[\\/]/.test(rawPath) || /^\\\\/.test(rawPath)) return 'DRIVE_PATH'
  if (/^\//.test(rawPath)) return 'ABSOLUTE_PATH'
  if (/[\\]/.test(rawPath)) return 'PATH_ESCAPE'
  if (/(?:^|\/)\.{1,2}(?:\/|$)/.test(rawPath)) return 'PATH_ESCAPE'
  if (/[\u0000-\u001F\u007F]/.test(rawPath)) return 'PATH_ESCAPE'
  if (/\/\//.test(rawPath)) return 'PATH_ESCAPE'
  return null
}

function collectExtensionIssues(
  extensions: unknown,
  issues: ApprovalValidationIssue[],
): void {
  if (!isObject(extensions)) return
  const keys = Object.keys(extensions)
  if (keys.length > MAX_EXTENSION_PROPERTIES) {
    issues.push({
      code: 'EXTENSION_LIMIT_EXCEEDED',
      path: 'extensions',
      message: `extensions has ${keys.length} properties; max is ${MAX_EXTENSION_PROPERTIES}.`,
    })
  }
  for (const key of keys) {
    if (!REVERSE_DOMAIN_KEY.test(key)) {
      issues.push({
        code: 'EXTENSION_INVALID_KEY',
        path: 'extensions',
        message: `Extension key ${key} is not a reverse-domain name.`,
      })
    }
  }
  if (depthOf(extensions) > MAX_EXTENSION_DEPTH) {
    issues.push({
      code: 'EXTENSION_LIMIT_EXCEEDED',
      path: 'extensions',
      message: `extensions exceeds maximum JSON depth ${MAX_EXTENSION_DEPTH}.`,
    })
  }
  let serializedBytes = 0
  try {
    serializedBytes = Buffer.byteLength(JSON.stringify(extensions), 'utf8')
  } catch {
    serializedBytes = Number.POSITIVE_INFINITY
  }
  if (serializedBytes > MAX_EXTENSION_BYTES) {
    issues.push({
      code: 'EXTENSION_LIMIT_EXCEEDED',
      path: 'extensions',
      message: `extensions exceeds maximum serialized size ${MAX_EXTENSION_BYTES} bytes.`,
    })
  }
}

function collectDuplicateIds(
  items: unknown,
  code: string,
  path: string,
  issues: ApprovalValidationIssue[],
): void {
  if (!Array.isArray(items)) return
  const seen = new Set<string>()
  for (const [index, item] of items.entries()) {
    if (!isObject(item) || typeof item.id !== 'string') continue
    if (seen.has(item.id)) {
      issues.push({
        code,
        path: `${path}/${index}/id`,
        message: `Duplicate id ${item.id} at ${path}.`,
      })
    }
    seen.add(item.id)
  }
}

function collectIds(items: unknown[]): Set<string> {
  const ids = new Set<string>()
  for (const item of items) {
    if (isObject(item) && typeof item.id === 'string') ids.add(item.id)
  }
  return ids
}

function gateChecklistPassed(checklist: unknown): boolean {
  return Array.isArray(checklist) &&
    checklist.length > 0 &&
    checklist.every((item) => isObject(item) && item.passed === true)
}

function isSensitivePath(rawPath: string): boolean {
  const normalized = rawPath.replace(/\\/g, '/').replace(/\/+$/, '')
  const segments = normalized.split('/').filter(Boolean)
  const basename = segments.length > 0 ? segments[segments.length - 1] : ''
  if (segments.includes('migrations')) return true
  if (segments[0] === 'protocol') return true
  if (segments.includes('templates')) return true
  if (['package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'npm-shrinkwrap.json'].includes(basename)) {
    return true
  }
  if (segments.some((segment) => ['permissions', 'security', 'auth', 'credentials', 'secrets'].includes(segment))) {
    return true
  }
  if (/\.(pem|key|p12|pfx)$/i.test(basename)) return true
  if (basename === 'cordis.patch.yml' || basename === '.env') return true
  return false
}

function collectSizeIssues(value: unknown, issues: ApprovalValidationIssue[]): void {
  try {
    const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8')
    if (bytes > MAX_CARD_UTF8_BYTES) {
      issues.push({
        code: 'CARD_SIZE_LIMIT_EXCEEDED',
        path: '$',
        message: `Serialized card exceeds ${MAX_CARD_UTF8_BYTES} UTF-8 bytes.`,
      })
    }
  } catch {
    issues.push({
      code: 'CARD_SIZE_LIMIT_EXCEEDED',
      path: '$',
      message: 'Card cannot be serialized for size validation.',
    })
  }
  walkStrings(value, (path, text) => {
    if (Buffer.byteLength(text, 'utf8') > MAX_STRING_UTF8_BYTES) {
      issues.push({
        code: 'STRING_BYTE_LIMIT_EXCEEDED',
        path,
        message: `String at ${path} exceeds ${MAX_STRING_UTF8_BYTES} UTF-8 bytes.`,
      })
    }
  })
}

function walkStrings(
  value: unknown,
  visit: (path: string, text: string) => void,
  path = '$',
): void {
  if (typeof value === 'string') {
    visit(path, value)
    return
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) walkStrings(item, visit, `${path}/${index}`)
    return
  }
  if (isObject(value)) {
    for (const [key, child] of Object.entries(value)) walkStrings(child, visit, `${path}/${key}`)
  }
}

function depthOf(value: unknown): number {
  if (Array.isArray(value)) {
    let max = 1
    for (const item of value) max = Math.max(max, 1 + depthOf(item))
    return max
  }
  if (isObject(value)) {
    let max = 1
    for (const child of Object.values(value)) max = Math.max(max, 1 + depthOf(child))
    return max
  }
  return 1
}
