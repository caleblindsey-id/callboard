import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser, RESET_ROLES } from '@/lib/auth'

// POST /api/tech-leads/[id]/candidates/dismiss-all
//
// Dismiss every pending candidate on this lead and flip the lead back to
// 'approved' if it was in 'match_pending'.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const user = await getCurrentUser()
    if (!user?.role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!RESET_ROLES.includes(user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const rawReason = (body as { reason?: unknown })?.reason
    const reason =
      typeof rawReason === 'string' && rawReason.trim() ? rawReason.trim().slice(0, 1000) : null

    const supabase = await createClient()

    const now = new Date().toISOString()
    const { error: dismissErr } = await supabase
      .from('equipment_sale_lead_candidates')
      .update({ status: 'dismissed', reviewed_by: user.id, reviewed_at: now, dismissed_reason: reason })
      .eq('tech_lead_id', id)
      .eq('status', 'pending')
    if (dismissErr) {
      console.error('dismiss-all error:', dismissErr)
      return NextResponse.json({ error: 'Failed to dismiss candidates.' }, { status: 500 })
    }

    await supabase
      .from('tech_leads')
      .update({ status: 'approved' })
      .eq('id', id)
      .eq('status', 'match_pending')

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('dismiss-all POST error:', err)
    return NextResponse.json({ error: 'Failed to dismiss candidates.' }, { status: 500 })
  }
}
