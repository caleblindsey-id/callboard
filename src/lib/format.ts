// Canonical money/date formatters. Single source of truth for callsites that
// previously duplicated these helpers across the app.
//
// All date output is pinned to the business timezone (America/Chicago) and the
// en-US locale. Unpinned toLocaleDateString diverges between Vercel SSR (UTC)
// and the browser (user zone), which hydrated /billing dates one day apart
// (React #418) and displayed DATE columns off by one for Central-time users.
//
// formatMoney   — "$X.XX" or em-dash for null/undefined
// formatDate    — "Mon DD, YYYY"
// formatDateShort — "M/D/YYYY" — the compact table-cell format.
// formatDateTime — "M/D/YYYY h:MM AM/PM" — date + short time.
//                  Used where the timestamp matters (parts queue activity).
// formatDateTimeLong — "Jun 2, 2026 · 3:14 PM" — long date + short time, for
//                  timestamped log entries (e.g. billing/contact notes).

const BUSINESS_TIME_ZONE = 'America/Chicago'
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

// A Postgres DATE carries no timezone; anchor it to noon UTC so the calendar
// day survives rendering in any zone (noon UTC is 6-7 AM in Chicago, same day).
function toDate(value: string | Date): Date {
  if (typeof value === 'string' && DATE_ONLY.test(value)) {
    return new Date(value + 'T12:00:00Z')
  }
  return value instanceof Date ? value : new Date(value)
}

export function formatMoney(amount: number | null | undefined): string {
  if (amount == null) return '—'
  return `$${Number(amount).toFixed(2)}`
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—'
  return toDate(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: BUSINESS_TIME_ZONE,
  })
}

export function formatDateShort(value: string | Date | null | undefined): string {
  if (!value) return '—'
  return toDate(value).toLocaleDateString('en-US', { timeZone: BUSINESS_TIME_ZONE })
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const d = toDate(value)
  const date = d.toLocaleDateString('en-US', { timeZone: BUSINESS_TIME_ZONE })
  const time = d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: BUSINESS_TIME_ZONE,
  })
  return `${date} ${time}`
}

export function formatDateTimeLong(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const d = toDate(value)
  const date = d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: BUSINESS_TIME_ZONE,
  })
  const time = d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: BUSINESS_TIME_ZONE,
  })
  return `${date} · ${time}`
}
