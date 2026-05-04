import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { completeTicket } from '@/lib/db/tickets'
import { updateAnchorMonth } from '@/lib/db/schedules'
import { getCurrentUser, isTechnician } from '@/lib/auth'
import { PartUsed, TicketPhoto } from '@/types/database'
import { getLaborRate } from '@/lib/db/settings'

interface CompleteTicketBody {
  completedDate: string
  hoursWorked: number
  partsUsed: PartUsed[]
  completionNotes: string
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

function isNonNegativeNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json() as CompleteTicketBody

    const {
      completedDate, hoursWorked, partsUsed, completionNotes,
      customerSignature, customerSignatureName, photos, poNumber,
      billingContactName, billingContactEmail, billingContactPhone,
      additionalPartsUsed, additionalHoursWorked, machineHours, dateCode,
    } = body

    if (!completedDate || hoursWorked === undefined) {
      return NextResponse.json(
        { error: 'completedDate and hoursWorked are required' },
        { status: 400 }
      )
    }

    // Validate completedDate is a real date in a sane range
    const completionDate = new Date(completedDate + 'T12:00:00Z')
    if (Number.isNaN(completionDate.getTime())) {
      return NextResponse.json({ error: 'Invalid completedDate' }, { status: 400 })
    }
    const completedYearCheck = completionDate.getUTCFullYear()
    if (completedYearCheck < 2020 || completedYearCheck > 2100) {
      return NextResponse.json({ error: 'completedDate is out of range' }, { status: 400 })
    }

    if (!isNonNegativeNumber(hoursWorked)) {
      return NextResponse.json({ error: 'hoursWorked must be a non-negative number' }, { status: 400 })
    }

    if (!customerSignature || !customerSignatureName) {
      return NextResponse.json(
        { error: 'Customer signature and printed name are required' },
        { status: 400 }
      )
    }

    if (!isNonNegativeNumber(machineHours)) {
      return NextResponse.json(
        { error: 'Machine hours must be a non-negative number' },
        { status: 400 }
      )
    }

    if (!dateCode || !dateCode.trim()) {
      return NextResponse.json(
        { error: 'Date code is required' },
        { status: 400 }
      )
    }

    if (additionalHoursWorked !== undefined && !isNonNegativeNumber(additionalHoursWorked)) {
      return NextResponse.json(
        { error: 'Additional hours worked must be a non-negative number' },
        { status: 400 }
      )
    }

    const user = await getCurrentUser()
    if (!user?.role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Single round trip: ticket state, ownership data, parts_requested, period,
    // schedule pricing, and the customer's show_pricing_on_pm_pdf flag (so we
    // can snapshot it onto the ticket below).
    const supabase = await createClient()
    const { data: current, error: fetchError } = await supabase
      .from('pm_tickets')
      .select('status, assigned_technician_id, parts_requested, month, year, pm_schedule_id, labor_rate_type, pm_schedules(flat_rate, billing_type), customers(show_pricing_on_pm_pdf)')
      .eq('id', id)
      .is('deleted_at', null)
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

    // Hard block: all requested parts must be received before completing
    const pendingParts = ((current.parts_requested ?? []) as Array<{ status: string }>).filter(
      p => p.status !== 'received'
    )
    if (pendingParts.length > 0) {
      return NextResponse.json(
        { error: `Cannot complete: ${pendingParts.length} part(s) are not yet received.` },
        { status: 400 }
      )
    }

    // PM parts always have unit_price zeroed (inventory tracking only)
    const finalParts: PartUsed[] = (partsUsed ?? []).map(p => ({ ...p, unit_price: 0 }))
    const finalAdditionalHours = additionalHoursWorked ?? 0

    // Server-authoritative billing math: recompute for ALL roles. Look up canonical
    // unit prices for additional parts that have a synergy_product_id; clamp others.
    const schedule = current.pm_schedules as { flat_rate: number | null; billing_type: string | null } | null
    const flatRate = (schedule?.billing_type === 'flat_rate' && schedule.flat_rate != null) ? schedule.flat_rate : 0

    const laborRate = await getLaborRate(current.labor_rate_type ?? 'standard')

    // Resolve canonical product prices in one query
    const additionalIn: PartUsed[] = additionalPartsUsed ?? []
    const productIds = additionalIn
      .map(p => p.synergy_product_id)
      .filter((v): v is number => typeof v === 'number')
    const priceMap = new Map<number, number>()
    if (productIds.length > 0) {
      const { data: products } = await supabase
        .from('products')
        .select('synergy_id, unit_price')
        .in('synergy_id', productIds.map(String))
      if (products) {
        for (const row of products) {
          if (row.synergy_id != null && row.unit_price != null) {
            priceMap.set(Number(row.synergy_id), Number(row.unit_price))
          }
        }
      }
    }

    const finalAdditionalParts: PartUsed[] = additionalIn.map(p => {
      const canonical = p.synergy_product_id != null ? priceMap.get(p.synergy_product_id) : undefined
      const safePrice = canonical ?? Math.max(0, Number(p.unit_price) || 0)
      return { ...p, unit_price: safePrice }
    })

    const additionalPartsTotal = finalAdditionalParts.reduce(
      (sum, p) => sum + (Number(p.quantity) || 0) * (Number(p.unit_price) || 0),
      0
    )
    // Round to cents to keep stored billing_amount consistent with
    // .toFixed(2) display values everywhere (otherwise sub-cent IEEE 754
    // drift can cause the PDF total and the export-list total to diverge).
    const finalBillingAmount = Math.round((flatRate + (finalAdditionalHours * laborRate) + additionalPartsTotal) * 100) / 100

    // Snapshot the customer's pricing-visibility flag onto the ticket so future
    // PDF regenerations are stable even if the customer flag is later toggled.
    const customerJoin = current.customers as { show_pricing_on_pm_pdf?: boolean } | { show_pricing_on_pm_pdf?: boolean }[] | null
    const customerRow = Array.isArray(customerJoin) ? customerJoin[0] : customerJoin
    const showPricingSnapshot = customerRow?.show_pricing_on_pm_pdf ?? false

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
      showPricing: showPricingSnapshot,
    })

    // Slide billing period to completion month if work happened in a different month
    const completedMonth = completionDate.getUTCMonth() + 1
    const completedYear = completionDate.getUTCFullYear()

    if (completedMonth !== current.month || completedYear !== current.year) {
      const { error: slideError } = await supabase
        .from('pm_tickets')
        .update({ month: completedMonth, year: completedYear })
        .eq('id', id)

      // 23505 = unique_violation — a ticket for that schedule+month+year already exists.
      // Keep the original billing period in that case; anchor still updates below.
      if (slideError && slideError.code !== '23505') {
        console.error(`[complete] Failed to slide billing period for ticket ${id}:`, slideError)
      }

      if (current.pm_schedule_id) {
        try {
          await updateAnchorMonth(current.pm_schedule_id, completedMonth)
        } catch (err) {
          console.error(`[complete] Failed to update anchor for schedule ${current.pm_schedule_id}:`, err)
        }
      }

      if (!slideError) {
        return NextResponse.json({ ...updated, month: completedMonth, year: completedYear })
      }
    }

    return NextResponse.json(updated)
  } catch (err) {
    console.error(`tickets/[id]/complete error:`, err)
    return NextResponse.json(
      { error: 'Failed to complete ticket' },
      { status: 500 }
    )
  }
}
