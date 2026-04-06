import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, MANAGER_ROLES } from '@/lib/auth'
import { getTechnicianAnalytics } from '@/lib/db/analytics'

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
    const period = (request.nextUrl.searchParams.get('period') ?? 'monthly') as 'weekly' | 'monthly'
    const date = request.nextUrl.searchParams.get('date') ?? new Date().toISOString().split('T')[0]

    const data = await getTechnicianAnalytics(id, period, date)
    return NextResponse.json(data)
  } catch (err) {
    console.error('analytics technician GET error:', err)
    return NextResponse.json({ error: 'Failed to fetch technician analytics' }, { status: 500 })
  }
}
