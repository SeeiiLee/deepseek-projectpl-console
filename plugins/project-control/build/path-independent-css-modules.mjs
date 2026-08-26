import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const CSS_VIRTUAL_PREFIX = '\0dsh-project-control-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'
const TYPES_MARKER = `${sep}lib${sep}types${sep}`
const packageRoot = fileURLToPath(new URL('..', import.meta.url))

// Project Control consumes the same compiler as the shared Harness preset, but
// keeps the dependency anchored to that preset rather than adding a second copy.
const requireFromHarnessClient = createRequire(
  new URL('../../../harness-src/packages/client/tsdown.client.ts', import.meta.url),
)
const { transform } = requireFromHarnessClient('lightningcss')

function sourceAssetPath(source, importer) {
  const emitted = resolve(dirname(importer), source)
  if (existsSync(emitted)) return emitted
  const boundary = emitted.indexOf(TYPES_MARKER)
  if (boundary < 0) return emitted
  return resolve(emitted.slice(0, boundary), 'src', emitted.slice(boundary + TYPES_MARKER.length))
}

export function portableStylesheetPath(root, fileId) {
  const normalizedRoot = resolve(root)
  const normalizedFile = resolve(fileId)
  const local = relative(normalizedRoot, normalizedFile)
  if (local === '' || local.startsWith(`..${sep}`) || local === '..' || isAbsolute(local)) {
    throw new Error(`Project Control stylesheet escapes its package root: ${normalizedFile}`)
  }
  return local.split(sep).join('/')
}

function styleInjectionModule(id, logicalFileId, css, classMap) {
  const source = [
    `const css = ${JSON.stringify(css)};`,
    `const tagId = ${JSON.stringify(`${id}/${basename(logicalFileId)}`)};`,
    'if (typeof document !== \'undefined\' && document.querySelector(\'style[data-plugin-css=\' + JSON.stringify(tagId) + \']\') === null) {',
    '  const tag = document.createElement(\'style\');',
    `  tag.dataset.plugin = ${JSON.stringify(id)};`,
    '  tag.dataset.pluginCss = tagId;',
    '  tag.textContent = css;',
    '  document.head.appendChild(tag);',
    '}',
    `export default ${JSON.stringify(classMap)};`,
  ]
  return source.join('\n')
}

/**
 * Project-local replacement for the shared CSS Modules fallback. Physical
 * paths remain watch/read targets only; every byte that reaches lightningcss
 * or Rolldown uses a package-relative logical identity.
 */
export function pathIndependentCssModulesPlugin(
  id,
  { root = packageRoot } = {},
) {
  const physicalByVirtualId = new Map()
  return {
    name: 'dsh-css-modules-inline',
    resolveId(source, importer) {
      if (!source.endsWith('.module.css')) return null
      const physical = importer === undefined ? resolve(root, source) : sourceAssetPath(source, importer)
      const logical = portableStylesheetPath(root, physical)
      const virtualId = `${CSS_VIRTUAL_PREFIX}${logical}${CSS_VIRTUAL_SUFFIX}`
      const prior = physicalByVirtualId.get(virtualId)
      if (prior !== undefined && prior !== physical) {
        throw new Error(`Project Control stylesheet identity collision: ${logical}`)
      }
      physicalByVirtualId.set(virtualId, physical)
      return virtualId
    },
    async load(virtualId) {
      if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
      const physical = physicalByVirtualId.get(virtualId)
      if (physical === undefined) {
        throw new Error(`Project Control stylesheet was not resolved before load: ${virtualId}`)
      }
      const logical = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
      this.addWatchFile(physical)
      const source = await readFile(physical)
      const { code, exports: cssExports } = transform({
        filename: logical,
        code: source,
        cssModules: { pattern: '[hash]_[local]' },
        minify: true,
      })
      const classMap = {}
      const exportEntries = Object.entries(cssExports ?? {})
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      for (const [local, exp] of exportEntries) classMap[local] = exp.name
      return styleInjectionModule(id, logical, code.toString(), classMap)
    },
  }
}
