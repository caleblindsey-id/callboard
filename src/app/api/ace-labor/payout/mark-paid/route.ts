import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser, RESET_ROLES } from '@/lib/auth'

type Body = {
  entry_ids: string[]
  payout_period: string // 'YYYY-MM'
}

const PAYOUT_PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/

// POST /api/ace-labor/payout/mark-paid — super_admin + manager batch-mark
// approved ACE entries as paid. Mirrors the tech-leads mark-paid pattern:
// all ids must currently be in status='approved', and the UPDATE filters
// on that status for atomic compare-and-swap.
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
    const { entry_ids, payout_period } = body

    if (!Array.isArray(entry_ids) || entry_ids.length === 0) {
      return NextResponse.json({ error: 'entry_ids must be a non-empty array.' }, { status: 400 })
    }
    if (!payout_period || !PAYOUT_PERIOD_RE.test(payout_period)) {
      return NextResponse.json(
        { error: 'payout_period must be in YYYY-MM format.' },
        { status: 400 }
      )
    }

    const supabase = await createClient()
    const { data: entries, error: fetchErr } = await supabase
      .from('ace_labor_entries')
      .select('id, status')
      .in('id', entry_ids)
    if (fetchErr) {
      console.error('ace-labor mark-paid fetch error:', fetchErr)
      return NextResponse.json({ error: 'Failed to load entries.' }, { status: 500 })
    }
    const ineligible = (entries ?? []).filter(e => e.status !== 'approved')
    if (ineligible.length > 0 || (entries ?? []).length !== entry_ids.length) {
      return NextResponse.json(
        { error: 'All selected entries must currently be in the approved status.' },
        { status: 400 }
      )
    }

    const now = new Date().toISOString()
    const { data: written, error: writeErr } = await supabase
      .from('ace_labor_entries')
      .update({
        status: 'paid',
        paid_at: now,
        paid_by_id: user.id,
        payout_period,
        updated_by_id: user.id,
      })
      .in('id', entry_ids)
      .eq('status', 'approved')
      .select('id')
    if (writeErr) {
      console.error('ace-labor mark-paid write error:', writeErr)
      return NextResponse.json({ error: 'Failed to mark entries paid.' }, { status: 500 })
    }
    if (!written || written.length !== entry_ids.length) {
      return NextResponse.json(
        { error: 'One or more entries were already processed. Refresh and try again.' },
        { status: 409 }
      )
    }

    return NextResponse.json({ success: true, marked: written.length })
  } catch (err) {
    console.error('ace-labor mark-paid POST error:', err)
    return NextResponse.json({ error: 'Failed to mark entries paid.' }, { status: 500 })
  }
}
