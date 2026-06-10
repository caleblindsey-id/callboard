import { createClient } from '@/lib/supabase/server'
import type { PartRequest, PartsQueueRow, PartsQueueSource } from '@/types/database'

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
  pulled_at, pulled_by
`

export async function getPartsQueue(): Promise<PartsQueueRow[]> {
  const supabase = await createClient()
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
      .not('status', 'in', '("billed","declined","canceled")'),
  ])

  if (pmResult.error) throw pmResult.error
  if (serviceResult.error) throw serviceResult.error

  return [
    ...flattenParts((pmResult.data ?? []) as unknown as TicketPartsRow[], 'pm'),
    ...flattenParts((serviceResult.data ?? []) as unknown as TicketPartsRow[], 'service'),
  ]
}
