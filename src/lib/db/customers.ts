import { createClient } from '@/lib/supabase/server'
import { sanitizeOrValue, safeOrRaw } from '@/lib/db/safe-or'
import { CustomerRow, ContactRow, ShipToLocationRow } from '@/types/database'
import { CUSTOMER_LIST_COLUMNS, CUSTOMER_LIST_LIMIT } from '@/lib/db/customer-list'

export async function getCustomers(
  search?: string
): Promise<{ customers: CustomerRow[]; total: number }> {
  const supabase = await createClient()

  let query = supabase
    .from('customers')
    .select(CUSTOMER_LIST_COLUMNS, { count: 'exact' })
    .eq('active', true)
    .order('name')
    .limit(CUSTOMER_LIST_LIMIT)

  if (search) {
    // Sanitize before splicing into .or() — see lib/db/safe-or.
    const safe = sanitizeOrValue(search)
    query = query.or(safeOrRaw([
      { column: 'name', op: 'ilike', raw: `%${safe}%` },
      { column: 'account_number', op: 'ilike', raw: `%${safe}%` },
    ]))
  }

  const { data, error, count } = await query

  if (error) throw error
  const customers = data as unknown as CustomerRow[]
  return { customers, total: count ?? customers.length }
}

export async function getCustomer(
  id: number
): Promise<(CustomerRow & { contacts: ContactRow[]; ship_to_locations: ShipToLocationRow[] }) | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('customers')
    .select('*, contacts(*), ship_to_locations(*)')
    .eq('id', id)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null
    throw error
  }

  return data as unknown as CustomerRow & { contacts: ContactRow[]; ship_to_locations: ShipToLocationRow[] }
}