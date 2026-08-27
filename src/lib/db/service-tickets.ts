import { createClient } from '@/lib/supabase/server'
import type { DigestDb } from '@/lib/digest/types'
import { isPartOutstanding } from '@/lib/parts'
import type {
  ServiceTicketRow,
  ServiceTicketWithJoins,
  ServiceTicketDetail,
  ServiceTicketStatus,
  ServicePriority,
  ServiceTicketType,
  ServiceBillingType,
  PartRequest,
  WarrantyReviewStatus,
} from '@/types/service-tickets'
import type { LaborRateType } from '@/types/database'

// --- List service tickets with filters ---

interface ServiceTicketFilters {
  // A single status, or a set of them. The set form backs worklists that span
  // several open statuses (the morning digest's idle queue) without forcing a
  // caller to re-derive this function's joins and soft-delete scoping.
  status?: ServiceTicketStatus | readonly ServiceTicketStatus[]
  technicianId?: string
  customerId?: number
  priority?: ServicePriority
  ticketType?: ServiceTicketType
  billingType?: ServiceBillingType
  waitingOnParts?: boolean
  // The complement of waitingOnParts: nothing outstanding on the parts side, so
  // the work can actually be dispatched. Powers the Approved tab's "Ready to
  // start" filter (feedback #79 — half that queue is blocked on parts and the
  // board gave no signal which half). Deliberately NOT credit-aware: "has no open
  // credit review" is an anti-join PostgREST can't express, and filtering it
  // client-side would silently cap the result at the first page.
  ready?: boolean
  // Completed tickets for PO-required customers that still have no customer PO on
  // file — the "waiting on PO" worklist. Forces status='completed' and requires
  // an inner customers join (see getServiceTickets), so it's handled there rather
  // than in applyServiceTicketFilters. Mirrors the needsPo() gate in
  // ServiceBillingExport.tsx.
  poNeeded?: boolean
  // Soft-delete scoping (parity with PM getTickets). Default (both unset) excludes
  // deleted tickets. deletedOnly → only deleted; includeDeleted → both.
  includeDeleted?: boolean
  deletedOnly?: boolean
  // Opt-in pagination for the board's load-more flow. Unset = full result set
  // (dashboard worklists and other callers rely on that). Only the listing
  // query honors these — the count helpers always count everything.
  limit?: number
  offset?: number
}

// Applies the non-status filters shared by the listing query and the
// per-status count queries. Centralizing them (especially the waiting-on-parts
// and soft-delete predicates) keeps the board's list and tab counts from
// drifting apart. Status is intentionally NOT applied here — the list applies
// its single status filter and the counts helper iterates every status separately.
// Exported for src/lib/db/service-tickets.test.ts, which pins the parts
// predicates by recording the filters this emits. Not intended for callers —
// the query helpers below apply it themselves.
export function applyServiceTicketFilters<Q>(query: Q, filters?: ServiceTicketFilters): Q {
  // The Supabase builder is chainable but its generics make a typed pass-through
  // awkward; cast to a minimal chainable shape, reassign, and return as Q.
  let q = query as unknown as {
    eq(column: string, value: unknown): typeof q
    neq(column: string, value: unknown): typeof q
    is(column: string, value: unknown): typeof q
    not(column: string, operator: string, value: unknown): typeof q
    or(filters: string): typeof q
  }
  if (filters?.technicianId) q = q.eq('assigned_technician_id', filters.technicianId)
  if (filters?.customerId) q = q.eq('customer_id', filters.customerId)
  if (filters?.priority) q = q.eq('priority', filters.priority)
  if (filters?.ticketType) q = q.eq('ticket_type', filters.ticketType)
  if (filters?.billingType) q = q.eq('billing_type', filters.billingType)
  // waitingOnParts and ready are exact complements over the same two columns.
  // The `parts_requested <> '[]'` half of waiting (and its `= '[]'` mirror in
  // ready) is load-bearing rather than redundant: parts_received defaults to
  // false and a ticket that never requested a part never runs the derivation, so
  // without it a brand-new ticket would be reported "waiting on parts" from birth.
  // Passing both is contradictory and correctly matches nothing.
  if (filters?.waitingOnParts) {
    q = q.eq('parts_received', false).neq('parts_requested', '[]' as unknown as PartRequest[])
  }
  if (filters?.ready) {
    q = q.or('parts_received.eq.true,parts_requested.eq.[]')
  }
  // Soft-delete scoping. Default hides deleted tickets from every board/count
  // surface; the manager-only "Deleted" view opts in via deletedOnly.
  if (filters?.deletedOnly) {
    q = q.not('deleted_at', 'is', null)
  } else if (!filters?.includeDeleted) {
    q = q.is('deleted_at', null)
  }
  return q as unknown as Q
}

export async function getServiceTickets(filters?: ServiceTicketFilters, db?: DigestDb): Promise<ServiceTicketWithJoins[]> {
  const supabase = db ?? (await createClient())

  // Listing query: only select columns the board renders. Avoids pulling
  // large JSONB blobs (estimate_parts, parts_requested, customer_signature,
  // photos) on every row — meaningful payload reduction at scale.
  // The PO-needed view filters on customers.po_required, which requires an INNER
  // join (a non-inner embed would null the embed but still return the parent row,
  // defeating the filter), so swap the customers embed accordingly.
  const customersJoin = filters?.poNeeded
    ? 'customers!inner ( name, account_number, credit_hold, po_required )'
    : 'customers ( name, account_number, credit_hold )'
  let query = supabase
    .from('service_tickets')
    .select(`
      id, work_order_number, status, priority, ticket_type, billing_type,
      problem_description, customer_id, equipment_id, assigned_technician_id,
      contact_name, contact_phone, service_address, service_city, service_state,
      equipment_make, equipment_model, equipment_serial_number, estimate_amount, billing_amount,
      request_info_note, po_number,
      synergy_order_number, synergy_invoice_number, synergy_validation_status, parts_received,
      created_at, updated_at, started_at, completed_at, deleted_at,
      ${customersJoin},
      equipment ( make, model, serial_number, description, details_verified_at,
        ship_to_locations ( name, address, city, state, zip )
      ),
      assigned_technician:users!service_tickets_assigned_technician_id_fkey ( name ),
      deleted_by:users!service_tickets_deleted_by_id_fkey ( name ),
      credit_reviews ( status )
    `)
    // Secondary id sort makes pagination stable: created_at alone isn't unique,
    // so page boundaries could duplicate/skip rows without a tiebreaker.
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })

  if (filters?.poNeeded) {
    // PO-needed supersedes the plain status filter: completed tickets for
    // PO-required customers with no customer PO yet (null or '').
    query = query
      .eq('status', 'completed')
      .eq('customers.po_required', true)
      .or('po_number.is.null,po_number.eq.')
  } else if (filters?.status) {
    query = Array.isArray(filters.status)
      ? query.in('status', filters.status as ServiceTicketStatus[])
      : query.eq('status', filters.status as ServiceTicketStatus)
  }
  query = applyServiceTicketFilters(query, filters)

  if (filters?.limit) {
    const offset = filters.offset ?? 0
    query = query.range(offset, offset + filters.limit - 1)
  }

  const { data, error } = await query

  if (error) throw error
  // `deleted_by` embeds the service_tickets_deleted_by_id_fkey relationship (migration
  // 082), which isn't in the generated database.ts types yet, so the inferred row type
  // can't resolve the join. Cast through `unknown` — same pattern as applyServiceTicketFilters.
  return data as unknown as ServiceTicketWithJoins[]
}

// --- Per-ticket parts counts for the board's readiness chip ---

export type ServicePartsCount = { pending: number; total: number }

/**
 * Live part counts per ticket, keyed by ticket id, for the chip's "N of M".
 *
 * Reads the parts_order_queue view rather than the tickets' parts_requested
 * JSONB: the board's list select deliberately omits that blob to keep large
 * JSONB off the wire, and re-adding it to render a two-number chip would undo
 * that. The view already explodes each part into a row with status + cancelled
 * projected as columns.
 *
 * ONLY valid for approved / in_progress tickets. The view's service branch hides
 * requested + pending_review parts while a ticket is open or estimated
 * (migration 102) and now also while it is declined or canceled (migration 147),
 * so at those stages it under-reports and the caller must not ask. Cancelled
 * parts leave the denominator, matching the detail page, where they stay visible
 * but struck through.
 *
 * Soft deletes: the view projects no deleted_at, so this cannot filter on one.
 * It doesn't need to, twice over — the view itself now excludes soft-deleted
 * tickets (migration 147), and ticketIds always arrive from an already-guarded
 * list query. Flagged explicitly because npm test's guard only inspects direct
 * service_tickets reads and would not catch a regression here (AGENTS.md).
 */
export async function getServicePartsCounts(
  ticketIds: string[]
): Promise<Record<string, ServicePartsCount>> {
  if (ticketIds.length === 0) return {}
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('parts_order_queue')
    .select('ticket_id, status, cancelled')
    .eq('source', 'service')
    .in('ticket_id', ticketIds)

  if (error) throw error
  return tallyServicePartRows(data ?? [])
}

/**
 * Fold exploded part rows into per-ticket {pending, total}. Pure so the counting
 * rule is testable without a database — the same reason workOrderAutoAddPatch is
 * split from its route.
 *
 * Cancelled parts are dropped before counting, so they leave both the numerator
 * and the denominator: the chip reads "Parts 1 of 2" on a ticket whose third
 * part was cancelled, matching livePartsRequested on the detail page.
 */
export function tallyServicePartRows(
  rows: Array<{ ticket_id: string | null; status: string | null; cancelled: boolean | null }>
): Record<string, ServicePartsCount> {
  const counts: Record<string, ServicePartsCount> = {}
  for (const row of rows) {
    if (row.cancelled || !row.ticket_id) continue
    const entry = counts[row.ticket_id] ?? { pending: 0, total: 0 }
    entry.total += 1
    if (isPartOutstanding(row)) entry.pending += 1
    counts[row.ticket_id] = entry
  }
  return counts
}

// --- Service ticket counts grouped by status (service board tabs) ---
// Powers the status tabs on /service: each tab shows how many tickets sit in
// that stage, plus an `all` total. Uses one count:'exact', head:true query per
// status (+ one for the total), parallelized — same antipattern-free shape as
// getServiceTicketCounts below. Counts honor every filter EXCEPT status, so the
// numbers stay correct as the user narrows by priority / type / tech / parts.

const SERVICE_STATUS_VALUES: ServiceTicketStatus[] = [
  'open', 'estimated', 'approved', 'in_progress', 'completed', 'billed', 'declined', 'canceled',
]

export type ServiceTicketStatusCounts = Record<ServiceTicketStatus, number> & { all: number; deleted: number }

export async function getServiceTicketStatusCounts(
  filters?: ServiceTicketFilters
): Promise<ServiceTicketStatusCounts> {
  const supabase = await createClient()

  const baseQuery = () =>
    applyServiceTicketFilters(
      supabase.from('service_tickets').select('id', { count: 'exact', head: true }),
      filters
    )

  const allQuery = baseQuery()
  const statusQueries = SERVICE_STATUS_VALUES.map((status) => baseQuery().eq('status', status))
  // Deleted badge for the manager-only "Deleted" board view. Counted separately
  // because the per-status counts (and `all`) exclude soft-deleted tickets.
  const deletedQuery = applyServiceTicketFilters(
    supabase.from('service_tickets').select('id', { count: 'exact', head: true }),
    { ...filters, deletedOnly: true }
  )

  const [allResult, deletedResult, ...statusResults] = await Promise.all([
    allQuery,
    deletedQuery,
    ...statusQueries,
  ])

  if (allResult.error) throw allResult.error
  if (deletedResult.error) throw deletedResult.error
  const counts = { all: allResult.count ?? 0, deleted: deletedResult.count ?? 0 } as ServiceTicketStatusCounts
  SERVICE_STATUS_VALUES.forEach((status, i) => {
    const r = statusResults[i]
    if (r.error) throw r.error
    counts[status] = r.count ?? 0
  })
  return counts
}

// --- Get single service ticket with full detail ---

export async function getServiceTicket(id: string): Promise<ServiceTicketDetail | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('service_tickets')
    .select(`
      *,
      customers ( name, account_number, po_required, ar_terms, credit_hold, tax_rate, tax_exempt ),
      equipment ( id, make, model, serial_number, description, details_verified_at,
        ship_to_locations ( name, address, city, state, zip )
      ),
      ship_to_location:ship_to_locations!service_tickets_ship_to_location_id_fkey ( name, address, city, state, zip ),
      assigned_technician:users!service_tickets_assigned_technician_id_fkey ( name ),
      created_by:users!service_tickets_created_by_id_fkey ( name ),
      deleted_by:users!service_tickets_deleted_by_id_fkey ( name ),
      warranty_review_requested_by:users!service_tickets_warranty_review_requested_by_id_fkey ( name ),
      warranty_review_decided_by:users!service_tickets_warranty_review_decided_by_id_fkey ( name ),
      credit_reviews ( id, status, block_reason, decided_by_name )
    `)
    .eq('id', id)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null
    throw error
  }

  // See note in getServiceTickets: the deleted_by embed isn't resolvable from the
  // generated types yet, so cast through `unknown`.
  return data as unknown as ServiceTicketDetail
}

// --- Update service ticket fields ---

export async function updateServiceTicket(
  id: string,
  data: Partial<ServiceTicketRow>
): Promise<ServiceTicketRow> {
  const supabase = await createClient()

  const { data: updated, error } = await supabase
    .from('service_tickets')
    .update(data)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return updated as ServiceTicketRow
}

// --- Complete a service ticket ---

export async function completeServiceTicket(
  id: string,
  data: {
    completed_at: string
    hours_worked: number
    parts_used: ServiceTicketRow['parts_used']
    completion_notes: string | null
    billing_amount: number
    // Post-coverage customer total (migration 160+ review lifecycle). null =
    // same as billing_amount (not verified-warranty, or coverage denied).
    customer_bill_amount: number | null
    customer_signature: string | null
    customer_signature_name: string | null
    photos: ServiceTicketRow['photos']
    machine_hours?: number | null
    date_code?: string | null
    // Rate class the labor was actually billed at. Only present when the
    // completer changed it on the completion form (feedback #83); persisted in
    // the same UPDATE as the billing_amount computed from it, so the stored
    // rate type and the stored dollar figure can never disagree.
    labor_rate_type?: LaborRateType
    // Optional manager below-floor approval stamp (migration 126). Only present
    // when a manager approved a below-floor price during this completion.
    margin_override_by?: string
    margin_override_at?: string
    margin_override_note?: string
  }
): Promise<ServiceTicketRow> {
  const supabase = await createClient()

  const { data: updated, error } = await supabase
    .from('service_tickets')
    .update({
      status: 'completed',
      completed_at: data.completed_at,
      hours_worked: data.hours_worked,
      parts_used: data.parts_used,
      completion_notes: data.completion_notes,
      billing_amount: data.billing_amount,
      customer_bill_amount: data.customer_bill_amount,
      customer_signature: data.customer_signature,
      customer_signature_name: data.customer_signature_name,
      photos: data.photos,
      machine_hours: data.machine_hours ?? null,
      date_code: data.date_code ?? null,
      ...(data.labor_rate_type ? { labor_rate_type: data.labor_rate_type } : {}),
      ...(data.margin_override_by
        ? {
            margin_override_by: data.margin_override_by,
            margin_override_at: data.margin_override_at,
            margin_override_note: data.margin_override_note,
          }
        : {}),
    })
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return updated as ServiceTicketRow
}

// --- Service tickets ready to bill (parallel to PM getBillingTickets) ---
// Two-phase, export-first flow mirroring PM billing (migration 106):
//   getServiceBillingTickets        → "Ready to Export"   (completed, NOT exported)
//   getServiceAwaitingInvoiceTickets → "Awaiting Invoice #" (completed, exported)
// Default scope is ALL completed service tickets regardless of month, so a
// prior-month completion that was never billed stays visible. month/year are
// optional and narrow on completed_at only when both are supplied. Status flips
// to 'billed' on Mark Billed, which naturally drops rows from both queries.

export type ServiceBillingTicket = {
  id: string
  work_order_number: number | null
  status: ServiceTicketStatus
  ticket_type: ServiceTicketType
  billing_type: ServiceBillingType
  billing_amount: number | null
  // Post-coverage customer total (migration 160+ review lifecycle). NULL =
  // same as billing_amount (not verified, or coverage denied/pending).
  customer_bill_amount: number | null
  hours_worked: number | null
  billing_exported: boolean
  po_number: string | null
  synergy_order_number: string | null
  synergy_invoice_number: string | null
  warranty_credit_received_at: string | null
  warranty_review_status: WarrantyReviewStatus | null
  completed_at: string | null
  customer_id: number | null
  service_address: string | null
  service_city: string | null
  service_state: string | null
  customers: {
    name: string
    account_number: string | null
    po_required: boolean
    ar_terms: string | null
    credit_hold: boolean
  } | null
  equipment: {
    make: string | null
    model: string | null
    serial_number: string | null
    ship_to_locations: {
      name: string | null
      address: string | null
      city: string | null
      state: string | null
    } | null
  } | null
  equipment_make: string | null
  equipment_model: string | null
  assigned_technician: { name: string } | null
}

// Shared loader for both billing queues — identical select/scope, differing only
// on the billing_exported gate (false = Ready to Export, true = Awaiting Invoice #).
async function getServiceBillingByExported(
  exported: boolean,
  month?: number,
  year?: number,
  db?: DigestDb
): Promise<ServiceBillingTicket[]> {
  const supabase = db ?? (await createClient())

  let query = supabase
    .from('service_tickets')
    .select(`
      id, work_order_number, status, ticket_type, billing_type, billing_amount,
      customer_bill_amount, hours_worked,
      billing_exported, po_number, synergy_order_number, synergy_invoice_number,
      warranty_credit_received_at, warranty_review_status, completed_at,
      customer_id, equipment_make, equipment_model,
      service_address, service_city, service_state,
      customers ( name, account_number, po_required, ar_terms, credit_hold, tax_rate, tax_exempt ),
      equipment ( make, model, serial_number,
        ship_to_locations ( name, address, city, state )
      ),
      assigned_technician:users!service_tickets_assigned_technician_id_fkey ( name )
    `)
    .eq('status', 'completed')
    .eq('billing_exported', exported)
    .is('deleted_at', null)

  if (month !== undefined && year !== undefined) {
    const startDate = `${year}-${String(month).padStart(2, '0')}-01T00:00:00.000Z`
    const nextMonth = month === 12 ? 1 : month + 1
    const nextYear = month === 12 ? year + 1 : year
    const endDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01T00:00:00.000Z`
    query = query.gte('completed_at', startDate).lt('completed_at', endDate)
  }

  const { data, error } = await query.order('completed_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as unknown as ServiceBillingTicket[]
}

// "Ready to Export" — completed service tickets not yet exported.
export function getServiceBillingTickets(
  month?: number,
  year?: number,
  db?: DigestDb
): Promise<ServiceBillingTicket[]> {
  return getServiceBillingByExported(false, month, year, db)
}

// "Awaiting Invoice #" — exported tickets where the coordinator keys the Synergy
// invoice # and marks billed (mirrors getPmAwaitingInvoiceTickets).
export function getServiceAwaitingInvoiceTickets(
  month?: number,
  year?: number,
  db?: DigestDb
): Promise<ServiceBillingTicket[]> {
  return getServiceBillingByExported(true, month, year, db)
}

// --- Get service tickets for equipment (for unified service history) ---

export async function getServiceTicketsForEquipment(equipmentId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('service_tickets')
    .select(`
      *,
      assigned_technician:users!service_tickets_assigned_technician_id_fkey ( name )
    `)
    .eq('equipment_id', equipmentId)
    .in('status', ['completed', 'billed'])
    .is('deleted_at', null)
    .order('completed_at', { ascending: false })

  if (error) throw error
  return data as (ServiceTicketRow & { assigned_technician: { name: string } | null })[]
}

// --- Get count of tickets needing parts ordered (dashboard) ---
// ticketType: undefined → service-only (legacy); 'service' → service-only; 'pm' → pm-only

export async function getPartsToOrderCount(ticketType?: 'pm' | 'service'): Promise<number> {
  const supabase = await createClient()

  const source = ticketType === 'pm' ? 'pm' : 'service'

  const { count, error } = await supabase
    .from('parts_order_queue')
    .select('ticket_id', { count: 'exact', head: true })
    .eq('source', source)
    .eq('status', 'requested')
    .eq('cancelled', false)

  if (error) throw error
  return count ?? 0
}

// --- Get count of parts awaiting the stock-vs-order review (dashboard) ---
// New tech requests land in 'pending_review' before the office triages them, so
// they no longer appear in getPartsToOrderCount — count them here instead.

export async function getPartsToReviewCount(ticketType?: 'pm' | 'service'): Promise<number> {
  const supabase = await createClient()

  const source = ticketType === 'pm' ? 'pm' : 'service'

  const { count, error } = await supabase
    .from('parts_order_queue')
    .select('ticket_id', { count: 'exact', head: true })
    .eq('source', source)
    .eq('status', 'pending_review')
    .eq('cancelled', false)

  if (error) throw error
  return count ?? 0
}

// --- Parts on Order: tickets with at least one part in 'ordered' status ---
// ticketType: undefined → service + PM combined; 'service' or 'pm' → that table only

export async function getPartsOnOrderCount(
  technicianId?: string,
  ticketType?: 'pm' | 'service'
): Promise<number> {
  const supabase = await createClient()

  // Supabase query builders return new objects on each chained call —
  // mutating the variable reference (without re-assignment) silently drops
  // the filter. Rebind via let so technicianId scoping actually applies.
  let serviceQuery = supabase
    .from('service_tickets')
    .select('id', { count: 'exact', head: true })
    .is('deleted_at', null)
    .filter('parts_requested', 'cs', JSON.stringify([{ status: 'ordered' }]))
    // Service parts drop off the tech queue at completion (parity with PM),
    // not at billing — once the work is done the tech is finished with them.
    .not('status', 'in', '("completed","billed","declined","canceled")')
  let pmQuery = supabase
    .from('pm_tickets')
    .select('id', { count: 'exact', head: true })
    .is('deleted_at', null)
    .filter('parts_requested', 'cs', JSON.stringify([{ status: 'ordered' }]))
    .not('status', 'in', '("completed","billed","skipped","skip_requested")')
  if (technicianId) {
    serviceQuery = serviceQuery.eq('assigned_technician_id', technicianId)
    pmQuery = pmQuery.eq('assigned_technician_id', technicianId)
  }

  if (ticketType === 'service') {
    const { count, error } = await serviceQuery
    if (error) throw error
    return count ?? 0
  }
  if (ticketType === 'pm') {
    const { count, error } = await pmQuery
    if (error) throw error
    return count ?? 0
  }

  const [serviceResult, pmResult] = await Promise.all([serviceQuery, pmQuery])

  if (serviceResult.error) throw serviceResult.error
  if (pmResult.error) throw pmResult.error
  return (serviceResult.count ?? 0) + (pmResult.count ?? 0)
}

// --- Parts Ready for Pickup: tickets with at least one part in 'received' status ---
// ticketType: undefined → service + PM combined; 'service' or 'pm' → that table only

export async function getPartsReadyForPickupCount(
  technicianId?: string,
  ticketType?: 'pm' | 'service'
): Promise<number> {
  const supabase = await createClient()

  let serviceQuery = supabase
    .from('service_tickets')
    .select('id', { count: 'exact', head: true })
    .is('deleted_at', null)
    .filter('parts_requested', 'cs', JSON.stringify([{ status: 'received' }]))
    // Service parts drop off the tech queue at completion (parity with PM),
    // not at billing — once the work is done the tech is finished with them.
    .not('status', 'in', '("completed","billed","declined","canceled")')
  let pmQuery = supabase
    .from('pm_tickets')
    .select('id', { count: 'exact', head: true })
    .is('deleted_at', null)
    .filter('parts_requested', 'cs', JSON.stringify([{ status: 'received' }]))
    .not('status', 'in', '("completed","billed","skipped","skip_requested")')
  if (technicianId) {
    serviceQuery = serviceQuery.eq('assigned_technician_id', technicianId)
    pmQuery = pmQuery.eq('assigned_technician_id', technicianId)
  }

  if (ticketType === 'service') {
    const { count, error } = await serviceQuery
    if (error) throw error
    return count ?? 0
  }
  if (ticketType === 'pm') {
    const { count, error } = await pmQuery
    if (error) throw error
    return count ?? 0
  }

  const [serviceResult, pmResult] = await Promise.all([serviceQuery, pmQuery])

  if (serviceResult.error) throw serviceResult.error
  if (pmResult.error) throw pmResult.error
  return (serviceResult.count ?? 0) + (pmResult.count ?? 0)
}

// --- Get service ticket counts by status (dashboard) ---
// Uses one count:'exact', head:true query per active status, parallelized.
// Replaces the previous .select('status') + JS aggregation antipattern that
// fetched every active service_tickets row to count them.

const ACTIVE_SERVICE_STATUSES = ['open', 'estimated', 'approved', 'in_progress', 'completed'] as const

export async function getServiceTicketCounts(technicianId?: string): Promise<Record<string, number>> {
  const supabase = await createClient()

  const results = await Promise.all(
    ACTIVE_SERVICE_STATUSES.map((status) => {
      let q = supabase
        .from('service_tickets')
        .select('id', { count: 'exact', head: true })
        .eq('status', status)
        .is('deleted_at', null)
      if (technicianId) {
        q = q.eq('assigned_technician_id', technicianId)
      }
      return q
    })
  )

  const counts: Record<string, number> = {}
  for (let i = 0; i < ACTIVE_SERVICE_STATUSES.length; i++) {
    const r = results[i]
    if (r.error) throw r.error
    counts[ACTIVE_SERVICE_STATUSES[i]] = r.count ?? 0
  }
  return counts
}

// --- Completed-but-waiting-on-PO count (dashboard card) ---
// Completed tickets for PO-required customers that still have no customer PO on
// file — the same subset the Mark Billed gate blocks (needsPo in
// ServiceAwaitingInvoice.tsx). The inner customers join restricts the count to
// PO-required customers; po_number empty = null OR ''. Pass technicianId to scope
// to a single tech's completed tickets (the technician dashboard card).
export async function getPoNeededCount(technicianId?: string): Promise<number> {
  const supabase = await createClient()
  let q = supabase
    .from('service_tickets')
    .select('id, customers!inner(po_required)', { count: 'exact', head: true })
    .eq('status', 'completed')
    .eq('customers.po_required', true)
    .is('deleted_at', null)
    .or('po_number.is.null,po_number.eq.')
  if (technicianId) {
    q = q.eq('assigned_technician_id', technicianId)
  }
  const { count, error } = await q
  if (error) throw error
  return count ?? 0
}

// --- Waiting-on-PO worklist (PO collection tracking) ---
// The same subset as getPoNeededCount / the billing PO gate: completed tickets
// for PO-required customers with no customer PO yet. Adds the denormalized
// follow-up recency (po_last_contacted_at / po_last_method) so the worklist can
// show "N days since last contact · call". Ordered oldest-contact-first, with
// never-contacted rows surfaced first (nulls) — the most urgent to chase.

export type PoFollowUpQueueTicket = {
  id: string
  work_order_number: number | null
  completed_at: string | null
  billing_amount: number | null
  po_number: string | null
  po_last_contacted_at: string | null
  po_last_method: string | null
  equipment_make: string | null
  equipment_model: string | null
  customers: {
    name: string
    account_number: string | null
  } | null
  equipment: {
    make: string | null
    model: string | null
    serial_number: string | null
  } | null
  assigned_technician: { name: string } | null
}

export async function getPoFollowUpQueue(db?: DigestDb): Promise<PoFollowUpQueueTicket[]> {
  const supabase = db ?? (await createClient())

  const { data, error } = await supabase
    .from('service_tickets')
    .select(`
      id, work_order_number, completed_at, billing_amount, po_number,
      po_last_contacted_at, po_last_method, equipment_make, equipment_model,
      customers!inner ( name, account_number, po_required ),
      equipment ( make, model, serial_number ),
      assigned_technician:users!service_tickets_assigned_technician_id_fkey ( name )
    `)
    .eq('status', 'completed')
    .eq('customers.po_required', true)
    .is('deleted_at', null)
    .or('po_number.is.null,po_number.eq.')
    .order('po_last_contacted_at', { ascending: true, nullsFirst: true })

  if (error) throw error
  return (data ?? []) as unknown as PoFollowUpQueueTicket[]
}

// --- Bulk assign a technician to service tickets ---
// Parity with PM's bulkAssignTechnician (src/lib/db/tickets.ts), but service
// tickets have no 'assigned'/'unassigned' status, so only the technician is
// set — the workflow status is left untouched. Skips soft-deleted rows.
export async function bulkAssignServiceTechnician(
  ticketIds: string[],
  technicianId: string
): Promise<ServiceTicketRow[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('service_tickets')
    .update({ assigned_technician_id: technicianId })
    .in('id', ticketIds)
    .is('deleted_at', null)
    .select()

  if (error) throw error
  return data as ServiceTicketRow[]
}
