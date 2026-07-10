import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatDate, formatDateShort, formatDateTime, formatDateTimeLong, formatMoney } from './format'

// All date formatters must be deterministic regardless of the runtime timezone
// (Vercel SSR runs UTC, browsers run the user's zone). Output is pinned to the
// business timezone, America/Chicago. These assertions hold on any machine.

test('formatDateShort: DATE column value renders its literal calendar day', () => {
  // completed_date is a Postgres DATE — "2026-06-23" must never display as 6/22.
  assert.equal(formatDateShort('2026-06-23'), '6/23/2026')
  assert.equal(formatDateShort('2026-01-01'), '1/1/2026')
})

test('formatDateShort: timestamptz renders the Chicago calendar day', () => {
  // 02:00 UTC on 6/23 is 9:00 PM CDT on 6/22.
  assert.equal(formatDateShort('2026-06-23T02:00:00.000Z'), '6/22/2026')
  // 14:00 UTC on 6/23 is 9:00 AM CDT on 6/23.
  assert.equal(formatDateShort('2026-06-23T14:00:00.000Z'), '6/23/2026')
  // Winter (CST, UTC-6): 05:30 UTC on 1/10 is 11:30 PM on 1/9.
  assert.equal(formatDateShort('2026-01-10T05:30:00.000Z'), '1/9/2026')
})

test('formatDateShort: null and undefined render the em dash placeholder', () => {
  assert.equal(formatDateShort(null), '—')
  assert.equal(formatDateShort(undefined), '—')
})

test('formatDate: DATE column value keeps its calendar day', () => {
  assert.equal(formatDate('2026-06-23'), 'Jun 23, 2026')
})

test('formatDate: timestamptz renders the Chicago calendar day', () => {
  assert.equal(formatDate('2026-06-23T02:00:00.000Z'), 'Jun 22, 2026')
})

test('formatDateTime: pinned to Chicago wall-clock time', () => {
  assert.equal(formatDateTime('2026-06-23T02:00:00.000Z'), '6/22/2026 9:00 PM')
})

test('formatDateTimeLong: pinned to Chicago wall-clock time', () => {
  assert.equal(formatDateTimeLong('2026-06-23T02:00:00.000Z'), 'Jun 22, 2026 · 9:00 PM')
})

test('formatMoney: unchanged contract', () => {
  assert.equal(formatMoney(250), '$250.00')
  assert.equal(formatMoney(null), '—')
})
