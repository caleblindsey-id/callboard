import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser, RESET_ROLES } from '@/lib/auth'

type Body = {
  lead_ids: string[]
  payout_period: string // 'YYYY-MM'
}

const PAYOUT_PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/

// POST /api/tech-leads/payout/mark-paid — batch-marks earned leads as paid.
// Restricted to super_admin + manager. All supplied ids must currently be
// in status='earned'; anything else aborts the whole batch.
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user?.role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!RESET_ROLES.includes(user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = (await request.json()) as Body
    const { lead_ids, payout_period } = body

    if (!Array.isArray(lead_ids) || lead_ids.length === 0) {
      return NextResponse.json({ error: 'lead_ids must be a non-empty array.' }, { status: 400 })
    }
    if (!payout_period || !PAYOUT_PERIOD_RE.test(payout_period)) {
      return NextResponse.json(
        { error: 'payout_period must be in YYYY-MM format.' },
        { status: 400 }
      )
    }

    const supabase = await createClient()
    const { data: leads, error: fetchErr } = await supabase
      .from('tech_leads')
      .select('id, status')
      .in('id', lead_ids)
    if (fetchErr) {
      console.error('mark-paid fetch error:', fetchErr)
      return NextResponse.json({ error: 'Failed to load leads.' }, { status: 500 })
    }
    const ineligible = (leads ?? []).filter(l => l.status !== 'earned')
    if (ineligible.length > 0 || (leads ?? []).length !== lead_ids.length) {
      return NextResponse.json(
        { error: 'All selected leads must currently be in the earned status.' },
        { status: 400 }
      )
    }

    const now = new Date().toISOString()
    const { error: writeErr } = await supabase
      .from('tech_leads')
      .update({
        status: 'paid',
        paid_at: now,
        paid_by: user.id,
        payout_period,
      })
      .in('id', lead_ids)
    if (writeErr) {
      console.error('mark-paid write error:', writeErr)
      return NextResponse.json({ error: 'Failed to mark leads paid.' }, { status: 500 })
    }

    return NextResponse.json({ success: true, marked: lead_ids.length })
  } catch (err) {
    console.error('mark-paid POST error:', err)
    return NextResponse.json({ error: 'Failed to mark leads paid.' }, { status: 500 })
  }
}
