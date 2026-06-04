import { NextResponse } from 'next/server'
import { sweepCreditHoldOrphans } from '@/lib/credit-review'
import { getCurrentUser, isTechnician } from '@/lib/auth'

// Backfill AR credit reviews for on-hold customers' un-started open orders that
// never got one (customer went on hold after the order existed, or it predates
// the feature). Called by the nightly Synergy sync via a shared secret, or run
// manually by a signed-in manager.
//
// NOTE: /api/credit-review/ is in the proxy public-bypass list, so this handler
// is the ONLY auth gate. It fails closed: with no secret configured and no
// manager session, the request is rejected.
export async function POST(req: Request) {
  const secret = process.env.CREDIT_SWEEP_SECRET
  const authHeader = req.headers.get('authorization') ?? ''
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''

  let authorized = false
  if (secret && bearer && bearer === secret) {
    authorized = true
  } else {
    const user = await getCurrentUser()
    if (user && !isTechnician(user.role)) authorized = true
  }

  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await sweepCreditHoldOrphans()
    return NextResponse.json(result)
  } catch (err) {
    console.error('credit-review sweep failed:', err)
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 })
  }
}
