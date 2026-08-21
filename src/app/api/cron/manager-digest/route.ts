export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendMandrillEmail } from '@/lib/mandrill'
import { parseEmailList } from '@/lib/credit-review-crypto'
import { timingSafeCompare } from '@/lib/security/timing-safe-compare'
import { BUSINESS_TIME_ZONE } from '@/lib/business-time'
import { dedupedCount } from '@/lib/digest/dedupe'
import { shouldRunNow, isBusinessWeekday } from '@/lib/digest/should-run'
import { runSections, sectionStatuses, getSetting, digestDateLabel } from '@/lib/digest/run'
import type { DigestDb } from '@/lib/digest/types'
import { renderManagerDigestEmail } from '@/lib/email-templates/manager-digest'

// Weekday morning action email: thirteen queues grouped by who does the work,
// sent to the manager_digest_to / manager_digest_cc settings lists. Ported from
// a Python script that ran on Caleb's laptop via Task Scheduler and sent through
// Outlook COM, which meant no machine, no digest.
//
// Every section reads the same src/lib/db function the matching queue page
// renders from, so the email and the app cannot disagree.
//
// Registered TWICE in vercel.json, at 13:00Z and 14:00Z on weekdays, because
// Vercel Cron is UTC only and a fixed schedule drifts an hour at every DST
// change. shouldRunNow lets through whichever fire is 8 AM Central that day, so
// exactly one send happens per weekday, year round, with no state file.

// The digest replaced an email that arrived from Caleb's own mailbox. Keeping
// his name on it preserves that continuity for the branch, and Reply-To makes a
// reply reach him rather than the unattended service address. Change both here
// if the digest is ever handed to another manager or white-labelled.
const DIGEST_FROM_NAME = 'Caleb Lindsey (via CallBoard)'
const DIGEST_REPLY_TO = 'clindsey@imperialdade.com'

export async function GET(request: NextRequest) {
  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. Reject anything
  // else so the endpoint isn't a public email trigger.
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization') ?? ''
  if (!secret || !timingSafeCompare(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const dry = request.nextUrl.searchParams.get('dry') === '1'
  const now = new Date()

  // The weekday guard lives HERE as well as in the cron expression. The
  // expression stops the schedule from firing on a weekend; this stops a manual
  // invocation (vercel crons run, or a curl with the secret) from mailing the
  // branch on a Saturday.
  if (!dry && !isBusinessWeekday(now, BUSINESS_TIME_ZONE)) {
    return NextResponse.json({ ok: true, sent: false, reason: 'not_a_weekday' })
  }

  // A dry run bypasses both gates so parity can be checked at any time of day.
  // It never sends.
  if (!dry && !shouldRunNow(now, BUSINESS_TIME_ZONE)) {
    return NextResponse.json({ ok: true, sent: false, reason: 'not_the_business_hour' })
  }

  const db = (await createAdminClient('SERVER_ONLY')) as unknown as DigestDb

  const results = await runSections(db)
  const distinctCount = dedupedCount(results)
  const failedCount = results.filter((r) => !r.ok).length
  const sections = sectionStatuses(results)

  if (dry) {
    return NextResponse.json({ ok: true, dry: true, distinctCount, failedCount, sections })
  }

  // Send when there is something to act on OR something broke. The only quiet
  // path is every section healthy and every section empty.
  if (distinctCount === 0 && failedCount === 0) {
    return NextResponse.json({ ok: true, sent: false, reason: 'nothing_actionable', sections })
  }

  const to = parseEmailList(await getSetting(db, 'manager_digest_to'))
  const cc = parseEmailList(await getSetting(db, 'manager_digest_cc'))
  if (to.length === 0) {
    // Work is piling up but nobody is configured to hear about it. Surface that
    // in the cron result rather than succeeding silently.
    console.error('manager-digest: manager_digest_to not set; digest skipped')
    return NextResponse.json({
      ok: true,
      sent: false,
      reason: 'manager_digest_to_unset',
      distinctCount,
      sections,
    })
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, '') ?? ''
  const companyName = (await getSetting(db, 'company_name')) ?? 'CallBoard'

  const email = renderManagerDigestEmail({
    results,
    appUrl,
    companyName,
    dateLabel: digestDateLabel(now, BUSINESS_TIME_ZONE),
  })

  try {
    await sendMandrillEmail({
      to: { email: to[0] },
      // Any extra addresses on the To key are copied rather than dropped.
      cc: [...to.slice(1), ...cc].map((e) => ({ email: e })),
      subject: email.subject,
      html: email.html,
      text: email.text,
      fromName: DIGEST_FROM_NAME,
      replyTo: DIGEST_REPLY_TO,
      tags: ['manager-digest'],
      metadata: {
        distinct_count: String(distinctCount),
        failed_count: String(failedCount),
      },
    })
  } catch (err) {
    console.error('manager-digest: send failed', err)
    return NextResponse.json({ error: 'Send failed' }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    sent: true,
    distinctCount,
    failedCount,
    recipients: to.length + cc.length,
    sections,
  })
}
