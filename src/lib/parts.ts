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
