import { createClient } from '@/lib/supabase/server'
import type { DigestDb } from '@/lib/digest/types'
import type { ShipToLocationRow, ShipToRequestRow, ShipToRequestStatus } from '@/types/database'

// Ship-to requests are raised by techs and coordinators when a delivery address
// is missing from Synergy. The office adds the address there, then resolves the
// request here.
//
// This query used to live inline in the GET handler of
// src/app/api/ship-to-requests/route.ts. It moved here so the morning digest
// reads the same definition the queue does instead of re-deriving it, which is
// the drift this port exists to end. The shape is unchanged: `select('*')` plus
// the same three joins, ordered newest first, so the route's JSON contract is
// byte-identical to what it returned before.

export type ShipToRequestWithJoins = ShipToRequestRow & {
  customer: { id: number; name: string | null } | null
  requested_by_user: { name: string | null } | null
  equipment: { id: string; make: string | null; model: string | null; serial_number: string | null } | null
}

export async function getShipToRequestsByStatus(
  status: ShipToRequestStatus,
  db?: DigestDb
): Promise<ShipToRequestWithJoins[]> {
  const supabase = db ?? (await createClient())

  const { data, error } = await supabase
    .from('ship_to_requests')
    .select(`
      *,
      customer:customers(id, name),
      requested_by_user:users!requested_by(name),
      equipment(id, make, model, serial_number)
    `)
    .eq('status', status)
    .order('requested_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as unknown as ShipToRequestWithJoins[]
}

export function getPendingShipToRequests(db?: DigestDb): Promise<ShipToRequestWithJoins[]> {
  return getShipToRequestsByStatus('pending', db)
}

// Dashboard alert tile. Head-only count, mirroring getPendingSupplyRequestCount.
export async function getPendingShipToRequestCount(db?: DigestDb): Promise<number> {
  const supabase = db ?? (await createClient())
  const { count, error } = await supabase
    .from('ship_to_requests')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')
  if (error) throw error
  return count ?? 0
}

/**
 * Existing ship-tos for the customers that have a pending request, so the queue
 * can suggest a location the tech simply could not find. Two of the fourteen rows
 * pending on 2026-08-24 were already synced under a business name that looks
 * nothing like the address the tech typed. See src/lib/ship-to-requests/match.ts.
 *
 * One query for the whole page rather than one per card.
 */
export async function getShipToLocationsForCustomers(
  customerIds: number[],
  db?: DigestDb
): Promise<ShipToLocationRow[]> {
  const ids = [...new Set(customerIds)]
  if (ids.length === 0) return []

  const supabase = db ?? (await createClient())
  const { data, error } = await supabase
    .from('ship_to_locations')
    .select('*')
    .in('customer_id', ids)
    .order('name')

  if (error) throw error
  return (data ?? []) as ShipToLocationRow[]
}

/**
 * Specific locations by id, for showing what a resolved request was linked to.
 *
 * Kept separate from getShipToLocationsForCustomers because that one pulls EVERY
 * location for a customer (one account in the live data has 58) to feed match
 * scoring. The resolved tab only needs the handful actually linked, so it asks by
 * id and stays bounded as the resolved history grows.
 */
export async function getShipToLocationsByIds(
  ids: number[],
  db?: DigestDb
): Promise<ShipToLocationRow[]> {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return []

  const supabase = db ?? (await createClient())
  const { data, error } = await supabase
    .from('ship_to_locations')
    .select('*')
    .in('id', unique)

  if (error) throw error
  return (data ?? []) as ShipToLocationRow[]
}
