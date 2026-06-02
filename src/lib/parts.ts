import type { PartRequest } from '@/types/database'

/**
 * Parts that are neither received nor cancelled — i.e. still on order.
 *
 * Used to block ticket completion and deletion: a ticket with parts on order
 * must have them received or cancelled before it can be completed or deleted,
 * so a live vendor PO never loses its parent ticket.
 */
export function partsOnOrder(
  parts: PartRequest[] | null | undefined
): PartRequest[] {
  return (parts ?? []).filter((p) => p.status !== 'received' && !p.cancelled)
}

/**
 * Server-side gate for required fields on NEW manual part requests.
 *
 * The office can't backfill a manual (off-catalog) request, so vendor name,
 * vendor part #, description, and a customer price are required. Catalog parts
 * (synergy_product_id set) resolve those office-side and are exempt.
 *
 * Scoped strictly to brand-new requested entries — matched by `requested_at`,
 * which every new-request flow stamps. Legacy rows (no timestamp) and any entry
 * already present in `existing` are skipped so editing or advancing an old
 * ticket never hard-fails. Returns an error message, or null when all clear.
 */
export function validateNewManualPartRequests(
  existing: PartRequest[] | null | undefined,
  incoming: PartRequest[],
): string | null {
  const seen = new Set(
    (existing ?? []).map((p) => p.requested_at).filter((t): t is string => !!t),
  )
  for (const p of incoming) {
    if (p.status !== 'requested') continue
    if (!p.requested_at || seen.has(p.requested_at)) continue // legacy or pre-existing
    if (p.synergy_product_id != null) continue // catalog part — exempt
    if (!p.description?.trim()) {
      return 'A part description is required for each requested part.'
    }
    if (!p.vendor?.trim()) {
      return 'Vendor name is required on manually requested parts.'
    }
    if (!p.vendor_item_code?.trim()) {
      return 'Vendor part # is required on manually requested parts.'
    }
    const price = typeof p.unit_price === 'number' ? p.unit_price : NaN
    if (!Number.isFinite(price) || price < 0) {
      return 'A customer price (0 or more) is required on manually requested parts.'
    }
  }
  return null
}

/**
 * Display label for a part line: the description, with any free-text `detail`
 * appended in-line (e.g. "SHOP SUPPLIES — rags, lubricant, fasteners").
 *
 * `detail` is captured for catch-all catalog items flagged products.requires_detail.
 * Single source of truth for the "description — detail" format so every render
 * site (on-screen lists + PDFs) stays consistent.
 */
export function partLabel(
  part: { description?: string | null; detail?: string | null }
): string {
  const desc = (part.description ?? '').trim()
  const detail = (part.detail ?? '').trim()
  return detail ? `${desc} — ${detail}` : desc
}
