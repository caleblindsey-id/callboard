import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { PmTicketRow, PmScheduleRow, EquipmentRow } from '@/types/database'

function scheduleMatchesMonth(frequency: PmScheduleRow['frequency'], month: number): boolean {
  switch (frequency) {
    case 'monthly':
      return true
    case 'quarterly':
      return [1, 4, 7, 10].includes(month)
    case 'semi-annual':
      return [1, 7].includes(month)
    case 'annual':
      return month === 1
    default:
      return false
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { month: number; year: number }
    const { month, year } = body

    if (!month || !year || month < 1 || month > 12) {
      return NextResponse.json(
        { error: 'Valid month (1–12) and year are required' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    // Fetch all active schedules with their equipment
    const { data: schedules, error: schedulesError } = await supabase
      .from('pm_schedules')
      .select('*, equipment(*)')
      .eq('active', true)

    if (schedulesError) throw schedulesError

    const created: PmTicketRow[] = []
    let skipped = 0

    for (const schedule of schedules) {
      if (!scheduleMatchesMonth(schedule.frequency, month)) {
        continue
      }

      const equipment = schedule.equipment as EquipmentRow | null
      if (!equipment) continue

      // Check if a ticket already exists for this schedule+month+year
      const { data: existing, error: existingError } = await supabase
        .from('pm_tickets')
        .select('id')
        .eq('pm_schedule_id', schedule.id)
        .eq('month', month)
        .eq('year', year)
        .maybeSingle()

      if (existingError) throw existingError

      if (existing) {
        skipped++
        continue
      }

      // Determine initial status based on whether equipment has a default technician
      const status = equipment.default_technician_id ? 'assigned' : 'unassigned'

      const { data: ticket, error: insertError } = await supabase
        .from('pm_tickets')
        .insert({
          pm_schedule_id: schedule.id,
          equipment_id: schedule.equipment_id,
          customer_id: equipment.customer_id,
          assigned_technician_id: equipment.default_technician_id ?? null,
          month,
          year,
          status,
          parts_used: [],
        })
        .select()
        .single()

      if (insertError) throw insertError

      created.push(ticket)
    }

    return NextResponse.json({
      created: created.length,
      skipped,
      tickets: created,
    })
  } catch (err) {
    console.error('tickets/generate error:', err)
    return NextResponse.json(
      { error: 'Failed to generate tickets' },
      { status: 500 }
    )
  }
}
