import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createSkill, listSkills, trashSkill, updateSkillMetadata } from '../src/skills.ts'
import { defaultDocument } from '../src/store.ts'

test('creates, describes, organizes, and recoverably removes a personal Skill', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-personal-skills-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const dshHome = join(root, 'dsh')
  const agentsHome = join(root, 'agents')
  const document = defaultDocument()
  const created = await createSkill(dshHome, {
    name: 'weekly-review', category: '项目管理', description: '每周整理项目进展。', content: 'Follow the evidence.',
  }, document)
  assert.equal(created.canDelete, true)
  const markdown = await readFile(join(dshHome, 'skills', 'weekly-review', 'SKILL.md'), 'utf8')
  assert.match(markdown, /description: "每周整理项目进展。"/u)

  const listed = await listSkills(dshHome, agentsHome, document.skillMetadata)
  assert.equal(listed[0]?.description, '每周整理项目进展。')
  const updated = await updateSkillMetadata(dshHome, agentsHome, {
    id: created.id, category: '复盘', description: '按证据生成每周复盘。',
  }, document)
  assert.equal(updated.category, '复盘')

  const removed = await trashSkill(dshHome, agentsHome, { id: created.id, name: created.name }, document)
  await access(removed.trashed)
  await assert.rejects(access(join(dshHome, 'skills', 'weekly-review')))
})

test('rejects deletion when the confirmation name does not match', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-personal-skills-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const dshHome = join(root, 'dsh')
  const agentsHome = join(root, 'agents')
  const document = defaultDocument()
  const created = await createSkill(dshHome, {
    name: 'safe-delete', category: '测试', description: '验证删除边界。', content: '',
  }, document)
  await assert.rejects(
    trashSkill(dshHome, agentsHome, { id: created.id, name: 'different-name' }, document),
    error => error?.code === 'CONFIRMATION_MISMATCH',
  )
})
