import type { SupplyRequestItem } from '@/types/database'

// Shared validator for the JSONB line items on a supply request. Used by the
// create route (POST) and the office line-edit action (PATCH update_items).
//
// allowDenied gates the per-line deny fields (feedback #65): the office may set
// them when editing the worklist, but a tech submitting a request can't pre-deny
// their own lines, so the create path leaves them stripped.

export const MAX_SUPPLY_ITEMS = 50

type ItemInput = {
  name?: unknown
  quantity?: unknown
  catalog_id?: unknown
  unit?: unknown
  denied?: unknown
  denied_reason?: unknown
}

export function normalizeSupplyItems(
  raw: unknown,
  opts: { allowDenied?: boolean } = {},
): { ok: true; items: SupplyRequestItem[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: 'Add at least one item to request.' }
  }
  if (raw.length > MAX_SUPPLY_ITEMS) {
    return { ok: false, error: `Too many items (max ${MAX_SUPPLY_ITEMS}).` }
  }
  const items: SupplyRequestItem[] = []
  for (const it of raw as ItemInput[]) {
    const name = typeof it?.name === 'string' ? it.name.trim() : ''
    if (!name) return { ok: false, error: 'Each item needs a name.' }
    const qty = Number(it?.quantity)
    if (!Number.isFinite(qty) || qty <= 0) {
      return { ok: false, error: `Enter a quantity greater than zero for "${name}".` }
    }
    const item: SupplyRequestItem = {
      name: name.slice(0, 120),
      quantity: Math.floor(qty),
      catalog_id: typeof it?.catalog_id === 'string' ? it.catalog_id : null,
      unit: typeof it?.unit === 'string' && it.unit.trim() ? it.unit.trim() : null,
    }
    if (opts.allowDenied && it?.denied === true) {
      item.denied = true
      item.denied_reason =
        typeof it?.denied_reason === 'string' && it.denied_reason.trim()
          ? it.denied_reason.trim().slice(0, 500)
          : null
    }
    items.push(item)
  }
  return { ok: true, items }
}
