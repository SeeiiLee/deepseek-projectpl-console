import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  InstallerError,
  assertRemoveAllowed,
  buildGraph,
  detectCycles,
  detectMissing,
  installedPackages,
  validateGraph,
} from '../scripts/plugin-installer.mjs'

function makeProfile(dir, dependencies) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'dsh-profile-test', dependencies }))
}

function makeCandidate(dir, name, composable) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name,
    version: '0.1.0-rc.7',
    ...(composable === undefined ? {} : { dshComposable: composable }),
  }))
}

test('installedPackages 读取 profile 依赖名', () => {
  const root = mkdtempSync(join(tmpdir(), 'installer-'))
  makeProfile(root, { '@cyrus/dsh-workbench': 'file:x.tgz' })
  assert.deepEqual(installedPackages(root), ['@cyrus/dsh-workbench'])
  rmSync(root, { recursive: true, force: true })
})

test('buildGraph 合并 profile 依赖与候选包', () => {
  const root = mkdtempSync(join(tmpdir(), 'installer-'))
  makeProfile(root, { '@cyrus/dsh-personal-shell': 'file:s.tgz' })
  const workbench = join(root, 'workbench')
  makeCandidate(workbench, '@cyrus/dsh-workbench', {
    schemaVersion: 1,
    role: 'core',
    requires: { packages: ['@cyrus/dsh-personal-shell'] },
  })
  const graph = buildGraph({ profileDir: root, candidateDirs: [workbench] })
  assert.ok(graph.has('@cyrus/dsh-personal-shell'))
  assert.deepEqual(graph.get('@cyrus/dsh-workbench').requires, ['@cyrus/dsh-personal-shell'])
  rmSync(root, { recursive: true, force: true })
})

test('缺必需依赖被检出（installer 必须一次装齐）', () => {
  const root = mkdtempSync(join(tmpdir(), 'installer-'))
  makeProfile(root, {})
  const workbench = join(root, 'workbench')
  makeCandidate(workbench, '@cyrus/dsh-workbench', {
    schemaVersion: 1,
    role: 'core',
    requires: { packages: ['@cyrus/dsh-personal-shell'] },
  })
  const graph = buildGraph({ profileDir: root, candidateDirs: [workbench] })
  const { ok, issues } = validateGraph(graph)
  assert.equal(ok, false)
  assert.ok(issues.some(issue => issue.includes('@cyrus/dsh-personal-shell')))
  rmSync(root, { recursive: true, force: true })
})

test('环检测', () => {
  const root = mkdtempSync(join(tmpdir(), 'installer-'))
  makeProfile(root, {})
  const a = join(root, 'a')
  const b = join(root, 'b')
  makeCandidate(a, '@cyrus/a', { schemaVersion: 1, role: 'core', requires: { packages: ['@cyrus/b'] } })
  makeCandidate(b, '@cyrus/b', { schemaVersion: 1, role: 'core', requires: { packages: ['@cyrus/a'] } })
  const graph = buildGraph({ profileDir: root, candidateDirs: [a, b] })
  const cycle = detectCycles(graph)
  assert.ok(cycle !== undefined)
  assert.deepEqual(cycle, ['@cyrus/a', '@cyrus/b', '@cyrus/a'])
  rmSync(root, { recursive: true, force: true })
})

test('冲突检出', () => {
  const root = mkdtempSync(join(tmpdir(), 'installer-'))
  makeProfile(root, { '@cyrus/dsh-existing': 'file:e.tgz' })
  const candidate = join(root, 'c')
  makeCandidate(candidate, '@cyrus/dsh-new', { schemaVersion: 1, role: 'core', conflicts: ['@cyrus/dsh-existing'] })
  const graph = buildGraph({ profileDir: root, candidateDirs: [candidate] })
  const { ok, issues } = validateGraph(graph)
  assert.equal(ok, false)
  assert.ok(issues.some(issue => issue.includes('冲突')))
  rmSync(root, { recursive: true, force: true })
})

test('移除校验：存在依赖者时拒绝，无依赖者放行', () => {
  const root = mkdtempSync(join(tmpdir(), 'installer-'))
  makeProfile(root, {
    '@cyrus/dsh-personal-shell': 'file:s.tgz',
    '@cyrus/dsh-workbench': 'file:w.tgz',
  })
  const shell = join(root, 'shell')
  const workbench = join(root, 'workbench')
  makeCandidate(shell, '@cyrus/dsh-personal-shell', { schemaVersion: 1, role: 'adapter' })
  makeCandidate(workbench, '@cyrus/dsh-workbench', { schemaVersion: 1, role: 'core', requires: { packages: ['@cyrus/dsh-personal-shell'] } })
  const graph = buildGraph({ profileDir: root, candidateDirs: [shell, workbench] })
  assert.throws(() => assertRemoveAllowed(graph, '@cyrus/dsh-personal-shell'), InstallerError)
  assert.throws(() => assertRemoveAllowed(graph, '@cyrus/dsh-not-installed'), InstallerError)
  assertRemoveAllowed(graph, '@cyrus/dsh-workbench')
  rmSync(root, { recursive: true, force: true })
})

test('workbench 图（shell 已装）校验通过', () => {
  const root = mkdtempSync(join(tmpdir(), 'installer-'))
  makeProfile(root, { '@cyrus/dsh-personal-shell': 'file:s.tgz' })
  const workbench = join(root, 'workbench')
  makeCandidate(workbench, '@cyrus/dsh-workbench', { schemaVersion: 1, role: 'core', requires: { packages: ['@cyrus/dsh-personal-shell'] } })
  const graph = buildGraph({ profileDir: root, candidateDirs: [workbench] })
  assert.equal(validateGraph(graph).ok, true)
  rmSync(root, { recursive: true, force: true })
})
