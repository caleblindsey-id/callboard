/**
 * Period selection for the analytics pages.
 *
 * `/analytics` and `/analytics/[technicianId]` let the viewer page back through
 * historical periods. The anchor is a single `YYYY-MM-DD` date; the server turns
 * it into a range via `getMonthRange`/`getWeekRange` in `lib/db/analytics.ts`.
 *
 * Everything here is **UTC-noon anchored**, exactly like those two helpers. That
 * is load-bearing: anchor at midnight and a `setUTCDate`/`setUTCMonth` walk can
 * land on the wrong side of a month edge, so the picker's label would disagree
 * with the range the server computed for the same date.
 *
 * Note this is UTC, not the Central-anchored month used by payouts
 * (`lib/business-time.ts`). Analytics has always bucketed by UTC month;
 * reconciling the two would move every historical number and is a separate call.
 */

export type AnalyticsPeriodType = 'weekly' | 'monthly'
export type AnalyticsTicketType = 'pm' | 'service' | 'combined'

export const ANALYTICS_PERIOD_TYPES: readonly AnalyticsPeriodType[] = ['weekly', 'monthly']
export const ANALYTICS_TICKET_TYPES: readonly AnalyticsTicketType[] = ['pm', 'service', 'combined']

export const ANALYTICS_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** How many months the picker's dropdown offers. */
export const MONTH_OPTION_COUNT = 24

export interface AnalyticsParams {
  periodType: AnalyticsPeriodType
  /** `YYYY-MM-DD` anchor — any day inside the period the viewer selected. */
  date: string
  ticketType: AnalyticsTicketType
}

export interface MonthOption {
  /** First of the month, `YYYY-MM-DD` — the anchor to send to the server. */
  value: string
  /** e.g. `"August 2026"`. */
  label: string
}

function toUtcNoon(date: string): Date {
  return new Date(date + 'T12:00:00Z')
}

function toDateKey(d: Date): string {
  return d.toISOString().split('T')[0]
}

/** Today in UTC, as `YYYY-MM-DD`. */
export function todayKey(now: Date = new Date()): string {
  return toDateKey(now)
}

/**
 * A real calendar day in `YYYY-MM-DD`.
 *
 * Stricter than the regex alone, which lets `2026-02-31` and `2026-13-01`
 * through — `Date` would silently roll those forward to a different month.
 */
export function isValidDateKey(value: string): boolean {
  if (!ANALYTICS_DATE_RE.test(value)) return false
  const d = new Date(value + 'T12:00:00Z')
  // Rejects real-looking-but-impossible dates (2026-02-31, month 13) that the
  // regex alone lets through — `Date` would silently roll them forward.
  return !Number.isNaN(d.getTime()) && toDateKey(d) === value
}

/**
 * Normalise the `?period=&date=&type=` triplet.
 *
 * Anything missing or malformed falls back to the page's historical default
 * (current month, combined) rather than erroring — a bad hand-edited URL should
 * still render a usable page. Shared by both SSR pages and the team API route so
 * the three cannot drift apart.
 */
export function parseAnalyticsParams(
  raw: {
    period?: string | string[] | null
    date?: string | string[] | null
    type?: string | string[] | null
  } = {},
  now: Date = new Date()
): AnalyticsParams {
  const first = (v: string | string[] | null | undefined): string =>
    (Array.isArray(v) ? v[0] : v) ?? ''

  const period = first(raw.period)
  const date = first(raw.date)
  const type = first(raw.type)

  const periodType: AnalyticsPeriodType = ANALYTICS_PERIOD_TYPES.includes(
    period as AnalyticsPeriodType
  )
    ? (period as AnalyticsPeriodType)
    : 'monthly'

  const ticketType: AnalyticsTicketType = ANALYTICS_TICKET_TYPES.includes(
    type as AnalyticsTicketType
  )
    ? (type as AnalyticsTicketType)
    : 'combined'

  const today = todayKey(now)
  // Future anchors would only ever render zeros, so clamp rather than honour.
  const resolvedDate = isValidDateKey(date) && date <= today ? date : today

  return { periodType, date: resolvedDate, ticketType }
}

/**
 * Move the anchor one period in `direction`.
 *
 * Monthly steps clamp to the target month's last day, so stepping back from
 * Mar 31 lands on Feb 28/29 instead of skipping February entirely (which is what
 * a naive `setUTCMonth(-1)` does).
 */
export function stepPeriod(
  date: string,
  periodType: AnalyticsPeriodType,
  direction: -1 | 1
): string {
  const d = toUtcNoon(date)

  if (periodType === 'weekly') {
    d.setUTCDate(d.getUTCDate() + 7 * direction)
    return toDateKey(d)
  }

  const year = d.getUTCFullYear()
  const month = d.getUTCMonth()
  const day = d.getUTCDate()
  const lastDayOfTarget = new Date(Date.UTC(year, month + direction + 1, 0)).getUTCDate()
  return toDateKey(
    new Date(Date.UTC(year, month + direction, Math.min(day, lastDayOfTarget), 12))
  )
}

/**
 * True when the anchor already sits in the current period, i.e. the "next"
 * arrow should be disabled.
 */
export function isCurrentPeriod(
  date: string,
  periodType: AnalyticsPeriodType,
  now: Date = new Date()
): boolean {
  const a = toUtcNoon(date)
  const b = toUtcNoon(todayKey(now))

  if (periodType === 'monthly') {
    return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth()
  }
  return mondayOf(a) === mondayOf(b)
}

/** Monday of the week containing `d`, as `YYYY-MM-DD`. Mirrors `getWeekRange`. */
function mondayOf(d: Date): string {
  const day = d.getUTCDay()
  const diff = day === 0 ? -6 : 1 - day
  const monday = new Date(d)
  monday.setUTCDate(d.getUTCDate() + diff)
  return toDateKey(monday)
}

/** e.g. `"2026-08-04"` → `"August 2026"`. */
export function monthLabel(date: string): string {
  return toUtcNoon(date).toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/**
 * The dropdown's entries: `count` months ending with the current one,
 * newest first. Each value is the 1st of its month.
 */
export function monthOptions(count: number = MONTH_OPTION_COUNT, now: Date = new Date()): MonthOption[] {
  const today = toUtcNoon(todayKey(now))
  const year = today.getUTCFullYear()
  const month = today.getUTCMonth()

  const options: MonthOption[] = []
  for (let i = 0; i < count; i++) {
    const value = toDateKey(new Date(Date.UTC(year, month - i, 1, 12)))
    options.push({ value, label: monthLabel(value) })
  }
  return options
}

/**
 * The month `<select>`'s current value: the 1st of the anchor's month.
 *
 * The anchor is an arbitrary day (and in weekly mode moves within the month), so
 * the raw anchor rarely equals an option value.
 */
export function monthValueOf(date: string): string {
  const d = toUtcNoon(date)
  return toDateKey(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 12)))
}

/** Serialise the triplet for a URL, omitting nothing — all three are always meaningful. */
export function analyticsQuery(params: AnalyticsParams): string {
  return new URLSearchParams({
    period: params.periodType,
    date: params.date,
    type: params.ticketType,
  }).toString()
}
