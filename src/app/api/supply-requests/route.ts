import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser, MANAGER_ROLES } from '@/lib/auth'
import { normalizeSupplyItems } from '@/lib/supply-requests/normalize-items'
import type { SupplyRequestInsert } from '@/types/database'

// POST /api/supply-requests — a tech requests shop supplies. Office staff may
// also submit on a tech's behalf. requested_by is taken from the session, never
// the body. (Round 2 adds the manager notification after insert.)

type CreateBody = { items?: unknown; note?: unknown }

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user?.role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const isStaff = MANAGER_ROLES.includes(user.role)
    const isTech = user.role === 'technician'
    if (!isStaff && !isTech) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = (await request.json()) as CreateBody
    const result = normalizeSupplyItems(body.items)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }
    const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 1000) : null

    const insert: SupplyRequestInsert = {
      requested_by: user.id,
      items: result.items,
      note,
    }

    const supabase = await createClient()
    const { data, error } = await supabase
      .from('supply_requests')
      .insert(insert)
      .select('id')
      .single()
    if (error) {
      console.error('supply-requests create error:', error)
      return NextResponse.json({ error: 'Failed to submit request.' }, { status: 500 })
    }

    return NextResponse.json({ success: true, id: data.id })
  } catch (err) {
    console.error('supply-requests POST error:', err)
    return NextResponse.json({ error: 'Failed to submit request.' }, { status: 500 })
  }
}
