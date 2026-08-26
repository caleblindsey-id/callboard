import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, ADMIN_ROLES } from '@/lib/auth'
import { unlockPayoutPeriod } from '@/lib/db/payouts'

const PAYOUT_PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/

// POST /api/payouts/[period]/unlock
//
// Escape hatch for a lock taken too early, not a routine path. Discards the
// snapshot so the period recomputes, which is why it is super_admin only and
// one role tighter than lock and pay.
//
// The RPC refuses once a period is paid. A month that has been paid is settled;
// the answer to a late arrival is the next open period, not restating a closed
// one. That rule is enforced in SQL, not here, so no other caller can bypass it.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ period: string }> },
) {
  try {
    const user = await getCurrentUser()
    if (!user?.role) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!ADMIN_ROLES.includes(user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { period } = await params
    if (!PAYOUT_PERIOD_RE.test(period)) {
      return NextResponse.json({ error: 'Period must be in YYYY-MM format.' }, { status: 400 })
    }

    const result = await unlockPayoutPeriod(period, user.id)
    if (!result.ok) {
      const known = result.code === 'NOT_LOCKED' || result.code === 'NOT_UNLOCKABLE'
      console.error('unlock payout period failed:', result.code, result.message)
      return NextResponse.json(
        {
          error:
            result.code === 'NOT_UNLOCKABLE'
              ? 'A period that has been paid cannot be reopened.'
              : result.code === 'NOT_LOCKED'
                ? 'That period is not locked.'
                : 'Failed to reopen the period.',
          code: result.code,
        },
        { status: known ? 409 : 500 },
      )
    }

    return NextResponse.json({ success: true, period })
  } catch (err) {
    console.error('POST /api/payouts/[period]/unlock error:', err)
    return NextResponse.json({ error: 'Failed to reopen the period.' }, { status: 500 })
  }
}
