import { NextRequest, NextResponse } from 'next/server'
import { bulkSoftDeleteTickets } from '@/lib/db/tickets'
import { getCurrentUser, RESET_ROLES } from '@/lib/auth'

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
