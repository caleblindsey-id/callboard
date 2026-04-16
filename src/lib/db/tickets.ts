import { createClient } from '@/lib/supabase/server'
import { PmTicketRow, PmTicketUpdate, TicketStatus, PartUsed, TicketPhoto, BillingType } from '@/types/database'

export type TicketWithJoins = PmTicketRow & {
  customers: { name: string; billing_city: string | null; po_required: boolean } | null
  equipment: { make: string | null; model: string | null; ship_to_locations: { city: string | null } | null } | null
  users: { name: string } | null
  pm_schedules: { interval_months: number; anchor_month: number } | null
}

export type TicketDetail = PmTicketRow & {
  customers: { name: string; account_number: string | null; billing_city: string | null; po_required: boolean; ar_terms: string | null } | null
  equipment: { make: string | null; model: string | null; serial_number: string | null; default_products: { synergy_product_id: number; quantity: number; description: string }[]; ship_to_locations: { city: string | null } | null } | null
  assigned_technician: { name: string } | null
  created_by: { name: string } | null
  schedule: { billing_type: BillingType | null; flat_rate: number | null } | null
}

export async function getTickets(filters?: {
  month?: number
  year?: number
  technicianId?: string
  status?: TicketStatus
  customerId?: number
}): Promise<TicketWithJoins[]> {
  const supabase = await createClient()

  let query = supabase
    .from('pm_tickets')
    .select(`
      *,
      customers(name, billing_city, po_required),
      equipment(make, model, ship_to_locations(city)),
      users!assigned_technician_id(name),
      pm_schedules(interval_months, anchor_month)
    `)
    .order('created_at', { ascending: false })

  if (filters?.month !== undefined) {
    query = query.eq('month', filters.month)
  }

  if (filters?.year !== undefined) {
    query = query.eq('year', filters.year)
  }

  if (filters?.technicianId) {
    query = query.eq('assigned_technician_id', filters.technicianId)
  }

  if (filters?.status) {
    query = query.eq('status', filters.status)
  }

  if (filters?.customerId !== undefined) {
    query = query.eq('customer_id', filters.customerId)
  }

  const { data, error } = await query

  if (error) throw error
  return data as TicketWithJoins[]
}

export async function getTicket(id: string): Promise<TicketDetail | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('pm_tickets')
    .select(`
      *,
      customers(name, account_number, billing_city, po_required, ar_terms),
      equipment(make, model, serial_number, default_products, ship_to_locations(city)),
      assigned_technician:users!assigned_technician_id(name),
      created_by:users!created_by_id(name),
      schedule:pm_schedules(billing_type, flat_rate)
    `)
    .eq('id', id)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null
    throw error
  }

  return data as TicketDetail
}

export async function updateTicket(
  id: string,
  data: PmTicketUpdate
): Promise<PmTicketRow> {
  const supabase = await createClient()

  const { data: updated, error } = await supabase
    .from('pm_tickets')
    .update(data)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return updated as PmTicketRow
}

export async function completeTicket(
  id: string,
  data: {
    completedDate: string
    hoursWorked: number
    partsUsed: PartUsed[]
    completionNotes: string
    billingAmount: number
    customerSignature: string
    customerSignatureName: string
    photos: TicketPhoto[]
    poNumber: string | null
    billingContactName: string | null
    billingContactEmail: string | null
    billingContactPhone: string | null
    additionalPartsUsed: PartUsed[]
    additionalHoursWorked: number
    machineHours: number
    dateCode: string
  }
): Promise<PmTicketRow> {
  const supabase = await createClient()

  const { data: updated, error } = await supabase
    .from('pm_tickets')
    .update({
      status: 'completed',
      completed_date: data.completedDate,
      hours_worked: data.hoursWorked,
      parts_used: data.partsUsed,
      completion_notes: data.completionNotes,
      billing_amount: data.billingAmount,
      customer_signature: data.customerSignature,
      customer_signature_name: data.customerSignatureName,
      photos: data.photos,
      po_number: data.poNumber,
      billing_contact_name: data.billingContactName,
      billing_contact_email: data.billingContactEmail,
      billing_contact_phone: data.billingContactPhone,
      additional_parts_used: data.additionalPartsUsed,
      additional_hours_worked: data.additionalHoursWorked,
      machine_hours: data.machineHours,
      date_code: data.dateCode,
    })
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return updated as PmTicketRow
}

export async function getTicketsByMonth(month: number, year: number): Promise<PmTicketRow[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('pm_tickets')
    .select('*')
    .eq('month', month)
    .eq('year', year)
    .order('created_at')

  if (error) throw error
  return data as PmTicketRow[]
}

export async function bulkAssignTechnician(
  ticketIds: string[],
  technicianId: string
): Promise<PmTicketRow[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('pm_tickets')
    .update({
      assigned_technician_id: technicianId,
      status: 'assigned',
    })
    .in('id', ticketIds)
    .in('status', ['unassigned', 'assigned'])
    .select()

  if (error) throw error
  return data as PmTicketRow[]
}
