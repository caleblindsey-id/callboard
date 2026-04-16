import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { completeTicket } from '@/lib/db/tickets'
import { getCurrentUser, isTechnician } from '@/lib/auth'
import { PartUsed, TicketPhoto } from '@/types/database'

interface CompleteTicketBody {
  completedDate: string
  hoursWorked: number
  partsUsed: PartUsed[]
  completionNotes: string
  billingAmount: number
  customerSignature: string
  customerSignatureName: string
  photos: TicketPhoto[]
  poNumber?: string
  billingContactName?: string
  billingContactEmail?: string
  billingContactPhone?: string
  additionalPartsUsed?: PartUsed[]
  additionalHoursWorked?: number
  machineHours: number
  dateCode: string
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json() as CompleteTicketBody

    const { completedDate, hoursWorked, partsUsed, completionNotes, billingAmount, customerSignature, customerSignatureName, photos, poNumber, billingContactName, billingContactEmail, billingContactPhone, additionalPartsUsed, additionalHoursWorked, machineHours, dateCode } = body

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

    if (machineHours === undefined || machineHours === null) {
      return NextResponse.json(
        { error: 'Machine hours are required' },
        { status: 400 }
      )
    }

    if (!dateCode || !dateCode.trim()) {
      return NextResponse.json(
        { error: 'Date code is required' },
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

    // Process parts and compute billing amount
    let finalBillingAmount = billingAmount
    let finalParts = partsUsed ?? []
    let finalAdditionalParts = additionalPartsUsed ?? []
    const finalAdditionalHours = additionalHoursWorked ?? 0

    // PM parts always have unit_price zeroed (inventory tracking only)
    finalParts = finalParts.map(p => ({ ...p, unit_price: 0 }))

    // Fetch schedule for flat rate and labor rate from settings
    const { data: ticketWithSchedule } = await supabase
      .from('pm_tickets')
      .select('pm_schedules(flat_rate, billing_type)')
      .eq('id', id)
      .single()

    const schedule = ticketWithSchedule?.pm_schedules as { flat_rate: number | null; billing_type: string | null } | null
    const flatRate = (schedule?.billing_type === 'flat_rate' && schedule.flat_rate != null) ? schedule.flat_rate : 0

    if (isTechnician(user.role)) {
      // Techs: additional parts keep their prices (visible to techs), server computes billing
      const { data: settings } = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'labor_rate_per_hour')
        .single()
      const laborRate = settings ? parseFloat(settings.value) : 75

      const additionalPartsTotal = finalAdditionalParts.reduce(
        (sum, p) => sum + (p.quantity * p.unit_price), 0
      )
      finalBillingAmount = flatRate + (finalAdditionalHours * laborRate) + additionalPartsTotal
    }
    // Managers: billing amount passed as-is from client

    const updated = await completeTicket(id, {
      completedDate,
      hoursWorked,
      partsUsed: finalParts,
      completionNotes: completionNotes ?? '',
      billingAmount: finalBillingAmount,
      customerSignature,
      customerSignatureName,
      photos: photos ?? [],
      poNumber: poNumber ?? null,
      billingContactName: billingContactName ?? null,
      billingContactEmail: billingContactEmail ?? null,
      billingContactPhone: billingContactPhone ?? null,
      additionalPartsUsed: finalAdditionalParts,
      additionalHoursWorked: finalAdditionalHours,
      machineHours,
      dateCode: dateCode.trim(),
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
