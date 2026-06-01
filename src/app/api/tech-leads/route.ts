import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser, MANAGER_ROLES } from '@/lib/auth'
import type { TechLeadInsert } from '@/types/database'
import { EQUIPMENT_SALE_WINDOW_DAYS } from '@/lib/tech-leads/bonus-tiers'
import { validateLeadFields, type LeadFieldsInput } from '@/lib/tech-leads/validate-lead'

// POST /api/tech-leads — tech submits a lead. Office users (super_admin/manager)
// can also submit on behalf of a tech, but the normal flow is the tech filing
// from /my-leads. Techs submit as themselves (submitted_by = auth.uid()).
//
// Field validation/normalization is shared with the edit path (PATCH
// /api/tech-leads/[id]) via validateLeadFields — keep both in sync there.
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

    const body = (await request.json()) as LeadFieldsInput
    const validated = validateLeadFields(body)
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: validated.status })
    }
    const f = validated.fields

    const insert: TechLeadInsert = {
      submitted_by: user.id,
      lead_type: f.lead_type,
      customer_id: f.customer_id,
      customer_name_text: f.customer_name_text,
      notes: f.notes,
      contact_name: f.contact_name,
      contact_email: f.contact_email,
      contact_phone: f.contact_phone,
      equipment_description: f.equipment_description,
      make: f.make,
      model: f.model,
      serial_number: f.serial_number,
      location_on_site: f.location_on_site,
      proposed_start_month: f.proposed_start_month,
      proposed_start_year: f.proposed_start_year,
      proposed_pm_frequency: f.proposed_pm_frequency,
      proposed_equipment_tier: f.proposed_equipment_tier,
    }

    if (f.lead_type === 'equipment_sale') {
      // 90-day window — sweep in the nightly scan flips stale rows to expired.
      const expires = new Date()
      expires.setUTCDate(expires.getUTCDate() + EQUIPMENT_SALE_WINDOW_DAYS)
      insert.expires_at = expires.toISOString()
    }

    const supabase = await createClient()
    const { data, error } = await supabase
      .from('tech_leads')
      .insert(insert)
      .select('id')
      .single()
    if (error) {
      console.error('tech-leads create error:', error)
      return NextResponse.json({ error: 'Failed to submit lead.' }, { status: 500 })
    }

    return NextResponse.json({ success: true, id: data.id })
  } catch (err) {
    console.error('tech-leads POST error:', err)
    return NextResponse.json({ error: 'Failed to submit lead.' }, { status: 500 })
  }
}
