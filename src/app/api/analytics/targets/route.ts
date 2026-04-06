import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, MANAGER_ROLES } from '@/lib/auth'
import { getTechnicianTargets, setTechnicianTarget } from '@/lib/db/analytics'

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user?.role || !MANAGER_ROLES.includes(user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const techId = request.nextUrl.searchParams.get('technicianId') ?? undefined
    const data = await getTechnicianTargets(techId)
    return NextResponse.json(data)
  } catch (err) {
    console.error('analytics targets GET error:', err)
    return NextResponse.json({ error: 'Failed to fetch targets' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user?.role || !MANAGER_ROLES.includes(user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { technicianId, metric, value, periodType } = await request.json() as {
      technicianId: string | null
      metric: string
      value: number
      periodType: string
    }

    const validMetrics = ['tickets_completed', 'revenue', 'avg_completion_days', 'revenue_per_hour']
    if (!validMetrics.includes(metric)) {
      return NextResponse.json({ error: 'Invalid metric' }, { status: 400 })
    }

    if (!['weekly', 'monthly'].includes(periodType)) {
      return NextResponse.json({ error: 'Invalid period type' }, { status: 400 })
    }

    await setTechnicianTarget(technicianId, metric, value, periodType)
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('analytics targets PUT error:', err)
    return NextResponse.json({ error: 'Failed to set target' }, { status: 500 })
  }
}
