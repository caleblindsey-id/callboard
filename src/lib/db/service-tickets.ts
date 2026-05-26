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

  // Listing query: only select columns the board renders. Avoids pulling
  // large JSONB blobs (estimate_parts, parts_requested, customer_signature,
  // photos) on every row — meaningful payload reduction at scale.
  let query = supabase
    .from('service_tickets')
    .select(`
      id, work_order_number, status, priority, ticket_type, billing_type,
      problem_description, customer_id, equipment_id, assigned_technician_id,
      contact_name, contact_phone, service_address, service_city, service_state,
      equipment_make, equipment_model, estimate_amount, billing_amount,
      synergy_order_number, synergy_validation_status, parts_received,
      created_at, updated_at, started_at, completed_at,
      customers ( name, account_number, credit_hold ),
      equipment ( make, model, serial_number, description,
        ship_to_locations ( name, address, city, state, zip )
      ),
      assigned_technician:users!service_tickets_assigned_technician_id_fkey ( name ),
      credit_reviews ( status )
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
      created_by:users!service_tickets_created_by_id_fkey ( name ),
      credit_reviews ( id, status, block_reason, decided_by_name )
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
    customer_signature: string | null
    customer_signature_name: string | null
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

// --- Service tickets ready to bill (parallel to PM getBillingTickets) ---
// Filters: status='completed' AND completed_at in [month, nextMonth). Status
// flips to 'billed' on Mark Billed, which naturally drops rows from this query
// — no separate billing_exported column on service_tickets.

export type ServiceBillingTicket = {
  id: string
  work_order_number: number | null
  status: ServiceTicketStatus
  billing_type: ServiceBillingType
  billing_amount: number | null
  hours_worked: number | null
  synergy_order_number: string | null
  completed_at: string | null
  customers: {
    name: string
    po_required: boolean
    ar_terms: string | null
    credit_hold: boolean
  } | null
  equipment: { make: string | null; model: string | null } | null
  equipment_make: string | null
  equipment_model: string | null
  assigned_technician: { name: string } | null
}

export async function getServiceBillingTickets(
  month: number,
  year: number
): Promise<ServiceBillingTicket[]> {
  const supabase = await createClient()

  const startDate = `${year}-${String(month).padStart(2, '0')}-01T00:00:00.000Z`
  const nextMonth = month === 12 ? 1 : month + 1
  const nextYear = month === 12 ? year + 1 : year
  const endDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01T00:00:00.000Z`

  const { data, error } = await supabase
    .from('service_tickets')
    .select(`
      id, work_order_number, status, billing_type, billing_amount, hours_worked,
      synergy_order_number, completed_at, equipment_make, equipment_model,
      customers ( name, po_required, ar_terms, credit_hold ),
      equipment ( make, model ),
      assigned_technician:users!service_tickets_assigned_technician_id_fkey ( name )
    `)
    .eq('status', 'completed')
    .gte('completed_at', startDate)
    .lt('completed_at', endDate)
    .order('completed_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as unknown as ServiceBillingTicket[]
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
// ticketType: undefined → service-only (legacy); 'service' → service-only; 'pm' → pm-only

export async function getPartsToOrderCount(ticketType?: 'pm' | 'service'): Promise<number> {
  const supabase = await createClient()

  const source = ticketType === 'pm' ? 'pm' : 'service'

  const { count, error } = await supabase
    .from('parts_order_queue')
    .select('ticket_id', { count: 'exact', head: true })
    .eq('source', source)
    .eq('status', 'requested')
    .eq('cancelled', false)

  if (error) throw error
  return count ?? 0
}

// --- Parts on Order: tickets with at least one part in 'ordered' status ---
// ticketType: undefined → service + PM combined; 'service' or 'pm' → that table only

export async function getPartsOnOrderCount(
  technicianId?: string,
  ticketType?: 'pm' | 'service'
): Promise<number> {
  const supabase = await createClient()

  // Supabase query builders return new objects on each chained call —
  // mutating the variable reference (without re-assignment) silently drops
  // the filter. Rebind via let so technicianId scoping actually applies.
  let serviceQuery = supabase
    .from('service_tickets')
    .select('id', { count: 'exact', head: true })
    .filter('parts_requested', 'cs', JSON.stringify([{ status: 'ordered' }]))
    .not('status', 'in', '("billed","declined","canceled")')
  let pmQuery = supabase
    .from('pm_tickets')
    .select('id', { count: 'exact', head: true })
    .is('deleted_at', null)
    .filter('parts_requested', 'cs', JSON.stringify([{ status: 'ordered' }]))
    .not('status', 'in', '("completed","billed","skipped","skip_requested")')
  if (technicianId) {
    serviceQuery = serviceQuery.eq('assigned_technician_id', technicianId)
    pmQuery = pmQuery.eq('assigned_technician_id', technicianId)
  }

  if (ticketType === 'service') {
    const { count, error } = await serviceQuery
    if (error) throw error
    return count ?? 0
  }
  if (ticketType === 'pm') {
    const { count, error } = await pmQuery
    if (error) throw error
    return count ?? 0
  }

  const [serviceResult, pmResult] = await Promise.all([serviceQuery, pmQuery])

  if (serviceResult.error) throw serviceResult.error
  if (pmResult.error) throw pmResult.error
  return (serviceResult.count ?? 0) + (pmResult.count ?? 0)
}

// --- Parts Ready for Pickup: tickets with at least one part in 'received' status ---
// ticketType: undefined → service + PM combined; 'service' or 'pm' → that table only

export async function getPartsReadyForPickupCount(
  technicianId?: string,
  ticketType?: 'pm' | 'service'
): Promise<number> {
  const supabase = await createClient()

  let serviceQuery = supabase
    .from('service_tickets')
    .select('id', { count: 'exact', head: true })
    .filter('parts_requested', 'cs', JSON.stringify([{ status: 'received' }]))
    .not('status', 'in', '("billed","declined","canceled")')
  let pmQuery = supabase
    .from('pm_tickets')
    .select('id', { count: 'exact', head: true })
    .is('deleted_at', null)
    .filter('parts_requested', 'cs', JSON.stringify([{ status: 'received' }]))
    .not('status', 'in', '("completed","billed","skipped","skip_requested")')
  if (technicianId) {
    serviceQuery = serviceQuery.eq('assigned_technician_id', technicianId)
    pmQuery = pmQuery.eq('assigned_technician_id', technicianId)
  }

  if (ticketType === 'service') {
    const { count, error } = await serviceQuery
    if (error) throw error
    return count ?? 0
  }
  if (ticketType === 'pm') {
    const { count, error } = await pmQuery
    if (error) throw error
    return count ?? 0
  }

  const [serviceResult, pmResult] = await Promise.all([serviceQuery, pmQuery])

  if (serviceResult.error) throw serviceResult.error
  if (pmResult.error) throw pmResult.error
  return (serviceResult.count ?? 0) + (pmResult.count ?? 0)
}

// --- Get service ticket counts by status (dashboard) ---
// Uses one count:'exact', head:true query per active status, parallelized.
// Replaces the previous .select('status') + JS aggregation antipattern that
// fetched every active service_tickets row to count them.

const ACTIVE_SERVICE_STATUSES = ['open', 'estimated', 'approved', 'in_progress', 'completed'] as const

export async function getServiceTicketCounts(technicianId?: string): Promise<Record<string, number>> {
  const supabase = await createClient()

  const results = await Promise.all(
    ACTIVE_SERVICE_STATUSES.map((status) => {
      let q = supabase
        .from('service_tickets')
        .select('id', { count: 'exact', head: true })
        .eq('status', status)
      if (technicianId) {
        q = q.eq('assigned_technician_id', technicianId)
      }
      return q
    })
  )

  const counts: Record<string, number> = {}
  for (let i = 0; i < ACTIVE_SERVICE_STATUSES.length; i++) {
    const r = results[i]
    if (r.error) throw r.error
    counts[ACTIVE_SERVICE_STATUSES[i]] = r.count ?? 0
  }
  return counts
}
