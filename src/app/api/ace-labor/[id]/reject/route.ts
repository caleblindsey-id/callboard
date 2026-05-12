import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser, RESET_ROLES } from '@/lib/auth'

const REASON_MAX_LEN = 1000

type Body = { reason: string }

// POST /api/ace-labor/[id]/reject — super_admin + manager reject a pending
// entry with a reason. Self-rejection blocked. Atomic CAS on status='pending'.
// The tech can then edit and resubmit (PATCH flips status back to pending).
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
    if (!RESET_ROLES.includes(user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = (await request.json()) as Body
    const reason = (body?.reason ?? '').trim().slice(0, REASON_MAX_LEN)
    if (!reason) {
      return NextResponse.json(
        { error: 'A reason is required to reject an ACE labor entry.' },
        { status: 400 }
      )
    }

    const supabase = await createClient()
    const { data: entry, error: fetchErr } = await supabase
      .from('ace_labor_entries')
      .select('id, status, tech_id')
      .eq('id', id)
      .maybeSingle()
    if (fetchErr) {
      console.error('ace-labor reject fetch error:', fetchErr)
      return NextResponse.json({ error: 'Failed to load entry.' }, { status: 500 })
    }
    if (!entry) {
      return NextResponse.json({ error: 'Entry not found.' }, { status: 404 })
    }
    if (entry.tech_id === user.id) {
      return NextResponse.json(
        { error: 'You cannot reject your own ACE labor entry.' },
        { status: 403 }
      )
    }
    if (entry.status !== 'pending') {
      return NextResponse.json(
        { error: `Cannot reject an entry in status '${entry.status}'.` },
        { status: 400 }
      )
    }

    const now = new Date().toISOString()
    const { data: written, error: writeErr } = await supabase
      .from('ace_labor_entries')
      .update({
        status: 'rejected',
        approved_by_id: user.id,
        approved_at: now,
        rejected_reason: reason,
        updated_by_id: user.id,
      })
      .eq('id', id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle()
    if (writeErr) {
      console.error('ace-labor reject write error:', writeErr)
      return NextResponse.json({ error: 'Failed to reject entry.' }, { status: 500 })
    }
    if (!written) {
      return NextResponse.json(
        { error: 'Entry status changed between load and reject. Refresh and try again.' },
        { status: 409 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('ace-labor reject error:', err)
    return NextResponse.json({ error: 'Failed to reject entry.' }, { status: 500 })
  }
}
