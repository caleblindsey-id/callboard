// Service ticket types — separate from PM ticket types in database.ts

import type { PartUsed, TicketPhoto } from './database'

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
  | 'time_and_materials'
  | 'warranty'
  | 'partial_warranty'

export type ServiceTicketType = 'inside' | 'outside'

export type ServicePriority = 'emergency' | 'standard' | 'low'

// --- Parts Request ---

export interface PartRequest {
  description: string
  quantity: number
  product_number?: string
  status: 'requested' | 'ordered' | 'received'
}

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
  parts_requested: PartRequest[]
  parts_received: boolean
  synergy_order_number: string | null
  synergy_po_number: string | null
  started_at: string | null
  completed_at: string | null
  hours_worked: number | null
  parts_used: ServicePartUsed[]
  warranty_labor_covered: boolean
  completion_notes: string | null
  customer_signature: string | null
  customer_signature_name: string | null
  photos: TicketPhoto[]
  billing_amount: number | null
  diagnostic_charge: number | null
  awaiting_pickup: boolean
  picked_up_at: string | null
  work_order_number: number | null
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
  customers: { name: string; account_number: string | null } | null
  equipment: {
    make: string | null
    model: string | null
    serial_number: string | null
    description: string | null
    ship_to_locations: {
      name: string | null
      address: string | null
      city: string | null
      state: string | null
      zip: string | null
    } | null
  } | null
  assigned_technician: { name: string } | null
}

export type ServiceTicketDetail = ServiceTicketRow & {
  customers: {
    name: string
    account_number: string | null
    po_required: boolean
    ar_terms: string | null
    credit_hold: boolean
  } | null
  equipment: {
    make: string | null
    model: string | null
    serial_number: string | null
    description: string | null
    ship_to_locations: {
      name: string | null
      address: string | null
      city: string | null
      state: string | null
      zip: string | null
    } | null
  } | null
  assigned_technician: { name: string } | null
  created_by: { name: string } | null
}

// --- Status Transition Map ---

export const SERVICE_VALID_TRANSITIONS: Record<ServiceTicketStatus, ServiceTicketStatus[]> = {
  open:        ['estimated', 'in_progress', 'canceled'],
  estimated:   ['approved', 'declined', 'canceled'],
  approved:    ['in_progress', 'canceled'],
  in_progress: ['completed', 'open', 'canceled'],
  completed:   ['billed', 'open'],
  billed:      ['open'],
  declined:    ['open'],
  canceled:    ['open'],
}

// Manager-only transitions (reopen from any state, cancel)
export const SERVICE_MANAGER_ONLY_TARGETS: ServiceTicketStatus[] = ['open', 'canceled']

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
