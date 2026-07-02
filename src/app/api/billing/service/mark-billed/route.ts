import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getUser } from '@/lib/db/users'
import { MANAGER_ROLES } from '@/types/database'
import { sendPickupNotice } from '@/lib/service-tickets/send-pickup-notice'

// Batch-flip exported service tickets to 'billed'. Export-first (migration 106):
// a ticket must already be billing_exported (manager pulled the work-order PDF)
// AND have a Synergy invoice # keyed before it can be billed. The CAS on
// status='completed' + billing_exported=true prevents double-billing and blocks
// any not-yet-exported ticket from skipping the queue.

type ServiceTicketBillingRow = {
  id: string
  work_order_number: number | null
  status: string
  billing_exported: boolean
  synergy_invoice_number: string | null
  ticket_type: string | null
  awaiting_pickup: boolean | null
  ready_for_pickup_at: string | null
  billing_type: string | null
  warranty_credit_received_at: string | null
  customers: { name: string } | null
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const ticketIds = (body as { ticketIds?: unknown }).ticketIds
    if (
      !Array.isArray(ticketIds) ||
      ticketIds.length === 0 ||
      !ticketIds.every((id) => typeof id === 'string')
    ) {
      return NextResponse.json(
        { error: 'ticketIds must be a non-empty array of strings' },
        { status: 400 }
      )
    }

    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const dbUser = await getUser(user.id)
    if (!dbUser || !dbUser.role || !MANAGER_ROLES.includes(dbUser.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Fetch and validate up front (one round trip) so we can give a single,
    // actionable error message instead of a 500 from the CAS update.
    const { data: rawTickets, error: fetchError } = await supabase
      .from('service_tickets')
      .select(`
        id, work_order_number, status, billing_exported, synergy_invoice_number,
        ticket_type, awaiting_pickup, ready_for_pickup_at,
        billing_type, warranty_credit_received_at,
        customers ( name )
      `)
      .in('id', ticketIds as string[])

    if (fetchError) {
      console.error('[billing/service/mark-billed] fetch error:', fetchError)
      return NextResponse.json({ error: 'Failed to load tickets' }, { status: 500 })
    }

    const tickets = (rawTickets ?? []) as unknown as ServiceTicketBillingRow[]
    if (tickets.length !== ticketIds.length) {
      return NextResponse.json(
        { error: 'One or more tickets not found' },
        { status: 404 }
      )
    }

    const notCompleted = tickets.filter((t) => t.status !== 'completed')
    if (notCompleted.length > 0) {
      const names = notCompleted
        .map((t) => `WO#${t.work_order_number ?? t.id} (${t.status})`)
        .join(', ')
      return NextResponse.json(
        { error: `Only completed tickets can be marked billed: ${names}` },
        { status: 409 }
      )
    }

    const notExported = tickets.filter((t) => !t.billing_exported)
    if (notExported.length > 0) {
      const names = notExported
        .map((t) => `WO#${t.work_order_number ?? t.id} (${t.customers?.name ?? 'Unknown'})`)
        .join(', ')
      return NextResponse.json(
        { error: `Tickets must be exported before billing: ${names}` },
        { status: 409 }
      )
    }

    // Hard block (parity with the single-ticket PATCH gate): warranty work
    // isn't billed until the vendor credit lands. Billing before the credit
    // closes the claim prematurely — cleared by logging the credit on the
    // warranty-claims worklist (warranty_credit_received_at).
    const awaitingCredit = tickets.filter(
      (t) =>
        (t.billing_type === 'warranty' || t.billing_type === 'partial_warranty') &&
        !t.warranty_credit_received_at
    )
    if (awaitingCredit.length > 0) {
      const names = awaitingCredit
        .map((t) => `WO#${t.work_order_number ?? t.id} (${t.customers?.name ?? 'Unknown'})`)
        .join(', ')
      return NextResponse.json(
        { error: `Vendor credit not yet received — log the warranty credit before billing: ${names}` },
        { status: 400 }
      )
    }

    const missingSynergy = tickets.filter((t) => !t.synergy_invoice_number)
    if (missingSynergy.length > 0) {
      const names = missingSynergy
        .map((t) => `WO#${t.work_order_number ?? t.id} (${t.customers?.name ?? 'Unknown'})`)
        .join(', ')
      return NextResponse.json(
        { error: `Missing Synergy invoice #: ${names}` },
        { status: 400 }
      )
    }

    // CAS: only flip rows still in 'completed'. A concurrent retry hits zero
    // rows and we return 409 so the client refreshes.
    const { data: marked, error: updateError } = await supabase
      .from('service_tickets')
      .update({ status: 'billed' })
      .in('id', ticketIds as string[])
      .eq('status', 'completed')
      .eq('billing_exported', true)
      .select('id')

    if (updateError) {
      console.error('[billing/service/mark-billed] update error:', updateError)
      return NextResponse.json(
        { error: 'Failed to mark tickets billed' },
        { status: 500 }
      )
    }
    if (!marked || marked.length === 0) {
      return NextResponse.json(
        { error: 'These tickets were already billed in another tab/session. Refresh to see the updated list.' },
        { status: 409 }
      )
    }

    // --- Ready-for-pickup auto-stage (parity with PATCH /service-tickets/[id]) ---
    // Billing through this batch queue is the normal workflow, so it must stage an
    // INSIDE (bench/depot) unit to the pickup queue the moment it's invoiced —
    // exactly what the single-ticket PATCH route does. Without this, inside units
    // billed here never surface in /pickup-queue and never get the customer notice
    // (the gap that left WO #683 un-staged until someone pushed it manually).
    // Same guard as PATCH: inside only, and not already staged (so a reopen→re-bill
    // can't re-stamp the aging clock).
    const markedIds = new Set(marked.map((m) => m.id))
    const toStage = tickets
      .filter(
        (t) =>
          markedIds.has(t.id) &&
          t.ticket_type === 'inside' &&
          !t.awaiting_pickup &&
          !t.ready_for_pickup_at
      )
      .map((t) => t.id)

    if (toStage.length > 0) {
      const { error: stageError } = await supabase
        .from('service_tickets')
        .update({
          awaiting_pickup: true,
          ready_for_pickup_at: new Date().toISOString(),
        })
        .in('id', toStage)
        .is('ready_for_pickup_at', null)

      if (stageError) {
        // Non-fatal: the billing itself succeeded. Log so the unit can be staged
        // manually if this rare write fails.
        console.error('[billing/service/mark-billed] pickup stage error:', stageError)
      } else {
        // Instant pickup-ready notice per staged unit, after the stage commits so a
        // send failure can't undo staging. Non-fatal (Round 4 scanner retries).
        for (const sid of toStage) {
          try {
            const notice = await sendPickupNotice(sid)
            if (!notice.sent && notice.reason === 'no_email') {
              console.info(`pickup-notice: ${sid} has no email on file — routed to Needs Call queue`)
            }
          } catch (notifyErr) {
            console.error('pickup-notice: send failed (unit staged; scanner will retry)', notifyErr)
          }
        }
      }
    }

    return NextResponse.json({ markedCount: marked.length, stagedCount: toStage.length })
  } catch (err) {
    console.error('[billing/service/mark-billed] unexpected:', err)
    return NextResponse.json({ error: 'Unexpected server error' }, { status: 500 })
  }
}
