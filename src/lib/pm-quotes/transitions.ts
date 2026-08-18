import type { PmQuoteStatus } from '@/types/database'

// ============================================================
// Quote state machine. Single source of truth for the PATCH route and any UI
// that decides which actions to offer, so the two can never drift — the same
// shape as src/lib/ticket-transitions.ts for PM tickets.
//
// accepted is deliberately near-final: it is the state the start-work gate
// reads, so letting it wander back to draft would silently un-authorize work
// that may already be underway. A superseded accepted quote gets voided and
// replaced instead.
// ============================================================

export const QUOTE_VALID_TRANSITIONS: Record<PmQuoteStatus, PmQuoteStatus[]> = {
  draft: ['sent', 'void'],
  sent: ['accepted', 'declined', 'expired', 'void'],
  accepted: ['void'],
  declined: ['sent', 'void'],
  expired: ['sent', 'void'],
  void: [],
}

export function canTransitionQuote(from: PmQuoteStatus, to: PmQuoteStatus): boolean {
  return (QUOTE_VALID_TRANSITIONS[from] ?? []).includes(to)
}

/** Statuses that still need someone to act. Drives the queue's default view. */
export const OPEN_QUOTE_STATUSES: PmQuoteStatus[] = ['draft', 'sent']

/** The one status that satisfies the start-work gate. */
export const AUTHORIZING_QUOTE_STATUS: PmQuoteStatus = 'accepted'
