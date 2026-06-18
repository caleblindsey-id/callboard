import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, MANAGER_ROLES } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Create a PROVISIONAL ship-to location for same-day work.
 *
 * Mirror of the provisional-customer route. A ship-to added in Synergy today is not
 * in CallBoard's dropdown until the nightly sync runs. The office enters the real
 * Synergy ShiplistCode here so the location is selectable immediately; the next sync
 * upserts on (synergy_customer_code, synergy_shiplist_code) and flips provisional ->
 * false. Office staff only (not technicians).
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user?.role || !MANAGER_ROLES.includes(user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const customerId = parseInt(String(body.customer_id ?? ''), 10)
    const shiplistCode = String(body.synergy_shiplist_code ?? '').trim()
    const name = String(body.name ?? '').trim()

    if (!Number.isInteger(customerId)) {
      return NextResponse.json({ error: 'customer_id is required' }, { status: 400 })
    }
    if (!/^\d+$/.test(shiplistCode)) {
      return NextResponse.json(
        { error: 'A numeric Synergy ship-to (shiplist) code is required' },
        { status: 400 }
      )
    }
    if (!name) {
      return NextResponse.json({ error: 'Location name is required' }, { status: 400 })
    }

    const admin = await createAdminClient('ADMIN_ONLY')

    // Resolve the customer's Synergy code — the ship-to composite key needs it, and
    // this validates the customer exists before we link a location to it.
    const { data: customer } = await admin
      .from('customers')
      .select('synergy_id')
      .eq('id', customerId)
      .maybeSingle()
    if (!customer?.synergy_id) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 422 })
    }
    const customerCode = String(customer.synergy_id).trim()

    // Insert-or-return-existing on the composite Synergy key.
    const { data: existing } = await admin
      .from('ship_to_locations')
      .select('*')
      .eq('synergy_customer_code', customerCode)
      .eq('synergy_shiplist_code', shiplistCode)
      .maybeSingle()
    if (existing) {
      return NextResponse.json({ ship_to: existing, existed: true }, { status: 200 })
    }

    const { data, error } = await admin
      .from('ship_to_locations')
      .insert({
        customer_id: customerId,
        synergy_customer_code: customerCode,
        synergy_shiplist_code: shiplistCode,
        name,
        address: body.address ? String(body.address).trim() : null,
        city: body.city ? String(body.city).trim() : null,
        state: body.state ? String(body.state).trim() : null,
        zip: body.zip ? String(body.zip).trim() : null,
        contact: body.contact ? String(body.contact).trim() : null,
        email: body.email ? String(body.email).trim() : null,
        provisional: true,
        provisional_created_by: user.id,
        provisional_created_at: new Date().toISOString(),
      })
      .select('*')
      .single()

    if (error) {
      if (error.code === '23505') {
        const { data: raced } = await admin
          .from('ship_to_locations')
          .select('*')
          .eq('synergy_customer_code', customerCode)
          .eq('synergy_shiplist_code', shiplistCode)
          .maybeSingle()
        if (raced) {
          return NextResponse.json({ ship_to: raced, existed: true }, { status: 200 })
        }
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ship_to: data, existed: false }, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
