import { createClient } from '@/lib/supabase/server'
import { CustomerRow, ContactRow } from '@/types/database'

export async function getCustomers(search?: string): Promise<CustomerRow[]> {
  const supabase = await createClient()

  let query = supabase
    .from('customers')
    .select('*')
    .order('name')

  if (search) {
    query = query.ilike('name', `%${search}%`)
  }

  const { data, error } = await query

  if (error) throw error
  return data
}

export async function getCustomer(
  id: number
): Promise<(CustomerRow & { contacts: ContactRow[] }) | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('customers')
    .select('*, contacts(*)')
    .eq('id', id)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null
    throw error
  }

  return data as CustomerRow & { contacts: ContactRow[] }
}

export async function searchCustomers(query: string): Promise<CustomerRow[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .or(`name.ilike.%${query}%,account_number.ilike.%${query}%`)
    .order('name')
    .limit(20)

  if (error) throw error
  return data
}
