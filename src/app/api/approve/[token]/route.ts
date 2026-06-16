import { createAdminClient } from '@/lib/supabase/admin'
import { recordEquipmentEstimate } from '@/lib/service-tickets/record-equipment-estimate'
import { notifyDecline } from '@/lib/service-tickets/notify-decline'
import { notifyApprove } from '@/lib/service-tickets/notify-approve'
import { NextResponse } from 'next/server'

const MAX_SIGNATURE_BYTES = 200_000 // ~200 KB base64 PNG ~= 150 KB image
const MAX_DECLINE_REASON_LEN = 2000

// In-memory rate limiter scoped per (token + IP). Keys auto-evict after the
// window. This is per-Vercel-function-instance — good enough to slow brute-force
// attacks; not a strong distributed limit. If we ever see real abuse, swap for
// @upstash/ratelimit + Vercel KV.
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

// Simple periodic cleanup so the map doesn't grow unbounded across long-lived
// function instances.
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

  // Rate-limit per token+IP. Only the first 200 chars of the IP header are used
  // (handles spoofed comma-separated lists from upstream proxies).
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

  const { action, signature, signature_name, decline_reason } = body

  if (action !== 'approve' && action !== 'decline') {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  if (action === 'approve') {
    if (!signature || !signature_name?.trim()) {
      return NextResponse.json(
        { error: 'Signature and name are required to approve' },
        { status: 400 }
      )
    }
    if (typeof signature !== 'string' || signature.length > MAX_SIGNATURE_BYTES) {
      return NextResponse.json(
        { error: 'Signature is too large. Please re-sign and try again.' },
        { status: 413 }
      )
    }
    if (typeof signature_name !== 'string' || signature_name.length > 200) {
      return NextResponse.json({ error: 'Name is too long.' }, { status: 400 })
    }
  }

  if (action === 'decline' && decline_reason !== undefined && decline_reason !== null) {
    if (typeof decline_reason !== 'string' || decline_reason.trim().length > MAX_DECLINE_REASON_LEN) {
      return NextResponse.json(
        { error: 'Decline reason is too long.' },
        { status: 400 }
      )
    }
  }

  const supabase = await createAdminClient('SERVER_ONLY')

  const { data: ticket, error: fetchError } = await supabase
    .from('service_tickets')
    .select('id, status, approval_token_expires_at')
    .eq('approval_token', token)
    .single()

  // Collapse "not found" and "expired" into a single 404 so the response
  // can't be used to confirm whether a token was ever valid. The "already
  // responded to" branch stays user-helpful — by then the attacker already
  // knows the token was real.
  const expired =
    ticket?.approval_token_expires_at &&
    new Date(ticket.approval_token_expires_at) < new Date()
  if (fetchError || !ticket || expired) {
    return NextResponse.json({ error: 'This link is no longer valid.' }, { status: 404 })
  }

  if (ticket.status !== 'estimated') {
    return NextResponse.json(
      { error: 'This estimate has already been responded to.' },
      { status: 409 }
    )
  }

  const update: Record<string, unknown> = {
    approval_token: null,
    approval_token_expires_at: null,
    updated_at: new Date().toISOString(),
  }

  if (action === 'approve') {
    update.status = 'approved'
    update.estimate_approved = true
    update.estimate_approved_at = new Date().toISOString()
    update.estimate_signature = signature
    update.estimate_signature_name = signature_name.trim()
  } else {
    update.status = 'declined'
    // Stamp the declined follow-up aging clock and clear any prior "handled"
    // flag so a re-declined estimate re-enters the managers' worklist.
    update.declined_at = new Date().toISOString()
    update.decline_resolved_at = null
    update.decline_resolved_by_id = null
    if (decline_reason?.trim()) {
      update.decline_reason = decline_reason.trim()
    }
  }

  const { error: updateError } = await supabase
    .from('service_tickets')
    .update(update)
    .eq('id', ticket.id)

  if (updateError) {
    console.error('Approval update failed:', updateError)
    return NextResponse.json({ error: 'Failed to process response' }, { status: 500 })
  }

  // Permanent estimate snapshot onto the equipment so a returning unit shows what
  // was quoted and why it was declined. Non-fatal: the decline already committed.
  if (action === 'decline') {
    try {
      await recordEquipmentEstimate(ticket.id, { outcome: 'declined' })
    } catch (snapshotErr) {
      console.error('approve: equipment estimate snapshot failed', snapshotErr)
    }
    // Notify the assigned tech the customer rejected the quote. Non-fatal.
    try {
      await notifyDecline(ticket.id)
    } catch (notifyErr) {
      console.error('approve: decline notification failed', notifyErr)
    }
  } else {
    // action === 'approve' — tell the assigned tech they're clear to proceed.
    // No self-check here: the customer is the actor, never the tech. Non-fatal.
    try {
      await notifyApprove(ticket.id)
    } catch (notifyErr) {
      console.error('approve: approval notification failed', notifyErr)
    }
  }

  return NextResponse.json({ success: true, action })
}
