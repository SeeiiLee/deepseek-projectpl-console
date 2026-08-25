import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

import { canonicalJson } from '../host/canonical-json.js'
import { parseYamlSubset } from '../discovery/runtime.js'
import { validateProjectManifest } from '../manifest-validator.ts'
import {
  PROJECT_HOME_MANIFEST_PATH,
  PROJECT_HOME_MARKER_PATH,
  validateProjectHomeIdentity,
  validateProjectHomeMarker,
} from '../project-home.ts'

/** The registry is bundled into lib/index.js, so import.meta.url differs between
 * source runs (src/templates/registry.js) and built runs (lib/index.js). Resolve
 * against the first candidate that actually carries template.json assets. */
const TEMPLATE_ID = /^[a-z][a-z0-9.-]{1,127}$/
const TEMPLATE_VERSION = /^[0-9]+\.[0-9]+\.[0-9]+$/

function hasTemplateFiles(directory) {
  try {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || !TEMPLATE_ID.test(entry.name)) continue
      for (const version of readdirSync(join(directory, entry.name), { withFileTypes: true })) {
        if (version.isDirectory()
          && TEMPLATE_VERSION.test(version.name)
          && existsSync(join(directory, entry.name, version.name, 'template.json'))) {
          return true
        }
      }
    }
  } catch {
    return false
  }
  return false
}

function existingFile(candidates) {
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return candidates[candidates.length - 1]
}

const TEMPLATE_DIRECTORY_CANDIDATES = [
  fileURLToPath(new URL('../templates/', import.meta.url)),
  fileURLToPath(new URL('../../templates/', import.meta.url)),
]
const TEMPLATES_DIRECTORY = TEMPLATE_DIRECTORY_CANDIDATES.find(hasTemplateFiles)
  ?? TEMPLATE_DIRECTORY_CANDIDATES[TEMPLATE_DIRECTORY_CANDIDATES.length - 1]
const TEMPLATE_SCHEMA_PATH = existingFile([
  fileURLToPath(new URL(
    '../../../protocol/project-control/v1alpha1/templates/schemas/template-manifest.schema.json',
    import.meta.url,
  )),
  fileURLToPath(new URL(
    '../../../../protocol/project-control/v1alpha1/templates/schemas/template-manifest.schema.json',
    import.meta.url,
  )),
])
const LEGACY_PROJECT_MANIFEST_PATH = '.dsh-project/project.yaml'
const COMMON_PLACEHOLDERS = Object.freeze([
  '{{PROJECT_ID}}', '{{PROJECT_NAME}}', '{{CREATED_AT}}', '{{TEMPLATE_ID}}', '{{TEMPLATE_VERSION}}',
])
const PROJECT_HOME_PLACEHOLDERS = Object.freeze([...COMMON_PLACEHOLDERS, '{{PROJECT_SLUG}}'])

export class TemplateRegistryError extends Error {
  constructor(code, message, details) {
    super(message)
    this.name = 'TemplateRegistryError'
    this.code = code
    if (details !== undefined) this.details = details
  }
}

function fail(code, message, details) {
  throw new TemplateRegistryError(code, message, details)
}

let templateValidator

function compileTemplateSchema() {
  const schema = JSON.parse(readFileSync(TEMPLATE_SCHEMA_PATH, 'utf8'))
  const ajv = new Ajv2020({ allErrors: true, strict: true })
  addFormats(ajv)
  return ajv.compile(schema)
}

export function listTemplateVersions() {
  const versions = []
  for (const entry of readdirSync(TEMPLATES_DIRECTORY, { withFileTypes: true })) {
    if (!entry.isDirectory() || !TEMPLATE_ID.test(entry.name)) continue
    for (const versionEntry of readdirSync(join(TEMPLATES_DIRECTORY, entry.name), { withFileTypes: true })) {
      if (!versionEntry.isDirectory() || !TEMPLATE_VERSION.test(versionEntry.name)) continue
      const template = loadTemplate(entry.name, versionEntry.name)
      if (template.layout !== 'project-home') continue
      versions.push(Object.freeze({
        templateId: template.templateId,
        templateVersion: template.templateVersion,
        displayName: template.displayName,
        description: template.description,
        protocolVersion: template.protocolVersion,
        templateHash: template.templateHash,
      }))
    }
  }
  return Object.freeze(versions.sort((left, right) => (
    `${left.templateId}@${left.templateVersion}` < `${right.templateId}@${right.templateVersion}` ? -1 : 1
  )))
}

export function loadTemplate(templateId, templateVersion) {
  if (!TEMPLATE_ID.test(String(templateId ?? '')) || !TEMPLATE_VERSION.test(String(templateVersion ?? ''))) {
    fail('TEMPLATE_NOT_FOUND', '模板身份或版本无效。', { templateId, templateVersion })
  }
  const templatePath = join(TEMPLATES_DIRECTORY, templateId, templateVersion, 'template.json')
  let parsed
  try {
    parsed = JSON.parse(readFileSync(templatePath, 'utf8'))
  } catch (error) {
    fail('TEMPLATE_NOT_FOUND', '模板不存在或不可读。', { templateId, templateVersion, causeCode: error?.code ?? 'UNKNOWN' })
  }
  const validate = templateValidator ??= compileTemplateSchema()
  if (!validate(parsed)) {
    fail('TEMPLATE_INVALID', '模板内容没有通过模板 Schema。', {
      templateId,
      templateVersion,
      errors: (validate.errors ?? []).slice(0, 20).map(error => ({
        path: error.instancePath,
        keyword: error.keyword,
      })),
    })
  }
  return freezeTemplate(parsed)
}

function freezeTemplate(parsed) {
  const files = parsed.files.map((entry) => {
    if (entry.kind === 'directory') {
      return Object.freeze({ kind: 'directory', relativePath: entry.relativePath, content: null })
    }
    return Object.freeze({ kind: 'file', relativePath: entry.relativePath, content: entry.content })
  })
  const layout = detectTemplateLayout(files)
  const manifestPath = layout === 'project-home' ? PROJECT_HOME_MANIFEST_PATH : LEGACY_PROJECT_MANIFEST_PATH
  validateTemplateHostRules(parsed.metadata, files, layout, manifestPath)
  return Object.freeze({
    templateId: parsed.metadata.templateId,
    templateVersion: parsed.metadata.templateVersion,
    displayName: parsed.metadata.displayName,
    description: parsed.metadata.description ?? null,
    protocolVersion: parsed.metadata.protocolVersion,
    layout,
    manifestPath,
    files: Object.freeze(files),
    templateHash: computeTemplateHash(parsed.metadata, files),
  })
}

function detectTemplateLayout(files) {
  const filePaths = new Set(files.filter(entry => entry.kind === 'file').map(entry => entry.relativePath))
  const hasLegacyManifest = filePaths.has(LEGACY_PROJECT_MANIFEST_PATH)
  const hasProjectHomeManifest = filePaths.has(PROJECT_HOME_MANIFEST_PATH)
  const hasProjectHomeMarker = filePaths.has(PROJECT_HOME_MARKER_PATH)
  if (hasProjectHomeMarker && hasProjectHomeManifest && !hasLegacyManifest) return 'project-home'
  if (!hasProjectHomeMarker && !hasProjectHomeManifest && hasLegacyManifest) return 'legacy-workspace'
  fail('TEMPLATE_INVALID', '模板必须完整选择 legacy workspace 或 Project Home 布局，不能混用。')
}

function validateTemplateHostRules(metadata, files, layout, manifestPath) {
  if (metadata.templateId !== undefined && files.length === 0) {
    fail('TEMPLATE_INVALID', '模板不包含任何文件。', { templateId: metadata.templateId })
  }
  const paths = new Set()
  const directorySet = new Set()
  const fileEntries = []
  for (const entry of files) {
    if (paths.has(entry.relativePath)) {
      fail('TEMPLATE_INVALID', '模板包含重复路径。', { relativePath: entry.relativePath })
    }
    paths.add(entry.relativePath)
    if (entry.kind === 'directory') directorySet.add(entry.relativePath)
    else fileEntries.push(entry)
  }
  const requiredDirectories = new Set()
  for (const file of fileEntries) {
    const segments = file.relativePath.split('/')
    for (let length = 1; length < segments.length; length += 1) {
      requiredDirectories.add(segments.slice(0, length).join('/'))
    }
  }
  for (const directory of directorySet) {
    if (!requiredDirectories.has(directory)) {
      fail('TEMPLATE_INVALID', '模板声明了任何文件都不需要的目录。', { relativePath: directory })
    }
  }
  for (const directory of requiredDirectories) {
    if (!directorySet.has(directory)) {
      fail('TEMPLATE_INVALID', '模板缺少文件所需的目录声明。', { relativePath: directory })
    }
  }
  const manifestEntries = fileEntries.filter(entry => entry.relativePath === manifestPath)
  if (manifestEntries.length !== 1) {
    fail('TEMPLATE_INVALID', `模板必须恰好包含一个 ${manifestPath} 文件条目。`)
  }
  const manifestContent = manifestEntries[0].content
  for (const token of COMMON_PLACEHOLDERS) {
    if (!manifestContent.includes(token)) {
      fail('TEMPLATE_INVALID', 'project.yaml 模板必须使用全部五个占位符。', { missing: token })
    }
  }
  if (layout === 'project-home') {
    const markerEntries = fileEntries.filter(entry => entry.relativePath === PROJECT_HOME_MARKER_PATH)
    if (markerEntries.length !== 1) {
      fail('TEMPLATE_INVALID', `Project Home 模板必须恰好包含一个 ${PROJECT_HOME_MARKER_PATH} 文件条目。`)
    }
    for (const token of ['{{PROJECT_ID}}', '{{PROJECT_SLUG}}', '{{CREATED_AT}}']) {
      if (!markerEntries[0].content.includes(token)) {
        fail('TEMPLATE_INVALID', 'Project Home marker 必须使用身份、slug 与创建时间占位符。', { missing: token })
      }
    }
  }
  const placeholders = layout === 'project-home' ? PROJECT_HOME_PLACEHOLDERS : COMMON_PLACEHOLDERS
  for (const entry of fileEntries) {
    const stripped = placeholders.reduce((text, token) => text.split(token).join(''), entry.content)
    if (/\{\{|\}\}/.test(stripped)) {
      fail('TEMPLATE_INVALID', '模板包含未定义的占位符片段。', { relativePath: entry.relativePath })
    }
  }
  for (const entry of files) {
    if (/\{\{|\}\}/.test(entry.relativePath)) {
      fail('TEMPLATE_INVALID', '模板路径不允许包含占位符。', { relativePath: entry.relativePath })
    }
  }
  const totalBytes = fileEntries.reduce((sum, entry) => sum + Buffer.byteLength(entry.content, 'utf8'), 0)
  if (totalBytes > 256 * 1024) fail('TEMPLATE_INVALID', '模板内容超过总字节上限。')
}

export function computeTemplateHash(metadata, files) {
  const input = {
    templateId: metadata.templateId,
    templateVersion: metadata.templateVersion,
    files: files
      .map(entry => entry.kind === 'directory'
        ? { relativePath: entry.relativePath, kind: 'directory' }
        : { relativePath: entry.relativePath, kind: 'file', content: entry.content })
      .sort((left, right) => (left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0)),
  }
  return `sha256:${createHash('sha256').update(canonicalJson(input), 'utf8').digest('hex')}`
}

/** Pure placeholder substitution; unknown tokens or leftover braces are rejected. */
export function renderTemplate(template, params) {
  const values = {
    '{{PROJECT_ID}}': requireParam(params, 'projectId'),
    '{{PROJECT_NAME}}': requireParam(params, 'name'),
    '{{CREATED_AT}}': requireParam(params, 'createdAt'),
    '{{TEMPLATE_ID}}': template.templateId,
    '{{TEMPLATE_VERSION}}': template.templateVersion,
  }
  if (template.layout === 'project-home') values['{{PROJECT_SLUG}}'] = requireParam(params, 'slug')
  const placeholders = template.layout === 'project-home' ? PROJECT_HOME_PLACEHOLDERS : COMMON_PLACEHOLDERS
  const rendered = new Map()
  for (const entry of template.files) {
    if (entry.kind === 'directory') continue
    const content = placeholders.reduce(
      (text, token) => text.split(token).join(values[token]),
      entry.content,
    )
    if (/\{\{|\}\}/.test(content)) {
      fail('TEMPLATE_RENDER_FAILED', '渲染后仍残留占位符片段。', { relativePath: entry.relativePath })
    }
    rendered.set(entry.relativePath, Buffer.from(content, 'utf8'))
  }
  const manifestBytes = rendered.get(template.manifestPath)
  if (manifestBytes === undefined) {
    fail('TEMPLATE_RENDER_FAILED', '渲染结果缺少 project.yaml。', { manifestPath: template.manifestPath })
  }
  const manifestText = manifestBytes.toString('utf8')
  let manifestObject
  try {
    manifestObject = parseYamlSubset(manifestText)
  } catch (error) {
    fail('TEMPLATE_RENDER_FAILED', '渲染后的 project.yaml 无法解析。', { cause: String(error) })
  }
  const validation = validateProjectManifest(manifestObject)
  if (!validation.valid) {
    fail('TEMPLATE_RENDER_FAILED', '渲染后的 project.yaml 没有通过 manifest Schema。', { errors: validation.errors })
  }
  let markerObject = null
  if (template.layout === 'project-home') {
    const markerBytes = rendered.get(PROJECT_HOME_MARKER_PATH)
    if (markerBytes === undefined) {
      fail('TEMPLATE_RENDER_FAILED', '渲染结果缺少 Project Home marker。')
    }
    try {
      markerObject = JSON.parse(markerBytes.toString('utf8'))
    } catch (error) {
      fail('TEMPLATE_RENDER_FAILED', '渲染后的 Project Home marker 无法解析。', { cause: String(error) })
    }
    const markerValidation = validateProjectHomeMarker(markerObject)
    if (!markerValidation.valid) {
      fail('TEMPLATE_RENDER_FAILED', '渲染后的 Project Home marker 没有通过 Schema。', {
        errors: markerValidation.errors,
      })
    }
    try {
      validateProjectHomeIdentity(markerObject, manifestObject)
    } catch (error) {
      fail('TEMPLATE_RENDER_FAILED', 'Project Home marker 与 workspace manifest 身份不一致。', {
        causeCode: error?.code ?? 'UNKNOWN',
      })
    }
    if (markerObject.slug !== params.slug) {
      fail('TEMPLATE_RENDER_FAILED', 'Project Home marker slug 与目标目录不一致。')
    }
  }
  return Object.freeze({ contents: rendered, manifestObject, markerObject })
}

function requireParam(params, field) {
  const value = params?.[field]
  if (typeof value !== 'string' || value.length < 1 || value.length > 2048) {
    fail('TEMPLATE_RENDER_FAILED', `渲染参数 ${field} 无效。`)
  }
  return value
}
