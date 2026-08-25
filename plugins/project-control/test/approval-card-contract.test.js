import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import {
  classifyRequiredClass,
  validateApprovalAction,
  validateApprovalActionCommand,
  validateApprovalActionResult,
  validateApprovalCardState,
  validateApprovalCardSubmission,
} from '../src/approval-card-validator.ts'

const examplesRoot = fileURLToPath(
  new URL('../../../protocol/project-control/v1alpha1/approval/examples/', import.meta.url),
)

function readJson(relativePath) {
  return JSON.parse(readFileSync(resolve(examplesRoot, relativePath), 'utf8'))
}

function validateForSchema(schemaPath, value) {
  if (schemaPath.includes('approval-card-submission.schema.json')) {
    return validateApprovalCardSubmission(value)
  }
  if (schemaPath.includes('approval-card-state.schema.json')) {
    return validateApprovalCardState(value)
  }
  if (schemaPath.includes('approval-action-command.schema.json')) {
    return validateApprovalActionCommand(value)
  }
  if (schemaPath.includes('approval-action-result.schema.json')) {
    return validateApprovalActionResult(value)
  }
  throw new Error(`Unknown schema path: ${schemaPath}`)
}

function validateIndexFixture(example) {
  const value = readJson(example.fixture)
  if (example.name === 'option-pick-approve-without-option') {
    const state = readJson('./valid/state-queued-option-pick.valid.json')
    return validateApprovalAction(state, value)
  }
  return validateForSchema(example.schema, value)
}

function assertHasCode(result, code) {
  assert.equal(result.ok, false, `expected failure with ${code}`)
  assert.ok(
    result.errors.some((error) => error.code === code),
    `expected error code ${code}; got ${JSON.stringify(result.errors)}`,
  )
}

test('approval-card contract examples index is loadable and complete', () => {
  const index = readJson('./index.json')
  assert.ok(Array.isArray(index.cases))
  assert.ok(index.cases.length >= 22)
})

test('every valid approval-card example passes its validator', () => {
  const index = readJson('./index.json')
  for (const example of index.cases.filter((item) => item.expectedAccepted)) {
    const result = validateIndexFixture(example)
    assert.equal(result.ok, true, `${example.name} should pass: ${JSON.stringify(result)}`)
  }
})

test('every invalid approval-card example fails with its expected stable error code', () => {
  const index = readJson('./index.json')
  for (const example of index.cases.filter((item) => !item.expectedAccepted)) {
    const result = validateIndexFixture(example)
    assertHasCode(result, example.expectedErrorCode)
  }
})

test('each legal card_type has a minimal valid submission', () => {
  for (const cardType of ['decision', 'fyi_challenge', 'option_pick', 'gate_go']) {
    const fixtureName = {
      decision: './valid/decision-minimal.valid.json',
      fyi_challenge: './valid/fyi-challenge-minimal.valid.json',
      option_pick: './valid/option-pick-minimal.valid.json',
      gate_go: './valid/gate-go-minimal.valid.json',
    }[cardType]
    const result = validateApprovalCardSubmission(readJson(fixtureName))
    assert.equal(result.ok, true, `${cardType} minimal submission should pass`)
    assert.equal(readJson(fixtureName).card_type, cardType)
  }
})

test('external submission cannot forge Host fields', () => {
  const result = validateApprovalCardSubmission(
    readJson('./invalid/forged-host-fields.invalid.json'),
  )
  assertHasCode(result, 'HOST_FIELD_FORBIDDEN')
})

test('unknown effect types are rejected', () => {
  const result = validateApprovalCardSubmission(readJson('./invalid/unknown-effect.invalid.json'))
  assertHasCode(result, 'UNKNOWN_EFFECT_TYPE')
})

test('absolute paths and drive paths are rejected', () => {
  assertHasCode(
    validateApprovalCardSubmission(readJson('./invalid/absolute-path.invalid.json')),
    'ABSOLUTE_PATH',
  )
  assertHasCode(
    validateApprovalCardSubmission(readJson('./invalid/drive-path.invalid.json')),
    'DRIVE_PATH',
  )
})

test('extension invalid keys and depth/size limits are rejected', () => {
  assertHasCode(
    validateApprovalCardSubmission(readJson('./invalid/extension-invalid-key.invalid.json')),
    'EXTENSION_INVALID_KEY',
  )
  assertHasCode(
    validateApprovalCardSubmission(readJson('./invalid/extension-depth.invalid.json')),
    'EXTENSION_LIMIT_EXCEEDED',
  )
})

test('declared class lower than required class is rejected', () => {
  const result = validateApprovalCardSubmission(readJson('./invalid/class-underreport.invalid.json'))
  assertHasCode(result, 'CLASS_UNDERREPORTED')
})

test('fyi_challenge without source Decision is rejected', () => {
  const result = validateApprovalCardSubmission(
    readJson('./invalid/fyi-missing-source-decision.invalid.json'),
  )
  assertHasCode(result, 'FYI_SOURCE_DECISION_REQUIRED')
})

test('option_pick approve without selected_option_id is rejected', () => {
  const state = readJson('./valid/state-queued-option-pick.valid.json')
  const command = readJson('./invalid/option-pick-approve-without-option.invalid.json')
  const result = validateApprovalAction(state, command)
  assertHasCode(result, 'OPTION_REQUIRED')
})

test('gate_go approve does not require a fake option', () => {
  const state = readJson('./valid/state-queued-gate-go.valid.json')
  const command = readJson('./valid/action-command-gate-go-approve.valid.json')
  const result = validateApprovalAction(state, command)
  assert.equal(result.ok, true, JSON.stringify(result))
})

test('unknown logical executor_id is rejected', () => {
  const result = validateApprovalCardSubmission(readJson('./invalid/unknown-executor.invalid.json'))
  assertHasCode(result, 'UNKNOWN_EXECUTOR')
})

test('auto_effective fyi state requires accepted source Decision', () => {
  const result = validateApprovalCardState(
    readJson('./invalid/state-auto-effective-not-accepted.invalid.json'),
  )
  assertHasCode(result, 'AUTO_EFFECTIVE_SOURCE_NOT_ACCEPTED')
})

test('classifyRequiredClass is deterministic and closed', () => {
  assert.equal(classifyRequiredClass({ effect_types: ['file.write'] }), 'B')
  assert.equal(classifyRequiredClass({ effect_types: ['db.migration'] }), 'A')
  assert.equal(classifyRequiredClass({ effect_types: ['read.only', 'protocol.change'] }), 'A')
  assert.equal(classifyRequiredClass({ effect_types: [] }), 'B')
})

test('action command missing action-specific required fields is rejected', () => {
  const result = validateApprovalActionCommand(
    readJson('./invalid/action-command-reject-without-direction.invalid.json'),
  )
  assertHasCode(result, 'ACTION_FIELD_REQUIRED')
})

test('gate_go approve requires a non-empty checklist with all passed=true', () => {
  const state = readJson('./valid/state-queued-gate-go.valid.json')
  const command = readJson('./valid/action-command-gate-go-approve.valid.json')
  assertHasCode(
    validateApprovalAction({ ...state, checklist: [] }, command),
    'GATE_CHECKLIST_NOT_PASSED',
  )
  assertHasCode(
    validateApprovalAction(
      { ...state, checklist: [{ ...state.checklist[0], passed: false }] },
      command,
    ),
    'GATE_CHECKLIST_NOT_PASSED',
  )
})

test('approved state cannot carry a reject response', () => {
  const state = readJson('./valid/state-queued-decision.valid.json')
  const bad = {
    ...state,
    status: 'approved',
    response: {
      action: 'reject_final',
      responded_at: '2026-08-23T10:00:00.000Z',
      actor: 'CONSOLE_ACTOR',
    },
  }
  assertHasCode(validateApprovalCardState(bad), 'STATUS_RESPONSE_MISMATCH')
})

test('non-FYI cards cannot be auto_effective', () => {
  const state = readJson('./valid/state-queued-decision.valid.json')
  assertHasCode(
    validateApprovalCardState({ ...state, status: 'auto_effective', decided_at: '2026-08-23T10:00:00.000Z' }),
    'AUTO_EFFECTIVE_CARD_TYPE_INVALID',
  )
})

test('low-reported class cannot remain queued in Host state', () => {
  const state = readJson('./valid/state-queued-decision.valid.json')
  const bad = {
    ...state,
    class: 'B',
    effective_class: 'A',
    impact: {
      affected_paths: ['plugins/project-control/migrations/0010_approval_queue.sql'],
      effect_types: ['db.migration'],
    },
    status: 'queued',
  }
  assertHasCode(validateApprovalCardState(bad), 'LOW_CLASS_NOT_REJECTED')
})

test('options containing null return a stable error instead of throwing', () => {
  const value = readJson('./valid/option-pick-minimal.valid.json')
  value.options = [null, value.options[1]]
  let result
  assert.doesNotThrow(() => {
    result = validateApprovalCardSubmission(value)
  })
  assert.equal(result.ok, false)
})

test('duplicate option and checklist IDs are rejected', () => {
  const optionPick = readJson('./valid/option-pick-minimal.valid.json')
  const dupOptions = {
    ...optionPick,
    options: [
      { ...optionPick.options[0], id: 'dup' },
      { ...optionPick.options[1], id: 'dup' },
    ],
  }
  assertHasCode(validateApprovalCardSubmission(dupOptions), 'DUPLICATE_OPTION_ID')

  const gate = readJson('./valid/gate-go-minimal.valid.json')
  const dupChecklist = {
    ...gate,
    checklist: [
      { ...gate.checklist[0], id: 'dup' },
      { ...gate.checklist[1], id: 'dup' },
    ],
  }
  assertHasCode(validateApprovalCardSubmission(dupChecklist), 'DUPLICATE_CHECKLIST_ID')
})

test('file.write on migration/protocol sensitive paths raises required class to A', () => {
  const value = readJson('./valid/decision-minimal.valid.json')
  value.class = 'B'
  value.impact = {
    affected_paths: ['plugins/project-control/migrations/0010_approval_queue.sql'],
    effect_types: ['file.write'],
  }
  assertHasCode(validateApprovalCardSubmission(value), 'CLASS_UNDERREPORTED')
})

test('whole card and single multibyte string byte limits are enforced', () => {
  const command = readJson('./valid/action-command-approve-option.valid.json')
  command.reason_text = '汉'.repeat(3000)
  assertHasCode(validateApprovalActionCommand(command), 'STRING_BYTE_LIMIT_EXCEEDED')

  const submission = readJson('./valid/decision-minimal.valid.json')
  submission.evidence = Array.from({ length: 64 }, (_, index) => `evidence-${index}-${'a'.repeat(1000)}`)
  assertHasCode(validateApprovalCardSubmission(submission), 'CARD_SIZE_LIMIT_EXCEEDED')
})

test('actor must be CONSOLE_ACTOR', () => {
  const command = readJson('./valid/action-command-approve-option.valid.json')
  command.actor = 'EVIL_ACTOR'
  assertHasCode(validateApprovalActionCommand(command), 'ACTOR_NOT_ALLOWED')
})

test('source_decision_id must use dec_<uuidv7> format', () => {
  const value = readJson('./valid/fyi-challenge-minimal.valid.json')
  value.source_decision_id = 'not-a-decision-id'
  assertHasCode(validateApprovalCardSubmission(value), 'INVALID_DECISION_ID')
})

test('applied=false result cannot carry success status/revision', () => {
  const result = readJson('./valid/action-result-rejected.valid.json')
  result.status = 'approved'
  result.revision = 2
  assertHasCode(validateApprovalActionResult(result), 'RESULT_APPLIED_MISMATCH')
})

test('responded states require a non-null decided_at', () => {
  const state = readJson('./valid/state-queued-decision.valid.json')
  const bad = {
    ...state,
    status: 'approved',
    decided_at: null,
    response: {
      action: 'approve',
      selected_option_id: 'opt_weekly',
      responded_at: '2026-08-23T10:00:00.000Z',
      actor: 'CONSOLE_ACTOR',
    },
  }
  assertHasCode(validateApprovalCardState(bad), 'DECIDED_AT_REQUIRED')
})
