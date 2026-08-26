// Central-anchored time boundaries.
//
// The business runs on America/Chicago. Postgres stores timestamptz, Vercel runs
// in UTC, and the two disagree by 5 or 6 hours depending on DST. Anywhere we turn
// a CALENDAR concept (a month, a date range) into an INSTANT range for a query,
// that gap decides which month a ticket's money lands in.
//
// Before this file, both month-bucketing callsites built their windows in UTC:
//
//   `${year}-${month}-01T00:00:00.000Z`
//
// which is 7:00 PM Central on the LAST DAY OF THE PREVIOUS MONTH. A ticket billed
// between 7 PM and midnight Central on the last of the month was therefore counted
// in the following month. On a commission report that is not cosmetic: the rate
// applies to the whole subtotal, so boundaries are cliffs, and one misplaced
// ticket can move a tech across a tier and change their commission by hundreds.
//
// Use these helpers for any month or date-range query on billed_at, earned_at,
// approved_at, or paid_at. For DISPLAY formatting see src/lib/format.ts, which
// already pins to the same zone.
//
// Deliberately dependency-free and server-free: no date library, and nothing
// imported that pulls in `server-only`, so this is safe in client components and
// directly unit-testable.

import { BUSINESS_TIME_ZONE } from './format'

export { BUSINESS_TIME_ZONE }

/**
 * Offset in ms between the given instant and how that instant reads as wall time
 * in `timeZone`. Positive east of UTC. For America/Chicago this is -5h (CDT) or
 * -6h (CST).
 */
function offsetMsAt(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs))

  const v: Record<string, number> = {}
  for (const p of parts) {
    if (p.type !== 'literal') v[p.type] = Number(p.value)
  }
  // Some engines render midnight as hour 24 under hour12:false.
  const hour = v.hour === 24 ? 0 : v.hour
  const asIfUtc = Date.UTC(v.year, v.month - 1, v.day, hour, v.minute, v.second)
  return asIfUtc - utcMs
}

/**
 * The UTC instant at which the given calendar day STARTS in `timeZone`.
 *
 * zonedDayStartUtc(2026, 7, 1) -> 2026-07-01T05:00:00.000Z  (CDT, UTC-5)
 * zonedDayStartUtc(2026, 1, 1) -> 2026-01-01T06:00:00.000Z  (CST, UTC-6)
 *
 * Month is 1-based, matching how every callsite already talks about months.
 */
export function zonedDayStartUtc(
  year: number,
  month: number,
  day: number,
  timeZone: string = BUSINESS_TIME_ZONE,
): Date {
  const naive = Date.UTC(year, month - 1, day, 0, 0, 0)
  // First pass uses the offset at the naive instant, which is close enough to
  // land in the right day. Second pass re-reads the offset at the resolved
  // instant so a DST boundary between the two resolves correctly.
  const firstPass = naive - offsetMsAt(naive, timeZone)
  return new Date(naive - offsetMsAt(firstPass, timeZone))
}

/**
 * Half-open [start, end) instant window covering a calendar MONTH in `timeZone`.
 * Half-open, not inclusive: an inclusive end (`23:59:59`) silently drops the
 * final second, and sub-second timestamps in that gap vanish from every report.
 */
export function monthWindowUtc(
  year: number,
  month: number,
  timeZone: string = BUSINESS_TIME_ZONE,
): { start: string; end: string } {
  const nextMonth = month === 12 ? 1 : month + 1
  const nextYear = month === 12 ? year + 1 : year
  return {
    start: zonedDayStartUtc(year, month, 1, timeZone).toISOString(),
    end: zonedDayStartUtc(nextYear, nextMonth, 1, timeZone).toISOString(),
  }
}

/**
 * Half-open [start, end) instant window covering an INCLUSIVE range of calendar
 * dates in `timeZone`. `from` and `to` are 'YYYY-MM-DD'; `to` is included in
 * full, so the window ends at the start of the following day.
 */
export function dateRangeWindowUtc(
  from: string,
  to: string,
  timeZone: string = BUSINESS_TIME_ZONE,
): { start: string; end: string } {
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  const start = zonedDayStartUtc(fy, fm, fd, timeZone)
  // Date.UTC normalises overflow, so day+1 rolls the month/year correctly.
  const dayAfter = new Date(Date.UTC(ty, tm - 1, td + 1))
  const end = zonedDayStartUtc(
    dayAfter.getUTCFullYear(),
    dayAfter.getUTCMonth() + 1,
    dayAfter.getUTCDate(),
    timeZone,
  )
  return { start: start.toISOString(), end: end.toISOString() }
}

/**
 * The 'YYYY-MM' payout period an instant falls in, read in `timeZone`.
 * This is the canonical way to derive payout_periods.period from a timestamp --
 * `.toISOString().slice(0, 7)` reads it in UTC and lands the last evening of
 * each month in the wrong period.
 */
export function monthKeyInZone(
  value: string | Date,
  timeZone: string = BUSINESS_TIME_ZONE,
): string {
  const d = value instanceof Date ? value : new Date(value)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(d)
  const year = parts.find((p) => p.type === 'year')!.value
  const month = parts.find((p) => p.type === 'month')!.value
  return `${year}-${month}`
}

/**
 * The 'YYYY-MM-DD' calendar day an instant falls on, read in `timeZone`.
 * Same trap as monthKeyInZone: `.toISOString().slice(0, 10)` is a UTC day.
 */
export function dayKeyInZone(
  value: string | Date,
  timeZone: string = BUSINESS_TIME_ZONE,
): string {
  const d = value instanceof Date ? value : new Date(value)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)!.value
  return `${get('year')}-${get('month')}-${get('day')}`
}
