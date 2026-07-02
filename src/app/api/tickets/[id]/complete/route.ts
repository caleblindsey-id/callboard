// Retry-safe (Postgres txn) — the durable writes (ACE labor upsert + ticket
// completion + optional month/year slide + schedule anchor update) are all
// executed inside fn_complete_pm_ticket (migration 074). Before this round,
// each write was a separate Supabase call: if write #2 failed after write
// #1 succeeded the row was stuck in a partial-state half-complete row. Now
// the function raises and the whole transaction rolls back, leaving the
// ticket unchanged and the client free to retry.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentUser, isTechnician } from '@/lib/auth'
import { PartUsed, PartRequest, TicketPhoto } from '@/types/database'
import { partsOnOrder, stampCollectedOnStaged } from '@/lib/parts'
import { computePmBilling } from '@/lib/pm-billing'
import { isTicketCreditGated } from '@/lib/credit-review'
import { equipmentNeedsVerification } from '@/lib/equipment'
import { validatePhotoStoragePath } from '@/lib/security/storage-paths'

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
  tripChargeQty?: number
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
      additionalPartsUsed, additionalHoursWorked, tripChargeQty: tripChargeQtyIn, machineHours, dateCode,
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

    // Photos validation (mirrors the PATCH routes): each entry must be a known
    // image type scoped to this ticket id. Prevents stored XSS via a malicious
    // `.svg` served by signed URL.
    if (photos !== undefined && photos !== null) {
      if (!Array.isArray(photos)) {
        return NextResponse.json({ error: 'photos must be an array' }, { status: 400 })
      }
      const expectedPrefix = `${id}/`
      for (const p of photos as Array<{ storage_path?: unknown }>) {
        const check = validatePhotoStoragePath(p?.storage_path, expectedPrefix)
        if (!check.ok) {
          return NextResponse.json({ error: check.error }, { status: 400 })
        }
      }
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
      .select('status, assigned_technician_id, parts_requested, month, year, pm_schedule_id, labor_rate_type, trip_charge_qty, equipment_id, customer_id, pm_schedules(flat_rate, billing_type), customers(show_pricing_on_pm_pdf)')
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

    // Credit-hold gate: work cannot complete while AR review is pending/blocked.
    const creditGate = await isTicketCreditGated('pm', id)
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

    // status='completed' is idempotent (no-op inside the RPC), status='billed'
    // raises ALREADY_BILLED -> 409. We still 409 on 'billed' here pre-RPC for
    // a clearer early-exit message, but completed is allowed through so the
    // function can return the unchanged row.
    if (current.status === 'billed') {
      return NextResponse.json(
        { error: 'Ticket is already billed and cannot be re-completed' },
        { status: 409 }
      )
    }

    // Hard block: every live part must be resolved before completing. partsOnOrder
    // treats 'received' and 'from_stock' (pulled in-house) as done and skips
    // cancelled parts; anything still 'pending_review'/'requested'/'ordered' blocks.
    const pendingParts = partsOnOrder(current.parts_requested as PartRequest[] | null)
    if (pendingParts.length > 0) {
      return NextResponse.json(
        { error: `Cannot complete: ${pendingParts.length} part(s) are not yet received or pulled from stock.` },
        { status: 400 }
      )
    }

    // Equipment details gate (parity with service /complete): a technician must
    // have entered/verified the unit's make/model/serial before completion.
    // Verify-once. PM tickets normally always reference equipment; skip if not.
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

    // PM parts always have unit_price zeroed (inventory tracking only)
    const finalParts: PartUsed[] = (partsUsed ?? []).map(p => ({ ...p, unit_price: 0 }))
    const finalAdditionalHours = additionalHoursWorked ?? 0

    // Server-authoritative billing math: recompute for ALL roles via the shared
    // helper (also used by the first-PM-on-site auto-completion so they can't
    // drift). Trip charge = trips × per-trip rate (mirrors labor). Completer's
    // qty wins, else the stored qty, else 0. PMs are flat-rate under agreement,
    // so they default to NO trip charge (feedback #36); a manager can still add
    // trips via the override field when one is genuinely warranted (e.g. a T&M PM).
    const schedule = current.pm_schedules as { flat_rate: number | null; billing_type: string | null } | null
    const flatRate = (schedule?.billing_type === 'flat_rate' && schedule.flat_rate != null) ? schedule.flat_rate : 0
    const tripQty = isNonNegativeNumber(tripChargeQtyIn)
      ? tripChargeQtyIn
      : ((current.trip_charge_qty as number | null) ?? 0)
    const { billingAmount: finalBillingAmount, finalAdditionalParts } = await computePmBilling(supabase, {
      customerId: current.customer_id,
      laborRateType: current.labor_rate_type ?? 'standard',
      flatRate,
      additionalHours: finalAdditionalHours,
      additionalParts: additionalPartsUsed ?? [],
      tripQty,
    })

    // Snapshot the customer's pricing-visibility flag onto the ticket so future
    // PDF regenerations are stable even if the customer flag is later toggled.
    const customerJoin = current.customers as { show_pricing_on_pm_pdf?: boolean } | { show_pricing_on_pm_pdf?: boolean }[] | null
    const customerRow = Array.isArray(customerJoin) ? customerJoin[0] : customerJoin
    const showPricingSnapshot = customerRow?.show_pricing_on_pm_pdf ?? false

    // Slide billing period to completion month if work happened in a
    // different month. The Postgres function handles the slide + anchor
    // update atomically along with the rest of the writes.
    const completedMonth = completionDate.getUTCMonth() + 1
    const completedYear = completionDate.getUTCFullYear()

    const laborRateType = (current.labor_rate_type ?? 'standard') as 'standard' | 'industrial' | 'vacuum'

    // All writes — ACE upsert (if provided), ticket completion update, and
    // optional month/year slide + anchor update — flow through a single
    // SECURITY DEFINER Postgres function. Either everything lands or nothing
    // lands.
    const { data: rpcResult, error: rpcErr } = await supabase.rpc('fn_complete_pm_ticket', {
      p_payload: {
        ticket_id: id,
        completed_date: completedDate,
        hours_worked: hoursWorked,
        parts_used: finalParts,
        completion_notes: completionNotes ?? '',
        billing_amount: finalBillingAmount,
        customer_signature: customerSignature,
        customer_signature_name: customerSignatureName,
        photos: photos ?? [],
        po_number: poNumber ?? null,
        billing_contact_name: billingContactName ?? null,
        billing_contact_email: billingContactEmail ?? null,
        billing_contact_phone: billingContactPhone ?? null,
        additional_parts_used: finalAdditionalParts,
        additional_hours_worked: finalAdditionalHours,
        machine_hours: machineHours,
        date_code: dateCode.trim(),
        show_pricing: showPricingSnapshot,
        completed_month: completedMonth,
        completed_year: completedYear,
        ace_labor: aceLabor
          ? {
              hours: aceLabor.hours,
              reason: aceLabor.reason.trim(),
              labor_rate_type: laborRateType,
            }
          : null,
      },
    })

    if (rpcErr) {
      // Distinct PG error codes -> user-friendly HTTP responses.
      if (rpcErr.message?.includes('ALREADY_BILLED')) {
        return NextResponse.json(
          { error: 'Ticket is already billed and cannot be re-completed' },
          { status: 409 }
        )
      }
      if (rpcErr.message?.includes('ACE_LOCKED')) {
        return NextResponse.json(
          { error: 'ACE labor entry already approved/paid; cannot be changed here.' },
          { status: 409 }
        )
      }
      if (rpcErr.message?.includes('TICKET_NOT_FOUND')) {
        return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
      }
      if (rpcErr.message?.includes('FORBIDDEN')) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      console.error(`[complete] fn_complete_pm_ticket failed for ticket ${id}:`, rpcErr)
      return NextResponse.json({ error: 'Failed to complete ticket' }, { status: 500 })
    }

    const result = rpcResult as { ticket: Record<string, unknown> } | null
    if (!result?.ticket) {
      console.error(`[complete] fn_complete_pm_ticket returned no ticket for ${id}`)
      return NextResponse.json({ error: 'Failed to complete ticket' }, { status: 500 })
    }

    // Auto-acknowledge pickup on any staged part the tech took but never tapped
    // "Picked Up" (the on-order hard-block above means every live part is already
    // received or pulled by here). fn_complete_pm_ticket leaves parts_requested
    // untouched, so stamp it in a follow-up write. Non-fatal: completion already
    // landed. Service-role client — a technician can't write via the manager-
    // gated parts RPC.
    try {
      const staged = stampCollectedOnStaged(
        current.parts_requested as PartRequest[] | null,
        user.id,
        new Date().toISOString(),
      )
      if (staged.changed) {
        const admin = await createAdminClient('SERVER_ONLY')
        await admin.from('pm_tickets').update({ parts_requested: staged.parts }).eq('id', id)
      }
    } catch (stampErr) {
      console.error(`[complete] auto-collect stamp failed for ticket ${id}:`, stampErr)
    }

    return NextResponse.json(result.ticket)
  } catch (err) {
    console.error(`tickets/[id]/complete error:`, err)
    return NextResponse.json(
      { error: 'Failed to complete ticket' },
      { status: 500 }
    )
  }
}
