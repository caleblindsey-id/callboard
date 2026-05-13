import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, ADMIN_ROLES } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import type { SalesRepKind } from '@/types/database'

const EMAIL_MAX = 320
const NAME_MAX = 200
const TITLE_MAX = 200
const VALID_KINDS: readonly SalesRepKind[] = ['rep', 'sales_manager', 'branch_manager']

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= EMAIL_MAX
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user?.role || !ADMIN_ROLES.includes(user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const body = await request.json() as {
      name?: unknown
      email?: unknown
      kind?: unknown
      title?: unknown
      active?: unknown
    }

    const update: Record<string, unknown> = {}

    if (body.name !== undefined) {
      if (typeof body.name !== 'string') {
        return NextResponse.json({ error: 'name must be a string' }, { status: 400 })
      }
      const name = body.name.trim()
      if (!name || name.length > NAME_MAX) {
        return NextResponse.json({ error: `Name must be 1–${NAME_MAX} chars` }, { status: 400 })
      }
      update.name = name
    }

    if (body.email !== undefined) {
      if (typeof body.email !== 'string') {
        return NextResponse.json({ error: 'email must be a string' }, { status: 400 })
      }
      const email = body.email.trim().toLowerCase()
      if (!isValidEmail(email)) {
        return NextResponse.json({ error: 'A valid email is required' }, { status: 400 })
      }
      update.email = email
    }

    if (body.kind !== undefined) {
      if (typeof body.kind !== 'string' || !VALID_KINDS.includes(body.kind as SalesRepKind)) {
        return NextResponse.json({ error: 'Invalid kind' }, { status: 400 })
      }
      update.kind = body.kind
    }

    if (body.title !== undefined) {
      if (body.title === null || body.title === '') {
        update.title = null
      } else if (typeof body.title === 'string') {
        update.title = body.title.trim().slice(0, TITLE_MAX) || null
      } else {
        return NextResponse.json({ error: 'title must be a string or null' }, { status: 400 })
      }
    }

    if (body.active !== undefined) {
      if (typeof body.active !== 'boolean') {
        return NextResponse.json({ error: 'active must be a boolean' }, { status: 400 })
      }
      update.active = body.active
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'No updatable fields supplied' }, { status: 400 })
    }

    update.updated_by_id = user.id

    const admin = createAdminClient()
    const { data, error } = await admin
      .from('sales_reps')
      .update(update)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'A sales rep with that email already exists' }, { status: 409 })
      }
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Sales rep not found' }, { status: 404 })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (err) {
    console.error('PATCH /api/sales-reps/[id] error:', err)
    return NextResponse.json({ error: 'Failed to update sales rep' }, { status: 500 })
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user?.role || !ADMIN_ROLES.includes(user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const admin = createAdminClient()
    const { error } = await admin
      .from('sales_reps')
      .delete()
      .eq('id', id)

    if (error) {
      // 23503 = FK violation — a tech_lead already references this rep.
      if (error.code === '23503') {
        return NextResponse.json(
          { error: 'Cannot delete a sales rep who has received leads. Deactivate them instead.' },
          { status: 409 }
        )
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/sales-reps/[id] error:', err)
    return NextResponse.json({ error: 'Failed to delete sales rep' }, { status: 500 })
  }
}
