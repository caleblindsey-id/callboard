import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser, MANAGER_ROLES } from '@/lib/auth'
import type { SupplyCatalogUpdate } from '@/types/database'

// PATCH /api/supply-catalog/[id] — office staff edit a quick-pick item
// (name / unit / sort_order / active). DELETE removes it. Items on existing
// requests store their name/unit denormalized, so removing a catalog row never
// breaks request history.

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser()
  if (!user?.role) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!MANAGER_ROLES.includes(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  try {
    const { id } = await params
    const body = (await request.json()) as {
      name?: unknown; unit?: unknown; sort_order?: unknown; active?: unknown
    }
    const update: SupplyCatalogUpdate = {}
    if (typeof body.name === 'string') {
      const name = body.name.trim()
      if (!name) return NextResponse.json({ error: 'Name cannot be empty.' }, { status: 400 })
      update.name = name.slice(0, 120)
    }
    if ('unit' in body) {
      update.unit = typeof body.unit === 'string' && body.unit.trim() ? body.unit.trim().slice(0, 30) : null
    }
    if (body.sort_order !== undefined && Number.isFinite(Number(body.sort_order))) {
      update.sort_order = Math.trunc(Number(body.sort_order))
    }
    if (typeof body.active === 'boolean') {
      update.active = body.active
    }
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })
    }

    const supabase = await createClient()
    const { error } = await supabase.from('supply_catalog').update(update).eq('id', id)
    if (error) {
      console.error('supply-catalog PATCH error:', error)
      return NextResponse.json({ error: 'Failed to update supply.' }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('supply-catalog PATCH error:', err)
    return NextResponse.json({ error: 'Failed to update supply.' }, { status: 500 })
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser()
  if (!user?.role) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // Mirrors the RLS delete policy: super_admin + manager only.
  if (user.role !== 'super_admin' && user.role !== 'manager') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  try {
    const { id } = await params
    const supabase = await createClient()
    const { error } = await supabase.from('supply_catalog').delete().eq('id', id)
    if (error) {
      console.error('supply-catalog DELETE error:', error)
      return NextResponse.json({ error: 'Failed to delete supply.' }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('supply-catalog DELETE error:', err)
    return NextResponse.json({ error: 'Failed to delete supply.' }, { status: 500 })
  }
}
