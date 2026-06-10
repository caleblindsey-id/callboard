import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getUser } from '@/lib/db/users'
import { MANAGER_ROLES } from '@/types/database'

// Mark completed service tickets as billing-exported. This is the state half of
// the export step — the work-order PDF itself is generated client-side by reusing
// POST /api/service-tickets/[id]/work-order-pdf, so billing state stays OUT of
// that tech-reachable, customer-facing route. Export does NOT bill: tickets stay
// status='completed' and move to the "Awaiting Invoice #" queue, becoming 'billed'
// only once a manager keys the SynergyERP invoice # (POST /api/billing/service/
// mark-billed). The CAS on billing_exported=false makes a duplicate retry no-op.
// Mirrors the mark-exported step in /api/billing/pdf.

type ServiceExportRow = {
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

    // Fetch + validate up front so we return one actionable error instead of a 500.
    const { data: rawTickets, error: fetchError } = await supabase
      .from('service_tickets')
      .select('id, work_order_number, status, billing_exported')
      .in('id', ticketIds as string[])

    if (fetchError) {
      console.error('[billing/service/export] fetch error:', fetchError)
      return NextResponse.json({ error: 'Failed to load tickets' }, { status: 500 })
    }

    const tickets = (rawTickets ?? []) as unknown as ServiceExportRow[]
    if (tickets.length !== ticketIds.length) {
      return NextResponse.json({ error: 'One or more tickets not found' }, { status: 404 })
    }

    const notExportable = tickets.filter(
      (t) => t.status !== 'completed' || t.billing_exported
    )
    if (notExportable.length > 0) {
      const names = notExportable
        .map((t) => `WO#${t.work_order_number ?? t.id} (${t.billing_exported ? 'already exported' : t.status})`)
        .join(', ')
      return NextResponse.json(
        { error: `Only completed, not-yet-exported tickets can be exported: ${names}` },
        { status: 409 }
      )
    }

    // CAS: only flip rows still completed + un-exported. A concurrent retry hits
    // zero rows and gets a 409 so the client refreshes.
    const { data: marked, error: updateError } = await supabase
      .from('service_tickets')
      .update({ billing_exported: true, billing_exported_at: new Date().toISOString() })
      .in('id', ticketIds as string[])
      .eq('status', 'completed')
      .eq('billing_exported', false)
      .select('id')

    if (updateError) {
      console.error('[billing/service/export] update error:', updateError)
      return NextResponse.json({ error: 'Failed to mark tickets exported' }, { status: 500 })
    }
    if (!marked || marked.length === 0) {
      return NextResponse.json(
        { error: 'These tickets were already exported in another tab/session. Refresh to see the updated list.' },
        { status: 409 }
      )
    }

    return NextResponse.json({ exportedCount: marked.length })
  } catch (err) {
    console.error('[billing/service/export] unexpected:', err)
    return NextResponse.json({ error: 'Unexpected server error' }, { status: 500 })
  }
}
