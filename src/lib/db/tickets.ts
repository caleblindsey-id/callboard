import { createClient } from '@/lib/supabase/server'
import { PmTicketRow, TicketStatus, PartUsed } from '@/types/database'

export type TicketWithJoins = PmTicketRow & {
  customers: { name: string } | null
  equipment: { make: string | null; model: string | null } | null
  users: { name: string } | null
}

export type TicketDetail = PmTicketRow & {
  customers: { name: string; account_number: string | null } | null
  equipment: { make: string | null; model: string | null; serial_number: string | null } | null
  assigned_technician: { name: string } | null
  created_by: { name: string } | null
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
      customers(name),
      equipment(make, model),
      users!assigned_technician_id(name)
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
      customers(name, account_number),
      equipment(make, model, serial_number),
      assigned_technician:users!assigned_technician_id(name),
      created_by:users!created_by_id(name)
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
  data: Partial<PmTicketRow>
): Promise<PmTicketRow> {
  const supabase = await createClient()

  const { data: updated, error } = await supabase
    .from('pm_tickets')
    .update(data)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return updated
}

export async function completeTicket(
  id: string,
  data: {
    completedDate: string
    hoursWorked: number
    partsUsed: PartUsed[]
    completionNotes: string
    billingAmount: number
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
    })
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return updated
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
  return data
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
    .select()

  if (error) throw error
  return data
}
