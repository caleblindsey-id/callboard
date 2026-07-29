import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyServiceTicketFilters } from './service-tickets'

/**
 * Pins the filters applyServiceTicketFilters() emits.
 *
 * The board's list query and its per-status tab counts both run through this one
 * function precisely so they can't drift apart, which makes the emitted filter
 * set the thing worth asserting on. A stand-in query records each chained call;
 * no database involved.
 */

type Call = { method: string; args: unknown[] }

function spyQuery(): { query: unknown; calls: Call[] } {
  const calls: Call[] = []
  const q: Record<string, (...args: unknown[]) => unknown> = {}
  for (const method of ['eq', 'neq', 'is', 'not', 'or']) {
    q[method] = (...args: unknown[]) => {
      calls.push({ method, args })
      return q
    }
  }
  return { query: q, calls }
}

function filtersFor(input: Parameters<typeof applyServiceTicketFilters>[1]): Call[] {
  const { query, calls } = spyQuery()
  applyServiceTicketFilters(query, input)
  return calls
}

/** Drop the soft-delete scoping every call adds, leaving the parts predicate. */
function partsCalls(calls: Call[]): Call[] {
  return calls.filter((c) => c.args[0] !== 'deleted_at')
}

// ── ready / waitingOnParts ──

test('waitingOnParts asks for the unfulfilled column AND a non-empty parts array', () => {
  assert.deepEqual(partsCalls(filtersFor({ waitingOnParts: true })), [
    { method: 'eq', args: ['parts_received', false] },
    { method: 'neq', args: ['parts_requested', '[]'] },
  ])
})

test('ready is the complement — fulfilled column OR an empty parts array', () => {
  assert.deepEqual(partsCalls(filtersFor({ ready: true })), [
    { method: 'or', args: ['parts_received.eq.true,parts_requested.eq.[]'] },
  ])
})

test('both predicates carry the parts_requested clause that covers a part-less ticket', () => {
  // The clause that keeps a brand-new ticket out of "waiting on parts": the
  // column defaults to false and a ticket that never requested a part never runs
  // the derivation, so parts_received alone would misreport it from birth.
  // Dropping it from either side is the regression this test exists to catch.
  const waiting = JSON.stringify(partsCalls(filtersFor({ waitingOnParts: true })))
  const ready = JSON.stringify(partsCalls(filtersFor({ ready: true })))
  assert.ok(waiting.includes('parts_requested'), 'waiting must exclude part-less tickets')
  assert.ok(ready.includes('parts_requested'), 'ready must include part-less tickets')
})

test('the two predicates disagree about every column they share', () => {
  // Complementary, not merely different: waiting wants parts_received false and a
  // non-empty array; ready wants true or an empty one. If someone "simplifies"
  // either side to match the other, this fails.
  const waiting = JSON.stringify(partsCalls(filtersFor({ waitingOnParts: true })))
  const ready = JSON.stringify(partsCalls(filtersFor({ ready: true })))
  assert.ok(waiting.includes('"parts_received",false'), 'waiting keys off false')
  assert.ok(ready.includes('parts_received.eq.true'), 'ready keys off true')
  assert.notEqual(waiting, ready)
})

test('neither predicate is applied when neither is asked for', () => {
  assert.deepEqual(partsCalls(filtersFor({})), [])
  assert.deepEqual(partsCalls(filtersFor(undefined)), [])
})

test('asking for both is contradictory and emits both, matching nothing', () => {
  // The UI makes these mutually exclusive; if a hand-built URL sets both, an
  // empty result is the honest answer. Documented so nobody "fixes" it into a
  // silent precedence rule.
  const calls = partsCalls(filtersFor({ waitingOnParts: true, ready: true }))
  assert.equal(calls.length, 3)
})

// ── soft-delete scoping (unchanged, guarded here so the parts work can't erode it) ──

test('deleted tickets are excluded by default', () => {
  const calls = filtersFor({ ready: true })
  assert.deepEqual(
    calls.filter((c) => c.args[0] === 'deleted_at'),
    [{ method: 'is', args: ['deleted_at', null] }],
  )
})

test('deletedOnly inverts the soft-delete scope rather than adding to it', () => {
  const calls = filtersFor({ deletedOnly: true })
  assert.deepEqual(
    calls.filter((c) => c.args[0] === 'deleted_at'),
    [{ method: 'not', args: ['deleted_at', 'is', null] }],
  )
})

test('includeDeleted applies no soft-delete filter at all', () => {
  const calls = filtersFor({ includeDeleted: true })
  assert.deepEqual(calls.filter((c) => c.args[0] === 'deleted_at'), [])
})
