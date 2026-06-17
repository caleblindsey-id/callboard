import { createClient } from '@/lib/supabase/server'
import type {
  SupplyCatalogRow,
  SupplyRequestItem,
  SupplyRequestRow,
  SupplyRequestStatus,
} from '@/types/database'

// Shop-supply requests: a tech asks the warehouse/office to pull general
// consumables (WD-40, gloves, wipers...). Standalone — not tied to a ticket.

// Active quick-pick catalog, shown on the tech request form.
export async function getSupplyCatalog(): Promise<SupplyCatalogRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('supply_catalog')
    .select('id, name, unit, sort_order, active, created_at, updated_at')
    .eq('active', true)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
  if (error) throw error
  return (data ?? []) as SupplyCatalogRow[]
}

// A single tech's own requests, newest first (for /my-supplies).
export async function getMySupplyRequests(userId: string): Promise<SupplyRequestRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('supply_requests')
    .select('*')
    .eq('requested_by', userId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as SupplyRequestRow[]
}

// Count of requests still waiting to be pulled — the office "Needs Attention"
// dashboard signal (the in-app bell is tech-only, so managers see it here).
export async function getPendingSupplyRequestCount(): Promise<number> {
  const supabase = await createClient()
  const { count, error } = await supabase
    .from('supply_requests')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')
  if (error) throw error
  return count ?? 0
}

// Domain row for the office worklist — flattened with the requester name and a
// couple of computed display fields, like PickupQueueRow.
export type SupplyRequestQueueRow = {
  id: string
  requester_name: string
  items: SupplyRequestItem[]
  item_count: number
  note: string | null
  status: SupplyRequestStatus
  denied_reason: string | null
  created_at: string
  ready_at: string | null
  picked_up_at: string | null
  age_days: number
}

type RawQueueRow = Omit<SupplyRequestRow, 'items'> & {
  items: SupplyRequestItem[] | null
  // Embed disambiguated by FK name (supply_requests has 4 FKs to users).
  requester: { name: string | null } | null
}

// Active requests plus recently picked-up/denied ones (last `recentDays`), so the
// office can see what just cleared. Newest pending first.
export async function getSupplyRequestQueue(recentDays = 14): Promise<SupplyRequestQueueRow[]> {
  const supabase = await createClient()
  const cutoff = new Date(Date.now() - recentDays * 86_400_000).toISOString()

  const { data, error } = await supabase
    .from('supply_requests')
    .select('*, requester:users!supply_requests_requested_by_fkey(name)')
    // Show everything still open, plus anything closed within the window.
    .or(`status.in.(pending,ready),updated_at.gte.${cutoff}`)
    .order('created_at', { ascending: true })

  if (error) throw error
  const rows = (data ?? []) as unknown as RawQueueRow[]
  const now = Date.now()

  return rows.map((r) => {
    const items = r.items ?? []
    return {
      id: r.id,
      requester_name: r.requester?.name ?? 'Unknown tech',
      items,
      item_count: items.reduce((sum, it) => sum + (Number(it.quantity) || 0), 0),
      note: r.note,
      status: r.status,
      denied_reason: r.denied_reason,
      created_at: r.created_at,
      ready_at: r.ready_at,
      picked_up_at: r.picked_up_at,
      age_days: Math.floor((now - new Date(r.created_at).getTime()) / 86_400_000),
    }
  })
}
