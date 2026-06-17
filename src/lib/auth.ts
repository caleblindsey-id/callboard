import { cache } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUser } from '@/lib/db/users'
import { UserRow, UserRole, MANAGER_ROLES, RESET_ROLES, ADMIN_ROLES, AUDIT_ROLES } from '@/types/database'

export { MANAGER_ROLES, RESET_ROLES, ADMIN_ROLES, AUDIT_ROLES }

export function isTechnician(role: UserRole | null): boolean {
  if (!role) return false
  return role === 'technician'
}

// Managers/coordinators/super-admins always may; a technician may only if the
// per-tech `can_create_service_tickets` flag is turned on in Settings.
export function canCreateServiceTickets(user: UserRow | null): boolean {
  if (!user?.role) return false
  if (MANAGER_ROLES.includes(user.role)) return true
  return user.role === 'technician' && !!user.can_create_service_tickets
}

// React cache() dedupes within a single request render — layout, page, and any
// nested server components calling getCurrentUser() share one fetch (one
// supabase.auth.getUser() + one users-table lookup) instead of N round-trips.
export const getCurrentUser = cache(async (): Promise<UserRow | null> => {
  try {
    const supabase = await createClient()
    const { data: { user }, error } = await supabase.auth.getUser()
    if (error || !user) return null
    return getUser(user.id)
  } catch {
    return null
  }
})

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
