// "Next month's PMs are ready" technician alert. Called by
// POST /api/tickets/generate after tickets are created, so a tech learns their
// route exists without having to open the app and notice new rows.
//
// Two channels, matching notify-assignment.ts: Web Push for the phone, and an
// in-app notification row for the bell. No email — this is a once-a-month,
// non-urgent event and does not warrant a message in everyone's inbox.
//
// Best-effort by contract. Each channel is wrapped separately so a push failure
// never costs a tech their bell row, and the caller wraps the whole call so no
// notification failure can fail the generation request. Generated tickets are
// the source of truth; the alert rides on top.
//
// Deliberately NOT called from generatePmTickets(): the schedule-create backfill
// path in POST /api/pm-schedules also generates tickets, and it stays silent by
// never calling this rather than by passing a flag a future edit could forget.
// Do not "simplify" that by routing backfill through here and relying on the
// month gate to suppress it. Backfill is not past-months-only - monthsInRange
// runs through the current month inclusive, so a current-month backfill would
// pass the gate and fire a one-PM push on every schedule creation.

import 'server-only'
import { createNotification } from '@/lib/notifications/create-notification'
import { sendPushToUser } from '@/lib/push/send-push'
import type { PmTicketRow } from '@/types/database'
import {
  buildPmNotification,
  groupCreatedByTechnician,
  shouldNotifyForMonth,
} from './pm-notify-rules'

export type NotifyGeneratedPmsInput = {
  created: Pick<PmTicketRow, 'assigned_technician_id'>[]
  month: number
  year: number
  now?: Date
}

// Returns the number of technicians who got a bell row. Push delivery is not
// counted: the bell is the durable channel, and a tech with no push
// subscription has still legitimately been notified.
export async function notifyTechsOfGeneratedPms({
  created,
  month,
  year,
  now,
}: NotifyGeneratedPmsInput): Promise<number> {
  if (!shouldNotifyForMonth(month, year, now)) return 0

  const groups = groupCreatedByTechnician(created)
  if (groups.length === 0) return 0

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  let notified = 0

  for (const { technicianId, count } of groups) {
    const payload = buildPmNotification({ month, year, count, appUrl })

    // Push first, mirroring notify-assignment.ts. sendPushToUser already
    // short-circuits on the outboundEnabled kill-switch, so a preview
    // environment holding a copy of prod data cannot reach a real device.
    try {
      await sendPushToUser(technicianId, {
        title: payload.title,
        body: payload.body,
        url: payload.url,
        tag: payload.tag,
      })
    } catch (err) {
      console.error('notifyTechsOfGeneratedPms: push send failed', technicianId, err)
    }

    // The bell row. entityType/entityId are null: this points at a month, not a
    // single row, and there is nothing to link beyond url.
    try {
      const id = await createNotification(technicianId, {
        type: 'pm_tickets_generated',
        title: payload.title,
        body: payload.body,
        url: payload.url,
        entityType: null,
        entityId: null,
      })
      if (id) notified++
    } catch (err) {
      console.error('notifyTechsOfGeneratedPms: in-app notification failed', technicianId, err)
    }
  }

  return notified
}
