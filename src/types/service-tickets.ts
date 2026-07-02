// Service ticket types — separate from PM ticket types in database.ts

import type { PartUsed, TicketPhoto, PartRequest, CreditReviewStatus } from './database'
export type { PartRequest } from './database'

// --- Enums ---

export type ServiceTicketStatus =
  | 'open'
  | 'estimated'
  | 'approved'
  | 'in_progress'
  | 'completed'
  | 'billed'
  | 'declined'
  | 'canceled'

export type ServiceBillingType =
  | 'non_warranty'
  | 'warranty'
  | 'partial_warranty'

export type ServiceTicketType = 'inside' | 'outside'

export type ServicePriority = 'emergency' | 'standard' | 'low'

// --- Extended PartUsed with warranty flag ---

export interface ServicePartUsed extends PartUsed {
  warranty_covered?: boolean
}

// --- Row Types ---

export type ServiceTicketRow = {
  id: string
  customer_id: number
  equipment_id: string | null
  assigned_technician_id: string | null
  created_by_id: string | null
  ticket_type: ServiceTicketType
  billing_type: ServiceBillingType
  status: ServiceTicketStatus
  priority: ServicePriority
  problem_description: string
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  ship_to_location_id: number | null
  service_address: string | null
  service_city: string | null
  service_state: string | null
  service_zip: string | null
  equipment_make: string | null
  equipment_model: string | null
  equipment_serial_number: string | null
  diagnosis_notes: string | null
  estimate_amount: number | null
  estimate_approved: boolean
  estimate_approved_at: string | null
  auto_approved: boolean
  // Pre-authorized work: started in_progress from open without an estimate
  // (non-warranty). The authorizer is recorded in manual_decision_note.
  estimate_bypassed: boolean
  estimate_labor_hours: number | null
  estimate_labor_rate: number | null
  estimate_parts: ServicePartUsed[]
  parts_requested: PartRequest[]
  parts_received: boolean
  synergy_order_number: string | null
  synergy_invoice_number: string | null
  started_at: string | null
  completed_at: string | null
  hours_worked: number | null
  parts_used: ServicePartUsed[]
  warranty_labor_covered: boolean
  machine_hours: number | null
  date_code: string | null
  completion_notes: string | null
  customer_signature: string | null
  customer_signature_name: string | null
  photos: TicketPhoto[]
  billing_amount: number | null
  // Export-first billing gate (migration 106), mirrors pm_tickets.billing_exported:
  // a completed service ticket must be exported (work-order PDF pulled) before its
  // Synergy invoice # can be keyed. Stays status='completed' while exported.
  billing_exported: boolean
  billing_exported_at: string | null
  diagnostic_charge: number | null
  // Customer PO # for this job (migration 108), mirrors pm_tickets.po_number.
  // Distinct from the per-line po_number in parts_requested (the vendor PO used
  // when the office orders a part) and from synergy_po_number.
  po_number: string | null
  // Trip charge = trip_charge_qty × the settings 'trip_charge_amount' rate
  // (mirrors labor: hours × rate). trip_charge_qty is the number of trips
  // (migration 107); NULL = ticket-type default (field=1, bench 'inside'=0).
  // trip_charge (migration 105, flat dollars) is retained but no longer read.
  trip_charge: number | null
  trip_charge_qty: number | null
  diagnostic_invoice_number: string | null
  awaiting_pickup: boolean
  picked_up_at: string | null
  ready_for_pickup_at: string | null
  picked_up_by_name: string | null
  released_by_id: string | null
  shop_location: string | null
  pickup_notified_at: string | null
  pickup_notify_message_id: string | null
  pickup_notify_channel: 'email' | 'phone' | null
  pickup_notify_count: number
  pickup_last_notified_at: string | null
  pickup_called_at: string | null
  pickup_called_by_id: string | null
  pickup_call_notes: string | null
  abandonment_notice_sent_at: string | null
  // Stamped when the whole order's parts are staged and the tech was notified
  // (migration 104). Reset to NULL if the order later falls out of fully-staged.
  parts_ready_notified_at: string | null
  // Stamped when the assigned tech was notified the ticket landed on their board
  // (migration 112), on create-with-assignment and reassignment. Reflects the
  // latest assignment notification.
  assigned_notified_at: string | null
  assigned_notify_message_id: string | null
  work_order_number: number | null
  synergy_validated_at: string | null
  synergy_validation_status: 'valid' | 'invalid' | 'pending' | null
  approval_token: string | null
  approval_token_expires_at: string | null
  estimate_emailed_at: string | null
  estimate_email_message_id: string | null
  // Estimate follow-up tracking (migration 113): aging clock + send cadence +
  // a logged phone-contact attempt, driving the estimate follow-up queue.
  estimated_at: string | null
  estimate_last_emailed_at: string | null
  estimate_notify_count: number
  estimate_called_at: string | null
  estimate_called_by_id: string | null
  estimate_contact_notes: string | null
  estimate_signature: string | null
  estimate_signature_name: string | null
  decline_reason: string | null
  // Declined-estimate follow-up tracking (migration 118): aging clock + soft
  // "handled" dismissal, driving the managers' declined worklist.
  declined_at: string | null
  decline_resolved_at: string | null
  decline_resolved_by_id: string | null
  // Warranty claim credit tracking (migration 119): a warranty/partial-warranty
  // ticket isn't billed until the vendor credit that offsets covered parts is
  // received. These drive the warranty-claims worklist + the completed->billed
  // credit gate.
  warranty_vendor: string | null
  warranty_claim_number: string | null
  warranty_claim_submitted_at: string | null
  warranty_claim_submitted_by_id: string | null
  warranty_credit_expected: number | null
  warranty_credit_received_at: string | null
  warranty_credit_received_by_id: string | null
  warranty_credit_amount: number | null
  manual_decision_note: string | null
  request_info_note: string | null
  labor_rate_type: string
  // Manager approval of a below-floor parts price (migration 126). A part can
  // be priced below the 15% margin floor (down to loaded cost, never below)
  // only with a manager's justification; these record who/when/why. Stamped
  // server-side only when an override is exercised.
  margin_override_by: string | null
  margin_override_at: string | null
  margin_override_note: string | null
  deleted_at: string | null
  deleted_by_id: string | null
  created_at: string
  updated_at: string
}

// --- Insert Type ---
// Required: customer_id, ticket_type, problem_description
// Everything else is optional (has DB defaults or is nullable)

export type ServiceTicketInsert = Pick<ServiceTicketRow,
  | 'customer_id' | 'ticket_type' | 'problem_description'
> & Partial<Omit<ServiceTicketRow,
  | 'id' | 'created_at' | 'updated_at'
  | 'customer_id' | 'ticket_type' | 'problem_description'
>>

// --- Update Type ---

export type ServiceTicketUpdate = Partial<Omit<ServiceTicketRow, 'id' | 'created_at' | 'updated_at'>>

// --- Join Types ---

export type ServiceTicketWithJoins = ServiceTicketRow & {
  customers: { name: string; account_number: string | null; credit_hold: boolean } | null
  equipment: {
    make: string | null
    model: string | null
    serial_number: string | null
    description: string | null
    details_verified_at: string | null
    ship_to_locations: {
      name: string | null
      address: string | null
      city: string | null
      state: string | null
      zip: string | null
    } | null
  } | null
  assigned_technician: { name: string } | null
  deleted_by: { name: string } | null
  credit_reviews: { status: CreditReviewStatus }[] | null
}

export type ServiceTicketDetail = ServiceTicketRow & {
  customers: {
    name: string
    account_number: string | null
    po_required: boolean
    ar_terms: string | null
    credit_hold: boolean
    tax_rate: number | null
    tax_exempt: boolean | null
  } | null
  equipment: {
    id: string
    make: string | null
    model: string | null
    serial_number: string | null
    description: string | null
    details_verified_at: string | null
    ship_to_locations: {
      name: string | null
      address: string | null
      city: string | null
      state: string | null
      zip: string | null
    } | null
  } | null
  // Ship-to linked directly to the ticket (via ship_to_location_id) — distinct from the
  // equipment's home location above. Set for equipment-less tickets (e.g. Synergy imports).
  ship_to_location: {
    name: string | null
    address: string | null
    city: string | null
    state: string | null
    zip: string | null
  } | null
  assigned_technician: { name: string } | null
  created_by: { name: string } | null
  deleted_by: { name: string } | null
  credit_reviews: { id: string; status: CreditReviewStatus; block_reason: string | null; decided_by_name: string | null }[] | null
}

// --- Status Transition Map ---

export const SERVICE_VALID_TRANSITIONS: Record<ServiceTicketStatus, ServiceTicketStatus[]> = {
  open:        ['estimated', 'in_progress', 'canceled'],
  estimated:   ['approved', 'declined', 'canceled'],
  approved:    ['in_progress', 'canceled'],
  in_progress: ['completed', 'open', 'approved', 'estimated', 'canceled'],
  completed:   ['billed', 'open', 'approved'],
  billed:      ['open', 'approved'],
  declined:    ['open'],
  canceled:    ['open'],
}

// Manager-only transitions (reopen from any state, cancel)
export const SERVICE_MANAGER_ONLY_TARGETS: ServiceTicketStatus[] = ['open', 'canceled']

// --- Reopen field-reset sets ---
// Shared between PATCH /api/service-tickets/[id] (reopen-to-open, which WIPES
// the estimate) and POST .../reopen-estimate (which PRESERVES the estimate for
// revision) so the two reopen paths can never drift on the residue they clear
// — the stale-flag class behind PRs #211/#213. Mirrors the PM pattern
// (EMPTY_COMPLETION_FIELDS in src/lib/ticket-transitions.ts).

// Customer sign-off: any reopen invalidates the prior approval round, so the
// (new or revised) estimate must be re-approved.
export const EMPTY_ESTIMATE_SIGNOFF_FIELDS = {
  estimate_approved: false,
  estimate_approved_at: null,
  auto_approved: false,
  estimate_signature: null,
  estimate_signature_name: null,
  approval_token: null,
  approval_token_expires_at: null,
} as const

// Follow-up campaign (estimate queue + estimate-renotify cron): a reopened
// ticket starts a fresh contact campaign when its estimate is re-sent.
// Without this reset, the old round's counters carry over — "Emailed ×4",
// first-contact aging from weeks ago, and a re-notify cadence computed off a
// stale estimate_emailed_at.
export const EMPTY_ESTIMATE_FOLLOWUP_FIELDS = {
  estimated_at: null,
  estimate_emailed_at: null,
  estimate_last_emailed_at: null,
  estimate_notify_count: 0,
  estimate_called_at: null,
  estimate_called_by_id: null,
  estimate_contact_notes: null,
} as const

// --- Unified Service History Item (for combined PM + service timelines) ---

// Helper to convert PM ticket data to ServiceHistoryItem
export function pmTicketToHistoryItem(t: {
  id: string
  work_order_number: number
  status: string
  completed_date: string | null
  month: number
  year: number
  hours_worked: number | null
  additional_hours_worked: number | null
  parts_used: unknown[] | null
  additional_parts_used: unknown[] | null
  billing_amount: number | null
  completion_notes: string | null
}): ServiceHistoryItem {
  const partsCount = (Array.isArray(t.parts_used) ? t.parts_used.length : 0)
    + (Array.isArray(t.additional_parts_used) ? t.additional_parts_used.length : 0)
  return {
    id: t.id,
    type: 'pm',
    work_order_number: t.work_order_number,
    status: t.status,
    date: t.completed_date ?? null,
    hours_worked: t.hours_worked,
    additional_hours_worked: t.additional_hours_worked,
    parts_count: partsCount,
    billing_amount: t.billing_amount,
    completion_notes: t.completion_notes,
    technician_name: null,
  }
}

export interface ServiceHistoryItem {
  id: string
  type: 'pm' | 'service'
  work_order_number: number | null
  status: string
  date: string | null
  hours_worked: number | null
  additional_hours_worked?: number | null
  parts_count: number
  billing_amount: number | null
  completion_notes: string | null
  technician_name: string | null
  problem_description?: string
  ticket_type?: ServiceTicketType
  billing_type?: ServiceBillingType
}
