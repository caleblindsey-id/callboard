import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isBusinessWeekday, businessDaysSince } from './business-days'

const CENTRAL = 'America/Chicago'

// isBusinessWeekday itself is exercised in depth by should-run.test.ts (which
// imports it via the should-run re-export); these two are a sanity check that
// the moved implementation still behaves the same from its new home.
test('isBusinessWeekday: Friday is a weekday, Saturday is not', () => {
  assert.equal(isBusinessWeekday(new Date('2026-08-21T13:00:00Z'), CENTRAL), true) // Friday
  assert.equal(isBusinessWeekday(new Date('2026-08-22T13:00:00Z'), CENTRAL), false) // Saturday
})

test('businessDaysSince: same calendar day reads 0', () => {
  const from = new Date('2026-08-24T15:00:00Z') // Monday afternoon
  const now = new Date('2026-08-24T20:00:00Z') // still Monday
  assert.equal(businessDaysSince(from, now, CENTRAL), 0)
})

test('businessDaysSince: next weekday reads 1', () => {
  const from = new Date('2026-08-24T15:00:00Z') // Monday
  const now = new Date('2026-08-25T15:00:00Z') // Tuesday
  assert.equal(businessDaysSince(from, now, CENTRAL), 1)
})

test('businessDaysSince: a Friday completion still reads 0 over the weekend', () => {
  const from = new Date('2026-08-21T15:00:00Z') // Friday
  const now = new Date('2026-08-23T15:00:00Z') // Sunday
  assert.equal(businessDaysSince(from, now, CENTRAL), 0)
})

test('businessDaysSince: a Friday completion reads 1 the following Monday', () => {
  const from = new Date('2026-08-21T15:00:00Z') // Friday
  const now = new Date('2026-08-24T15:00:00Z') // Monday
  assert.equal(businessDaysSince(from, now, CENTRAL), 1)
})

test('businessDaysSince: a full week (Mon to Mon) reads 5', () => {
  const from = new Date('2026-08-17T15:00:00Z') // Monday
  const now = new Date('2026-08-24T15:00:00Z') // Monday, one week later
  assert.equal(businessDaysSince(from, now, CENTRAL), 5)
})

test('businessDaysSince resolves in the given timezone, not UTC', () => {
  // 2026-08-22T02:00Z is Saturday in UTC but still Friday 9 PM in Central, so
  // the walk from Friday to "now" (also anchored the same evening) is 0 days.
  const from = new Date('2026-08-21T15:00:00Z') // Friday afternoon Central
  const now = new Date('2026-08-22T02:00:00Z') // Friday 9 PM Central
  assert.equal(businessDaysSince(from, now, CENTRAL), 0)
})
