import { entityKey, type DigestDb, type DigestRow } from './types'
import { getTickets, getBillingTickets } from '@/lib/db/tickets'
import {
  getServiceTickets,
  getServiceBillingTickets,
  getPoFollowUpQueue,
} from '@/lib/db/service-tickets'
import { getEstimateQueue } from '@/lib/db/estimate-queue'
import { getDeclinedQueue } from '@/lib/db/declined-queue'
import { getPickupQueue } from '@/lib/db/pickup-queue'
import { getPartsQueue } from '@/lib/db/parts-queue'
import { getWarrantyQueue } from '@/lib/db/warranty-queue'
import { getAllLeads } from '@/lib/db/tech-leads'
import { getCreditHoldCustomers } from '@/lib/db/dashboard-metrics'
import { getPendingShipToRequests } from '@/lib/db/ship-to-requests'
import { daysOverdue } from '@/lib/overdue'
import { SERVICE_STATUS } from '@/lib/constants/service-status'
import type { ServiceTicketStatus } from '@/types/service-tickets'

// Every fetcher is a thin adapter over a src/lib/db function, so the digest and
// the queue page it points at are the same query. Nine of the thirteen are
// three-line maps because the shared row types already carry customer_name,
// equipment_label and a days_since_* field.
//
// The four that contain real logic are idleServiceTickets (no shared "idle"
// concept exists), partsStuck and idlePickups (shared queue plus an age
// filter), and creditHoldWithOpenWork (row list built beside the count).

const STUCK_DAYS_PARTS = 7
const STUCK_DAYS_SERVICE = 7

// Owner accents. Colour lives in the chips, never in the section headers.
const SERVICE = { fg: '#1e40af', bg: '#eff6ff' }
const BILLING = { fg: '#0f766e', bg: '#f0fdfa' }
const AR = { fg: '#7c3aed', bg: '#f5f3ff' }

const badge = (label: string, tone: { fg: string; bg: string }) => ({ label, ...tone })
const wo = (n: number | null) => (n === null ? 'No WO #' : `WO #${n}`)

function daysSince(iso: string | null): number | null {
  if (!iso) return null
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}

const age = (days: number | null, suffix: string) =>
  days === null ? `age unknown, ${suffix}` : `${days}d ${suffix}`

// --- KEN, Service Execution ------------------------------------------------

export async function overduePms(db: DigestDb): Promise<DigestRow[]> {
  const now = new Date()
  const rows = await getTickets({ overdueOnly: true, now }, db)
  return rows.map((t) => ({
    entityKey: entityKey('pm', t.id),
    title: wo(t.work_order_number),
    subtitle: t.customers?.name ?? 'Unknown customer',
    meta: `${daysOverdue({ month: t.month, year: t.year }, now)}d overdue, ${
      t.users?.name ?? 'unassigned'
    }`,
    deepLink: `/tickets/${t.id}`,
    badge: badge(t.status, SERVICE),
  }))
}

/**
 * The one section with no shared definition, because the app has no "idle"
 * concept and service_tickets has no status_changed_at column.
 *
 * updated_at is a proxy and any PATCH bumps it, so this includes tickets where
 * a coordinator is actively typing notes. Autosave landed on the estimate and
 * completion phases after the original was written, so the signal is noisier
 * now than at launch. Carried forward as-is; fixing it needs a schema change.
 */
export async function idleServiceTickets(db: DigestDb): Promise<DigestRow[]> {
  const open: ServiceTicketStatus[] = [
    SERVICE_STATUS.OPEN,
    SERVICE_STATUS.ESTIMATED,
    SERVICE_STATUS.APPROVED,
    SERVICE_STATUS.IN_PROGRESS,
  ]
  const rows = await getServiceTickets({ status: open }, db)
  const cutoff = Date.now() - STUCK_DAYS_SERVICE * 86_400_000
  return rows
    .filter((t) => !!t.updated_at && new Date(t.updated_at).getTime() < cutoff)
    .sort((a, b) => (a.updated_at ?? '').localeCompare(b.updated_at ?? ''))
    .map((t) => ({
      entityKey: entityKey('svc', t.id),
      title: wo(t.work_order_number),
      subtitle: t.customers?.name ?? 'Unknown customer',
      meta: age(daysSince(t.updated_at), 'since last touch'),
      deepLink: `/service/${t.id}`,
      badge: badge(t.status, SERVICE),
    }))
}

export async function skipRequests(db: DigestDb): Promise<DigestRow[]> {
  const rows = await getTickets({ status: 'skip_requested' }, db)
  return rows.map((t) => ({
    entityKey: entityKey('pm', t.id),
    title: wo(t.work_order_number),
    subtitle: t.customers?.name ?? 'Unknown customer',
    meta: `${t.month}/${t.year}, ${t.users?.name ?? 'unassigned'}`,
    deepLink: `/tickets/${t.id}`,
    badge: badge('Skip requested', SERVICE),
  }))
}

export async function leadsWaiting(db: DigestDb): Promise<DigestRow[]> {
  const rows = await getAllLeads(db)
  return rows
    .filter((l) => l.status === 'pending')
    .map((l) => ({
      entityKey: entityKey('lead', l.id),
      title: l.customers?.name ?? l.customer_name_text ?? 'Unknown customer',
      subtitle: l.equipment_description || 'No equipment description',
      meta: age(daysSince(l.submitted_at), `waiting, from ${l.submitter?.name ?? 'a tech'}`),
      deepLink: `/tech-leads`,
      badge: badge('Pending', SERVICE),
    }))
}

// --- KEN, Office & Billing -------------------------------------------------

/**
 * Ready to bill means NOT YET EXPORTED.
 *
 * getBillingTickets and getServiceBillingTickets both gate
 * status='completed' AND billing_exported=false, which is what the ACTION
 * ("export to Synergy billing") asks for. Do NOT reach for
 * getPmAwaitingInvoiceTickets / getServiceAwaitingInvoiceTickets here: those
 * are billing_exported=true, the later stage awaiting a Synergy invoice
 * number, and using them would invert the section, listing work already
 * exported and hiding the work Ken needs to export.
 *
 * This is the section the 2026-08-20 audit found overstated by 13, because the
 * Python queried service tickets with no billing_exported filter at all. It
 * was half the email.
 */
export async function readyToBill(db: DigestDb): Promise<DigestRow[]> {
  const [pm, svc] = await Promise.all([
    getBillingTickets(undefined, undefined, db),
    getServiceBillingTickets(undefined, undefined, db),
  ])

  const pmRows: DigestRow[] = pm.map((t) => ({
    entityKey: entityKey('pm', t.id),
    title: wo(t.work_order_number),
    subtitle: t.customers?.name ?? 'Unknown customer',
    meta: 'PM, awaiting export',
    deepLink: `/tickets/${t.id}`,
    badge: badge('PM', SERVICE),
  }))

  const svcRows: DigestRow[] = svc.map((t) => ({
    entityKey: entityKey('svc', t.id),
    title: wo(t.work_order_number),
    subtitle: t.customers?.name ?? 'Unknown customer',
    meta: age(daysSince(t.completed_at), 'since completed'),
    deepLink: `/service/${t.id}`,
    badge: badge('Service', BILLING),
  }))

  return [...pmRows, ...svcRows]
}

export async function estimatesAwaitingApproval(db: DigestDb): Promise<DigestRow[]> {
  const rows = await getEstimateQueue(db)
  return rows.map((r) => ({
    entityKey: entityKey('svc', r.id),
    title: wo(r.work_order_number),
    subtitle: r.customer_name,
    meta: age(r.days_since_estimate, 'awaiting approval'),
    deepLink: `/service/${r.id}`,
    badge: badge(r.contact_status, BILLING),
  }))
}

export async function declinedUnresolved(db: DigestDb): Promise<DigestRow[]> {
  const rows = await getDeclinedQueue(db)
  return rows.map((r) => ({
    entityKey: entityKey('svc', r.id),
    title: wo(r.work_order_number),
    subtitle: r.customer_name,
    meta: age(r.days_since_declined, `declined, ${r.decline_reason ?? 'no reason given'}`),
    deepLink: `/service/${r.id}`,
    badge: badge('Declined', BILLING),
  }))
}

export async function idlePickups(db: DigestDb): Promise<DigestRow[]> {
  const rows = await getPickupQueue(db)
  // getPickupQueue already gates awaiting_pickup=true and not-yet-collected.
  // Both repaired and declined-unrepaired units legitimately sit here, so the
  // only thing the digest adds is the age threshold.
  return rows
    .filter((r) => (r.days_ready ?? 0) > STUCK_DAYS_SERVICE)
    .map((r) => ({
      entityKey: entityKey('svc', r.id),
      title: wo(r.work_order_number),
      subtitle: r.customer_name,
      meta: age(r.days_ready, 'staged and uncollected'),
      deepLink: `/service/${r.id}`,
      badge: badge(r.contact_status, BILLING),
    }))
}

/**
 * Parts aged past the threshold at any BLOCKING stage, not cancelled.
 *
 * Membership matches the Python exactly: status in
 * (pending_review, requested, ordered), or from_stock with pulled_at still
 * null. A pulled from_stock part is staged for the tech and no longer blocking.
 * 'received' is deliberately absent; that hand-off is the pickup queue's job.
 *
 * The Python had to express the pulled/unpulled split as a server-side
 * PostgREST or=(...) filter, because selecting the four statuses and then
 * discarding pulled rows in Python let its limit=50 window fill with rows it
 * threw away, silently cutting the section from 21 items to 1. getPartsQueue
 * reads the whole parts_order_queue view with no window, so there is nothing
 * to poison and no limit to work around. Expect this count to come in at or
 * above the Python's for that reason.
 */
export async function partsStuck(db: DigestDb): Promise<DigestRow[]> {
  const STAGE_ACTION: Record<string, string> = {
    pending_review: 'needs triage',
    requested: 'needs ordering',
    ordered: 'chase the vendor',
    from_stock: 'needs pulling',
  }
  const rows = await getPartsQueue(db)
  const cutoff = Date.now() - STUCK_DAYS_PARTS * 86_400_000

  return rows
    .filter((r) => !r.cancelled)
    .filter((r) =>
      r.status === 'from_stock'
        ? r.pulled_at === null
        : r.status === 'pending_review' || r.status === 'requested' || r.status === 'ordered'
    )
    .filter((r) => !!r.requested_at && new Date(r.requested_at).getTime() < cutoff)
    .sort((a, b) => (a.requested_at ?? '').localeCompare(b.requested_at ?? ''))
    .map((r) => ({
      // A part is identified by its ticket plus its index within that ticket;
      // the queue view has no single-column part id.
      entityKey: entityKey('part', `${r.ticket_id}:${r.part_index}`),
      title: `${wo(r.work_order_number)}, ${r.description ?? 'part'}`,
      subtitle: r.customer_name ?? 'Unknown customer',
      meta: age(daysSince(r.requested_at), STAGE_ACTION[r.status] ?? r.status),
      deepLink: '/parts-queue',
      badge: badge(r.status, BILLING),
    }))
}

// --- OFFICE & AR -----------------------------------------------------------

export async function poGatedBilling(db: DigestDb): Promise<DigestRow[]> {
  const rows = await getPoFollowUpQueue(db)
  return rows.map((t) => ({
    entityKey: entityKey('svc', t.id),
    title: wo(t.work_order_number),
    subtitle: t.customers?.name ?? 'Unknown customer',
    meta: t.po_last_contacted_at
      ? age(daysSince(t.po_last_contacted_at), `since last chase by ${t.po_last_method ?? 'unknown'}`)
      : 'never chased',
    deepLink: `/service/${t.id}`,
    badge: badge(t.po_last_contacted_at ? 'Chased' : 'Never chased', AR),
  }))
}

export async function shipToRequestsPending(db: DigestDb): Promise<DigestRow[]> {
  const rows = await getPendingShipToRequests(db)
  return rows.map((r) => ({
    entityKey: entityKey('shipto', String(r.id)),
    title: r.customer?.name ?? 'Unknown customer',
    subtitle: r.note || 'No address detail given',
    meta: age(daysSince(r.requested_at), `waiting, from ${r.requested_by_user?.name ?? 'a tech'}`),
    deepLink: '/customers',
    badge: badge('Pending', AR),
  }))
}

/**
 * Warranty claims still needing a vendor claim filed.
 *
 * Reuses the app's own definition, which is the whole point of the port:
 * commit e099f9f fixed this section for being narrower than CallBoard's.
 *
 * Two buckets qualify. 'to_file' is the normal case, completed work with no
 * claim yet. 'billed_unclaimed' is the anomaly the 2026-08-21 parity check
 * surfaced: a ticket already invoiced to the customer with no claim ever
 * filed, which the app's queue had been hiding because it gated on
 * status='completed'. Those are the expensive ones, so they sort first.
 *
 * Deliberately NOT filtered to completed-only. The Python used
 * status NOT IN (canceled, declined), which also swept in open and in_progress
 * warranty tickets. Those are correctly excluded here: work that is not
 * finished has nothing to file with a vendor yet.
 */
export async function warrantyToFile(db: DigestDb): Promise<DigestRow[]> {
  const rows = await getWarrantyQueue(db)
  return rows
    .filter((r) => r.bucket === 'to_file' || r.bucket === 'billed_unclaimed')
    .sort((a, b) => Number(b.bucket === 'billed_unclaimed') - Number(a.bucket === 'billed_unclaimed'))
    .map((r) => ({
      entityKey: entityKey('svc', r.id),
      title: wo(r.work_order_number),
      subtitle: r.customer_name,
      meta:
        r.bucket === 'billed_unclaimed'
          ? age(r.days_since_completed, 'since completed, already invoiced with no claim on file')
          : age(r.days_since_completed, `since completed, ${r.warranty_vendor ?? 'no vendor set'}`),
      deepLink: `/service/${r.id}`,
      badge: badge(r.bucket === 'billed_unclaimed' ? 'Billed, no claim' : 'To file', AR),
    }))
}

export async function creditHoldWithOpenWork(db: DigestDb): Promise<DigestRow[]> {
  const rows = await getCreditHoldCustomers(db)
  return rows
    .sort((a, b) => b.open_ticket_count - a.open_ticket_count)
    .map((c) => ({
      entityKey: entityKey('cust', String(c.id)),
      title: c.name ?? `Customer ${c.id}`,
      subtitle: c.account_number ? `Account ${c.account_number}` : 'No account number',
      meta: `${c.open_ticket_count} open ${c.open_ticket_count === 1 ? 'ticket' : 'tickets'}`,
      deepLink: `/customers/${c.id}`,
      badge: badge('Credit hold', AR),
    }))
}
