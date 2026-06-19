import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser, RESET_ROLES } from '@/lib/auth'
import { normalizeSerial, serialsMatch, serialsNearMatch } from '@/lib/equipment'
import type { BillingType } from '@/types/database'

type Body = {
  customer_id?: number
  make?: string | null
  model?: string | null
  serial_number?: string | null
  description?: string | null
  location_on_site?: string | null
  interval_months: number
  anchor_month: number
  starting_year?: number
  billing_type: BillingType
  flat_rate?: number | null
  // Set true to proceed past a near-miss serial warning (the office confirmed
  // it really is a distinct unit). Exact-serial duplicates are never bypassable.
  confirm_near_duplicate?: boolean
  // When the customer already has this exact unit, the office can set up the PM
  // schedule on the existing record instead of hitting a dead-end error. Set to
  // the existing equipment id to skip the equipment insert and just add the
  // schedule + link the lead. Blocked if that unit already has an active schedule.
  use_existing_equipment_id?: string
}

// Same make AND model (case/whitespace-insensitive, both present) — the gate
// that keeps the near-miss serial warning high-precision.
function sameMakeModel(
  a: { make: string | null; model: string | null },
  b: { make: string | null; model: string | null }
): boolean {
  const norm = (s: string | null) => s?.trim().toLowerCase() ?? ''
  return (
    norm(a.make) !== '' &&
    norm(a.model) !== '' &&
    norm(a.make) === norm(b.make) &&
    norm(a.model) === norm(b.model)
  )
}

const VALID_BILLING_TYPES: BillingType[] = ['flat_rate', 'time_and_materials', 'contract']

// POST /api/tech-leads/[id]/create-equipment-from-lead
//
// Consolidates the previously-client-side 4-hop flow (link_customer → insert
// equipment → insert pm_schedule → link_equipment) into a single server-side
// sequence. If the schedule insert fails, we delete the orphan equipment
// before returning. Removes the direct browser-client Supabase inserts that
// previously made this flow vulnerable to RLS-only enforcement and orphan
// rows on partial failure.
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
    if (!RESET_ROLES.includes(user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = (await request.json()) as Body

    // Validate inputs
    if (!body.interval_months || body.interval_months < 1 || body.interval_months > 12) {
      return NextResponse.json({ error: 'interval_months must be 1–12.' }, { status: 400 })
    }
    if (!body.anchor_month || body.anchor_month < 1 || body.anchor_month > 12) {
      return NextResponse.json({ error: 'anchor_month must be 1–12.' }, { status: 400 })
    }
    // starting_year is optional — when omitted, the pm_schedules default
    // (current year) applies. Validate when supplied.
    if (
      body.starting_year !== undefined &&
      (!Number.isInteger(body.starting_year) || body.starting_year < 2000 || body.starting_year > 2100)
    ) {
      return NextResponse.json({ error: 'starting_year must be between 2000 and 2100.' }, { status: 400 })
    }
    if (!VALID_BILLING_TYPES.includes(body.billing_type)) {
      return NextResponse.json({ error: 'Invalid billing_type.' }, { status: 400 })
    }
    if (body.billing_type === 'flat_rate') {
      if (typeof body.flat_rate !== 'number' || !Number.isFinite(body.flat_rate) || body.flat_rate <= 0) {
        return NextResponse.json(
          { error: 'flat_rate must be a positive number for flat-rate billing.' },
          { status: 400 }
        )
      }
    }

    const supabase = await createClient()

    // Pull the lead and verify state
    const { data: lead, error: leadErr } = await supabase
      .from('tech_leads')
      .select('id, status, customer_id, customer_name_text, equipment_id, lead_type')
      .eq('id', id)
      .single()
    if (leadErr || !lead) {
      return NextResponse.json({ error: 'Lead not found.' }, { status: 404 })
    }
    if (lead.lead_type !== 'pm') {
      return NextResponse.json({ error: 'Only PM leads can have equipment created.' }, { status: 400 })
    }
    if (lead.status !== 'approved') {
      return NextResponse.json(
        { error: `Cannot create equipment for a lead in status '${lead.status}'.` },
        { status: 400 }
      )
    }
    if (lead.equipment_id) {
      return NextResponse.json({ error: 'Lead already has equipment linked.' }, { status: 400 })
    }

    // Step 1: link_customer if the lead was submitted as free-text
    let resolvedCustomerId = lead.customer_id
    if (!resolvedCustomerId) {
      if (typeof body.customer_id !== 'number' || body.customer_id <= 0) {
        return NextResponse.json(
          { error: 'A customer must be selected for this free-text lead.' },
          { status: 400 }
        )
      }
      const { error: linkErr } = await supabase
        .from('tech_leads')
        .update({ customer_id: body.customer_id, customer_name_text: null })
        .eq('id', id)
      if (linkErr) {
        console.error('link_customer error:', linkErr)
        return NextResponse.json({ error: 'Failed to link customer.' }, { status: 500 })
      }
      resolvedCustomerId = body.customer_id
    } else if (body.customer_id && body.customer_id !== resolvedCustomerId) {
      return NextResponse.json(
        { error: "Lead's customer cannot be changed at this step." },
        { status: 400 }
      )
    }

    // Resolve the equipment the PM schedule attaches to: either an existing unit
    // the office chose to reuse, or a freshly-inserted one. `createdNewEquipment`
    // gates the schedule-failure rollback so we never delete a pre-existing unit.
    let equipmentId: string
    let createdNewEquipment = false

    if (body.use_existing_equipment_id) {
      // "Use existing unit" path: the customer already has this machine. Set up
      // the PM schedule on it instead of erroring. Validate ownership + active,
      // and refuse if it's already on an active schedule (no duplicate schedules).
      const { data: existing, error: exErr } = await supabase
        .from('equipment')
        .select('id, customer_id, active')
        .eq('id', body.use_existing_equipment_id)
        .maybeSingle()
      if (exErr) {
        console.error('existing-equipment lookup error:', exErr)
        return NextResponse.json({ error: 'Failed to look up the existing unit.' }, { status: 500 })
      }
      if (!existing || existing.customer_id !== resolvedCustomerId || !existing.active) {
        return NextResponse.json(
          { error: 'That unit no longer matches this customer. Refresh and try again.' },
          { status: 400 }
        )
      }
      const { data: activeSched, error: schedLookupErr } = await supabase
        .from('pm_schedules')
        .select('id')
        .eq('equipment_id', existing.id)
        .eq('active', true)
        .limit(1)
      if (schedLookupErr) {
        console.error('existing-schedule lookup error:', schedLookupErr)
        return NextResponse.json({ error: 'Failed to check the existing PM schedule.' }, { status: 500 })
      }
      if (activeSched && activeSched.length > 0) {
        return NextResponse.json(
          {
            error: 'This unit already has an active PM schedule.',
            existing_id: existing.id,
            schedule_exists: true,
          },
          { status: 409 }
        )
      }
      equipmentId = existing.id
    } else {
      // Duplicate-equipment guard (this flow previously had NONE — feedback #18).
      // Exact serial dupes are surfaced (with whether the unit already has a
      // schedule) so the office can reuse the unit instead of hitting a dead end;
      // near-miss serials on the same make+model are a confirmable warning so a
      // typo'd re-entry doesn't silently spawn a second PM schedule.
      const newMake = body.make?.trim() || null
      const newModel = body.model?.trim() || null
      const normalizedSerial = normalizeSerial(body.serial_number)
      if (normalizedSerial) {
        const { data: candidates, error: dupErr } = await supabase
          .from('equipment')
          .select('id, make, model, serial_number')
          .eq('customer_id', resolvedCustomerId!)
          .eq('active', true)
        if (dupErr) {
          console.error('dup-check query error:', dupErr)
          return NextResponse.json({ error: 'Failed to check for duplicate equipment.' }, { status: 500 })
        }

        const exact = (candidates ?? []).find((row) => serialsMatch(row.serial_number, normalizedSerial))
        if (exact) {
          const { data: exSched } = await supabase
            .from('pm_schedules')
            .select('id')
            .eq('equipment_id', exact.id)
            .eq('active', true)
            .limit(1)
          return NextResponse.json(
            {
              error: 'This customer already has active equipment with that serial number.',
              exact_duplicate: true,
              existing_id: exact.id,
              existing_make: exact.make,
              existing_model: exact.model,
              existing_serial: exact.serial_number,
              has_active_schedule: !!(exSched && exSched.length > 0),
            },
            { status: 409 }
          )
        }

        if (!body.confirm_near_duplicate) {
          const near = (candidates ?? []).find(
            (row) =>
              sameMakeModel({ make: newMake, model: newModel }, row) &&
              serialsNearMatch(row.serial_number, normalizedSerial)
          )
          if (near) {
            return NextResponse.json(
              {
                error: 'A very similar unit already exists for this customer — check the serial number.',
                near_duplicate: true,
                existing_id: near.id,
                existing_make: near.make,
                existing_model: near.model,
                existing_serial: near.serial_number,
              },
              { status: 409 }
            )
          }
        }
      }

      // Step 2: insert equipment
      const { data: equipmentRow, error: eqErr } = await supabase
        .from('equipment')
        .insert({
          customer_id: resolvedCustomerId!,
          make: newMake,
          model: newModel,
          serial_number: normalizedSerial,
          description: body.description?.trim() || null,
          location_on_site: body.location_on_site?.trim() || null,
          active: true,
        })
        .select('id')
        .single()
      if (eqErr || !equipmentRow) {
        console.error('equipment insert error:', eqErr)
        return NextResponse.json({ error: 'Failed to create equipment.' }, { status: 500 })
      }
      equipmentId = equipmentRow.id
      createdNewEquipment = true
    }

    // Step 3: insert pm_schedule. On failure, roll back a NEWLY-created
    // equipment row (never an existing unit the office chose to reuse).
    const { error: schedErr } = await supabase
      .from('pm_schedules')
      .insert({
        equipment_id: equipmentId,
        interval_months: body.interval_months,
        anchor_month: body.anchor_month,
        ...(body.starting_year !== undefined ? { starting_year: body.starting_year } : {}),
        billing_type: body.billing_type,
        flat_rate: body.billing_type === 'flat_rate' ? body.flat_rate ?? null : null,
        active: true,
      })
    if (schedErr) {
      console.error('schedule insert error:', schedErr)
      if (createdNewEquipment) {
        await supabase.from('equipment').delete().eq('id', equipmentId).then(() => {}, (e) =>
          console.error('rollback equipment delete failed:', e)
        )
      }
      return NextResponse.json({ error: 'Failed to create PM schedule.' }, { status: 500 })
    }

    // Step 4: link equipment back to the lead
    const { error: linkEqErr } = await supabase
      .from('tech_leads')
      .update({ equipment_id: equipmentId })
      .eq('id', id)
      .eq('status', 'approved')
      .is('equipment_id', null)
    if (linkEqErr) {
      console.error('link_equipment error:', linkEqErr)
      // Schedule exists; only the lead pointer is missing. Return a 500 with a
      // useful message — the office can re-link from the UI without re-creating.
      return NextResponse.json(
        { error: 'Schedule created but link to lead failed. Try the Link Equipment action.' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, equipment_id: equipmentId })
  } catch (err) {
    console.error('create-equipment-from-lead POST error:', err)
    return NextResponse.json({ error: 'Failed to create equipment from lead.' }, { status: 500 })
  }
}
