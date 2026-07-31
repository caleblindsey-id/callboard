import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  zonedDayStartUtc,
  monthWindowUtc,
  dateRangeWindowUtc,
  monthKeyInZone,
  dayKeyInZone,
} from './business-time'

// These pin the Central-vs-UTC month boundary. The bug they exist to prevent:
// building a month window as `${year}-${month}-01T00:00:00.000Z` puts the
// boundary at 7:00 PM Central on the last day of the PREVIOUS month, so a ticket
// billed that evening is counted in the following month. On a commission report
// the tier applies to the whole subtotal, so a misplaced ticket can move a tech
// across a cliff and change their pay by hundreds of dollars.
//
// These tests must keep passing on any machine regardless of local TZ -- every
// assertion is an absolute UTC instant, never a local-time render.

test('zonedDayStartUtc: CDT (summer) month start is 05:00Z', () => {
  assert.equal(zonedDayStartUtc(2026, 7, 1).toISOString(), '2026-07-01T05:00:00.000Z')
})

test('zonedDayStartUtc: CST (winter) month start is 06:00Z', () => {
  assert.equal(zonedDayStartUtc(2026, 1, 1).toISOString(), '2026-01-01T06:00:00.000Z')
})

test('zonedDayStartUtc: the day DST starts still begins at 06:00Z', () => {
  // 2026-03-08 is the second Sunday of March. The jump is at 2 AM, so midnight
  // is still CST and the day starts at 06:00Z even though it is only 23h long.
  assert.equal(zonedDayStartUtc(2026, 3, 8).toISOString(), '2026-03-08T06:00:00.000Z')
})

test('zonedDayStartUtc: the day DST ends still begins at 05:00Z', () => {
  // 2026-11-01 is the first Sunday of November. Fall back is at 2 AM, so
  // midnight is still CDT. This one matters: Nov 1 is a month boundary AND a
  // DST boundary in the same day.
  assert.equal(zonedDayStartUtc(2026, 11, 1).toISOString(), '2026-11-01T05:00:00.000Z')
})

test('monthWindowUtc: July 2026 is a half-open Central month', () => {
  const w = monthWindowUtc(2026, 7)
  assert.equal(w.start, '2026-07-01T05:00:00.000Z')
  assert.equal(w.end, '2026-08-01T05:00:00.000Z')
})

test('monthWindowUtc: December rolls the year', () => {
  const w = monthWindowUtc(2026, 12)
  assert.equal(w.start, '2026-12-01T06:00:00.000Z')
  assert.equal(w.end, '2027-01-01T06:00:00.000Z')
})

test('monthWindowUtc: November window spans the DST change', () => {
  // Starts CDT (-5), ends CST (-6). A naive fixed-offset implementation gets
  // one of these two wrong.
  const w = monthWindowUtc(2026, 11)
  assert.equal(w.start, '2026-11-01T05:00:00.000Z')
  assert.equal(w.end, '2026-12-01T06:00:00.000Z')
})

test('THE BUG: a ticket billed 7:30 PM Central on the last of the month stays in that month', () => {
  // 2026-06-30 19:30 Central == 2026-07-01T00:30Z. Under the old UTC window this
  // landed in July. It is June work and must be paid in June.
  const billedAt = new Date('2026-07-01T00:30:00.000Z')

  const june = monthWindowUtc(2026, 6)
  const july = monthWindowUtc(2026, 7)
  const inWindow = (w: { start: string; end: string }) =>
    billedAt >= new Date(w.start) && billedAt < new Date(w.end)

  assert.equal(inWindow(june), true, 'must fall in June')
  assert.equal(inWindow(july), false, 'must NOT fall in July')
  assert.equal(monthKeyInZone(billedAt), '2026-06')

  // And the old UTC-boundary behaviour, pinned so the regression is legible:
  const oldJulyStart = new Date('2026-07-01T00:00:00.000Z')
  assert.equal(billedAt >= oldJulyStart, true, 'the old window would have caught it in July')
})

test('month windows are contiguous: no gap, no overlap across a year', () => {
  for (let m = 1; m <= 11; m++) {
    assert.equal(
      monthWindowUtc(2026, m).end,
      monthWindowUtc(2026, m + 1).start,
      `month ${m} end must equal month ${m + 1} start`,
    )
  }
  assert.equal(monthWindowUtc(2026, 12).end, monthWindowUtc(2027, 1).start)
})

test('dateRangeWindowUtc: `to` is included in full', () => {
  const w = dateRangeWindowUtc('2026-06-01', '2026-06-30')
  assert.equal(w.start, '2026-06-01T05:00:00.000Z')
  // End is the START of July 1 Central, so all of June 30 is inside.
  assert.equal(w.end, '2026-07-01T05:00:00.000Z')

  const lastMomentOfJune30 = new Date('2026-07-01T04:59:59.999Z')
  assert.equal(lastMomentOfJune30 < new Date(w.end), true)
})

test('dateRangeWindowUtc: a single day is a full 24h (CDT)', () => {
  const w = dateRangeWindowUtc('2026-06-15', '2026-06-15')
  const hours = (new Date(w.end).getTime() - new Date(w.start).getTime()) / 3_600_000
  assert.equal(hours, 24)
})

test('dateRangeWindowUtc: the short DST day is 23h, the long one 25h', () => {
  const spring = dateRangeWindowUtc('2026-03-08', '2026-03-08')
  const fall = dateRangeWindowUtc('2026-11-01', '2026-11-01')
  const hrs = (w: { start: string; end: string }) =>
    (new Date(w.end).getTime() - new Date(w.start).getTime()) / 3_600_000
  assert.equal(hrs(spring), 23)
  assert.equal(hrs(fall), 25)
})

test('dateRangeWindowUtc: `to` on a month end rolls into the next month', () => {
  const w = dateRangeWindowUtc('2026-12-31', '2026-12-31')
  assert.equal(w.start, '2026-12-31T06:00:00.000Z')
  assert.equal(w.end, '2027-01-01T06:00:00.000Z')
})

test('monthKeyInZone: the UTC-vs-Central month flip', () => {
  // Same instant, two answers. Central is the correct one for payouts.
  const instant = '2026-07-01T02:00:00.000Z' // 9:00 PM Central on Jun 30
  assert.equal(monthKeyInZone(instant), '2026-06')
  assert.equal(instant.slice(0, 7), '2026-07') // what the naive slice would say
})

test('dayKeyInZone: the UTC-vs-Central day flip', () => {
  const instant = '2026-07-01T02:00:00.000Z'
  assert.equal(dayKeyInZone(instant), '2026-06-30')
  assert.equal(instant.slice(0, 10), '2026-07-01') // naive slice
})

test('monthKeyInZone round-trips against monthWindowUtc', () => {
  for (let m = 1; m <= 12; m++) {
    const w = monthWindowUtc(2026, m)
    const key = `2026-${String(m).padStart(2, '0')}`
    // First instant of the window is in the month...
    assert.equal(monthKeyInZone(w.start), key)
    // ...and the last instant before the end is too.
    assert.equal(monthKeyInZone(new Date(new Date(w.end).getTime() - 1)), key)
  }
})
