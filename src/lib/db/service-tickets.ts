import { createClient } from '@/lib/supabase/server'
import type {
  ServiceTicketRow,
  ServiceTicketWithJoins,
  ServiceTicketDetail,
  ServiceTicketStatus,
  ServicePriority,
  ServiceTicketType,
  ServiceBillingType,
  PartRequest,
} from '@/types/service-tickets'

// --- List service tickets with filters ---

interface ServiceTicketFilters {
  status?: ServiceTicketStatus
  technicianId?: string
  customerId?: number
  priority?: ServicePriority
  ticketType?: ServiceTicketType
  billingType?: ServiceBillingType
  waitingOnParts?: boolean
}

export async function getServiceTickets(filters?: ServiceTicketFilters): Promise<ServiceTicketWithJoins[]> {
  const supabase = await createClient()

  let query = supabase
    .from('service_tickets')
    .select(`
      *,
      customers ( name, account_number ),
      equipment ( make, model, serial_number, description,
        ship_to_locations ( name, address, city, state, zip )
      ),
      assigned_technician:users!service_tickets_assigned_technician_id_fkey ( name )
    `)
    .order('created_at', { ascending: false })

  if (filters?.status) query = query.eq('status', filters.status)
  if (filters?.technicianId) query = query.eq('assigned_technician_id', filters.technicianId)
  if (filters?.customerId) query = query.eq('customer_id', filters.customerId)
  if (filters?.priority) query = query.eq('priority', filters.priority)
  if (filters?.ticketType) query = query.eq('ticket_type', filters.ticketType)
  if (filters?.billingType) query = query.eq('billing_type', filters.billingType)
  if (filters?.waitingOnParts) {
    query = query.eq('parts_received', false).neq('parts_requested', '[]' as unknown as PartRequest[])
  }

  const { data, error } = await query

  if (error) throw error
  return data as ServiceTicketWithJoins[]
}

// --- Get single service ticket with full detail ---

export async function getServiceTicket(id: string): Promise<ServiceTicketDetail | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('service_tickets')
    .select(`
      *,
      customers ( name, account_number, po_required, ar_terms, credit_hold ),
      equipment ( make, model, serial_number, description,
        ship_to_locations ( name, address, city, state, zip )
      ),
      assigned_technician:users!service_tickets_assigned_technician_id_fkey ( name ),
      created_by:users!service_tickets_created_by_id_fkey ( name )
    `)
    .eq('id', id)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null
    throw error
  }

  return data as ServiceTicketDetail
}

// --- Update service ticket fields ---

export async function updateServiceTicket(
  id: string,
  data: Partial<ServiceTicketRow>
): Promise<ServiceTicketRow> {
  const supabase = await createClient()

  const { data: updated, error } = await supabase
    .from('service_tickets')
    .update(data)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return updated as ServiceTicketRow
}

// --- Complete a service ticket ---

export async function completeServiceTicket(
  id: string,
  data: {
    completed_at: string
    hours_worked: number
    parts_used: ServiceTicketRow['parts_used']
    completion_notes: string | null
    billing_amount: number
    customer_signature: string
    customer_signature_name: string
    photos: ServiceTicketRow['photos']
    warranty_labor_covered?: boolean
  }
): Promise<ServiceTicketRow> {
  const supabase = await createClient()

  const { data: updated, error } = await supabase
    .from('service_tickets')
    .update({
      status: 'completed',
      completed_at: data.completed_at,
      hours_worked: data.hours_worked,
      parts_used: data.parts_used,
      completion_notes: data.completion_notes,
      billing_amount: data.billing_amount,
      customer_signature: data.customer_signature,
      customer_signature_name: data.customer_signature_name,
      photos: data.photos,
      warranty_labor_covered: data.warranty_labor_covered ?? false,
    })
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return updated as ServiceTicketRow
}

// --- Get service tickets for equipment (for unified service history) ---

export async function getServiceTicketsForEquipment(equipmentId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('service_tickets')
    .select(`
      *,
      assigned_technician:users!service_tickets_assigned_technician_id_fkey ( name )
    `)
    .eq('equipment_id', equipmentId)
    .in('status', ['completed', 'billed'])
    .order('completed_at', { ascending: false })

  if (error) throw error
  return data as (ServiceTicketRow & { assigned_technician: { name: string } | null })[]
}

// --- Get count of tickets needing parts ordered (dashboard) ---

export async function getPartsToOrderCount(): Promise<number> {
  const supabase = await createClient()

  const { count, error } = await supabase
    .from('service_tickets')
    .select('id', { count: 'exact', head: true })
    .eq('parts_received', false)
    .neq('parts_requested', '[]' as unknown as PartRequest[])

  if (error) throw error
  return count ?? 0
}

// --- Get service ticket counts by status (dashboard) ---

export async function getServiceTicketCounts(technicianId?: string) {
  const supabase = await createClient()

  let query = supabase.from('service_tickets').select('status')

  if (technicianId) {
    query = query.eq('assigned_technician_id', technicianId)
  }

  // Exclude terminal statuses from active counts
  query = query.not('status', 'in', '("billed","declined","canceled")')

  const { data, error } = await query
  if (error) throw error

  const counts: Record<string, number> = {}
  for (const row of data ?? []) {
    counts[row.status] = (counts[row.status] ?? 0) + 1
  }
  return counts
}
