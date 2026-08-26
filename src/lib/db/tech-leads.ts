import { createClient } from '@/lib/supabase/server'
import type { DigestDb } from '@/lib/digest/types'
import type { TechLeadRow } from '@/types/database'

// Lead joined with the bits of customer / tech / equipment the UI needs to render
// a row without a second round-trip.
export type TechLeadWithJoins = TechLeadRow & {
  customers: { id: number; name: string; account_number: string | null; primary_sales_rep: string | null } | null
  submitter: { id: string; name: string } | null
  approver: { id: string; name: string } | null
  payer: { id: string; name: string } | null
  equipment: { id: string; make: string | null; model: string | null; serial_number: string | null } | null
}

const SELECT_WITH_JOINS = `
  *,
  customers(id, name, account_number, primary_sales_rep),
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

// Every lead, newest first. Deliberately unfiltered: the payout hub partitions
// them client-side across its lifecycle tabs, and there are 34 rows.
//
// This used to take a `filters` argument with `status` and `earnedBetween`
// branches. Nothing ever passed one -- the sole caller calls it bare -- and
// `earnedBetween` in particular was the server-side version of a filter the old
// payout report re-implemented in the browser. Removed rather than left as a
// second, subtly different, way to ask the same question.
export async function getAllLeads(db?: DigestDb): Promise<TechLeadWithJoins[]> {
  const supabase = db ?? (await createClient())
  const { data, error } = await supabase
    .from('tech_leads')
    .select(SELECT_WITH_JOINS)
    .order('submitted_at', { ascending: false })
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
