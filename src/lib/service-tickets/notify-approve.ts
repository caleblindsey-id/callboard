// "Your estimate was approved" notification to the assigned technician — the
// mirror of notifyDecline. Fired when a customer approves via the public link
// (POST /api/approve/[token]), a staff member approves in-app, or an estimate
// auto-approves under the customer's threshold (PATCH /api/service-tickets/[id]).
//
// Tells the tech who owns the ticket they're clear to schedule the work / order
// parts. Self-suppression (a tech approving their own estimate, PR #119, or
// submitting their own auto-approved estimate) is handled at the call sites,
// mirroring notifyTechOfAssignment — so this helper just notifies the assignee.
//
// Two instant channels: Web Push + the in-app notification bell. No email by
// design — the assigned tech is the audience, and bench / "inside" techs often
// don't monitor email. Each channel is best-effort and wrapped separately.
// Non-fatal by contract: callers await inside a try/catch so a send failure never
// undoes the approval write.

import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendPushToUser } from '@/lib/push/send-push'
import { createNotification } from '@/lib/notifications/create-notification'

function ticketUrl(id: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? ''
  return base ? `${base}/service/${id}` : `/service/${id}`
}

export async function notifyApprove(ticketId: string): Promise<void> {
  const admin = await createAdminClient('SERVER_ONLY')

  type TicketShape = {
    work_order_number: number | null
    assigned_technician_id: string | null
    auto_approved: boolean | null
    customers: { name: string } | null
  }

  const { data, error } = await admin
    .from('service_tickets')
    .select('work_order_number, assigned_technician_id, auto_approved, customers(name)')
    .eq('id', ticketId)
    .single()
  const ticket = data as unknown as TicketShape | null
  if (error || !ticket) {
    console.error('notifyApprove: ticket fetch failed', error)
    return
  }

  const techId = ticket.assigned_technician_id
  if (!techId) return // unassigned — nobody to tell

  const woLabel = ticket.work_order_number ? `WO-${ticket.work_order_number}` : 'a ticket'
  const title = `Estimate approved — ${woLabel}`
  const outcome = ticket.auto_approved ? 'auto-approved' : 'approved'
  const body =
    [ticket.customers?.name ?? null, `${outcome} — you're clear to proceed`].filter(Boolean).join(' — ')
  const url = ticketUrl(ticketId)

  try {
    await sendPushToUser(techId, { title, body, url, tag: `approve-${ticketId}` })
  } catch (err) {
    console.error('notifyApprove: push send failed', err)
  }

  try {
    await createNotification(techId, {
      type: 'estimate_approved',
      title,
      body,
      url,
      entityType: 'service_ticket',
      entityId: ticketId,
    })
  } catch (err) {
    console.error('notifyApprove: in-app notification failed', err)
  }
}
