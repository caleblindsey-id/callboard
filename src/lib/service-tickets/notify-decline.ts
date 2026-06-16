// "An estimate was declined" notification to the assigned technician. Fired when
// a customer declines via the public approval link (POST /api/approve/[token])
// or a staff member declines (PATCH /api/service-tickets/[id], status → declined).
//
// Before this, a decline was silent — the customer saw "a member of our team will
// follow up," but no message ever reached anyone. This closes that gap so the
// tech who owns the ticket knows the quote was rejected and can follow up or let
// the office close it out (the managers' declined worklist, Round 3, covers
// unassigned tickets).
//
// Two instant channels, mirroring notifyTechOfAssignment's push + bell path:
// Web Push + the in-app notification bell. No email by design — the assigned tech
// is the audience, and bench / "inside" techs often don't monitor email, which is
// exactly what the bell exists for. Each channel is best-effort and wrapped
// separately. Non-fatal by contract: callers await inside a try/catch so a send
// failure never undoes the decline write.

import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendPushToUser } from '@/lib/push/send-push'
import { createNotification } from '@/lib/notifications/create-notification'

function ticketUrl(id: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? ''
  return base ? `${base}/service/${id}` : `/service/${id}`
}

export async function notifyDecline(ticketId: string): Promise<void> {
  const admin = await createAdminClient('SERVER_ONLY')

  type TicketShape = {
    work_order_number: number | null
    assigned_technician_id: string | null
    decline_reason: string | null
    customers: { name: string } | null
  }

  const { data, error } = await admin
    .from('service_tickets')
    .select('work_order_number, assigned_technician_id, decline_reason, customers(name)')
    .eq('id', ticketId)
    .single()
  const ticket = data as unknown as TicketShape | null
  if (error || !ticket) {
    console.error('notifyDecline: ticket fetch failed', error)
    return
  }

  const techId = ticket.assigned_technician_id
  if (!techId) return // unassigned — the managers' declined worklist covers it

  const woLabel = ticket.work_order_number ? `WO-${ticket.work_order_number}` : 'a ticket'
  const title = `Estimate declined — ${woLabel}`
  const body =
    [ticket.customers?.name ?? null, ticket.decline_reason?.trim() || null].filter(Boolean).join(' — ') ||
    'The customer declined this estimate.'
  const url = ticketUrl(ticketId)

  try {
    await sendPushToUser(techId, { title, body, url, tag: `decline-${ticketId}` })
  } catch (err) {
    console.error('notifyDecline: push send failed', err)
  }

  try {
    await createNotification(techId, {
      type: 'estimate_declined',
      title,
      body,
      url,
      entityType: 'service_ticket',
      entityId: ticketId,
    })
  } catch (err) {
    console.error('notifyDecline: in-app notification failed', err)
  }
}
