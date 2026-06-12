import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, MANAGER_ROLES } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeSerial, serialsMatch } from '@/lib/equipment'

const MAX_SHORT = 200

// POST /api/equipment/[id]/verify
//
// A technician (or staff) confirms a unit's identifying details against the
// physical equipment during ticket completion. Writes make/model/serial and
// stamps details_verified_at/by so completion stops prompting for this unit.
//
// Runs under the service-role admin client: the migration-048 tech-field-lock
// trigger gates on get_user_role() = 'technician', and under the admin client
// auth.uid() is NULL so that branch is skipped. Direct browser writes by techs
// are still blocked by the trigger — this endpoint is the only tech path to
// make/model/serial, and it requires the verify affirmation.
export async function POST(
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

    const body = (await request.json()) as Record<string, unknown>

    const str = (key: string) => {
      const v = body[key]
      if (typeof v !== 'string' || !v.trim()) return null
      return v.trim().slice(0, MAX_SHORT)
    }

    const make = str('make')
    const model = str('model')
    // Serial is optional: a worn/missing plate is a legitimate "no serial" case.
    // normalizeSerial maps blank -> null; we never store a sentinel like "N/A"
    // (it would collide on the (customer_id, serial) unique index for unit #2).
    const serial = normalizeSerial(typeof body.serial_number === 'string' ? body.serial_number : null)

    // Optional relink: when a tech hits the serial-conflict on another unit and
    // chooses "use the existing unit", the panel re-posts this verify to the
    // EXISTING unit's id and asks us to point the ticket at it too. Doing the
    // relink here keeps the privileged write server-side under the same
    // service-role client — no need to widen tech-writable fields on the ticket
    // PATCH routes (which don't allow equipment_id for techs).
    const relinkTicketId = str('relink_ticket_id')
    const relinkTicketKind =
      body.relink_ticket_kind === 'service' || body.relink_ticket_kind === 'pm'
        ? body.relink_ticket_kind
        : null

    if (!make || !model) {
      return NextResponse.json(
        { error: 'Make and model are required to verify equipment.' },
        { status: 400 }
      )
    }

    // SERVER_ONLY (not ADMIN_ONLY): this endpoint is intentionally reachable by
    // technicians, who are NOT managers — ADMIN_ONLY would throw the manager-role
    // check above. We authorized the caller (tech or staff) ourselves. The
    // service-role client carries no user JWT, so auth.uid() is NULL and the
    // migration-048 tech-field-lock trigger's 'technician' branch is skipped,
    // letting the make/model/serial write through.
    const supabase = await createAdminClient('SERVER_ONLY')

    // Load the equipment so we can scope the serial-uniqueness check to its
    // customer and exclude itself (an unchanged serial must not self-conflict).
    const { data: equip, error: equipErr } = await supabase
      .from('equipment')
      .select('id, customer_id')
      .eq('id', id)
      .maybeSingle()
    if (equipErr) {
      console.error('equipment verify lookup error:', equipErr)
      return NextResponse.json({ error: 'Failed to load equipment.' }, { status: 500 })
    }
    if (!equip) {
      return NextResponse.json({ error: 'Equipment not found.' }, { status: 404 })
    }

    // Serial uniqueness per customer (mirrors POST /api/equipment), excluding self.
    if (serial && equip.customer_id != null) {
      const { data: candidates } = await supabase
        .from('equipment')
        .select('id, serial_number')
        .eq('customer_id', equip.customer_id)
        .eq('active', true)
        .neq('id', id)
        .ilike('serial_number', `%${serial}%`)

      const match = (candidates ?? []).find((row) => serialsMatch(row.serial_number, serial))
      if (match) {
        return NextResponse.json(
          {
            error: 'Another active unit for this customer already has that serial number.',
            existing_id: match.id,
          },
          { status: 409 }
        )
      }
    }

    const { data, error } = await supabase
      .from('equipment')
      .update({
        make,
        model,
        serial_number: serial,
        details_verified_at: new Date().toISOString(),
        details_verified_by: user.id,
      })
      .eq('id', id)
      .select('id')
      .maybeSingle()

    if (error) {
      // 23505 = unique violation on (customer_id, LOWER(BTRIM(serial_number))).
      if ((error as { code?: string }).code === '23505') {
        return NextResponse.json(
          { error: 'Another active unit for this customer already has that serial number.' },
          { status: 409 }
        )
      }
      // P0001 = the migration-048 tech-field-lock trigger fired. Should never
      // happen on this path (service-role client → NULL auth.uid()); if it does,
      // surface a real message instead of a mystery 500.
      if ((error as { code?: string }).code === 'P0001') {
        return NextResponse.json(
          { error: 'Equipment write was blocked by a permission rule. Please contact the office.' },
          { status: 403 }
        )
      }
      console.error('equipment verify update error:', error)
      return NextResponse.json({ error: 'Failed to verify equipment.' }, { status: 500 })
    }
    if (!data) {
      return NextResponse.json({ error: 'Equipment not found.' }, { status: 404 })
    }

    // Relink the ticket to this (now-verified) unit when requested. `id` here is
    // the existing unit the tech chose, so the ticket ends up pointed at the
    // on-file machine instead of the duplicate that was linked before.
    if (relinkTicketId && relinkTicketKind) {
      if (relinkTicketKind === 'service') {
        // Same-customer guard (defensive — existing_id was already found via a
        // customer-scoped query, so a mismatch shouldn't be reachable via UI).
        const { data: st } = await supabase
          .from('service_tickets')
          .select('customer_id')
          .eq('id', relinkTicketId)
          .maybeSingle()
        if (!st) {
          return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 })
        }
        if (equip.customer_id != null && st.customer_id !== equip.customer_id) {
          return NextResponse.json(
            { error: 'That unit belongs to a different customer than this ticket.' },
            { status: 422 }
          )
        }
        const { error: relinkErr } = await supabase
          .from('service_tickets')
          .update({
            equipment_id: id,
            equipment_make: null,
            equipment_model: null,
            equipment_serial_number: null,
          })
          .eq('id', relinkTicketId)
        if (relinkErr) {
          console.error('equipment verify relink (service) error:', relinkErr)
          return NextResponse.json({ error: 'Failed to switch the ticket to the existing unit.' }, { status: 500 })
        }
      } else {
        // PM ticket: no inline equipment columns — just repoint equipment_id.
        // Derive the customer for the guard via the ticket's current unit.
        const { data: pt } = await supabase
          .from('pm_tickets')
          .select('equipment_id')
          .eq('id', relinkTicketId)
          .maybeSingle()
        if (!pt) {
          return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 })
        }
        if (pt.equipment_id && equip.customer_id != null) {
          const { data: curEq } = await supabase
            .from('equipment')
            .select('customer_id')
            .eq('id', pt.equipment_id)
            .maybeSingle()
          if (curEq && curEq.customer_id !== equip.customer_id) {
            return NextResponse.json(
              { error: 'That unit belongs to a different customer than this ticket.' },
              { status: 422 }
            )
          }
        }
        const { error: relinkErr } = await supabase
          .from('pm_tickets')
          .update({ equipment_id: id })
          .eq('id', relinkTicketId)
        if (relinkErr) {
          console.error('equipment verify relink (pm) error:', relinkErr)
          return NextResponse.json({ error: 'Failed to switch the ticket to the existing unit.' }, { status: 500 })
        }
      }
    }

    return NextResponse.json({ success: true, id: data.id })
  } catch (err) {
    console.error('equipment verify unexpected error:', err)
    return NextResponse.json({ error: 'Failed to verify equipment.' }, { status: 500 })
  }
}
