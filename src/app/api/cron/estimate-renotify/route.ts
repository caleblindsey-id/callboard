export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendEstimateNotice } from '@/lib/service-tickets/send-estimate-notice'

// Daily re-notify for estimates still awaiting a customer decision. Runs as a
// Vercel Cron (see vercel.json), authenticated by the CRON_SECRET bearer Vercel
// injects. Re-emails the approval link at most every RENOTIFY_AFTER_DAYS, capped
// at MAX_NOTIFY_COUNT total sends.
//
// IMPORTANT: the candidate query requires estimate_emailed_at IS NOT NULL, so
// the cron only ever RE-sends. First contact stays a manual office decision
// (someone clicks Email Estimate or logs a call) — an estimate that was never
// emailed lives in the follow-up queue for a human, it is not auto-mailed here.

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

  // Candidates: still awaiting a decision, already emailed at least once (first
  // contact was made), under the send cap, and last emailed longer than the
  // cadence window ago.
  const { data, error } = await admin
    .from('service_tickets')
    .select('id')
    .eq('status', 'estimated')
    .is('deleted_at', null)
    .not('estimate_emailed_at', 'is', null)
    .lt('estimate_notify_count', MAX_NOTIFY_COUNT)
    .or(`estimate_last_emailed_at.is.null,estimate_last_emailed_at.lt.${cutoff}`)

  if (error) {
    console.error('estimate-renotify: candidate query failed', error)
    return NextResponse.json({ error: 'Query failed' }, { status: 500 })
  }

  const candidates = (data ?? []) as { id: string }[]
  let sent = 0
  let skipped = 0
  let failed = 0

  for (const t of candidates) {
    try {
      const r = await sendEstimateNotice(t.id, admin)
      if (r.sent) sent++
      else skipped++
    } catch (err) {
      failed++
      console.error(`estimate-renotify: send failed for ${t.id}`, err)
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
