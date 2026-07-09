import type { TicketStatus } from '@/types/database'
import { VALID_TRANSITIONS, EMPTY_COMPLETION_FIELDS } from '@/lib/ticket-transitions'

// Re-exported so callers that only need the PM state machine can import it
// from one place; `src/lib/ticket-transitions.ts` remains the single source
// of truth for the table itself (TicketActions.tsx's manager override panel
// also reads it directly).
export { VALID_TRANSITIONS, EMPTY_COMPLETION_FIELDS }

// Status transitions that count as "performing work" — blocked while a
// credit review is pending/blocked. Mirrors the same-named const formerly
// inlined in src/app/api/tickets/[id]/route.ts.
export const CREDIT_GATED_PM_TARGETS: TicketStatus[] = ['in_progress', 'completed', 'billed']

/** Pure table lookup: does the PM state machine allow `from -> to` at all (before role/gate checks)? */
export function canTransition(from: TicketStatus, to: TicketStatus): boolean {
  return (VALID_TRANSITIONS[from] ?? []).includes(to)
}

/**
 * completed -> in_progress, or skipped -> unassigned: the manager-only
 * "reopen" path. completed -> in_progress clears completion data (via
 * EMPTY_COMPLETION_FIELDS); skipped -> unassigned just clears the skip.
 */
export function isReopenTransition(from: TicketStatus, to: TicketStatus): boolean {
  return (from === 'completed' && to === 'in_progress') || (from === 'skipped' && to === 'unassigned')
}

/**
 * in_progress -> assigned/unassigned, or a transition away from billed to
 * anything else in its allowed set: the manager-only backwards "reset" path.
 */
export function isResetTransition(from: TicketStatus, to: TicketStatus): boolean {
  return (from === 'in_progress' && (to === 'assigned' || to === 'unassigned')) || from === 'billed'
}

/** Techs can never PATCH a ticket to billed (billing is a back-office action). */
export function technicianForbiddenTarget(to: TicketStatus): boolean {
  return to === 'billed'
}

/** Status transitions blocked while the linked order is under AR credit review. */
export function isCreditGatedTarget(to: TicketStatus): boolean {
  return CREDIT_GATED_PM_TARGETS.includes(to)
}
