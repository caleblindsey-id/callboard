import { createClient } from '@/lib/supabase/server'
import type { DigestDb } from '@/lib/digest/types'
import { bucketOf, type WarrantyBucket, type WarrantyReviewStatus } from '@/lib/service-tickets/warranty'
import type { ServiceTicketStatus } from '@/types/service-tickets'

export type { WarrantyBucket } from '@/lib/service-tickets/warranty'

// The warranty worklist. Review moves from a pricing switch (billing_type) to
// a review -> claim -> reconcile lifecycle (migration 160): the office
// verifies coverage while the work is still active (to_review), then the
// claim moves through file -> credit once the ticket completes. Built from
// service_tickets by warranty_review_status + status, not billing_type — see
// src/lib/service-tickets/warranty.ts for the shared bucketOf/gate logic.
// Mirrors declined-queue.ts / estimate-queue.ts.

// Active statuses a pending review can ride alongside while work continues.
const ACTIVE_REVIEW_STATUSES: ServiceTicketStatus[] = [
  'open',
  'estimated',
  'approved',
  'in_progress',
  'completed',
]

export type WarrantyQueueRow = {
  id: string
  work_order_number: number | null
  customer_name: string
  equipment_label: string
  serial_number: string | null
  billing_type: string
  // The ticket's own lifecycle status. Distinct from `bucket`: a to_review row
  // can sit at any active status (open/estimated/approved/in_progress/completed)
  // while its coverage is still undecided, so the queue card needs both.
  status: string
  bucket: WarrantyBucket
  completed_at: string | null
  days_since_completed: number | null
  warranty_vendor: string | null
  warranty_claim_number: string | null
  warranty_claim_submitted_at: string | null
  days_since_submitted: number | null
  warranty_credit_expected: number | null
  warranty_credit_received_at: string | null
  warranty_credit_amount: number | null
  technician_name: string | null
  warranty_review_status: WarrantyReviewStatus | null
  warranty_review_note: string | null
  warranty_review_requested_at: string | null
  requested_by_name: string | null
  warranty_labor_covered: boolean
  days_since_requested: number | null
}

type RawRow = {
  id: string
  work_order_number: number | null
  status: string
  billing_type: string
  completed_at: string | null
  warranty_vendor: string | null
  warranty_claim_number: string | null
  warranty_claim_submitted_at: string | null
  warranty_credit_expected: number | null
  warranty_credit_received_at: string | null
  warranty_credit_amount: number | null
  assigned_technician_id: string | null
  equipment_make: string | null
  equipment_model: string | null
  equipment_serial_number: string | null
  customers: { name: string | null } | null
  equipment: { make: string | null; model: string | null; serial_number: string | null } | null
  warranty_review_status: WarrantyReviewStatus | null
  warranty_review_note: string | null
  warranty_review_requested_at: string | null
  warranty_review_requested_by_id: string | null
  warranty_labor_covered: boolean | null
}

function firstNonEmpty(...vals: (string | null | undefined)[]): string | null {
  for (const v of vals) {
    const t = v?.trim()
    if (t) return t
  }
  return null
}

const SELECT = `id, work_order_number, status, billing_type, completed_at,
   warranty_vendor, warranty_claim_number, warranty_claim_submitted_at,
   warranty_credit_expected, warranty_credit_received_at, warranty_credit_amount,
   assigned_technician_id,
   equipment_make, equipment_model, equipment_serial_number,
   customers(name),
   equipment(make, model, serial_number),
   warranty_review_status, warranty_review_note, warranty_review_requested_at,
   warranty_review_requested_by_id, warranty_labor_covered`

export async function getWarrantyQueue(db?: DigestDb): Promise<WarrantyQueueRow[]> {
  const supabase = db ?? (await createClient())

  // Three legs, matching the 5 buckets bucketOf() sorts rows into:
  //  - a pending review (warranty_review_status='requested') rides the queue
  //    at any active status, so the office can verify coverage while the
  //    work is still happening, not just after it completes;
  //  - a verified review enters at completion (to_file/awaiting_credit/received);
  //  - PLUS the anomaly: a verified ticket already billed to the customer with
  //    no vendor claim ever filed (billed_unclaimed). Gating on status alone
  //    hid those entirely, and they are the worst case the queue exists to
  //    catch, because the revenue is already recognised and the offsetting
  //    credit never will be.
  //
  // The billed leg MUST stay server-side. Selecting all billed warranty
  // tickets and dropping the claimed ones in JS would pull every historical
  // warranty ticket the branch has ever invoiced. billing_type is no longer
  // part of membership — the 160 backfill makes it redundant.
  const membershipFilter =
    `and(warranty_review_status.eq.requested,status.in.(${ACTIVE_REVIEW_STATUSES.join(',')})),` +
    `and(warranty_review_status.eq.verified,status.eq.completed),` +
    `and(warranty_review_status.eq.verified,status.eq.billed,warranty_claim_submitted_at.is.null)`

  const { data, error } = await supabase
    .from('service_tickets')
    .select(SELECT)
    .or(membershipFilter)
    .is('deleted_at', null)
    .order('completed_at', { ascending: true, nullsFirst: true })

  if (error) throw error
  const rows = (data ?? []) as unknown as RawRow[]
  if (rows.length === 0) return []

  // Resolve the assigned tech's and requesting user's names (JS join —
  // service_tickets has several FKs to users, so a PostgREST embed is
  // ambiguous).
  const userIds = [
    ...new Set(
      rows
        .flatMap((r) => [r.assigned_technician_id, r.warranty_review_requested_by_id])
        .filter((v): v is string => !!v)
    ),
  ]
  const nameById = new Map<string, string | null>()
  if (userIds.length > 0) {
    const { data: users } = await supabase.from('users').select('id, name').in('id', userIds)
    for (const u of (users ?? []) as { id: string; name: string | null }[]) {
      nameById.set(u.id, u.name)
    }
  }

  const now = Date.now()
  const daysSince = (iso: string | null): number | null =>
    iso ? Math.floor((now - new Date(iso).getTime()) / 86_400_000) : null

  return rows.map((r) => {
    const make = firstNonEmpty(r.equipment?.make, r.equipment_make)
    const model = firstNonEmpty(r.equipment?.model, r.equipment_model)
    const equipment_label = firstNonEmpty([make, model].filter(Boolean).join(' '), 'Equipment') ?? 'Equipment'

    return {
      id: r.id,
      work_order_number: r.work_order_number,
      customer_name: r.customers?.name ?? 'Unknown customer',
      equipment_label,
      serial_number: firstNonEmpty(r.equipment?.serial_number, r.equipment_serial_number),
      billing_type: r.billing_type,
      status: r.status,
      bucket: bucketOf(r),
      completed_at: r.completed_at,
      days_since_completed: daysSince(r.completed_at),
      warranty_vendor: r.warranty_vendor,
      warranty_claim_number: r.warranty_claim_number,
      warranty_claim_submitted_at: r.warranty_claim_submitted_at,
      days_since_submitted: daysSince(r.warranty_claim_submitted_at),
      warranty_credit_expected: r.warranty_credit_expected,
      warranty_credit_received_at: r.warranty_credit_received_at,
      warranty_credit_amount: r.warranty_credit_amount,
      technician_name: r.assigned_technician_id
        ? nameById.get(r.assigned_technician_id) ?? null
        : null,
      warranty_review_status: r.warranty_review_status,
      warranty_review_note: r.warranty_review_note,
      warranty_review_requested_at: r.warranty_review_requested_at,
      requested_by_name: r.warranty_review_requested_by_id
        ? nameById.get(r.warranty_review_requested_by_id) ?? null
        : null,
      warranty_labor_covered: r.warranty_labor_covered ?? false,
      days_since_requested: daysSince(r.warranty_review_requested_at),
    }
  })
}

export type WarrantyClaimCounts = {
  // Coverage still undecided. Rides alongside the ticket's normal active work.
  toReview: number
  toFile: number
  awaitingCredit: number
  received: number
  // Billed to the customer with no vendor claim ever filed. Not part of the
  // normal lifecycle; each one is lost credit until someone chases it.
  billedUnclaimed: number
  // Actionable = the claims still needing office work (verify coverage, file,
  // chase the credit, or recover a credit that was never claimed before billing).
  actionable: number
}

// Lightweight counts for the dashboard card (avoids loading the full queue).
export async function getWarrantyClaimCounts(): Promise<WarrantyClaimCounts> {
  const supabase = await createClient()

  // Re-keyed off warranty_review_status (migration 160) so these counts match
  // the queue's own membership exactly — billing_type is no longer read here.
  const base = (status: 'completed' | 'billed') =>
    supabase
      .from('service_tickets')
      .select('id', { count: 'exact', head: true })
      .eq('warranty_review_status', 'verified')
      .eq('status', status)
      .is('deleted_at', null)

  const [toReviewRes, toFileRes, awaitingRes, receivedRes, billedUnclaimedRes] = await Promise.all([
    supabase
      .from('service_tickets')
      .select('id', { count: 'exact', head: true })
      .eq('warranty_review_status', 'requested')
      .in('status', ACTIVE_REVIEW_STATUSES)
      .is('deleted_at', null),
    base('completed').is('warranty_claim_submitted_at', null).is('warranty_credit_received_at', null),
    base('completed').not('warranty_claim_submitted_at', 'is', null).is('warranty_credit_received_at', null),
    base('completed').not('warranty_credit_received_at', 'is', null),
    base('billed').is('warranty_claim_submitted_at', null),
  ])

  const toReview = toReviewRes.count ?? 0
  const toFile = toFileRes.count ?? 0
  const awaitingCredit = awaitingRes.count ?? 0
  const received = receivedRes.count ?? 0
  const billedUnclaimed = billedUnclaimedRes.count ?? 0

  return {
    toReview,
    toFile,
    awaitingCredit,
    received,
    billedUnclaimed,
    actionable: toReview + toFile + awaitingCredit + billedUnclaimed,
  }
}
