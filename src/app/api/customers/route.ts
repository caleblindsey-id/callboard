import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, MANAGER_ROLES } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Create a PROVISIONAL customer for same-day work.
 *
 * CallBoard reads customers from a Supabase cache populated by a nightly Synergy
 * sync, so a customer set up in Synergy today is not selectable until tomorrow.
 * The office always creates the customer in Synergy first (so a real CustomerCode
 * exists same-day); this route lets them enter that code in CallBoard immediately
 * as a provisional row. The next nightly sync upserts on synergy_id, fills the rest,
 * and flips provisional -> false. Office staff only (not technicians).
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user?.role || !MANAGER_ROLES.includes(user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const code = String(body.synergy_code ?? '').trim()
    const name = String(body.name ?? '').trim()

    if (!/^\d+$/.test(code)) {
      return NextResponse.json(
        { error: 'A numeric Synergy customer code is required' },
        { status: 400 }
      )
    }
    if (!name) {
      return NextResponse.json({ error: 'Customer name is required' }, { status: 400 })
    }

    const admin = await createAdminClient('ADMIN_ONLY')

    // Insert-or-return-existing on synergy_id (UNIQUE). If the office types a code
    // that already synced or was already entered provisionally, reuse that row.
    const { data: existing } = await admin
      .from('customers')
      .select('*')
      .eq('synergy_id', code)
      .maybeSingle()
    if (existing) {
      return NextResponse.json({ customer: existing, existed: true }, { status: 200 })
    }

    const { data, error } = await admin
      .from('customers')
      .insert({
        synergy_id: code,
        account_number: code,
        name,
        active: true,
        provisional: true,
        po_required: !!body.po_required,
        provisional_created_by: user.id,
        provisional_created_at: new Date().toISOString(),
      })
      .select('*')
      .single()

    if (error) {
      // Unique-violation race: another request inserted the same code first.
      if (error.code === '23505') {
        const { data: raced } = await admin
          .from('customers')
          .select('*')
          .eq('synergy_id', code)
          .maybeSingle()
        if (raced) {
          return NextResponse.json({ customer: raced, existed: true }, { status: 200 })
        }
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ customer: data, existed: false }, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
