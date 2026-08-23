export declare class TemplateRegistryError extends Error {
  readonly code: string
  readonly details?: Record<string, unknown>
}

export interface TemplateFileEntry {
  readonly kind: 'file' | 'directory'
  readonly relativePath: string
  readonly content: string | null
}

export interface ProjectTemplate {
  readonly templateId: string
  readonly templateVersion: string
  readonly displayName: string
  readonly description: string | null
  readonly protocolVersion: string
  readonly files: ReadonlyArray<TemplateFileEntry>
  readonly templateHash: string
}

export declare function listTemplateVersions(): ReadonlyArray<{
  templateId: string
  templateVersion: string
  displayName: string
  description: string | null
  protocolVersion: string
  templateHash: string
}>

export declare function loadTemplate(templateId: string, templateVersion: string): ProjectTemplate

export declare function renderTemplate(
  template: ProjectTemplate,
  params: { projectId: string; name: string; createdAt: string },
): {
  contents: Map<string, Buffer>
  manifestObject: Record<string, any>
}

export declare function computeTemplateHash(
  metadata: { templateId: string; templateVersion: string },
  files: ReadonlyArray<TemplateFileEntry>,
): string
