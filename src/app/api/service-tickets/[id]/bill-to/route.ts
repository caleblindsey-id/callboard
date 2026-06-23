import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser, RESET_ROLES } from '@/lib/auth'
import { repointTicketBillTo } from '@/lib/db/repoint-billto'

// POST /api/service-tickets/[id]/bill-to
//
// Manager-only single-ticket bill-to correction. Repoints the ticket's
// customer_id (and clears an orphaned ship-to) via the shared safe-repoint
// helper, which hard-blocks any ticket already keyed in Synergy. Mirrors the
// manager-only equipment bill-to control (PR #183).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const user = await getCurrentUser()
    if (!user?.role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!RESET_ROLES.includes(user.role)) {
      return NextResponse.json(
        { error: 'Only managers can change a ticket bill-to account.' },
        { status: 403 }
      )
    }

    const body = (await request.json()) as { customer_id?: unknown }
    const customerId =
      typeof body.customer_id === 'number' ? body.customer_id : Number(body.customer_id)

    const supabase = await createClient()
    const result = await repointTicketBillTo(supabase, {
      kind: 'service',
      ticketId: id,
      customerId,
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json({ success: true, clearedShipTo: result.clearedShipTo })
  } catch (err) {
    console.error('service-tickets/[id]/bill-to POST error:', err)
    return NextResponse.json({ error: 'Failed to update ticket bill-to' }, { status: 500 })
  }
}
