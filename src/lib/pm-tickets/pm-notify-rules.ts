// Pure decisions and copy behind the "next month's PMs are ready" technician
// alert. Deliberately free of server-side imports: the `server-only` package
// throws at import time, and both create-notification and send-push import it,
// so anything reachable from a *.test.ts file has to live here rather than in
// notify-generated.ts.

import { BUSINESS_TIME_ZONE } from '@/lib/format'
import { formatMonthYear } from '@/lib/utils/schedule'
import type { PmTicketRow } from '@/types/database'

export type TechnicianPmCount = { technicianId: string; count: number }

export type PmNotificationPayload = {
  title: string
  body: string
  url: string
  tag: string
}

// Is the generated month the current one or later, on the branch's calendar?
// Resolved through America/Chicago, never the raw server clock: Vercel runs UTC,
// so at 11 PM CDT on July 31 a naive comparison reads August and would classify
// a current-month July run as "past".
export function shouldNotifyForMonth(month: number, year: number, now: Date = new Date()): boolean {
  // An out-of-range month never notifies. This is also what keeps
  // buildPmNotification safe: formatMonthYear falls back to a literal em-dash
  // for a bad month, and house rules forbid dashes in user-facing copy. The
  // gate returning false means the builder is never reached with one.
  if (!Number.isInteger(month) || month < 1 || month > 12) return false
  if (!Number.isInteger(year)) return false

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(now)

  const todayYear = Number(parts.find((p) => p.type === 'year')?.value)
  const todayMonth = Number(parts.find((p) => p.type === 'month')?.value)
  if (!Number.isFinite(todayYear) || !Number.isFinite(todayMonth)) return false

  return year * 12 + month >= todayYear * 12 + todayMonth
}

// Newly created PM tickets to one entry per technician. Rows with no assigned
// technician are dropped: nobody is notified about them, and managers already
// see them on the board.
export function groupCreatedByTechnician(
  created: Pick<PmTicketRow, 'assigned_technician_id'>[],
): TechnicianPmCount[] {
  const counts = new Map<string, number>()
  for (const ticket of created) {
    const id = ticket.assigned_technician_id
    if (!id) continue
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return Array.from(counts, ([technicianId, count]) => ({ technicianId, count }))
}

// `appUrl` is a parameter rather than a process.env read so the copy and the URL
// shape stay assertable without mutating the environment.
export function buildPmNotification({
  month,
  year,
  count,
  appUrl,
}: {
  month: number
  year: number
  count: number
  appUrl: string
}): PmNotificationPayload {
  const base = appUrl.replace(/\/$/, '')
  return {
    // Year is always present so a December-generating-January alert cannot be
    // misread as the month just gone.
    title: `${formatMonthYear(month, year)} PMs are ready`,
    body: `${count} PM ticket${count === 1 ? '' : 's'} assigned to you.`,
    url: `${base}/tickets?month=${month}&year=${year}`,
    tag: `pm-generated-${year}-${String(month).padStart(2, '0')}`,
  }
}
