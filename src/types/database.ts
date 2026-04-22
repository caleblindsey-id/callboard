// ============================================================
// Enums
// ============================================================

export type UserRole = 'super_admin' | 'manager' | 'coordinator' | 'technician'

// Role group constants — importable by both server and client code
export const MANAGER_ROLES: UserRole[] = ['super_admin', 'manager', 'coordinator']
export const RESET_ROLES: UserRole[] = ['super_admin', 'manager']
export const ADMIN_ROLES: UserRole[] = ['super_admin']

export type TicketStatus = 'unassigned' | 'assigned' | 'in_progress' | 'completed' | 'billed' | 'skipped' | 'skip_requested'

export type BillingType = 'flat_rate' | 'time_and_materials' | 'contract'

export type TechLeadType = 'pm' | 'equipment_sale'

export type TechLeadStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'earned' | 'paid'

// Proposed-frequency options a tech can pick on the submit form.
export type TechLeadFrequency = 'monthly' | 'bi-monthly' | 'quarterly' | 'semi-annual' | 'annual'

// Schedule interval_months values that earn a bonus (monthly, bi-monthly, quarterly).
export const BONUS_ELIGIBLE_INTERVAL_MONTHS = [1, 2, 3] as const

export type SyncType = 'customers' | 'contacts' | 'products' | 'full'

export type SyncStatus = 'running' | 'success' | 'failed'

// ============================================================
// JSONB Part type
// ============================================================

export interface PartUsed {
  synergy_product_id: number | null
  quantity: number
  description: string
  unit_price: number
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

export interface PartRequest {
  description: string
  quantity: number
  // Synergy item number (display string, e.g. "146400019"). Source of truth for billing.
  product_number?: string
  // Int form of products.synergy_id — set when the office picks a catalog match.
  // Same convention as PartUsed.synergy_product_id (Number(products.synergy_id)).
  synergy_product_id?: number | null
  po_number?: string
  status: 'requested' | 'ordered' | 'received'
  // Vendor the part comes from (free-text, surfaced on the Parts Queue page).
  vendor?: string
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
}

// ============================================================
// Parts Queue view row — one row per part request across PM + service.
// Backed by the parts_order_queue view (migration 036). Read-only.
// ============================================================

export type PartsQueueSource = 'pm' | 'service'

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
  requested_at: string
  description: string | null
  quantity: number | null
  vendor: string | null
  product_number: string | null
  synergy_product_id: number | null
  po_number: string | null
  status: 'requested' | 'ordered' | 'received'
  cancelled: boolean
  cancel_reason: string | null
  ordered_at: string | null
  received_at: string | null
  ordered_by: string | null
  received_by: string | null
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
  active: boolean
  created_at: string
  updated_at: string
}

export type PmScheduleRow = {
  id: string
  equipment_id: string | null
  interval_months: number
  anchor_month: number
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
  skip_reason: string | null
  skip_previous_status: string | null
  machine_hours: number | null
  date_code: string | null
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
  created_at: string
  updated_at: string
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
  'credit_hold' | 'synced_at' | 'account_number' | 'ar_terms' | 'billing_address' | 'billing_city' | 'billing_state' | 'billing_zip' | 'po_required' | 'active'
>

export type ContactInsert = MakeOptional<
  Omit<ContactRow, 'id'>,
  'is_primary' | 'customer_id' | 'synergy_id' | 'name' | 'email' | 'phone'
>

export type ProductInsert = MakeOptional<
  Omit<ProductRow, 'id'>,
  'synced_at' | 'description' | 'unit_price'
>

export type UserInsert = MakeOptional<
  Omit<UserRow, 'id' | 'created_at'>,
  'active' | 'synergy_id' | 'hourly_cost' | 'must_change_password'
>

export type EquipmentInsert = MakeOptional<
  Omit<EquipmentRow, 'id' | 'created_at' | 'updated_at'>,
  'active' | 'customer_id' | 'default_technician_id' | 'ship_to_location_id' | 'make' | 'model' | 'serial_number' | 'description' | 'location_on_site' | 'contact_name' | 'contact_email' | 'contact_phone' | 'default_products' | 'blanket_po_number'
>

export type PmScheduleInsert = MakeOptional<
  Omit<PmScheduleRow, 'id' | 'created_at'>,
  'active' | 'equipment_id' | 'interval_months' | 'anchor_month' | 'billing_type' | 'flat_rate'
>

export type PmTicketInsert = MakeOptional<
  Omit<PmTicketRow, 'id' | 'created_at' | 'updated_at'>,
  'status' | 'billing_exported' | 'parts_used' | 'pm_schedule_id' | 'equipment_id' | 'customer_id' | 'assigned_technician_id' | 'created_by_id' | 'scheduled_date' | 'completed_date' | 'completion_notes' | 'hours_worked' | 'billing_amount' | 'work_order_number' | 'additional_parts_used' | 'additional_hours_worked' | 'customer_signature' | 'customer_signature_name' | 'photos' | 'po_number' | 'billing_contact_name' | 'billing_contact_email' | 'billing_contact_phone' | 'skip_reason' | 'skip_previous_status' | 'parts_requested' | 'synergy_order_number' | 'machine_hours' | 'date_code'
>

export type SettingsRow = {
  key: string
  value: string
  updated_at: string
}

export type SyncLogInsert = Omit<SyncLogRow, 'id'>

// Tech lead insert — caller supplies submitter + content; everything else is
// auto-defaulted or set later by approve / earn / pay flows.
export type TechLeadInsert = Pick<TechLeadRow, 'submitted_by' | 'equipment_description'> &
  Partial<Pick<TechLeadRow,
    'lead_type' | 'submitted_at' | 'customer_id' | 'customer_name_text' |
    'proposed_pm_frequency' | 'notes' | 'status'
  >>

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
        ]
      }
      settings: {
        Row: SettingsRow
        Insert: SettingsRow
        Update: Partial<SettingsRow>
        Relationships: []
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
    }
    Views: {
      parts_order_queue: {
        Row: PartsQueueRow
        Relationships: []
      }
    }
    Functions: {}
    Enums: {
      user_role: UserRole
      ticket_status: TicketStatus
      billing_type: BillingType
      sync_type: SyncType
      sync_status: SyncStatus
    }
  }
}
