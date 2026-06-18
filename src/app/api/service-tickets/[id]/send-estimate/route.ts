export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, isTechnician, canCreateServiceTickets } from '@/lib/auth'
import { getServiceTicket } from '@/lib/db/service-tickets'
import { createAdminClient } from '@/lib/supabase/admin'
import { MandrillError } from '@/lib/mandrill'
import { sendEstimateNotice } from '@/lib/service-tickets/send-estimate-notice'

// Manual "Email Estimate" action. The actual token + render + send + audit-stamp
// work lives in the shared sendEstimateNotice() helper (also used by the R4
// re-notify cron); this route is the gated front door that maps the helper's
// recoverable outcomes to the HTTP messages the UI already expects. Managers and
// coordinators can email any ticket; a technician may email only their own
// assigned ticket, and only if the per-tech create-service-tickets capability is on.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const user = await getCurrentUser()
    if (!user?.role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    // canCreateServiceTickets() is true for all manager roles and for a
    // technician only when the per-tech flag is on — exactly the gate we want.
    if (!canCreateServiceTickets(user)) {
      return NextResponse.json(
        { error: 'You do not have permission to email estimates.' },
        { status: 403 }
      )
    }

    // Techs are limited to their own assigned tickets (managers/coordinators: any).
    const isTech = isTechnician(user.role)
    if (isTech) {
      const ticket = await getServiceTicket(id)
      if (!ticket) {
        return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
      }
      if (ticket.assigned_technician_id !== user.id) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    let result: Awaited<ReturnType<typeof sendEstimateNotice>>
    try {
      // Ownership is already verified above. A tech's cookie session lacks RLS
      // write on service_tickets, so run the helper's token/audit writes under a
      // service-role client for techs; managers keep the request-scoped client.
      const db = isTech ? await createAdminClient('SERVER_ONLY') : undefined
      result = await sendEstimateNotice(id, db)
    } catch (err) {
      // From-address / Mandrill failures surface as a 502 with the helper's message.
      if (err instanceof MandrillError) {
        return NextResponse.json({ error: err.message }, { status: 502 })
      }
      // App-URL misconfig and "ticket not found" land here.
      const message = err instanceof Error ? err.message : 'Failed to send estimate'
      const notFound = /not found/i.test(message)
      console.error('send-estimate POST error:', err)
      return NextResponse.json({ error: notFound ? 'Ticket not found' : message }, {
        status: notFound ? 404 : 500,
      })
    }

    if (!result.sent) {
      switch (result.reason) {
        case 'not_estimated':
          return NextResponse.json(
            { error: 'Can only email estimates from tickets in the estimated state' },
            { status: 409 }
          )
        case 'no_email':
          return NextResponse.json(
            { error: 'No contact email on this ticket — add one before emailing the estimate.' },
            { status: 400 }
          )
        case 'status_changed':
          return NextResponse.json(
            { error: 'Ticket status changed before send — refresh and try again.' },
            { status: 409 }
          )
      }
    }

    return NextResponse.json({
      ok: true,
      message_id: result.messageId,
      emailed_at: new Date().toISOString(),
      approval_url: result.approvalUrl,
      notify_count: result.notifyCount,
    })
  } catch (err) {
    console.error('service-tickets/[id]/send-estimate POST error:', err)
    return NextResponse.json({ error: 'Failed to send estimate' }, { status: 500 })
  }
}
