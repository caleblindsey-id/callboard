import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aceBillableValue, aceBillableTotal } from './ace-value'

// This formula used to exist twice with different rounding discipline: the
// commission report ran it through roundCents, the payout report summed raw
// floats and rendered .toFixed(2). Same month, two reachable answers. These
// tests pin the one that survived.

test('billable value is hours x the rate snapshotted at approval', () => {
  assert.equal(aceBillableValue({ hours: 1.5, rate_value_at_approval: 140 }), 210)
  assert.equal(aceBillableValue({ hours: 0.75, rate_value_at_approval: 120 }), 90)
  assert.equal(aceBillableValue({ hours: 3, rate_value_at_approval: 120 }), 360)
})

test('coerces the numeric strings PostgREST returns for DECIMAL columns', () => {
  assert.equal(aceBillableValue({ hours: '1.50', rate_value_at_approval: '140.00' }), 210)
})

test('a pending entry has no snapshotted rate and is worth nothing yet', () => {
  assert.equal(aceBillableValue({ hours: 2, rate_value_at_approval: null }), 0)
})

test('null or non-finite inputs are worth zero, never NaN', () => {
  assert.equal(aceBillableValue({ hours: null, rate_value_at_approval: 120 }), 0)
  assert.equal(aceBillableValue({ hours: 'abc', rate_value_at_approval: 120 }), 0)
  assert.equal(aceBillableValue({ hours: 2, rate_value_at_approval: 'x' }), 0)
})

test('rounds to cents rather than carrying binary float error', () => {
  // 0.35 x 55 = 19.249999999999996 in IEEE754.
  assert.equal(aceBillableValue({ hours: 0.35, rate_value_at_approval: 55 }), 19.25)
})

test('total rounds per entry then sums, matching how the workbook is keyed', () => {
  assert.equal(
    aceBillableTotal([
      { hours: 0.35, rate_value_at_approval: 55 },
      { hours: 0.35, rate_value_at_approval: 55 },
    ]),
    38.5,
  )
})

test('empty set totals zero', () => {
  assert.equal(aceBillableTotal([]), 0)
})

test("Mike Jennings' real July 2026 ACE: eight entries totalling 810.00", () => {
  // The set that landed on row 10 of the July workbook. Seven were logged 6/30
  // and approved 7/1; ACE buckets on approval, so they are July's.
  const entries = [0.75, 0.5, 0.5, 1.0, 0.75, 0.75, 1.0, 1.5].map((hours) => ({
    hours,
    rate_value_at_approval: 120,
  }))
  assert.equal(aceBillableTotal(entries), 810)
})
