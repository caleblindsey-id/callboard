import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, RESET_ROLES } from '@/lib/auth'
import { payPayoutPeriod } from '@/lib/db/payouts'

const PAYOUT_PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/

// POST /api/payouts/[period]/pay
//
// The single pay path. Replaces /api/tech-leads/payout/mark-paid and
// /api/ace-labor/payout/mark-paid, which were near-identical routes that did
// not know about each other: marking leads paid on one screen left the
// commission that actually pays them untouched on another.
//
// Everything happens inside fn_pay_payout_period, so it is one transaction
// against the locked manifest. There is no partially-paid period, and nothing
// that arrived after the lock can be swept in.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ period: string }> },
) {
  try {
    const user = await getCurrentUser()
    if (!user?.role) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!RESET_ROLES.includes(user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { period } = await params
    if (!PAYOUT_PERIOD_RE.test(period)) {
      return NextResponse.json({ error: 'Period must be in YYYY-MM format.' }, { status: 400 })
    }

    const result = await payPayoutPeriod(period, user.id)
    if (!result.ok) {
      console.error('pay payout period failed:', result.code, result.message)

      const message =
        result.code === 'ALREADY_PAID'
          ? 'That period has already been paid.'
          : result.code === 'NOT_LOCKED'
            ? 'A period has to be locked before it can be paid.'
            : result.code === 'LEAD_STATE_CHANGED' || result.code === 'ACE_STATE_CHANGED'
              ? 'Something in this period changed while it was being paid. Nothing was paid. Refresh and try again.'
              : 'Failed to pay the period.'

      const known = [
        'ALREADY_PAID',
        'NOT_LOCKED',
        'LEAD_STATE_CHANGED',
        'ACE_STATE_CHANGED',
      ].includes(result.code)

      return NextResponse.json({ error: message, code: result.code }, { status: known ? 409 : 500 })
    }

    return NextResponse.json({
      success: true,
      period,
      leadsPaid: result.leadsPaid,
      acePaid: result.acePaid,
    })
  } catch (err) {
    console.error('POST /api/payouts/[period]/pay error:', err)
    return NextResponse.json({ error: 'Failed to pay the period.' }, { status: 500 })
  }
}
