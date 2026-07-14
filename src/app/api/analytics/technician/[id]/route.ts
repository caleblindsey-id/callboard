import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, MANAGER_ROLES } from '@/lib/auth'
import { getTechnicianAnalytics, stripTechCostFieldsForCoordinator, type TicketType } from '@/lib/db/analytics'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TICKET_TYPES: TicketType[] = ['pm', 'service', 'combined']

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user?.role || !MANAGER_ROLES.includes(user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Invalid technician ID' }, { status: 400 })
    }
    const periodParam = request.nextUrl.searchParams.get('period') ?? 'monthly'
    if (periodParam !== 'weekly' && periodParam !== 'monthly') {
      return NextResponse.json({ error: 'Invalid period' }, { status: 400 })
    }
    const date = request.nextUrl.searchParams.get('date') ?? new Date().toISOString().split('T')[0]
    if (!DATE_RE.test(date)) {
      return NextResponse.json({ error: 'Invalid date — must be YYYY-MM-DD' }, { status: 400 })
    }
    const typeParam = (request.nextUrl.searchParams.get('type') ?? 'combined') as TicketType
    if (!TICKET_TYPES.includes(typeParam)) {
      return NextResponse.json({ error: 'Invalid type — must be pm, service, or combined' }, { status: 400 })
    }

    const raw = await getTechnicianAnalytics(id, periodParam, date, typeParam)
    const data = stripTechCostFieldsForCoordinator(raw, user.role)
    return NextResponse.json(data)
  } catch (err) {
    console.error('analytics technician GET error:', err)
    return NextResponse.json({ error: 'Failed to fetch technician analytics' }, { status: 500 })
  }
}
