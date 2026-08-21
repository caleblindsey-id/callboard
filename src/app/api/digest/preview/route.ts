export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { BUSINESS_TIME_ZONE } from '@/lib/business-time'
import { runSections, getSetting, digestDateLabel } from '@/lib/digest/run'
import type { DigestDb } from '@/lib/digest/types'
import { renderMorningDigestEmail } from '@/lib/email-templates/morning-digest'

// Renders today's real digest as HTML in the browser, for a super_admin only.
// Nothing is sent.
//
// This is for fast layout iteration ONLY. It renders on a browser engine and
// will look perfect even when the email is broken in classic Outlook, which is
// exactly how the Python version's --preview flag misled. The actual
// verification step is POST /api/digest/test-send, opened in a real client.

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const db = (await createAdminClient('SERVER_ONLY')) as unknown as DigestDb
  const now = new Date()

  const results = await runSections(db)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, '') ?? ''
  const companyName = (await getSetting(db, 'company_name')) ?? 'CallBoard'

  const email = renderMorningDigestEmail({
    results,
    appUrl,
    companyName,
    dateLabel: digestDateLabel(now, BUSINESS_TIME_ZONE),
  })

  return new NextResponse(email.html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}
