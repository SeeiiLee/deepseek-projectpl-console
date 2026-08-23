// src/plugin-index.js — A3 消费侧 plugin-index 校验与本地 fixture 读取
import { readFileSync } from 'node:fs'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { fileURLToPath } from 'node:url'

const schemaPath = fileURLToPath(new URL('../protocol/plugin-index/v1/schemas/plugin-index.schema.json', import.meta.url))

export function validatePluginIndex(index) {
  const ajv = new Ajv2020({ allErrors: true, strict: true })
  addFormats(ajv)
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'))
  const validate = ajv.compile(schema)
  if (!validate(index)) return { ok: false, issues: [ajv.errorsText(validate.errors)] }
  return { ok: true, issues: [] }
}

export function readLocalPluginIndex(path) {
  const raw = readFileSync(path, 'utf8')
  let index
  try {
    index = JSON.parse(raw)
  } catch (error) {
    return { ok: false, issues: [`plugin-index.json 解析失败: ${error.message}`], index: null }
  }
  const validation = validatePluginIndex(index)
  if (!validation.ok) return { ...validation, index: null }
  return { ...validation, index }
}
