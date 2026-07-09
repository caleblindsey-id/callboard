/**
 * The terminology glossary — one canonical word per concept, per the UX
 * standardization audit's Terminology Glossary (standard-draft.md Part 2) and
 * PLAN.md Round 4. This file is the SOURCE for the Round 4 sweep; it does not
 * change any page copy on its own. Status enum labels/colors live in
 * `status-meta.ts`, not here — this file covers everything else: entity
 * names, field labels, and action verbs.
 *
 * Do not import this into a page and change its visible strings this round —
 * Round 4 owns that sweep. This file only needs to exist and be correct.
 */

/** Canonical entity and concept names. */
export const ENTITY = {
  pm: 'Preventive Maintenance',
  pmShort: 'PM',
  // The PM entity's own record/detail name — distinct from `pm` (the program/
  // nav concept) so PM-specific surfaces can say "PM Ticket" instead of a bare
  // "Ticket" that reads as the Service Ticket entity everywhere else.
  pmTicket: 'PM Ticket',
  // "Ticket" is only correct alone inside an already-service context (a
  // service detail page, a service-scoped list) — everywhere else use `service`.
  service: 'Service Ticket',
  serviceShort: 'Ticket',
  lead: 'Lead',
  creditReview: 'Credit Review',
  creditHoldBlocked: 'On Credit Hold',
  insideLocation: 'Inside (Shop)',
  outsideLocation: 'Outside (Field)',
  // Disambiguates the two unrelated meanings of bare "Standard" (dimension 13/glossary).
  priorityStandard: 'Standard',
  laborTypeStandard: 'Standard Labor',
} as const

/** Canonical field labels (for form labels, table headers, PDF exports). */
export const FIELDS = {
  serviceTicketNumber: 'Ticket #',
  pmNumber: 'PM #',
  synergyOrder: 'Synergy Order #',
  synergyInvoice: 'Synergy Invoice #',
  customerPo: 'Customer PO #',
  diagnosticCharge: 'Diagnostic Charge',
} as const

/** Canonical action verbs (Button labels). */
export const ACTIONS = {
  reopen: 'Reopen',
  markBilled: 'Mark Billed',
  viewAll: 'View all',
  save: 'Save',
  saveChanges: 'Save Changes',
  cancel: 'Cancel',
} as const

/**
 * Create-verb convention (dimension 14): "New {Entity}" opens a create
 * surface, "Create {Entity}" is the final commit inside that surface.
 * e.g. newEntityLabel('Service Ticket') -> "New Service Ticket".
 */
export function newEntityLabel(entity: string): string {
  return `New ${entity}`
}

export function createEntityLabel(entity: string): string {
  return `Create ${entity}`
}

/**
 * Append-child verb convention (dimension 14): "Add {Child}" is legitimate
 * (not a "New" violation) when the action appends a child row to a parent
 * record rather than creating a top-level entity — e.g. addChildLabel('Note').
 */
export function addChildLabel(child: string): string {
  return `Add ${child}`
}
