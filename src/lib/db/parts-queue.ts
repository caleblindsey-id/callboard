import { createClient } from '@/lib/supabase/server'
import type { DigestDb } from '@/lib/digest/types'
import {
  ESTIMATE_HELD_TICKET_STATUSES,
  isHeldForEstimate,
  partsMarkedNotUsed,
  partsMissingFromWorkOrder,
} from '@/lib/parts'
import type { PartRequest, PartUsed, PartsQueueRow, PartsQueueSource } from '@/types/database'

// Columns the queue page actually renders. customer_id and assigned_technician_id
// are present on the view but never displayed — keeping them out of the wire
// payload meaningfully shrinks transfer size on busy weeks. synergy_product_id
// stays so partToRow can preserve it through optimistic updates.
// synergy_order_number ships down because the validation badge tooltip prints
// it ("Synergy Order #616207 not found").
const QUEUE_COLUMNS = `
  source, ticket_id, work_order_number, part_index,
  customer_name, assigned_technician_name,
  synergy_order_number, synergy_validation_status, parts_validation_status, synergy_validated_at,
  requested_at, description, detail, quantity, unit_price, vendor, vendor_code,
  product_number, synergy_product_id, vendor_item_code, po_number,
  status, cancelled, cancel_reason,
  ordered_at, received_at, ordered_by, received_by,
  machine_make, machine_model, machine_serial,
  covered_by_agreement,
  qty_on_hand, qty_on_po,
  triaged_by, triaged_at, triage_reason, qoh_at_triage, qopo_at_triage,
  pulled_at, pulled_by, bin_location, po_due_date,
  shipping_method, shipping_note, shipping_charge,
  ticket_status
`

// Estimated arrival dates for a ticket's ordered parts, keyed
// `${po_number}|${product_number}`. Backs the "Est. arrival" line on the tech
// ticket views, which render parts straight from the ticket's parts_requested
// JSONB (not the parts_order_queue view) and so can't get the date via a join.
// Looks the dates up live from synergy_po_lines so they stay as fresh as the
// hourly sync — nothing is written back onto the JSONB. Only parts that carry
// both a PO # and a product number can match; a part not on an open PO is simply
// absent from the map (the caller renders nothing).
export async function getPoDueDates(
  parts: { po_number?: string | null; product_number?: string | null }[]
): Promise<Record<string, string>> {
  const poNumbers = [
    ...new Set(
      parts
        .filter(p => p.po_number?.trim() && p.product_number?.trim())
        .map(p => p.po_number!.trim())
    ),
  ]
  if (poNumbers.length === 0) return {}

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('synergy_po_lines')
    .select('po_number, product_number, due_date')
    .in('po_number', poNumbers)

  if (error || !data) return {}

  const map: Record<string, string> = {}
  for (const r of data as { po_number: string; product_number: string; due_date: string | null }[]) {
    if (r.due_date) map[`${r.po_number}|${r.product_number}`] = r.due_date
  }
  return map
}

export async function getPartsQueue(db?: DigestDb): Promise<PartsQueueRow[]> {
  const supabase = db ?? (await createClient())
  const { data, error } = await supabase
    .from('parts_order_queue')
    .select(QUEUE_COLUMNS)
    .returns<PartsQueueRow[]>()
    .order('requested_at', { ascending: true })

  if (error) throw error
  return data ?? []
}

// ---------------------------------------------------------------------------
// Tech-facing "My Parts" queue (read-only)
//
// Deliberately does NOT read the parts_order_queue view. That view has no
// parent-ticket-status filter, so a 'received' part lingers forever once its
// ticket is completed/billed — which would make the tech's "Ready for Pickup"
// tab fill with already-picked-up parts and never match the dashboard count
// cards. Instead we reuse the exact status predicates from
// getPartsOnOrderCount / getPartsReadyForPickupCount (src/lib/db/service-tickets.ts)
// so the card set and the page set share one definition of "live" work, then
// flatten parts_requested in JS. Scope is a single tech's open tickets — well
// under any row cap.
// ---------------------------------------------------------------------------

export type MyPartStatus =
  | 'pending_review'
  | 'requested'
  | 'ordered'
  | 'received'
  | 'from_stock'

export type MyPartRow = {
  source: PartsQueueSource
  ticket_id: string
  work_order_number: number | null
  part_index: number
  customer_name: string | null
  description: string | null
  detail: string | null
  quantity: number | null
  unit_price: number | null
  vendor: string | null
  machine_make: string | null
  machine_model: string | null
  machine_serial: string | null
  status: MyPartStatus
  requested_at: string | null
  ordered_at: string | null
  received_at: string | null
  triaged_at: string | null
  // Set when a from_stock part has been physically pulled and staged for the
  // tech (migration 104). null = still being pulled.
  pulled_at: string | null
  // Set when the tech/office acknowledged picking the staged part up. null =
  // still awaiting pickup. Drives the "Picked up" badge on Ready for Pickup.
  collected_at: string | null
}

type TicketPartsRow = {
  id: string
  work_order_number: number | null
  status: string
  parts_requested: PartRequest[] | null
  customers: { name: string } | null
  // Machine sourcing mirrors the parts_order_queue view: service tickets carry
  // inline equipment_* fields COALESCE'd over the linked equipment row; PM has
  // no inline fields and reads the linked row only.
  equipment_make?: string | null
  equipment_model?: string | null
  equipment_serial_number?: string | null
  equipment: { make: string | null; model: string | null; serial_number: string | null } | null
}

function flattenParts(rows: TicketPartsRow[], source: PartsQueueSource): MyPartRow[] {
  const out: MyPartRow[] = []
  for (const ticket of rows) {
    const parts = Array.isArray(ticket.parts_requested) ? ticket.parts_requested : []
    parts.forEach((part, idx) => {
      if (part.cancelled) return
      const status = (part.status ?? 'requested') as MyPartStatus
      if (
        status !== 'pending_review' &&
        status !== 'requested' &&
        status !== 'ordered' &&
        status !== 'received' &&
        status !== 'from_stock'
      )
        return
      // Mirror the parts_order_queue view rule: hide service parts still awaiting
      // an estimate decision (pending_review or requested) until the estimate is
      // approved — uncommitted estimates aren't actionable yet. PM parts always show.
      // The view extends the same rule to declined/canceled tickets (migration
      // 147); no branch for that is needed here because the query above drops
      // those tickets wholesale.
      if (
        source === 'service' &&
        (status === 'requested' || status === 'pending_review') &&
        (ticket.status === 'open' || ticket.status === 'estimated')
      ) {
        return
      }
      const eq = ticket.equipment
      out.push({
        source,
        ticket_id: ticket.id,
        work_order_number: ticket.work_order_number,
        part_index: idx,
        customer_name: ticket.customers?.name ?? null,
        description: part.description ?? null,
        detail: part.detail ?? null,
        quantity: part.quantity ?? null,
        unit_price: part.unit_price ?? null,
        vendor: part.vendor ?? null,
        // Inline (service) wins over the linked row; '' falls through to linked.
        machine_make: ticket.equipment_make || eq?.make || null,
        machine_model: ticket.equipment_model || eq?.model || null,
        machine_serial: ticket.equipment_serial_number || eq?.serial_number || null,
        status,
        requested_at: part.requested_at ?? null,
        ordered_at: part.ordered_at ?? null,
        received_at: part.received_at ?? null,
        triaged_at: part.triaged_at ?? null,
        pulled_at: part.pulled_at ?? null,
        collected_at: part.collected_at ?? null,
      })
    })
  }
  return out
}

export async function getMyPartsQueue(userId: string): Promise<MyPartRow[]> {
  const supabase = await createClient()

  const [pmResult, serviceResult] = await Promise.all([
    supabase
      .from('pm_tickets')
      .select('id, work_order_number, status, parts_requested, customers(name), equipment(make, model, serial_number)')
      .eq('assigned_technician_id', userId)
      .is('deleted_at', null)
      .not('status', 'in', '("completed","billed","skipped","skip_requested")'),
    supabase
      .from('service_tickets')
      .select('id, work_order_number, status, parts_requested, customers(name), equipment_make, equipment_model, equipment_serial_number, equipment(make, model, serial_number)')
      .eq('assigned_technician_id', userId)
      .is('deleted_at', null)
      // Service parts drop off the tech queue at completion (parity with PM
      // above), not at billing — once the work is done the tech is finished
      // with them. Mirrors getPartsReadyForPickupCount / getPartsOnOrderCount.
      .not('status', 'in', '("completed","billed","declined","canceled")'),
  ])

  if (pmResult.error) throw pmResult.error
  if (serviceResult.error) throw serviceResult.error

  return [
    ...flattenParts((pmResult.data ?? []) as unknown as TicketPartsRow[], 'pm'),
    ...flattenParts((serviceResult.data ?? []) as unknown as TicketPartsRow[], 'service'),
  ]
}

// ---------------------------------------------------------------------------
// Parts the estimate gate is withholding from the queue
//
// The parts_order_queue view drops uncommitted service parts while their ticket
// sits in an estimate state (see isHeldForEstimate for the full predicate and
// the feedback #91 story). That is deliberate and stays. What was NOT deliberate
// is that it happened in total silence: the part saved fine, showed "In Review"
// on the ticket, and simply never arrived in the queue, with nothing anywhere
// saying why.
//
// So: read the withheld set explicitly, purely to display it. This deliberately
// does NOT go through the view — the view's whole job is to exclude these rows,
// and widening it would change every other consumer (the dashboard counts in
// db/service-tickets.ts, the morning digest, service-readiness) and re-open
// feedback #81. Nothing here is actionable; the banner links back to the ticket
// and the office approves the estimate there.
// ---------------------------------------------------------------------------

export type HeldPartRow = {
  ticket_id: string
  work_order_number: number | null
  part_index: number
  customer_name: string | null
  description: string | null
  quantity: number | null
  vendor: string | null
  status: string
  requested_at: string | null
  ticket_status: string
}

export async function getPartsHeldForEstimate(): Promise<HeldPartRow[]> {
  const supabase = await createClient()

  // deleted_at guard is required on every multi-row service_tickets read — a
  // soft-deleted ticket keeps its pre-delete status and RLS does not filter it
  // (AGENTS.md), so without this the banner would count phantom work.
  const { data, error } = await supabase
    .from('service_tickets')
    .select('id, work_order_number, status, parts_requested, customers(name)')
    .is('deleted_at', null)
    .in('status', [...ESTIMATE_HELD_TICKET_STATUSES])

  if (error) throw error

  const out: HeldPartRow[] = []
  for (const ticket of (data ?? []) as unknown as HeldTicketRow[]) {
    const parts = Array.isArray(ticket.parts_requested) ? ticket.parts_requested : []
    // Index is the part's position in the FULL array — parts_queue and the
    // ticket detail both address parts positionally (feedback #64), so it must
    // be taken before any filtering.
    parts.forEach((part, idx) => {
      if (
        !isHeldForEstimate({
          source: 'service',
          ticketStatus: ticket.status,
          status: part.status,
          cancelled: part.cancelled,
        })
      )
        return
      out.push({
        ticket_id: ticket.id,
        work_order_number: ticket.work_order_number,
        part_index: idx,
        customer_name: ticket.customers?.name ?? null,
        description: part.description ?? null,
        quantity: part.quantity ?? null,
        vendor: part.vendor ?? null,
        status: part.status ?? 'requested',
        requested_at: part.requested_at ?? null,
        ticket_status: ticket.status,
      })
    })
  }
  // Oldest first — a part held for six weeks is the one worth chasing.
  return out.sort((a, b) => (a.requested_at ?? '').localeCompare(b.requested_at ?? ''))
}

type HeldTicketRow = {
  id: string
  work_order_number: number | null
  status: string
  parts_requested: PartRequest[] | null
  customers: { name: string } | null
}

// ---------------------------------------------------------------------------
// Office reconciliation: fulfilled parts that never reached the work order
//
// The standing answer to "is this still happening". parts_requested is
// procurement; parts_used / additional_parts_used are the billable work order,
// and only the latter reaches billing, the work-order PDF, and the billing
// export. Parts are now auto-added on fulfillment, but a tech can still delete
// a line, a legacy part predates the auto-add, and the completion form can race
// it — so the office needs a list, not just a per-ticket banner.
//
// Reads the ticket tables directly rather than parts_order_queue for the same
// reason getMyPartsQueue does: the view carries no work-order lines at all, and
// its PM branch has no parent-status filter. Scope is open + completed-not-yet-
// billed tickets, i.e. everything still fixable before the invoice goes out.
// Already-billed history is the one-time report's job, not this page's.
// ---------------------------------------------------------------------------

export type MissingWorkOrderPartRow = {
  source: PartsQueueSource
  ticket_id: string
  work_order_number: number | null
  ticket_status: string
  part_index: number
  customer_name: string | null
  assigned_technician_name: string | null
  description: string | null
  detail: string | null
  product_number: string | null
  quantity: number | null
  unit_price: number | null
  /** quantity x unit_price — what the customer was not charged. */
  extended_value: number
  status: PartRequest['status']
  covered_by_agreement: boolean | null
  requested_at: string | null
  received_at: string | null
  pulled_at: string | null
  /** When a tech marked this part "not used". Only set on notUsed rows. */
  wo_excluded_at: string | null
  /** The reason the tech typed. Only set on notUsed rows. */
  wo_exclude_reason: string | null
  /** Raw wo_excluded_by uuid, kept so the name lookup has something to key on. */
  excluded_by_id: string | null
  /** Resolved name for wo_excluded_by — the uuid lives inside the JSONB, so it
   *  can't be joined and is looked up in a second pass. */
  excluded_by_name: string | null
}

type MissingScanRow = {
  id: string
  work_order_number: number | null
  status: string
  parts_requested: PartRequest[] | null
  parts_used: PartUsed[] | null
  additional_parts_used?: PartUsed[] | null
  customers: { name: string } | null
  users: { name: string } | null
}

/**
 * One parts_requested entry -> one report row. Shared by both scans below so
 * the missing list and the not-used list can never describe the same part
 * differently.
 */
function toRow(
  ticket: MissingScanRow,
  source: PartsQueueSource,
  part: PartRequest,
  requested: PartRequest[],
): MissingWorkOrderPartRow {
  const qty = part.quantity ?? 0
  const price = typeof part.unit_price === 'number' ? part.unit_price : 0
  return {
    source,
    ticket_id: ticket.id,
    work_order_number: ticket.work_order_number,
    ticket_status: ticket.status,
    // Ordinal in parts_requested — the addressing convention the Parts Queue
    // and the "not used" write both rely on.
    part_index: requested.indexOf(part),
    customer_name: ticket.customers?.name ?? null,
    assigned_technician_name: ticket.users?.name ?? null,
    description: part.description ?? null,
    detail: part.detail ?? null,
    product_number: part.product_number ?? null,
    quantity: qty,
    unit_price: price,
    extended_value: qty * price,
    status: part.status,
    covered_by_agreement: part.covered_by_agreement ?? null,
    requested_at: part.requested_at ?? null,
    received_at: part.received_at ?? null,
    pulled_at: part.pulled_at ?? null,
    wo_excluded_at: part.wo_excluded_at ?? null,
    wo_exclude_reason: part.wo_exclude_reason ?? null,
    excluded_by_id: part.wo_excluded_by ?? null,
    // Filled in by resolveExcludedByNames — the uuid is inside the JSONB.
    excluded_by_name: null,
  }
}

function scanMissing(
  rows: MissingScanRow[],
  source: PartsQueueSource,
): MissingWorkOrderPartRow[] {
  const out: MissingWorkOrderPartRow[] = []
  for (const ticket of rows) {
    const requested = Array.isArray(ticket.parts_requested) ? ticket.parts_requested : []
    // Shared matcher — the same one the server-side auto-add and the tech-facing
    // banner use, so the office list can't disagree with what the tech was shown.
    const missing = partsMissingFromWorkOrder(
      requested,
      ticket.parts_used,
      source === 'pm' ? ticket.additional_parts_used : null,
    )
    for (const part of missing) out.push(toRow(ticket, source, part, requested))
  }
  return out
}

function scanNotUsed(
  rows: MissingScanRow[],
  source: PartsQueueSource,
): MissingWorkOrderPartRow[] {
  const out: MissingWorkOrderPartRow[] = []
  for (const ticket of rows) {
    const requested = Array.isArray(ticket.parts_requested) ? ticket.parts_requested : []
    for (const part of partsMarkedNotUsed(requested)) {
      out.push(toRow(ticket, source, part, requested))
    }
  }
  return out
}

/**
 * Resolve wo_excluded_by uuids to names, in place.
 *
 * A second query rather than a join: the uuid lives inside the parts_requested
 * JSONB, so PostgREST has nothing to join on. The id set is tiny — one entry
 * per person who has ever marked a part not-used — so this is a single `in`.
 */
async function resolveExcludedByNames(rows: MissingWorkOrderPartRow[]): Promise<void> {
  const ids = [
    ...new Set(rows.map((r) => r.excluded_by_id).filter((id): id is string => !!id)),
  ]
  if (ids.length === 0) return
  const supabase = await createClient()
  const { data } = await supabase.from('users').select('id, name').in('id', ids)
  const byId = new Map((data ?? []).map((u) => [u.id, u.name]))
  for (const row of rows) {
    if (row.excluded_by_id) row.excluded_by_name = byId.get(row.excluded_by_id) ?? null
  }
}

/**
 * PostgREST caps a single response at 1000 rows and says nothing when it
 * truncates — you just get a short array. Both scans below read whole ticket
 * tables, and pm_tickets is already past that cap, so an unpaged read drops the
 * tail silently. It did: the first cut of the not-used list was missing WO 870
 * entirely, and there was no error anywhere to explain why.
 *
 * `order('id')` is what makes the paging stable — without a deterministic sort
 * the pages can overlap or skip rows between round trips.
 */
const SCAN_PAGE_SIZE = 1000

async function fetchAllPages<T>(
  fetchPage: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += SCAN_PAGE_SIZE) {
    const { data, error } = await fetchPage(from, from + SCAN_PAGE_SIZE - 1)
    if (error) throw error
    const page = data ?? []
    out.push(...page)
    // A short page is the only signal that we've reached the end.
    if (page.length < SCAN_PAGE_SIZE) return out
  }
}

export async function getPartsMissingFromWorkOrder(): Promise<MissingWorkOrderPartRow[]> {
  const supabase = await createClient()

  // Two literal selects, not one interpolated string: additional_parts_used is
  // PM-only and supabase-js parses the select literal at the type level.
  // deleted_at IS NULL on both — soft-deleted tickets keep their pre-delete
  // status and RLS does not hide them, so an unguarded scan double-counts.
  const [pmRows, serviceRows] = await Promise.all([
    fetchAllPages((from, to) =>
      supabase
        .from('pm_tickets')
        .select(
          'id, work_order_number, status, parts_requested, parts_used, additional_parts_used, customers(name), users!pm_tickets_assigned_technician_id_fkey(name)',
        )
        .is('deleted_at', null)
        .not('status', 'in', '("billed","skipped")')
        .order('id', { ascending: true })
        .range(from, to),
    ),
    fetchAllPages((from, to) =>
      supabase
        .from('service_tickets')
        .select(
          'id, work_order_number, status, parts_requested, parts_used, customers(name), users!service_tickets_assigned_technician_id_fkey(name)',
        )
        .is('deleted_at', null)
        .not('status', 'in', '("billed","declined","canceled")')
        .order('id', { ascending: true })
        .range(from, to),
    ),
  ])

  return [
    ...scanMissing(pmRows as unknown as MissingScanRow[], 'pm'),
    ...scanMissing(serviceRows as unknown as MissingScanRow[], 'service'),
  ].sort((a, b) => b.extended_value - a.extended_value)
}

/**
 * Parts a tech marked "not used" — bought or pulled, then not fitted.
 *
 * Before feedback #90 these were invisible. Marking a part not-used writes
 * wo_excluded_at / _by / _reason and nothing else: correct for billing, but it
 * also removed the part from the tech banner AND from the missing-from-work-
 * order list above, and no screen ever read the reason back. A $1,372 scrub
 * motor on WO #1396 was received, collected by the tech, marked "Found wiring
 * issues", and then simply stopped being mentioned anywhere in the app.
 *
 * Deliberately a WIDER scope than getPartsMissingFromWorkOrder, which stops at
 * billed tickets because once the invoice is out there is nothing left to fix.
 * The question here is physical, not financial: a received-and-collected motor
 * is on a shelf or in a van whatever the invoice did, and it still has to go
 * back to the vendor or into stock. Three of the seven rows on day one were on
 * already-billed tickets, which is exactly the set the narrower scope drops.
 *
 * Its own queries rather than a second bucket off the scan above, precisely
 * because of that scope difference — and it needs neither parts_used nor
 * additional_parts_used, so the wider row count is paid for with a narrower
 * select rather than three JSONB arrays per ticket.
 */
export async function getPartsMarkedNotUsed(): Promise<MissingWorkOrderPartRow[]> {
  const supabase = await createClient()

  // deleted_at IS NULL on both: a soft-deleted ticket keeps its pre-delete
  // status and RLS does not filter it, so an unguarded scan inflates the list.
  // Paged, because this scan has no status filter and pm_tickets is already
  // past PostgREST's 1000-row response cap — see fetchAllPages.
  const [pmRows, serviceRows] = await Promise.all([
    fetchAllPages((from, to) =>
      supabase
        .from('pm_tickets')
        .select(
          'id, work_order_number, status, parts_requested, customers(name), users!pm_tickets_assigned_technician_id_fkey(name)',
        )
        .is('deleted_at', null)
        .order('id', { ascending: true })
        .range(from, to),
    ),
    fetchAllPages((from, to) =>
      supabase
        .from('service_tickets')
        .select(
          'id, work_order_number, status, parts_requested, customers(name), users!service_tickets_assigned_technician_id_fkey(name)',
        )
        .is('deleted_at', null)
        .order('id', { ascending: true })
        .range(from, to),
    ),
  ])

  const rows = [
    ...scanNotUsed(pmRows as unknown as MissingScanRow[], 'pm'),
    ...scanNotUsed(serviceRows as unknown as MissingScanRow[], 'service'),
  ].sort((a, b) => b.extended_value - a.extended_value)

  await resolveExcludedByNames(rows)
  return rows
}
