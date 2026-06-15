import { createClient } from '@/lib/supabase/server'

// A service estimate awaiting a customer decision — a ticket in the 'estimated'
// state that hasn't yet been approved/declined. The office works this queue to
// (1) make first contact (email the approval link or log a call) and (2) follow
// up until the customer approves or declines. Built from service_tickets where
// status = 'estimated' AND deleted_at IS NULL. Mirrors pickup-queue.ts.

export type EstimateContactStatus = 'emailed' | 'called' | 'needs_first_contact'

export type EstimateQueueRow = {
  id: string
  work_order_number: number | null
  customer_name: string
  equipment_label: string
  serial_number: string | null
  estimated_at: string | null
  days_since_estimate: number | null
  estimate_amount: number | null
  resolved_email: string | null
  resolved_phone: string | null
  contact_status: EstimateContactStatus
  estimate_emailed_at: string | null
  estimate_last_emailed_at: string | null
  estimate_notify_count: number
  estimate_called_at: string | null
  estimate_called_by_name: string | null
  estimate_contact_notes: string | null
}

type RawRow = {
  id: string
  work_order_number: number | null
  customer_id: number
  status: string
  estimated_at: string | null
  estimate_amount: number | null
  contact_email: string | null
  contact_phone: string | null
  estimate_emailed_at: string | null
  estimate_last_emailed_at: string | null
  estimate_notify_count: number | null
  estimate_called_at: string | null
  estimate_called_by_id: string | null
  estimate_contact_notes: string | null
  equipment_make: string | null
  equipment_model: string | null
  equipment_serial_number: string | null
  customers: { name: string | null } | null
  equipment: {
    make: string | null
    model: string | null
    serial_number: string | null
    contact_email: string | null
    contact_phone: string | null
  } | null
}

function firstNonEmpty(...vals: (string | null | undefined)[]): string | null {
  for (const v of vals) {
    const t = v?.trim()
    if (t) return t
  }
  return null
}

export async function getEstimateQueue(): Promise<EstimateQueueRow[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('service_tickets')
    .select(
      `id, work_order_number, customer_id, status, estimated_at, estimate_amount,
       contact_email, contact_phone,
       estimate_emailed_at, estimate_last_emailed_at, estimate_notify_count,
       estimate_called_at, estimate_called_by_id, estimate_contact_notes,
       equipment_make, equipment_model, equipment_serial_number,
       customers(name),
       equipment(make, model, serial_number, contact_email, contact_phone)`
    )
    .eq('status', 'estimated')
    .is('deleted_at', null)
    .order('estimated_at', { ascending: true, nullsFirst: true })

  if (error) throw error
  const rows = (data ?? []) as unknown as RawRow[]
  if (rows.length === 0) return []

  // Resolve the customer's primary contact (email/phone) in one batched query —
  // service_tickets has no FK to contacts, so we join in JS by customer_id.
  const customerIds = [...new Set(rows.map((r) => r.customer_id))]
  const { data: contactsData } = await supabase
    .from('contacts')
    .select('customer_id, email, phone, is_primary')
    .in('customer_id', customerIds)
    .eq('is_primary', true)

  const primaryByCustomer = new Map<number, { email: string | null; phone: string | null }>()
  for (const c of (contactsData ?? []) as { customer_id: number; email: string | null; phone: string | null }[]) {
    if (!primaryByCustomer.has(c.customer_id)) {
      primaryByCustomer.set(c.customer_id, { email: c.email, phone: c.phone })
    }
  }

  // Resolve who logged each call (JS join, not a PostgREST embed — service_tickets
  // has several FKs to users).
  const callerIds = [...new Set(rows.map((r) => r.estimate_called_by_id).filter((v): v is string => !!v))]
  const callerNameById = new Map<string, string | null>()
  if (callerIds.length > 0) {
    const { data: callers } = await supabase.from('users').select('id, name').in('id', callerIds)
    for (const u of (callers ?? []) as { id: string; name: string | null }[]) {
      callerNameById.set(u.id, u.name)
    }
  }

  const now = Date.now()

  return rows.map((r) => {
    const primary = primaryByCustomer.get(r.customer_id)
    const resolved_email = firstNonEmpty(r.contact_email, r.equipment?.contact_email, primary?.email)
    const resolved_phone = firstNonEmpty(r.contact_phone, r.equipment?.contact_phone, primary?.phone)

    // First contact = an email was sent OR a call was logged. Either clears the
    // needs-first-contact flag.
    let contact_status: EstimateContactStatus
    if (r.estimate_emailed_at) contact_status = 'emailed'
    else if (r.estimate_called_at) contact_status = 'called'
    else contact_status = 'needs_first_contact'

    const days_since_estimate = r.estimated_at
      ? Math.floor((now - new Date(r.estimated_at).getTime()) / 86_400_000)
      : null

    const make = firstNonEmpty(r.equipment?.make, r.equipment_make)
    const model = firstNonEmpty(r.equipment?.model, r.equipment_model)
    const equipment_label = firstNonEmpty([make, model].filter(Boolean).join(' '), 'Equipment') ?? 'Equipment'

    return {
      id: r.id,
      work_order_number: r.work_order_number,
      customer_name: r.customers?.name ?? 'Unknown customer',
      equipment_label,
      serial_number: firstNonEmpty(r.equipment?.serial_number, r.equipment_serial_number),
      estimated_at: r.estimated_at,
      days_since_estimate,
      estimate_amount: r.estimate_amount,
      resolved_email,
      resolved_phone,
      contact_status,
      estimate_emailed_at: r.estimate_emailed_at,
      estimate_last_emailed_at: r.estimate_last_emailed_at,
      estimate_notify_count: r.estimate_notify_count ?? 0,
      estimate_called_at: r.estimate_called_at,
      estimate_called_by_name: r.estimate_called_by_id ? callerNameById.get(r.estimate_called_by_id) ?? null : null,
      estimate_contact_notes: r.estimate_contact_notes,
    }
  })
}

export type PendingEstimateCounts = {
  total: number
  needsFirstContact: number
}

// Lightweight counts for the dashboard card (avoids loading the full queue).
export async function getPendingEstimateCounts(): Promise<PendingEstimateCounts> {
  const supabase = await createClient()

  const totalQuery = supabase
    .from('service_tickets')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'estimated')
    .is('deleted_at', null)

  const needsContactQuery = supabase
    .from('service_tickets')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'estimated')
    .is('deleted_at', null)
    .is('estimate_emailed_at', null)
    .is('estimate_called_at', null)

  const [{ count: total }, { count: needsFirstContact }] = await Promise.all([totalQuery, needsContactQuery])

  return { total: total ?? 0, needsFirstContact: needsFirstContact ?? 0 }
}
