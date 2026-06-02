import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { updateTicket } from '@/lib/db/tickets'
import { updateAnchorMonth, deactivateSchedule } from '@/lib/db/schedules'
import { isSkipReasonCategory, isStopReason } from '@/lib/skip-reasons'
import { getCurrentUser, isTechnician, RESET_ROLES } from '@/lib/auth'
import { PartRequest, PartUsed, PmTicketUpdate, TicketStatus } from '@/types/database'
import { VALID_TRANSITIONS, EMPTY_COMPLETION_FIELDS } from '@/lib/ticket-transitions'
import { validatePhotoStoragePath } from '@/lib/security/storage-paths'
import { isTicketCreditGated } from '@/lib/credit-review'
import { partsOnOrder, validateNewManualPartRequests, hasNewRequestedPart } from '@/lib/parts'

// Status transitions that count as "performing work" — blocked while a credit
// review is pending/blocked.
const CREDIT_GATED_PM_TARGETS: TicketStatus[] = ['in_progress', 'completed', 'billed']

// Only allow these fields to be updated via PATCH. `skip_previous_status` is
// intentionally excluded — it's set server-side inside the skip-request branch
// and clients should never write it directly.
const ALLOWED_FIELDS = [
  'assigned_technician_id',
  'status',
  'scheduled_date',
  'completed_date',
  'completion_notes',
  'hours_worked',
  'parts_used',
  'billing_amount',
  'photos',
  'po_number',
  'billing_contact_name',
  'billing_contact_email',
  'billing_contact_phone',
  'additional_parts_used',
  'additional_hours_worked',
  'skip_reason',
  'skip_reason_category',
  'skip_recommended_month',
  'skip_recommended_year',
  'skip_equipment_on_site',
  'parts_requested',
  'synergy_order_number',
  'machine_hours',
  'date_code',
] as const

const TECH_ALLOWED_FIELDS = [
  'status',
  'completed_date',
  'completion_notes',
  'hours_worked',
  'parts_used',
  'photos',
  'po_number',
  'billing_contact_name',
  'billing_contact_email',
  'billing_contact_phone',
  'additional_parts_used',
  'additional_hours_worked',
  'skip_reason',
  'skip_reason_category',
  'skip_recommended_month',
  'skip_recommended_year',
  'skip_equipment_on_site',
  'parts_requested',
  'machine_hours',
  'date_code',
] as const

type AllowedFieldName = typeof ALLOWED_FIELDS[number]
type FilteredUpdate = Partial<Record<AllowedFieldName, unknown>>

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const raw = await request.json()

    const user = await getCurrentUser()
    if (!user?.role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const allowedFields = isTechnician(user.role)
      ? (TECH_ALLOWED_FIELDS as readonly string[])
      : (ALLOWED_FIELDS as readonly string[])

    const filtered = Object.fromEntries(
      Object.entries(raw).filter(([key]) => allowedFields.includes(key))
    ) as FilteredUpdate

    if (Object.keys(filtered).length === 0) {
      return NextResponse.json(
        { error: 'No recognized fields in request body' },
        { status: 400 }
      )
    }

    // Defense-in-depth: techs can only modify their own assigned tickets,
    // regardless of which fields they're updating. (RLS enforces this too,
    // but we don't rely on RLS as the only line.)
    const supabase = await createClient()
    if (isTechnician(user.role)) {
      const { data: owned } = await supabase
        .from('pm_tickets')
        .select('assigned_technician_id')
        .eq('id', id)
        .is('deleted_at', null)
        .single()
      if (!owned || owned.assigned_technician_id !== user.id) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    // PM parts always have unit_price zeroed (inventory tracking only). Mirror
    // the /complete route's invariant so PATCH can't smuggle priced PM parts.
    if (filtered.parts_used !== undefined && Array.isArray(filtered.parts_used)) {
      filtered.parts_used = (filtered.parts_used as PartUsed[]).map(p => ({
        ...p,
        unit_price: 0,
      }))
    }

    // photos validation: scoped to this ticket id, known image type only.
    if (filtered.photos !== undefined) {
      if (!Array.isArray(filtered.photos)) {
        return NextResponse.json({ error: 'photos must be an array' }, { status: 400 })
      }
      const expectedPrefix = `${id}/`
      for (const p of filtered.photos as Array<{ storage_path?: unknown }>) {
        const check = validatePhotoStoragePath(p?.storage_path, expectedPrefix)
        if (!check.ok) {
          return NextResponse.json({ error: check.error }, { status: 400 })
        }
      }
    }

    // Synergy item # gate: any part past 'requested' must have product_number set
    if (filtered.parts_requested !== undefined) {
      const parts = filtered.parts_requested as PartRequest[]
      const missingItemNo = parts.find(
        (p) => p.status !== 'requested' && !p.product_number?.trim()
      )
      if (missingItemNo) {
        return NextResponse.json(
          { error: 'Synergy item # is required on any part marked ordered or received.' },
          { status: 400 }
        )
      }

      // Required-field gate for NEW manual part requests (vendor name, vendor
      // part #, description, customer price). Diff against the stored array so
      // legacy rows and status changes on existing parts never hard-fail. Also
      // pull the linked equipment row to gate on machine make/model/serial.
      const { data: existingRaw } = await supabase
        .from('pm_tickets')
        .select('parts_requested, equipment(make, model, serial_number)')
        .eq('id', id)
        .is('deleted_at', null)
        .single()
      const existing = existingRaw as unknown as {
        parts_requested: PartRequest[] | null
        equipment: { make: string | null; model: string | null; serial_number: string | null } | null
      } | null
      const existingParts = (existing?.parts_requested ?? []) as PartRequest[]
      const manualError = validateNewManualPartRequests(existingParts, parts)
      if (manualError) {
        return NextResponse.json({ error: manualError }, { status: 400 })
      }

      // Machine gate: a new part request requires make/model/serial on the
      // ticket. PM reads the linked equipment row.
      if (hasNewRequestedPart(existingParts, parts)) {
        const eq = existing?.equipment
        if (!eq?.make?.trim() || !eq?.model?.trim() || !eq?.serial_number?.trim()) {
          return NextResponse.json(
            { error: 'Machine make, model, and serial number must be on the linked equipment before requesting parts.' },
            { status: 400 }
          )
        }
      }
    }

    // If a status transition is requested, validate it against the state machine
    if (filtered.status !== undefined) {
      const { data: current, error: fetchError } = await supabase
        .from('pm_tickets')
        .select('status, assigned_technician_id')
        .eq('id', id)
        .is('deleted_at', null)
        .single()

      if (fetchError || !current) {
        return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
      }

      const currentStatus = current.status as TicketStatus
      const nextStatus = filtered.status as TicketStatus

      // Completion must go through POST /api/tickets/[id]/complete so billing
      // math, signature, machine_hours, and date_code are all enforced — but
      // `billed → completed` is a legitimate re-export reset path that
      // preserves completion data and only flips billing_exported back. The
      // 422 below applies to every other source status.
      if (nextStatus === 'completed' && currentStatus !== 'billed') {
        return NextResponse.json(
          { error: 'Use POST /api/tickets/[id]/complete to mark a ticket complete' },
          { status: 422 }
        )
      }

      // Techs can never set status to billed (managers only — billing is a back-office action).
      if (isTechnician(user.role) && nextStatus === 'billed') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }

      const allowed = VALID_TRANSITIONS[currentStatus] ?? []
      if (!allowed.includes(nextStatus)) {
        return NextResponse.json(
          { error: `Invalid status transition: ${currentStatus} → ${nextStatus}` },
          { status: 409 }
        )
      }

      // Credit-hold gate: block advancement into "work" states while AR review
      // is pending/blocked.
      if (CREDIT_GATED_PM_TARGETS.includes(nextStatus)) {
        const creditGate = await isTicketCreditGated('pm', id)
        if (creditGate) {
          return NextResponse.json(
            {
              error:
                creditGate.status === 'blocked'
                  ? 'This order is blocked by AR — a manager must enter the release passcode.'
                  : 'This order is pending AR credit review.',
            },
            { status: 423 }
          )
        }
      }

      // Reopening tickets: only managers/coordinators
      const isReopen =
        (currentStatus === 'completed' && nextStatus === 'in_progress') ||
        (currentStatus === 'skipped' && nextStatus === 'unassigned')
      if (isReopen) {
        if (isTechnician(user.role)) {
          return NextResponse.json({ error: 'Only managers can reopen tickets' }, { status: 403 })
        }
        const updateData: Record<string, unknown> = currentStatus === 'completed'
          ? { status: 'in_progress' as const, ...EMPTY_COMPLETION_FIELDS }
          : { status: 'unassigned' as const }
        const updated = await updateTicket(id, updateData)
        return NextResponse.json(updated)
      }

      // Tech requesting a skip — store the structured request + previous status
      if (nextStatus === 'skip_requested') {
        const category = raw.skip_reason_category
        if (!isSkipReasonCategory(category)) {
          return NextResponse.json({ error: 'A valid reason category is required when requesting a skip' }, { status: 400 })
        }

        // Notes are now optional (the category carries the required signal).
        const notes = typeof raw.skip_reason === 'string' ? raw.skip_reason.trim() : ''

        // Recommended next-PM month/year — the customer's request relayed by the
        // tech. Month is what the reschedule actually applies (see approve branch);
        // year is captured for the manager's visibility only.
        const recMonth = Number(raw.skip_recommended_month)
        const recommendedMonth = recMonth >= 1 && recMonth <= 12 ? recMonth : null
        const recYear = Number(raw.skip_recommended_year)
        const recommendedYear = Number.isInteger(recYear) && recYear >= 2000 && recYear <= 2100 ? recYear : null

        // A "stop" reason (equipment removed / service ended) means the equipment
        // is gone — coerce on-site to false regardless of the submitted toggle.
        const equipmentOnSite = isStopReason(category)
          ? false
          : typeof raw.skip_equipment_on_site === 'boolean'
            ? raw.skip_equipment_on_site
            : null

        const updated = await updateTicket(id, {
          status: 'skip_requested',
          skip_reason: notes || null,
          skip_reason_category: category,
          skip_recommended_month: recommendedMonth,
          skip_recommended_year: recommendedYear,
          skip_equipment_on_site: equipmentOnSite,
          skip_previous_status: currentStatus,
        })
        return NextResponse.json(updated)
      }

      // Manager denying a skip request — revert to previous status
      if (currentStatus === 'skip_requested' && nextStatus !== 'skipped') {
        if (isTechnician(user.role)) {
          return NextResponse.json({ error: 'Only managers can approve or deny skip requests' }, { status: 403 })
        }
        // Denial reverts the ticket — discard the whole skip request.
        const updated = await updateTicket(id, {
          status: nextStatus,
          skip_reason: null,
          skip_reason_category: null,
          skip_recommended_month: null,
          skip_recommended_year: null,
          skip_equipment_on_site: null,
          skip_previous_status: null,
        })
        return NextResponse.json(updated)
      }

      // Skipping with optional reschedule (manager approval of skip request, or direct skip)
      if (nextStatus === 'skipped') {
        if (currentStatus === 'skip_requested' && isTechnician(user.role)) {
          return NextResponse.json({ error: 'Only managers can approve skip requests' }, { status: 403 })
        }
        // Preserve the structured skip metadata (category, recommended month/year,
        // on-site flag, notes) — the ticket IS skipped, so these are its permanent
        // record and the reporting signal. Only clear the internal revert pointer.
        const updated = await updateTicket(id, {
          status: 'skipped',
          skip_previous_status: null,
        })

        // Stop vs reschedule are mutually exclusive: deactivating the schedule
        // leaves no future cycle for a new anchor month to affect.
        const { data: ticketData } = await supabase
          .from('pm_tickets')
          .select('pm_schedule_id')
          .eq('id', id)
          .single()
        if (ticketData?.pm_schedule_id) {
          if (raw.deactivate_schedule === true) {
            await deactivateSchedule(ticketData.pm_schedule_id)
          } else {
            const rescheduleMonth = Number(raw.reschedule_month)
            if (rescheduleMonth >= 1 && rescheduleMonth <= 12) {
              await updateAnchorMonth(ticketData.pm_schedule_id, rescheduleMonth)
            }
          }
        }
        return NextResponse.json(updated)
      }

      // assigned → unassigned: clear technician assignment too (otherwise the
      // old tech_id sticks around and corrupts listing/auto-cancel logic).
      if (currentStatus === 'assigned' && nextStatus === 'unassigned') {
        const updated = await updateTicket(id, {
          status: 'unassigned',
          assigned_technician_id: null,
        })
        return NextResponse.json(updated)
      }

      // Manager-only status resets (backwards transitions)
      const isReset =
        (currentStatus === 'in_progress' && (nextStatus === 'assigned' || nextStatus === 'unassigned')) ||
        (currentStatus === 'billed')
      if (isReset) {
        if (!RESET_ROLES.includes(user.role)) {
          return NextResponse.json({ error: 'Only managers can reset ticket status' }, { status: 403 })
        }

        // Build the update payload via PmTicketUpdate so TS validates field names
        const updateData: PmTicketUpdate = { status: nextStatus }

        if (currentStatus === 'billed') {
          updateData.billing_exported = false
          // `billed → completed` is the non-destructive re-export path: keep
          // all completion data (signature, photos, billing_amount, etc.) so
          // the manager can correct + re-export. Every other reset target
          // wipes draft completion data.
          if (nextStatus !== 'completed') {
            Object.assign(updateData, EMPTY_COMPLETION_FIELDS)
          }
        } else {
          // in_progress → assigned/unassigned: clear draft completion data
          Object.assign(updateData, EMPTY_COMPLETION_FIELDS)
        }

        if (nextStatus === 'unassigned') {
          updateData.assigned_technician_id = null
        }

        const updated = await updateTicket(id, updateData)
        return NextResponse.json(updated)
      }
    }

    const updated = await updateTicket(id, filtered as PmTicketUpdate)
    return NextResponse.json(updated)
  } catch (err) {
    console.error(`tickets/[id] PATCH error:`, err)
    return NextResponse.json(
      { error: 'Failed to update ticket' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const user = await getCurrentUser()
    if (!user?.role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!RESET_ROLES.includes(user.role)) {
      return NextResponse.json({ error: 'Only managers can delete tickets' }, { status: 403 })
    }

    const supabase = await createClient()

    // Block deletion while parts are still on order, so a live vendor PO never
    // loses its parent ticket. Mirrors the completion guard in TicketActions.
    const { data: existing, error: fetchError } = await supabase
      .from('pm_tickets')
      .select('id, parts_requested')
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle()

    if (fetchError) throw fetchError
    if (!existing) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
    }

    const onOrder = partsOnOrder(existing.parts_requested as PartRequest[] | null)
    if (onOrder.length > 0) {
      return NextResponse.json(
        {
          error: `Cannot delete: ${onOrder.length} part(s) are still on order. Receive or cancel them first.`,
        },
        { status: 409 }
      )
    }

    // Soft-delete: leaves the row in place so the PM generator's (pm_schedule_id, month, year)
    // dedup query continues to block regeneration. Photos are kept so Restore returns a
    // complete ticket. A future purge job can hard-delete + clean storage after N days.
    const { data: updated, error: updateError } = await supabase
      .from('pm_tickets')
      .update({ deleted_at: new Date().toISOString(), deleted_by_id: user.id })
      .eq('id', id)
      .is('deleted_at', null)
      .select('id')
      .maybeSingle()

    if (updateError) throw updateError
    if (!updated) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error(`tickets/[id] DELETE error:`, err)
    return NextResponse.json(
      { error: 'Failed to delete ticket' },
      { status: 500 }
    )
  }
}
