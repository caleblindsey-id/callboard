import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUser } from '@/lib/db/users'
import { UserRow, UserRole } from '@/types/database'

export const MANAGER_ROLES: UserRole[] = ['manager', 'coordinator']

export function isTechnician(role: UserRole | null): boolean {
  if (!role) return false
  return role === 'technician'
}

export async function getCurrentUser(): Promise<UserRow | null> {
  try {
    const supabase = await createClient()
    const { data: { user }, error } = await supabase.auth.getUser()
    if (error || !user) return null
    return getUser(user.id)
  } catch {
    return null
  }
}

export async function requireRole(...roles: UserRole[]): Promise<UserRow> {
  const user = await getCurrentUser()
  if (!user || !user.role) {
    redirect('/login')
  }
  if (!roles.includes(user.role)) {
    redirect('/')
  }
  return user
}
