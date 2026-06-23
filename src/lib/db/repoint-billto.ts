import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

export type RepointKind = 'service' | 'pm'

export type RepointResult =
  | { ok: true; clearedShipTo: boolean; changed: boolean }
  | { ok: false; status: number; error: string }

const TABLE: Record<RepointKind, 'service_tickets' | 'pm_tickets'> = {
  service: 'service_tickets',
  pm: 'pm_tickets',
}

type RepointTicketRow = {
  customer_id: number | null
  synergy_order_number: string | null
  synergy_invoice_number: string | null
  ship_to_location_id: number | null
  equipment_id: string | null
  equipment: { customer_id: number | null } | null
}

/**
 * Safely repoint a single ticket's bill-to account (`customer_id`). Shared by the
 * manager-only single-ticket control and the equipment-reassignment bulk
 * propagation, so the same guards apply on every path.
 *
 * Rules (confirmed 2026-06-23):
 * - target customer must exist and be active.
 * - HARD BLOCK if the ticket already carries a Synergy order # or invoice #: it's
 *   already keyed in Synergy, and repointing would desync CallBoard from the ERP.
 *   Those stay a Synergy/DB-level fix.
 * - equipment-link consistency: if the ticket is linked to a machine, the target
 *   account must own that machine (otherwise the ticket and its equipment would
 *   bill to different accounts). Inline / equipment-less tickets accept any
 *   active account.
 * - clears an orphaned `ship_to_location_id` — the old ship-to belonged to the
 *   previous account (mirrors the equipment PATCH route's orphaned-ship-to clear).
 *
 * Caller supplies an authenticated supabase client; this helper does no auth of
 * its own (the endpoints gate on RESET_ROLES first).
 */
export async function repointTicketBillTo(
  supabase: SupabaseClient<Database>,
  { kind, ticketId, customerId }: { kind: RepointKind; ticketId: string; customerId: number }
): Promise<RepointResult> {
  if (!Number.isInteger(customerId) || customerId <= 0) {
    return { ok: false, status: 400, error: 'A valid bill-to account is required.' }
  }

  const table = TABLE[kind]

  const { data: rawTicket, error: ticketErr } = await supabase
    .from(table)
    .select(
      'customer_id, synergy_order_number, synergy_invoice_number, ship_to_location_id, equipment_id, equipment(customer_id)'
    )
    .eq('id', ticketId)
    .is('deleted_at', null)
    .maybeSingle()

  if (ticketErr || !rawTicket) {
    return { ok: false, status: 404, error: 'Ticket not found.' }
  }
  const ticket = rawTicket as unknown as RepointTicketRow

  // Hard guard: a ticket already keyed in Synergy can't be repointed in-app.
  if (ticket.synergy_order_number || ticket.synergy_invoice_number) {
    return {
      ok: false,
      status: 409,
      error:
        'This ticket already has a Synergy order or invoice number, so its bill-to must be corrected in Synergy directly.',
    }
  }

  // Target account must exist and be active.
  const { data: cust } = await supabase
    .from('customers')
    .select('id, active')
    .eq('id', customerId)
    .maybeSingle()
  if (!cust || cust.active === false) {
    return { ok: false, status: 422, error: 'Selected bill-to account was not found or is inactive.' }
  }

  // Equipment-link consistency: a linked machine must belong to the target account.
  if (ticket.equipment_id && ticket.equipment && ticket.equipment.customer_id !== customerId) {
    return {
      ok: false,
      status: 422,
      error:
        "The ticket's linked equipment bills to a different account — reassign the equipment first, or pick the equipment's account.",
    }
  }

  // Already on the target account — nothing to do.
  if (ticket.customer_id === customerId) {
    return { ok: true, clearedShipTo: false, changed: false }
  }

  // Orphaned ship-to: the old ship-to belonged to the previous account. Keep it
  // only if it happens to belong to the new account too.
  let clearShipTo = false
  if (ticket.ship_to_location_id != null) {
    const { data: shipTo } = await supabase
      .from('ship_to_locations')
      .select('customer_id')
      .eq('id', ticket.ship_to_location_id)
      .maybeSingle()
    if (!shipTo || shipTo.customer_id !== customerId) clearShipTo = true
  }

  const update: Record<string, unknown> = { customer_id: customerId }
  if (clearShipTo) update.ship_to_location_id = null

  const { error: updErr } = await supabase
    .from(table)
    .update(update)
    .eq('id', ticketId)
    .is('deleted_at', null)

  if (updErr) {
    console.error(`repointTicketBillTo: ${table} update failed`, updErr)
    return { ok: false, status: 500, error: 'Failed to update ticket bill-to.' }
  }

  return { ok: true, clearedShipTo: clearShipTo, changed: true }
}
