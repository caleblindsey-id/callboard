import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'
import { isLaborRateType, LABOR_RATE_TYPES } from '@/lib/labor-rate-type'
import { decideAceEdit } from '@/lib/ace-labor/edit-policy'
import type { AceLaborStatus } from '@/types/database'

type PatchBody = {
  hours?: number
  reason?: string
  labor_rate_type?: string
}

// PATCH /api/ace-labor/[id] — edit a pending or rejected entry.
//
// Two callers:
//   - the submitting tech, fixing their own entry; and
//   - a manager / super_admin correcting someone else's entry in review
//     rather than rejecting it and waiting for a resubmission (feedback #93).
//
// Either way, editing a *rejected* entry flips it back to 'pending' so it
// lands in the approval queue with the rejection cleared.
//
// RLS already permits both callers (policy `ace_labor_update`, migration 139:
// super_admin/manager on any row, technician on own rows in pending/rejected),
// so this stays on the user-context client and RLS is the backstop. What the
// route adds is value validation, the rejected->pending flip, and the explicit
// authorization decision in `decideAceEdit` — which also keeps coordinators
// out, since they can reach /tech-payouts but hold no write rights here.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const user = await getCurrentUser()
    if (!user?.role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await request.json()) as PatchBody
    const updates: Record<string, unknown> = {}

    if (body.hours !== undefined) {
      if (typeof body.hours !== 'number' || !Number.isFinite(body.hours) || body.hours <= 0) {
        return NextResponse.json(
          { error: 'hours must be greater than 0.' },
          { status: 400 }
        )
      }
      updates.hours = body.hours
    }
    if (body.reason !== undefined) {
      if (typeof body.reason !== 'string' || !body.reason.trim()) {
        return NextResponse.json({ error: 'reason cannot be empty.' }, { status: 400 })
      }
      updates.reason = body.reason.trim()
    }
    if (body.labor_rate_type !== undefined) {
      // Staff-only, enforced after the authorization decision below. The tech
      // never picks this: completion snapshots it off the parent ticket so a
      // later ticket edit can't shift the entry's rate category. Re-picking it
      // is a reviewer correction, not a resubmission field.
      //
      // Only reachable before approval, so no rate snapshot has been taken yet
      // — the entry is still open to a rate-category correction.
      if (!isLaborRateType(body.labor_rate_type)) {
        return NextResponse.json(
          { error: `labor_rate_type must be one of: ${LABOR_RATE_TYPES.join(', ')}.` },
          { status: 400 }
        )
      }
      updates.labor_rate_type = body.labor_rate_type
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No fields to update.' }, { status: 400 })
    }

    const supabase = await createClient()
    const { data: existing, error: fetchErr } = await supabase
      .from('ace_labor_entries')
      .select('id, status, tech_id')
      .eq('id', id)
      .maybeSingle()
    if (fetchErr) {
      console.error('ace-labor PATCH fetch error:', fetchErr)
      return NextResponse.json({ error: 'Failed to load entry.' }, { status: 500 })
    }
    if (!existing) {
      return NextResponse.json({ error: 'Entry not found.' }, { status: 404 })
    }

    const status = existing.status as AceLaborStatus
    const decision = decideAceEdit(
      { id: user.id, role: user.role },
      { tech_id: existing.tech_id, status },
    )
    if (!decision.allowed) {
      if (decision.reason === 'forbidden') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      return NextResponse.json(
        { error: `Cannot edit an entry in status '${status}'.` },
        { status: 409 }
      )
    }
    if (updates.labor_rate_type !== undefined && !decision.asStaff) {
      return NextResponse.json(
        { error: 'Only a manager can change the rate type on an ACE entry.' },
        { status: 403 }
      )
    }

    // A rejected entry going back into the queue: clear the rejection and the
    // reviewer stamps, and re-date the submission so it sorts as fresh.
    if (decision.resubmits) {
      updates.status = 'pending'
      updates.rejected_reason = null
      updates.approved_by_id = null
      updates.approved_at = null
      updates.submitted_at = new Date().toISOString()
    }
    updates.updated_by_id = user.id

    // CAS on the status we authorized against: a concurrent approve/reject
    // between the SELECT and the UPDATE must not have its decision overwritten
    // by an edit that was authorized against the older status.
    const { data: written, error: writeErr } = await supabase
      .from('ace_labor_entries')
      .update(updates)
      .eq('id', id)
      .eq('status', status)
      .select('id')
      .maybeSingle()
    if (writeErr) {
      console.error('ace-labor PATCH write error:', writeErr)
      return NextResponse.json({ error: 'Failed to update entry.' }, { status: 500 })
    }
    if (!written) {
      return NextResponse.json(
        { error: 'Entry status changed between load and save. Refresh and try again.' },
        { status: 409 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('ace-labor PATCH error:', err)
    return NextResponse.json({ error: 'Failed to update entry.' }, { status: 500 })
  }
}
