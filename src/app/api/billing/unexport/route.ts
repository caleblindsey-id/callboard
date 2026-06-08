import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getUser } from '@/lib/db/users'
import { MANAGER_ROLES } from '@/types/database'

// Send an exported-but-unbilled PM ticket back to the Ready-to-Export queue.
// For the case where a manager exported a ticket by mistake before any invoice
// number was entered. CAS flips billing_exported true -> false (and clears any
// stray invoice number) only while the ticket is still completed + exported, so
// an already-billed ticket can never be silently un-exported. Mirrors the
// billed -> completed re-export reset in api/tickets/[id]/route.ts.

type PmUnexportRow = {
  id: string
  work_order_number: number | null
  status: string
  billing_exported: boolean
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

    const { data: rawTickets, error: fetchError } = await supabase
      .from('pm_tickets')
      .select('id, work_order_number, status, billing_exported')
      .in('id', ticketIds as string[])

    if (fetchError) {
      console.error('[billing/unexport] fetch error:', fetchError)
      return NextResponse.json({ error: 'Failed to load tickets' }, { status: 500 })
    }

    const tickets = (rawTickets ?? []) as unknown as PmUnexportRow[]
    if (tickets.length !== ticketIds.length) {
      return NextResponse.json(
        { error: 'One or more tickets not found' },
        { status: 404 }
      )
    }

    const notAwaiting = tickets.filter(
      (t) => t.status !== 'completed' || !t.billing_exported
    )
    if (notAwaiting.length > 0) {
      const names = notAwaiting
        .map((t) => `WO#${t.work_order_number ?? t.id} (${t.status})`)
        .join(', ')
      return NextResponse.json(
        { error: `Only exported, unbilled tickets can be un-exported: ${names}` },
        { status: 409 }
      )
    }

    // CAS: only revert rows still in the awaiting-invoice state.
    const { data: reverted, error: updateError } = await supabase
      .from('pm_tickets')
      .update({ billing_exported: false, synergy_invoice_number: null })
      .in('id', ticketIds as string[])
      .eq('status', 'completed')
      .eq('billing_exported', true)
      .select('id')

    if (updateError) {
      console.error('[billing/unexport] update error:', updateError)
      return NextResponse.json(
        { error: 'Failed to un-export tickets' },
        { status: 500 }
      )
    }
    if (!reverted || reverted.length === 0) {
      return NextResponse.json(
        { error: 'These tickets changed in another tab/session. Refresh to see the updated list.' },
        { status: 409 }
      )
    }

    return NextResponse.json({ revertedCount: reverted.length })
  } catch (err) {
    console.error('[billing/unexport] unexpected:', err)
    return NextResponse.json({ error: 'Unexpected server error' }, { status: 500 })
  }
}
