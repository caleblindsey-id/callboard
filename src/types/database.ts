// ============================================================
// Enums
// ============================================================

export type UserRole = 'manager' | 'coordinator' | 'technician'

export type TicketStatus = 'unassigned' | 'assigned' | 'in_progress' | 'completed' | 'billed' | 'skipped'

export type BillingType = 'flat_rate' | 'time_and_materials' | 'contract'

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
  po_required: boolean
  active: boolean
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
  parent_ticket_id: string | null
  ticket_type: 'pm' | 'service_request'
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

// ============================================================
// Helper: make some keys optional
// ============================================================

type MakeOptional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>

// ============================================================
// Insert types (omit auto-generated fields, optional for DB defaults)
// ============================================================

export type CustomerInsert = MakeOptional<
  Omit<CustomerRow, 'id'>,
  'credit_hold' | 'synced_at' | 'account_number' | 'ar_terms' | 'billing_address' | 'po_required' | 'active'
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
  'active' | 'synergy_id'
>

export type EquipmentInsert = MakeOptional<
  Omit<EquipmentRow, 'id' | 'created_at' | 'updated_at'>,
  'active' | 'customer_id' | 'default_technician_id' | 'ship_to_location_id' | 'make' | 'model' | 'serial_number' | 'description' | 'location_on_site'
>

export type PmScheduleInsert = MakeOptional<
  Omit<PmScheduleRow, 'id' | 'created_at'>,
  'active' | 'equipment_id' | 'interval_months' | 'anchor_month' | 'billing_type' | 'flat_rate'
>

export type PmTicketInsert = MakeOptional<
  Omit<PmTicketRow, 'id' | 'created_at' | 'updated_at'>,
  'status' | 'billing_exported' | 'parts_used' | 'pm_schedule_id' | 'equipment_id' | 'customer_id' | 'assigned_technician_id' | 'created_by_id' | 'scheduled_date' | 'completed_date' | 'completion_notes' | 'hours_worked' | 'billing_amount' | 'parent_ticket_id' | 'ticket_type' | 'customer_signature' | 'customer_signature_name'
>

export type SettingsRow = {
  key: string
  value: string
  updated_at: string
}

export type SyncLogInsert = Omit<SyncLogRow, 'id'>

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
      sync_log: {
        Row: SyncLogRow
        Insert: SyncLogInsert
        Update: SyncLogUpdate
        Relationships: []
      }
    }
    Views: {}
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
