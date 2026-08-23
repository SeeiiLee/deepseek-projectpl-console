import assert from 'node:assert/strict'
import test from 'node:test'
import { deriveTrajectoryIsland } from '../src/client/model.ts'

function source(overrides = {}) {
  const nodes = new Map([
    ['u1', { key: 'u1', kind: 'user', visibility: 'visible', anchorSeq: 2 }],
    ['a1', { key: 'a1', kind: 'assistant', visibility: 'visible', anchorSeq: 3 }],
    ['hidden-error', { key: 'hidden-error', kind: 'turn-error', visibility: 'hidden', anchorSeq: 4 }],
    ['u2', { key: 'u2', kind: 'user', visibility: 'visible', anchorSeq: 6 }],
    ['tool2', { key: 'tool2', kind: 'tool-call', visibility: 'visible', anchorSeq: 7 }],
  ])
  return {
    turnOrder: [1, 2],
    turnStatus: turn => turn === 1 ? 'closed' : 'open',
    nodeKeys: turn => turn === 1 ? ['u1', 'a1', 'hidden-error'] : ['u2', 'tool2'],
    node: key => nodes.get(key),
    requests: [{ turn: 1, status: 'complete' }, { turn: 2, status: 'running' }],
    runningToolTurns: [2],
    ...overrides,
  }
}

test('groups upstream chat anchors and trajectory states by turn', () => {
  const turns = deriveTrajectoryIsland(source())
  assert.equal(turns.length, 2)
  assert.equal(turns[0].anchorKey, 'u1')
  assert.equal(turns[0].status, 'complete')
  assert.deepEqual(turns[0].signals.map(signal => signal.kind), ['user', 'assistant'])
  assert.equal(turns[1].anchorKey, 'u2')
  assert.equal(turns[1].status, 'running')
  assert.deepEqual(turns[1].signals.map(signal => `${signal.kind}:${signal.status}`), [
    'user:complete', 'tool:complete', 'request:running', 'tool:running',
  ])
})

test('appends turns known only to the trajectory projection', () => {
  const turns = deriveTrajectoryIsland(source({
    turnOrder: [1],
    nodeKeys: turn => turn === 1 ? ['u1', 'a1', 'hidden-error'] : [],
    requests: [{ turn: 1, status: 'complete' }, { turn: 3, status: 'error' }],
    runningToolTurns: [],
  }))
  assert.deepEqual(turns.map(turn => turn.turn), [1, 3])
  assert.equal(turns[1].status, 'error')
  assert.equal(turns[1].anchorKey, undefined)
})

test('never chooses a hidden row as the jump anchor', () => {
  const turns = deriveTrajectoryIsland(source({
    turnOrder: [9],
    turnStatus: () => 'closed',
    nodeKeys: () => ['hidden-error'],
    requests: [],
    runningToolTurns: [],
  }))
  assert.equal(turns[0].anchorKey, undefined)
  assert.equal(turns[0].status, 'complete')
})
