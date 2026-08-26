import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, MANAGER_ROLES } from '@/lib/auth'
import { getTeamAnalytics, stripCostFieldsForCoordinator, type TicketType } from '@/lib/db/analytics'
import { ANALYTICS_TICKET_TYPES, isValidDateKey, todayKey } from '@/lib/analytics-period'

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user?.role || !MANAGER_ROLES.includes(user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const periodParam = request.nextUrl.searchParams.get('period') ?? 'monthly'
    if (periodParam !== 'weekly' && periodParam !== 'monthly') {
      return NextResponse.json({ error: 'Invalid period' }, { status: 400 })
    }
    const date = request.nextUrl.searchParams.get('date') ?? todayKey()
    if (!isValidDateKey(date)) {
      return NextResponse.json({ error: 'Invalid date — must be YYYY-MM-DD' }, { status: 400 })
    }
    const typeParam = (request.nextUrl.searchParams.get('type') ?? 'combined') as TicketType
    if (!ANALYTICS_TICKET_TYPES.includes(typeParam)) {
      return NextResponse.json({ error: 'Invalid type — must be pm, service, or combined' }, { status: 400 })
    }

    const raw = await getTeamAnalytics(periodParam, date, typeParam)
    // Strip cost-derived fields (hourlyCost, laborCost, grossProfit) for
    // coordinators — back-calculable to per-tech compensation otherwise.
    const data = stripCostFieldsForCoordinator(raw, user.role)
    return NextResponse.json(data)
  } catch (err) {
    console.error('analytics team GET error:', err)
    return NextResponse.json({ error: 'Failed to fetch team analytics' }, { status: 500 })
  }
}
