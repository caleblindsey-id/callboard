import { createClient } from '@/lib/supabase/server'
import { EquipmentRow, EquipmentInsert, EquipmentProspectRow, PmScheduleRow, PmTicketRow, EquipmentEstimateLogRow } from '@/types/database'
import { normalizeSerial, serialsMatch } from '@/lib/equipment'

export type DuplicateEquipmentMatch = {
  id: string
  make: string | null
  model: string | null
  serial_number: string | null
  active: boolean
}

function translateSerialUniqueError(error: { code?: string; message?: string } | null): Error | null {
  if (!error) return null
  if (error.code === '23505' && error.message?.includes('idx_equipment_customer_serial')) {
    return new Error('This customer already has active equipment with that serial number.')
  }
  return null
}

export type EquipmentWithCustomer = EquipmentRow & {
  customers: { name: string } | null
  pm_schedules: { interval_months: number; anchor_month: number; active: boolean }[]
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

  // Listing query: avoid pulling default_products JSONB on every row.
  let query = supabase
    .from('equipment')
    .select(`
      id, customer_id, make, model, serial_number, description,
      location_on_site, default_technician_id, ship_to_location_id,
      contact_name, contact_email, contact_phone, blanket_po_number,
      active, created_at, updated_at,
      customers(name),
      pm_schedules(interval_months, anchor_month, active)
    `)
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

  type EquipmentBase = Omit<EquipmentDetail, 'pm_tickets'>

  // Fetch equipment with schedules first
  const { data: equipmentData, error: equipmentError } = await supabase
    .from('equipment')
    .select(`
      *,
      customers(name),
      pm_schedules(*)
    `)
    .eq('id', id)
    .returns<EquipmentBase[]>()
    .single()

  if (equipmentError) {
    if (equipmentError.code === 'PGRST116') return null
    throw equipmentError
  }
  if (!equipmentData) return null
  const base = equipmentData satisfies EquipmentBase

  // Fetch the last 12 tickets separately to avoid nested limit syntax issues
  const { data: tickets, error: ticketsError } = await supabase
    .from('pm_tickets')
    .select('*')
    .eq('equipment_id', id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(12)
    .returns<PmTicketRow[]>()

  if (ticketsError) throw ticketsError

  return {
    ...base,
    pm_tickets: tickets ?? [],
  }
}

export async function getEquipmentServiceHistory(
  equipmentId: string,
  excludeTicketId?: string
): Promise<PmTicketRow[]> {
  const supabase = await createClient()

  let query = supabase
    .from('pm_tickets')
    .select('*')
    .eq('equipment_id', equipmentId)
    .is('deleted_at', null)
    .in('status', ['completed', 'billed'])
    .order('completed_date', { ascending: false })

  if (excludeTicketId) {
    query = query.neq('id', excludeTicketId)
  }

  const { data, error } = await query
  if (error) throw error
  return data as PmTicketRow[]
}

// Permanent estimate snapshots for a unit (migration 117) — the "Past Estimates"
// card on the equipment detail page. Survives the source ticket being reopened
// or re-quoted, unlike the live service history (which only shows completed work).
export async function getEquipmentEstimateLog(
  equipmentId: string,
): Promise<EquipmentEstimateLogRow[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('equipment_estimate_log')
    .select('*')
    .eq('equipment_id', equipmentId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data as EquipmentEstimateLogRow[]
}

export async function findDuplicateEquipment(params: {
  customerId: number
  serialNumber: string
  excludeId?: string
}): Promise<DuplicateEquipmentMatch | null> {
  const normalized = normalizeSerial(params.serialNumber)
  if (!normalized) return null

  const supabase = await createClient()

  // Pull active rows for this customer with a case-insensitive prefix-ish match.
  // We re-check in JS because PostgREST can't express LOWER(BTRIM(...)) directly.
  let query = supabase
    .from('equipment')
    .select('id, make, model, serial_number, active')
    .eq('customer_id', params.customerId)
    .eq('active', true)
    .ilike('serial_number', `%${normalized}%`)

  if (params.excludeId) {
    query = query.neq('id', params.excludeId)
  }

  const { data, error } = await query
  if (error) throw error

  const match = (data ?? []).find((row) => serialsMatch(row.serial_number, normalized))
  return (match as DuplicateEquipmentMatch | undefined) ?? null
}

export async function createEquipment(data: EquipmentInsert): Promise<EquipmentRow> {
  const supabase = await createClient()

  const { data: created, error } = await supabase
    .from('equipment')
    .insert(data)
    .select()
    .single()

  if (error) {
    const friendly = translateSerialUniqueError(error)
    if (friendly) throw friendly
    throw error
  }
  return created as EquipmentRow
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

  if (error) {
    const friendly = translateSerialUniqueError(error)
    if (friendly) throw friendly
    throw error
  }
  return updated as EquipmentRow
}

export async function deactivateEquipment(id: string): Promise<void> {
  const supabase = await createClient()

  const { error } = await supabase
    .from('equipment')
    .update({ active: false } )
    .eq('id', id)

  if (error) throw error
}

// ============================================================
// Inactive Equipment Prospects
// ============================================================

export type InactiveEquipmentProspect = {
  equipmentId: string
  customerName: string | null
  customerId: number | null
  make: string | null
  model: string | null
  serialNumber: string | null
  locationOnSite: string | null
  lastServiceDate: string | null
  lastTechnician: string | null
  totalRevenue: number
  contactName: string | null
  contactEmail: string | null
  contactPhone: string | null
  isProspect: boolean
  removed: boolean
  removalReason: string | null
  removalNote: string | null
}

export async function getInactiveEquipmentProspects(): Promise<InactiveEquipmentProspect[]> {
  const supabase = await createClient()

  // 1. Fetch inactive equipment with customer name
  const { data: equipment, error: eqError } = await supabase
    .from('equipment')
    .select('*, customers(name)')
    .eq('active', false)
    .order('updated_at', { ascending: false })

  if (eqError) throw eqError
  if (!equipment || equipment.length === 0) return []

  const equipmentIds = equipment.map((e) => e.id)

  // 2 + 3. Prospects and ticket aggregates are independent — run in parallel.
  const [prospectRes, ticketRes] = await Promise.all([
    supabase
      .from('equipment_prospects')
      .select('*')
      .in('equipment_id', equipmentIds),
    supabase
      .from('pm_tickets')
      .select('equipment_id, completed_date, billing_amount, assigned_technician_id')
      .in('equipment_id', equipmentIds)
      .is('deleted_at', null)
      .in('status', ['completed', 'billed'])
      .order('completed_date', { ascending: false }),
  ])

  const prospectData = prospectRes.data
  const ticketData = ticketRes.data

  const prospectMap = new Map<string, EquipmentProspectRow>()
  for (const p of prospectData ?? []) {
    prospectMap.set(p.equipment_id, p as EquipmentProspectRow)
  }

  const lastService = new Map<string, string>()
  const totalRevenue = new Map<string, number>()
  const lastTechId = new Map<string, string>()

  for (const t of ticketData ?? []) {
    if (t.equipment_id) {
      if (!lastService.has(t.equipment_id) && t.completed_date) {
        lastService.set(t.equipment_id, t.completed_date)
        if (t.assigned_technician_id) {
          lastTechId.set(t.equipment_id, t.assigned_technician_id)
        }
      }
      totalRevenue.set(
        t.equipment_id,
        (totalRevenue.get(t.equipment_id) ?? 0) + (t.billing_amount ?? 0)
      )
    }
  }

  // 4. Resolve tech names
  const techIds = Array.from(new Set(lastTechId.values()))
  const techNames = new Map<string, string>()
  if (techIds.length > 0) {
    const { data: techs } = await supabase
      .from('users')
      .select('id, name')
      .in('id', techIds)
    for (const t of techs ?? []) {
      techNames.set(t.id, t.name)
    }
  }

  // 5. Stitch together
  return equipment.map((e) => {
    const prospect = prospectMap.get(e.id)
    const customer = e.customers as { name: string } | null
    return {
      equipmentId: e.id,
      customerName: customer?.name ?? null,
      customerId: e.customer_id,
      make: e.make,
      model: e.model,
      serialNumber: e.serial_number,
      locationOnSite: e.location_on_site,
      lastServiceDate: lastService.get(e.id) ?? null,
      lastTechnician: lastTechId.has(e.id)
        ? techNames.get(lastTechId.get(e.id)!) ?? null
        : null,
      totalRevenue: totalRevenue.get(e.id) ?? 0,
      contactName: e.contact_name,
      contactEmail: e.contact_email,
      contactPhone: e.contact_phone,
      isProspect: prospect?.is_prospect ?? false,
      removed: prospect?.removed ?? false,
      removalReason: prospect?.removal_reason ?? null,
      removalNote: prospect?.removal_note ?? null,
    }
  })
}
