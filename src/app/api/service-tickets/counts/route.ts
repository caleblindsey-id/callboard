import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, isTechnician } from '@/lib/auth'
import { getServiceTicketStatusCounts } from '@/lib/db/service-tickets'
import type { ServicePriority, ServiceTicketType } from '@/types/service-tickets'

// Status-tab counts for the service board. Mirrors the filter parsing of the
// list route (GET /api/service-tickets) so the tab numbers stay consistent with
// the rows the board shows — minus the status filter, since counts span every
// status. Techs are scoped to their own tickets the same way the list is.
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user?.role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)

    const filters: {
      technicianId?: string
      priority?: ServicePriority
      ticketType?: ServiceTicketType
      waitingOnParts?: boolean
    } = {}

    if (searchParams.get('technicianId')) filters.technicianId = searchParams.get('technicianId')!
    if (searchParams.get('priority')) filters.priority = searchParams.get('priority') as ServicePriority
    if (searchParams.get('ticketType')) filters.ticketType = searchParams.get('ticketType') as ServiceTicketType
    if (searchParams.get('waitingOnParts') === 'true') filters.waitingOnParts = true

    // Techs only see their own tickets (RLS enforces this too) — scope counts to match.
    if (isTechnician(user.role)) {
      filters.technicianId = user.id
    }

    const counts = await getServiceTicketStatusCounts(filters)
    return NextResponse.json(counts)
  } catch (err) {
    console.error('service-tickets counts GET error:', err)
    return NextResponse.json({ error: 'Failed to fetch service ticket counts' }, { status: 500 })
  }
}
