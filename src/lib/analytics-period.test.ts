import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseAnalyticsParams,
  stepPeriod,
  isCurrentPeriod,
  monthOptions,
  monthValueOf,
  monthLabel,
  analyticsQuery,
} from './analytics-period'

// Fixed "now" so the clamping tests don't rot. 2026-08-04 is a Tuesday.
const NOW = new Date('2026-08-04T12:00:00Z')

// ── stepPeriod: monthly ────────────────────────────────────────────

test('stepPeriod monthly moves one month', () => {
  assert.equal(stepPeriod('2026-08-04', 'monthly', -1), '2026-07-04')
  assert.equal(stepPeriod('2026-08-04', 'monthly', 1), '2026-09-04')
})

test('stepPeriod monthly clamps at month ends instead of skipping a month', () => {
  // The bug this guards: a naive setUTCMonth(-1) on Mar 31 rolls into Mar 3,
  // so February is unreachable by paging back.
  assert.equal(stepPeriod('2026-03-31', 'monthly', -1), '2026-02-28')
  assert.equal(stepPeriod('2026-01-31', 'monthly', 1), '2026-02-28')
  assert.equal(stepPeriod('2026-05-31', 'monthly', -1), '2026-04-30')
})

test('stepPeriod monthly handles leap February', () => {
  assert.equal(stepPeriod('2028-03-31', 'monthly', -1), '2028-02-29')
})

test('stepPeriod monthly crosses year boundaries', () => {
  assert.equal(stepPeriod('2026-01-15', 'monthly', -1), '2025-12-15')
  assert.equal(stepPeriod('2025-12-15', 'monthly', 1), '2026-01-15')
})

// ── stepPeriod: weekly ─────────────────────────────────────────────

test('stepPeriod weekly moves exactly seven days', () => {
  assert.equal(stepPeriod('2026-08-04', 'weekly', -1), '2026-07-28')
  assert.equal(stepPeriod('2026-08-04', 'weekly', 1), '2026-08-11')
})

test('stepPeriod weekly crosses a year boundary', () => {
  assert.equal(stepPeriod('2026-01-01', 'weekly', -1), '2025-12-25')
  assert.equal(stepPeriod('2025-12-29', 'weekly', 1), '2026-01-05')
})

// ── isCurrentPeriod ────────────────────────────────────────────────

test('isCurrentPeriod is true anywhere inside the current month', () => {
  assert.equal(isCurrentPeriod('2026-08-01', 'monthly', NOW), true)
  assert.equal(isCurrentPeriod('2026-08-31', 'monthly', NOW), true)
  assert.equal(isCurrentPeriod('2026-07-31', 'monthly', NOW), false)
})

test('isCurrentPeriod compares whole weeks, Monday-anchored', () => {
  // Week of Mon 2026-08-03 through Sun 2026-08-09 contains "now".
  assert.equal(isCurrentPeriod('2026-08-03', 'weekly', NOW), true)
  assert.equal(isCurrentPeriod('2026-08-09', 'weekly', NOW), true)
  assert.equal(isCurrentPeriod('2026-08-02', 'weekly', NOW), false) // previous Sunday
  assert.equal(isCurrentPeriod('2026-08-10', 'weekly', NOW), false)
})

test('isCurrentPeriod distinguishes the same month a year apart', () => {
  assert.equal(isCurrentPeriod('2025-08-04', 'monthly', NOW), false)
})

// ── parseAnalyticsParams ───────────────────────────────────────────

test('parseAnalyticsParams accepts a well-formed triplet', () => {
  assert.deepEqual(
    parseAnalyticsParams({ period: 'weekly', date: '2026-06-15', type: 'pm' }, NOW),
    { periodType: 'weekly', date: '2026-06-15', ticketType: 'pm' }
  )
})

test('parseAnalyticsParams defaults to the current month, combined', () => {
  assert.deepEqual(parseAnalyticsParams({}, NOW), {
    periodType: 'monthly',
    date: '2026-08-04',
    ticketType: 'combined',
  })
  assert.deepEqual(parseAnalyticsParams(undefined, NOW), {
    periodType: 'monthly',
    date: '2026-08-04',
    ticketType: 'combined',
  })
})

test('parseAnalyticsParams rejects malformed dates', () => {
  for (const bad of ['', 'today', '2026-6-15', '15-06-2026', '2026-06-15T00:00:00Z', 'null']) {
    assert.equal(parseAnalyticsParams({ date: bad }, NOW).date, '2026-08-04', `${bad} should fall back`)
  }
})

test('parseAnalyticsParams rejects dates that pass the regex but are not real', () => {
  // Date would silently roll these forward — Feb 31 becomes Mar 3.
  assert.equal(parseAnalyticsParams({ date: '2026-02-31' }, NOW).date, '2026-08-04')
  assert.equal(parseAnalyticsParams({ date: '2026-13-01' }, NOW).date, '2026-08-04')
  assert.equal(parseAnalyticsParams({ date: '2026-00-10' }, NOW).date, '2026-08-04')
})

test('parseAnalyticsParams clamps future dates to today', () => {
  assert.equal(parseAnalyticsParams({ date: '2027-01-01' }, NOW).date, '2026-08-04')
  assert.equal(parseAnalyticsParams({ date: '2026-08-05' }, NOW).date, '2026-08-04')
  // Today itself is allowed through.
  assert.equal(parseAnalyticsParams({ date: '2026-08-04' }, NOW).date, '2026-08-04')
})

test('parseAnalyticsParams rejects unknown period and ticket types', () => {
  assert.equal(parseAnalyticsParams({ period: 'daily' }, NOW).periodType, 'monthly')
  assert.equal(parseAnalyticsParams({ period: 'Weekly' }, NOW).periodType, 'monthly')
  assert.equal(parseAnalyticsParams({ type: 'invoice' }, NOW).ticketType, 'combined')
  assert.equal(parseAnalyticsParams({ type: 'PM' }, NOW).ticketType, 'combined')
})

test('parseAnalyticsParams takes the first value of a repeated param', () => {
  assert.equal(parseAnalyticsParams({ period: ['weekly', 'monthly'] }, NOW).periodType, 'weekly')
  assert.equal(parseAnalyticsParams({ date: ['2026-06-15'] }, NOW).date, '2026-06-15')
})

// ── month dropdown helpers ─────────────────────────────────────────

test('monthOptions runs newest-first from the current month', () => {
  const opts = monthOptions(3, NOW)
  assert.deepEqual(opts, [
    { value: '2026-08-01', label: 'August 2026' },
    { value: '2026-07-01', label: 'July 2026' },
    { value: '2026-06-01', label: 'June 2026' },
  ])
})

test('monthOptions crosses the year boundary', () => {
  const opts = monthOptions(14, NOW)
  assert.equal(opts.length, 14)
  assert.deepEqual(opts[7], { value: '2026-01-01', label: 'January 2026' })
  assert.deepEqual(opts[13], { value: '2025-07-01', label: 'July 2025' })
})

test('monthValueOf snaps any day to the 1st of its month', () => {
  assert.equal(monthValueOf('2026-08-04'), '2026-08-01')
  assert.equal(monthValueOf('2026-08-31'), '2026-08-01')
  assert.equal(monthValueOf('2026-01-01'), '2026-01-01')
})

test('monthLabel formats in UTC regardless of the render zone', () => {
  // First of the month is where a zone shift would flip the label backwards.
  assert.equal(monthLabel('2026-08-01'), 'August 2026')
  assert.equal(monthLabel('2026-01-01'), 'January 2026')
})

test('analyticsQuery serialises the triplet', () => {
  assert.equal(
    analyticsQuery({ periodType: 'weekly', date: '2026-06-15', ticketType: 'pm' }),
    'period=weekly&date=2026-06-15&type=pm'
  )
})
