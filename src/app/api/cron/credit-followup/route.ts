export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendMandrillEmail } from '@/lib/mandrill'
import { parseEmailList } from '@/lib/credit-review-crypto'
import { resendCreditReview } from '@/lib/credit-review'
import { timingSafeCompare } from '@/lib/security/timing-safe-compare'
import { getOpenCreditReviewsForFollowup } from '@/lib/db/credit-followup'
import { getSetting } from '@/lib/digest/run'
import type { DigestDb } from '@/lib/digest/types'
import {
  parseFollowupDays,
  selectDueReviews,
  shouldNotifyAr,
  shouldNotifyManagers,
  daysWaiting,
} from '@/lib/credit-followup'
import {
  renderCreditFollowupEmail,
  type CreditFollowupItem,
} from '@/lib/email-templates/credit-followup'

// Daily follow-up for credit reviews that are still open (feedback #75). Runs as
// a Vercel Cron (see vercel.json), authenticated by the CRON_SECRET bearer
// Vercel injects.
//
// Two different silences to break, with two different audiences:
//
//   pending -- AR was emailed a Release/Block link at order creation and has not
//     clicked it. Re-send that link (freshly minted, so an expired one heals).
//     After AR_ESCALATE_AFTER nudges, managers get copied too.
//
//   blocked -- AR blocked the order and only a manager can clear it, by typing
//     the release passcode into /credit-review. There is no emailable action, so
//     managers get a digest-style list that deep-links into the queue.
//
// The cadence is one setting (`credit_followup_days`, default 3) and there is no
// send cap: production had blocked orders sitting 60, 64 and 68 days, and a cap
// is precisely what would let that happen again.
//
// Managers receive at most ONE email per run listing every order due, rather
// than one per order. AR still gets one per order, because each carries its own
// single-order action token.

export async function GET(request: NextRequest) {
  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. Reject anything else
  // so the endpoint isn't a public email trigger.
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization') ?? ''
  if (!secret || !timingSafeCompare(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // A dry run reports exactly what would be sent and writes nothing -- no
  // emails, no reminder stamps. Safe to curl at any time to check the queue.
  const dry = request.nextUrl.searchParams.get('dry') === '1'
  const now = new Date()

  const admin = await createAdminClient('SERVER_ONLY')
  const db = admin as unknown as DigestDb

  let open
  try {
    open = await getOpenCreditReviewsForFollowup(db)
  } catch (err) {
    console.error('credit-followup: candidate query failed', err)
    return NextResponse.json({ error: 'Query failed' }, { status: 500 })
  }

  const days = parseFollowupDays(await getSetting(db, 'credit_followup_days'))
  const due = selectDueReviews(open, now, days)

  if (due.length === 0) {
    return NextResponse.json({
      ok: true,
      cadenceDays: days,
      open: open.length,
      due: 0,
      arResent: 0,
      managersNotified: 0,
    })
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, '') ?? ''

  // --- AR: re-send the Release/Block link, one email per order ---------------
  //
  // resendCreditReview re-mints the token and only touches rows still 'pending',
  // so a review AR decided between our read and this call is left alone.
  const arSent = new Set<string>()
  const arFailures: string[] = []
  for (const c of due) {
    if (!shouldNotifyAr(c)) continue
    if (dry) {
      arSent.add(c.id)
      continue
    }
    try {
      const res = await resendCreditReview({ reviewId: c.id, actorId: null })
      if (res.ok) arSent.add(c.id)
      else arFailures.push(`${c.id}:${res.code}`)
    } catch (err) {
      console.error(`credit-followup: AR resend failed for ${c.id}`, err)
      arFailures.push(`${c.id}:threw`)
    }
  }

  // --- Managers: one grouped email listing everything due -------------------
  const managerItems: CreditFollowupItem[] = due
    .filter(shouldNotifyManagers)
    .map((c) => ({
      customerName: c.customerName,
      accountNumber: c.accountNumber,
      orderLabel: c.orderLabel,
      status: c.status,
      blockReason: c.blockReason,
      decidedByName: c.decidedByName,
      daysWaiting: daysWaiting(c, now),
      href: `${appUrl}${c.ticketPath ?? '/credit-review'}`,
    }))

  let managerSent = false
  let managerSkipReason: string | undefined

  if (managerItems.length > 0) {
    const to = parseEmailList(await getSetting(db, 'manager_digest_to'))
    const cc = parseEmailList(await getSetting(db, 'manager_digest_cc'))
    if (!appUrl) {
      // Every row in this email is a link and nothing else identifies the order
      // well enough to act on, so a relative href would ship a useless message.
      // resendCreditReview already refuses the AR half for the same reason.
      console.error('credit-followup: NEXT_PUBLIC_APP_URL not set; manager email skipped')
      managerSkipReason = 'app_url_unset'
    } else if (to.length === 0) {
      // Orders are stuck and nobody is configured to hear about it. Surface it
      // in the cron result rather than succeeding silently.
      console.error('credit-followup: manager_digest_to not set; manager email skipped')
      managerSkipReason = 'manager_digest_to_unset'
    } else if (dry) {
      managerSkipReason = 'dry_run'
    } else {
      const companyName = (await getSetting(db, 'company_name')) ?? 'CallBoard'
      const email = renderCreditFollowupEmail({
        items: managerItems,
        queueUrl: `${appUrl}/credit-review`,
        settings: { company_name: companyName },
      })
      try {
        await sendMandrillEmail({
          to: { email: to[0] },
          cc: [...to.slice(1), ...cc].map((e) => ({ email: e })),
          subject: email.subject,
          html: email.html,
          text: email.text,
          tags: ['credit-followup'],
          metadata: { open_orders: String(managerItems.length) },
        })
        managerSent = true
      } catch (err) {
        console.error('credit-followup: manager email send failed', err)
        managerSkipReason = 'email_failed'
      }
    }
  }

  // --- Stamp the cadence ----------------------------------------------------
  //
  // Only stamp a review we actually reminded someone about. If the manager email
  // failed AND there was no AR resend for it, leaving last_reminded_at alone
  // means the review is still due tomorrow instead of silently waiting out
  // another full cadence on a send that never landed.
  let stamped = 0
  if (!dry) {
    for (const c of due) {
      // Reminded = AR got a fresh link for this review, or it appeared in a
      // manager email that actually sent. Anything else stays due tomorrow.
      const reminded = arSent.has(c.id) || (shouldNotifyManagers(c) && managerSent)
      if (!reminded) continue
      const { error } = await admin
        .from('credit_reviews')
        .update({
          reminder_count: c.reminderCount + 1,
          last_reminded_at: now.toISOString(),
        })
        .eq('id', c.id)
        // Only stamp a review that is STILL open. AR may have clicked Release
        // while this run was in flight; bumping a decided row's reminder counter
        // would be a harmless but misleading write.
        .in('status', ['pending', 'blocked'])
      if (error) console.error(`credit-followup: stamp failed for ${c.id}`, error)
      else stamped++
    }
  }

  return NextResponse.json({
    ok: true,
    dry,
    cadenceDays: days,
    open: open.length,
    due: due.length,
    arResent: arSent.size,
    arFailures: arFailures.length ? arFailures : undefined,
    managersNotified: managerItems.length,
    managerSent,
    managerSkipReason,
    stamped,
  })
}
