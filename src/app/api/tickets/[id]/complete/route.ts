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
  aceLabor?: { hours: number; reason: string } | null
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
      aceLabor,
    } = body

    // Validate ACE labor payload if provided.
    if (aceLabor != null) {
      if (!isNonNegativeNumber(aceLabor.hours) || aceLabor.hours <= 0) {
        return NextResponse.json(
          { error: 'ACE labor hours must be greater than 0' },
          { status: 400 }
        )
      }
      if (typeof aceLabor.reason !== 'string' || !aceLabor.reason.trim()) {
        return NextResponse.json(
          { error: 'ACE labor reason is required' },
          { status: 400 }
        )
      }
    }

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

    // ACE labor (tech-payout). One row per ticket — partial unique index on
    // pm_ticket_id enforces it. On re-completion (after manager reset) we let
    // the tech overwrite a pending/rejected entry, but refuse if the entry
    // has already been approved or paid (audit-stable).
    if (aceLabor != null) {
      const { data: existing, error: existingErr } = await supabase
        .from('ace_labor_entries')
        .select('id, status')
        .eq('pm_ticket_id', id)
        .maybeSingle()
      if (existingErr) {
        console.error(`[complete] ACE lookup failed for ticket ${id}:`, existingErr)
      } else if (existing && (existing.status === 'approved' || existing.status === 'paid')) {
        return NextResponse.json(
          { error: 'ACE labor entry already approved/paid; cannot be changed here.' },
          { status: 409 }
        )
      } else if (existing) {
        const { error: updErr } = await supabase
          .from('ace_labor_entries')
          .update({
            hours: aceLabor.hours,
            reason: aceLabor.reason.trim(),
            labor_rate_type: (current.labor_rate_type ?? 'standard') as 'standard' | 'industrial' | 'vacuum',
            status: 'pending',
            rejected_reason: null,
            approved_by_id: null,
            approved_at: null,
            rate_value_at_approval: null,
            submitted_at: new Date().toISOString(),
            updated_by_id: user.id,
          })
          .eq('id', existing.id)
        if (updErr) {
          console.error(`[complete] ACE update failed for ticket ${id}:`, updErr)
        }
      } else {
        // tech_id must point at the assigned technician, not the user
        // submitting completion. A manager completing on a tech's behalf
        // should still attribute the ACE entry to the tech for payout and
        // for the self-approval guard to work. Fall back to the current
        // user only when the ticket is unassigned (edge case).
        const aceTechId = current.assigned_technician_id ?? user.id
        const { error: insErr } = await supabase
          .from('ace_labor_entries')
          .insert({
            pm_ticket_id: id,
            tech_id: aceTechId,
            hours: aceLabor.hours,
            labor_rate_type: (current.labor_rate_type ?? 'standard') as 'standard' | 'industrial' | 'vacuum',
            reason: aceLabor.reason.trim(),
            status: 'pending',
            created_by_id: user.id,
          })
        if (insErr) {
          console.error(`[complete] ACE insert failed for ticket ${id}:`, insErr)
        }
      }
    }

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
