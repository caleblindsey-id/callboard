import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'
import { PURCHASING_ROLES } from '@/types/database'
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

    const update: Record<string, unknown> = {}

    if (status !== undefined) {
      const validTargets = REORDER_VALID_TRANSITIONS[current.status]
      if (status !== current.status && !validTargets.includes(status)) {
        return NextResponse.json(
          { error: `Invalid status transition: ${current.status} -> ${status}` },
          { status: 400 }
        )
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

    const supabase = await createClient()
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
