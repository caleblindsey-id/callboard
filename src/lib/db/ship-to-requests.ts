import { createClient } from '@/lib/supabase/server'
import type { DigestDb } from '@/lib/digest/types'
import type { ShipToRequestRow, ShipToRequestStatus } from '@/types/database'

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
