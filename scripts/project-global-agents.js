// scripts/project-global-agents.js — Global AGENTS 兼容门禁
// 规范源与写入生命周期已迁到 F:\Projects\toolbox；本文件只提供规范源身份校验，拒绝旧式无 receipt 直写。
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const TOOLBOX_PROJECT_HOME = 'F:\\Projects\\toolbox'
export const TOOLBOX_PROJECT_ID = 'prj_01a037e5-9537-7c20-bf0a-52d8f016d79f'
export const CANONICAL_PATH = resolve(TOOLBOX_PROJECT_HOME, 'workspace', 'global', 'AGENTS.md')

export function validateCanonicalGlobalAgentsSource() {
  const markerPath = resolve(TOOLBOX_PROJECT_HOME, '.project-home', 'project-home.json')
  const manifestPath = resolve(TOOLBOX_PROJECT_HOME, 'workspace', '.dsh-project', 'project.yaml')
  for (const path of [markerPath, manifestPath, CANONICAL_PATH]) {
    if (!existsSync(path)) throw new Error(`TOOLBOX_GLOBAL_AGENTS_AUTHORITY_MISSING:${path}`)
  }
  const marker = JSON.parse(readFileSync(markerPath, 'utf8'))
  const manifestId = /^\s*projectId:\s*(prj_[0-9a-f-]+)\s*$/mu.exec(readFileSync(manifestPath, 'utf8'))?.[1]
  if (marker.projectId !== TOOLBOX_PROJECT_ID || manifestId !== TOOLBOX_PROJECT_ID || marker.slug !== 'toolbox') {
    throw new Error('TOOLBOX_GLOBAL_AGENTS_IDENTITY_CONFLICT')
  }
  return { canonicalPath: CANONICAL_PATH, projectId: TOOLBOX_PROJECT_ID, markerPath, manifestPath }
}

export function projectGlobalAgents() {
  validateCanonicalGlobalAgentsSource()
  throw new Error('TOOLBOX_PROJECTION_REQUIRED: use F:\\Projects\\toolbox\\workspace\\scripts\\toolbox.mjs plan/apply/doctor so every write has a precondition, receipt and rollback')
}

if (process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === new URL(import.meta.url).href) {
  try {
    projectGlobalAgents()
  } catch (error) {
    process.stderr.write(`${String(error?.message ?? error)}\n`)
    process.exit(2)
  }
}
