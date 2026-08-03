import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, RESET_ROLES } from '@/lib/auth'
import { getCommissionReport } from '@/lib/db/commission'
import { lockPayoutPeriod, getPayoutPeriod } from '@/lib/db/payouts'
import { lockBlockers } from '@/lib/payouts/manifest'

const PAYOUT_PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/

// POST /api/payouts/[period]/lock
//
// Freezes a month. The report is recomputed HERE, server-side, and turned into
// the payout_lines manifest -- the client sends nothing but the period, so no
// browser can influence what gets locked.
//
// Everything after this point pays from the snapshot, so this is the moment the
// numbers stop being able to move. Late arrivals fall into the next open
// period by construction: they simply are not in the manifest.
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

    const existing = await getPayoutPeriod(period)
    if (existing.status !== 'draft') {
      return NextResponse.json(
        { error: `${period} is already ${existing.status}.` },
        { status: 409 },
      )
    }

    const report = await getCommissionReport(period)

    // Blockers are refusals, not warnings. Locking freezes money; anything
    // ambiguous gets resolved while the period is still open.
    const blockers = lockBlockers(report)
    if (blockers.length > 0) {
      return NextResponse.json(
        { error: 'This period is not ready to lock.', blockers },
        { status: 409 },
      )
    }

    const result = await lockPayoutPeriod(period, user.id, report)
    if (!result.ok) {
      // ALREADY_LOCKED / ALREADY_CLAIMED are races or double-submits (409);
      // ACE_NOT_APPROVED / LEAD_NOT_EARNED mean the report went stale between
      // computing and writing, which is also a retry (409). Anything else is
      // ours to fix.
      const conflict = [
        'ALREADY_LOCKED',
        'ALREADY_CLAIMED',
        'ACE_NOT_APPROVED',
        'LEAD_NOT_EARNED',
      ].includes(result.code)
      console.error('lock payout period failed:', result.code, result.message)
      return NextResponse.json(
        {
          error: conflict
            ? 'The period moved while it was being locked. Refresh and try again.'
            : 'Failed to lock the period.',
          code: result.code,
        },
        { status: conflict ? 409 : 500 },
      )
    }

    return NextResponse.json({ success: true, period, lines: result.lineCount })
  } catch (err) {
    console.error('POST /api/payouts/[period]/lock error:', err)
    return NextResponse.json({ error: 'Failed to lock the period.' }, { status: 500 })
  }
}
