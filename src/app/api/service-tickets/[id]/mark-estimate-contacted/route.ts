import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser, MANAGER_ROLES } from '@/lib/auth'

const NOTES_MAX_LEN = 1000

// Logs an office phone-contact attempt on a service estimate awaiting a decision.
// Counts as "first contact made" alongside emailing the estimate. Stamps
// who/when (server-authoritative) + optional notes. Manager/coordinator only —
// a front-desk action, not a tech one (so it stays out of the proxy.ts tech
// allowlist and techs get a 403). Mirrors mark-called (pickup queue).
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

    const body = await request.json().catch(() => ({}))
    const rawNotes = (body as { notes?: unknown }).notes
    if (rawNotes !== undefined && typeof rawNotes !== 'string') {
      return NextResponse.json({ error: 'notes must be a string' }, { status: 400 })
    }
    const notes = typeof rawNotes === 'string' ? rawNotes.trim().slice(0, NOTES_MAX_LEN) : null

    const supabase = await createClient()

    // Guard to tickets actually awaiting a decision so a stale tab can't log a
    // call on an estimate that's already approved/declined (PGRST116 = no match).
    const { data, error } = await supabase
      .from('service_tickets')
      .update({
        estimate_called_at: new Date().toISOString(),
        estimate_called_by_id: user.id,
        estimate_contact_notes: notes,
      })
      .eq('id', id)
      .eq('status', 'estimated')
      .select('id, estimate_called_at')
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json(
          { error: 'This estimate is no longer awaiting a decision — refresh the queue.' },
          { status: 409 }
        )
      }
      console.error('mark-estimate-contacted: update failed', error)
      return NextResponse.json({ error: 'Failed to log the call' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, estimate_called_at: data.estimate_called_at })
  } catch (err) {
    console.error('service-tickets/[id]/mark-estimate-contacted POST error:', err)
    return NextResponse.json({ error: 'Failed to log the call' }, { status: 500 })
  }
}
