import { createClient } from '@/lib/supabase/server'
import type { SalesRep } from '@/types/database'

export async function getAllSalesReps(): Promise<SalesRep[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('sales_reps')
    .select('*')
    .order('active', { ascending: false })
    .order('name', { ascending: true })
  if (error) throw error
  return (data ?? []) as SalesRep[]
}

export async function getActiveSalesReps(): Promise<SalesRep[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('sales_reps')
    .select('*')
    .eq('active', true)
    .order('name', { ascending: true })
  if (error) throw error
  return (data ?? []) as SalesRep[]
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
