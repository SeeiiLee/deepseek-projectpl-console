import { readFileSync } from 'node:fs'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { runtimeSchemaPath } from './runtime-schema.ts'

export const PROJECT_HOME_SCHEMA_VERSION = 'project-home/v1' as const
export const PROJECT_HOME_MARKER_PATH = '.project-home/project-home.json' as const
export const PROJECT_HOME_WORKSPACE_PATH = 'workspace' as const
export const PROJECT_HOME_MANIFEST_PATH = 'workspace/.dsh-project/project.yaml' as const
export const PROJECT_HOME_ZONES = Object.freeze({
  workspace: 'workspace',
  worktrees: 'worktrees',
  local: 'local',
})

const PROJECT_ID = /^prj_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const PROJECT_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,118}[a-z0-9])?$/u

const SCHEMA_PATH = runtimeSchemaPath('projectHome')

export class ProjectHomeContractError extends Error {
  code: string
  details?: unknown

  constructor(code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'ProjectHomeContractError'
    this.code = code
    if (details !== undefined) this.details = details
  }
}

let markerValidator: ReturnType<Ajv2020['compile']> | undefined

function validator(): ReturnType<Ajv2020['compile']> {
  if (markerValidator !== undefined) return markerValidator
  const ajv = new Ajv2020({ allErrors: true, strict: true })
  addFormats(ajv)
  markerValidator = ajv.compile(JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')))
  return markerValidator
}

export interface ProjectHomeMarker {
  schemaVersion: typeof PROJECT_HOME_SCHEMA_VERSION
  projectId: string
  slug: string
  zones: typeof PROJECT_HOME_ZONES
  createdAt: string
  bootstrap?: Record<string, unknown>
}

export function validateProjectHomeMarker(value: unknown): {
  valid: boolean
  errors: Array<{ path: string; keyword: string }>
} {
  const validate = validator()
  const valid = validate(value) === true
  return {
    valid,
    errors: valid
      ? []
      : (validate.errors ?? []).slice(0, 20).map(error => ({
          path: error.instancePath,
          keyword: error.keyword,
        })),
  }
}

export function createProjectHomeMarker(input: {
  projectId: string
  slug: string
  createdAt: string
}): Readonly<ProjectHomeMarker> {
  if (!PROJECT_ID.test(input?.projectId ?? '')) {
    throw new ProjectHomeContractError('PROJECT_ID_INVALID', 'Project Home projectId must be a Project Control UUIDv7.')
  }
  if (!PROJECT_SLUG.test(input?.slug ?? '')) {
    throw new ProjectHomeContractError('PROJECT_SLUG_INVALID', 'Project Home slug must be stable ASCII kebab-case.')
  }
  const marker = {
    schemaVersion: PROJECT_HOME_SCHEMA_VERSION,
    projectId: input.projectId,
    slug: input.slug,
    zones: PROJECT_HOME_ZONES,
    createdAt: input.createdAt,
  }
  const result = validateProjectHomeMarker(marker)
  if (!result.valid) {
    throw new ProjectHomeContractError('PROJECT_HOME_MARKER_INVALID', 'Host-created Project Home marker failed its schema.', {
      errors: result.errors,
    })
  }
  return Object.freeze(marker)
}

export function validateProjectHomeIdentity(
  marker: unknown,
  manifest: unknown,
): true {
  const markerResult = validateProjectHomeMarker(marker)
  if (!markerResult.valid) {
    throw new ProjectHomeContractError('PROJECT_HOME_MARKER_INVALID', 'Project Home marker is invalid.', {
      errors: markerResult.errors,
    })
  }
  const markerProjectId = (marker as { projectId?: unknown }).projectId
  const manifestProjectId = (manifest as { metadata?: { projectId?: unknown } })?.metadata?.projectId
  if (markerProjectId !== manifestProjectId) {
    throw new ProjectHomeContractError('PROJECT_ID_MISMATCH', 'Project Home marker and workspace manifest disagree on projectId.', {
      markerProjectId,
      manifestProjectId,
    })
  }
  return true
}

export function isProjectHomeSlug(value: unknown): value is string {
  return typeof value === 'string' && PROJECT_SLUG.test(value)
}
