import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, MANAGER_ROLES } from '@/lib/auth'
import { getTeamAnalytics } from '@/lib/db/analytics'

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user?.role || !MANAGER_ROLES.includes(user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const period = (request.nextUrl.searchParams.get('period') ?? 'monthly') as 'weekly' | 'monthly'
    const date = request.nextUrl.searchParams.get('date') ?? new Date().toISOString().split('T')[0]

    const data = await getTeamAnalytics(period, date)
    return NextResponse.json(data)
  } catch (err) {
    console.error('analytics team GET error:', err)
    return NextResponse.json({ error: 'Failed to fetch team analytics' }, { status: 500 })
  }
}
