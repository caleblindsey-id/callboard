import { createClient } from '@/lib/supabase/server'
import type { EquipmentSaleLeadCandidateRow } from '@/types/database'

export type CandidateWithLead = EquipmentSaleLeadCandidateRow

const SELECT_CANDIDATE = '*' as const

/**
 * Pull pending candidates for a given set of lead IDs, in one query.
 * Keyed back by tech_lead_id for grouping in the Match Candidates tab.
 */
export async function getPendingCandidatesForLeads(
  leadIds: string[],
): Promise<Record<string, CandidateWithLead[]>> {
  if (leadIds.length === 0) return {}
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('equipment_sale_lead_candidates')
    .select(SELECT_CANDIDATE)
    .in('tech_lead_id', leadIds)
    .eq('status', 'pending')
    .order('synergy_order_date', { ascending: false })
  if (error) throw error
  const grouped: Record<string, CandidateWithLead[]> = {}
  for (const c of (data ?? []) as CandidateWithLead[]) {
    if (!grouped[c.tech_lead_id]) grouped[c.tech_lead_id] = []
    grouped[c.tech_lead_id].push(c)
  }
  return grouped
}
