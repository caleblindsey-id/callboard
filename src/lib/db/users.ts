import { createClient } from '@/lib/supabase/server'
import { UserRow, UserRole } from '@/types/database'

export async function getUsers(activeOnly?: boolean): Promise<UserRow[]> {
  const supabase = await createClient()

  let query = supabase
    .from('users')
    .select('*')
    .order('name')

  if (activeOnly) {
    query = query.eq('active', true)
  }

  const { data, error } = await query

  if (error) throw error
  return data
}

export async function getUser(id: string): Promise<UserRow | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', id)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null
    throw error
  }

  return data
}

export async function createUser(data: {
  email: string
  name: string
  role: UserRole
}): Promise<UserRow> {
  const supabase = await createClient()

  const { data: created, error } = await supabase
    .from('users')
    .insert({
      email: data.email,
      name: data.name,
      role: data.role,
    })
    .select()
    .single()

  if (error) throw error
  return created
}

export async function updateUser(
  id: string,
  data: { name?: string; role?: UserRole; active?: boolean }
): Promise<UserRow> {
  const supabase = await createClient()

  const { data: updated, error } = await supabase
    .from('users')
    .update(data)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return updated
}
