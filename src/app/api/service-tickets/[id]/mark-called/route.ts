import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser, MANAGER_ROLES } from '@/lib/auth'

const NOTES_MAX_LEN = 1000

// Logs a CSR phone call to a pickup-ready customer who has no email on file.
// Stamps who/when (server-authoritative) + optional notes. Manager/coordinator
// only — this is a front-desk action, not a tech one (so it stays out of the
// proxy.ts tech allowlist and techs get a 403).
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

    // Guard to units actually awaiting pickup so a stale tab can't log a call on
    // an already-collected unit (PGRST116 = no row matched the filter).
    const { data, error } = await supabase
      .from('service_tickets')
      .update({
        pickup_called_at: new Date().toISOString(),
        pickup_called_by_id: user.id,
        pickup_call_notes: notes,
      })
      .eq('id', id)
      .eq('awaiting_pickup', true)
      .is('picked_up_at', null)
      .select('id, pickup_called_at')
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json(
          { error: 'This unit is no longer awaiting pickup — refresh the queue.' },
          { status: 409 }
        )
      }
      console.error('mark-called: update failed', error)
      return NextResponse.json({ error: 'Failed to log the call' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, pickup_called_at: data.pickup_called_at })
  } catch (err) {
    console.error('service-tickets/[id]/mark-called POST error:', err)
    return NextResponse.json({ error: 'Failed to log the call' }, { status: 500 })
  }
}
