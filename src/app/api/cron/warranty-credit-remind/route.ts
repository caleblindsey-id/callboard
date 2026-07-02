export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendMandrillEmail } from '@/lib/mandrill'
import { parseEmailList } from '@/lib/credit-review-crypto'
import { timingSafeCompare } from '@/lib/security/timing-safe-compare'
import {
  renderWarrantyReminderEmail,
  type WarrantyReminderRow,
} from '@/lib/email-templates/warranty-credit-reminder'

// Weekly digest of warranty claims still needing office action, sent to the
// warranty_reminder_email settings list. Runs as a Vercel Cron (see
// vercel.json), authenticated by the CRON_SECRET bearer Vercel injects.
// Mirrors estimate-renotify / pickup-renotify, but chases the VENDOR credit
// side of the money instead of a customer decision: warranty work sits unbilled
// until its vendor credit is logged, and until now nothing actively surfaced a
// claim that stalled in "to file" or "awaiting credit".
//
// Digest (one email listing everything actionable) rather than per-ticket
// cadence stamps — no migration, and the office works the queue as a whole.
// A claim leaves the digest the moment its credit is received or the ticket
// bills/deletes, so the email self-empties as the queue is worked.

type RawRow = {
  id: string
  work_order_number: number | null
  completed_at: string | null
  warranty_vendor: string | null
  warranty_claim_number: string | null
  warranty_claim_submitted_at: string | null
  warranty_credit_expected: number | null
  equipment_make: string | null
  equipment_model: string | null
  customers: { name: string | null } | null
  equipment: { make: string | null; model: string | null } | null
}

function firstNonEmpty(...vals: (string | null | undefined)[]): string | null {
  for (const v of vals) {
    const t = v?.trim()
    if (t) return t
  }
  return null
}

export async function GET(request: NextRequest) {
  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. Reject anything
  // else so the endpoint isn't a public email trigger.
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization') ?? ''
  if (!secret || !timingSafeCompare(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = await createAdminClient('SERVER_ONLY')

  // Actionable = warranty work that's complete but whose credit hasn't landed.
  // Same membership as the /warranty-queue To-file + Awaiting-credit buckets.
  const { data, error } = await admin
    .from('service_tickets')
    .select(
      `id, work_order_number, completed_at,
       warranty_vendor, warranty_claim_number, warranty_claim_submitted_at,
       warranty_credit_expected,
       equipment_make, equipment_model,
       customers(name),
       equipment(make, model)`
    )
    .in('billing_type', ['warranty', 'partial_warranty'])
    .eq('status', 'completed')
    .is('deleted_at', null)
    .is('warranty_credit_received_at', null)
    .order('completed_at', { ascending: true, nullsFirst: true })

  if (error) {
    console.error('warranty-credit-remind: candidate query failed', error)
    return NextResponse.json({ error: 'Query failed' }, { status: 500 })
  }

  const rows = (data ?? []) as unknown as RawRow[]
  if (rows.length === 0) {
    return NextResponse.json({ ok: true, candidates: 0, sent: false, reason: 'no_open_claims' })
  }

  const recipients = parseEmailList(await getSetting(admin, 'warranty_reminder_email'))
  if (recipients.length === 0) {
    // Claims are stalling but nobody is configured to hear about it — surface
    // that in the cron result instead of silently succeeding.
    console.error('warranty-credit-remind: warranty_reminder_email not set; digest skipped')
    return NextResponse.json({
      ok: true,
      candidates: rows.length,
      sent: false,
      reason: 'warranty_reminder_email_unset',
    })
  }

  const now = Date.now()
  const daysSince = (iso: string | null): number | null =>
    iso ? Math.floor((now - new Date(iso).getTime()) / 86_400_000) : null

  const toRow = (r: RawRow, agedFrom: string | null): WarrantyReminderRow => ({
    work_order_number: r.work_order_number,
    customer_name: r.customers?.name ?? 'Unknown customer',
    equipment_label:
      firstNonEmpty(
        [firstNonEmpty(r.equipment?.make, r.equipment_make), firstNonEmpty(r.equipment?.model, r.equipment_model)]
          .filter(Boolean)
          .join(' ')
      ) ?? 'Equipment',
    warranty_vendor: r.warranty_vendor,
    warranty_claim_number: r.warranty_claim_number,
    warranty_credit_expected: r.warranty_credit_expected,
    days: daysSince(agedFrom),
  })

  const toFile = rows
    .filter((r) => !r.warranty_claim_submitted_at)
    .map((r) => toRow(r, r.completed_at))
  const awaitingCredit = rows
    .filter((r) => !!r.warranty_claim_submitted_at)
    .map((r) => toRow(r, r.warranty_claim_submitted_at))

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, '') ?? ''
  const companyName = (await getSetting(admin, 'company_name')) ?? 'CallBoard'

  const email = renderWarrantyReminderEmail({
    toFile,
    awaitingCredit,
    queueUrl: `${appUrl}/warranty-queue`,
    settings: { company_name: companyName },
  })

  try {
    await sendMandrillEmail({
      to: { email: recipients[0] },
      cc: recipients.slice(1).map((e) => ({ email: e })),
      subject: email.subject,
      html: email.html,
      text: email.text,
      tags: ['warranty-credit-reminder'],
    })
  } catch (err) {
    console.error('warranty-credit-remind: send failed', err)
    return NextResponse.json({ error: 'Send failed' }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    candidates: rows.length,
    toFile: toFile.length,
    awaitingCredit: awaitingCredit.length,
    sent: true,
    recipients: recipients.length,
  })
}

type AdminClient = Awaited<ReturnType<typeof createAdminClient>>

async function getSetting(admin: AdminClient, key: string): Promise<string | null> {
  const { data } = await admin.from('settings').select('value').eq('key', key).maybeSingle()
  return (data as { value: string | null } | null)?.value ?? null
}
