import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getServiceTicket, updateServiceTicket } from '@/lib/db/service-tickets'
import { getCurrentUser, isTechnician, RESET_ROLES } from '@/lib/auth'
import {
  ServiceTicketStatus,
  SERVICE_VALID_TRANSITIONS,
  SERVICE_MANAGER_ONLY_TARGETS,
  PartRequest,
  ServicePartUsed,
} from '@/types/service-tickets'
import { getCustomerLaborRate } from '@/lib/db/settings'
import { validatePhotoStoragePath } from '@/lib/security/storage-paths'
import { isTicketCreditGated } from '@/lib/credit-review'
import { partsOnOrder, validateNewManualPartRequests, hasNewRequestedPart } from '@/lib/parts'
import { buildProductCostMap } from '@/lib/db/products'
import { checkPartLines, minPrice } from '@/lib/margin'

// Status transitions that count as "performing work" — blocked while a credit
// review is pending/blocked.
const CREDIT_GATED_SERVICE_TARGETS: ServiceTicketStatus[] = ['in_progress', 'completed', 'billed']

// Fields staff (manager/coordinator) can update
const STAFF_ALLOWED_FIELDS = [
  'assigned_technician_id',
  'status',
  'priority',
  'ticket_type',
  'billing_type',
  'problem_description',
  'contact_name',
  'contact_email',
  'contact_phone',
  'ship_to_location_id',
  'service_address',
  'service_city',
  'service_state',
  'service_zip',
  'equipment_id',
  'equipment_make',
  'equipment_model',
  'equipment_serial_number',
  'diagnosis_notes',
  'estimate_labor_hours',
  'estimate_parts',
  'estimate_approved',
  'estimate_approved_at',
  'parts_requested',
  'parts_received',
  'synergy_order_number',
  'synergy_invoice_number',
  'billing_amount',
  'diagnostic_charge',
  'diagnostic_invoice_number',
  'awaiting_pickup',
  'picked_up_at',
  'picked_up_by_name',
  'shop_location',
  'generate_approval_token',
  'manual_decision_note',
  'request_info_note',
  'labor_rate_type',
] as const

// Fields techs can update
const TECH_ALLOWED_FIELDS = [
  'status',
  'diagnosis_notes',
  'estimate_labor_hours',
  'estimate_parts',
  'parts_requested',
  'hours_worked',
  'parts_used',
  'completion_notes',
  'photos',
  'customer_signature',
  'customer_signature_name',
  // Allowed so a tech resubmitting an estimate after a Request-More-Info
  // round-trip can clear the previous note in the same PATCH.
  'request_info_note',
] as const

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const user = await getCurrentUser()
    if (!user?.role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const ticket = await getServiceTicket(id)
    if (!ticket) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
    }

    // Techs can only see their own assigned tickets (RLS also enforces)
    if (isTechnician(user.role) && ticket.assigned_technician_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    return NextResponse.json(ticket)
  } catch (err) {
    console.error('service-tickets/[id] GET error:', err)
    return NextResponse.json({ error: 'Failed to fetch service ticket' }, { status: 500 })
  }
}

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
      ? TECH_ALLOWED_FIELDS as readonly string[]
      : STAFF_ALLOWED_FIELDS as readonly string[]

    const filtered = Object.fromEntries(
      Object.entries(raw).filter(([key]) => allowedFields.includes(key))
    )

    if (filtered.labor_rate_type !== undefined &&
        !['standard', 'industrial', 'vacuum'].includes(filtered.labor_rate_type as string)) {
      return NextResponse.json({ error: 'Invalid labor_rate_type' }, { status: 400 })
    }

    if (Object.keys(filtered).length === 0) {
      return NextResponse.json(
        { error: 'No recognized fields in request body' },
        { status: 400 }
      )
    }

    // billing_amount validation: must be a finite non-negative number when present.
    if (filtered.billing_amount !== undefined && filtered.billing_amount !== null) {
      if (typeof filtered.billing_amount !== 'number' || !Number.isFinite(filtered.billing_amount) || filtered.billing_amount < 0) {
        return NextResponse.json({ error: 'billing_amount must be a non-negative number' }, { status: 400 })
      }
    }

    // diagnostic_charge validation
    if (filtered.diagnostic_charge !== undefined && filtered.diagnostic_charge !== null) {
      const dc = filtered.diagnostic_charge
      if (typeof dc !== 'number' || !Number.isFinite(dc) || dc < 0) {
        return NextResponse.json({ error: 'diagnostic_charge must be a non-negative number' }, { status: 400 })
      }
    }

    // estimate_labor_hours validation
    if (filtered.estimate_labor_hours !== undefined && filtered.estimate_labor_hours !== null) {
      const h = parseFloat(String(filtered.estimate_labor_hours))
      if (!Number.isFinite(h) || h < 0) {
        return NextResponse.json({ error: 'estimate_labor_hours must be a non-negative number' }, { status: 400 })
      }
    }

    // estimate_parts validation: every line must have non-negative unit_price and positive quantity.
    if (filtered.estimate_parts !== undefined && Array.isArray(filtered.estimate_parts)) {
      for (const p of filtered.estimate_parts as ServicePartUsed[]) {
        const qty = Number(p.quantity)
        const price = Number(p.unit_price)
        if (!Number.isFinite(qty) || qty <= 0) {
          return NextResponse.json({ error: 'Each estimate part must have a positive quantity' }, { status: 400 })
        }
        if (!Number.isFinite(price) || price < 0) {
          return NextResponse.json({ error: 'Each estimate part unit_price must be non-negative' }, { status: 400 })
        }
      }
    }

    // photos validation: each entry must be a known image type scoped to this
    // ticket id. Prevents stored XSS via a malicious `.svg` served by signed URL.
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

    // Fetch current ticket state for validation
    const supabase = await createClient()
    const { data: current, error: fetchError } = await supabase
      .from('service_tickets')
      .select('status, customer_id, assigned_technician_id, parts_requested, estimate_amount, billing_type, labor_rate_type, photos, parts_used, equipment_make, equipment_model, equipment_serial_number, ticket_type, awaiting_pickup, ready_for_pickup_at, equipment(make, model, serial_number)')
      .eq('id', id)
      .single()

    if (fetchError || !current) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
    }

    // Techs can only update their own assigned tickets
    if (isTechnician(user.role) && current.assigned_technician_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // --- Margin floor (parts only, per-line) ---
    // A billable part line's price can't drop below 15% gross margin over loaded
    // cost (min price = cost / 0.85). Cost is sourced from the products catalog
    // here (server-authoritative); a client-supplied unit_cost is never trusted.
    // Lines with no catalog cost are allowed through (flagged in the UI). Only
    // BILLABLE lines are floored — warranty-covered parts aren't billed, so they
    // are excluded (mirrors the estimate/billing math).
    {
      const billingType =
        (filtered.billing_type as string | undefined) ?? current.billing_type ?? 'non_warranty'
      // Restrict an array to its billable lines for the current billing type.
      const billableOnly = (lines: ServicePartUsed[]): ServicePartUsed[] =>
        billingType === 'warranty'
          ? []
          : billingType === 'partial_warranty'
            ? lines.filter((p) => !p.warranty_covered)
            : lines

      const partFields = (['estimate_parts', 'parts_used'] as const).filter(
        (k) => Array.isArray(filtered[k]),
      )
      if (partFields.length > 0) {
        const allLines = partFields.flatMap((k) => filtered[k] as ServicePartUsed[])
        const costMap = await buildProductCostMap(supabase, allLines.map((l) => l.synergy_product_id))
        const lookup = (pid: number) => costMap.get(pid)

        // Techs must never see the min price (it back-derives loaded cost).
        const hideFloor = isTechnician(user.role)
        for (const key of partFields) {
          const billable = billableOnly(filtered[key] as ServicePartUsed[])
          const check = checkPartLines(billable, lookup)
          if (!check.ok) {
            const v = check.violations[0]
            return NextResponse.json(
              hideFloor
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

      // Backstop: a direct billing_amount override can't dip below the parts
      // revenue floor (sum of qty x line min-price for billable, known-cost
      // lines). Keeps the per-line floor from being bypassed via the total.
      if (typeof filtered.billing_amount === 'number' && billingType !== 'warranty') {
        const effParts = Array.isArray(filtered.parts_used)
          ? (filtered.parts_used as ServicePartUsed[])
          : ((current.parts_used as ServicePartUsed[] | null) ?? [])
        const billable = billableOnly(effParts)
        const costMap = await buildProductCostMap(supabase, billable.map((l) => l.synergy_product_id))
        let floorSum = 0
        for (const line of billable) {
          if (line.synergy_product_id == null) continue
          const mp = minPrice(costMap.get(line.synergy_product_id))
          if (mp != null) floorSum += mp * (Number(line.quantity) || 0)
        }
        if (filtered.billing_amount + 0.005 < floorSum) {
          return NextResponse.json(
            {
              error: `Billing amount $${filtered.billing_amount.toFixed(2)} is below the parts margin floor of $${floorSum.toFixed(2)} (15% over loaded cost).`,
            },
            { status: 400 },
          )
        }
      }
    }

    // --- Status transition logic ---
    if (filtered.status !== undefined) {
      const currentStatus = current.status as ServiceTicketStatus
      const nextStatus = filtered.status as ServiceTicketStatus

      // Manager-only targets (reopen to 'open', cancel)
      if (SERVICE_MANAGER_ONLY_TARGETS.includes(nextStatus) && nextStatus !== currentStatus) {
        if (!RESET_ROLES.includes(user.role!)) {
          return NextResponse.json({ error: 'Only managers can reopen or cancel tickets' }, { status: 403 })
        }
      }

      // Reopen-to-approved (worked ticket → estimate-approved phase) is also
      // a manager-only action. The normal estimated → approved staff approval
      // flow is unaffected because its source status isn't a worked state.
      if (
        nextStatus === 'approved' &&
        (['in_progress', 'completed', 'billed'] as ServiceTicketStatus[]).includes(currentStatus)
      ) {
        if (!RESET_ROLES.includes(user.role!)) {
          return NextResponse.json({ error: 'Only managers can reopen tickets' }, { status: 403 })
        }
      }

      // Validate transition
      const allowed = SERVICE_VALID_TRANSITIONS[currentStatus] ?? []
      if (!allowed.includes(nextStatus)) {
        return NextResponse.json(
          { error: `Invalid status transition: ${currentStatus} → ${nextStatus}` },
          { status: 409 }
        )
      }

      // Credit-hold gate: block advancement into "work" states while AR review
      // is pending/blocked.
      if (CREDIT_GATED_SERVICE_TARGETS.includes(nextStatus) && nextStatus !== currentStatus) {
        const creditGate = await isTicketCreditGated('service', id)
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

      // Techs can't complete via PATCH (must use /complete endpoint)
      if (isTechnician(user.role) && nextStatus === 'completed') {
        return NextResponse.json({ error: 'Use the complete endpoint to submit ticket completion' }, { status: 403 })
      }

      // Manual approve/decline requires a note for the record. The customer-
      // facing /api/approve/[token] route is the only path that's allowed to
      // transition an estimated ticket without a note. Auto-approval (under
      // the customer's threshold) hits this validator with nextStatus='estimated'
      // and rewrites the status afterward, so the guard correctly skips it.
      if (
        currentStatus === 'estimated' &&
        (nextStatus === 'approved' || nextStatus === 'declined')
      ) {
        const note = typeof filtered.manual_decision_note === 'string'
          ? filtered.manual_decision_note.trim()
          : ''
        if (note.length < 2) {
          return NextResponse.json(
            { error: 'A manual decision note is required when staff approves or declines an estimate.' },
            { status: 400 }
          )
        }
        filtered.manual_decision_note = note
      }

      // --- Hard block: completed → billed requires synergy_invoice_number ---
      // The invoice # is the proof the completed work was billed in SynergyERP.
      // (synergy_order_number is the separate parts-ordering order #, not a
      // billing gate — mirrors the PM gate on pm_tickets.synergy_invoice_number.)
      if (nextStatus === 'billed') {
        // Check if synergy_invoice_number is being set in this request or already exists
        const synergyInvoiceNum = filtered.synergy_invoice_number ?? null
        if (!synergyInvoiceNum) {
          // Check existing value
          const { data: full } = await supabase
            .from('service_tickets')
            .select('synergy_invoice_number')
            .eq('id', id)
            .single()
          if (!full?.synergy_invoice_number) {
            return NextResponse.json(
              { error: 'Synergy invoice number is required to mark a ticket as billed' },
              { status: 400 }
            )
          }
        }
      }

      // Auto-set started_at when transitioning to in_progress, and prefill the
      // work order from the approved estimate so the tech adjusts to actuals
      // instead of re-entering parts, hours, and the work description. Gated to
      // the estimate path (approved -> in_progress); the warranty
      // open -> in_progress path has no estimate to copy. Each field is seeded
      // only when its work-order counterpart is empty so we never clobber
      // tech-entered work — including the reopen-then-restart case, where the
      // reopen branch below already cleared completion data while preserving the
      // estimate, so a restart naturally re-prefills.
      if (nextStatus === 'in_progress') {
        const { data: ticketData } = await supabase
          .from('service_tickets')
          .select(
            'started_at, estimate_parts, estimate_labor_hours, diagnosis_notes, parts_used, hours_worked, completion_notes'
          )
          .eq('id', id)
          .single()
        if (!ticketData?.started_at) {
          filtered.started_at = new Date().toISOString()
        }
        if (currentStatus === 'approved' && ticketData) {
          const estimateParts = (ticketData.estimate_parts ?? []) as unknown[]
          const currentParts = (ticketData.parts_used ?? []) as unknown[]
          if (currentParts.length === 0 && estimateParts.length > 0) {
            filtered.parts_used = estimateParts
          }
          if (ticketData.hours_worked == null && ticketData.estimate_labor_hours != null) {
            filtered.hours_worked = ticketData.estimate_labor_hours
          }
          const currentNotes = ((ticketData.completion_notes ?? '') as string).trim()
          const diagnosis = ((ticketData.diagnosis_notes ?? '') as string).trim()
          if (currentNotes === '' && diagnosis !== '') {
            filtered.completion_notes = diagnosis
          }
        }
      }

      // Reopen: clear completion data when going back from a worked state.
      // Estimate fields are only cleared on the 'open' branch below — the
      // 'approved' branch preserves the estimate so a manager can edit
      // completion data without losing the customer-approved estimate.
      // Also clean orphaned photos from Storage (DB array gets cleared below;
      // matching blob removal prevents Storage from accumulating dead objects).
      if (
        (nextStatus === 'open' || nextStatus === 'approved') &&
        ['completed', 'billed', 'in_progress'].includes(currentStatus)
      ) {
        const existingPhotos = (current.photos ?? []) as Array<{ storage_path?: string }>
        const paths = existingPhotos.map(p => p.storage_path).filter((p): p is string => !!p)
        if (paths.length > 0) {
          await supabase.storage.from('ticket-photos').remove(paths).catch(err =>
            console.error('reopen: failed to remove orphaned photos', err)
          )
        }
        Object.assign(filtered, {
          completed_at: null,
          completion_notes: null,
          hours_worked: null,
          parts_used: [],
          billing_amount: null,
          customer_signature: null,
          customer_signature_name: null,
          photos: [],
          started_at: null,
          // Clear Synergy validation state so re-billing has to re-validate.
          synergy_order_number: null,
          synergy_validation_status: null,
          synergy_validated_at: null,
          // Clear the billing invoice # too — a reopened ticket must be re-billed
          // against a fresh invoice rather than inheriting the stale one.
          synergy_invoice_number: null,
          // Reopening a billed unit pulls it out of the pickup queue; the aging
          // clock restarts when it's re-billed.
          awaiting_pickup: false,
          ready_for_pickup_at: null,
        })
      }
      if (nextStatus === 'open') {
        Object.assign(filtered, {
          estimate_amount: null,
          estimate_labor_hours: null,
          estimate_labor_rate: null,
          estimate_parts: [],
          estimate_approved: false,
          estimate_approved_at: null,
          auto_approved: false,
          diagnosis_notes: null,
          estimate_signature: null,
          estimate_signature_name: null,
          approval_token: null,
          approval_token_expires_at: null,
          // Note: decline_reason is intentionally preserved for reference
        })
      }

      // Resubmitting an estimate after a Request-More-Info round-trip clears
      // the manager's note so the tech doesn't see a stale prompt next time.
      if (nextStatus === 'estimated' && currentStatus === 'open') {
        filtered.request_info_note = null
      }

      // Staff inline approval (status -> 'approved') should also retire the
      // public approval token so the link panel doesn't keep showing a live URL.
      if (nextStatus === 'approved' && currentStatus !== 'approved') {
        Object.assign(filtered, {
          approval_token: null,
          approval_token_expires_at: null,
        })
      }
    }

    // --- Ready-for-pickup custody bookkeeping ---
    // Auto-stage an INSIDE (bench/depot) ticket the moment it's invoiced
    // (billed), exactly once. This is what surfaces the unit in the pickup queue
    // and (R2) fires the customer notification. Guarded so a reopen→re-bill or an
    // unrelated field edit can't re-stamp the aging clock.
    if (
      filtered.status === 'billed' &&
      current.ticket_type === 'inside' &&
      current.status !== 'billed' &&
      !current.awaiting_pickup &&
      !current.ready_for_pickup_at
    ) {
      filtered.awaiting_pickup = true
      filtered.ready_for_pickup_at = new Date().toISOString()
    }
    // Any path that flips awaiting_pickup true (e.g. the manual "Mark Ready"
    // toggle on an inside ticket invoiced outside the app) starts the aging
    // clock if it isn't already running.
    if (
      filtered.awaiting_pickup === true &&
      !current.ready_for_pickup_at &&
      !filtered.ready_for_pickup_at
    ) {
      filtered.ready_for_pickup_at = new Date().toISOString()
    }
    // Confirming pickup captures who released custody (server-authoritative —
    // the client never supplies released_by_id).
    if (filtered.picked_up_at) {
      filtered.released_by_id = user.id
    }

    // --- Estimate recomputation ---
    // Recompute estimate_amount whenever estimate_parts or estimate_labor_hours
    // is changing, regardless of status. The previous version only ran on
    // open → estimated transitions, leaving the stored amount stale after any
    // staff revision (which the PDF route then prints as the canonical total).
    const estimateInputsChanged =
      filtered.estimate_parts !== undefined ||
      filtered.estimate_labor_hours !== undefined ||
      filtered.status === 'estimated' ||
      filtered.labor_rate_type !== undefined

    if (estimateInputsChanged) {
      const rateType = (filtered.labor_rate_type as string | undefined) ?? current.labor_rate_type ?? 'standard'
      const laborRate = await getCustomerLaborRate(current.customer_id, rateType)

      // Use the new value if supplied, otherwise fall back to the existing
      // ticket's stored value (one extra read in the rare revision case).
      let hours: number
      if (filtered.estimate_labor_hours !== undefined) {
        hours = parseFloat(String(filtered.estimate_labor_hours ?? 0))
      } else {
        const { data: existing } = await supabase
          .from('service_tickets')
          .select('estimate_labor_hours')
          .eq('id', id)
          .single()
        hours = parseFloat(String(existing?.estimate_labor_hours ?? 0))
      }

      let parts: ServicePartUsed[]
      if (filtered.estimate_parts !== undefined) {
        parts = (filtered.estimate_parts as ServicePartUsed[]) ?? []
      } else {
        const { data: existing } = await supabase
          .from('service_tickets')
          .select('estimate_parts')
          .eq('id', id)
          .single()
        parts = (existing?.estimate_parts as ServicePartUsed[]) ?? []
      }

      // Snapshot the labor rate at estimate time
      filtered.estimate_labor_rate = laborRate

      const laborTotal = (Number.isFinite(hours) ? hours : 0) * laborRate
      const billingType = current.billing_type ?? 'non_warranty'
      const partsTotal = billingType === 'warranty'
        ? 0
        : parts
            .filter((p: ServicePartUsed) => !p.warranty_covered)
            .reduce((sum: number, p: ServicePartUsed) => sum + (Number(p.quantity) || 0) * (Number(p.unit_price) || 0), 0)
      const total = laborTotal + partsTotal

      filtered.estimate_amount = total

      // Auto-approve only fires on the initial open → estimated transition;
      // post-submission revisions don't re-trigger auto-approval (a manager
      // could otherwise drop a revised total below the threshold to bypass
      // customer approval). Threshold is per-customer; $0 means never auto-approve.
      // Fail-safe: if the customer lookup fails, threshold falls back to 0 (never
      // auto-approve) rather than 100, so a lookup failure can't silently approve.
      if (current.status === 'open' && filtered.status === 'estimated') {
        const { data: cust } = await supabase
          .from('customers')
          .select('auto_approve_threshold')
          .eq('id', current.customer_id)
          .single()
        const threshold = Number(cust?.auto_approve_threshold ?? 0)
        if (threshold > 0 && total < threshold) {
          filtered.status = 'approved'
          filtered.estimate_approved = true
          filtered.estimate_approved_at = new Date().toISOString()
          filtered.auto_approved = true
        }
      }
    }

    // --- Generate approval token (for Email Estimate / Resend) ---
    if (filtered.generate_approval_token) {
      if (current.status !== 'estimated') {
        return NextResponse.json(
          { error: 'Can only generate approval tokens for estimated tickets' },
          { status: 409 }
        )
      }
      delete filtered.generate_approval_token  // not a real DB column
      filtered.approval_token = crypto.randomUUID()
      filtered.approval_token_expires_at = new Date(
        Date.now() + 7 * 24 * 60 * 60 * 1000
      ).toISOString()
    }

    // --- Reset validation when order number changes ---
    if (filtered.synergy_order_number !== undefined) {
      filtered.synergy_validation_status = 'pending'
      filtered.synergy_validated_at = null
    }

    // --- Parts received check + Synergy item # gate ---
    if (filtered.parts_requested !== undefined) {
      const parts = filtered.parts_requested as PartRequest[]
      // Any part that has moved past 'requested' must have a Synergy item # (product_number) captured
      const missingItemNo = parts.find(
        (p: PartRequest) => p.status !== 'requested' && !p.product_number?.trim()
      )
      if (missingItemNo) {
        return NextResponse.json(
          { error: 'Synergy item # is required on any part marked ordered or received.' },
          { status: 400 }
        )
      }
      // Required-field gate for NEW manual part requests (vendor name, vendor
      // part #, description, customer price), diffed against the stored array
      // (current.parts_requested) so legacy rows / status changes never fail.
      const existingParts = (current.parts_requested ?? []) as PartRequest[]
      const manualError = validateNewManualPartRequests(existingParts, parts)
      if (manualError) {
        return NextResponse.json({ error: manualError }, { status: 400 })
      }

      // Machine gate: a new part request requires make/model/serial on the
      // ticket. Service resolves inline equipment_* COALESCE'd over the linked
      // equipment row (mirrors the parts_order_queue view).
      if (hasNewRequestedPart(existingParts, parts)) {
        const linked = current.equipment as
          | { make: string | null; model: string | null; serial_number: string | null }
          | null
        const make = (current.equipment_make || linked?.make || '').trim()
        const model = (current.equipment_model || linked?.model || '').trim()
        const serial = (current.equipment_serial_number || linked?.serial_number || '').trim()
        if (!make || !model || !serial) {
          return NextResponse.json(
            { error: 'Machine make, model, and serial number must be on the ticket before requesting parts.' },
            { status: 400 }
          )
        }
      }
      // parts_received: ignore cancelled parts. Without this filter, a single
      // cancelled part keeps parts_received=false forever (since cancelled parts
      // retain their pre-cancel status, never 'received').
      const live = parts.filter((p: PartRequest) => !p.cancelled)
      const allReceived = live.length > 0 && live.every((p: PartRequest) => p.status === 'received')
      filtered.parts_received = allReceived
    }

    // Validate equipment_id belongs to this ticket's customer (prevents cross-customer linking)
    if (filtered.equipment_id != null) {
      const { data: equip } = await supabase
        .from('equipment')
        .select('customer_id')
        .eq('id', filtered.equipment_id as string)
        .maybeSingle()
      if (!equip || equip.customer_id !== current.customer_id) {
        return NextResponse.json(
          { error: 'Equipment does not belong to this ticket\'s customer' },
          { status: 422 }
        )
      }
    }

    const updated = await updateServiceTicket(id, filtered)
    return NextResponse.json(updated)
  } catch (err) {
    console.error('service-tickets/[id] PATCH error:', err)
    return NextResponse.json({ error: 'Failed to update service ticket' }, { status: 500 })
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
    if (!RESET_ROLES.includes(user.role!)) {
      return NextResponse.json({ error: 'Only managers can delete service tickets' }, { status: 403 })
    }

    const supabase = await createClient()

    // Fetch live ticket to check the parts guard. `.is('deleted_at', null)` so a
    // second delete of an already-deleted ticket returns a clean 404.
    const { data: ticket, error: fetchError } = await supabase
      .from('service_tickets')
      .select('id, parts_requested')
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle()

    if (fetchError) throw fetchError
    if (!ticket) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
    }

    // Block deletion while parts are still on order — even a soft delete hides
    // the ticket from boards, which would strand a live vendor PO out of view.
    const onOrder = partsOnOrder(ticket.parts_requested as PartRequest[] | null)
    if (onOrder.length > 0) {
      return NextResponse.json(
        {
          error: `Cannot delete: ${onOrder.length} part(s) are still on order. Receive or cancel them first.`,
        },
        { status: 409 }
      )
    }

    // Soft delete (parity with PM, migration 043/082). The row survives so a
    // manager can restore it; photos are kept so a restore is lossless.
    const { data: deleted, error: deleteError } = await supabase
      .from('service_tickets')
      .update({ deleted_at: new Date().toISOString(), deleted_by_id: user.id })
      .eq('id', id)
      .is('deleted_at', null)
      .select('id')
      .maybeSingle()

    if (deleteError) throw deleteError
    if (!deleted) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('service-tickets/[id] DELETE error:', err)
    return NextResponse.json({ error: 'Failed to delete service ticket' }, { status: 500 })
  }
}
