// Purchasing / Reorder module types (migration 142). Kept separate from the
// PM/service ticket unions in database.ts — this module has its own session
// lifecycle and its own synced inventory shape.
//
// See docs/superpowers/specs/2026-07-14-purchasing-reorder-module-design.md
// for the full design ("Data Model" + "Status Lifecycle" sections).

// ============================================================
// Enums
// ============================================================

export type ReorderSessionStatus =
  | 'draft'
  | 'walking'
  | 'review'
  | 'ordered'
  | 'closed'
  | 'canceled'

export type ReorderLineStatus = 'pending' | 'ordered' | 'skipped' | 'flagged'

export type ReorderScopeType = 'all' | 'zone' | 'vendor' | 'below_rop'

// Valid forward/side transitions for a reorder session. `walking <-> review`
// moves freely; the forward gate is only `review -> ordered`. `closed` and
// `canceled` are terminal.
export const REORDER_VALID_TRANSITIONS: Record<ReorderSessionStatus, ReorderSessionStatus[]> = {
  draft: ['walking', 'canceled'],
  walking: ['review', 'canceled'],
  review: ['walking', 'ordered', 'canceled'],
  ordered: ['review', 'closed', 'canceled'],
  closed: [],
  canceled: [],
}

// ============================================================
// reorder_sessions
// ============================================================

export type ReorderSessionRow = {
  id: string
  name: string
  status: ReorderSessionStatus
  scope_type: ReorderScopeType
  scope_value: string | null
  created_by_id: string | null
  inventory_as_of: string | null
  total_items: number
  lines_ordered: number
  est_total_cost: number
  notes: string | null
  created_at: string
  updated_at: string
}

export type ReorderSessionInsert = Pick<ReorderSessionRow, 'name'> &
  Partial<
    Pick<
      ReorderSessionRow,
      | 'status'
      | 'scope_type'
      | 'scope_value'
      | 'created_by_id'
      | 'inventory_as_of'
      | 'total_items'
      | 'lines_ordered'
      | 'est_total_cost'
      | 'notes'
    >
  >

export type ReorderSessionUpdate = Partial<Omit<ReorderSessionRow, 'id' | 'created_at' | 'updated_at'>>

// ============================================================
// reorder_lines — snapshotted from inv_reorder at walk time
// ============================================================

export type ReorderLineRow = {
  id: string
  session_id: string
  synergy_product_id: string
  description: string | null
  vendor_code: number | null
  vendor_name: string | null
  vendor_item_number: string | null
  bin_location: string | null
  barcode: string | null
  buying_uom: string | null
  pack_qty: number | null
  qoh: number | null
  on_order: number | null
  committed: number | null
  available: number | null
  weekly_usage: number | null
  weeks_of_supply: number | null
  order_point: number | null
  max_level: number | null
  suggested_qty: number | null
  unit_cost: number | null
  order_qty: number
  line_status: ReorderLineStatus
  flag_note: string | null
  sort_key: string | null
  created_at: string
  updated_at: string
}

export type ReorderLineInsert = Pick<ReorderLineRow, 'session_id' | 'synergy_product_id'> &
  Partial<
    Omit<ReorderLineRow, 'id' | 'session_id' | 'synergy_product_id' | 'created_at' | 'updated_at'>
  >

export type ReorderLineUpdate = Partial<Omit<ReorderLineRow, 'id' | 'session_id' | 'created_at' | 'updated_at'>>

// ============================================================
// reorder_session_vendors — per-vendor PO tracking
// ============================================================

export type ReorderSessionVendorRow = {
  id: string
  session_id: string
  vendor_code: number
  vendor_name: string | null
  synergy_po_number: string | null
  po_recorded_at: string | null
  line_count: number
  subtotal: number
  notes: string | null
}

export type ReorderSessionVendorInsert = Pick<ReorderSessionVendorRow, 'session_id' | 'vendor_code'> &
  Partial<Pick<ReorderSessionVendorRow, 'vendor_name' | 'line_count' | 'subtotal' | 'notes'>>

export type ReorderSessionVendorUpdate = Partial<
  Pick<ReorderSessionVendorRow, 'vendor_name' | 'synergy_po_number' | 'po_recorded_at' | 'line_count' | 'subtotal' | 'notes'>
>

// ============================================================
// Synced inventory tables (read-only, Whse 4)
// ============================================================

export type InvReorderRow = {
  synergy_product_id: string
  description: string | null
  commodity_code: string | null
  buying_uom: string | null
  stock_uom: string | null
  pack_size: string | null
  pack_qty: number | null
  qty_on_hand: number | null
  qty_on_po: number | null
  qty_committed: number | null
  qty_available: number | null
  order_point: number | null
  min_stock: number | null
  max_stock: number | null
  safety_stock: number | null
  eoq: number | null
  do_not_reorder: boolean
  seasonal: boolean
  usage_rate: number | null
  demand: number | null
  period_usage: number[] | null
  weekly_usage: number | null
  last_sold_date: string | null
  avg_lead_time: number | null
  unit_cost: number | null
  vendor_code: number | null
  vendor_item_number: string | null
  primary_bin: string | null
  bin_sort_key: string | null
  all_bins: string | null
  barcode: string | null
  active: boolean
  synced_at: string | null
}

export type InvVendorRow = {
  vendor_code: number
  name: string | null
  order_minimum: number | null
  terms_code: number | null
  contact: string | null
  freight_code: string | null
  synced_at: string | null
}

export type InvBinRow = {
  id: number
  synergy_product_id: string
  bin_location: string
  is_primary: boolean
  sort_key: string | null
  synced_at: string | null
}
