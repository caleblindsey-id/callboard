import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { completeTicket } from '@/lib/db/tickets'
import { getCurrentUser, isTechnician } from '@/lib/auth'
import { PartUsed } from '@/types/database'

interface CompleteTicketBody {
  completedDate: string
  hoursWorked: number
  partsUsed: PartUsed[]
  completionNotes: string
  billingAmount: number
  customerSignature: string
  customerSignatureName: string
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json() as CompleteTicketBody

    const { completedDate, hoursWorked, partsUsed, completionNotes, billingAmount, customerSignature, customerSignatureName } = body

    if (!completedDate || hoursWorked === undefined || billingAmount === undefined) {
      return NextResponse.json(
        { error: 'completedDate, hoursWorked, and billingAmount are required' },
        { status: 400 }
      )
    }

    if (!customerSignature || !customerSignatureName) {
      return NextResponse.json(
        { error: 'Customer signature and printed name are required' },
        { status: 400 }
      )
    }

    const user = await getCurrentUser()
    if (!user?.role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Prevent overwriting already-completed or billed tickets
    const supabase = await createClient()
    const { data: current, error: fetchError } = await supabase
      .from('pm_tickets')
      .select('status, assigned_technician_id')
      .eq('id', id)
      .single()

    if (fetchError || !current) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
    }

    // Techs can only complete their own assigned tickets
    if (isTechnician(user.role) && current.assigned_technician_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (current.status === 'completed' || current.status === 'billed') {
      return NextResponse.json(
        { error: `Ticket is already ${current.status} and cannot be re-completed` },
        { status: 409 }
      )
    }

    // When a tech completes, auto-set billing amount from flat rate and zero out part prices
    let finalBillingAmount = billingAmount
    let finalParts = partsUsed ?? []

    if (isTechnician(user.role)) {
      // Zero out part prices — techs add parts for inventory tracking only
      finalParts = finalParts.map(p => ({ ...p, unit_price: 0 }))

      // Set billing amount to flat rate from schedule
      const { data: ticketWithSchedule } = await supabase
        .from('pm_tickets')
        .select('pm_schedules(flat_rate, billing_type)')
        .eq('id', id)
        .single()

      const schedule = ticketWithSchedule?.pm_schedules as { flat_rate: number | null; billing_type: string | null } | null
      if (schedule?.billing_type === 'flat_rate' && schedule.flat_rate != null) {
        finalBillingAmount = schedule.flat_rate
      } else {
        finalBillingAmount = 0
      }
    }

    const updated = await completeTicket(id, {
      completedDate,
      hoursWorked,
      partsUsed: finalParts,
      completionNotes: completionNotes ?? '',
      billingAmount: finalBillingAmount,
      customerSignature,
      customerSignatureName,
    })

    return NextResponse.json(updated)
  } catch (err) {
    console.error(`tickets/[id]/complete error:`, err)
    return NextResponse.json(
      { error: 'Failed to complete ticket' },
      { status: 500 }
    )
  }
}
