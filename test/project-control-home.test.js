import assert from 'node:assert/strict'
import { isAbsolute, join, resolve } from 'node:path'
import test from 'node:test'
import { resolveProjectControlHome } from '../src/project-control-home.js'

test('Project Control defaults to stable Electron userData rather than DSH_HOME', () => {
  const userData = resolve('fixtures', 'user-data')
  const result = resolveProjectControlHome(userData, {
    DSH_HOME: resolve('fixtures', 'dsh-home'),
  })
  assert.equal(result, join(userData, 'project-control'))
  assert.equal(isAbsolute(result), true)
  assert.equal(result.includes('dsh-home'), false)
})

test('an explicit absolute PROJECT_CONTROL_HOME is preserved', () => {
  const override = resolve('fixtures', 'project-control-override')
  assert.equal(
    resolveProjectControlHome(resolve('fixtures', 'user-data'), { PROJECT_CONTROL_HOME: override }),
    override,
  )
})

test('a relative PROJECT_CONTROL_HOME is rejected instead of depending on cwd', () => {
  assert.throws(
    () => resolveProjectControlHome(resolve('fixtures', 'user-data'), { PROJECT_CONTROL_HOME: 'relative/data' }),
    /absolute path/,
  )
})

test('a UNC PROJECT_CONTROL_HOME is rejected on Windows', { skip: process.platform !== 'win32' }, () => {
  assert.throws(
    () => resolveProjectControlHome(resolve('fixtures', 'user-data'), {
      PROJECT_CONTROL_HOME: '\\\\server\\project-control',
    }),
    /local Windows drive/u,
  )
})
