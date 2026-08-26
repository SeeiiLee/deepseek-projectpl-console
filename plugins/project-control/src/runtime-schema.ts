import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const RUNTIME_SCHEMAS = Object.freeze({
  projectManifest: [
    'project-manifest.schema.json',
    '../../../protocol/project-control/v1alpha1/schemas/project-manifest.schema.json',
  ],
  lifecycleCommand: [
    'lifecycle-command-envelope.schema.json',
    '../../../protocol/project-control/v1alpha1/lifecycle/schemas/lifecycle-command-envelope.schema.json',
  ],
  lifecycleResult: [
    'lifecycle-command-result.schema.json',
    '../../../protocol/project-control/v1alpha1/lifecycle/schemas/lifecycle-command-result.schema.json',
  ],
  externalCommand: [
    'external-command-envelope.schema.json',
    '../../../protocol/project-control/v1alpha1/schemas/command-envelope.schema.json',
  ],
  projectHome: [
    'project-home.schema.json',
    '../../../protocol/project-control/v1alpha1/project-home/schemas/project-home.schema.json',
  ],
  templateManifest: [
    'template-manifest.schema.json',
    '../../../protocol/project-control/v1alpha1/templates/schemas/template-manifest.schema.json',
  ],
} as const)

export type RuntimeSchemaName = keyof typeof RUNTIME_SCHEMAS

/** Resolve packaged bytes first, retaining a source-tree fallback for direct tests. */
export function runtimeSchemaPath(name: RuntimeSchemaName): string {
  const [fileName, authorityRelativePath] = RUNTIME_SCHEMAS[name]
  const candidates = [
    fileURLToPath(new URL(`./runtime-schemas/${fileName}`, import.meta.url)),
    fileURLToPath(new URL(authorityRelativePath, import.meta.url)),
  ]
  const found = candidates.find(existsSync)
  if (found !== undefined) return found
  throw new Error(`Project Control runtime Schema is unavailable: ${name}`)
}
