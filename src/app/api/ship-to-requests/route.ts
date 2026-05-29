import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser, isTechnician } from '@/lib/auth'

const STAFF_ROLES = ['manager', 'coordinator', 'super_admin'] as const

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      customer_id?: unknown
      pm_ticket_id?: unknown
      service_ticket_id?: unknown
      equipment_id?: unknown
      note?: unknown
    }

    const customerId = Number(body.customer_id)
    if (!Number.isInteger(customerId) || customerId <= 0) {
      return NextResponse.json(
        { error: 'customer_id is required' },
        { status: 400 }
      )
    }

    const note = typeof body.note === 'string' ? body.note.trim() : ''
    if (!note) {
      return NextResponse.json(
        { error: 'note is required — describe the new location' },
        { status: 400 }
      )
    }

    const pmTicketId = typeof body.pm_ticket_id === 'string' ? body.pm_ticket_id : null
    const serviceTicketId = typeof body.service_ticket_id === 'string' ? body.service_ticket_id : null
    const equipmentId = typeof body.equipment_id === 'string' ? body.equipment_id : null

    const user = await getCurrentUser()
    if (!user?.role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = await createClient()

    // If a pm_ticket_id is supplied, validate it belongs to this customer and
    // (for techs) is one they own. This is the same defense-in-depth pattern
    // used by the relocate route.
    if (pmTicketId) {
      const { data: ticket, error } = await supabase
        .from('pm_tickets')
        .select('id, customer_id, assigned_technician_id, deleted_at')
        .eq('id', pmTicketId)
        .single()

      if (error || !ticket || ticket.deleted_at) {
        return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
      }
      if (ticket.customer_id !== customerId) {
        return NextResponse.json(
          { error: 'Ticket does not belong to that customer' },
          { status: 422 }
        )
      }
      if (isTechnician(user.role) && ticket.assigned_technician_id !== user.id) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    // Same validation for a service_ticket_id link.
    if (serviceTicketId) {
      const { data: ticket, error } = await supabase
        .from('service_tickets')
        .select('id, customer_id, assigned_technician_id, deleted_at')
        .eq('id', serviceTicketId)
        .single()

      if (error || !ticket || ticket.deleted_at) {
        return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
      }
      if (ticket.customer_id !== customerId) {
        return NextResponse.json(
          { error: 'Ticket does not belong to that customer' },
          { status: 422 }
        )
      }
      if (isTechnician(user.role) && ticket.assigned_technician_id !== user.id) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    const { data, error } = await supabase
      .from('ship_to_requests')
      .insert({
        customer_id: customerId,
        requested_by: user.id,
        pm_ticket_id: pmTicketId,
        service_ticket_id: serviceTicketId,
        equipment_id: equipmentId,
        note,
      })
      .select()
      .single()

    if (error) {
      console.error('ship-to-requests POST insert error:', error)
      return NextResponse.json(
        { error: 'Failed to create request' },
        { status: 500 }
      )
    }

    return NextResponse.json({ request: data })
  } catch (err) {
    console.error('ship-to-requests POST error:', err)
    return NextResponse.json(
      { error: 'Failed to create request' },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user?.role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!STAFF_ROLES.includes(user.role as typeof STAFF_ROLES[number])) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const rawStatus = request.nextUrl.searchParams.get('status') ?? 'pending'
    if (!['pending', 'resolved', 'dismissed'].includes(rawStatus)) {
      return NextResponse.json({ error: 'Invalid status filter' }, { status: 400 })
    }
    const status = rawStatus as 'pending' | 'resolved' | 'dismissed'

    const supabase = await createClient()
    const { data, error } = await supabase
      .from('ship_to_requests')
      .select(`
        *,
        customer:customers(id, name),
        requested_by_user:users!requested_by(name),
        equipment(id, make, model, serial_number)
      `)
      .eq('status', status)
      .order('requested_at', { ascending: false }) as { data: unknown[] | null; error: { message: string } | null }

    if (error) {
      console.error('ship-to-requests GET error:', error)
      return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 })
    }

    return NextResponse.json({ requests: data ?? [] })
  } catch (err) {
    console.error('ship-to-requests GET error:', err)
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 })
  }
}
