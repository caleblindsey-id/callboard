// Credit-hold release workflow — shared server-side helper.
//
// A PM or service ticket created for a customer on credit_hold gets a
// credit_reviews row in 'pending' state and an AR email with a tokenized
// /cr/<token> Release/Block link. Work is gated (cannot advance/complete) while
// the review is 'pending' or 'blocked'. AR Release -> proceed. AR Block ->
// locked until a manager unblocks with the shared release passcode.
//
// All writes here use the service-role admin client (credit_reviews RLS only
// grants SELECT to managers; writes bypass RLS). The gate read also uses the
// admin client so the technician-facing routes see gated rows reliably without
// a technician SELECT policy.

import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendMandrillEmail } from '@/lib/mandrill'
import { renderCreditReviewEmail } from '@/lib/email-templates/credit-review'
import { mintToken, tokenExpiry, verifyPasscode, parseEmailList } from '@/lib/credit-review-crypto'
import type {
  Database,
  CreditReviewInsert,
  CreditReviewTicketType,
  CreditReviewUpdate,
  TicketStatus,
  PartRequest,
} from '@/types/database'

export { mintToken, tokenExpiry, hashPasscode, verifyPasscode, parseEmailList, CREDIT_REVIEW_TOKEN_TTL_MS } from '@/lib/credit-review-crypto'

type AdminClient = SupabaseClient<Database>

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

function first<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? (v[0] ?? null) : v
}

async function getSettingViaAdmin(admin: AdminClient, key: string): Promise<string | null> {
  const { data } = await admin.from('settings').select('value').eq('key', key).maybeSingle()
  return data?.value ?? null
}

export type OpenCreditReview = { id: string; status: 'pending' | 'blocked' }

// The single gate used by all four work-advancement routes (PM complete, PM
// PATCH, service complete, service PATCH). Returns the open review or null.
export async function isTicketCreditGated(
  ticketType: CreditReviewTicketType,
  ticketId: string
): Promise<OpenCreditReview | null> {
  const admin = await createAdminClient('SERVER_ONLY')
  const col = ticketType === 'pm' ? 'pm_ticket_id' : 'service_ticket_id'
  const { data, error } = await admin
    .from('credit_reviews')
    .select('id, status')
    .eq(col, ticketId)
    .in('status', ['pending', 'blocked'])
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return { id: data.id, status: data.status as 'pending' | 'blocked' }
}

export type CreditReviewTicketInput = {
  ticketType: CreditReviewTicketType
  ticketId: string
  orderLabel: string
}

export type EnqueueResult = {
  created: number
  emailed: boolean
  reason?: 'ar_email_unset' | 'app_url_unset' | 'email_failed'
  reviewIds: string[]
}

// Create pending credit_reviews for one customer's new orders and send AR a
// single email listing them. Idempotent: tickets that already have a review are
// skipped. Email failure is non-fatal — rows persist (gating still applies) and
// a resend covers it. Returns a summary the caller can surface in the UI.
export async function enqueueCreditReviewsForCustomer(args: {
  customerId: number
  customerName: string
  accountNumber: string | null
  tickets: CreditReviewTicketInput[]
  createdById: string | null
}): Promise<EnqueueResult> {
  const { customerId, customerName, accountNumber, tickets, createdById } = args
  if (tickets.length === 0) return { created: 0, emailed: false, reviewIds: [] }

  const admin = await createAdminClient('SERVER_ONLY')

  // Skip tickets that already have a review (regeneration / double-submit).
  const pmIds = tickets.filter((t) => t.ticketType === 'pm').map((t) => t.ticketId)
  const svcIds = tickets.filter((t) => t.ticketType === 'service').map((t) => t.ticketId)
  const existing = new Set<string>()
  if (pmIds.length) {
    const { data } = await admin.from('credit_reviews').select('pm_ticket_id').in('pm_ticket_id', pmIds)
    for (const row of data ?? []) if (row.pm_ticket_id) existing.add(`pm:${row.pm_ticket_id}`)
  }
  if (svcIds.length) {
    const { data } = await admin.from('credit_reviews').select('service_ticket_id').in('service_ticket_id', svcIds)
    for (const row of data ?? []) if (row.service_ticket_id) existing.add(`service:${row.service_ticket_id}`)
  }
  const fresh = tickets.filter((t) => !existing.has(`${t.ticketType}:${t.ticketId}`))
  if (fresh.length === 0) return { created: 0, emailed: false, reviewIds: [] }

  const inserts: CreditReviewInsert[] = fresh.map((t) => ({
    ticket_type: t.ticketType,
    pm_ticket_id: t.ticketType === 'pm' ? t.ticketId : null,
    service_ticket_id: t.ticketType === 'service' ? t.ticketId : null,
    customer_id: customerId,
    status: 'pending',
    action_token: mintToken(),
    action_token_expires_at: tokenExpiry(),
    updated_by_id: createdById,
  }))

  const { data: insertedRows, error: insErr } = await admin
    .from('credit_reviews')
    .insert(inserts)
    .select('id, action_token, pm_ticket_id, service_ticket_id')
  if (insErr) throw insErr

  const rows = insertedRows ?? []
  if (rows.length === 0) return { created: 0, emailed: false, reviewIds: [] }
  const reviewIds = rows.map((r) => r.id)

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, '')
  if (!appUrl) {
    console.error('credit-review: NEXT_PUBLIC_APP_URL not set; rows created but no AR email sent')
    return { created: rows.length, emailed: false, reason: 'app_url_unset', reviewIds }
  }

  const arEmails = parseEmailList(await getSettingViaAdmin(admin, 'ar_email'))
  if (arEmails.length === 0) {
    return { created: rows.length, emailed: false, reason: 'ar_email_unset', reviewIds }
  }

  const labelByKey = new Map(fresh.map((t) => [`${t.ticketType}:${t.ticketId}`, t.orderLabel]))
  const companyName = (await getSettingViaAdmin(admin, 'company_name')) ?? 'CallBoard'
  const supportPhone = await getSettingViaAdmin(admin, 'support_phone')
  const nowIso = new Date().toISOString()

  // One email PER ORDER (not one per customer) so AR can Release/Block each
  // order independently from its own message. Each row already has its own
  // action_token. A send failure on one order is non-fatal: its row persists
  // (still gated) and is resendable; we report emailed=false so callers surface it.
  let allSent = true
  for (const r of rows) {
    const key = r.pm_ticket_id ? `pm:${r.pm_ticket_id}` : `service:${r.service_ticket_id}`
    const review = {
      orderLabel: labelByKey.get(key) ?? 'Order',
      reviewUrl: `${appUrl}/cr/${r.action_token}`,
    }
    const email = renderCreditReviewEmail({
      customerName,
      accountNumber,
      reviews: [review],
      settings: { company_name: companyName, support_phone: supportPhone },
    })
    try {
      const res = await sendMandrillEmail({
        to: { email: arEmails[0] },
        cc: arEmails.slice(1).map((e) => ({ email: e })),
        subject: email.subject,
        html: email.html,
        text: email.text,
        tags: ['credit-review'],
        metadata: { customer_id: String(customerId) },
      })
      await admin
        .from('credit_reviews')
        .update({ email_message_id: res.messageId, emailed_at: nowIso })
        .eq('id', r.id)
    } catch (err) {
      console.error(`credit-review email send failed for review ${r.id}:`, err)
      allSent = false
    }
  }

  return allSent
    ? { created: rows.length, emailed: true, reviewIds }
    : { created: rows.length, emailed: false, reason: 'email_failed', reviewIds }
}

// Orders that have NOT been started yet — the only ones a newly-on-hold
// customer's open work gets auto-routed to AR for. PM stops at in_progress;
// service stops once a tech is actually working (in_progress onward).
const PM_SWEEP_STATUSES: TicketStatus[] = ['unassigned', 'assigned']
const SERVICE_SWEEP_STATUSES = ['open', 'estimated', 'approved']

// A part already on order, received, or pulled from stock means the job is in
// motion — don't disrupt it by routing the order to AR. A bare request
// (pending_review / requested) isn't committed yet, so it doesn't count.
function hasPartsInMotion(parts: PartRequest[] | null | undefined): boolean {
  return (parts ?? []).some(
    (p) => p.status === 'ordered' || p.status === 'received' || p.status === 'from_stock'
  )
}

export type SweepResult = {
  onHoldCustomers: number
  customersEnqueued: number
  created: number
  emailed: number
}

// Idempotent backfill for orphan orders: a customer who went on credit hold
// AFTER an order was created — or whose orders predate the credit-review feature
// — never got an AR review. This finds their un-started open orders that have no
// review yet and routes them through the normal AR flow (one email per customer).
// Started work (PM in_progress+, service in_progress+) and any order with parts
// already in motion are deliberately left alone. Safe to run repeatedly:
// enqueueCreditReviewsForCustomer skips tickets that already have a review.
export async function sweepCreditHoldOrphans(): Promise<SweepResult> {
  const admin = await createAdminClient('SERVER_ONLY')

  const { data: customers, error: custErr } = await admin
    .from('customers')
    .select('id, name, account_number')
    .eq('credit_hold', true)
  if (custErr) throw custErr
  if (!customers || customers.length === 0) {
    return { onHoldCustomers: 0, customersEnqueued: 0, created: 0, emailed: 0 }
  }
  const custIds = customers.map((c) => c.id)
  const custById = new Map(customers.map((c) => [c.id, c]))

  const [pmRes, svcRes] = await Promise.all([
    admin
      .from('pm_tickets')
      .select('id, customer_id, month, year, parts_requested, status')
      .in('customer_id', custIds)
      .in('status', PM_SWEEP_STATUSES)
      .is('deleted_at', null),
    admin
      .from('service_tickets')
      .select('id, customer_id, work_order_number, parts_requested, status')
      .in('customer_id', custIds)
      .in('status', SERVICE_SWEEP_STATUSES)
      .is('deleted_at', null),
  ])
  if (pmRes.error) throw pmRes.error
  if (svcRes.error) throw svcRes.error

  const ticketsByCustomer = new Map<number, CreditReviewTicketInput[]>()
  const add = (cid: number | null, t: CreditReviewTicketInput) => {
    if (cid == null) return
    const arr = ticketsByCustomer.get(cid) ?? []
    arr.push(t)
    ticketsByCustomer.set(cid, arr)
  }
  for (const r of pmRes.data ?? []) {
    if (hasPartsInMotion(r.parts_requested as PartRequest[] | null)) continue
    const orderLabel = `PM ${MONTHS[(r.month - 1) % 12] ?? ''} ${r.year}`.trim()
    add(r.customer_id, { ticketType: 'pm', ticketId: r.id, orderLabel })
  }
  for (const r of svcRes.data ?? []) {
    if (hasPartsInMotion(r.parts_requested as PartRequest[] | null)) continue
    const orderLabel = r.work_order_number ? `Service — WO-${r.work_order_number}` : 'Service Order'
    add(r.customer_id, { ticketType: 'service', ticketId: r.id, orderLabel })
  }

  let customersEnqueued = 0
  let created = 0
  let emailed = 0
  for (const [cid, tickets] of ticketsByCustomer) {
    const c = custById.get(cid)
    if (!c) continue
    const res = await enqueueCreditReviewsForCustomer({
      customerId: cid,
      customerName: c.name,
      accountNumber: c.account_number,
      tickets,
      createdById: null, // system sweep, not a user action
    })
    if (res.created > 0) {
      customersEnqueued++
      created += res.created
      if (res.emailed) emailed++
    }
  }

  return { onHoldCustomers: customers.length, customersEnqueued, created, emailed }
}

export type ConsumeResult =
  | { ok: true; action: 'release' | 'block' }
  | { ok: false; code: 'not_found' | 'expired' | 'already_decided' }

// AR clicks Release/Block on /cr/<token>. Atomic CAS on status='pending' guards
// double-submit; token is nullified on success so the link can't be replayed.
export async function consumeCreditReviewToken(args: {
  token: string
  action: 'release' | 'block'
  decidedByName: string
  blockReason?: string | null
}): Promise<ConsumeResult> {
  const admin = await createAdminClient('SERVER_ONLY')
  const { data: row, error } = await admin
    .from('credit_reviews')
    .select('id, status, action_token_expires_at')
    .eq('action_token', args.token)
    .maybeSingle()
  if (error) throw error
  if (!row) return { ok: false, code: 'not_found' }

  const expired =
    row.action_token_expires_at && new Date(row.action_token_expires_at) < new Date()
  if (expired) return { ok: false, code: 'expired' }
  if (row.status !== 'pending') return { ok: false, code: 'already_decided' }

  const update: CreditReviewUpdate = {
    status: args.action === 'release' ? 'released' : 'blocked',
    decided_by_name: args.decidedByName,
    decided_at: new Date().toISOString(),
    action_token: null,
    action_token_expires_at: null,
    updated_at: new Date().toISOString(),
  }
  if (args.action === 'block' && args.blockReason?.trim()) {
    update.block_reason = args.blockReason.trim()
  }

  const { data: written, error: wErr } = await admin
    .from('credit_reviews')
    .update(update)
    .eq('id', row.id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle()
  if (wErr) throw wErr
  if (!written) return { ok: false, code: 'already_decided' }
  return { ok: true, action: args.action }
}

export type ResendResult =
  | { ok: true }
  | { ok: false; code: 'not_found' | 'not_pending' | 'ar_email_unset' | 'app_url_unset' | 'email_failed' }

// Re-mint the token + re-send the AR email for a single pending review. Covers
// expired links and the "ar_email was unset at creation" backlog.
export async function resendCreditReview(args: {
  reviewId: string
  actorId: string | null
}): Promise<ResendResult> {
  const admin = await createAdminClient('SERVER_ONLY')
  const { data: row, error } = await admin
    .from('credit_reviews')
    .select(`
      id, status, ticket_type, customer_id,
      customers ( name, account_number ),
      pm_tickets ( month, year, equipment ( make, model ) ),
      service_tickets ( work_order_number )
    `)
    .eq('id', args.reviewId)
    .maybeSingle()
  if (error) throw error
  if (!row) return { ok: false, code: 'not_found' }
  if (row.status !== 'pending') return { ok: false, code: 'not_pending' }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, '')
  if (!appUrl) return { ok: false, code: 'app_url_unset' }
  const arEmails = parseEmailList(await getSettingViaAdmin(admin, 'ar_email'))
  if (arEmails.length === 0) return { ok: false, code: 'ar_email_unset' }

  const token = mintToken()
  const { data: written, error: upErr } = await admin
    .from('credit_reviews')
    .update({
      action_token: token,
      action_token_expires_at: tokenExpiry(),
      updated_by_id: args.actorId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', row.id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle()
  if (upErr) throw upErr
  // AR consumed the token between our read and this write — don't email a link
  // whose token we just failed to set.
  if (!written) return { ok: false, code: 'not_pending' }

  const customer = first(row.customers as { name: string; account_number: string | null } | { name: string; account_number: string | null }[])
  let orderLabel = 'Order'
  if (row.ticket_type === 'pm') {
    const pm = first(row.pm_tickets as { month: number; year: number; equipment: unknown } | { month: number; year: number; equipment: unknown }[])
    const equip = first(pm?.equipment as { make: string | null; model: string | null } | null)
    const monthLabel = pm ? `${MONTHS[(pm.month - 1) % 12] ?? ''} ${pm.year}`.trim() : ''
    const equipLabel = equip ? [equip.make, equip.model].filter(Boolean).join(' ') : ''
    orderLabel = `PM ${monthLabel}${equipLabel ? ` — ${equipLabel}` : ''}`.trim()
  } else {
    const svc = first(row.service_tickets as { work_order_number: number | null } | { work_order_number: number | null }[])
    orderLabel = svc?.work_order_number ? `Service WO-${svc.work_order_number}` : 'Service order'
  }

  const companyName = (await getSettingViaAdmin(admin, 'company_name')) ?? 'CallBoard'
  const supportPhone = await getSettingViaAdmin(admin, 'support_phone')
  const email = renderCreditReviewEmail({
    customerName: customer?.name ?? 'Customer',
    accountNumber: customer?.account_number ?? null,
    reviews: [{ orderLabel, reviewUrl: `${appUrl}/cr/${token}` }],
    settings: { company_name: companyName, support_phone: supportPhone },
  })

  try {
    const res = await sendMandrillEmail({
      to: { email: arEmails[0] },
      cc: arEmails.slice(1).map((e) => ({ email: e })),
      subject: email.subject,
      html: email.html,
      text: email.text,
      tags: ['credit-review'],
      metadata: { customer_id: String(row.customer_id) },
    })
    await admin
      .from('credit_reviews')
      .update({ email_message_id: res.messageId, emailed_at: new Date().toISOString() })
      .eq('id', row.id)
    return { ok: true }
  } catch (err) {
    console.error('credit-review resend email failed:', err)
    return { ok: false, code: 'email_failed' }
  }
}

export type UnblockResult =
  | { ok: true }
  | { ok: false; code: 'bad_passcode' | 'passcode_unset' | 'not_blocked' | 'not_found' }

// Manager enters the shared release passcode to unblock an AR-blocked order.
export async function unblockCreditReview(args: {
  reviewId: string
  passcode: string
  managerId: string
}): Promise<UnblockResult> {
  const admin = await createAdminClient('SERVER_ONLY')
  const hash = await getSettingViaAdmin(admin, 'credit_hold_release_passcode_hash')
  if (!hash) return { ok: false, code: 'passcode_unset' }

  const { data: row, error } = await admin
    .from('credit_reviews')
    .select('id, status')
    .eq('id', args.reviewId)
    .maybeSingle()
  if (error) throw error
  if (!row) return { ok: false, code: 'not_found' }
  if (row.status !== 'blocked') return { ok: false, code: 'not_blocked' }

  const ok = await verifyPasscode(args.passcode, hash)
  if (!ok) return { ok: false, code: 'bad_passcode' }

  const { data: written, error: wErr } = await admin
    .from('credit_reviews')
    .update({
      status: 'released',
      unblocked_by_id: args.managerId,
      unblocked_at: new Date().toISOString(),
      updated_by_id: args.managerId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', row.id)
    .eq('status', 'blocked')
    .select('id')
    .maybeSingle()
  if (wErr) throw wErr
  if (!written) return { ok: false, code: 'not_blocked' }
  return { ok: true }
}
