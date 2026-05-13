import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, ADMIN_ROLES, MANAGER_ROLES } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAllSalesReps } from '@/lib/db/sales-reps'
import type { SalesRepKind } from '@/types/database'

const EMAIL_MAX = 320
const NAME_MAX = 200
const TITLE_MAX = 200
const VALID_KINDS: readonly SalesRepKind[] = ['rep', 'sales_manager', 'branch_manager']

function isValidEmail(s: string): boolean {
  // Mirror the DB CHECK ('%@%.%') with a slightly stricter client-side gate.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= EMAIL_MAX
}

export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user?.role || !MANAGER_ROLES.includes(user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const reps = await getAllSalesReps()
    return NextResponse.json({ sales_reps: reps })
  } catch (err) {
    console.error('GET /api/sales-reps error:', err)
    return NextResponse.json({ error: 'Failed to fetch sales reps' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user?.role || !ADMIN_ROLES.includes(user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json() as {
      name?: unknown
      email?: unknown
      kind?: unknown
      title?: unknown
    }
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const kindRaw = typeof body.kind === 'string' ? body.kind : 'rep'
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, TITLE_MAX) : ''

    if (!name || name.length > NAME_MAX) {
      return NextResponse.json({ error: `Name is required and must be ≤ ${NAME_MAX} chars` }, { status: 400 })
    }
    if (!isValidEmail(email)) {
      return NextResponse.json({ error: 'A valid email is required' }, { status: 400 })
    }
    if (!VALID_KINDS.includes(kindRaw as SalesRepKind)) {
      return NextResponse.json({ error: 'Invalid kind' }, { status: 400 })
    }
    const kind = kindRaw as SalesRepKind

    const admin = createAdminClient()
    const { data, error } = await admin
      .from('sales_reps')
      .insert({
        name,
        email,
        kind,
        title: title || null,
        active: true,
        created_by_id: user.id,
        updated_by_id: user.id,
      })
      .select()
      .single()

    if (error) {
      // Surface unique-violation as a friendly 409.
      if (error.code === '23505') {
        return NextResponse.json({ error: 'A sales rep with that email already exists' }, { status: 409 })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data, { status: 201 })
  } catch (err) {
    console.error('POST /api/sales-reps error:', err)
    return NextResponse.json({ error: 'Failed to create sales rep' }, { status: 500 })
  }
}
