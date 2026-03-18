import { createClient } from '@/lib/supabase/server'
import { EquipmentRow, EquipmentInsert, PmScheduleRow, PmTicketRow } from '@/types/database'

export type EquipmentWithCustomer = EquipmentRow & {
  customers: { name: string } | null
}

export type EquipmentDetail = EquipmentRow & {
  customers: { name: string } | null
  pm_schedules: PmScheduleRow[]
  pm_tickets: PmTicketRow[]
}

export async function getEquipment(filters?: {
  customerId?: number
  active?: boolean
}): Promise<EquipmentWithCustomer[]> {
  const supabase = await createClient()

  let query = supabase
    .from('equipment')
    .select('*, customers(name)')
    .order('created_at', { ascending: false })

  if (filters?.customerId !== undefined) {
    query = query.eq('customer_id', filters.customerId)
  }

  if (filters?.active !== undefined) {
    query = query.eq('active', filters.active)
  }

  const { data, error } = await query

  if (error) throw error
  return data as EquipmentWithCustomer[]
}

export async function getEquipmentByCustomer(customerId: number): Promise<EquipmentRow[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('equipment')
    .select('*')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data
}

export async function getEquipmentDetail(id: string): Promise<EquipmentDetail | null> {
  const supabase = await createClient()

  // Fetch equipment with schedules first
  const { data: equipmentData, error: equipmentError } = await supabase
    .from('equipment')
    .select(`
      *,
      customers(name),
      pm_schedules(*)
    `)
    .eq('id', id)
    .single()

  if (equipmentError) {
    if (equipmentError.code === 'PGRST116') return null
    throw equipmentError
  }

  // Fetch the last 12 tickets separately to avoid nested limit syntax issues
  const { data: tickets, error: ticketsError } = await supabase
    .from('pm_tickets')
    .select('*')
    .eq('equipment_id', id)
    .order('created_at', { ascending: false })
    .limit(12)

  if (ticketsError) throw ticketsError

  return {
    ...equipmentData,
    pm_tickets: tickets ?? [],
  } as EquipmentDetail
}

export async function createEquipment(data: EquipmentInsert): Promise<EquipmentRow> {
  const supabase = await createClient()

  const { data: created, error } = await supabase
    .from('equipment')
    .insert(data)
    .select()
    .single()

  if (error) throw error
  return created
}

export async function updateEquipment(
  id: string,
  data: Partial<EquipmentInsert>
): Promise<EquipmentRow> {
  const supabase = await createClient()

  const { data: updated, error } = await supabase
    .from('equipment')
    .update(data)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return updated
}

export async function deactivateEquipment(id: string): Promise<void> {
  const supabase = await createClient()

  const { error } = await supabase
    .from('equipment')
    .update({ active: false })
    .eq('id', id)

  if (error) throw error
}
