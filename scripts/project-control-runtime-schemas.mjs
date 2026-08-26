import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

export const PROJECT_CONTROL_RUNTIME_SCHEMAS = Object.freeze([
  ['project-manifest.schema.json', 'protocol/project-control/v1alpha1/schemas/project-manifest.schema.json'],
  ['lifecycle-command-envelope.schema.json', 'protocol/project-control/v1alpha1/lifecycle/schemas/lifecycle-command-envelope.schema.json'],
  ['lifecycle-command-result.schema.json', 'protocol/project-control/v1alpha1/lifecycle/schemas/lifecycle-command-result.schema.json'],
  ['external-command-envelope.schema.json', 'protocol/project-control/v1alpha1/schemas/command-envelope.schema.json'],
  ['project-home.schema.json', 'protocol/project-control/v1alpha1/project-home/schemas/project-home.schema.json'],
  ['template-manifest.schema.json', 'protocol/project-control/v1alpha1/templates/schemas/template-manifest.schema.json'],
])

/** Copy the canonical protocol Schemas into the Project Control runtime package. */
export function stageProjectControlRuntimeSchemas(repositoryRoot) {
  const root = resolve(repositoryRoot)
  const outputDirectory = join(root, 'plugins', 'project-control', 'lib', 'runtime-schemas')
  mkdirSync(outputDirectory, { recursive: true })
  for (const [fileName, authorityRelativePath] of PROJECT_CONTROL_RUNTIME_SCHEMAS) {
    const source = join(root, ...authorityRelativePath.split('/'))
    if (!existsSync(source)) throw new Error(`Project Control runtime Schema authority is missing: ${source}`)
    // Parse before copying so malformed authority bytes fail the build, not Stable startup.
    JSON.parse(readFileSync(source, 'utf8'))
    copyFileSync(source, join(outputDirectory, fileName))
  }
  return outputDirectory
}
