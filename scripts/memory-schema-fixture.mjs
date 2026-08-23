// scripts/memory-schema-fixture.mjs — MEMORY_SCHEMA_V1.sql 合成数据验证（临时目录，零真实数据）
// 运行：node scripts/memory-schema-fixture.mjs
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const sqlPath = new URL('../docs/memory/MEMORY_SCHEMA_V1.sql', import.meta.url)
const sql = readFileSync(sqlPath, 'utf8')
const splitAt = sql.indexOf('-- 第二部分：')
if (splitAt < 0) throw new Error('schema file lacks part-2 marker')
const catalogSQL = sql.slice(0, splitAt)
const shardSQL = sql.slice(splitAt).replace('PRAGMA journal_mode = WAL;', '-- (fixture: WAL pragma skipped)').replace('PRAGMA foreign_keys = ON;', '')

const root = mkdtempSync(join(tmpdir(), 'dsh-memory-schema-fixture-'))
let failures = 0
const results = []
const check = (name, cond) => {
  results.push(name + (cond ? ' PASS' : ' FAIL'))
  if (!cond) failures += 1
}
const expectThrow = (name, fn, pattern = 'constraint') => {
  try { fn(); check(name + ' (should throw)', false) }
  catch (e) { check(name, String(e?.message ?? e).toLowerCase().includes(pattern)) }
}

try {
  // --- catalog ---
  const cat = new DatabaseSync(join(root, 'catalog.sqlite3'))
  cat.exec('PRAGMA foreign_keys = ON')
  cat.exec(catalogSQL)
  const tables = cat.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name)
  check('catalog tables created', tables.includes('memory_projects') && tables.includes('meta'))
  cat.prepare("INSERT INTO memory_projects(project_id, shard_locator, created_at, updated_at) VALUES (?,?,?,?)")
    .run('proj-A', 'projects/proj-A/memory.sqlite3', '2026-08-15T00:00:00Z', '2026-08-15T00:00:00Z')
  expectThrow('catalog duplicate project_id rejected', () => {
    cat.prepare("INSERT INTO memory_projects(project_id, shard_locator, created_at, updated_at) VALUES (?,?,?,?)")
      .run('proj-A', 'projects/proj-A/memory.sqlite3', '2026-08-15T00:00:01Z', '2026-08-15T00:00:01Z')
  }, 'unique')
  cat.close()

  // --- shard ---
  const db = new DatabaseSync(join(root, 'shard.sqlite3'))
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(shardSQL)
  const names = db.prepare("SELECT name FROM sqlite_master ORDER BY name").all().map(r => r.name)
  check('shard tables created', ['claims', 'evidence_sources', 'claim_evidence', 'claim_relations',
    'embeddings', 'candidate_idempotency', 'recall_runs', 'recall_items', 'promotion_events', 'tombstones', 'meta']
    .every(n => names.includes(n)))
  check('fts table created', names.includes('claims_fts'))

  const now = '2026-08-15T12:00:00.000Z'
  const ins = db.prepare(`INSERT INTO claims(id, scope_kind, scope_id, kind, canonical_text, searchable_text, status, authority_class,
    sensitivity_class, normalized_content_hash, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)

  const c1 = ins.run('c1', 'project', 'proj-A', 'event', 'synth fixture claim alpha', 'synth fixture claim alpha', 'candidate', 'llm_extracted', 'internal', 'h1', now, now).lastInsertRowid
  const c2 = ins.run('c2', 'global_user', 'user:cyrus', 'user_profile', 'prefer summary first', 'prefer summary first', 'active', 'user_confirmed', 'sensitive', 'h2', now, now).lastInsertRowid
  const c3 = ins.run('c3', 'project', 'proj-A', 'event', 'older claim superseded', 'older claim superseded', 'active', 'user_confirmed', 'internal', 'h3', now, now).lastInsertRowid
  check('three claims inserted', c1 > 0 && c2 > 0 && c3 > 0)

  expectThrow('duplicate (scope,scope_id,kind,hash) rejected', () =>
    ins.run('c1b', 'project', 'proj-A', 'event', 'synth fixture claim alpha', 'synth fixture claim alpha', 'candidate', 'llm_extracted', 'internal', 'h1', now, now), 'unique')
  expectThrow('scope_kind candidate rejected', () =>
    ins.run('c4', 'candidate', 'proj-A', 'event', 'x', 'x', 'candidate', 'llm_extracted', 'internal', 'h4', now, now))
  expectThrow('status confirmed rejected', () =>
    ins.run('c4', 'project', 'proj-A', 'event', 'x', 'x', 'confirmed', 'llm_extracted', 'internal', 'h4', now, now))
  expectThrow('NULL scope_id rejected', () =>
    ins.run('c4', 'project', null, 'event', 'x', 'x', 'candidate', 'llm_extracted', 'internal', 'h4', now, now), 'not null')
  expectThrow('STRICT extra column rejected', () => {
    db.prepare(`INSERT INTO claims(id, scope_kind, scope_id, kind, canonical_text, status, authority_class,
      sensitivity_class, normalized_content_hash, created_at, updated_at, nope)
      VALUES ('c4','project','proj-A','event','x','candidate','llm_extracted','internal','h4',?,?,42)`).run(now, now)
  }, 'no column named')

  // FTS sync
  const fts = (q) => db.prepare('SELECT rowid FROM claims_fts WHERE claims_fts MATCH ?').all(q)
  check('fts matches inserted text', fts('synth').length >= 1)
  check('fts matches unique phrase', fts('alpha').some(r => r.rowid === c1))
  db.prepare("UPDATE claims SET canonical_text = 'synth fixture claim beta', searchable_text = 'synth fixture claim beta' WHERE id = 'c1'").run()
  check('fts updated after claim update', fts('beta').some(r => r.rowid === c1) && fts('alpha').length === 0)

  // lifecycle transition
  db.prepare("UPDATE claims SET status='active', authority_class='user_confirmed', updated_at=? WHERE id='c1'").run(now)
  check('candidate -> active+user_confirmed allowed', db.prepare("SELECT status FROM claims WHERE id='c1'").get().status === 'active')

  // evidence + RESTRICT
  db.prepare(`INSERT INTO evidence_sources(id, kind, portable_locator, captured_at, availability, sensitivity_class)
    VALUES ('e1','repo_file','project://proj-A/docs/NEXT.md#x',?,'available','internal')`).run(now)
  db.prepare("INSERT INTO claim_evidence(claim_id, evidence_id, kind, created_at) VALUES ('c1','e1','DERIVED_FROM',?)").run(now)
  expectThrow('referenced evidence delete restricted', () =>
    db.prepare("DELETE FROM evidence_sources WHERE id='e1'").run(), 'foreign key')

  // relations + embedding + recall + supersede + idempotency
  db.prepare("INSERT INTO claim_relations(source_id, target_id, kind, created_at) VALUES ('c1','c2','REQUIRES',?)").run(now)
  db.prepare(`INSERT INTO embeddings(claim_id, provider_id, model_id, model_revision, dimensions, encoding, normalization, content_hash, vector_blob, generated_at, generation, status)
    VALUES ('c1','ollama','mxbai','r1',768,'float32le','l2','h1',X'0000',?,1,'active')`).run(now)
  db.prepare("INSERT INTO recall_runs(id, session_id, project_id, query_hash, created_at) VALUES ('r1','s1','proj-A','qh1',?)").run(now)
  db.prepare("INSERT INTO recall_items(recall_id, claim_id, rank, injected) VALUES ('r1','c1',0,1)").run()
  db.prepare("UPDATE claims SET superseded_by = 'c1' WHERE id='c3'").run()
  db.prepare("INSERT INTO candidate_idempotency(idempotency_key, claim_id, outcome, expires_at, created_at) VALUES ('proj-A|s1|1|ev1|0','c1','pending',?,?)").run(now, now)

  // delete c1 in one transaction with tombstone
  db.exec("BEGIN")
  db.prepare("INSERT INTO tombstones(id, scope_kind, scope_id, content_hash, deleted_at, reason) VALUES ('c1','project','proj-A','h1',?,'fixture delete')").run(now)
  db.prepare("DELETE FROM claims WHERE id='c1'").run()
  db.exec("COMMIT")

  const count = (sqlText) => db.prepare(sqlText).get().c
  check('claim_evidence cascade', count("SELECT COUNT(*) AS c FROM claim_evidence WHERE claim_id='c1'") === 0)
  check('claim_relations cascade', count("SELECT COUNT(*) AS c FROM claim_relations WHERE source_id='c1' OR target_id='c1'") === 0)
  check('embeddings cascade', count("SELECT COUNT(*) AS c FROM embeddings WHERE claim_id='c1'") === 0)
  check('recall_items SET NULL', db.prepare("SELECT claim_id FROM recall_items WHERE recall_id='r1'").get().claim_id === null)
  check('candidate_idempotency SET NULL', db.prepare("SELECT claim_id FROM candidate_idempotency WHERE idempotency_key='proj-A|s1|1|ev1|0'").get().claim_id === null)
  check('superseded_by SET NULL', db.prepare("SELECT superseded_by FROM claims WHERE id='c3'").get().superseded_by === null)
  check('tombstone written', db.prepare("SELECT id FROM tombstones WHERE id='c1'").get() !== undefined)
  check('fts deleted after claim delete', fts('beta').length === 0)
  check('evidence survives claim delete', db.prepare("SELECT id FROM evidence_sources WHERE id='e1'").get() !== undefined)

  // recall run cascade
  db.prepare("DELETE FROM recall_runs WHERE id='r1'").run()
  check('recall_items cascade with run', count("SELECT COUNT(*) AS c FROM recall_items WHERE recall_id='r1'") === 0)

  db.close()
  console.log(results.join('\n'))
  console.log('FIXTURE RESULT: ' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURES'))
} catch (e) {
  console.log(results.join('\n'))
  console.log('FIXTURE ERROR: ' + (e?.message ?? e))
  failures += 1
} finally {
  if (failures === 0) { try { rmSync(root, { recursive: true, force: true }) } catch {} }
  process.exitCode = failures === 0 ? 0 : 1
}
