import { createClient } from '@/lib/supabase/server'
import type { TechLeadRow, TechLeadStatus } from '@/types/database'

// Lead joined with the bits of customer / tech / equipment the UI needs to render
// a row without a second round-trip.
export type TechLeadWithJoins = TechLeadRow & {
  customers: { id: number; name: string; account_number: string | null } | null
  submitter: { id: string; name: string } | null
  approver: { id: string; name: string } | null
  payer: { id: string; name: string } | null
  equipment: { id: string; make: string | null; model: string | null; serial_number: string | null } | null
}

const SELECT_WITH_JOINS = `
  *,
  customers(id, name, account_number),
  submitter:users!tech_leads_submitted_by_fkey(id, name),
  approver:users!tech_leads_approved_by_fkey(id, name),
  payer:users!tech_leads_paid_by_fkey(id, name),
  equipment(id, make, model, serial_number)
` as const

export async function getMyLeads(technicianId: string): Promise<TechLeadWithJoins[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('tech_leads')
    .select(SELECT_WITH_JOINS)
    .eq('submitted_by', technicianId)
    .order('submitted_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as TechLeadWithJoins[]
}

export async function getAllLeads(filters?: {
  status?: TechLeadStatus | TechLeadStatus[]
  earnedBetween?: { from: string; to: string }
}): Promise<TechLeadWithJoins[]> {
  const supabase = await createClient()
  let query = supabase
    .from('tech_leads')
    .select(SELECT_WITH_JOINS)
    .order('submitted_at', { ascending: false })

  if (filters?.status) {
    if (Array.isArray(filters.status)) {
      query = query.in('status', filters.status)
    } else {
      query = query.eq('status', filters.status)
    }
  }
  if (filters?.earnedBetween) {
    query = query
      .gte('earned_at', filters.earnedBetween.from)
      .lte('earned_at', filters.earnedBetween.to)
  }

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as unknown as TechLeadWithJoins[]
}

export async function getLeadById(id: string): Promise<TechLeadWithJoins | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('tech_leads')
    .select(SELECT_WITH_JOINS)
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return (data ?? null) as unknown as TechLeadWithJoins | null
}
