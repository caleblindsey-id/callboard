import { createClient } from '@/lib/supabase/server'

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

/**
 * Build a loaded-cost lookup for the given part lines, keyed by
 * synergy_product_id (the integer form of products.synergy_id that part lines
 * store). Used to enforce the service-ticket margin floor with
 * server-authoritative cost — never trust a client-supplied unit_cost.
 *
 * A product that isn't found, or whose unit_cost hasn't synced yet, is simply
 * absent from the map (callers treat that as "cost unknown").
 */
export async function buildProductCostMap(
  supabase: SupabaseServerClient,
  synergyProductIds: Array<number | null | undefined>,
): Promise<Map<number, number | null>> {
  const ids = Array.from(
    new Set(synergyProductIds.filter((x): x is number => x != null && Number.isFinite(x))),
  )
  const map = new Map<number, number | null>()
  if (ids.length === 0) return map

  // products.synergy_id is VARCHAR; part lines store Number(synergy_id).
  // The app already relies on this round-trip elsewhere (see PartUsed).
  const { data } = await supabase
    .from('products')
    .select('synergy_id, unit_cost')
    .in('synergy_id', ids.map(String))

  for (const row of data ?? []) {
    map.set(Number(row.synergy_id), row.unit_cost == null ? null : Number(row.unit_cost))
  }
  return map
}
