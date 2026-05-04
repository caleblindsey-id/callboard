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
import { getSetting } from '@/lib/db/settings'

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
  'billing_amount',
  'diagnostic_charge',
  'diagnostic_invoice_number',
  'awaiting_pickup',
  'picked_up_at',
  'generate_approval_token',
  'manual_decision_note',
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

    // Fetch current ticket state for validation
    const supabase = await createClient()
    const { data: current, error: fetchError } = await supabase
      .from('service_tickets')
      .select('status, customer_id, assigned_technician_id, parts_requested, estimate_amount, billing_type, photos')
      .eq('id', id)
      .single()

    if (fetchError || !current) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
    }

    // Techs can only update their own assigned tickets
    if (isTechnician(user.role) && current.assigned_technician_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
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

      // Validate transition
      const allowed = SERVICE_VALID_TRANSITIONS[currentStatus] ?? []
      if (!allowed.includes(nextStatus)) {
        return NextResponse.json(
          { error: `Invalid status transition: ${currentStatus} → ${nextStatus}` },
          { status: 409 }
        )
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

      // --- Hard block: completed → billed requires synergy_order_number ---
      if (nextStatus === 'billed') {
        // Check if synergy_order_number is being set in this request or already exists
        const synergyOrderNum = filtered.synergy_order_number ?? null
        if (!synergyOrderNum) {
          // Check existing value
          const { data: full } = await supabase
            .from('service_tickets')
            .select('synergy_order_number')
            .eq('id', id)
            .single()
          if (!full?.synergy_order_number) {
            return NextResponse.json(
              { error: 'Synergy order number is required to mark a ticket as billed' },
              { status: 400 }
            )
          }
        }
      }

      // Auto-set started_at when transitioning to in_progress
      if (nextStatus === 'in_progress') {
        const { data: ticketData } = await supabase
          .from('service_tickets')
          .select('started_at')
          .eq('id', id)
          .single()
        if (!ticketData?.started_at) {
          filtered.started_at = new Date().toISOString()
        }
      }

      // Reopen: clear completion + estimate data when going back to 'open'.
      // Also clean orphaned photos from Storage (DB array gets cleared below;
      // matching blob removal prevents Storage from accumulating dead objects).
      if (nextStatus === 'open' && ['completed', 'billed', 'in_progress'].includes(currentStatus)) {
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

      // Staff inline approval (status -> 'approved') should also retire the
      // public approval token so the link panel doesn't keep showing a live URL.
      if (nextStatus === 'approved' && currentStatus !== 'approved') {
        Object.assign(filtered, {
          approval_token: null,
          approval_token_expires_at: null,
        })
      }
    }

    // --- Estimate recomputation ---
    // Recompute estimate_amount whenever estimate_parts or estimate_labor_hours
    // is changing, regardless of status. The previous version only ran on
    // open → estimated transitions, leaving the stored amount stale after any
    // staff revision (which the PDF route then prints as the canonical total).
    const estimateInputsChanged =
      filtered.estimate_parts !== undefined ||
      filtered.estimate_labor_hours !== undefined ||
      filtered.status === 'estimated'

    if (estimateInputsChanged) {
      const rateStr = await getSetting('labor_rate_per_hour')
      const laborRate = rateStr ? parseFloat(rateStr) : 75

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
      // parts_received: ignore cancelled parts. Without this filter, a single
      // cancelled part keeps parts_received=false forever (since cancelled parts
      // retain their pre-cancel status, never 'received').
      const live = parts.filter((p: PartRequest) => !p.cancelled)
      const allReceived = live.length > 0 && live.every((p: PartRequest) => p.status === 'received')
      filtered.parts_received = allReceived
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

    // Fetch ticket to get photos for cleanup
    const { data: ticket, error: fetchError } = await supabase
      .from('service_tickets')
      .select('id, photos')
      .eq('id', id)
      .single()

    if (fetchError || !ticket) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
    }

    // Clean up photos from Supabase Storage
    const photos = (ticket.photos as { storage_path: string }[] | null) ?? []
    if (photos.length > 0) {
      await supabase.storage
        .from('ticket-photos')
        .remove(photos.map((p: { storage_path: string }) => p.storage_path))
    }

    const { error: deleteError } = await supabase
      .from('service_tickets')
      .delete()
      .eq('id', id)

    if (deleteError) throw deleteError

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('service-tickets/[id] DELETE error:', err)
    return NextResponse.json({ error: 'Failed to delete service ticket' }, { status: 500 })
  }
}
