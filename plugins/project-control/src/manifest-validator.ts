import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { AnySchema, ErrorObject, ValidateFunction } from 'ajv'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

const MANIFEST_SCHEMA_PATH = fileURLToPath(new URL(
  '../../../protocol/project-control/v1alpha1/schemas/project-manifest.schema.json',
  import.meta.url,
))

export interface ProjectManifestValidationIssue {
  field: string
  reason: string
}

let manifestValidator: ValidateFunction<unknown> | undefined

export function validateProjectManifest(value: unknown): {
  valid: boolean
  errors: ProjectManifestValidationIssue[]
} {
  let validate: ValidateFunction<unknown>
  try {
    validate = manifestValidator ??= compileManifestSchema()
  } catch {
    return { valid: false, errors: [{ field: '$', reason: 'schema_unavailable' }] }
  }
  const valid = validate(value)
  const errors = valid ? [] : (validate.errors ?? []).slice(0, 20).map(publicIssue)
  if (valid) {
    const entries = (value as { spec?: { documents?: { entries?: unknown[] } } })
      .spec?.documents?.entries
    const identities = new Set<string>()
    for (const [index, raw] of (entries ?? []).entries()) {
      const entry = raw as { role?: unknown; path?: unknown }
      const identity = `${String(entry.role)}\u0000${String(entry.path).toLocaleLowerCase('en-US')}`
      if (identities.has(identity)) {
        errors.push({ field: `/spec/documents/entries/${String(index)}`, reason: 'duplicate_role_path' })
      }
      identities.add(identity)
    }
  }
  return { valid: errors.length === 0, errors }
}

function compileManifestSchema(): ValidateFunction<unknown> {
  const schema = JSON.parse(readFileSync(MANIFEST_SCHEMA_PATH, 'utf8')) as AnySchema
  const ajv = new Ajv2020({ allErrors: true, strict: true })
  addFormats(ajv)
  return ajv.compile(schema)
}

function publicIssue(error: ErrorObject): ProjectManifestValidationIssue {
  return {
    field: error.instancePath === '' ? '$' : error.instancePath,
    reason: error.keyword,
  }
}
