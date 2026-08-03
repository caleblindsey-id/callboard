import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, ADMIN_ROLES } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { UserRole } from '@/types/database'

const ALLOWED_ROLES: readonly UserRole[] = ['super_admin', 'manager', 'coordinator', 'technician'] as const

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const currentUser = await getCurrentUser()
    if (!currentUser?.role || !ADMIN_ROLES.includes(currentUser.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const body = await request.json() as {
      role?: UserRole
      active?: boolean
      hourly_cost?: number | null
      can_create_service_tickets?: boolean
      commission_eligible?: boolean
      commission_rate_override?: number | null
    }

    const update: Record<string, unknown> = {}

    if (body.role !== undefined) {
      if (!ALLOWED_ROLES.includes(body.role)) {
        return NextResponse.json({ error: 'Invalid role.' }, { status: 400 })
      }
      if (currentUser.id === id) {
        return NextResponse.json(
          { error: 'You cannot change your own role.' },
          { status: 400 }
        )
      }
      update.role = body.role
    }

    if (body.active !== undefined) {
      if (currentUser.id === id && body.active === false) {
        return NextResponse.json(
          { error: 'You cannot deactivate yourself.' },
          { status: 400 }
        )
      }
      update.active = body.active
    }

    if (body.hourly_cost !== undefined) {
      if (body.hourly_cost !== null && (typeof body.hourly_cost !== 'number' || body.hourly_cost < 0)) {
        return NextResponse.json({ error: 'Hourly cost must be a non-negative number.' }, { status: 400 })
      }
      update.hourly_cost = body.hourly_cost
    }

    if (body.can_create_service_tickets !== undefined) {
      update.can_create_service_tickets = body.can_create_service_tickets
    }

    if (body.commission_eligible !== undefined) {
      if (typeof body.commission_eligible !== 'boolean') {
        return NextResponse.json({ error: 'Commission eligibility must be true or false.' }, { status: 400 })
      }
      update.commission_eligible = body.commission_eligible
    }

    // A fraction, not a percentage: 0.075 is 7.5%. NULL means use the tier
    // table, which is the normal case. The DB carries the same 0..1 CHECK
    // (migration 153); this is the friendly error before it fires.
    if (body.commission_rate_override !== undefined) {
      const v = body.commission_rate_override
      if (v !== null && (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1)) {
        return NextResponse.json(
          { error: 'Rate override must be a fraction between 0 and 1, or blank to use the tier table.' },
          { status: 400 }
        )
      }
      update.commission_rate_override = v
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'No updatable fields supplied.' }, { status: 400 })
    }

    update.updated_by_id = currentUser.id

    const admin = await createAdminClient('ADMIN_ONLY')
    const { data: user, error } = await admin
      .from('users')
      .update(update)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(user)
  } catch (err) {
    console.error('PATCH /api/users/[id] error:', err)
    return NextResponse.json({ error: 'Failed to update user.' }, { status: 500 })
  }
}
