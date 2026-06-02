// Canonical money/date formatters. Single source of truth for callsites that
// previously duplicated these helpers across the app.
//
// formatMoney   — "$X.XX" or em-dash for null/undefined
// formatDate    — "Mon DD, YYYY". Handles both date-only ("YYYY-MM-DD",
//                 normalized to local noon to avoid UTC-midnight rendering
//                 as the previous day in CST) and full ISO timestamps.
// formatDateTime — "M/D/YYYY h:MM AM/PM" — locale-default date + short time.
//                  Used where the timestamp matters (parts queue activity).
// formatDateTimeLong — "Jun 2, 2026 · 3:14 PM" — long date + short time, for
//                  timestamped log entries (e.g. billing/contact notes).

export function formatMoney(amount: number | null | undefined): string {
  if (amount == null) return '—'
  return `$${Number(amount).toFixed(2)}`
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const d =
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? new Date(value + 'T12:00:00')
      : new Date(value)
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const d = value instanceof Date ? value : new Date(value)
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
}

export function formatDateTimeLong(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const d = value instanceof Date ? value : new Date(value)
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return `${date} · ${time}`
}
