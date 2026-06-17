import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser, MANAGER_ROLES } from '@/lib/auth'
import { getSupplyCatalog } from '@/lib/db/supply-requests'
import type { SupplyCatalogInsert } from '@/types/database'

// GET /api/supply-catalog — active quick-pick supply list for the tech request
// form. Any authenticated user may read it.
export async function GET() {
  const user = await getCurrentUser()
  if (!user?.role) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const catalog = await getSupplyCatalog()
    return NextResponse.json({ catalog })
  } catch (err) {
    console.error('supply-catalog GET error:', err)
    return NextResponse.json({ error: 'Failed to load supplies.' }, { status: 500 })
  }
}

// POST /api/supply-catalog — office staff add a quick-pick item.
export async function POST(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user?.role) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!MANAGER_ROLES.includes(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  try {
    const body = (await request.json()) as { name?: unknown; unit?: unknown; sort_order?: unknown }
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) {
      return NextResponse.json({ error: 'Enter a name for the supply.' }, { status: 400 })
    }
    const insert: SupplyCatalogInsert = {
      name: name.slice(0, 120),
      unit: typeof body.unit === 'string' && body.unit.trim() ? body.unit.trim().slice(0, 30) : null,
      sort_order: Number.isFinite(Number(body.sort_order)) ? Math.trunc(Number(body.sort_order)) : 0,
    }
    const supabase = await createClient()
    const { data, error } = await supabase.from('supply_catalog').insert(insert).select('id').single()
    if (error) {
      console.error('supply-catalog POST error:', error)
      return NextResponse.json({ error: 'Failed to add supply.' }, { status: 500 })
    }
    return NextResponse.json({ success: true, id: data.id })
  } catch (err) {
    console.error('supply-catalog POST error:', err)
    return NextResponse.json({ error: 'Failed to add supply.' }, { status: 500 })
  }
}
