import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser, RESET_ROLES } from '@/lib/auth'

// Restore a soft-deleted service ticket. Parity with PM
// (src/app/api/tickets/[id]/restore/route.ts). Service has no live-slot unique
// constraint like PM's (pm_schedule, month, year), so there's no 23505 case.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const user = await getCurrentUser()
    if (!user?.role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!RESET_ROLES.includes(user.role!)) {
      return NextResponse.json({ error: 'Only managers can restore tickets' }, { status: 403 })
    }

    const supabase = await createClient()

    const { data: restored, error } = await supabase
      .from('service_tickets')
      .update({ deleted_at: null, deleted_by_id: null })
      .eq('id', id)
      .not('deleted_at', 'is', null)
      .select('id')
      .maybeSingle()

    if (error) throw error
    if (!restored) {
      return NextResponse.json({ error: 'Ticket not found or not deleted' }, { status: 404 })
    }

    return NextResponse.json({ success: true, id: restored.id })
  } catch (err) {
    console.error('service-tickets/[id]/restore error:', err)
    return NextResponse.json({ error: 'Failed to restore ticket' }, { status: 500 })
  }
}
