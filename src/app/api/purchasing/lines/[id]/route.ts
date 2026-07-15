import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'
import { PURCHASING_ROLES } from '@/types/database'
import { recomputeSessionRollups } from '@/lib/db/reorder'
import type { ReorderLineStatus } from '@/types/reorder'

const LINE_STATUS_VALUES: ReorderLineStatus[] = ['pending', 'ordered', 'skipped', 'flagged']

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
    const { order_qty, line_status, flag_note } = body as {
      order_qty?: number
      line_status?: ReorderLineStatus
      flag_note?: string | null
    }

    const update: Record<string, unknown> = {}

    if (order_qty !== undefined) {
      if (typeof order_qty !== 'number' || !Number.isFinite(order_qty) || order_qty < 0) {
        return NextResponse.json({ error: 'order_qty must be a non-negative number' }, { status: 400 })
      }
      update.order_qty = order_qty
    }

    if (line_status !== undefined) {
      if (!LINE_STATUS_VALUES.includes(line_status)) {
        return NextResponse.json({ error: 'Invalid line_status' }, { status: 400 })
      }
      update.line_status = line_status
    }

    if (flag_note !== undefined) {
      update.flag_note = flag_note
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'No recognized fields in request body' }, { status: 400 })
    }

    const supabase = await createClient()

    // Fetch the line's session_id up front — needed to recompute rollups
    // regardless of which fields changed, and to give a clean 404 for an
    // unknown/foreign id rather than a silent no-op update.
    const { data: current, error: fetchError } = await supabase
      .from('reorder_lines')
      .select('session_id')
      .eq('id', id)
      .maybeSingle()

    if (fetchError) throw fetchError
    if (!current) {
      return NextResponse.json({ error: 'Line not found' }, { status: 404 })
    }

    const { data: updated, error } = await supabase
      .from('reorder_lines')
      .update(update)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('purchasing/lines/[id] PATCH error:', error)
      return NextResponse.json({ error: 'Failed to update reorder line' }, { status: 500 })
    }

    // Server-authoritative: recompute the parent session's totals and every
    // vendor's subtotal from the actual lines. Never trust a client total.
    await recomputeSessionRollups(current.session_id)

    return NextResponse.json(updated)
  } catch (err) {
    console.error('purchasing/lines/[id] PATCH error:', err)
    return NextResponse.json({ error: 'Failed to update reorder line' }, { status: 500 })
  }
}
