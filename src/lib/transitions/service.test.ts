import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ServiceTicketStatus } from '../../types/service-tickets'
import {
  SERVICE_VALID_TRANSITIONS,
  canTransition,
  isManagerOnlyTarget,
  isManagerOnlyReopenToApproved,
  techCannotDecline,
  techCannotComplete,
  isCreditGatedTarget,
  billingGateSatisfied,
} from './service'

const ALL_STATUSES: ServiceTicketStatus[] = [
  'open',
  'estimated',
  'approved',
  'in_progress',
  'completed',
  'billed',
  'declined',
  'canceled',
]

// Pin the table itself. If this literal ever drifts from
// src/types/service-tickets.ts, the diff shows exactly what changed in the
// state machine instead of a UI refactor silently altering it underneath.
test('SERVICE_VALID_TRANSITIONS matches the pinned service state machine', () => {
  assert.deepEqual(SERVICE_VALID_TRANSITIONS, {
    open: ['estimated', 'in_progress', 'canceled'],
    estimated: ['approved', 'declined', 'canceled'],
    approved: ['in_progress', 'canceled'],
    in_progress: ['completed', 'open', 'approved', 'estimated', 'canceled'],
    completed: ['billed', 'open', 'approved'],
    billed: ['open', 'approved'],
    declined: ['open'],
    canceled: ['open'],
  })
})

// Every allowed transition, plus every one of the forbidden pairs
// (8 statuses x 8 statuses = 64 total; 20 allowed per the table above).
test('canTransition allows every listed transition and forbids every other pair', () => {
  let allowedCount = 0
  let forbiddenCount = 0
  for (const from of ALL_STATUSES) {
    for (const to of ALL_STATUSES) {
      const expected = (SERVICE_VALID_TRANSITIONS[from] ?? []).includes(to)
      assert.equal(canTransition(from, to), expected, `${from} -> ${to}`)
      if (expected) allowedCount++
      else forbiddenCount++
    }
  }
  assert.equal(allowedCount + forbiddenCount, 64)
  assert.equal(allowedCount, 20)
  assert.equal(forbiddenCount, 44)
})

test('a representative sample of forbidden service transitions reads false', () => {
  assert.equal(canTransition('open', 'billed'), false)
  assert.equal(canTransition('open', 'approved'), false)
  assert.equal(canTransition('estimated', 'in_progress'), false)
  assert.equal(canTransition('approved', 'estimated'), false)
  assert.equal(canTransition('billed', 'in_progress'), false)
  assert.equal(canTransition('declined', 'estimated'), false)
  assert.equal(canTransition('canceled', 'in_progress'), false)
})

test('isManagerOnlyTarget: open (reopen) and canceled only', () => {
  assert.equal(isManagerOnlyTarget('open'), true)
  assert.equal(isManagerOnlyTarget('canceled'), true)
  for (const s of ALL_STATUSES.filter((s) => s !== 'open' && s !== 'canceled')) {
    assert.equal(isManagerOnlyTarget(s), false, s)
  }
})

test('isManagerOnlyReopenToApproved: only from a worked state back to approved', () => {
  assert.equal(isManagerOnlyReopenToApproved('in_progress', 'approved'), true)
  assert.equal(isManagerOnlyReopenToApproved('completed', 'approved'), true)
  assert.equal(isManagerOnlyReopenToApproved('billed', 'approved'), true)
  // The normal staff estimated -> approved approval path is unaffected.
  assert.equal(isManagerOnlyReopenToApproved('estimated', 'approved'), false)
  assert.equal(isManagerOnlyReopenToApproved('open', 'approved'), false)
  assert.equal(isManagerOnlyReopenToApproved('in_progress', 'completed'), false)
})

test('techCannotDecline: only estimated -> declined', () => {
  assert.equal(techCannotDecline('estimated', 'declined'), true)
  assert.equal(techCannotDecline('estimated', 'approved'), false)
  assert.equal(techCannotDecline('approved', 'declined'), false)
})

test('techCannotComplete: any target of completed, regardless of source', () => {
  assert.equal(techCannotComplete('completed'), true)
  assert.equal(techCannotComplete('billed'), false)
  assert.equal(techCannotComplete('in_progress'), false)
})

test('isCreditGatedTarget: in_progress/completed/billed, but not a same-state no-op', () => {
  assert.equal(isCreditGatedTarget('open', 'in_progress'), true)
  assert.equal(isCreditGatedTarget('approved', 'in_progress'), true)
  assert.equal(isCreditGatedTarget('in_progress', 'completed'), true)
  assert.equal(isCreditGatedTarget('completed', 'billed'), true)
  assert.equal(isCreditGatedTarget('in_progress', 'in_progress'), false)
  assert.equal(isCreditGatedTarget('billed', 'billed'), false)
  assert.equal(isCreditGatedTarget('open', 'estimated'), false)
  assert.equal(isCreditGatedTarget('declined', 'open'), false)
})

test('billingGateSatisfied: requires a non-empty Synergy invoice #', () => {
  assert.equal(billingGateSatisfied({ synergy_invoice_number: 'INV-100' }), true)
  assert.equal(billingGateSatisfied({ synergy_invoice_number: null }), false)
  assert.equal(billingGateSatisfied({ synergy_invoice_number: undefined }), false)
  assert.equal(billingGateSatisfied({ synergy_invoice_number: '' }), false)
  assert.equal(billingGateSatisfied({}), false)
})
