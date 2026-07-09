import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { TicketStatus } from '../../types/database'
import {
  VALID_TRANSITIONS,
  canTransition,
  isReopenTransition,
  isResetTransition,
  technicianForbiddenTarget,
  isCreditGatedTarget,
} from './pm'

const ALL_STATUSES: TicketStatus[] = [
  'unassigned',
  'assigned',
  'in_progress',
  'completed',
  'billed',
  'skipped',
  'skip_requested',
]

// Pin the table itself. If this literal ever drifts from
// src/lib/ticket-transitions.ts, the diff shows exactly what changed in the
// state machine instead of a UI refactor silently altering it underneath.
test('VALID_TRANSITIONS matches the pinned PM state machine', () => {
  assert.deepEqual(VALID_TRANSITIONS, {
    unassigned: ['assigned', 'in_progress', 'skipped'],
    assigned: ['in_progress', 'unassigned', 'skipped', 'skip_requested'],
    in_progress: ['completed', 'assigned', 'unassigned', 'skip_requested'],
    completed: ['billed', 'in_progress'],
    billed: ['completed', 'in_progress', 'assigned', 'unassigned'],
    skipped: ['unassigned'],
    skip_requested: ['skipped', 'in_progress', 'assigned'],
  })
})

// Every allowed transition, plus every one of the other 28 forbidden pairs
// (7 statuses x 7 statuses = 49 total; 21 allowed per the table above).
test('canTransition allows every listed transition and forbids every other pair', () => {
  let allowedCount = 0
  let forbiddenCount = 0
  for (const from of ALL_STATUSES) {
    for (const to of ALL_STATUSES) {
      const expected = (VALID_TRANSITIONS[from] ?? []).includes(to)
      assert.equal(canTransition(from, to), expected, `${from} -> ${to}`)
      if (expected) allowedCount++
      else forbiddenCount++
    }
  }
  assert.equal(allowedCount + forbiddenCount, 49)
  assert.equal(allowedCount, 21)
  assert.equal(forbiddenCount, 28)
})

test('a representative sample of forbidden PM transitions reads false', () => {
  assert.equal(canTransition('unassigned', 'completed'), false)
  assert.equal(canTransition('unassigned', 'billed'), false)
  assert.equal(canTransition('completed', 'unassigned'), false)
  assert.equal(canTransition('billed', 'skipped'), false)
  assert.equal(canTransition('skipped', 'assigned'), false)
  assert.equal(canTransition('skip_requested', 'billed'), false)
  assert.equal(canTransition('skip_requested', 'completed'), false)
})

test('technicianForbiddenTarget flags only billed', () => {
  assert.equal(technicianForbiddenTarget('billed'), true)
  for (const s of ALL_STATUSES.filter((s) => s !== 'billed')) {
    assert.equal(technicianForbiddenTarget(s), false, s)
  }
})

test('isReopenTransition: completed->in_progress and skipped->unassigned only', () => {
  assert.equal(isReopenTransition('completed', 'in_progress'), true)
  assert.equal(isReopenTransition('skipped', 'unassigned'), true)
  assert.equal(isReopenTransition('in_progress', 'assigned'), false)
  assert.equal(isReopenTransition('billed', 'in_progress'), false)
  assert.equal(isReopenTransition('completed', 'billed'), false)
})

test('isResetTransition: in_progress -> assigned/unassigned, or FROM billed to anything', () => {
  assert.equal(isResetTransition('in_progress', 'assigned'), true)
  assert.equal(isResetTransition('in_progress', 'unassigned'), true)
  assert.equal(isResetTransition('in_progress', 'completed'), false)
  assert.equal(isResetTransition('billed', 'completed'), true)
  assert.equal(isResetTransition('billed', 'in_progress'), true)
  assert.equal(isResetTransition('billed', 'assigned'), true)
  assert.equal(isResetTransition('billed', 'unassigned'), true)
  assert.equal(isResetTransition('assigned', 'in_progress'), false)
})

test('isCreditGatedTarget: in_progress/completed/billed only', () => {
  assert.equal(isCreditGatedTarget('in_progress'), true)
  assert.equal(isCreditGatedTarget('completed'), true)
  assert.equal(isCreditGatedTarget('billed'), true)
  assert.equal(isCreditGatedTarget('unassigned'), false)
  assert.equal(isCreditGatedTarget('assigned'), false)
  assert.equal(isCreditGatedTarget('skipped'), false)
  assert.equal(isCreditGatedTarget('skip_requested'), false)
})
