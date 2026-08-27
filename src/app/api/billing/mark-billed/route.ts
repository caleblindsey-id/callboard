import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getUser } from '@/lib/db/users'
import { MANAGER_ROLES } from '@/types/database'

// Batch-flip exported PM tickets to 'billed'. A PM ticket only becomes billed
// once the SynergyERP invoice number is on file (one invoice per work order) —
// that's the proof the work was actually invoiced, not just exported to a PDF.
// Mirrors the service-ticket mark-billed flow (synergy_order_number gate). The
// CAS on status='completed' AND billing_exported=true prevents double-billing
// and rejects anything not in the awaiting-invoice queue.

type PmBillingRow = {
  id: string
  work_order_number: number | null
  status: string
  billing_exported: boolean
  synergy_invoice_number: string | null
  po_number: string | null
  customers: { name: string; po_required: boolean } | null
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
      .from('pm_tickets')
      .select(`
        id, work_order_number, status, billing_exported, synergy_invoice_number, po_number,
        customers ( name, po_required )
      `)
      .is('deleted_at', null)
      .in('id', ticketIds as string[])

    if (fetchError) {
      console.error('[billing/mark-billed] fetch error:', fetchError)
      return NextResponse.json({ error: 'Failed to load tickets' }, { status: 500 })
    }

    const tickets = (rawTickets ?? []) as unknown as PmBillingRow[]
    if (tickets.length !== ticketIds.length) {
      return NextResponse.json(
        { error: 'One or more tickets not found' },
        { status: 404 }
      )
    }

    // Must be in the awaiting-invoice queue: completed + exported, not already
    // billed and not still ready-to-export.
    const notAwaiting = tickets.filter(
      (t) => t.status !== 'completed' || !t.billing_exported
    )
    if (notAwaiting.length > 0) {
      const names = notAwaiting
        .map((t) => `WO#${t.work_order_number ?? t.id} (${t.status}${t.billing_exported ? '' : ', not exported'})`)
        .join(', ')
      return NextResponse.json(
        { error: `Only exported, completed tickets can be marked billed: ${names}` },
        { status: 409 }
      )
    }

    const missingInvoice = tickets.filter((t) => !t.synergy_invoice_number?.trim())
    if (missingInvoice.length > 0) {
      const names = missingInvoice
        .map((t) => `WO#${t.work_order_number ?? t.id} (${t.customers?.name ?? 'Unknown'})`)
        .join(', ')
      return NextResponse.json(
        { error: `Missing Synergy invoice #: ${names}` },
        { status: 400 }
      )
    }

    // Hard block: a PO-required customer can't be billed without a PO. The
    // Ready-to-Export gate was relaxed so the Synergy order can be built before
    // the PO arrives; the PO requirement lands here at finalization instead.
    // po_number empty = null OR ''.
    const missingPo = tickets.filter(
      (t) => t.customers?.po_required && !(t.po_number ?? '').trim()
    )
    if (missingPo.length > 0) {
      const names = missingPo
        .map((t) => `WO#${t.work_order_number ?? t.id} (${t.customers?.name ?? 'Unknown'})`)
        .join(', ')
      return NextResponse.json(
        { error: `PO number required before billing: ${names}` },
        { status: 400 }
      )
    }

    // CAS: only flip rows still in the awaiting-invoice state. A concurrent
    // retry hits zero rows and we return 409 so the client refreshes.
    const { data: marked, error: updateError } = await supabase
      .from('pm_tickets')
      .update({ status: 'billed', billed_at: new Date().toISOString() })
      .in('id', ticketIds as string[])
      .is('deleted_at', null)
      .eq('status', 'completed')
      .eq('billing_exported', true)
      .select('id')

    if (updateError) {
      console.error('[billing/mark-billed] update error:', updateError)
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

    return NextResponse.json({ markedCount: marked.length })
  } catch (err) {
    console.error('[billing/mark-billed] unexpected:', err)
    return NextResponse.json({ error: 'Unexpected server error' }, { status: 500 })
  }
}
