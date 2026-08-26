import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser, isTechnician, MANAGER_ROLES } from '@/lib/auth'
import type { ServiceTicketUpdate, ServicePartUsed } from '@/types/service-tickets'

// Tech-facing "flag for warranty review" + office verdict workflow (migration
// 160). Warranty is moving from a pricing switch (billing_type) to a review
// lifecycle: a tech (or staff) flags a ticket they think is covered, and the
// office verifies coverage part-by-part (or denies it). This route owns only
// the review lifecycle columns — it never touches billing_type, pricing, the
// completion form, or customer_bill_amount (a later round wires that recompute).
// See lib/service-tickets/warranty.ts for the pure helpers this lifecycle feeds.
//
// Body: { action: 'flag' | 'unflag' | 'verify' | 'deny', ... } — see each
// branch below for its own fields.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const user = await getCurrentUser()
    if (!user?.role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const action = body?.action as string | undefined
    if (!['flag', 'unflag', 'verify', 'deny'].includes(action ?? '')) {
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }

    const supabase = await createClient()
    const now = new Date().toISOString()

    // --- flag: tech (own ticket) or staff (any ticket) requests a review ---
    if (action === 'flag') {
      const note = typeof body?.note === 'string' ? body.note.trim() : ''
      if (note.length < 2) {
        return NextResponse.json(
          { error: 'A note is required to flag a ticket for warranty review.' },
          { status: 400 }
        )
      }

      const { data: current, error: fetchError } = await supabase
        .from('service_tickets')
        .select('id, status, deleted_at, assigned_technician_id')
        .eq('id', id)
        .single()
      if (fetchError || !current || current.deleted_at) {
        return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
      }
      // A technician may only flag their own assigned ticket; any other
      // authenticated role (managers, coordinators, purchasing) may flag any.
      if (isTechnician(user.role) && current.assigned_technician_id !== user.id) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      if (['billed', 'canceled', 'declined'].includes(current.status)) {
        return NextResponse.json(
          { error: 'This ticket can no longer be flagged for warranty review.' },
          { status: 400 }
        )
      }

      const update: ServiceTicketUpdate = {
        warranty_review_status: 'requested',
        warranty_review_requested_at: now,
        warranty_review_requested_by_id: user.id,
        warranty_review_note: note,
      }

      const { data, error } = await supabase
        .from('service_tickets')
        .update(update)
        .eq('id', id)
        .is('deleted_at', null)
        .is('warranty_review_status', null)
        .select()
        .single()

      if (error) {
        if (error.code === 'PGRST116') {
          return NextResponse.json(
            { error: 'This ticket is already flagged for warranty review.' },
            { status: 409 }
          )
        }
        console.error('warranty-review flag: update failed', error)
        return NextResponse.json({ error: 'Failed to flag for warranty review' }, { status: 500 })
      }

      return NextResponse.json({ ok: true, ticket: data })
    }

    // --- unflag: staff any state; a technician only their own still-pending request ---
    if (action === 'unflag') {
      const { data: current, error: fetchError } = await supabase
        .from('service_tickets')
        .select('id, deleted_at, warranty_review_status, warranty_review_requested_by_id')
        .eq('id', id)
        .single()
      if (fetchError || !current || current.deleted_at) {
        return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
      }

      const isStaff = MANAGER_ROLES.includes(user.role)
      if (!isStaff) {
        const isOwnPendingRequest =
          isTechnician(user.role) &&
          current.warranty_review_requested_by_id === user.id &&
          current.warranty_review_status === 'requested'
        if (!isOwnPendingRequest) {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }
      }

      // Nulls the whole review lifecycle. Leaves warranty_vendor,
      // warranty_vendor_labor_rate, and the claim/credit fields alone — those
      // are the separate vendor-credit worklist, untouched by a flag/unflag.
      const update: ServiceTicketUpdate = {
        warranty_review_status: null,
        warranty_review_requested_at: null,
        warranty_review_requested_by_id: null,
        warranty_review_note: null,
        warranty_review_decided_at: null,
        warranty_review_decided_by_id: null,
        warranty_review_decision_note: null,
      }

      const { data, error } = await supabase
        .from('service_tickets')
        .update(update)
        .eq('id', id)
        .is('deleted_at', null)
        .not('warranty_review_status', 'is', null)
        .select()
        .single()

      if (error) {
        if (error.code === 'PGRST116') {
          return NextResponse.json(
            { error: 'This ticket is not flagged for warranty review.' },
            { status: 409 }
          )
        }
        console.error('warranty-review unflag: update failed', error)
        return NextResponse.json({ error: 'Failed to remove the warranty flag' }, { status: 500 })
      }

      return NextResponse.json({ ok: true, ticket: data })
    }

    // verify / deny are office-only decisions from here on.
    if (!MANAGER_ROLES.includes(user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // --- deny: bills full price, records why ---
    if (action === 'deny') {
      const decisionNote = typeof body?.decision_note === 'string' ? body.decision_note.trim() : ''
      if (decisionNote.length < 2) {
        return NextResponse.json(
          { error: 'A reason is required to deny warranty coverage.' },
          { status: 400 }
        )
      }

      const update: ServiceTicketUpdate = {
        warranty_review_status: 'denied',
        warranty_review_decided_at: now,
        warranty_review_decided_by_id: user.id,
        warranty_review_decision_note: decisionNote,
      }

      const { data, error } = await supabase
        .from('service_tickets')
        .update(update)
        .eq('id', id)
        .is('deleted_at', null)
        .not('warranty_review_status', 'is', null)
        .select()
        .single()

      if (error) {
        if (error.code === 'PGRST116') {
          return NextResponse.json(
            { error: 'This ticket is not flagged for warranty review.' },
            { status: 409 }
          )
        }
        console.error('warranty-review deny: update failed', error)
        return NextResponse.json({ error: 'Failed to deny warranty coverage' }, { status: 500 })
      }

      return NextResponse.json({ ok: true, ticket: data })
    }

    // --- verify: coverage confirmed, per-part + labor + vendor details ---
    const laborCovered = body?.labor_covered
    if (typeof laborCovered !== 'boolean') {
      return NextResponse.json({ error: 'labor_covered is required' }, { status: 400 })
    }

    // Numeric guard — mirrors warranty-claim/route.ts: finite, non-negative
    // when present; undefined means "leave alone", null clears it.
    const num = (v: unknown): number | null | undefined => {
      if (v === undefined) return undefined
      if (v === null || v === '') return null
      const n = Number(v)
      return Number.isFinite(n) ? n : NaN
    }
    const vendorLaborRate = num(body?.vendor_labor_rate)
    if (Number.isNaN(vendorLaborRate) || (typeof vendorLaborRate === 'number' && vendorLaborRate < 0)) {
      return NextResponse.json(
        { error: 'vendor_labor_rate must be a non-negative number' },
        { status: 400 }
      )
    }

    const partsField = body?.parts_field
    if (partsField !== undefined && partsField !== 'parts_used' && partsField !== 'estimate_parts') {
      return NextResponse.json(
        { error: 'parts_field must be parts_used or estimate_parts' },
        { status: 400 }
      )
    }

    const coveredIndexesRaw = body?.covered_part_indexes
    let coveredSet: Set<number> | null = null
    if (coveredIndexesRaw !== undefined) {
      if (
        !Array.isArray(coveredIndexesRaw) ||
        !coveredIndexesRaw.every((n) => Number.isInteger(n) && n >= 0)
      ) {
        return NextResponse.json(
          { error: 'covered_part_indexes must be an array of non-negative integers' },
          { status: 400 }
        )
      }
      coveredSet = new Set(coveredIndexesRaw as number[])
    }
    // Per-part coverage only makes sense as a pair — a field with no indexes
    // (or indexes with no field to address) is an ambiguous request.
    if ((coveredSet !== null) !== (partsField !== undefined)) {
      return NextResponse.json(
        { error: 'parts_field and covered_part_indexes must be provided together' },
        { status: 400 }
      )
    }

    const decisionNoteRaw = typeof body?.decision_note === 'string' ? body.decision_note.trim() : undefined
    const vendorRaw = typeof body?.vendor === 'string' ? body.vendor.trim() : undefined

    const update: ServiceTicketUpdate = {
      warranty_review_status: 'verified',
      warranty_review_decided_at: now,
      warranty_review_decided_by_id: user.id,
      warranty_labor_covered: laborCovered,
    }
    if (decisionNoteRaw !== undefined) update.warranty_review_decision_note = decisionNoteRaw || null
    if (vendorRaw !== undefined) update.warranty_vendor = vendorRaw || null
    if (vendorLaborRate !== undefined) update.warranty_vendor_labor_rate = vendorLaborRate

    // Per-part coverage: read the current array, flip warranty_covered at the
    // listed indexes (true) and everywhere else (false), write the whole array
    // back in the same update. Two literal select branches, not a computed
    // column string — supabase-js parses the select literal at the type level,
    // so a variable column name collapses the row type to SelectQueryError
    // (same landmine noted in parts-queue/update/route.ts).
    if (coveredSet && partsField) {
      const partsQuery =
        partsField === 'parts_used'
          ? supabase.from('service_tickets').select('parts_used').eq('id', id).single()
          : supabase.from('service_tickets').select('estimate_parts').eq('id', id).single()
      const { data: partsRow, error: partsFetchError } = await partsQuery
      if (partsFetchError || !partsRow) {
        return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
      }
      const parts = (
        partsField === 'parts_used'
          ? (partsRow as { parts_used: ServicePartUsed[] | null }).parts_used
          : (partsRow as { estimate_parts: ServicePartUsed[] | null }).estimate_parts
      ) ?? []

      for (const idx of coveredSet) {
        if (idx >= parts.length) {
          return NextResponse.json(
            { error: 'covered_part_indexes has an index out of range' },
            { status: 400 }
          )
        }
      }

      const nextParts = parts.map((p, i) => ({ ...p, warranty_covered: coveredSet!.has(i) }))
      if (partsField === 'parts_used') {
        update.parts_used = nextParts
      } else {
        update.estimate_parts = nextParts
      }
    }

    const { data, error } = await supabase
      .from('service_tickets')
      .update(update)
      .eq('id', id)
      .is('deleted_at', null)
      .not('warranty_review_status', 'is', null)
      .select()
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json(
          { error: 'This ticket is not flagged for warranty review.' },
          { status: 409 }
        )
      }
      console.error('warranty-review verify: update failed', error)
      return NextResponse.json({ error: 'Failed to verify warranty coverage' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, ticket: data })
  } catch (err) {
    console.error('service-tickets/[id]/warranty-review POST error:', err)
    return NextResponse.json({ error: 'Failed to update warranty review' }, { status: 500 })
  }
}
