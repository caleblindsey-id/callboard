import { createClient } from '@/lib/supabase/server'
import { PmTicketRow, PmTicketUpdate, TicketStatus, PartUsed, TicketPhoto, BillingType } from '@/types/database'
import { OVERDUE_ELIGIBLE_STATUSES } from '@/lib/overdue'
import { calcNextServiceMonth } from '@/lib/utils/schedule'

// Display order for the PM tickets list. Work-in-flight first, manager-action
// next, closed-out last. Drives the grouping in getTickets().
const STATUS_RANK: Record<TicketStatus, number> = {
  unassigned: 0,
  assigned: 1,
  in_progress: 2,
  skip_requested: 3,
  completed: 4,
  billed: 5,
  skipped: 6,
}

export type TicketWithJoins = PmTicketRow & {
  customers: { name: string; billing_city: string | null; po_required: boolean; ar_terms: string | null; credit_hold: boolean } | null
  equipment: { make: string | null; model: string | null; ship_to_locations: { name: string | null; address: string | null; city: string | null } | null } | null
  pm_ship_to: { name: string | null; address: string | null; city: string | null } | null
  users: { name: string } | null
  pm_schedules: { interval_months: number; anchor_month: number } | null
}

export type TicketDetail = PmTicketRow & {
  customers: { name: string; account_number: string | null; billing_address: string | null; billing_city: string | null; billing_state: string | null; billing_zip: string | null; po_required: boolean; ar_terms: string | null; credit_hold: boolean } | null
  equipment: { make: string | null; model: string | null; serial_number: string | null; ship_to_location_id: number | null; default_products: { synergy_product_id: number; quantity: number; description: string }[]; ship_to_locations: { name: string | null; address: string | null; city: string | null; state: string | null; zip: string | null } | null } | null
  pm_ship_to: { name: string | null; address: string | null; city: string | null; state: string | null; zip: string | null } | null
  assigned_technician: { name: string } | null
  created_by: { name: string } | null
  deleted_by: { name: string } | null
  schedule: { billing_type: BillingType | null; flat_rate: number | null; interval_months: number; anchor_month: number } | null
  lastServiceMonth: number | null
  lastServiceYear: number | null
  nextServiceMonth: number | null
  nextServiceYear: number | null
}

export async function getDashboardPmSummary(
  month: number,
  year: number
): Promise<{ status: TicketStatus; scheduled_date: string | null }[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('pm_tickets')
    .select('status, scheduled_date')
    .is('deleted_at', null)
    .eq('month', month)
    .eq('year', year)
  if (error) throw error
  return (data ?? []) as { status: TicketStatus; scheduled_date: string | null }[]
}

export async function getTickets(filters?: {
  month?: number
  year?: number
  technicianId?: string
  status?: TicketStatus
  customerId?: number
  overdueOnly?: boolean
  needsReviewOnly?: boolean
  now?: Date
  includeDeleted?: boolean
  deletedOnly?: boolean
}): Promise<TicketWithJoins[]> {
  const supabase = await createClient()

  let query = supabase
    .from('pm_tickets')
    .select(`
      *,
      customers(name, billing_city, po_required, ar_terms, credit_hold),
      equipment(make, model, ship_to_locations(name, address, city)),
      pm_ship_to:ship_to_locations!pm_tickets_ship_to_location_id_fkey(name, address, city),
      users!assigned_technician_id(name),
      pm_schedules(interval_months, anchor_month)
    `)

  if (filters?.deletedOnly) {
    query = query.not('deleted_at', 'is', null)
  } else if (!filters?.includeDeleted) {
    query = query.is('deleted_at', null)
  }

  if (filters?.needsReviewOnly) {
    query = query.eq('requires_review', true)
  } else if (filters?.overdueOnly) {
    const now = filters.now ?? new Date()
    const currentMonth = now.getMonth() + 1
    const currentYear = now.getFullYear()
    query = query
      .in('status', OVERDUE_ELIGIBLE_STATUSES)
      .or(`year.lt.${currentYear},and(year.eq.${currentYear},month.lt.${currentMonth})`)
  } else {
    if (filters?.month !== undefined) {
      query = query.eq('month', filters.month)
    }
    if (filters?.year !== undefined) {
      query = query.eq('year', filters.year)
    }
    if (filters?.status) {
      query = query.eq('status', filters.status)
    }
  }

  if (filters?.technicianId) {
    query = query.eq('assigned_technician_id', filters.technicianId)
  }

  if (filters?.customerId !== undefined) {
    query = query.eq('customer_id', filters.customerId)
  }

  const { data, error } = await query

  if (error) throw error

  const rows = (data ?? []) as unknown as TicketWithJoins[]
  rows.sort((a, b) => {
    const sa = STATUS_RANK[a.status] ?? 99
    const sb = STATUS_RANK[b.status] ?? 99
    if (sa !== sb) return sa - sb

    const ca = a.customers?.name ?? '￿'
    const cb = b.customers?.name ?? '￿'
    const c = ca.localeCompare(cb, undefined, { sensitivity: 'base' })
    if (c !== 0) return c

    return (b.created_at ?? '').localeCompare(a.created_at ?? '')
  })
  return rows
}

// Billing queue: completed PM tickets not yet exported to a billing PDF.
// Default scope is ALL unbilled tickets regardless of month — a prior-month
// completion that was never billed must stay visible, or it leaks revenue.
// month/year are optional and narrow the list only when both are supplied.
export async function getBillingTickets(
  month?: number,
  year?: number
): Promise<TicketWithJoins[]> {
  const supabase = await createClient()

  let query = supabase
    .from('pm_tickets')
    .select(`
      *,
      customers(name, billing_city, po_required, ar_terms, credit_hold),
      equipment(make, model, ship_to_locations(name, address, city)),
      pm_ship_to:ship_to_locations!pm_tickets_ship_to_location_id_fkey(name, address, city),
      users!assigned_technician_id(name),
      pm_schedules(interval_months, anchor_month)
    `)
    .eq('status', 'completed')
    .eq('billing_exported', false)
    .is('deleted_at', null)

  if (month !== undefined && year !== undefined) {
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`
    const nextMonth = month === 12 ? 1 : month + 1
    const nextYear = month === 12 ? year + 1 : year
    const endDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`
    query = query.gte('completed_date', startDate).lt('completed_date', endDate)
  }

  const { data, error } = await query.order('completed_date', { ascending: false })

  if (error) throw error
  return data as unknown as TicketWithJoins[]
}

export async function getOverdueTicketCount(filters?: {
  technicianId?: string
  now?: Date
}): Promise<number> {
  const supabase = await createClient()
  const now = filters?.now ?? new Date()
  const currentMonth = now.getMonth() + 1
  const currentYear = now.getFullYear()

  let query = supabase
    .from('pm_tickets')
    .select('id', { count: 'exact', head: true })
    .is('deleted_at', null)
    .in('status', OVERDUE_ELIGIBLE_STATUSES)
    .or(`year.lt.${currentYear},and(year.eq.${currentYear},month.lt.${currentMonth})`)

  if (filters?.technicianId) {
    query = query.eq('assigned_technician_id', filters.technicianId)
  }

  const { count, error } = await query
  if (error) throw error
  return count ?? 0
}

export async function getSkipRequestedCount(filters?: {
  technicianId?: string
}): Promise<number> {
  const supabase = await createClient()

  let query = supabase
    .from('pm_tickets')
    .select('id', { count: 'exact', head: true })
    .is('deleted_at', null)
    .eq('status', 'skip_requested')

  if (filters?.technicianId) {
    query = query.eq('assigned_technician_id', filters.technicianId)
  }

  const { count, error } = await query
  if (error) throw error
  return count ?? 0
}

export async function getNeedsReviewCount(filters?: {
  technicianId?: string
}): Promise<number> {
  const supabase = await createClient()

  let query = supabase
    .from('pm_tickets')
    .select('id', { count: 'exact', head: true })
    .is('deleted_at', null)
    .eq('requires_review', true)

  if (filters?.technicianId) {
    query = query.eq('assigned_technician_id', filters.technicianId)
  }

  const { count, error } = await query
  if (error) throw error
  return count ?? 0
}

export async function getTicket(id: string, options?: { includeDeleted?: boolean }): Promise<TicketDetail | null> {
  const supabase = await createClient()

  let query = supabase
    .from('pm_tickets')
    .select(`
      *,
      customers(name, account_number, billing_address, billing_city, billing_state, billing_zip, po_required, ar_terms, credit_hold),
      equipment(make, model, serial_number, ship_to_location_id, default_products, ship_to_locations(name, address, city, state, zip)),
      pm_ship_to:ship_to_locations!pm_tickets_ship_to_location_id_fkey(name, address, city, state, zip),
      assigned_technician:users!assigned_technician_id(name),
      created_by:users!created_by_id(name),
      deleted_by:users!deleted_by_id(name),
      schedule:pm_schedules(billing_type, flat_rate, interval_months, anchor_month)
    `)
    .eq('id', id)

  // By default exclude soft-deleted tickets. Callers that need to render the
  // restore banner (manager-only ticket detail page) opt in via includeDeleted.
  if (!options?.includeDeleted) {
    query = query.is('deleted_at', null)
  }

  const { data, error } = await query.single()

  if (error) {
    if (error.code === 'PGRST116') return null
    throw error
  }

  const ticket = data as unknown as TicketDetail
  ticket.lastServiceMonth = null
  ticket.lastServiceYear = null
  ticket.nextServiceMonth = null
  ticket.nextServiceYear = null

  // For PM tickets with a schedule + equipment, derive Last/Next service from
  // sibling pm_tickets. Both exclude the current ticket so they always describe
  // service relative to the one being viewed.
  if (ticket.pm_schedule_id && ticket.equipment_id && ticket.schedule) {
    const [{ data: lastRows }, { data: siblingRows }] = await Promise.all([
      supabase
        .from('pm_tickets')
        .select('month, year')
        .eq('equipment_id', ticket.equipment_id)
        .neq('id', ticket.id)
        .in('status', ['completed', 'billed'])
        .is('deleted_at', null)
        .order('year', { ascending: false })
        .order('month', { ascending: false })
        .limit(1),
      supabase
        .from('pm_tickets')
        .select('month, year, status')
        .eq('equipment_id', ticket.equipment_id)
        .neq('id', ticket.id)
        .is('deleted_at', null),
    ])

    const last = lastRows?.[0]
    if (last?.month && last?.year) {
      ticket.lastServiceMonth = last.month
      ticket.lastServiceYear = last.year
    }

    const existingKeys = new Set<string>()
    for (const s of siblingRows ?? []) {
      if (s.status !== 'skipped' && s.month && s.year) {
        existingKeys.add(`${s.year}-${s.month}`)
      }
    }

    // Advance one month past the current ticket so we project the *next* service.
    const fromMonth = ticket.month === 12 ? 1 : ticket.month + 1
    const fromYear = ticket.month === 12 ? ticket.year + 1 : ticket.year

    const next = calcNextServiceMonth(
      ticket.schedule.interval_months,
      ticket.schedule.anchor_month,
      fromMonth,
      fromYear,
      existingKeys
    )
    if (next) {
      ticket.nextServiceMonth = next.month
      ticket.nextServiceYear = next.year
    }
  }

  return ticket
}

export async function updateTicket(
  id: string,
  data: PmTicketUpdate
): Promise<PmTicketRow> {
  const supabase = await createClient()

  // Soft-deleted tickets are read-only. Restore goes through /api/tickets/[id]/restore.
  const { data: updated, error } = await supabase
    .from('pm_tickets')
    .update(data)
    .eq('id', id)
    .is('deleted_at', null)
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
    showPricing: boolean
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
      show_pricing: data.showPricing,
    })
    .eq('id', id)
    .is('deleted_at', null)
    .select()
    .single()

  if (error) throw error
  return updated as PmTicketRow
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
    .is('deleted_at', null)
    .select()

  if (error) throw error
  return data as PmTicketRow[]
}

export async function bulkSoftDeleteTickets(
  ticketIds: string[],
  userId: string
): Promise<{ id: string }[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('pm_tickets')
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by_id: userId,
    })
    .in('id', ticketIds)
    .is('deleted_at', null)
    .select('id')

  if (error) throw error
  return (data ?? []) as { id: string }[]
}
