import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, MANAGER_ROLES } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeSerial, serialsMatch } from '@/lib/equipment'

const MAX_SHORT = 200
const MAX_LONG = 1000
const MAX_EMAIL = 320

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user?.role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!MANAGER_ROLES.includes(user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = (await request.json()) as Record<string, unknown>

    const customerIdNum = typeof body.customer_id === 'number'
      ? body.customer_id
      : typeof body.customer_id === 'string'
        ? parseInt(body.customer_id, 10)
        : NaN
    if (!Number.isFinite(customerIdNum) || customerIdNum <= 0) {
      return NextResponse.json({ error: 'customer_id is required.' }, { status: 400 })
    }

    // Helper: trim string fields and enforce max length
    const str = (key: string, maxLen: number = MAX_SHORT) => {
      const v = body[key]
      if (typeof v !== 'string' || !v.trim()) return null
      const trimmed = v.trim()
      if (trimmed.length > maxLen) {
        return trimmed.slice(0, maxLen)
      }
      return trimmed
    }
    const intOrNull = (key: string) => {
      const v = body[key]
      if (v === null || v === undefined) return null
      const n = typeof v === 'number' ? v : parseInt(String(v), 10)
      return Number.isFinite(n) ? n : null
    }

    const serialRaw = typeof body.serial_number === 'string' ? body.serial_number : null
    const normalizedSerial = normalizeSerial(serialRaw)
    const shipToIdNum = intOrNull('ship_to_location_id')

    const supabase = createAdminClient()

    // Validate ship_to_location belongs to the same customer (prevents cross-customer location tagging)
    if (shipToIdNum !== null) {
      const { data: shipTo } = await supabase
        .from('ship_to_locations')
        .select('customer_id')
        .eq('id', shipToIdNum)
        .maybeSingle()
      if (!shipTo || shipTo.customer_id !== customerIdNum) {
        return NextResponse.json(
          { error: 'Ship-to location does not belong to this customer.' },
          { status: 422 }
        )
      }
    }

    // Serial uniqueness check (same logic as AddEquipmentModal)
    if (normalizedSerial) {
      const { data: candidates } = await supabase
        .from('equipment')
        .select('id, make, model, serial_number')
        .eq('customer_id', customerIdNum)
        .eq('active', true)
        .ilike('serial_number', `%${normalizedSerial}%`)

      const match = (candidates ?? []).find((row) =>
        serialsMatch(row.serial_number, normalizedSerial)
      )
      if (match) {
        return NextResponse.json(
          {
            error: 'This customer already has active equipment with that serial number.',
            existing_id: match.id,
          },
          { status: 409 }
        )
      }
    }

    const { data: equipment, error: insertError } = await supabase
      .from('equipment')
      .insert({
        customer_id: customerIdNum,
        ship_to_location_id: shipToIdNum,
        make: str('make'),
        model: str('model'),
        serial_number: normalizedSerial,
        description: str('description', MAX_LONG),
        location_on_site: str('location_on_site'),
        contact_name: str('contact_name'),
        contact_email: str('contact_email', MAX_EMAIL),
        contact_phone: str('contact_phone', 50),
        active: true,
      })
      .select()
      .single()

    if (insertError) {
      if (insertError.code === '23505') {
        return NextResponse.json(
          { error: 'This customer already has active equipment with that serial number.' },
          { status: 409 }
        )
      }
      if (insertError.code === '23503') {
        return NextResponse.json({ error: 'Customer not found.' }, { status: 422 })
      }
      console.error('equipment POST insert error:', insertError)
      return NextResponse.json({ error: 'Failed to create equipment.' }, { status: 500 })
    }

    return NextResponse.json(equipment, { status: 201 })
  } catch (err) {
    console.error('equipment POST error:', err)
    return NextResponse.json({ error: 'Failed to create equipment.' }, { status: 500 })
  }
}
