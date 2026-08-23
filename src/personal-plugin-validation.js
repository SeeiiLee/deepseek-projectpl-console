// src/personal-plugin-validation.js — 随包分发的插件 generation 校验模块（A1）
// 运行时校验唯一权威；scripts/verify-launch.js 只复用本模块，不维护第二套标准。
// 校验只读，不执行构建/测试/联网/模型。
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

export const EXTERNAL_PLUGIN_WHITELIST = Object.freeze([
  '@cyrus/dsh-anysearch',
  '@cyrus/dsh-trajectory-island',
])

export const BATCH_SCHEMA_VERSION = 1
export const INSTALL_SCHEMA_VERSION = 1

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/** 解析外部插件根目录：显式 env 优先，否则 userData/plugins-external。 */
export function resolveExternalRoot({ env = process.env, userData } = {}) {
  const explicit = env.DSH_PERSONAL_PLUGINS_EXTERNAL
  if (explicit !== undefined && explicit !== '') return resolve(explicit)
  if (userData !== undefined && userData !== '') return join(resolve(userData), 'plugins-external')
  return null
}

/**
 * Move a failed or interrupted candidate generation into quarantine and write
 * a diagnostic receipt. The source generation is renamed, never deleted.
 */
export function quarantineGeneration(externalRoot, generationId, reason, extra = {}) {
  const source = join(externalRoot, 'generations', generationId)
  const quarantineRoot = join(externalRoot, 'quarantine')
  mkdirSync(quarantineRoot, { recursive: true })
  let target = join(quarantineRoot, generationId)
  if (existsSync(target)) target = `${target}-${Date.now()}`
  if (existsSync(source)) {
    renameSync(source, target)
  } else {
    mkdirSync(target, { recursive: true })
  }
  writeFileSync(join(target, 'failure.json'), JSON.stringify({
    schemaVersion: 1,
    candidateId: generationId,
    reason,
    detectedAt: new Date().toISOString(),
    ...extra,
  }, null, 2) + '\n')
  return target
}

/**
 * 归一化崩溃残留：activating.json 存在即视为上次激活可能未完成。
 * 若 current 已经指向 candidate，则视为提交后残留并清理；否则把 candidate
 * 移入 quarantine、写回执，并回到 current（由调用方随后物化 junction）。
 */
export function normalizeExternalState(externalRoot) {
  if (externalRoot === null || externalRoot === undefined) return
  const activatingPath = join(externalRoot, 'activating.json')
  if (!existsSync(activatingPath)) return
  let activating
  try {
    activating = readJson(activatingPath)
  } catch {
    rmSync(activatingPath, { force: true })
    rmSync(join(externalRoot, 'pending.json'), { force: true })
    return
  }
  const candidateId = activating?.candidateId
  const current = loadCurrentGeneration(externalRoot)?.generationId ?? null
  if (typeof candidateId === 'string' && candidateId.length > 0 && candidateId === current) {
    rmSync(activatingPath, { force: true })
    rmSync(join(externalRoot, 'pending.json'), { force: true })
    return
  }
  if (typeof candidateId === 'string' && candidateId.length > 0) {
    quarantineGeneration(externalRoot, candidateId, 'activating-crash-residue', {
      fallbackId: activating?.fallbackId ?? null,
      startedAt: activating?.startedAt ?? null,
    })
  }
  rmSync(activatingPath, { force: true })
  rmSync(join(externalRoot, 'pending.json'), { force: true })
}

function sha256File(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

/**
 * 校验 .install.json 与解包实体内容一致。
 * @param {string} installPath - <package>/<version>/.install.json
 * @param {string} packageDir - <package>/<version> 实体目录
 */
export function validateInstallManifest(installPath, packageDir) {
  const issues = []
  if (!existsSync(installPath)) return { ok: false, issues: [`.install.json 缺失: ${installPath}`] }
  let manifest
  try {
    manifest = readJson(installPath)
  } catch (error) {
    return { ok: false, issues: [`.install.json 解析失败: ${error.message}`] }
  }
  if (manifest.schemaVersion !== INSTALL_SCHEMA_VERSION) issues.push(`.install.json schemaVersion 未知: ${manifest.schemaVersion}`)
  if (typeof manifest.packageName !== 'string' || manifest.packageName.length === 0) issues.push('.install.json 缺 packageName')
  if (typeof manifest.version !== 'string' || manifest.version.length === 0) issues.push('.install.json 缺 version')
  if (!/^[0-9a-f]{64}$/u.test(manifest.tgzSha256 ?? '')) issues.push('.install.json tgzSha256 非法')
  if (typeof manifest.minClient !== 'string' || manifest.minClient.length === 0) issues.push('.install.json 缺 minClient')
  if (typeof manifest.harnessCommit !== 'string' || !/^[0-9a-f]{40}$/u.test(manifest.harnessCommit)) issues.push('.install.json harnessCommit 非法')
  if (typeof manifest.pluginContractVersion !== 'string' || manifest.pluginContractVersion.length === 0) {
    issues.push('.install.json 缺 pluginContractVersion')
  }
  if (!Array.isArray(manifest.seams)) issues.push('.install.json 缺 seams')
  if (!manifest.files || typeof manifest.files !== 'object') {
    issues.push('.install.json 缺 files 哈希表')
  } else {
    for (const [file, expected] of Object.entries(manifest.files)) {
      if (!/^[0-9a-f]{64}$/u.test(expected)) {
        issues.push(`${file} 的哈希非法`)
        continue
      }
      const abs = join(packageDir, ...file.split('/'))
      if (!existsSync(abs)) {
        issues.push(`实体缺少文件 ${file}`)
        continue
      }
      const actual = sha256File(abs)
      if (actual !== expected) issues.push(`${file} 哈希不符`)
    }
  }
  return { ok: issues.length === 0, issues }
}

/**
 * 校验 batch.json：generation 内 18 包集合的解析结果。
 * @param {string} batchPath
 * @param {object} options
 * @param {Map<string,string>} [options.directoryByPackage] - 包名 -> directoryName 随包映射
 */
export function validateBatch(batchPath, { directoryByPackage = new Map() } = {}) {
  const issues = []
  if (!existsSync(batchPath)) return { ok: false, issues: [`batch.json 缺失: ${batchPath}`] }
  let batch
  try {
    batch = readJson(batchPath)
  } catch (error) {
    return { ok: false, issues: [`batch.json 解析失败: ${error.message}`] }
  }
  if (batch.schemaVersion !== BATCH_SCHEMA_VERSION) issues.push(`batch.json schemaVersion 未知: ${batch.schemaVersion}`)
  if (typeof batch.generationId !== 'string' || batch.generationId.length === 0) issues.push('batch.json 缺 generationId')
  if (!batch.harness || batch.harness.commit !== 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e') {
    issues.push('batch.json 不是 rc.2/b150a551 基线')
  }
  if (!batch.packages || typeof batch.packages !== 'object') {
    issues.push('batch.json 缺 packages')
  } else {
    for (const [name, info] of Object.entries(batch.packages)) {
      if (!EXTERNAL_PLUGIN_WHITELIST.includes(name) && info.source !== 'builtin') {
        issues.push(`未允许的外部插件 ${name} 进入 generation`)
      }
      if (!['external', 'builtin'].includes(info?.source)) issues.push(`${name} source 非法`)
      if (info.source === 'external') {
        if (typeof info.directoryName !== 'string' || info.directoryName.length === 0) issues.push(`${name} 缺 directoryName`)
        if (directoryByPackage.size > 0 && directoryByPackage.get(name) !== info.directoryName) {
          issues.push(`${name} directoryName 与随包常量不一致`)
        }
      }
    }
  }
  return { ok: issues.length === 0, issues }
}

/**
 * 校验一个 generation 目录：batch.json、外部包实体、.install.json、文件哈希。
 * @param {string} generationDir
 * @param {object} [options]
 */
export function validateGeneration(generationDir, options = {}) {
  const issues = []
  const batchResult = validateBatch(join(generationDir, 'batch.json'), options)
  if (!batchResult.ok) issues.push(...batchResult.issues)
  const batchPath = join(generationDir, 'batch.json')
  if (existsSync(batchPath)) {
    let batch
    try { batch = readJson(batchPath) } catch { batch = null }
    for (const [name, info] of Object.entries(batch?.packages ?? {})) {
      if (info.source !== 'external') continue
      const packageDir = join(generationDir, 'packages', info.directoryName, info.version)
      const installResult = validateInstallManifest(join(packageDir, '.install.json'), packageDir)
      if (!installResult.ok) issues.push(...installResult.issues.map(issue => `${name}: ${issue}`))
      const scopePath = join(generationDir, 'scope', '@cyrus', name.split('/')[1])
      if (!existsSync(scopePath)) issues.push(`${name}: scope 组合视图缺失 ${scopePath}`)
    }
  }
  return { ok: issues.length === 0, issues }
}

/**
 * 读取 current.json 并校验对应 generation；返回 { generationId, generationDir, batch } 或 null。
 */
export function loadCurrentGeneration(externalRoot, options = {}) {
  if (externalRoot === null || externalRoot === undefined) return null
  const currentPath = join(externalRoot, 'current.json')
  if (!existsSync(currentPath)) return null
  let current
  try { current = readJson(currentPath) } catch { return null }
  if (!current?.generationId) return null
  const generationDir = join(externalRoot, 'generations', current.generationId)
  if (!existsSync(generationDir)) return null
  const batchPath = join(generationDir, 'batch.json')
  if (!existsSync(batchPath)) return null
  const result = validateGeneration(generationDir, options)
  if (!result.ok) return null
  return { generationId: current.generationId, generationDir, batch: readJson(batchPath) }
}

/** 列出 generation scope 下实际存在的包目录（组合视图内容）。 */
export function listScopePackages(scopeRoot) {
  if (!existsSync(scopeRoot)) return []
  return readdirSync(scopeRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
}

/**
 * A1 doctor：校验当前 generation 的 scope 组合视图与 profile 激活 junction。
 * 这是启动后/提交前可重入的机器 doctor；不含 Harness fiber 探针（由外层 smoke 负责）。
 */
export function verifyGenerationDoctor({ generationDir, batch, dshHome } = {}) {
  const issues = []
  if (!generationDir || !batch) return { ok: false, issues: ['generationDir/batch 缺失'] }
  const scopeRoot = join(generationDir, 'scope', '@cyrus')
  for (const [name, info] of Object.entries(batch.packages ?? {})) {
    const shortName = name.split('/')[1]
    const link = join(scopeRoot, shortName)
    if (!existsSync(link)) {
      issues.push(`${name}: scope 条目缺失`)
      continue
    }
    let stat
    try {
      stat = lstatSync(link)
    } catch (error) {
      issues.push(`${name}: scope 条目读取失败 ${error.message}`)
      continue
    }
    if (!stat.isSymbolicLink()) {
      issues.push(`${name}: scope 条目不是 junction`)
      continue
    }
    const target = resolve(dirname(link), readlinkSync(link))
    if (info.source === 'external') {
      const expected = resolve(join(generationDir, 'packages', info.directoryName, info.version))
      if (target !== expected) issues.push(`${name}: scope 目标 ${target} != ${expected}`)
      const manifestPath = join(expected, 'package.json')
      if (!existsSync(manifestPath)) {
        issues.push(`${name}: 外部实体缺 package.json`)
      } else {
        try {
          const manifest = readJson(manifestPath)
          if (manifest.version !== info.version) issues.push(`${name}: 版本 ${manifest.version} != ${info.version}`)
        } catch (error) {
          issues.push(`${name}: package.json 解析失败 ${error.message}`)
        }
      }
    }
  }
  if (dshHome !== undefined && dshHome !== '') {
    const profileScope = join(dshHome, 'profiles', 'web', 'node_modules', '@cyrus')
    if (existsSync(profileScope)) {
      let stat
      try {
        stat = lstatSync(profileScope)
      } catch (error) {
        issues.push(`profile @cyrus 读取失败 ${error.message}`)
        stat = undefined
      }
      if (stat !== undefined) {
        if (!stat.isSymbolicLink()) issues.push('profile @cyrus 不是 junction')
        else if (resolve(dirname(profileScope), readlinkSync(profileScope)) !== resolve(scopeRoot)) {
          issues.push('profile @cyrus 未指向当前 generation scope')
        }
      }
    }
  }
  return { ok: issues.length === 0, issues }
}

/**
 * A1 状态接口：返回每包的机器可读状态。
 * @param {string|null} externalRoot
 * @param {object} [options]
 * @param {string[]} [options.packageNames]
 * @returns {Array<{packageName:string, version:string|null, source:string, generationId:string|null, installedAt:string|null, degradedReason:string|null}>}
 */
export function getPluginStatus(externalRoot, { packageNames = EXTERNAL_PLUGIN_WHITELIST } = {}) {
  const generation = externalRoot === null ? null : loadCurrentGeneration(externalRoot)
  const committedAt = generation === null
    ? null
    : (() => {
      try { return readJson(join(externalRoot, 'current.json')).committedAt ?? null } catch { return null }
    })()
  return packageNames.map(packageName => {
    const info = generation?.batch?.packages?.[packageName]
    if (generation !== null && info?.source === 'external') {
      const installPath = join(
        generation.generationDir,
        'packages',
        info.directoryName,
        info.version,
        '.install.json',
      )
      let version = info.version
      try { version = readJson(installPath).version ?? info.version } catch { /* keep batch version */ }
      return {
        packageName,
        version,
        source: 'external',
        generationId: generation.generationId,
        installedAt: committedAt,
        degradedReason: null,
      }
    }
    return {
      packageName,
      version: null,
      source: 'builtin',
      generationId: generation?.generationId ?? null,
      installedAt: null,
      degradedReason: generation === null ? 'no-external-generation' : 'not-external-in-current-generation',
    }
  })
}
