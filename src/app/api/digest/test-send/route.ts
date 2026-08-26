export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendMandrillEmail } from '@/lib/mandrill'
import { BUSINESS_TIME_ZONE } from '@/lib/business-time'
import { dedupedCount } from '@/lib/digest/dedupe'
import { runSections, sectionStatuses, getSetting, digestDateLabel } from '@/lib/digest/run'
import type { DigestDb } from '@/lib/digest/types'
import { renderManagerDigestEmail } from '@/lib/email-templates/manager-digest'

// Sends today's real digest to the logged-in super_admin and nobody else.
// Subject is prefixed [TEST] so it can never be mistaken for the real 8 AM
// send, and the configured recipient list is deliberately ignored.
//
// This is the verification step for any rendering change. The HTML preview
// route runs on a browser engine and will look correct even when the Word
// engine has collapsed every chip and fallen back to Times, so a visual change
// is only verified once it has been opened in a real client.

export async function POST() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!user.email) {
    return NextResponse.json({ error: 'Your account has no email address' }, { status: 400 })
  }

  const db = (await createAdminClient('SERVER_ONLY')) as unknown as DigestDb
  const now = new Date()

  const results = await runSections(db)
  const distinctCount = dedupedCount(results)
  const failedCount = results.filter((r) => !r.ok).length

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, '') ?? ''
  const companyName = (await getSetting(db, 'company_name')) ?? 'CallBoard'

  const email = renderManagerDigestEmail({
    results,
    appUrl,
    companyName,
    dateLabel: digestDateLabel(now, BUSINESS_TIME_ZONE),
    isTest: true,
  })

  try {
    const result = await sendMandrillEmail({
      to: { email: user.email },
      subject: email.subject,
      html: email.html,
      text: email.text,
      tags: ['manager-digest-test'],
    })

    // Preview and dev deployments run with outbound disabled: sendMandrillEmail
    // logs the intended recipient and returns a synthetic queued result so
    // callers behave identically. Reporting that as a send would have someone
    // waiting on an email that never left the building.
    if (result.messageId.startsWith('outbound-disabled-')) {
      return NextResponse.json({
        ok: true,
        sent: false,
        reason: 'outbound_disabled',
        distinctCount,
        failedCount,
        sections: sectionStatuses(results),
      })
    }

    return NextResponse.json({
      ok: true,
      sent: true,
      sentTo: user.email,
      distinctCount,
      failedCount,
      sections: sectionStatuses(results),
    })
  } catch (err) {
    console.error('morning-digest test send failed', err)
    return NextResponse.json({ error: 'Send failed' }, { status: 500 })
  }
}
