import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveReadinessChip, readinessChipLabel, readinessSortRank } from './service-readiness'
import type { ReadinessInput } from './service-readiness'

function ticket(over: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    status: 'approved',
    parts_pending: 0,
    parts_total: 0,
    credit_reviews: null,
    ...over,
  }
}

// ── which rows get a chip at all ──

test('only approved and in_progress rows get a chip', () => {
  for (const status of ['open', 'estimated', 'completed', 'billed', 'declined', 'canceled']) {
    assert.equal(resolveReadinessChip(ticket({ status })), null, `${status} should have no chip`)
  }
})

test('an approved row with nothing outstanding is Ready', () => {
  assert.deepEqual(resolveReadinessChip(ticket()), { kind: 'ready' })
})

test('in_progress never shows Ready — only the stalled-on-parts signal', () => {
  assert.equal(resolveReadinessChip(ticket({ status: 'in_progress' })), null)
  assert.deepEqual(
    resolveReadinessChip(ticket({ status: 'in_progress', parts_pending: 1, parts_total: 2 })),
    { kind: 'waiting', pending: 1, total: 2 },
  )
})

// ── the failure mode worth guarding ──

test('absent counts yield no chip rather than a green one', () => {
  // A row whose counts were never fetched must not claim "Ready". Showing
  // nothing is recoverable; a wrong green dispatches a tech to a job that
  // cannot start, which is the exact cost this feature exists to remove.
  assert.equal(resolveReadinessChip(ticket({ parts_pending: undefined })), null)
  assert.equal(resolveReadinessChip(ticket({ parts_total: undefined })), null)
})

// ── precedence ──

test('pending parts win over an open credit review', () => {
  // Credit already renders its own badge beside the customer name; the parts
  // blocker is invisible anywhere else on the row.
  assert.deepEqual(
    resolveReadinessChip(
      ticket({ parts_pending: 2, parts_total: 3, credit_reviews: [{ status: 'blocked' }] }),
    ),
    { kind: 'waiting', pending: 2, total: 3 },
  )
})

test('an open credit review replaces Ready rather than sitting beside it', () => {
  for (const status of ['pending', 'blocked'] as const) {
    assert.deepEqual(
      resolveReadinessChip(ticket({ credit_reviews: [{ status }] })),
      { kind: 'credit', status },
      `${status} should surface as the chip`,
    )
  }
})

test('a released review has been cleared by AR and does not suppress Ready', () => {
  assert.deepEqual(
    resolveReadinessChip(ticket({ credit_reviews: [{ status: 'released' }] })),
    { kind: 'ready' },
  )
})

test('an open review outranks a released one on the same ticket', () => {
  assert.deepEqual(
    resolveReadinessChip(
      ticket({ credit_reviews: [{ status: 'released' }, { status: 'blocked' }] }),
    ),
    { kind: 'credit', status: 'blocked' },
  )
})

// ── label ──

test('the waiting label mirrors the detail page phrasing', () => {
  assert.equal(readinessChipLabel({ kind: 'waiting', pending: 2, total: 3 }), 'Parts 2 of 3')
})

// ── sort ──

test('sorting surfaces blocked work first and chipless rows last', () => {
  const ranks = [
    readinessSortRank({ kind: 'waiting', pending: 1, total: 1 }),
    readinessSortRank({ kind: 'credit', status: 'blocked' }),
    readinessSortRank({ kind: 'ready' }),
    readinessSortRank(null),
  ]
  assert.deepEqual(ranks, [0, 1, 2, 3])
  assert.deepEqual([...ranks].sort((a, b) => a - b), ranks, 'ranks must already be ordered')
})
