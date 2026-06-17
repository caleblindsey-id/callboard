// ============================================================
// Enums
// ============================================================

export type UserRole = 'super_admin' | 'manager' | 'coordinator' | 'technician'

// Role group constants — importable by both server and client code
export const MANAGER_ROLES: UserRole[] = ['super_admin', 'manager', 'coordinator']
export const RESET_ROLES: UserRole[] = ['super_admin', 'manager']
export const ADMIN_ROLES: UserRole[] = ['super_admin']
// Who may read the audit log (change history). Managers + super_admin; NOT
// coordinators. Distinct from RESET_ROLES despite the same membership today —
// the two are gated by different intent and may diverge.
export const AUDIT_ROLES: UserRole[] = ['super_admin', 'manager']

export type TicketStatus = 'unassigned' | 'assigned' | 'in_progress' | 'completed' | 'billed' | 'skipped' | 'skip_requested'

export type BillingType = 'flat_rate' | 'time_and_materials' | 'contract'

export type TechLeadType = 'pm' | 'equipment_sale'

export type TechLeadStatus =
  | 'pending' | 'approved' | 'rejected' | 'cancelled'
  | 'earned' | 'paid'
  | 'match_pending' | 'expired'

// Proposed-frequency options a tech can pick on the submit form.
export type TechLeadFrequency = 'monthly' | 'bi-monthly' | 'quarterly' | 'semi-annual' | 'annual'

// Equipment-sale bonus tiers. Rate card lives in src/lib/tech-leads/bonus-tiers.ts.
export type EquipmentSaleTier =
  | 'ride_on_scrubber'
  | 'walk_behind_scrubber'
  | 'hot_water_pw'
  | 'cold_water_pw'
  | 'cord_electric'

export type EquipmentSaleCandidateStatus = 'pending' | 'confirmed' | 'dismissed'

// Schedule interval_months values that earn a lead bonus: 1/2/3 (monthly,
// bi-monthly, quarterly) earn the full first-PM flat rate; 6 (semi-annual) earns
// half. See @/lib/tech-leads/pm-bonus and migration 094 for the per-interval rate.
export const BONUS_ELIGIBLE_INTERVAL_MONTHS = [1, 2, 3, 6] as const

export type SyncType = 'customers' | 'contacts' | 'products' | 'full'

export type SyncStatus = 'running' | 'success' | 'failed'

// ACE labor: tech-submitted labor on no-charge tickets, paid out monthly.
export type LaborRateType = 'standard' | 'industrial' | 'vacuum'

export type AceLaborStatus = 'pending' | 'approved' | 'rejected' | 'paid'

// `type` (not interface) so it satisfies Supabase's Record<string, unknown>
// constraint when used as a Tables Row.
export type AceLaborEntry = {
  id: string
  pm_ticket_id: string | null
  service_ticket_id: string | null
  tech_id: string
  hours: number
  labor_rate_type: LaborRateType
  reason: string
  status: AceLaborStatus
  submitted_at: string
  approved_by_id: string | null
  approved_at: string | null
  rejected_reason: string | null
  rate_value_at_approval: number | null
  paid_at: string | null
  paid_by_id: string | null
  payout_period: string | null
  updated_by_id: string | null
  created_by_id: string | null
  created_at: string
  updated_at: string
}

export type AceLaborEntryRow = AceLaborEntry
export type AceLaborEntryInsert =
  Pick<AceLaborEntryRow, 'tech_id' | 'hours' | 'labor_rate_type' | 'reason'> &
  Partial<Pick<
    AceLaborEntryRow,
    | 'pm_ticket_id' | 'service_ticket_id' | 'status' | 'submitted_at'
    | 'approved_by_id' | 'approved_at' | 'rejected_reason' | 'rate_value_at_approval'
    | 'paid_at' | 'paid_by_id' | 'payout_period'
    | 'updated_by_id' | 'created_by_id'
  >>
export type AceLaborEntryUpdate = Partial<Omit<AceLaborEntryRow, 'id' | 'created_at' | 'updated_at'>>

// Sales reps: outside reps a manager can forward an approved equipment lead
// to. Not CallBoard users — only an email destination. `kind` distinguishes
// reps from sales/branch managers, who can also be CC'd or be the primary
// recipient (with an "assign to one of your reps" framing).
export type SalesRepKind = 'rep' | 'sales_manager' | 'branch_manager'

export type SalesRep = {
  id: string
  name: string
  email: string
  kind: SalesRepKind
  title: string | null
  active: boolean
  updated_by_id: string | null
  created_by_id: string | null
  created_at: string
  updated_at: string
}

export type SalesRepInsert = Pick<SalesRep, 'name' | 'email'> &
  Partial<Pick<SalesRep, 'kind' | 'title' | 'active' | 'updated_by_id' | 'created_by_id'>>
export type SalesRepUpdate = Partial<Pick<SalesRep, 'name' | 'email' | 'kind' | 'title' | 'active' | 'updated_by_id'>>

export type Vendor = {
  code: number
  name: string
  synced_at: string
}

export type VendorInsert = Pick<Vendor, 'code' | 'name'> & Partial<Pick<Vendor, 'synced_at'>>
export type VendorUpdate = Partial<Pick<Vendor, 'name' | 'synced_at'>>

// Migration 098 — on-demand Synergy re-check queue. The hosted app enqueues a
// row; the office workstation drains it and writes status/result back.
export type RevalidationQueueStatus = 'pending' | 'processing' | 'done' | 'error'

export type RevalidationQueueRow = {
  id: string
  ticket_id: string
  source: 'pm' | 'service'
  status: RevalidationQueueStatus
  requested_by: string | null
  requested_at: string
  processed_at: string | null
  result: Record<string, unknown> | null
  error: string | null
}

export type RevalidationQueueInsert = Pick<RevalidationQueueRow, 'ticket_id' | 'source'> &
  Partial<Pick<RevalidationQueueRow, 'status' | 'requested_by'>>

export type RevalidationQueueUpdate = Partial<
  Pick<RevalidationQueueRow, 'status' | 'processed_at' | 'result' | 'error'>
>

// ============================================================
// JSONB Part type
// ============================================================

export interface PartUsed {
  synergy_product_id: number | null
  quantity: number
  description: string
  unit_price: number
  // Free-text detail for catch-all catalog items flagged products.requires_detail
  // (e.g. "SHOP SUPPLIES" → "rags, lubricant, fasteners"). Optional. Rendered
  // in-line after the description on customer-facing PDFs/views via partLabel().
  detail?: string
  // Snapshot of the product's requires_detail flag at entry time. Persisted so
  // the detail input can be re-shown on reload (the product-select event that
  // first sets it never fires again on rehydrate). See partsFromSaved().
  requires_detail?: boolean
}

export interface DefaultProduct {
  synergy_product_id: number
  quantity: number
  description: string
}

export interface TicketPhoto {
  storage_path: string
  uploaded_at: string
}

// Per-part lifecycle. A tech's new request now lands in 'pending_review' (the
// office triages stock-vs-order); choosing "order" advances it to 'requested'
// (the existing To-Order → ordered → received flow), choosing "pull from stock"
// sets 'from_stock' (fulfilled in-house, no PO — treated like 'received' for
// completion + billing). Legacy rows with no status default to 'requested'.
export type PartRequestStatus =
  | 'pending_review'
  | 'requested'
  | 'ordered'
  | 'received'
  | 'from_stock'

export interface PartRequest {
  description: string
  quantity: number
  // Price to charge the customer for this part, captured by the tech at request
  // time. Required on new MANUAL (off-catalog) requests; catalog parts resolve
  // price office-side. Warranty service parts may carry an explicit 0.
  unit_price?: number
  // Free-text detail for catch-all catalog items flagged products.requires_detail
  // (e.g. "SHOP SUPPLIES"). Optional; mirrors PartUsed.detail.
  detail?: string
  // Synergy item number (display string, e.g. "146400019"). Source of truth for billing.
  product_number?: string
  // Int form of products.synergy_id — set when the office picks a catalog match.
  // Same convention as PartUsed.synergy_product_id (Number(products.synergy_id)).
  synergy_product_id?: number | null
  // Manufacturer / vendor part number — captured alongside the Synergy item # so
  // the office can order against the correct SKU with the outside vendor.
  vendor_item_code?: string
  po_number?: string
  status: PartRequestStatus
  // PM coverage classification, chosen by the tech at request time:
  //   true  = part is included in the PM agreement → customer is NOT charged
  //   false = not included → billed to the customer
  //   undefined = not yet chosen (pre-feature rows, or unselected). The request
  //   UI forces an explicit pick before saving, so new PM requests always carry
  //   true/false. Drives the covered-vs-billable split at completion (migration
  //   097 / TicketActions seed). Service-ticket parts use `warranty_covered`
  //   instead — this field is PM-only.
  covered_by_agreement?: boolean
  // Vendor the part comes from. Written by VendorPicker from the Synergy
  // a80vm vendor master (migration 069). Legacy rows may have free-text
  // `vendor` with no `vendor_code` — re-pick to link.
  vendor?: string
  // Synergy a80vm.VendorCode as a string. Paired with `vendor` when picked
  // via VendorPicker; absent on legacy free-text rows.
  vendor_code?: string
  // Parts Queue lifecycle metadata — optional; pre-036 rows won't have these.
  requested_at?: string
  ordered_at?: string
  received_at?: string
  ordered_by?: string
  received_by?: string
  // Office can cancel a request that shouldn't be ordered (wrong part, warranty
  // covered direct, customer withdrew). Stays on the parent ticket as a struck-
  // through line with the reason, but drops off the queue.
  cancelled?: boolean
  cancel_reason?: string
  cancelled_at?: string
  cancelled_by?: string
  // Stock-vs-order triage (Review step). Set when the office acts on a
  // 'pending_review' part: triaged_by/at record who/when; triage_reason is the
  // justification, required only when ordering despite stock/PO on hand.
  // qoh/qopo_at_triage snapshot what the office actually saw at decision time
  // (the synced products.qty_* numbers drift, so the audit keeps the seen value).
  triaged_by?: string
  triaged_at?: string
  triage_reason?: string
  qoh_at_triage?: number | null
  qopo_at_triage?: number | null
  // Physical-pull state for 'from_stock' parts (migration 104). A from_stock
  // part with no pulled_at is still on the shelf ("To Pull"); pulled_at/pulled_by
  // record who staged it for the tech and when.
  pulled_at?: string
  pulled_by?: string
}

// ============================================================
// Parts Queue view row — one row per part request across PM + service.
// (po_due_date is view-only — see PartsQueueRow below — and not stored on the
// JSONB part request itself, so it's intentionally absent from PartRequest.)
// Backed by the parts_order_queue view (migration 036). Read-only.
// ============================================================

export type PartsQueueSource = 'pm' | 'service'

// 'pending' is the migration-028 DEFAULT on service_tickets — newly-created
// rows hold it until the nightly script stamps valid/invalid. The validator
// only writes valid/invalid/null, so this is a read-only state from the UI's
// perspective.
export type SynergyValidationStatus = 'valid' | 'invalid' | 'pending' | null
export type PartsValidationStatus = 'valid' | 'partial' | 'invalid' | null

export type PartsQueueRow = {
  source: PartsQueueSource
  ticket_id: string
  work_order_number: number | null
  part_index: number
  customer_id: number | null
  customer_name: string | null
  assigned_technician_id: string | null
  assigned_technician_name: string | null
  synergy_order_number: string | null
  // SynergyERP invoice number, keyed in at billing to prove the completed work
  // was invoiced. A completed ticket can't be marked 'billed' without it
  // (migration 099). Distinct from synergy_order_number, which is the
  // parts-ordering order # validated against the ERP order table.
  synergy_invoice_number: string | null
  synergy_validation_status: SynergyValidationStatus
  parts_validation_status: PartsValidationStatus
  synergy_validated_at: string | null
  requested_at: string
  description: string | null
  // Free-text detail for catch-all items (e.g. SHOP SUPPLIES). Projected from
  // the parts_requested JSONB by the parts_order_queue view (migration 089).
  detail: string | null
  quantity: number | null
  // Customer price for this part request (migration 090). Projected from the
  // parts_requested JSONB; null on pre-090 rows that predate the field.
  unit_price: number | null
  vendor: string | null
  vendor_code: string | null
  product_number: string | null
  synergy_product_id: number | null
  vendor_item_code: string | null
  po_number: string | null
  status: PartRequestStatus
  // Branch stock position for the Review step (migration 102). Joined from the
  // products catalog by product_number; null for manual / non-catalog parts.
  qty_on_hand: number | null
  qty_on_po: number | null
  // Stock-vs-order triage audit (migration 102). Projected from the
  // parts_requested JSONB; null until the office triages the part.
  triaged_by: string | null
  triaged_at: string | null
  triage_reason: string | null
  qoh_at_triage: number | null
  qopo_at_triage: number | null
  // Physical-pull state for 'from_stock' parts (migration 104). pulled_at null
  // = still on the shelf (To Pull); set = staged for the tech.
  pulled_at: string | null
  pulled_by: string | null
  // Whse-4 bin location(s) from products (migration 105), for the pick list.
  // Comma-joined primary-first; null when the part has no Whse-4 bin record.
  bin_location: string | null
  // PM coverage classification (migration 096). Projected from the
  // parts_requested JSONB: true = covered by the PM agreement (no customer
  // charge), false = billable. NULL for service rows (they use warranty_covered)
  // and for pre-feature PM rows.
  covered_by_agreement: boolean | null
  // Machine the part is for — a ticket-level attribute (migration 090). PM reads
  // the linked equipment row; service COALESCEs inline equipment_* fields over
  // the linked row. null when no equipment is linked / entered.
  machine_make: string | null
  machine_model: string | null
  machine_serial: string | null
  cancelled: boolean
  cancel_reason: string | null
  ordered_at: string | null
  received_at: string | null
  ordered_by: string | null
  received_by: string | null
  // Estimated arrival date for an ordered part (migration 115). The expected
  // receipt date (Synergy poline.DueDate) of the OPEN PO line matching this
  // part's (po_number, product_number), joined from synergy_po_lines. null when
  // the part isn't on an open PO (no PO# yet, or already received/closed).
  po_due_date: string | null
}

// Open SynergyERP purchase-order lines (migration 115), synced by
// scripts/sync/synergy-sync.py. Backs the est-arrival lookup keyed by
// (po_number, product_number). due_date is the expected receipt date.
export type SynergyPoLineRow = {
  po_number: string
  product_number: string
  due_date: string | null
  qty_ordered: number | null
  qty_received: number | null
  order_date: string | null
  whse: number | null
  synced_at: string | null
}

// ============================================================
// Row types (what you get back from SELECT)
// Note: these must be `type` aliases (not `interface`) so they
// satisfy Supabase's `Record<string, unknown>` constraint.
// ============================================================

export type CustomerRow = {
  id: number
  synergy_id: string
  name: string
  account_number: string | null
  ar_terms: string | null
  credit_hold: boolean
  billing_address: string | null
  billing_city: string | null
  billing_state: string | null
  billing_zip: string | null
  po_required: boolean
  active: boolean
  show_pricing_on_pm_pdf: boolean
  auto_approve_threshold: number
  // Per-customer negotiated/bid labor rate overrides (migration 088). NULL =
  // use the global rate (settings) for that labor_rate_type. Customer-billing
  // only — never applied to internal tech-payout (ACE labor) math.
  special_labor_rate_standard: number | null
  special_labor_rate_industrial: number | null
  special_labor_rate_vacuum: number | null
  synced_at: string | null
}

export type ContactRow = {
  id: number
  customer_id: number | null
  synergy_id: string | null
  name: string | null
  email: string | null
  phone: string | null
  is_primary: boolean
}

export type ShipToLocationRow = {
  id: number
  customer_id: number | null
  synergy_customer_code: string
  synergy_shiplist_code: string
  name: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  contact: string | null
  email: string | null
  synced_at: string | null
}

export type ProductRow = {
  id: number
  synergy_id: string
  number: string
  description: string | null
  unit_price: number | null
  // Loaded cost (Synergy CostLoad, CostPO fallback). Internal/server-only —
  // never select this onto a tech-facing payload. Backs the margin floor.
  unit_cost: number | null
  // Catch-all items (e.g. "SHOP SUPPLIES") set this so the parts entry form
  // prompts for a free-text detail of what the supplies were. Manually curated
  // — NOT written by the nightly Synergy sync, so it sticks across syncs.
  requires_detail: boolean
  // Service-dept stock position (Synergy prodwhse, Whse 4), refreshed by the sync.
  // Drives the parts-queue Review step's stock-vs-order signal. Nullable — a
  // part with no Whse-4 stock record (never stocked there) stays null.
  qty_on_hand: number | null
  qty_on_po: number | null
  // Whse-4 bin/shelf location(s) from Synergy prodloc, refreshed by the sync.
  // Comma-joined primary-first when a part sits in >1 bin (e.g. "E5, E5-D").
  // Null = no bin record. Drives the parts pick list.
  bin_location: string | null
  synced_at: string | null
}

export type UserRow = {
  id: string
  email: string
  name: string
  role: UserRole | null
  active: boolean
  created_at: string
  synergy_id: string | null
  hourly_cost: number | null
  must_change_password: boolean
  can_create_service_tickets: boolean
}

export type EquipmentRow = {
  id: string
  customer_id: number | null
  default_technician_id: string | null
  ship_to_location_id: number | null
  make: string | null
  model: string | null
  serial_number: string | null
  description: string | null
  location_on_site: string | null
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  default_products: DefaultProduct[]
  blanket_po_number: string | null
  details_verified_at: string | null
  details_verified_by: string | null
  active: boolean
  created_at: string
  updated_at: string
}

export type PmScheduleRow = {
  id: string
  equipment_id: string | null
  interval_months: number
  anchor_month: number
  starting_year: number
  billing_type: BillingType | null
  flat_rate: number | null
  active: boolean
  created_at: string
}

export type PmTicketRow = {
  id: string
  pm_schedule_id: string | null
  equipment_id: string | null
  customer_id: number | null
  assigned_technician_id: string | null
  created_by_id: string | null
  month: number
  year: number
  status: TicketStatus
  scheduled_date: string | null
  completed_date: string | null
  completion_notes: string | null
  hours_worked: number | null
  parts_used: PartUsed[]
  billing_amount: number | null
  // Trip charge = trip_charge_qty × settings 'trip_charge_amount' rate (mirrors
  // labor). trip_charge_qty = number of trips (migration 107); NULL → default 1
  // (PM is always field work). trip_charge (105, flat dollars) retained, unused.
  trip_charge: number | null
  trip_charge_qty: number | null
  billing_exported: boolean
  customer_signature: string | null
  customer_signature_name: string | null
  photos: TicketPhoto[]
  po_number: string | null
  billing_contact_name: string | null
  billing_contact_email: string | null
  billing_contact_phone: string | null
  work_order_number: number
  additional_parts_used: PartUsed[]
  additional_hours_worked: number | null
  parts_requested: PartRequest[]
  synergy_order_number: string | null
  // SynergyERP invoice number, keyed in after a PM ticket is exported to prove
  // the work order was actually invoiced. Required before a PM ticket can be
  // marked 'billed' (migration 098). One invoice per work order.
  synergy_invoice_number: string | null
  skip_reason: string | null
  skip_previous_status: string | null
  // Structured skip-request fields (migration 080). skip_reason above now
  // holds optional free-text notes; category is the required dropdown value.
  skip_reason_category: string | null
  skip_recommended_month: number | null
  skip_recommended_year: number | null
  skip_equipment_on_site: boolean | null
  machine_hours: number | null
  date_code: string | null
  deleted_at: string | null
  deleted_by_id: string | null
  // Snapshot of customers.show_pricing_on_pm_pdf at completion time. NULL on
  // incomplete tickets and pre-migration-048 historical rows; PDF generator
  // falls back to the live customer flag when null.
  show_pricing: boolean | null
  // Snapshot of the ship-to where this PM is being / was serviced. NULL means
  // the ticket inherits from equipment.ship_to_location_id (legacy pre-049).
  ship_to_location_id: number | null
  // Manager review flag: TRUE when generation found a still-open prior PM for
  // the same equipment. Manager clears via Approve & Keep or Skip.
  requires_review: boolean
  review_reason: string | null
  reviewed_by_id: string | null
  reviewed_at: string | null
  labor_rate_type: string
  // Stamped on the first completion-form auto-save (migration 097). NULL = the
  // form has never been drafted, so the completion view seeds covered/billable
  // parts from received parts_requested; non-NULL = the saved
  // parts_used/additional_parts_used are authoritative and win. Guards against
  // a deleted (un-billed) part silently re-seeding on reopen.
  completion_seeded_at: string | null
  // Stamped when the whole order's parts are staged and the tech was notified
  // (migration 104). Reset to NULL if the order later falls out of fully-staged.
  parts_ready_notified_at: string | null
  created_at: string
  updated_at: string
}

export type EquipmentNoteRow = {
  id: string
  equipment_id: string
  user_id: string
  note_text: string
  created_at: string
}

export type CreditReviewStatus = 'pending' | 'released' | 'blocked'
export type CreditReviewTicketType = 'pm' | 'service'

export type CreditReviewRow = {
  id: string
  ticket_type: CreditReviewTicketType
  pm_ticket_id: string | null
  service_ticket_id: string | null
  customer_id: number
  status: CreditReviewStatus
  action_token: string | null
  action_token_expires_at: string | null
  decided_by_name: string | null
  decided_at: string | null
  block_reason: string | null
  email_message_id: string | null
  emailed_at: string | null
  unblocked_by_id: string | null
  unblocked_at: string | null
  auto_released_at: string | null
  updated_by_id: string | null
  created_at: string
  updated_at: string
}

export type CreditReviewInsert = Pick<
  CreditReviewRow,
  'ticket_type' | 'customer_id'
> &
  Partial<Omit<CreditReviewRow, 'id' | 'created_at' | 'updated_at'>>

export type CreditReviewUpdate = Partial<Omit<CreditReviewRow, 'id' | 'created_at'>>

export type CustomerNoteRow = {
  id: string
  customer_id: number
  user_id: string
  note_text: string
  created_at: string
}

export type TechnicianTargetRow = {
  id: string
  technician_id: string | null
  metric: string
  target_value: number
  period_type: string
  effective_from: string
  active: boolean
  created_at: string
  updated_at: string
}

export type EquipmentProspectRow = {
  id: string
  equipment_id: string
  is_prospect: boolean
  removed: boolean
  removal_reason: string | null
  removal_note: string | null
  removed_at: string | null
  removed_by: string | null
  created_at: string
  updated_at: string
}

export type SyncLogRow = {
  id: number
  sync_type: SyncType | null
  started_at: string
  completed_at: string | null
  records_synced: number | null
  status: SyncStatus | null
  error_message: string | null
}

export type TechLeadRow = {
  id: string
  lead_type: TechLeadType
  submitted_by: string
  submitted_at: string
  customer_id: number | null
  customer_name_text: string | null
  equipment_description: string
  proposed_pm_frequency: TechLeadFrequency | null
  // Structured equipment fields (migration 073). Required on PM leads
  // submitted from 2026-05-14 onward; NULL on legacy PM rows and on
  // equipment_sale rows.
  make: string | null
  model: string | null
  serial_number: string | null
  location_on_site: string | null
  proposed_start_month: number | null
  proposed_start_year: number | null
  // V2 equipment-sale fields (migration 039). NULL for PM leads.
  proposed_equipment_tier: EquipmentSaleTier | null
  sale_equipment_tier: EquipmentSaleTier | null
  sale_synergy_order_number: number | null
  expires_at: string | null
  notes: string | null
  status: TechLeadStatus
  approved_by: string | null
  approved_at: string | null
  rejected_reason: string | null
  cancelled_reason: string | null
  equipment_id: string | null
  bonus_amount: number | null
  earned_at: string | null
  earned_from_ticket_id: string | null
  paid_at: string | null
  paid_by: string | null
  payout_period: string | null
  // Lead contact captured at submission (migration 052). Optional fields; the
  // submit form requires name + at least one of email/phone for new entries
  // but legacy rows may have them all NULL.
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  // Machine photos uploaded at submission. Stored under
  // `leads/{tech_lead_id}/{uuid}.jpg` in the shared `ticket-photos` bucket.
  photos: TicketPhoto[]
  // Rep-forward audit (migration 064 + 066). Set when the lead is approved
  // via /api/tech-leads/[id]/approve-and-email. emailed_to_rep_at is the
  // idempotency guard against duplicate sends; emailed_cc_ids is the list of
  // managers CC'd on the send.
  emailed_to_rep_id: string | null
  emailed_to_rep_at: string | null
  email_rep_message_id: string | null
  emailed_cc_ids: string[]
  // Submission-notify audit (migration 092). Set non-fatally by POST
  // /api/tech-leads after the "new lead" email to active managers is sent.
  submit_notified_at: string | null
  submit_notify_message_id: string | null
  created_at: string
  updated_at: string
}

export type EquipmentSaleOrderLine = {
  prod_code: string
  description: string | null
  qty: number | null
  unit_price: number | null
  comdty_code: string | null
}

export type EquipmentSaleLeadCandidateRow = {
  id: string
  tech_lead_id: string
  synergy_order_number: number
  synergy_order_date: string
  synergy_order_total: number | null
  order_lines: EquipmentSaleOrderLine[]
  status: EquipmentSaleCandidateStatus
  detected_at: string
  reviewed_by: string | null
  reviewed_at: string | null
}

export type ShipToRequestStatus = 'pending' | 'resolved' | 'dismissed'

export type ShipToRequestRow = {
  id: number
  customer_id: number
  requested_by: string
  pm_ticket_id: string | null
  equipment_id: string | null
  note: string
  status: ShipToRequestStatus
  requested_at: string
  resolved_at: string | null
  resolved_ship_to_id: number | null
  resolved_by: string | null
}

export type EquipmentLocationHistoryRow = {
  id: number
  equipment_id: string
  from_ship_to_id: number | null
  to_ship_to_id: number
  changed_by: string
  changed_at: string
  pm_ticket_id: string | null
  service_ticket_id: string | null
  note: string | null
}

// ============================================================
// Helper: make some keys optional
// ============================================================

type MakeOptional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>

// ============================================================
// Insert types (omit auto-generated fields, optional for DB defaults)
// ============================================================

export type CustomerInsert = MakeOptional<
  Omit<CustomerRow, 'id'>,
  'credit_hold' | 'synced_at' | 'account_number' | 'ar_terms' | 'billing_address' | 'billing_city' | 'billing_state' | 'billing_zip' | 'po_required' | 'active' | 'special_labor_rate_standard' | 'special_labor_rate_industrial' | 'special_labor_rate_vacuum'
>

export type ContactInsert = MakeOptional<
  Omit<ContactRow, 'id'>,
  'is_primary' | 'customer_id' | 'synergy_id' | 'name' | 'email' | 'phone'
>

export type ProductInsert = MakeOptional<
  Omit<ProductRow, 'id'>,
  'synced_at' | 'description' | 'unit_price' | 'unit_cost' | 'requires_detail' | 'qty_on_hand' | 'qty_on_po' | 'bin_location'
>

export type UserInsert = MakeOptional<
  Omit<UserRow, 'id' | 'created_at'>,
  'active' | 'synergy_id' | 'hourly_cost' | 'must_change_password' | 'can_create_service_tickets'
>

export type EquipmentInsert = MakeOptional<
  Omit<EquipmentRow, 'id' | 'created_at' | 'updated_at'>,
  'active' | 'customer_id' | 'default_technician_id' | 'ship_to_location_id' | 'make' | 'model' | 'serial_number' | 'description' | 'location_on_site' | 'contact_name' | 'contact_email' | 'contact_phone' | 'default_products' | 'blanket_po_number' | 'details_verified_at' | 'details_verified_by'
>

export type PmScheduleInsert = MakeOptional<
  Omit<PmScheduleRow, 'id' | 'created_at'>,
  'active' | 'equipment_id' | 'interval_months' | 'anchor_month' | 'starting_year' | 'billing_type' | 'flat_rate'
>

export type PmTicketInsert = MakeOptional<
  Omit<PmTicketRow, 'id' | 'created_at' | 'updated_at'>,
  'status' | 'billing_exported' | 'parts_used' | 'pm_schedule_id' | 'equipment_id' | 'customer_id' | 'assigned_technician_id' | 'created_by_id' | 'scheduled_date' | 'completed_date' | 'completion_notes' | 'hours_worked' | 'billing_amount' | 'trip_charge' | 'trip_charge_qty' | 'work_order_number' | 'additional_parts_used' | 'additional_hours_worked' | 'customer_signature' | 'customer_signature_name' | 'photos' | 'po_number' | 'billing_contact_name' | 'billing_contact_email' | 'billing_contact_phone' | 'skip_reason' | 'skip_previous_status' | 'skip_reason_category' | 'skip_recommended_month' | 'skip_recommended_year' | 'skip_equipment_on_site' | 'parts_requested' | 'synergy_order_number' | 'synergy_invoice_number' | 'machine_hours' | 'date_code' | 'deleted_at' | 'deleted_by_id' | 'show_pricing' | 'ship_to_location_id' | 'requires_review' | 'review_reason' | 'reviewed_by_id' | 'reviewed_at' | 'labor_rate_type' | 'completion_seeded_at' | 'parts_ready_notified_at'
>

export type SettingsRow = {
  key: string
  value: string
  updated_at: string
}

// Web Push subscriptions (migration 114). One row per browser/device a user has
// opted into push on; endpoint is the unique key.
export type PushSubscriptionRow = {
  id: string
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
  user_agent: string | null
  created_at: string
  last_used_at: string | null
}

export type PushSubscriptionInsert = {
  id?: string
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
  user_agent?: string | null
  created_at?: string
  last_used_at?: string | null
}

// In-app notifications (migration 116). One row per recipient per event; the
// notification bell reads these. read_at NULL = unread.
export type NotificationRow = {
  id: string
  user_id: string
  type: string
  title: string
  body: string | null
  url: string | null
  entity_type: string | null
  entity_id: string | null
  read_at: string | null
  created_at: string
}

export type NotificationInsert = {
  id?: string
  user_id: string
  type: string
  title: string
  body?: string | null
  url?: string | null
  entity_type?: string | null
  entity_id?: string | null
  read_at?: string | null
  created_at?: string
}

// Permanent per-equipment estimate snapshot, written when a service estimate is
// declined (migration 117). Durable copy that survives the ticket being reopened
// or re-quoted, so a returning unit always shows what was previously estimated.
export type EquipmentEstimateLogRow = {
  id: string
  equipment_id: string
  service_ticket_id: string | null
  work_order_number: number | null
  estimate_amount: number | null
  problem_description: string | null
  diagnosis_notes: string | null
  outcome: string
  decline_reason: string | null
  technician_id: string | null
  created_at: string
}

export type EquipmentEstimateLogInsert = {
  id?: string
  equipment_id: string
  service_ticket_id?: string | null
  work_order_number?: number | null
  estimate_amount?: number | null
  problem_description?: string | null
  diagnosis_notes?: string | null
  outcome?: string
  decline_reason?: string | null
  technician_id?: string | null
  created_at?: string
}

export type SyncLogInsert = Omit<SyncLogRow, 'id'>

// Tech lead insert — caller supplies submitter + content; everything else is
// auto-defaulted or set later by approve / earn / pay flows.
export type TechLeadInsert = Pick<TechLeadRow, 'submitted_by' | 'equipment_description'> &
  Partial<Pick<TechLeadRow,
    'lead_type' | 'submitted_at' | 'customer_id' | 'customer_name_text' |
    'proposed_pm_frequency' | 'proposed_equipment_tier' | 'expires_at' |
    'notes' | 'status' |
    'contact_name' | 'contact_email' | 'contact_phone' | 'photos' |
    'make' | 'model' | 'serial_number' | 'location_on_site' |
    'proposed_start_month' | 'proposed_start_year'
  >>

export type EquipmentSaleLeadCandidateInsert = Pick<EquipmentSaleLeadCandidateRow,
  'tech_lead_id' | 'synergy_order_number' | 'synergy_order_date'
> & Partial<Pick<EquipmentSaleLeadCandidateRow,
  'synergy_order_total' | 'order_lines' | 'status' | 'detected_at'
>>

export type EquipmentSaleLeadCandidateUpdate = Partial<Omit<EquipmentSaleLeadCandidateRow, 'id' | 'tech_lead_id'>>

// ============================================================
// Update types (all fields optional)
// ============================================================

export type CustomerUpdate = Partial<Omit<CustomerRow, 'id'>>

export type ContactUpdate = Partial<Omit<ContactRow, 'id'>>

export type ProductUpdate = Partial<Omit<ProductRow, 'id'>>

export type UserUpdate = Partial<Omit<UserRow, 'id' | 'created_at'>>

export type EquipmentUpdate = Partial<Omit<EquipmentRow, 'id' | 'created_at' | 'updated_at'>>

export type PmScheduleUpdate = Partial<Omit<PmScheduleRow, 'id' | 'created_at'>>

export type PmTicketUpdate = Partial<Omit<PmTicketRow, 'id' | 'created_at' | 'updated_at'>>

export type SyncLogUpdate = Partial<Omit<SyncLogRow, 'id'>>

export type TechLeadUpdate = Partial<Omit<TechLeadRow, 'id' | 'created_at' | 'updated_at'>>

// ============================================================
// Shop-supply requests (migration 123)
// ============================================================

// Manager-editable quick-pick list of common shop consumables.
export type SupplyCatalogRow = {
  id: string
  name: string
  unit: string | null
  sort_order: number
  active: boolean
  created_at: string
  updated_at: string
}

export type SupplyCatalogInsert = MakeOptional<
  Omit<SupplyCatalogRow, 'id' | 'created_at' | 'updated_at'>,
  'unit' | 'sort_order' | 'active'
>

export type SupplyCatalogUpdate = Partial<Omit<SupplyCatalogRow, 'id' | 'created_at' | 'updated_at'>>

export type SupplyRequestStatus = 'pending' | 'ready' | 'picked_up' | 'denied'

// One line on a request. catalog_id links a quick-pick item; free-text "other"
// items leave it null. unit is copied from the catalog for display.
export type SupplyRequestItem = {
  name: string
  quantity: number
  catalog_id?: string | null
  unit?: string | null
}

export type SupplyRequestRow = {
  id: string
  requested_by: string
  items: SupplyRequestItem[]
  note: string | null
  status: SupplyRequestStatus
  denied_reason: string | null
  ready_at: string | null
  ready_by: string | null
  ready_notified_at: string | null
  picked_up_at: string | null
  picked_up_by: string | null
  denied_at: string | null
  denied_by: string | null
  created_at: string
  updated_at: string
}

// A tech inserts requested_by + items (+ optional note); the rest defaults.
export type SupplyRequestInsert = MakeOptional<
  Omit<SupplyRequestRow, 'id' | 'created_at' | 'updated_at'>,
  | 'note' | 'status' | 'denied_reason'
  | 'ready_at' | 'ready_by' | 'ready_notified_at'
  | 'picked_up_at' | 'picked_up_by' | 'denied_at' | 'denied_by'
>

export type SupplyRequestUpdate = Partial<Omit<SupplyRequestRow, 'id' | 'created_at' | 'updated_at'>>

// ============================================================
// Supabase Database type
// ============================================================

export interface Database {
  public: {
    Tables: {
      customers: {
        Row: CustomerRow
        Insert: CustomerInsert
        Update: CustomerUpdate
        Relationships: [
          {
            foreignKeyName: 'contacts_customer_id_fkey'
            columns: ['id']
            isOneToOne: false
            referencedRelation: 'contacts'
            referencedColumns: ['customer_id']
          },
        ]
      }
      contacts: {
        Row: ContactRow
        Insert: ContactInsert
        Update: ContactUpdate
        Relationships: [
          {
            foreignKeyName: 'contacts_customer_id_fkey'
            columns: ['customer_id']
            isOneToOne: false
            referencedRelation: 'customers'
            referencedColumns: ['id']
          },
        ]
      }
      ship_to_locations: {
        Row: ShipToLocationRow
        Insert: Omit<ShipToLocationRow, 'id'>
        Update: Partial<Omit<ShipToLocationRow, 'id'>>
        Relationships: [
          {
            foreignKeyName: 'ship_to_locations_customer_id_fkey'
            columns: ['customer_id']
            isOneToOne: false
            referencedRelation: 'customers'
            referencedColumns: ['id']
          },
        ]
      }
      products: {
        Row: ProductRow
        Insert: ProductInsert
        Update: ProductUpdate
        Relationships: []
      }
      synergy_po_lines: {
        Row: SynergyPoLineRow
        Insert: SynergyPoLineRow
        Update: Partial<SynergyPoLineRow>
        Relationships: []
      }
      users: {
        Row: UserRow
        Insert: UserInsert
        Update: UserUpdate
        Relationships: []
      }
      equipment: {
        Row: EquipmentRow
        Insert: EquipmentInsert
        Update: EquipmentUpdate
        Relationships: [
          {
            foreignKeyName: 'equipment_customer_id_fkey'
            columns: ['customer_id']
            isOneToOne: false
            referencedRelation: 'customers'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'equipment_default_technician_id_fkey'
            columns: ['default_technician_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'equipment_ship_to_location_id_fkey'
            columns: ['ship_to_location_id']
            isOneToOne: false
            referencedRelation: 'ship_to_locations'
            referencedColumns: ['id']
          },
        ]
      }
      pm_schedules: {
        Row: PmScheduleRow
        Insert: PmScheduleInsert
        Update: PmScheduleUpdate
        Relationships: [
          {
            foreignKeyName: 'pm_schedules_equipment_id_fkey'
            columns: ['equipment_id']
            isOneToOne: false
            referencedRelation: 'equipment'
            referencedColumns: ['id']
          },
        ]
      }
      pm_tickets: {
        Row: PmTicketRow
        Insert: PmTicketInsert
        Update: PmTicketUpdate
        Relationships: [
          {
            foreignKeyName: 'pm_tickets_pm_schedule_id_fkey'
            columns: ['pm_schedule_id']
            isOneToOne: false
            referencedRelation: 'pm_schedules'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'pm_tickets_equipment_id_fkey'
            columns: ['equipment_id']
            isOneToOne: false
            referencedRelation: 'equipment'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'pm_tickets_customer_id_fkey'
            columns: ['customer_id']
            isOneToOne: false
            referencedRelation: 'customers'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'pm_tickets_assigned_technician_id_fkey'
            columns: ['assigned_technician_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'pm_tickets_created_by_id_fkey'
            columns: ['created_by_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'pm_tickets_deleted_by_id_fkey'
            columns: ['deleted_by_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      settings: {
        Row: SettingsRow
        Insert: SettingsRow
        Update: Partial<SettingsRow>
        Relationships: []
      }
      push_subscriptions: {
        Row: PushSubscriptionRow
        Insert: PushSubscriptionInsert
        Update: Partial<PushSubscriptionInsert>
        Relationships: [
          {
            foreignKeyName: 'push_subscriptions_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          }
        ]
      }
      notifications: {
        Row: NotificationRow
        Insert: NotificationInsert
        Update: Partial<NotificationInsert>
        Relationships: [
          {
            foreignKeyName: 'notifications_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          }
        ]
      }
      equipment_estimate_log: {
        Row: EquipmentEstimateLogRow
        Insert: EquipmentEstimateLogInsert
        Update: Partial<EquipmentEstimateLogInsert>
        Relationships: [
          {
            foreignKeyName: 'equipment_estimate_log_equipment_id_fkey'
            columns: ['equipment_id']
            isOneToOne: false
            referencedRelation: 'equipment'
            referencedColumns: ['id']
          }
        ]
      }
      credit_reviews: {
        Row: CreditReviewRow
        Insert: CreditReviewInsert
        Update: CreditReviewUpdate
        Relationships: [
          {
            foreignKeyName: 'credit_reviews_pm_ticket_id_fkey'
            columns: ['pm_ticket_id']
            isOneToOne: false
            referencedRelation: 'pm_tickets'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'credit_reviews_service_ticket_id_fkey'
            columns: ['service_ticket_id']
            isOneToOne: false
            referencedRelation: 'service_tickets'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'credit_reviews_customer_id_fkey'
            columns: ['customer_id']
            isOneToOne: false
            referencedRelation: 'customers'
            referencedColumns: ['id']
          },
        ]
      }
      equipment_notes: {
        Row: EquipmentNoteRow
        Insert: Omit<EquipmentNoteRow, 'id' | 'created_at'>
        Update: never
        Relationships: [
          {
            foreignKeyName: 'equipment_notes_equipment_id_fkey'
            columns: ['equipment_id']
            isOneToOne: false
            referencedRelation: 'equipment'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'equipment_notes_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      customer_notes: {
        Row: CustomerNoteRow
        Insert: Omit<CustomerNoteRow, 'id' | 'created_at'>
        Update: never
        Relationships: [
          {
            foreignKeyName: 'customer_notes_customer_id_fkey'
            columns: ['customer_id']
            isOneToOne: false
            referencedRelation: 'customers'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'customer_notes_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      equipment_prospects: {
        Row: EquipmentProspectRow
        Insert: Pick<EquipmentProspectRow, 'equipment_id' | 'is_prospect' | 'removed'> & Partial<Pick<EquipmentProspectRow, 'removal_reason' | 'removal_note' | 'removed_at' | 'removed_by'>>
        Update: Partial<Omit<EquipmentProspectRow, 'id' | 'equipment_id' | 'created_at'>>
        Relationships: [
          {
            foreignKeyName: 'equipment_prospects_equipment_id_fkey'
            columns: ['equipment_id']
            isOneToOne: true
            referencedRelation: 'equipment'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'equipment_prospects_removed_by_fkey'
            columns: ['removed_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      technician_targets: {
        Row: TechnicianTargetRow
        Insert: Pick<TechnicianTargetRow, 'metric' | 'target_value' | 'period_type'> & Partial<Pick<TechnicianTargetRow, 'technician_id' | 'effective_from' | 'active'>>
        Update: Partial<Omit<TechnicianTargetRow, 'id' | 'created_at'>>
        Relationships: [
          {
            foreignKeyName: 'technician_targets_technician_id_fkey'
            columns: ['technician_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      sync_log: {
        Row: SyncLogRow
        Insert: SyncLogInsert
        Update: SyncLogUpdate
        Relationships: []
      }
      service_tickets: {
        Row: import('@/types/service-tickets').ServiceTicketRow
        Insert: import('@/types/service-tickets').ServiceTicketInsert
        Update: import('@/types/service-tickets').ServiceTicketUpdate
        Relationships: [
          {
            foreignKeyName: 'service_tickets_customer_id_fkey'
            columns: ['customer_id']
            isOneToOne: false
            referencedRelation: 'customers'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'service_tickets_equipment_id_fkey'
            columns: ['equipment_id']
            isOneToOne: false
            referencedRelation: 'equipment'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'service_tickets_assigned_technician_id_fkey'
            columns: ['assigned_technician_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'service_tickets_created_by_id_fkey'
            columns: ['created_by_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      tech_leads: {
        Row: TechLeadRow
        Insert: TechLeadInsert
        Update: TechLeadUpdate
        Relationships: [
          {
            foreignKeyName: 'tech_leads_submitted_by_fkey'
            columns: ['submitted_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'tech_leads_customer_id_fkey'
            columns: ['customer_id']
            isOneToOne: false
            referencedRelation: 'customers'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'tech_leads_approved_by_fkey'
            columns: ['approved_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'tech_leads_equipment_id_fkey'
            columns: ['equipment_id']
            isOneToOne: false
            referencedRelation: 'equipment'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'tech_leads_earned_from_ticket_id_fkey'
            columns: ['earned_from_ticket_id']
            isOneToOne: false
            referencedRelation: 'pm_tickets'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'tech_leads_paid_by_fkey'
            columns: ['paid_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      equipment_sale_lead_candidates: {
        Row: EquipmentSaleLeadCandidateRow
        Insert: EquipmentSaleLeadCandidateInsert
        Update: EquipmentSaleLeadCandidateUpdate
        Relationships: [
          {
            foreignKeyName: 'equipment_sale_lead_candidates_tech_lead_id_fkey'
            columns: ['tech_lead_id']
            isOneToOne: false
            referencedRelation: 'tech_leads'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'equipment_sale_lead_candidates_reviewed_by_fkey'
            columns: ['reviewed_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      ship_to_requests: {
        Row: ShipToRequestRow
        Insert: Pick<ShipToRequestRow, 'customer_id' | 'requested_by' | 'note'> &
          Partial<Pick<ShipToRequestRow, 'pm_ticket_id' | 'equipment_id' | 'status'>>
        Update: Partial<Omit<ShipToRequestRow, 'id' | 'requested_at'>>
        Relationships: []
      }
      equipment_location_history: {
        Row: EquipmentLocationHistoryRow
        Insert: Omit<EquipmentLocationHistoryRow, 'id' | 'changed_at'> & { changed_at?: string }
        Update: never
        Relationships: []
      }
      ace_labor_entries: {
        Row: AceLaborEntryRow
        Insert: AceLaborEntryInsert
        Update: AceLaborEntryUpdate
        Relationships: []
      }
      sales_reps: {
        Row: SalesRep
        Insert: SalesRepInsert
        Update: SalesRepUpdate
        Relationships: []
      }
      vendors: {
        Row: Vendor
        Insert: VendorInsert
        Update: VendorUpdate
        Relationships: []
      }
      revalidation_queue: {
        Row: RevalidationQueueRow
        Insert: RevalidationQueueInsert
        Update: RevalidationQueueUpdate
        Relationships: []
      }
      supply_catalog: {
        Row: SupplyCatalogRow
        Insert: SupplyCatalogInsert
        Update: SupplyCatalogUpdate
        Relationships: []
      }
      supply_requests: {
        Row: SupplyRequestRow
        Insert: SupplyRequestInsert
        Update: SupplyRequestUpdate
        Relationships: [
          {
            foreignKeyName: 'supply_requests_requested_by_fkey'
            columns: ['requested_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: {
      parts_order_queue: {
        Row: PartsQueueRow
        Relationships: []
      }
    }
    Functions: {
      // Migration 074 — transactional RPCs used by Round F.
      fn_complete_pm_ticket: {
        Args: { p_payload: Record<string, unknown> }
        Returns: Record<string, unknown>
      }
      fn_update_parts_queue: {
        Args: {
          p_source: string
          p_ticket_id: string
          p_expected_updated_at: string
          p_update_payload: Record<string, unknown>
        }
        Returns: Record<string, unknown>
      }
      fn_approve_tech_lead_email: {
        Args: {
          p_lead_id: string
          p_approver_id: string
          p_rep_id: string
          p_cc_ids: string[]
          p_message_id: string
        }
        Returns: Record<string, unknown>
      }
    }
    Enums: {
      user_role: UserRole
      ticket_status: TicketStatus
      billing_type: BillingType
      sync_type: SyncType
      sync_status: SyncStatus
    }
  }
}
