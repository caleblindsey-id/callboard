import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'
import { PURCHASING_ROLES, RESET_ROLES } from '@/types/database'
import { getSession, recomputeSessionRollups } from '@/lib/db/reorder'
import { REORDER_VALID_TRANSITIONS, ReorderSessionStatus } from '@/types/reorder'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const user = await getCurrentUser()
    if (!user?.role || !PURCHASING_ROLES.includes(user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { status, name, notes } = body as {
      status?: ReorderSessionStatus
      name?: string
      notes?: string | null
    }

    const current = await getSession(id)
    if (!current) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    const supabase = await createClient()
    const update: Record<string, unknown> = {}

    if (status !== undefined) {
      const validTargets = REORDER_VALID_TRANSITIONS[current.status]
      if (status !== current.status && !validTargets.includes(status)) {
        return NextResponse.json(
          { error: `Invalid status transition: ${current.status} -> ${status}` },
          { status: 400 }
        )
      }

      // Business-precondition gates, on top of the state-machine check above
      // (design spec, "Status Lifecycle"): review->ordered needs at least one
      // Synergy PO# recorded; ordered->closed needs every vendor that has
      // ordered lines to have one. Both read reorder_session_vendors directly
      // rather than trusting a client-supplied count.
      if (status === 'ordered') {
        const { data: vendorRows, error: vendorError } = await supabase
          .from('reorder_session_vendors')
          .select('synergy_po_number')
          .eq('session_id', id)
        if (vendorError) throw vendorError
        const hasPo = (vendorRows ?? []).some((v) => v.synergy_po_number && v.synergy_po_number.trim())
        if (!hasPo) {
          return NextResponse.json(
            { error: 'Record at least one Synergy PO# before marking the session ordered.' },
            { status: 400 }
          )
        }
      }

      if (status === 'closed') {
        const { data: vendorRows, error: vendorError } = await supabase
          .from('reorder_session_vendors')
          .select('synergy_po_number, line_count')
          .eq('session_id', id)
        if (vendorError) throw vendorError
        const missing = (vendorRows ?? []).filter(
          (v) => (v.line_count ?? 0) > 0 && !(v.synergy_po_number && v.synergy_po_number.trim())
        )
        if (missing.length > 0) {
          return NextResponse.json(
            {
              error: `All vendors with ordered lines must have a Synergy PO# recorded before closing (${missing.length} vendor${missing.length === 1 ? '' : 's'} still missing one).`,
            },
            { status: 400 }
          )
        }
      }

      update.status = status
    }

    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) {
        return NextResponse.json({ error: 'name must be a non-empty string' }, { status: 400 })
      }
      update.name = name.trim()
    }

    if (notes !== undefined) {
      update.notes = notes
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'No recognized fields in request body' }, { status: 400 })
    }

    const { error } = await supabase
      .from('reorder_sessions')
      .update(update)
      .eq('id', id)

    if (error) {
      console.error('purchasing/sessions/[id] PATCH error:', error)
      return NextResponse.json({ error: 'Failed to update reorder session' }, { status: 500 })
    }

    // Rollups are derived from the lines, not the fields this route writes, but
    // recomputing + persisting here (per the shared server-authoritative rule)
    // guarantees the session row is never stale no matter which route last
    // touched it.
    await recomputeSessionRollups(id)

    const updated = await getSession(id)
    return NextResponse.json(updated)
  } catch (err) {
    console.error('purchasing/sessions/[id] PATCH error:', err)
    return NextResponse.json({ error: 'Failed to update reorder session' }, { status: 500 })
  }
}

// Deleting a session cascades to its reorder_lines and
// reorder_session_vendors (both ON DELETE CASCADE), so a single delete of
// the session row is sufficient. Gated to super_admin/manager to match the
// reorder_sessions_delete RLS policy — coordinator and purchasing can't
// delete a walk.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const user = await getCurrentUser()
    if (!user?.role || !RESET_ROLES.includes(user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const supabase = await createClient()
    const { data, error } = await supabase
      .from('reorder_sessions')
      .delete()
      .eq('id', id)
      .select('id')

    if (error) {
      console.error('purchasing/sessions/[id] DELETE error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (!data || data.length === 0) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('purchasing/sessions/[id] DELETE error:', err)
    return NextResponse.json({ error: 'Failed to delete reorder session' }, { status: 500 })
  }
}
