import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'

// GET /api/notifications — the caller's own recent notifications (newest first)
// plus an exact unread count for the bell badge. RLS scopes rows to the caller;
// the explicit user_id filter is belt-and-suspenders.
export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user?.role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = await createClient()

    const [{ data, error }, { count, error: countError }] = await Promise.all([
      supabase
        .from('notifications')
        .select('id, type, title, body, url, entity_type, entity_id, read_at, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(30),
      supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .is('read_at', null),
    ])

    if (error || countError) throw error ?? countError

    return NextResponse.json({ notifications: data ?? [], unreadCount: count ?? 0 })
  } catch (err) {
    console.error('notifications GET error:', err)
    return NextResponse.json({ error: 'Failed to fetch notifications' }, { status: 500 })
  }
}
