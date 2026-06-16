import { createClient } from '@/lib/supabase/server'

// A declined service estimate the office still needs to act on — a ticket in the
// 'declined' state that a manager hasn't marked handled (decline_resolved_at IS
// NULL). The office works this queue to re-quote, call the customer back, or
// decide to let it go. Built from service_tickets where status = 'declined' AND
// deleted_at IS NULL. Mirrors estimate-queue.ts (the pending-estimate sibling).

export type DeclinedQueueRow = {
  id: string
  work_order_number: number | null
  customer_name: string
  equipment_label: string
  serial_number: string | null
  declined_at: string | null
  days_since_declined: number | null
  estimate_amount: number | null
  decline_reason: string | null
  technician_name: string | null
}

type RawRow = {
  id: string
  work_order_number: number | null
  status: string
  declined_at: string | null
  estimate_amount: number | null
  decline_reason: string | null
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

export async function getDeclinedQueue(): Promise<DeclinedQueueRow[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('service_tickets')
    .select(
      `id, work_order_number, status, declined_at, estimate_amount, decline_reason,
       assigned_technician_id,
       equipment_make, equipment_model, equipment_serial_number,
       customers(name),
       equipment(make, model, serial_number)`
    )
    .eq('status', 'declined')
    .is('decline_resolved_at', null)
    .is('deleted_at', null)
    .order('declined_at', { ascending: true, nullsFirst: true })

  if (error) throw error
  const rows = (data ?? []) as unknown as RawRow[]
  if (rows.length === 0) return []

  // Resolve the assigned tech's name (JS join, not a PostgREST embed —
  // service_tickets has several FKs to users).
  const techIds = [...new Set(rows.map((r) => r.assigned_technician_id).filter((v): v is string => !!v))]
  const techNameById = new Map<string, string | null>()
  if (techIds.length > 0) {
    const { data: techs } = await supabase.from('users').select('id, name').in('id', techIds)
    for (const u of (techs ?? []) as { id: string; name: string | null }[]) {
      techNameById.set(u.id, u.name)
    }
  }

  const now = Date.now()

  return rows.map((r) => {
    const days_since_declined = r.declined_at
      ? Math.floor((now - new Date(r.declined_at).getTime()) / 86_400_000)
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
      declined_at: r.declined_at,
      days_since_declined,
      estimate_amount: r.estimate_amount,
      decline_reason: r.decline_reason,
      technician_name: r.assigned_technician_id
        ? techNameById.get(r.assigned_technician_id) ?? null
        : null,
    }
  })
}

export type DeclinedEstimateCounts = {
  total: number
}

// Lightweight count for the dashboard card (avoids loading the full queue).
export async function getDeclinedCounts(): Promise<DeclinedEstimateCounts> {
  const supabase = await createClient()

  const { count } = await supabase
    .from('service_tickets')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'declined')
    .is('decline_resolved_at', null)
    .is('deleted_at', null)

  return { total: count ?? 0 }
}
