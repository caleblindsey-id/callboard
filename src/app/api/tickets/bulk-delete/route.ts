import { NextRequest, NextResponse } from 'next/server'
import { bulkSoftDeleteTickets } from '@/lib/db/tickets'
import { getCurrentUser, RESET_ROLES } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { partsOnOrder } from '@/lib/parts'
import type { PartRequest } from '@/types/database'

interface BulkDeleteBody {
  ticketIds: string[]
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user?.role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!RESET_ROLES.includes(user.role)) {
      return NextResponse.json({ error: 'Only managers can delete tickets' }, { status: 403 })
    }

    const body = (await request.json()) as BulkDeleteBody
    const { ticketIds } = body

    if (!ticketIds || !Array.isArray(ticketIds) || ticketIds.length === 0) {
      return NextResponse.json(
        { error: 'ticketIds must be a non-empty array' },
        { status: 400 }
      )
    }

    // Hard block: reject the whole batch if ANY selected ticket still has parts
    // on order, so a live vendor PO never loses its parent ticket. All-or-nothing
    // keeps the result transparent — name the offenders so the manager can fix them.
    const supabase = await createClient()
    const { data: rows, error: fetchError } = await supabase
      .from('pm_tickets')
      .select('id, work_order_number, parts_requested')
      .in('id', ticketIds)
      .is('deleted_at', null)

    if (fetchError) throw fetchError

    const blocked = (rows ?? []).filter(
      (r) => partsOnOrder(r.parts_requested as PartRequest[] | null).length > 0
    )
    if (blocked.length > 0) {
      const wos = blocked.map((r) => `#${r.work_order_number}`).join(', ')
      return NextResponse.json(
        {
          error: `Cannot delete: ${blocked.length} ticket(s) still have parts on order (${wos}). Receive or cancel those parts first.`,
        },
        { status: 409 }
      )
    }

    const deleted = await bulkSoftDeleteTickets(ticketIds, user.id)

    return NextResponse.json({ count: deleted.length })
  } catch (err) {
    console.error('tickets/bulk-delete error:', err)
    return NextResponse.json(
      { error: 'Failed to bulk delete tickets' },
      { status: 500 }
    )
  }
}
