import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { completeServiceTicket } from '@/lib/db/service-tickets'
import { getCurrentUser, isTechnician } from '@/lib/auth'
import { getCustomerLaborRate, getTripChargeRate, effectiveTripChargeQty } from '@/lib/db/settings'
import { isTicketCreditGated } from '@/lib/credit-review'
import { buildProductCostMap } from '@/lib/db/products'
import { checkPartLines } from '@/lib/margin'
import { equipmentNeedsVerification } from '@/lib/equipment'
import type { ServicePartUsed } from '@/types/service-tickets'
import type { TicketPhoto } from '@/types/database'

interface CompleteServiceTicketBody {
  completed_at: string
  hours_worked: number
  parts_used: ServicePartUsed[]
  completion_notes: string | null
  customer_signature: string | null
  customer_signature_name: string | null
  photos: TicketPhoto[]
  warranty_labor_covered?: boolean
  trip_charge_qty?: number
  machine_hours?: number | null
  date_code?: string | null
  ace_labor?: { hours: number; reason: string } | null
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
    const body = await request.json() as CompleteServiceTicketBody

    const { completed_at, hours_worked, parts_used, completion_notes, customer_signature, customer_signature_name, photos, ace_labor } = body

    if (ace_labor != null) {
      if (!isNonNegativeNumber(ace_labor.hours) || ace_labor.hours <= 0) {
        return NextResponse.json(
          { error: 'ACE labor hours must be greater than 0' },
          { status: 400 }
        )
      }
      if (typeof ace_labor.reason !== 'string' || !ace_labor.reason.trim()) {
        return NextResponse.json(
          { error: 'ACE labor reason is required' },
          { status: 400 }
        )
      }
    }

    if (!completed_at || hours_worked === undefined) {
      return NextResponse.json(
        { error: 'completed_at and hours_worked are required' },
        { status: 400 }
      )
    }

    if (!isNonNegativeNumber(hours_worked)) {
      return NextResponse.json(
        { error: 'hours_worked must be a non-negative number' },
        { status: 400 }
      )
    }

    // Machine hours / date code are optional on service tickets (not every unit
    // has an hour meter), but when provided must be valid.
    if (body.machine_hours != null && !isNonNegativeNumber(body.machine_hours)) {
      return NextResponse.json(
        { error: 'machine_hours must be a non-negative number' },
        { status: 400 }
      )
    }
    const machineHours = body.machine_hours ?? null
    const dateCode = typeof body.date_code === 'string' && body.date_code.trim()
      ? body.date_code.trim()
      : null

    // Validate parts_used: every line non-negative price + positive qty
    if (Array.isArray(parts_used)) {
      for (const p of parts_used) {
        const qty = Number(p.quantity)
        const price = Number(p.unit_price)
        if (!Number.isFinite(qty) || qty <= 0) {
          return NextResponse.json({ error: 'Each part must have a positive quantity' }, { status: 400 })
        }
        if (!Number.isFinite(price) || price < 0) {
          return NextResponse.json({ error: 'Each part unit_price must be non-negative' }, { status: 400 })
        }
      }
    }

    const user = await getCurrentUser()
    if (!user?.role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = await createClient()
    const { data: current, error: fetchError } = await supabase
      .from('service_tickets')
      .select('status, assigned_technician_id, billing_type, ticket_type, diagnostic_charge, trip_charge_qty, labor_rate_type, equipment_id, customer_id')
      .eq('id', id)
      .single()

    if (fetchError || !current) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
    }

    // Signature required only for outside (field) tickets
    if (current.ticket_type !== 'inside' && (!customer_signature || !customer_signature_name)) {
      return NextResponse.json(
        { error: 'Customer signature and printed name are required' },
        { status: 400 }
      )
    }

    if (isTechnician(user.role) && current.assigned_technician_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Credit-hold gate: cannot complete while AR review is pending/blocked.
    const creditGate = await isTicketCreditGated('service', id)
    if (creditGate) {
      return NextResponse.json(
        {
          error:
            creditGate.status === 'blocked'
              ? 'This order is blocked by AR — a manager must enter the release passcode before it can be completed.'
              : 'This order is pending AR credit review and cannot be completed yet.',
        },
        { status: 423 }
      )
    }

    if (current.status !== 'in_progress') {
      return NextResponse.json(
        { error: `Ticket must be in_progress to complete (currently: ${current.status})` },
        { status: 409 }
      )
    }

    // Equipment details gate: a technician must have entered (if missing) or
    // verified (if present) the unit's make/model/serial before completion.
    // Verify-once — a stamped unit is trusted on future visits. Tickets with no
    // associated equipment (general service calls) skip the gate.
    if (current.equipment_id) {
      const { data: eq } = await supabase
        .from('equipment')
        .select('make, model, details_verified_at')
        .eq('id', current.equipment_id)
        .maybeSingle()
      if (equipmentNeedsVerification(eq)) {
        return NextResponse.json(
          { error: 'Verify the equipment make, model, and serial number before completing this ticket.' },
          { status: 409 }
        )
      }
    }

    // Margin floor (parts only, per-line): every billable part must keep >= 15%
    // gross margin over loaded cost. Cost is sourced from the products catalog
    // (server-authoritative); the line unit_cost snapshot is overwritten from
    // it. Warranty tickets bill no parts, so the floor doesn't apply there.
    {
      const billingTypeForFloor = current.billing_type as string
      const lines = parts_used ?? []
      if (billingTypeForFloor !== 'warranty' && lines.length > 0) {
        const billable =
          billingTypeForFloor === 'partial_warranty'
            ? lines.filter((p) => !p.warranty_covered)
            : lines
        const costMap = await buildProductCostMap(supabase, billable.map((l) => l.synergy_product_id))
        const check = checkPartLines(billable, (pid) => costMap.get(pid))
        if (!check.ok) {
          const v = check.violations[0]
          // Techs must never see the min price (it back-derives loaded cost).
          return NextResponse.json(
            isTechnician(user.role)
              ? { error: `"${v.description}" is priced too low — please check with the office.` }
              : {
                  error: `"${v.description}" is priced below the 15% margin floor — minimum price is $${v.minPrice.toFixed(2)}.`,
                  violations: check.violations,
                },
            { status: 400 },
          )
        }
      }
    }

    // Server-authoritative billing math (mirrors PM /complete in section 2).
    // billing_amount is no longer accepted from the client — it's recomputed
    // for all roles from authoritative inputs.
    const billingType = current.billing_type as string
    const finalParts: ServicePartUsed[] = parts_used ?? []
    const diagnosticCharge = Number(current.diagnostic_charge ?? 0) || 0

    let finalBillingAmount: number
    if (billingType === 'warranty') {
      finalBillingAmount = 0
    } else {
      const laborRate = await getCustomerLaborRate(current.customer_id, current.labor_rate_type ?? 'standard')
      const laborTotal = hours_worked * laborRate

      const billablePartsTotal = billingType === 'partial_warranty'
        ? finalParts.filter(p => !p.warranty_covered).reduce(
            (sum, p) => sum + (Number(p.quantity) || 0) * (Number(p.unit_price) || 0), 0
          )
        : finalParts.reduce(
            (sum, p) => sum + (Number(p.quantity) || 0) * (Number(p.unit_price) || 0), 0
          )

      // Trip charge = trips × per-trip rate (mirrors labor). The completer's
      // inline qty (body) wins, else the stored qty, else the ticket-type default
      // (bench 'inside' = 0 trips, field = 1). partial_warranty still bills it.
      const tripQty = isNonNegativeNumber(body.trip_charge_qty)
        ? body.trip_charge_qty
        : effectiveTripChargeQty(current.trip_charge_qty as number | null, current.ticket_type as string)
      const tripCharge = tripQty * await getTripChargeRate()

      finalBillingAmount = laborTotal + billablePartsTotal + diagnosticCharge + tripCharge
    }
    // Round to cents to avoid stored vs. displayed drift.
    finalBillingAmount = Math.round(finalBillingAmount * 100) / 100

    // ACE labor — write BEFORE the ticket transitions to completed so a failure
    // returns 500 with the ticket unchanged. See PM /complete for the full
    // rationale on ordering and retry safety.
    if (ace_labor != null) {
      const { data: existing, error: existingErr } = await supabase
        .from('ace_labor_entries')
        .select('id, status')
        .eq('service_ticket_id', id)
        .maybeSingle()
      if (existingErr) {
        console.error(`[complete] ACE lookup failed for service ticket ${id}:`, existingErr)
        return NextResponse.json(
          { error: 'Failed to read existing ACE labor entry.' },
          { status: 500 }
        )
      }
      if (existing && (existing.status === 'approved' || existing.status === 'paid')) {
        return NextResponse.json(
          { error: 'ACE labor entry already approved/paid; cannot be changed here.' },
          { status: 409 }
        )
      }
      if (existing) {
        const { error: updErr } = await supabase
          .from('ace_labor_entries')
          .update({
            hours: ace_labor.hours,
            reason: ace_labor.reason.trim(),
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
          console.error(`[complete] ACE update failed for service ticket ${id}:`, updErr)
          return NextResponse.json(
            { error: 'Failed to save ACE labor entry.' },
            { status: 500 }
          )
        }
      } else {
        // tech_id must point at the assigned technician, not the user
        // submitting completion. See PM /complete for full rationale.
        const aceTechId = current.assigned_technician_id ?? user.id
        const { error: insErr } = await supabase
          .from('ace_labor_entries')
          .insert({
            service_ticket_id: id,
            tech_id: aceTechId,
            hours: ace_labor.hours,
            labor_rate_type: (current.labor_rate_type ?? 'standard') as 'standard' | 'industrial' | 'vacuum',
            reason: ace_labor.reason.trim(),
            status: 'pending',
            created_by_id: user.id,
          })
        if (insErr) {
          console.error(`[complete] ACE insert failed for service ticket ${id}:`, insErr)
          return NextResponse.json(
            { error: 'Failed to create ACE labor entry.' },
            { status: 500 }
          )
        }
      }
    }

    const updated = await completeServiceTicket(id, {
      completed_at,
      hours_worked,
      parts_used: finalParts,
      completion_notes: completion_notes ?? null,
      billing_amount: finalBillingAmount,
      customer_signature: customer_signature ?? null,
      customer_signature_name: customer_signature_name ?? null,
      photos: photos ?? [],
      warranty_labor_covered: body.warranty_labor_covered,
      machine_hours: machineHours,
      date_code: dateCode,
    })

    return NextResponse.json(updated)
  } catch (err) {
    console.error('service-tickets/[id]/complete error:', err)
    return NextResponse.json(
      { error: 'Failed to complete service ticket' },
      { status: 500 }
    )
  }
}
