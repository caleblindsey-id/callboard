import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser, MANAGER_ROLES } from '@/lib/auth'
import type { SupplyRequestInsert, SupplyRequestItem } from '@/types/database'

// POST /api/supply-requests — a tech requests shop supplies. Office staff may
// also submit on a tech's behalf. requested_by is taken from the session, never
// the body. (Round 2 adds the manager notification after insert.)

type ItemInput = { name?: unknown; quantity?: unknown; catalog_id?: unknown; unit?: unknown }
type CreateBody = { items?: ItemInput[]; note?: unknown }

const MAX_ITEMS = 50

function normalizeItems(raw: unknown): { ok: true; items: SupplyRequestItem[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: 'Add at least one item to request.' }
  }
  if (raw.length > MAX_ITEMS) {
    return { ok: false, error: `Too many items (max ${MAX_ITEMS}).` }
  }
  const items: SupplyRequestItem[] = []
  for (const it of raw as ItemInput[]) {
    const name = typeof it?.name === 'string' ? it.name.trim() : ''
    if (!name) return { ok: false, error: 'Each item needs a name.' }
    const qty = Number(it?.quantity)
    if (!Number.isFinite(qty) || qty <= 0) {
      return { ok: false, error: `Enter a quantity greater than zero for "${name}".` }
    }
    items.push({
      name: name.slice(0, 120),
      quantity: Math.floor(qty),
      catalog_id: typeof it?.catalog_id === 'string' ? it.catalog_id : null,
      unit: typeof it?.unit === 'string' && it.unit.trim() ? it.unit.trim() : null,
    })
  }
  return { ok: true, items }
}

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
    const result = normalizeItems(body.items)
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
