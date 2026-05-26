import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, MANAGER_ROLES } from '@/lib/auth'
import { unblockCreditReview } from '@/lib/credit-review'

// Throttle passcode attempts per (user + ip) to slow brute force.
const rateBuckets = new Map<string, { count: number; resetAt: number }>()
const RATE_WINDOW_MS = 60_000
const RATE_MAX = 10

function rateLimit(key: string): boolean {
  const now = Date.now()
  const bucket = rateBuckets.get(key)
  if (!bucket || bucket.resetAt < now) {
    rateBuckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS })
    return true
  }
  if (bucket.count >= RATE_MAX) return false
  bucket.count++
  return true
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user?.role || !MANAGER_ROLES.includes(user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const ip = (request.headers.get('x-forwarded-for') ?? '').split(',')[0]?.trim().slice(0, 200) || 'unknown'
    if (!rateLimit(`unblock|${user.id}|${ip}`)) {
      return NextResponse.json(
        { error: 'Too many attempts. Please wait a moment and try again.' },
        { status: 429 }
      )
    }

    const { passcode } = (await request.json()) as { passcode?: unknown }
    if (typeof passcode !== 'string' || !passcode) {
      return NextResponse.json({ error: 'Passcode is required.' }, { status: 400 })
    }

    const result = await unblockCreditReview({ reviewId: id, passcode, managerId: user.id })
    if (!result.ok) {
      switch (result.code) {
        case 'bad_passcode':
          return NextResponse.json({ error: 'Incorrect release passcode.' }, { status: 401 })
        case 'passcode_unset':
          return NextResponse.json(
            { error: 'No release passcode is configured. Set one in Settings.' },
            { status: 409 }
          )
        case 'not_blocked':
          return NextResponse.json(
            { error: 'This order is not blocked (it may have changed). Refresh and try again.' },
            { status: 409 }
          )
        case 'not_found':
          return NextResponse.json({ error: 'Credit review not found.' }, { status: 404 })
      }
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('credit-review unblock error:', err)
    return NextResponse.json({ error: 'Failed to unblock order.' }, { status: 500 })
  }
}
