import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'

type PatchBody = {
  hours?: number
  reason?: string
}

// PATCH /api/ace-labor/[id] — tech edits a pending or rejected entry.
// On a rejected entry, the edit flips status back to 'pending' so a manager
// sees the resubmission in the approval queue.
//
// RLS already restricts which rows a tech can touch (own entry, status in
// pending/rejected). This route stays on the user-context client so RLS
// enforces ownership; we just add the value validation and the rejected->
// pending status flip.
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
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No fields to update.' }, { status: 400 })
    }

    const supabase = await createClient()
    const { data: existing, error: fetchErr } = await supabase
      .from('ace_labor_entries')
      .select('id, status')
      .eq('id', id)
      .maybeSingle()
    if (fetchErr) {
      console.error('ace-labor PATCH fetch error:', fetchErr)
      return NextResponse.json({ error: 'Failed to load entry.' }, { status: 500 })
    }
    if (!existing) {
      return NextResponse.json({ error: 'Entry not found.' }, { status: 404 })
    }
    if (existing.status !== 'pending' && existing.status !== 'rejected') {
      return NextResponse.json(
        { error: `Cannot edit an entry in status '${existing.status}'.` },
        { status: 409 }
      )
    }

    // If the entry was rejected, flip it back to pending so the manager
    // sees the resubmission and the rejected reason is cleared.
    if (existing.status === 'rejected') {
      updates.status = 'pending'
      updates.rejected_reason = null
      updates.approved_by_id = null
      updates.approved_at = null
      updates.submitted_at = new Date().toISOString()
    }
    updates.updated_by_id = user.id

    const { error: writeErr } = await supabase
      .from('ace_labor_entries')
      .update(updates)
      .eq('id', id)
    if (writeErr) {
      console.error('ace-labor PATCH write error:', writeErr)
      return NextResponse.json({ error: 'Failed to update entry.' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('ace-labor PATCH error:', err)
    return NextResponse.json({ error: 'Failed to update entry.' }, { status: 500 })
  }
}
