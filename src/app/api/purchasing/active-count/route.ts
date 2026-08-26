import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'
import { PURCHASING_ROLES } from '@/types/database'
import type { ReorderSessionStatus } from '@/types/reorder'

// Lightweight count for the Sidebar's Purchasing nav badge — non-terminal
// reorder_sessions only (draft/walking/review/ordered). head:true so
// PostgREST returns just the count, no row payload, for a link that's
// fetched on every page load.
const ACTIVE_STATUSES: ReorderSessionStatus[] = ['draft', 'walking', 'review', 'ordered']

export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user?.role || !PURCHASING_ROLES.includes(user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const supabase = await createClient()
    const { count, error } = await supabase
      .from('reorder_sessions')
      .select('id', { count: 'exact', head: true })
      .in('status', ACTIVE_STATUSES)

    if (error) throw error

    return NextResponse.json({ count: count ?? 0 })
  } catch (err) {
    console.error('purchasing/active-count GET error:', err)
    return NextResponse.json({ error: 'Failed to fetch active session count' }, { status: 500 })
  }
}
