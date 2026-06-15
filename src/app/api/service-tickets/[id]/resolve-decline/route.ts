import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser, MANAGER_ROLES } from '@/lib/auth'

// Marks a declined estimate "handled" — a soft dismissal that removes it from the
// managers' declined worklist WITHOUT changing ticket status (declined → open is
// a full re-quote, a separate action). Stamps who/when, server-authoritative.
// Manager/coordinator only — a front-desk action, not a tech one. Mirrors
// mark-estimate-contacted.
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
    if (!MANAGER_ROLES.includes(user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const supabase = await createClient()

    // Guard to declined tickets not already handled so a stale tab can't resolve
    // an estimate that's since been reopened/approved (PGRST116 = no match).
    const { data, error } = await supabase
      .from('service_tickets')
      .update({
        decline_resolved_at: new Date().toISOString(),
        decline_resolved_by_id: user.id,
      })
      .eq('id', id)
      .eq('status', 'declined')
      .is('decline_resolved_at', null)
      .select('id, decline_resolved_at')
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json(
          { error: 'This declined estimate is no longer on the worklist — refresh the queue.' },
          { status: 409 }
        )
      }
      console.error('resolve-decline: update failed', error)
      return NextResponse.json({ error: 'Failed to mark handled' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, decline_resolved_at: data.decline_resolved_at })
  } catch (err) {
    console.error('service-tickets/[id]/resolve-decline POST error:', err)
    return NextResponse.json({ error: 'Failed to mark handled' }, { status: 500 })
  }
}
