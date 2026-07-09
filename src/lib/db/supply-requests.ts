import { createClient } from '@/lib/supabase/server'
import type {
  SupplyCatalogRow,
  SupplyRequestItem,
  SupplyRequestRow,
  SupplyRequestStatus,
} from '@/types/database'
import { columnsOf } from '@/lib/db/columns'

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

// Full catalog incl. inactive items, for the Settings management UI.
export async function getAllSupplyCatalog(): Promise<SupplyCatalogRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('supply_catalog')
    .select('id, name, unit, sort_order, active, created_at, updated_at')
    .order('active', { ascending: false })
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
  if (error) throw error
  return (data ?? []) as SupplyCatalogRow[]
}

const SUPPLY_REQUEST_COLUMNS = columnsOf<SupplyRequestRow>()([
  'id', 'requested_by', 'items', 'note', 'status', 'denied_reason',
  'ready_at', 'ready_by', 'ready_notified_at', 'picked_up_at', 'picked_up_by',
  'denied_at', 'denied_by', 'created_at', 'updated_at',
])

// A single tech's own requests, newest first (for /my-supplies).
export async function getMySupplyRequests(userId: string): Promise<SupplyRequestRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('supply_requests')
    .select(SUPPLY_REQUEST_COLUMNS)
    .eq('requested_by', userId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as SupplyRequestRow[]
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
      // Denied lines won't be pulled, so they don't count toward the total.
      item_count: items.reduce((sum, it) => sum + (it.denied ? 0 : Number(it.quantity) || 0), 0),
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

// ---- Management report: what techs request and how often -------------------

export type SupplyReportItemRow = { name: string; unit: string | null; timesRequested: number; totalQty: number }
export type SupplyReportTechRow = { techName: string; requests: number; items: number; lastRequestedAt: string }
export type SupplyReportPeriodPoint = { label: string; count: number }

export type SupplyReport = {
  rangeLabel: string
  granularity: 'week' | 'month'
  kpis: {
    totalRequests: number
    totalItems: number
    activeTechs: number
    deniedCount: number
    // Per-line denials (feedback/office Edit flow) — deniedCount above only
    // counts whole-request denials, which undercounts real denial activity
    // that happened via a partial line-edit deny instead.
    deniedItemsCount: number
    fulfilledCount: number
  }
  byItem: SupplyReportItemRow[]
  byTech: SupplyReportTechRow[]
  byPeriod: SupplyReportPeriodPoint[]
}

type RawReportRow = {
  requested_by: string
  items: SupplyRequestItem[] | null
  status: SupplyRequestStatus
  created_at: string
  requester: { name: string | null } | null
}

// UTC week start (Monday) at midnight.
function weekStartUTC(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const dow = (x.getUTCDay() + 6) % 7 // Mon=0 … Sun=6
  x.setUTCDate(x.getUTCDate() - dow)
  return x
}
function monthStartUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
}
function weekLabel(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}
function monthLabel(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}

// sinceDays = null means all-time.
export async function getSupplyRequestReport(sinceDays: number | null): Promise<SupplyReport> {
  const supabase = await createClient()
  const nowMs = Date.now()
  const cutoffMs = sinceDays != null ? nowMs - sinceDays * 86_400_000 : null

  let query = supabase
    .from('supply_requests')
    .select('requested_by, items, status, created_at, requester:users!supply_requests_requested_by_fkey(name)')
    .order('created_at', { ascending: true })
  if (cutoffMs != null) query = query.gte('created_at', new Date(cutoffMs).toISOString())

  const { data, error } = await query
  if (error) throw error
  const rows = (data ?? []) as unknown as RawReportRow[]

  const rangeLabel =
    sinceDays == null ? 'All time' : sinceDays === 365 ? 'Last 12 months' : `Last ${sinceDays} days`
  const granularity: 'week' | 'month' = sinceDays != null && sinceDays <= 90 ? 'week' : 'month'

  // KPIs
  const techIds = new Set<string>()
  let totalItems = 0
  let deniedCount = 0
  let deniedItemsCount = 0
  let fulfilledCount = 0

  // Aggregators
  const itemMap = new Map<string, SupplyReportItemRow>()
  const techMap = new Map<string, SupplyReportTechRow>()
  const periodCounts = new Map<number, number>() // bucket-start ms → count

  for (const r of rows) {
    techIds.add(r.requested_by)
    if (r.status === 'denied') deniedCount++
    if (r.status === 'picked_up') fulfilledCount++

    const items = r.items ?? []
    // Denied lines aren't fulfilled — exclude them from volume aggregates the
    // same way the warehouse pull-list export does, and count them toward the
    // Denied KPI instead of silently vanishing.
    const activeItems = items.filter((it) => !it.denied)
    deniedItemsCount += items.length - activeItems.length

    const seenInThisRequest = new Set<string>()
    for (const it of activeItems) {
      const qty = Number(it.quantity) || 0
      totalItems += qty
      const key = it.name.trim().toLowerCase()
      if (!key) continue
      let row = itemMap.get(key)
      if (!row) {
        row = { name: it.name.trim(), unit: it.unit ?? null, timesRequested: 0, totalQty: 0 }
        itemMap.set(key, row)
      }
      row.totalQty += qty
      if (!seenInThisRequest.has(key)) {
        row.timesRequested++
        seenInThisRequest.add(key)
      }
    }

    // Per-tech
    const techName = r.requester?.name ?? 'Unknown tech'
    let t = techMap.get(r.requested_by)
    if (!t) {
      t = { techName, requests: 0, items: 0, lastRequestedAt: r.created_at }
      techMap.set(r.requested_by, t)
    }
    t.requests++
    t.items += activeItems.reduce((s, it) => s + (Number(it.quantity) || 0), 0)
    if (r.created_at > t.lastRequestedAt) t.lastRequestedAt = r.created_at

    // Period bucket
    const created = new Date(r.created_at)
    const bucket = granularity === 'week' ? weekStartUTC(created) : monthStartUTC(created)
    const k = bucket.getTime()
    periodCounts.set(k, (periodCounts.get(k) ?? 0) + 1)
  }

  // Build a contiguous period series from the effective start to now, so the
  // trend chart shows empty weeks/months instead of silently collapsing them.
  const byPeriod: SupplyReportPeriodPoint[] = []
  if (rows.length > 0) {
    const firstMs = cutoffMs ?? new Date(rows[0].created_at).getTime()
    let cursor = granularity === 'week' ? weekStartUTC(new Date(firstMs)) : monthStartUTC(new Date(firstMs))
    const end = granularity === 'week' ? weekStartUTC(new Date(nowMs)) : monthStartUTC(new Date(nowMs))
    let guard = 0
    while (cursor.getTime() <= end.getTime() && guard < 400) {
      byPeriod.push({
        label: granularity === 'week' ? weekLabel(cursor) : monthLabel(cursor),
        count: periodCounts.get(cursor.getTime()) ?? 0,
      })
      if (granularity === 'week') cursor = new Date(cursor.getTime() + 7 * 86_400_000)
      else cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1))
      guard++
    }
  }

  const byItem = [...itemMap.values()].sort((a, b) => b.totalQty - a.totalQty || b.timesRequested - a.timesRequested)
  const byTech = [...techMap.values()].sort((a, b) => b.requests - a.requests || b.items - a.items)

  return {
    rangeLabel,
    granularity,
    kpis: {
      totalRequests: rows.length,
      totalItems,
      activeTechs: techIds.size,
      deniedCount,
      deniedItemsCount,
      fulfilledCount,
    },
    byItem,
    byTech,
    byPeriod,
  }
}
