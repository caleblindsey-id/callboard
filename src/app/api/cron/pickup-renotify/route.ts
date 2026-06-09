export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendPickupNotice } from '@/lib/service-tickets/send-pickup-notice'

// Daily re-notify for equipment still awaiting pickup. Runs as a Vercel Cron
// (see vercel.json), authenticated by the CRON_SECRET bearer that Vercel injects.
// Re-emails a customer at most every RENOTIFY_AFTER_DAYS, capped at MAX_NOTIFY_COUNT
// total sends. Also catches up first sends whose instant attempt failed
// (pickup_notified_at IS NULL but the unit has an email). No-email units are
// skipped here — they live in the Needs Call queue for a human.

const RENOTIFY_AFTER_DAYS = 7
const MAX_NOTIFY_COUNT = 3

export async function GET(request: NextRequest) {
  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. Reject anything else
  // so the endpoint isn't a public email trigger.
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = await createAdminClient('SERVER_ONLY')
  const cutoff = new Date(Date.now() - RENOTIFY_AFTER_DAYS * 86_400_000).toISOString()

  // Candidates: still in custody, under the send cap, and either never
  // successfully notified or last notified longer than the cadence window ago.
  const { data, error } = await admin
    .from('service_tickets')
    .select('id')
    .eq('awaiting_pickup', true)
    .is('picked_up_at', null)
    .is('deleted_at', null)
    .lt('pickup_notify_count', MAX_NOTIFY_COUNT)
    .or(`pickup_notified_at.is.null,pickup_last_notified_at.lt.${cutoff}`)

  if (error) {
    console.error('pickup-renotify: candidate query failed', error)
    return NextResponse.json({ error: 'Query failed' }, { status: 500 })
  }

  const candidates = (data ?? []) as { id: string }[]
  let sent = 0
  let skipped = 0
  let failed = 0

  for (const t of candidates) {
    try {
      const r = await sendPickupNotice(t.id, admin)
      if (r.sent) sent++
      else skipped++
    } catch (err) {
      failed++
      console.error(`pickup-renotify: send failed for ${t.id}`, err)
    }
  }

  return NextResponse.json({
    ok: true,
    candidates: candidates.length,
    sent,
    skipped,
    failed,
  })
}
