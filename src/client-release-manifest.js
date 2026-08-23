// src/client-release-manifest.js — A3 客户端 release manifest 校验与 plugins-v tag 解析
import { readFileSync } from 'node:fs'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { fileURLToPath } from 'node:url'

const schemaPath = fileURLToPath(new URL('../protocol/client-release-manifest/v1/schemas/client-release-manifest.schema.json', import.meta.url))

export function validateClientReleaseManifest(manifest, { installerSha256 } = {}) {
  const ajv = new Ajv2020({ allErrors: true, strict: true })
  addFormats(ajv)
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'))
  const validate = ajv.compile(schema)
  const issues = []
  if (!validate(manifest)) issues.push(ajv.errorsText(validate.errors))
  if (installerSha256 !== undefined && manifest?.installerSha256 !== installerSha256) {
    issues.push('installerSha256 与安装包不一致')
  }
  return { ok: issues.length === 0, issues }
}

/** plugins-vYYYY.MM.DD.N 独立解析；不兼容客户端 vX.Y.Z 解析器。 */
export function parsePluginsVTag(tag) {
  const match = /^plugins-v(\d{4})\.(\d{2})\.(\d{2})\.(\d+)$/u.exec(tag ?? '')
  if (match === null) return null
  return {
    tag,
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    sequence: Number(match[4]),
  }
}
