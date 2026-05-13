import { createClient } from '@/lib/supabase/server'
import type { SalesRep, SalesRepKind } from '@/types/database'

// Sort key: branch_manager → sales_manager → rep within each active group.
const KIND_ORDER: Record<SalesRepKind, number> = {
  branch_manager: 0,
  sales_manager: 1,
  rep: 2,
}

function sortByKindThenName(rows: SalesRep[]): SalesRep[] {
  return [...rows].sort((a, b) => {
    const k = KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
    if (k !== 0) return k
    return a.name.localeCompare(b.name)
  })
}

export async function getAllSalesReps(): Promise<SalesRep[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('sales_reps')
    .select('*')
    .order('active', { ascending: false })
  if (error) throw error
  const rows = (data ?? []) as SalesRep[]
  // Stable order: active first, then by kind (managers above reps), then name.
  const active = sortByKindThenName(rows.filter(r => r.active))
  const inactive = sortByKindThenName(rows.filter(r => !r.active))
  return [...active, ...inactive]
}

export async function getActiveSalesReps(): Promise<SalesRep[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('sales_reps')
    .select('*')
    .eq('active', true)
  if (error) throw error
  return sortByKindThenName((data ?? []) as SalesRep[])
}

export async function getSalesRepById(id: string): Promise<SalesRep | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('sales_reps')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return (data ?? null) as SalesRep | null
}

export async function getSalesRepsByIds(ids: string[]): Promise<SalesRep[]> {
  if (ids.length === 0) return []
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('sales_reps')
    .select('*')
    .in('id', ids)
  if (error) throw error
  return (data ?? []) as SalesRep[]
}
