import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser, RESET_ROLES } from '@/lib/auth'
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

    // Step 2: insert equipment
    const { data: equipmentRow, error: eqErr } = await supabase
      .from('equipment')
      .insert({
        customer_id: resolvedCustomerId!,
        make: body.make?.trim() || null,
        model: body.model?.trim() || null,
        serial_number: body.serial_number?.trim() || null,
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

    // Step 3: insert pm_schedule. On failure, roll back the equipment insert.
    const { error: schedErr } = await supabase
      .from('pm_schedules')
      .insert({
        equipment_id: equipmentRow.id,
        interval_months: body.interval_months,
        anchor_month: body.anchor_month,
        ...(body.starting_year !== undefined ? { starting_year: body.starting_year } : {}),
        billing_type: body.billing_type,
        flat_rate: body.billing_type === 'flat_rate' ? body.flat_rate ?? null : null,
        active: true,
      })
    if (schedErr) {
      console.error('schedule insert error — rolling back equipment:', schedErr)
      await supabase.from('equipment').delete().eq('id', equipmentRow.id).then(() => {}, (e) =>
        console.error('rollback equipment delete failed:', e)
      )
      return NextResponse.json({ error: 'Failed to create PM schedule.' }, { status: 500 })
    }

    // Step 4: link equipment back to the lead
    const { error: linkEqErr } = await supabase
      .from('tech_leads')
      .update({ equipment_id: equipmentRow.id })
      .eq('id', id)
      .eq('status', 'approved')
      .is('equipment_id', null)
    if (linkEqErr) {
      console.error('link_equipment error:', linkEqErr)
      // Equipment + schedule exist; only the lead pointer is missing. Return a
      // 500 with a useful message — the office can re-link from the UI without
      // re-creating the equipment.
      return NextResponse.json(
        { error: 'Equipment created but link to lead failed. Try the Link Equipment action.' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, equipment_id: equipmentRow.id })
  } catch (err) {
    console.error('create-equipment-from-lead POST error:', err)
    return NextResponse.json({ error: 'Failed to create equipment from lead.' }, { status: 500 })
  }
}
