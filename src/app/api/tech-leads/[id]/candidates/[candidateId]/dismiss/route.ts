import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser, RESET_ROLES } from '@/lib/auth'

// POST /api/tech-leads/[id]/candidates/[candidateId]/dismiss
//
// Dismiss one candidate. If that was the last pending candidate, flip the lead
// back from match_pending -> approved so it stops showing in the match tab.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; candidateId: string }> }
) {
  const { id, candidateId } = await params
  try {
    const user = await getCurrentUser()
    if (!user?.role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!RESET_ROLES.includes(user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const supabase = await createClient()

    const { data: candidate, error: candErr } = await supabase
      .from('equipment_sale_lead_candidates')
      .select('id, tech_lead_id, status')
      .eq('id', candidateId)
      .single()
    if (candErr || !candidate) {
      return NextResponse.json({ error: 'Candidate not found.' }, { status: 404 })
    }
    if (candidate.tech_lead_id !== id) {
      return NextResponse.json({ error: 'Candidate does not belong to this lead.' }, { status: 400 })
    }
    if (candidate.status !== 'pending') {
      return NextResponse.json({ error: `Candidate already ${candidate.status}.` }, { status: 400 })
    }

    const now = new Date().toISOString()
    const { error: dismissErr } = await supabase
      .from('equipment_sale_lead_candidates')
      .update({ status: 'dismissed', reviewed_by: user.id, reviewed_at: now })
      .eq('id', candidateId)
    if (dismissErr) {
      console.error('dismiss candidate error:', dismissErr)
      return NextResponse.json({ error: 'Failed to dismiss candidate.' }, { status: 500 })
    }

    // If no more pending candidates, fall the lead back to approved.
    const { count, error: countErr } = await supabase
      .from('equipment_sale_lead_candidates')
      .select('id', { count: 'exact', head: true })
      .eq('tech_lead_id', id)
      .eq('status', 'pending')
    if (countErr) {
      console.error('count pending candidates error:', countErr)
    } else if ((count ?? 0) === 0) {
      await supabase
        .from('tech_leads')
        .update({ status: 'approved' })
        .eq('id', id)
        .eq('status', 'match_pending')
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('dismiss POST error:', err)
    return NextResponse.json({ error: 'Failed to dismiss candidate.' }, { status: 500 })
  }
}
