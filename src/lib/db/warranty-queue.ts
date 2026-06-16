import { createClient } from '@/lib/supabase/server'

// The vendor-credit worklist for warranty repairs. A warranty/partial-warranty
// ticket isn't billed when the work is done — the branch files a claim with the
// vendor and waits for the credit that offsets covered parts. This queue keeps
// each claim moving through that lifecycle so nothing stalls between "work done"
// and "credit received". Built from service_tickets where the work is complete
// (status = 'completed') and the unit is warranty; a ticket leaves the queue once
// it's billed (which the credit gate only allows after the credit is logged).
// Mirrors declined-queue.ts / estimate-queue.ts.

export type WarrantyBucket = 'to_file' | 'awaiting_credit' | 'received'

export type WarrantyQueueRow = {
  id: string
  work_order_number: number | null
  customer_name: string
  equipment_label: string
  serial_number: string | null
  billing_type: string
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
}

function firstNonEmpty(...vals: (string | null | undefined)[]): string | null {
  for (const v of vals) {
    const t = v?.trim()
    if (t) return t
  }
  return null
}

function bucketOf(r: RawRow): WarrantyBucket {
  if (r.warranty_credit_received_at) return 'received'
  if (r.warranty_claim_submitted_at) return 'awaiting_credit'
  return 'to_file'
}

const SELECT = `id, work_order_number, status, billing_type, completed_at,
   warranty_vendor, warranty_claim_number, warranty_claim_submitted_at,
   warranty_credit_expected, warranty_credit_received_at, warranty_credit_amount,
   assigned_technician_id,
   equipment_make, equipment_model, equipment_serial_number,
   customers(name),
   equipment(make, model, serial_number)`

export async function getWarrantyQueue(): Promise<WarrantyQueueRow[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('service_tickets')
    .select(SELECT)
    .in('billing_type', ['warranty', 'partial_warranty'])
    .eq('status', 'completed')
    .is('deleted_at', null)
    .order('completed_at', { ascending: true, nullsFirst: true })

  if (error) throw error
  const rows = (data ?? []) as unknown as RawRow[]
  if (rows.length === 0) return []

  // Resolve the assigned tech's name (JS join — service_tickets has several FKs
  // to users, so a PostgREST embed is ambiguous).
  const techIds = [...new Set(rows.map((r) => r.assigned_technician_id).filter((v): v is string => !!v))]
  const techNameById = new Map<string, string | null>()
  if (techIds.length > 0) {
    const { data: techs } = await supabase.from('users').select('id, name').in('id', techIds)
    for (const u of (techs ?? []) as { id: string; name: string | null }[]) {
      techNameById.set(u.id, u.name)
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
        ? techNameById.get(r.assigned_technician_id) ?? null
        : null,
    }
  })
}

export type WarrantyClaimCounts = {
  toFile: number
  awaitingCredit: number
  received: number
  // Actionable = the claims still needing office work (file or chase the credit).
  actionable: number
}

// Lightweight counts for the dashboard card (avoids loading the full queue).
export async function getWarrantyClaimCounts(): Promise<WarrantyClaimCounts> {
  const supabase = await createClient()

  const base = () =>
    supabase
      .from('service_tickets')
      .select('id', { count: 'exact', head: true })
      .in('billing_type', ['warranty', 'partial_warranty'])
      .eq('status', 'completed')
      .is('deleted_at', null)

  const [toFileRes, awaitingRes, receivedRes] = await Promise.all([
    base().is('warranty_claim_submitted_at', null).is('warranty_credit_received_at', null),
    base().not('warranty_claim_submitted_at', 'is', null).is('warranty_credit_received_at', null),
    base().not('warranty_credit_received_at', 'is', null),
  ])

  const toFile = toFileRes.count ?? 0
  const awaitingCredit = awaitingRes.count ?? 0
  const received = receivedRes.count ?? 0

  return { toFile, awaitingCredit, received, actionable: toFile + awaitingCredit }
}
