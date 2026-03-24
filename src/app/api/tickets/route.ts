import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { TicketStatus } from '@/types/database'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      equipment_id?: string
      customer_id: number
      month: number
      year: number
      assigned_technician_id?: string
      scheduled_date?: string
    }

    const { equipment_id, customer_id, month, year, assigned_technician_id, scheduled_date } = body

    if (!customer_id || !month || !year) {
      return NextResponse.json(
        { error: 'customer_id, month, and year are required' },
        { status: 400 }
      )
    }

    if (month < 1 || month > 12) {
      return NextResponse.json({ error: 'month must be between 1 and 12' }, { status: 400 })
    }

    const supabase = await createClient()

    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError) throw userError

    const status: TicketStatus = assigned_technician_id ? 'assigned' : 'unassigned'

    const { data: ticket, error: insertError } = await supabase
      .from('pm_tickets')
      .insert({
        pm_schedule_id: null,
        equipment_id: equipment_id ?? null,
        customer_id,
        assigned_technician_id: assigned_technician_id ?? null,
        month,
        year,
        status,
        parts_used: [],
        scheduled_date: scheduled_date ?? null,
        created_by_id: user?.id ?? null,
      })
      .select()
      .single()

    if (insertError) throw insertError

    return NextResponse.json({ ticket }, { status: 201 })
  } catch (err) {
    console.error('tickets POST error:', err)
    return NextResponse.json({ error: 'Failed to create ticket' }, { status: 500 })
  }
}
