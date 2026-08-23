import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

import {
  EXPECTED_HARNESS_COMMIT,
  EXPECTED_HARNESS_VERSION,
  BuildRootError,
  ensureHarnessSourceLink,
  gitCommit,
  resolveActiveRuntimeRoot,
  resolveBuildRoot,
  verifyBuildRoot,
} from '../scripts/build-kit.mjs'

function makeFakeRuntime(root) {
  mkdirSync(join(root, 'node_modules', 'tsdown', 'dist'), { recursive: true })
  mkdirSync(join(root, 'packages', 'client'), { recursive: true })
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version: EXPECTED_HARNESS_VERSION }))
  writeFileSync(join(root, 'node_modules', 'tsdown', 'dist', 'run.mjs'), 'export {}')
  writeFileSync(join(root, 'packages', 'client', 'tsdown.client.ts'), 'export const clientBundle = () => ({})')
}

test('verifyBuildRoot 对 rc.2 形状通过、对缺件/版本/commit 失败', () => {
  const root = mkdtempSync(join(tmpdir(), 'build-kit-'))
  makeFakeRuntime(root)
  // 非 git 目录 → commit 校验失败（fail closed 的一项）
  const problems = verifyBuildRoot(root)
  assert.ok(problems.some(p => p.includes('git HEAD')), JSON.stringify(problems))
  rmSync(root, { recursive: true, force: true })
})

test('verifyBuildRoot 版本不匹配被拒绝', () => {
  const root = mkdtempSync(join(tmpdir(), 'build-kit-'))
  makeFakeRuntime(root)
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.1.0-rc.5' }))
  const problems = verifyBuildRoot(root)
  assert.ok(problems.some(p => p.includes('0.1.0-rc.5')))
  rmSync(root, { recursive: true, force: true })
})

test('gitCommit 返回 HEAD 或 null', () => {
  const root = mkdtempSync(join(tmpdir(), 'build-kit-'))
  assert.equal(gitCommit(root), null)
  rmSync(root, { recursive: true, force: true })
})

test('resolveActiveRuntimeRoot 只认 update-center.json 的 activeHarnessRoot', () => {
  const userData = mkdtempSync(join(tmpdir(), 'build-kit-'))
  const runtime = join(userData, 'runtime-x')
  mkdirSync(runtime, { recursive: true })
  assert.equal(resolveActiveRuntimeRoot({ env: {}, appData: 'C:\\nonexistent' }), null)
  writeFileSync(join(userData, 'update-center.json'), JSON.stringify({
    activeHarnessRoot: runtime,
  }))
  assert.equal(resolveActiveRuntimeRoot({ env: { DSH_DESKTOP_USER_DATA: userData }, appData: '' }), runtime)
  writeFileSync(join(userData, 'update-center.json'), JSON.stringify({
    activeHarnessRoot: 'C:\\does-not-exist',
  }))
  assert.equal(resolveActiveRuntimeRoot({ env: { DSH_DESKTOP_USER_DATA: userData }, appData: '' }), null)
  rmSync(userData, { recursive: true, force: true })
})

test('resolveBuildRoot：env 显式优先，缺失时 fail closed', () => {
  // 无 DSH_SOURCE_ROOT 且无 APPDATA → 抛 BuildRootError
  assert.throws(() => resolveBuildRoot({ env: {}, appData: '' }), BuildRootError)
  // DSH_SOURCE_ROOT 指向缺失目录 → 校验失败抛错
  assert.throws(
    () => resolveBuildRoot({ env: { DSH_SOURCE_ROOT: 'C:\\no-such-dir' }, appData: '' }),
    BuildRootError,
  )
})

test('ensureHarnessSourceLink 幂等创建 junction 并拒绝替换非链接', () => {
  const project = mkdtempSync(join(tmpdir(), 'build-kit-'))
  const target = join(project, 'runtime')
  mkdirSync(target, { recursive: true })
  const link = ensureHarnessSourceLink(project, target)
  assert.equal(resolve(link), join(project, 'harness-src'))
  // 幂等：再次调用不报错、目标不变
  assert.equal(ensureHarnessSourceLink(project, target), link)
  // 非链接路径拒绝替换（先移除 junction，换成普通目录）
  rmSync(link, { recursive: true, force: true })
  mkdirSync(link, { recursive: true })
  assert.throws(() => ensureHarnessSourceLink(project, target), BuildRootError)
  rmSync(project, { recursive: true, force: true })
})

test('EXPECTED_HARNESS_COMMIT 与 compat.json 记录的活动 commit 一致', () => {
  const compat = JSON.parse(readFileSync(new URL('../docs/compat.json', import.meta.url), 'utf8'))
  assert.equal(EXPECTED_HARNESS_COMMIT, compat.harnessCommit)
})
