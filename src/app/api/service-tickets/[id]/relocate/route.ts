import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentUser, isTechnician } from '@/lib/auth'

// Mirrors src/app/api/tickets/[id]/relocate/route.ts for service tickets.
// Terminal service statuses where relocation no longer makes sense.
const TERMINAL_STATUSES = ['completed', 'billed', 'declined', 'canceled'] as const

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = (await request.json()) as {
      ship_to_location_id?: unknown
      note?: unknown
    }

    const targetShipToId = Number(body.ship_to_location_id)
    if (!Number.isInteger(targetShipToId) || targetShipToId <= 0) {
      return NextResponse.json(
        { error: 'ship_to_location_id is required' },
        { status: 400 }
      )
    }
    const note = typeof body.note === 'string' ? body.note.trim() : null

    const user = await getCurrentUser()
    if (!user?.role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Defense-in-depth: techs can only relocate their own assigned service
    // tickets. Managers / coordinators / super_admin can relocate any.
    const supabase = await createClient()
    const { data: ticket, error: ticketErr } = await supabase
      .from('service_tickets')
      .select('id, status, deleted_at, customer_id, assigned_technician_id, equipment_id')
      .eq('id', id)
      .is('deleted_at', null)
      .single()

    if (ticketErr || !ticket) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
    }

    if (isTechnician(user.role) && ticket.assigned_technician_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (!ticket.equipment_id) {
      return NextResponse.json(
        { error: 'This ticket has no linked equipment to relocate' },
        { status: 422 }
      )
    }

    if (TERMINAL_STATUSES.includes(ticket.status as typeof TERMINAL_STATUSES[number])) {
      return NextResponse.json(
        { error: `Cannot relocate equipment on a ${ticket.status} ticket` },
        { status: 422 }
      )
    }

    // Pre-validate target ship-to belongs to the same customer (cleaner 4xx
    // than parsing the RPC exception; the RPC enforces it too).
    const { data: targetShipTo, error: shipToErr } = await supabase
      .from('ship_to_locations')
      .select('id, customer_id')
      .eq('id', targetShipToId)
      .single()

    if (shipToErr || !targetShipTo) {
      return NextResponse.json({ error: 'Ship-to not found' }, { status: 404 })
    }

    if (targetShipTo.customer_id !== ticket.customer_id) {
      return NextResponse.json(
        { error: 'Ship-to belongs to a different customer' },
        { status: 422 }
      )
    }

    // Atomic relocate: service_tickets snapshot + equipment home update +
    // history row, all in one transaction. Invoked under service_role so the
    // equipment_tech_field_lock trigger (migration 048) lets the equipment
    // write through.
    const admin = await createAdminClient('SERVER_ONLY')
    const { data: history, error: rpcErr } = await admin.rpc(
      'relocate_equipment_for_service',
      {
        p_service_ticket_id: id,
        p_to_ship_to_id: targetShipToId,
        p_actor: user.id,
        p_note: note,
      }
    )

    if (rpcErr) {
      const msg = rpcErr.message ?? 'Failed to relocate equipment'
      console.error('service-tickets/[id]/relocate RPC error:', rpcErr)
      return NextResponse.json({ error: msg }, { status: 422 })
    }

    return NextResponse.json({ history })
  } catch (err) {
    console.error('service-tickets/[id]/relocate POST error:', err)
    return NextResponse.json(
      { error: 'Failed to relocate equipment' },
      { status: 500 }
    )
  }
}
