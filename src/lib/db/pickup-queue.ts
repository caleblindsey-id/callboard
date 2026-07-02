import { createClient } from '@/lib/supabase/server'

// A unit that's been repaired + invoiced and is physically waiting in the shop
// for the customer to collect. Built from service_tickets where
// awaiting_pickup = true AND picked_up_at IS NULL.

export type PickupContactStatus = 'emailed' | 'called' | 'has_contact' | 'no_contact'

export type PickupQueueRow = {
  id: string
  work_order_number: number | null
  customer_name: string
  equipment_label: string
  serial_number: string | null
  shop_location: string | null
  ready_for_pickup_at: string | null
  days_ready: number | null
  resolved_email: string | null
  resolved_phone: string | null
  contact_status: PickupContactStatus
  pickup_notify_count: number
  pickup_called_at: string | null
  pickup_called_by_name: string | null
  pickup_call_notes: string | null
  abandonment_notice_sent_at: string | null
  // false → the estimate was declined and the unfixed unit is waiting to be
  // collected; true → the unit was repaired + invoiced (status 'billed').
  repaired: boolean
}

type RawRow = {
  id: string
  work_order_number: number | null
  customer_id: number
  status: string
  ready_for_pickup_at: string | null
  shop_location: string | null
  contact_email: string | null
  contact_phone: string | null
  pickup_notified_at: string | null
  pickup_notify_count: number | null
  pickup_called_at: string | null
  pickup_call_notes: string | null
  pickup_called_by_id: string | null
  abandonment_notice_sent_at: string | null
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

export async function getPickupQueue(): Promise<PickupQueueRow[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('service_tickets')
    .select(
      `id, work_order_number, customer_id, status, ready_for_pickup_at, shop_location,
       contact_email, contact_phone, pickup_notified_at, pickup_notify_count,
       pickup_called_at, pickup_call_notes, pickup_called_by_id, abandonment_notice_sent_at,
       equipment_make, equipment_model, equipment_serial_number,
       customers(name),
       equipment(make, model, serial_number, contact_email, contact_phone)`
    )
    .eq('awaiting_pickup', true)
    .is('picked_up_at', null)
    .is('deleted_at', null)
    .order('ready_for_pickup_at', { ascending: true, nullsFirst: false })

  if (error) throw error
  const rows = (data ?? []) as unknown as RawRow[]
  if (rows.length === 0) return []

  // Resolve the customer's primary contact (email/phone) and who logged each call.
  // service_tickets has no FK to contacts and several FKs to users, so we join in
  // JS. Both lookups derive from `rows` but not from each other, so fetch them in
  // one parallel tier instead of two sequential round-trips.
  const customerIds = [...new Set(rows.map((r) => r.customer_id))]
  const callerIds = [...new Set(rows.map((r) => r.pickup_called_by_id).filter((v): v is string => !!v))]
  const [{ data: contactsData }, { data: callers }] = await Promise.all([
    supabase
      .from('contacts')
      .select('customer_id, email, phone, is_primary')
      .in('customer_id', customerIds)
      .eq('is_primary', true),
    callerIds.length > 0
      ? supabase.from('users').select('id, name').in('id', callerIds)
      : Promise.resolve({ data: [] as { id: string; name: string | null }[] }),
  ])

  const primaryByCustomer = new Map<number, { email: string | null; phone: string | null }>()
  for (const c of (contactsData ?? []) as { customer_id: number; email: string | null; phone: string | null }[]) {
    if (!primaryByCustomer.has(c.customer_id)) {
      primaryByCustomer.set(c.customer_id, { email: c.email, phone: c.phone })
    }
  }

  const callerNameById = new Map<string, string | null>()
  for (const u of (callers ?? []) as { id: string; name: string | null }[]) {
    callerNameById.set(u.id, u.name)
  }

  const now = Date.now()

  return rows.map((r) => {
    const primary = primaryByCustomer.get(r.customer_id)
    const resolved_email = firstNonEmpty(r.contact_email, r.equipment?.contact_email, primary?.email)
    const resolved_phone = firstNonEmpty(r.contact_phone, r.equipment?.contact_phone, primary?.phone)

    let contact_status: PickupContactStatus
    if (r.pickup_notified_at) contact_status = 'emailed'
    else if (r.pickup_called_at) contact_status = 'called'
    else if (resolved_email) contact_status = 'has_contact'
    else contact_status = 'no_contact'

    const days_ready = r.ready_for_pickup_at
      ? Math.floor((now - new Date(r.ready_for_pickup_at).getTime()) / 86_400_000)
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
      shop_location: r.shop_location,
      ready_for_pickup_at: r.ready_for_pickup_at,
      days_ready,
      resolved_email,
      resolved_phone,
      contact_status,
      pickup_notify_count: r.pickup_notify_count ?? 0,
      pickup_called_at: r.pickup_called_at,
      pickup_called_by_name: r.pickup_called_by_id ? callerNameById.get(r.pickup_called_by_id) ?? null : null,
      pickup_call_notes: r.pickup_call_notes,
      abandonment_notice_sent_at: r.abandonment_notice_sent_at,
      repaired: r.status === 'billed',
    }
  })
}
