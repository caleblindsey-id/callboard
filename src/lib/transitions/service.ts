import type { ServiceTicketStatus } from '@/types/service-tickets'
import { SERVICE_VALID_TRANSITIONS, SERVICE_MANAGER_ONLY_TARGETS } from '@/types/service-tickets'

// Re-exported so callers that only need the service state machine can import
// it from one place; `src/types/service-tickets.ts` remains the single
// source of truth for the tables themselves.
export { SERVICE_VALID_TRANSITIONS, SERVICE_MANAGER_ONLY_TARGETS }

// Status transitions that count as "performing work" — blocked while a
// credit review is pending/blocked. Mirrors the same-named const formerly
// inlined in src/app/api/service-tickets/[id]/route.ts.
export const CREDIT_GATED_SERVICE_TARGETS: ServiceTicketStatus[] = ['in_progress', 'completed', 'billed']

/** Pure table lookup: does the service state machine allow `from -> to` at all (before role/gate checks)? */
export function canTransition(from: ServiceTicketStatus, to: ServiceTicketStatus): boolean {
  return (SERVICE_VALID_TRANSITIONS[from] ?? []).includes(to)
}

/** Reopen-to-'open' or cancel: manager-only regardless of source status. */
export function isManagerOnlyTarget(to: ServiceTicketStatus): boolean {
  return SERVICE_MANAGER_ONLY_TARGETS.includes(to)
}

/**
 * Reopening a worked ticket (in_progress/completed/billed) back to
 * 'approved' is manager-only. The normal staff estimated -> approved
 * approval flow is a different source status and is unaffected.
 */
export function isManagerOnlyReopenToApproved(from: ServiceTicketStatus, to: ServiceTicketStatus): boolean {
  return to === 'approved' && (['in_progress', 'completed', 'billed'] as ServiceTicketStatus[]).includes(from)
}

/** Techs may approve an estimate but never decline it (decline stays with staff). */
export function techCannotDecline(from: ServiceTicketStatus, to: ServiceTicketStatus): boolean {
  return from === 'estimated' && to === 'declined'
}

/** Techs must submit completion through POST /complete, never PATCH straight to completed. */
export function techCannotComplete(to: ServiceTicketStatus): boolean {
  return to === 'completed'
}

/** Status transitions blocked while the linked order is under AR credit review. */
export function isCreditGatedTarget(from: ServiceTicketStatus, to: ServiceTicketStatus): boolean {
  return CREDIT_GATED_SERVICE_TARGETS.includes(to) && to !== from
}

/**
 * The Mark Billed hard gate: a service ticket can't move to 'billed' without
 * a Synergy invoice # on record. `ticket` is whatever mix of the in-flight
 * PATCH body and the persisted row the caller has on hand: the invoice #
 * may be arriving in THIS request (new value) or have been saved earlier
 * (existing value); either satisfies the gate. Mirrors the PATCH route's
 * hard block and the disabled-until-filled Mark Billed button in service
 * NextStepBar.
 */
export function billingGateSatisfied(ticket: { synergy_invoice_number?: string | null }): boolean {
  return !!ticket.synergy_invoice_number
}
