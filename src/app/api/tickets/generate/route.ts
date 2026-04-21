import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { PmTicketRow, PmTicketInsert, PmScheduleRow, EquipmentRow, TicketStatus } from '@/types/database'
import { getUser } from '@/lib/db/users'
import { MANAGER_ROLES } from '@/lib/auth'

function scheduleMatchesMonth(schedule: PmScheduleRow, month: number): boolean {
  const { interval_months, anchor_month } = schedule
  // Months elapsed since anchor, wrapping across year boundaries.
  // e.g. anchor=10 (Oct), interval=3 → matches Oct(0), Jan(3), Apr(6), Jul(9)
  // e.g. anchor=12 (Dec), interval=6 → matches Dec(0), Jun(6)
  // e.g. anchor=1  (Jan), interval=12 → matches only Jan(0) — once per year
  // Double-mod pattern ((x % n) + n) % n normalizes negative remainders in JS.
  const offset = ((month - anchor_month) % 12 + 12) % 12
  return offset % interval_months === 0
}

type ScheduleWithEquipment = PmScheduleRow & {
  equipment: (EquipmentRow & {
    customers: { id: number; name: string; credit_hold: boolean } | null
  }) | null
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      month: number
      year: number
      preview?: boolean
      skipCreditHoldCustomerIds?: number[]
    }
    const { month, year, preview = false, skipCreditHoldCustomerIds = [] } = body

    if (!month || !year || month < 1 || month > 12) {
      return NextResponse.json(
        { error: 'Valid month (1–12) and year are required' },
        { status: 400 }
      )
    }

    if (year < 2020 || year > 2100) {
      return NextResponse.json({ error: 'Invalid year' }, { status: 400 })
    }

    const supabase = await createClient()

    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError) throw userError
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const dbUser = await getUser(user.id)
    if (!dbUser || !MANAGER_ROLES.includes(dbUser.role!)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Fetch all active schedules with their equipment and customer (for credit hold check)
    const { data: rawSchedules, error: schedulesError } = await supabase
      .from('pm_schedules')
      .select('*, equipment(*, customers(id, name, credit_hold))')
      .eq('active', true)

    if (schedulesError) throw schedulesError

    const schedules = rawSchedules as ScheduleWithEquipment[]

    // Fetch all existing tickets for this month/year in one query to avoid N+1
    const { data: existingTickets, error: existingError } = await supabase
      .from('pm_tickets')
      .select('pm_schedule_id, equipment_id')
      .eq('month', month)
      .eq('year', year)
    if (existingError) throw existingError
    const existingScheduleIds = new Set(
      (existingTickets ?? []).map(t => t.pm_schedule_id).filter(Boolean)
    )
    const existingEquipmentIds = new Set(
      (existingTickets ?? []).map(t => t.equipment_id).filter(Boolean)
    )

    const skipCreditHoldSet = new Set<number>(skipCreditHoldCustomerIds)

    const ticketsToCreate: PmTicketInsert[] = []
    const creditHoldCustomers = new Map<number, { id: number; name: string; equipmentCount: number }>()
    let skipped = 0
    let skippedCreditHold = 0

    for (const schedule of schedules) {
      if (!scheduleMatchesMonth(schedule, month)) {
        continue
      }

      const equipment = schedule.equipment
      // Skip if no equipment or equipment is deactivated
      if (!equipment || !equipment.active) {
        skipped++
        continue
      }

      // Skip if a ticket already exists for this schedule+month+year
      if (existingScheduleIds.has(schedule.id)) {
        skipped++
        continue
      }

      // Skip if a ticket already exists for this equipment+month+year (e.g., manually created)
      if (existingEquipmentIds.has(schedule.equipment_id)) {
        skipped++
        continue
      }

      // Track credit hold customers — always collected for preview response
      const customer = equipment.customers
      if (customer?.credit_hold) {
        const existing = creditHoldCustomers.get(customer.id)
        if (existing) {
          existing.equipmentCount++
        } else {
          creditHoldCustomers.set(customer.id, {
            id: customer.id,
            name: customer.name,
            equipmentCount: 1,
          })
        }

        // If caller asked to skip this credit-hold customer, skip (non-preview only)
        if (!preview && skipCreditHoldSet.has(customer.id)) {
          skipped++
          skippedCreditHold++
          continue
        }
      }

      // Determine initial status based on whether equipment has a default technician
      const status: TicketStatus = equipment.default_technician_id ? 'assigned' : 'unassigned'

      ticketsToCreate.push({
        pm_schedule_id: schedule.id,
        equipment_id: schedule.equipment_id,
        customer_id: equipment.customer_id,
        assigned_technician_id: equipment.default_technician_id ?? null,
        month,
        year,
        status,
        parts_used: (equipment.default_products ?? []).map((p) => ({
          synergy_product_id: p.synergy_product_id,
          quantity: p.quantity,
          description: p.description,
          unit_price: 0,
        })),
        created_by_id: user?.id ?? null,
      })
    }

    // Preview mode: don't insert, just report what would happen
    if (preview) {
      return NextResponse.json({
        preview: true,
        wouldCreate: ticketsToCreate.length,
        skipped,
        creditHoldCustomers: Array.from(creditHoldCustomers.values()).sort((a, b) =>
          a.name.localeCompare(b.name)
        ),
      })
    }

    let created: PmTicketRow[] = []

    if (ticketsToCreate.length > 0) {
      const { data: insertedTickets, error: insertError } = await supabase
        .from('pm_tickets')
        .insert(ticketsToCreate)
        .select()

      if (insertError) throw insertError
      created = insertedTickets
    }

    return NextResponse.json({
      created: created.length,
      skipped,
      skippedCreditHold,
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
