import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser, MANAGER_ROLES, RESET_ROLES } from '@/lib/auth'
import type { DefaultProduct } from '@/types/database'
import { findStrandedTickets, type StrandedTicket } from '@/lib/db/repoint-billto'

const STAFF_FIELDS = new Set([
  'customer_id',
  'make',
  'model',
  'serial_number',
  'description',
  'location_on_site',
  'blanket_po_number',
  'contact_name',
  'contact_email',
  'contact_phone',
  'ship_to_location_id',
  'default_technician_id',
  'default_products',
  'active',
])

const TECH_FIELDS = new Set(['contact_name', 'contact_email', 'contact_phone'])

const FIELD_MAX_LEN: Record<string, number> = {
  make: 200,
  model: 200,
  serial_number: 200,
  description: 1000,
  location_on_site: 500,
  blanket_po_number: 100,
  contact_name: 200,
  contact_email: 320,
  contact_phone: 50,
}

// PATCH /api/equipment/[id]
//
// Mediates equipment writes so non-tech users go through a server-side allowlist
// instead of a direct browser supabase.from('equipment').update() call. The DB
// also has a BEFORE UPDATE trigger (migration 048) restricting techs to contact
// fields, but routing all writes through this API is the cleaner long-term path.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
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

    const allowed = isStaff ? STAFF_FIELDS : TECH_FIELDS
    const body = (await request.json()) as Record<string, unknown>

    const update: Record<string, unknown> = {}
    for (const [key, raw] of Object.entries(body)) {
      if (!allowed.has(key)) continue
      if (raw === undefined) continue
      // Trim + cap free-text fields.
      if (typeof raw === 'string' && key in FIELD_MAX_LEN) {
        update[key] = raw.trim().slice(0, FIELD_MAX_LEN[key]) || null
      } else {
        update[key] = raw
      }
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'No recognized fields in request body' }, { status: 400 })
    }

    const supabase = await createClient()

    // When a manager reassigns the bill-to account (customer_id) and/or the
    // ship-to, validate both against the *resulting* customer. We fetch the
    // equipment's current customer once so ship-to validation can fall back to
    // it when only the ship-to is changing.
    // Reassigning the bill-to account is a manager/super-admin action only —
    // coordinators may edit every other equipment field but not the billing
    // account. (The UI hides the control for them; this is the server backstop.)
    if (update.customer_id !== undefined && !RESET_ROLES.includes(user.role)) {
      return NextResponse.json(
        { error: 'Only managers can change the bill-to account.' },
        { status: 403 }
      )
    }

    const touchingCustomer = isStaff && update.customer_id !== undefined
    const touchingShipTo = isStaff && update.ship_to_location_id !== undefined
    let currentCustomerId: number | null | undefined
    if (touchingCustomer || touchingShipTo) {
      const { data: equip } = await supabase
        .from('equipment')
        .select('customer_id')
        .eq('id', id)
        .maybeSingle()
      if (!equip) {
        return NextResponse.json({ error: 'Equipment not found.' }, { status: 404 })
      }
      currentCustomerId = equip.customer_id
    }

    // Validate a bill-to (customer) reassignment: must reference an existing,
    // active customer. Equipment always belongs to exactly one account.
    if (touchingCustomer) {
      const cid = update.customer_id
      if (typeof cid !== 'number' || !Number.isInteger(cid) || cid <= 0) {
        return NextResponse.json({ error: 'A valid bill-to account is required.' }, { status: 400 })
      }
      const { data: cust } = await supabase
        .from('customers')
        .select('id, active')
        .eq('id', cid)
        .maybeSingle()
      if (!cust || cust.active === false) {
        return NextResponse.json(
          { error: 'Selected bill-to account was not found or is inactive.' },
          { status: 422 }
        )
      }
    }

    const effectiveCustomerId = touchingCustomer
      ? (update.customer_id as number)
      : currentCustomerId

    // Ship-to must belong to the effective (post-reassignment) customer.
    // (Cross-customer ship-to assignment was the EQ-7 finding.)
    if (isStaff && update.ship_to_location_id !== undefined && update.ship_to_location_id !== null) {
      const { data: shipTo } = await supabase
        .from('ship_to_locations')
        .select('customer_id')
        .eq('id', update.ship_to_location_id as number)
        .maybeSingle()
      if (!shipTo || shipTo.customer_id !== effectiveCustomerId) {
        return NextResponse.json(
          { error: "Ship-to location does not belong to this equipment's bill-to account." },
          { status: 422 }
        )
      }
    }

    // Reassigning the bill-to account orphans the old ship-to (it belongs to the
    // previous customer). If the caller didn't supply a ship-to that's valid for
    // the new account, clear it rather than leave a dangling cross-customer link.
    if (
      touchingCustomer &&
      update.customer_id !== currentCustomerId &&
      (update.ship_to_location_id === undefined || update.ship_to_location_id === null)
    ) {
      update.ship_to_location_id = null
    }

    // Validate default_products payload if present.
    if (update.default_products !== undefined) {
      if (!isStaff) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      if (!Array.isArray(update.default_products)) {
        return NextResponse.json({ error: 'default_products must be an array.' }, { status: 400 })
      }
      const items = update.default_products as DefaultProduct[]
      for (const it of items) {
        const qty = Number(it.quantity)
        if (!Number.isFinite(qty) || qty <= 0) {
          return NextResponse.json(
            { error: 'Each default product must have a positive integer quantity.' },
            { status: 400 }
          )
        }
        if (it.synergy_product_id == null) {
          return NextResponse.json(
            { error: 'Each default product must reference a Synergy item.' },
            { status: 400 }
          )
        }
      }
    }

    const { data, error } = await supabase
      .from('equipment')
      .update(update)
      .eq('id', id)
      .select('id')
      .maybeSingle()

    if (error) {
      // 23505 = unique violation on (customer_id, LOWER(BTRIM(serial_number))).
      if ((error as { code?: string }).code === '23505') {
        return NextResponse.json(
          { error: 'This customer already has active equipment with that serial number.' },
          { status: 409 }
        )
      }
      // P0001 = explicit raise from the BEFORE UPDATE trigger (tech tried to
      // touch a non-contact field).
      if ((error as { code?: string }).code === 'P0001') {
        return NextResponse.json({ error: error.message }, { status: 403 })
      }
      console.error('equipment PATCH error:', error)
      return NextResponse.json({ error: 'Failed to update equipment.' }, { status: 500 })
    }
    if (!data) {
      return NextResponse.json({ error: 'Equipment not found.' }, { status: 404 })
    }

    // After a bill-to reassignment, surface still-open tickets on this equipment
    // that are stranded on the OLD account so the manager can opt to repoint them
    // too. Excludes anything already keyed in Synergy (hard guard). The bulk
    // repoint itself is a separate, explicit call to /propagate-billto — this only
    // reports the candidates.
    let propagation:
      | {
          oldCustomerId: number
          newCustomerId: number
          serviceTickets: StrandedTicket[]
          pmTickets: StrandedTicket[]
        }
      | undefined
    if (
      touchingCustomer &&
      currentCustomerId != null &&
      update.customer_id !== currentCustomerId
    ) {
      const newCustomerId = update.customer_id as number
      const { serviceTickets, pmTickets } = await findStrandedTickets(supabase, {
        equipmentId: id,
        targetCustomerId: newCustomerId,
      })
      if (serviceTickets.length > 0 || pmTickets.length > 0) {
        propagation = {
          oldCustomerId: currentCustomerId,
          newCustomerId,
          serviceTickets,
          pmTickets,
        }
      }
    }

    return NextResponse.json({ success: true, id: data.id, ...(propagation ? { propagation } : {}) })
  } catch (err) {
    console.error('equipment PATCH unexpected error:', err)
    return NextResponse.json({ error: 'Failed to update equipment.' }, { status: 500 })
  }
}
