import { createClient } from '@/lib/supabase/server'
import type { AceLaborEntry, AceLaborStatus } from '@/types/database'
import { columnsOf } from '@/lib/db/columns'

const ACE_LABOR_COLUMNS = columnsOf<AceLaborEntry>()([
  'id', 'pm_ticket_id', 'service_ticket_id', 'tech_id', 'hours',
  'labor_rate_type', 'reason', 'status', 'submitted_at', 'approved_by_id',
  'approved_at', 'rejected_reason', 'rate_value_at_approval', 'paid_at',
  'paid_by_id', 'payout_period', 'updated_by_id', 'created_by_id',
  'created_at', 'updated_at',
])

// Entry joined with the bits the UI renders (tech name, ticket context,
// approver/payer names). Both ticket FKs are pulled with their headline
// fields; the consuming code uses whichever is non-null.
export type AceLaborEntryWithJoins = AceLaborEntry & {
  tech: { id: string; name: string } | null
  approver: { id: string; name: string } | null
  payer: { id: string; name: string } | null
  pm_ticket: {
    id: string
    work_order_number: string | null
    customers: { id: number; name: string } | null
  } | null
  service_ticket: {
    id: string
    work_order_number: string | null
    customers: { id: number; name: string } | null
  } | null
}

const SELECT_WITH_JOINS = `
  *,
  tech:users!ace_labor_entries_tech_id_fkey(id, name),
  approver:users!ace_labor_entries_approved_by_id_fkey(id, name),
  payer:users!ace_labor_entries_paid_by_id_fkey(id, name),
  pm_ticket:pm_tickets!ace_labor_entries_pm_ticket_id_fkey(
    id, work_order_number, customers(id, name)
  ),
  service_ticket:service_tickets!ace_labor_entries_service_ticket_id_fkey(
    id, work_order_number, customers(id, name)
  )
` as const

export async function getEntryByTicket(
  ticketType: 'pm' | 'service',
  ticketId: string,
): Promise<AceLaborEntry | null> {
  const supabase = await createClient()
  const col = ticketType === 'pm' ? 'pm_ticket_id' : 'service_ticket_id'
  const { data, error } = await supabase
    .from('ace_labor_entries')
    .select(ACE_LABOR_COLUMNS)
    .eq(col, ticketId)
    .maybeSingle()
  if (error) throw error
  return (data ?? null) as AceLaborEntry | null
}

export async function getEntryById(id: string): Promise<AceLaborEntryWithJoins | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('ace_labor_entries')
    .select(SELECT_WITH_JOINS)
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return (data ?? null) as unknown as AceLaborEntryWithJoins | null
}

export async function getEntriesByStatus(
  status: AceLaborStatus | AceLaborStatus[],
): Promise<AceLaborEntryWithJoins[]> {
  const supabase = await createClient()
  let query = supabase
    .from('ace_labor_entries')
    .select(SELECT_WITH_JOINS)

  if (Array.isArray(status)) {
    query = query.in('status', status)
  } else {
    query = query.eq('status', status)
  }

  const { data, error } = await query.order('submitted_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as AceLaborEntryWithJoins[]
}

// Entries used by the payout report — filtered by approved_at range, optionally
// including already-paid rows. Matches the pattern getAllLeads uses for earned_at.
export async function getEntriesForPayoutReport(filters: {
  from: string
  to: string
  includePaid: boolean
}): Promise<AceLaborEntryWithJoins[]> {
  const supabase = await createClient()
  const statuses: AceLaborStatus[] = filters.includePaid
    ? ['approved', 'paid']
    : ['approved']

  const { data, error } = await supabase
    .from('ace_labor_entries')
    .select(SELECT_WITH_JOINS)
    .in('status', statuses)
    .gte('approved_at', filters.from)
    .lte('approved_at', filters.to)
    .order('approved_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as unknown as AceLaborEntryWithJoins[]
}

export async function getMyEntries(techId: string): Promise<AceLaborEntryWithJoins[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('ace_labor_entries')
    .select(SELECT_WITH_JOINS)
    .eq('tech_id', techId)
    .order('submitted_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as AceLaborEntryWithJoins[]
}

export async function countPendingEntries(): Promise<number> {
  const supabase = await createClient()
  const { count, error } = await supabase
    .from('ace_labor_entries')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')
  if (error) throw error
  return count ?? 0
}
