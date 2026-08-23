import assert from 'node:assert/strict'
import test from 'node:test'
import { decideDetailsRoute } from '../src/client/details-route.ts'

test('routes every new dismiss command, including a direct Details close after initial dismiss', () => {
  assert.deepEqual(decideDetailsRoute({ kind: 'dismiss', revision: 0 }, -1), {
    action: 'dismiss', nextRevision: 0,
  })
  assert.deepEqual(decideDetailsRoute({ kind: 'dismiss', revision: 1 }, 0), {
    action: 'dismiss', nextRevision: 1,
  })
  assert.deepEqual(decideDetailsRoute({ kind: 'dismiss', revision: 2 }, 1), {
    action: 'dismiss', nextRevision: 2,
  })
})

test('selects each new open revision once and accepts open after dismiss', () => {
  assert.deepEqual(decideDetailsRoute({ kind: 'open', revision: 3 }, 2), {
    action: 'select', nextRevision: 3,
  })
  assert.deepEqual(decideDetailsRoute({ kind: 'open', revision: 3 }, 3), {
    action: 'ignore', nextRevision: 3,
  })
  assert.deepEqual(decideDetailsRoute({ kind: 'open', revision: 4 }, 3), {
    action: 'select', nextRevision: 4,
  })
})
