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
