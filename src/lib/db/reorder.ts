// Query helpers for the Purchasing / Reorder module (migration 142). Kept
// thin — the scope-resolution, suggested-qty mapping, and line/vendor
// snapshotting all live in the API routes (src/app/api/purchasing/...); this
// file only reads/writes the session tables.
//
// See docs/superpowers/specs/2026-07-14-purchasing-reorder-module-design.md
// ("Data Model" section) and the plan's Task 2.1/2.2.

import { createClient } from '@/lib/supabase/server'
import type {
  ReorderSessionRow,
  ReorderSessionInsert,
  ReorderLineRow,
  ReorderSessionVendorRow,
} from '@/types/reorder'

// PostgREST's default per-request row ceiling. A full-warehouse walk is
// ~1,242 lines, so getSessionLines pages past this with .range() until a
// short page signals the end — never truncates the tail of a big walk.
const PAGE_SIZE = 1000

export async function listSessions(): Promise<ReorderSessionRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('reorder_sessions')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as ReorderSessionRow[]
}

export async function getSession(id: string): Promise<ReorderSessionRow | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('reorder_sessions')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  return data as ReorderSessionRow | null
}

export async function createSession(insert: ReorderSessionInsert): Promise<ReorderSessionRow> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('reorder_sessions')
    .insert(insert)
    .select()
    .single()

  if (error) throw error
  return data as ReorderSessionRow
}

// Full walk of a session's lines, ordered by sort_key (walk order). Paginates
// past the 1000-row PostgREST ceiling with a stable (sort_key, id) ordering so
// pages can't duplicate or skip rows at the boundary.
export async function getSessionLines(sessionId: string): Promise<ReorderLineRow[]> {
  const supabase = await createClient()
  const lines: ReorderLineRow[] = []
  let offset = 0

  for (;;) {
    const { data, error } = await supabase
      .from('reorder_lines')
      .select('*')
      .eq('session_id', sessionId)
      .order('sort_key', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)

    if (error) throw error
    const page = (data ?? []) as ReorderLineRow[]
    lines.push(...page)
    if (page.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  return lines
}

export async function getSessionVendors(sessionId: string): Promise<ReorderSessionVendorRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('reorder_session_vendors')
    .select('*')
    .eq('session_id', sessionId)
    .order('vendor_name', { ascending: true })

  if (error) throw error
  return (data ?? []) as ReorderSessionVendorRow[]
}

// Server-authoritative rollup recompute, shared by both PATCH routes (session
// status/name/notes and line order_qty/status). Never trust a client-supplied
// total — always derive from the actual lines.
//
// Per line extended cost = order_qty (cases) * pack_qty * unit_cost (unit_cost
// is per each/stock UOM). Null pack_qty -> 1, null unit_cost -> 0.
//   session.lines_ordered  = count of lines with order_qty > 0
//   session.est_total_cost = sum of extended cost over all lines
//   vendor.line_count      = count of that vendor's lines with order_qty > 0
//   vendor.subtotal        = sum of extended cost for that vendor
export async function recomputeSessionRollups(sessionId: string): Promise<void> {
  const supabase = await createClient()
  const lines = await getSessionLines(sessionId)

  let linesOrdered = 0
  let estTotalCost = 0
  const byVendor = new Map<number, { lineCount: number; subtotal: number }>()

  for (const line of lines) {
    const orderQty = line.order_qty ?? 0
    if (orderQty <= 0) continue

    const extended = orderQty * (line.pack_qty ?? 1) * (line.unit_cost ?? 0)
    linesOrdered += 1
    estTotalCost += extended

    if (line.vendor_code != null) {
      const bucket = byVendor.get(line.vendor_code) ?? { lineCount: 0, subtotal: 0 }
      bucket.lineCount += 1
      bucket.subtotal += extended
      byVendor.set(line.vendor_code, bucket)
    }
  }

  const { error: sessionError } = await supabase
    .from('reorder_sessions')
    .update({ lines_ordered: linesOrdered, est_total_cost: estTotalCost })
    .eq('id', sessionId)
  if (sessionError) throw sessionError

  // Refresh every vendor row seeded on the session, including ones that have
  // dropped to zero ordered lines (e.g. the agent cleared every qty for that
  // vendor after previously entering some).
  const vendors = await getSessionVendors(sessionId)
  for (const vendor of vendors) {
    const bucket = byVendor.get(vendor.vendor_code) ?? { lineCount: 0, subtotal: 0 }
    const { error: vendorError } = await supabase
      .from('reorder_session_vendors')
      .update({ line_count: bucket.lineCount, subtotal: bucket.subtotal })
      .eq('session_id', sessionId)
      .eq('vendor_code', vendor.vendor_code)
    if (vendorError) throw vendorError
  }
}
