// Shared "here is your service estimate — approve or decline" sender. Called
// from the manual "Email Estimate" route (Round 1) and the re-notify scanner
// cron (Round 4). One code path so the approval token, email, and audit trail
// never drift between the two callers. Mirrors send-pickup-notice.ts.
//
// First contact stays a manual decision (the office clicks Email Estimate); the
// cron only re-sends to tickets that have ALREADY been emailed at least once.
// This helper itself doesn't enforce that distinction — the cron's candidate
// query does (estimate_emailed_at IS NOT NULL) — so the helper is reusable for
// both the first send and the re-sends.

import { randomBytes } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { sendMandrillEmail, MandrillError } from '@/lib/mandrill'
import { renderEstimateApprovalEmail } from '@/lib/email-templates/estimate-approval'
import { computePartsTax, taxRatePercent } from '@/lib/tax'
import { estimateDiagnosticLine, signedDiagnostic } from '@/lib/service-tickets/diagnostic'

const APPROVAL_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000
const SETTING_KEYS = ['company_name', 'support_phone', 'email_from_address'] as const

export type EstimateNoticeResult =
  | { sent: true; messageId: string; notifyCount: number; approvalUrl: string }
  | { sent: false; reason: 'no_email' | 'not_estimated' | 'status_changed' }

function firstNonEmpty(...vals: (string | null | undefined)[]): string | null {
  for (const v of vals) {
    const t = v?.trim()
    if (t) return t
  }
  return null
}

// Generates/refreshes a 7-day approval token, renders + sends the estimate
// email, and stamps the audit columns (first-send timestamp preserved, last-sent
// + count updated). Throws MandrillError on a send/config failure (the caller
// decides whether to surface or swallow it). Returns {sent:false} for the
// recoverable cases the caller maps to 4xx (no email on file / not in the
// estimated state / a concurrent transition flipped it out of estimated).
//
// Pass `db` to run under a service-role client (the cron has no user session);
// omit it to use the request-scoped cookie client (the manual route, which
// already runs as a manager).
export async function sendEstimateNotice(
  ticketId: string,
  db?: SupabaseClient,
): Promise<EstimateNoticeResult> {
  const supabase = db ?? (await createClient())

  const { data: ticket, error } = await supabase
    .from('service_tickets')
    .select(
      `id, customer_id, work_order_number, status, contact_name, contact_email,
       estimate_amount, estimate_parts, billing_type, estimate_emailed_at, estimate_notify_count,
       diagnostic_charge, diagnostic_invoice_number, diagnostic_invoice_validation_status,
       customers(name, tax_rate, tax_exempt),
       equipment(contact_email)`
    )
    .eq('id', ticketId)
    .single()

  if (error || !ticket) throw new Error(`sendEstimateNotice: ticket ${ticketId} not found`)

  if (ticket.status !== 'estimated') return { sent: false, reason: 'not_estimated' }

  const equip = (ticket.equipment as unknown as { contact_email: string | null } | null) ?? null

  // Resolve recipient email: ticket → equipment → primary contact.
  let primaryEmail: string | null = null
  {
    const { data: contact } = await supabase
      .from('contacts')
      .select('email')
      .eq('customer_id', ticket.customer_id)
      .eq('is_primary', true)
      .limit(1)
      .maybeSingle()
    primaryEmail = (contact as { email: string | null } | null)?.email ?? null
  }

  const toEmail = firstNonEmpty(ticket.contact_email, equip?.contact_email, primaryEmail)
  if (!toEmail) return { sent: false, reason: 'no_email' }

  // Persist a fresh approval token before sending so the URL in the email is
  // backed by a DB row. Status-guarded with .select() so a concurrent transition
  // (e.g. the ticket flipped to 'approved' between the SELECT and the UPDATE) is
  // detected (PGRST116 = no row matched) instead of mailing a dead link.
  const approvalToken = randomBytes(9).toString('base64url')
  const approvalTokenExpiresAt = new Date(Date.now() + APPROVAL_TOKEN_TTL_MS).toISOString()

  const { error: tokenError } = await supabase
    .from('service_tickets')
    .update({
      approval_token: approvalToken,
      approval_token_expires_at: approvalTokenExpiresAt,
    })
    .eq('id', ticketId)
    .eq('status', 'estimated')
    .select('id')
    .single()

  if (tokenError) {
    if (tokenError.code === 'PGRST116') return { sent: false, reason: 'status_changed' }
    throw new Error(`sendEstimateNotice: token persist failed: ${tokenError.message}`)
  }

  // Read settings through the same client so the cron (service-role) path isn't
  // blocked by the RLS a getSetting() cookie client would hit.
  const { data: settingsRows } = await supabase
    .from('settings')
    .select('key, value')
    .in('key', SETTING_KEYS as unknown as string[])
  const settings = new Map<string, string | null>(
    (settingsRows ?? []).map((r: { key: string; value: string | null }) => [r.key, r.value]),
  )
  const companyName = settings.get('company_name')
  const supportPhone = settings.get('support_phone')
  const fromEmail = settings.get('email_from_address')

  if (!fromEmail || fromEmail === 'no-reply@example.com') {
    throw new MandrillError('Email from-address has not been configured. Update settings.email_from_address.')
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, '')
  if (!appUrl) {
    throw new Error('Public app URL is not configured. Set NEXT_PUBLIC_APP_URL.')
  }
  const approvalUrl = `${appUrl}/e/${approvalToken}`

  const customerJoin = ticket.customers as
    { name: string | null; tax_rate: number | null; tax_exempt: boolean | null }
    | { name: string | null; tax_rate: number | null; tax_exempt: boolean | null }[]
    | null
  const customer = Array.isArray(customerJoin) ? customerJoin[0] ?? null : customerJoin
  const customerName = customer?.name ?? null

  // Sales tax on parts (display-only), so the email's total matches the PDF.
  const estParts = (ticket.estimate_parts ?? []) as Array<{
    quantity: number; unit_price: number; warranty_covered?: boolean
  }>
  const partsSubtotal =
    ticket.billing_type === 'warranty'
      ? 0
      : estParts
          .filter((p) => !p.warranty_covered)
          .reduce((s, p) => s + (Number(p.quantity) || 0) * (Number(p.unit_price) || 0), 0)
  const taxPct = taxRatePercent(customer)
  const taxAmount = computePartsTax(partsSubtotal, taxPct / 100)

  // Diagnostic fee is NOT in estimate_amount — signed display-time line so the
  // emailed total matches the approval page and PDF (credit only when the
  // invoice # is verified, migration 137).
  const diag = estimateDiagnosticLine(ticket)
  const emailTotal =
    ticket.estimate_amount != null ? ticket.estimate_amount + signedDiagnostic(diag) : null

  const company = companyName?.trim() || 'CallBoard'

  const email = renderEstimateApprovalEmail({
    ticket: {
      work_order_number: ticket.work_order_number,
      customer_name: customerName,
      contact_name: ticket.contact_name,
      estimate_amount: emailTotal,
      tax_amount: taxAmount,
      tax_rate_percent: taxPct,
      diagnostic_amount: diag?.amount ?? null,
      diagnostic_credited: diag?.credited ?? false,
    },
    approvalUrl,
    settings: {
      company_name: company,
      support_phone: supportPhone || null,
    },
  })

  const sendResult = await sendMandrillEmail({
    to: { email: toEmail, name: ticket.contact_name ?? undefined },
    subject: email.subject,
    html: email.html,
    text: email.text,
    // Customer sees the branch, not the internal tool name.
    fromName: `${company} Service Department`,
    tags: ['estimate-approval'],
    metadata: {
      ticket_id: String(ticket.id),
      work_order: ticket.work_order_number ? String(ticket.work_order_number) : '',
    },
  })

  const now = new Date().toISOString()
  const notifyCount = (ticket.estimate_notify_count ?? 0) + 1
  const { error: stampError } = await supabase
    .from('service_tickets')
    .update({
      // Preserve the first-send timestamp; only set it the first time.
      estimate_emailed_at: ticket.estimate_emailed_at ?? now,
      estimate_last_emailed_at: now,
      estimate_email_message_id: sendResult.messageId,
      estimate_notify_count: notifyCount,
    })
    .eq('id', ticketId)

  if (stampError) {
    // Email already went out — log so we don't surface a misleading error, but
    // the ticket may re-notify next scanner pass since the stamp didn't land.
    console.error('sendEstimateNotice: audit stamp failed (email already sent)', stampError)
  }

  return { sent: true, messageId: sendResult.messageId, notifyCount, approvalUrl }
}
