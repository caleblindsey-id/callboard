import { NextResponse } from 'next/server'
import { consumeCreditReviewToken } from '@/lib/credit-review'

const MAX_NAME_LEN = 200
const MAX_REASON_LEN = 2000

// In-memory rate limiter scoped per (token + IP), mirroring /api/approve/[token].
// Per-Vercel-function-instance — enough to slow brute force, not a distributed
// limit.
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

function cleanupRateBuckets() {
  if (rateBuckets.size < 1000) return
  const now = Date.now()
  for (const [key, bucket] of rateBuckets) {
    if (bucket.resetAt < now) rateBuckets.delete(key)
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  if (!token) {
    return NextResponse.json({ error: 'Missing token' }, { status: 400 })
  }

  const ip = (request.headers.get('x-forwarded-for') ?? '').split(',')[0]?.trim().slice(0, 200) || 'unknown'
  cleanupRateBuckets()
  if (!rateLimit(`${token}|${ip}`)) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait a moment and try again.' },
      { status: 429 }
    )
  }

  const body = await request.json().catch(() => null)
  if (!body || !body.action) {
    return NextResponse.json({ error: 'Missing action' }, { status: 400 })
  }

  const { action, decided_by_name, block_reason } = body as {
    action?: string
    decided_by_name?: unknown
    block_reason?: unknown
  }

  if (action !== 'release' && action !== 'block') {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }
  if (typeof decided_by_name !== 'string' || !decided_by_name.trim()) {
    return NextResponse.json({ error: 'Your name is required.' }, { status: 400 })
  }
  if (decided_by_name.length > MAX_NAME_LEN) {
    return NextResponse.json({ error: 'Name is too long.' }, { status: 400 })
  }
  if (
    block_reason !== undefined &&
    block_reason !== null &&
    (typeof block_reason !== 'string' || block_reason.length > MAX_REASON_LEN)
  ) {
    return NextResponse.json({ error: 'Reason is too long.' }, { status: 400 })
  }

  const result = await consumeCreditReviewToken({
    token,
    action,
    decidedByName: decided_by_name.trim(),
    blockReason: typeof block_reason === 'string' ? block_reason : null,
  })

  if (!result.ok) {
    if (result.code === 'already_decided') {
      return NextResponse.json(
        { error: 'This order has already been responded to.' },
        { status: 409 }
      )
    }
    // not_found / expired collapse into one 404 so the response can't confirm
    // whether a token was ever valid.
    return NextResponse.json({ error: 'This link is no longer valid.' }, { status: 404 })
  }

  return NextResponse.json({ success: true, action: result.action })
}
