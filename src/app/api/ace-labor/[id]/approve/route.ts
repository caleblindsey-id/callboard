import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser, RESET_ROLES } from '@/lib/auth'
import { getLaborRate } from '@/lib/db/settings'

// POST /api/ace-labor/[id]/approve — super_admin + manager approve a pending
// ACE labor entry. Self-approval blocked. Atomic compare-and-swap on
// status='pending' so concurrent approvals surface as 409 instead of
// silently double-approving.
//
// On approve, snapshot rate_value_at_approval from the settings table using
// the entry's labor_rate_type so the payout report's "billable value" math
// stays stable even if labor rates change later.
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

    const supabase = await createClient()
    const { data: entry, error: fetchErr } = await supabase
      .from('ace_labor_entries')
      .select('id, status, tech_id, labor_rate_type')
      .eq('id', id)
      .maybeSingle()
    if (fetchErr) {
      console.error('ace-labor approve fetch error:', fetchErr)
      return NextResponse.json({ error: 'Failed to load entry.' }, { status: 500 })
    }
    if (!entry) {
      return NextResponse.json({ error: 'Entry not found.' }, { status: 404 })
    }
    if (entry.tech_id === user.id) {
      return NextResponse.json(
        { error: 'You cannot approve your own ACE labor entry.' },
        { status: 403 }
      )
    }
    if (entry.status !== 'pending') {
      return NextResponse.json(
        { error: `Cannot approve an entry in status '${entry.status}'.` },
        { status: 400 }
      )
    }

    const rateValue = await getLaborRate(entry.labor_rate_type ?? 'standard')
    const now = new Date().toISOString()

    // Atomic CAS on status='pending' — if a concurrent writer flipped status
    // between the SELECT and the UPDATE, the row simply doesn't match.
    const { data: written, error: writeErr } = await supabase
      .from('ace_labor_entries')
      .update({
        status: 'approved',
        approved_by_id: user.id,
        approved_at: now,
        rate_value_at_approval: rateValue,
        updated_by_id: user.id,
      })
      .eq('id', id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle()
    if (writeErr) {
      console.error('ace-labor approve write error:', writeErr)
      return NextResponse.json({ error: 'Failed to approve entry.' }, { status: 500 })
    }
    if (!written) {
      return NextResponse.json(
        { error: 'Entry status changed between load and approve. Refresh and try again.' },
        { status: 409 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('ace-labor approve error:', err)
    return NextResponse.json({ error: 'Failed to approve entry.' }, { status: 500 })
  }
}
