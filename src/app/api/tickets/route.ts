import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { TicketStatus } from '@/types/database'
import { getCurrentUser, MANAGER_ROLES } from '@/lib/auth'

export async function POST(request: NextRequest) {
  try {
    const currentUser = await getCurrentUser()
    if (!currentUser?.role || !MANAGER_ROLES.includes(currentUser.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

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

    // Check for duplicate ticket (same equipment + month + year, not yet billed)
    if (equipment_id) {
      const { data: existing } = await supabase
        .from('pm_tickets')
        .select('id')
        .eq('equipment_id', equipment_id)
        .eq('month', month)
        .eq('year', year)
        .not('status', 'eq', 'billed')
        .limit(1)

      if (existing && existing.length > 0) {
        return NextResponse.json(
          { error: 'A ticket already exists for this equipment in the selected month' },
          { status: 409 }
        )
      }
    }

    // Fetch default products and active PM schedule from equipment
    let defaultParts: Array<{ synergy_product_id: number; quantity: number; description: string; unit_price: number }> = []
    let scheduleId: string | null = null
    if (equipment_id) {
      const { data: equip } = await supabase
        .from('equipment')
        .select('default_products')
        .eq('id', equipment_id)
        .single()
      if (equip?.default_products && Array.isArray(equip.default_products)) {
        defaultParts = equip.default_products.map((p: { synergy_product_id: number; quantity: number; description: string }) => ({
          synergy_product_id: p.synergy_product_id,
          quantity: p.quantity,
          description: p.description,
          unit_price: 0,
        }))
      }

      // Auto-link to the equipment's active PM schedule
      const { data: schedule } = await supabase
        .from('pm_schedules')
        .select('id')
        .eq('equipment_id', equipment_id)
        .eq('active', true)
        .limit(1)
        .single()
      if (schedule) {
        scheduleId = schedule.id
      }
    }

    const { data: ticket, error: insertError } = await supabase
      .from('pm_tickets')
      .insert({
        pm_schedule_id: scheduleId,
        equipment_id: equipment_id ?? null,
        customer_id,
        assigned_technician_id: assigned_technician_id ?? null,
        month,
        year,
        status,
        parts_used: defaultParts,
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
