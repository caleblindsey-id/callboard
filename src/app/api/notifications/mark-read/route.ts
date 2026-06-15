import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'

// POST /api/notifications/mark-read — mark the caller's notifications read.
// Body: { id } for one, or { all: true } for every unread one. RLS's owner
// UPDATE policy scopes this to the caller's own rows.
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user?.role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const supabase = await createClient()

    let query = supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .is('read_at', null)

    if (body?.all === true) {
      // mark every unread row
    } else if (typeof body?.id === 'string' && body.id) {
      query = query.eq('id', body.id)
    } else {
      return NextResponse.json({ error: 'Provide an id or all: true' }, { status: 400 })
    }

    const { error } = await query
    if (error) throw error

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('notifications mark-read error:', err)
    return NextResponse.json({ error: 'Failed to mark notifications read' }, { status: 500 })
  }
}
