// ============================================================
// Enums
// ============================================================

export type UserRole = 'manager' | 'coordinator' | 'technician'

export type TicketStatus = 'unassigned' | 'assigned' | 'in_progress' | 'completed' | 'billed'

export type PmFrequency = 'monthly' | 'quarterly' | 'semi-annual' | 'annual'

export type BillingType = 'flat_rate' | 'time_and_materials' | 'contract'

export type SyncType = 'customers' | 'contacts' | 'products' | 'full'

export type SyncStatus = 'running' | 'success' | 'failed'

// ============================================================
// JSONB Part type
// ============================================================

export interface PartUsed {
  synergy_product_id: number
  quantity: number
  description: string
  unit_price: number
}

// ============================================================
// Row types (what you get back from SELECT)
// ============================================================

export interface CustomerRow {
  id: number
  synergy_id: string
  name: string
  account_number: string | null
  ar_terms: string | null
  credit_hold: boolean
  billing_address: string | null
  synced_at: string | null
}

export interface ContactRow {
  id: number
  customer_id: number | null
  synergy_id: string | null
  name: string | null
  email: string | null
  phone: string | null
  is_primary: boolean
}

export interface ProductRow {
  id: number
  synergy_id: string
  number: string
  description: string | null
  unit_price: number | null
  synced_at: string | null
}

export interface UserRow {
  id: string
  email: string
  name: string
  role: UserRole | null
  active: boolean
  created_at: string
}

export interface EquipmentRow {
  id: string
  customer_id: number | null
  default_technician_id: string | null
  make: string | null
  model: string | null
  serial_number: string | null
  description: string | null
  location_on_site: string | null
  active: boolean
  created_at: string
  updated_at: string
}

export interface PmScheduleRow {
  id: string
  equipment_id: string | null
  frequency: PmFrequency | null
  billing_type: BillingType | null
  flat_rate: number | null
  active: boolean
  created_at: string
}

export interface PmTicketRow {
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
  created_at: string
  updated_at: string
}

export interface SyncLogRow {
  id: number
  sync_type: SyncType | null
  started_at: string
  completed_at: string | null
  records_synced: number | null
  status: SyncStatus | null
  error_message: string | null
}

// ============================================================
// Insert types (omit auto-generated fields)
// ============================================================

export type CustomerInsert = Omit<CustomerRow, 'id'>

export type ContactInsert = Omit<ContactRow, 'id'>

export type ProductInsert = Omit<ProductRow, 'id'>

export type UserInsert = Omit<UserRow, 'id' | 'created_at'>

export type EquipmentInsert = Omit<EquipmentRow, 'id' | 'created_at' | 'updated_at'>

export type PmScheduleInsert = Omit<PmScheduleRow, 'id' | 'created_at'>

export type PmTicketInsert = Omit<PmTicketRow, 'id' | 'created_at' | 'updated_at'>

export type SyncLogInsert = Omit<SyncLogRow, 'id'>

// ============================================================
// Update types (all fields optional except id)
// ============================================================

export type CustomerUpdate = Partial<CustomerInsert>

export type ContactUpdate = Partial<ContactInsert>

export type ProductUpdate = Partial<ProductInsert>

export type UserUpdate = Partial<UserInsert>

export type EquipmentUpdate = Partial<EquipmentInsert>

export type PmScheduleUpdate = Partial<PmScheduleInsert>

export type PmTicketUpdate = Partial<PmTicketInsert>

export type SyncLogUpdate = Partial<SyncLogInsert>

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
      }
      contacts: {
        Row: ContactRow
        Insert: ContactInsert
        Update: ContactUpdate
      }
      products: {
        Row: ProductRow
        Insert: ProductInsert
        Update: ProductUpdate
      }
      users: {
        Row: UserRow
        Insert: UserInsert
        Update: UserUpdate
      }
      equipment: {
        Row: EquipmentRow
        Insert: EquipmentInsert
        Update: EquipmentUpdate
      }
      pm_schedules: {
        Row: PmScheduleRow
        Insert: PmScheduleInsert
        Update: PmScheduleUpdate
      }
      pm_tickets: {
        Row: PmTicketRow
        Insert: PmTicketInsert
        Update: PmTicketUpdate
      }
      sync_log: {
        Row: SyncLogRow
        Insert: SyncLogInsert
        Update: SyncLogUpdate
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: {
      user_role: UserRole
      ticket_status: TicketStatus
      pm_frequency: PmFrequency
      billing_type: BillingType
      sync_type: SyncType
      sync_status: SyncStatus
    }
  }
}
