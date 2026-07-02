import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentUser, RESET_ROLES } from '@/lib/auth'
import {
  EMPTY_ESTIMATE_SIGNOFF_FIELDS,
  EMPTY_ESTIMATE_FOLLOWUP_FIELDS,
} from '@/types/service-tickets'

/**
 * POST /api/service-tickets/[id]/reopen-estimate
 *
 * Manager / super-admin action to re-open an estimate for revision. Pulls a
 * ticket back to `open` (the editable estimate phase) from any of the three
 * "estimate done" states — `estimated` (awaiting customer approval), `approved`
 * (customer signed off), or `declined`.
 *
 * Unlike the generic PATCH-to-open reopen path (which WIPES the estimate so the
 * tech rebuilds), this PRESERVES the estimate numbers (estimate_parts,
 * estimate_labor_hours, estimate_labor_rate, estimate_amount, diagnosis_notes,
 * labor_rate_type) so the manager edits the existing estimate, then re-sends it.
 * It clears the prior customer sign-off (approval flag, signature, approval
 * token, decline reason) so the revised estimate must be re-approved — note this
 * is stricter than request-info, which leaves the approval token live.
 *
 * Restricted to RESET_ROLES (super_admin, manager) — coordinators excluded,
 * matching the existing manager-only reopen gating in the PATCH route.
 *
 * Uses a status-guarded update so a concurrent transition surfaces as a 409
 * instead of silently no-op'ing.
 */

export async function POST(
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
      return NextResponse.json(
        { error: 'Only managers can reopen an estimate' },
        { status: 403 }
      )
    }

    // ADMIN_ONLY: caller pre-validated as manager above; admin client bypasses
    // RLS so the status-guarded non-PATCH update is reliable.
    const supabase = await createAdminClient('ADMIN_ONLY')

    // Status-guarded UPDATE — only reopenable from estimate-done states; a
    // concurrent transition surfaces as PGRST116 ("no rows returned").
    // Estimate numbers (parts/hours/rate/amount/diagnosis) are intentionally
    // left untouched so the manager revises rather than rebuilds.
    const { data, error } = await supabase
      .from('service_tickets')
      .update({
        status: 'open',
        // Clear the customer sign-off so the revised estimate is re-approved,
        // and reset the follow-up campaign so the re-sent estimate starts a
        // fresh contact clock (shared field sets — see types/service-tickets).
        ...EMPTY_ESTIMATE_SIGNOFF_FIELDS,
        ...EMPTY_ESTIMATE_FOLLOWUP_FIELDS,
        decline_reason: null,
        manual_decision_note: null,
        // A declined unit may have been staged into the pickup queue (custody
        // tracking). Reopening puts it back in play, so pull it out of the queue —
        // it's no longer waiting to be collected.
        awaiting_pickup: false,
        ready_for_pickup_at: null,
      })
      .eq('id', id)
      .in('status', ['estimated', 'approved', 'declined'])
      .select('id, status')
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json(
          { error: 'Estimate can no longer be reopened — refresh and try again.' },
          { status: 409 }
        )
      }
      console.error('service-tickets/[id]/reopen-estimate error:', error)
      return NextResponse.json({ error: 'Failed to reopen estimate' }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (err) {
    console.error('service-tickets/[id]/reopen-estimate POST error:', err)
    return NextResponse.json({ error: 'Failed to reopen estimate' }, { status: 500 })
  }
}
