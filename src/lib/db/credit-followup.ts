// Open credit reviews, enriched for the follow-up cron and the manager digest.
//
// Both callers need the same thing -- every pending/blocked review with enough
// customer and order context to name it in an email -- so they share one fetch
// rather than drifting apart. getOpenCreditReviews() in ./credit-reviews.ts
// stays as it is: it serves the queue page off a session client and returns
// display strings, while this returns the follow-up bookkeeping fields
// (reminder_count, last_reminded_at, decided_at) the page has no use for.

import type { DigestDb } from '@/lib/digest/types'
import type { FollowupCandidate } from '@/lib/credit-followup'

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

function first<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? (v[0] ?? null) : v
}

export type OpenCreditReview = FollowupCandidate & {
  customerId: number
  customerName: string
  accountNumber: string | null
  orderLabel: string
  blockReason: string | null
  decidedByName: string | null
  /** App-relative path to the order, or null if the ticket row vanished. */
  ticketPath: string | null
  /** The underlying order, for digest dedupe keys. */
  ticketType: 'pm' | 'service'
  ticketId: string
}

type CustomerJoin = { name: string; account_number: string | null }
type PmJoin = {
  id: string
  month: number
  year: number
  deleted_at: string | null
  equipment: unknown
}
type SvcJoin = {
  id: string
  work_order_number: number | null
  deleted_at: string | null
}

/**
 * Every open (pending/blocked) credit review, with its order and customer.
 *
 * Soft-deleted orders are dropped. This is the case `npm test`'s soft-delete
 * guard cannot see -- the ticket arrives nested inside a credit_reviews row, so
 * there is no pm_tickets/service_tickets `.from()` chain for the scanner to
 * flag. Without the filter the cron would chase managers every three days,
 * forever, about an order that no longer exists: the review row stays 'blocked'
 * when its ticket is soft-deleted, and nothing else would ever clear it.
 */
export async function getOpenCreditReviewsForFollowup(
  db: DigestDb
): Promise<OpenCreditReview[]> {
  const { data, error } = await db
    .from('credit_reviews')
    .select(`
      id, status, created_at, decided_at, block_reason, decided_by_name,
      reminder_count, last_reminded_at, ticket_type, customer_id,
      customers ( name, account_number ),
      pm_tickets ( id, month, year, deleted_at, equipment ( make, model ) ),
      service_tickets ( id, work_order_number, deleted_at )
    `)
    .in('status', ['pending', 'blocked'])
    .order('created_at', { ascending: true })

  if (error) throw error

  const out: OpenCreditReview[] = []
  for (const r of data ?? []) {
    const customer = first(r.customers as CustomerJoin | CustomerJoin[])
    let orderLabel = 'Order'
    let ticketPath: string | null = null
    let ticketId = ''

    if (r.ticket_type === 'pm') {
      const pm = first(r.pm_tickets as PmJoin | PmJoin[])
      if (!pm || pm.deleted_at) continue
      const equip = first(pm.equipment as { make: string | null; model: string | null } | null)
      const monthLabel = `${MONTHS[(pm.month - 1) % 12] ?? ''} ${pm.year}`.trim()
      const equipLabel = equip ? [equip.make, equip.model].filter(Boolean).join(' ') : ''
      orderLabel = `PM ${monthLabel}${equipLabel ? ` — ${equipLabel}` : ''}`.trim()
      ticketPath = `/tickets/${pm.id}`
      ticketId = pm.id
    } else {
      const svc = first(r.service_tickets as SvcJoin | SvcJoin[])
      if (!svc || svc.deleted_at) continue
      orderLabel = svc.work_order_number ? `Service WO-${svc.work_order_number}` : 'Service order'
      ticketPath = `/service/${svc.id}`
      ticketId = svc.id
    }

    out.push({
      id: r.id,
      status: r.status as 'pending' | 'blocked',
      createdAt: r.created_at,
      decidedAt: r.decided_at,
      lastRemindedAt: r.last_reminded_at,
      reminderCount: r.reminder_count ?? 0,
      customerId: r.customer_id,
      customerName: customer?.name ?? 'Unknown',
      accountNumber: customer?.account_number ?? null,
      orderLabel,
      blockReason: r.block_reason,
      decidedByName: r.decided_by_name,
      ticketPath,
      ticketType: r.ticket_type as 'pm' | 'service',
      ticketId,
    })
  }
  return out
}
