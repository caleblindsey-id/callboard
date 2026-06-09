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
  // 'from_stock' is fulfilled in-house (pulled from the shelf, no PO), so it's
  // NOT on order — treated like 'received' for the completion/deletion gates.
  // 'pending_review' IS still in flight (not yet triaged) and correctly blocks.
  return (parts ?? []).filter(
    (p) => p.status !== 'received' && p.status !== 'from_stock' && !p.cancelled
  )
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
    if (p.status !== 'pending_review') continue // new requests land in review
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
 * True when `incoming` adds at least one brand-new requested part vs `existing`.
 *
 * Used to gate part requests on ticket machine info: the office must know which
 * machine a part is for, so a new request is blocked until make/model/serial are
 * on the ticket. Diffed by `requested_at` (every new-request flow stamps it) so
 * status changes on existing parts don't trip the gate. Legacy rows without a
 * timestamp are never counted as "new".
 */
export function hasNewRequestedPart(
  existing: PartRequest[] | null | undefined,
  incoming: PartRequest[],
): boolean {
  const seen = new Set(
    (existing ?? []).map((p) => p.requested_at).filter((t): t is string => !!t),
  )
  return incoming.some(
    (p) => p.status === 'pending_review' && !!p.requested_at && !seen.has(p.requested_at),
  )
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
