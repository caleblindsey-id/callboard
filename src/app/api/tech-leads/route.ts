import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser, MANAGER_ROLES } from '@/lib/auth'
import type {
  TechLeadFrequency,
  TechLeadInsert,
  TechLeadType,
  EquipmentSaleTier,
} from '@/types/database'
import { EQUIPMENT_SALE_TIERS, EQUIPMENT_SALE_WINDOW_DAYS, tierLabel } from '@/lib/tech-leads/bonus-tiers'

const VALID_FREQUENCIES: TechLeadFrequency[] = [
  'monthly',
  'bi-monthly',
  'quarterly',
  'semi-annual',
  'annual',
]

const VALID_TIERS: EquipmentSaleTier[] = Object.keys(EQUIPMENT_SALE_TIERS) as EquipmentSaleTier[]

type CreateBody = {
  lead_type?: TechLeadType
  customer_id?: number | null
  customer_name_text?: string | null
  // PM branch
  equipment_description?: string
  proposed_pm_frequency?: TechLeadFrequency | null
  // Equipment-sale branch
  proposed_equipment_tier?: EquipmentSaleTier | null
  // Shared
  notes?: string | null
}

// POST /api/tech-leads — tech submits a lead. Office users (super_admin/manager)
// can also submit on behalf of a tech, but the normal flow is the tech filing
// from /my-leads. Techs submit as themselves (submitted_by = auth.uid()).
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
    const leadType: TechLeadType = body.lead_type ?? 'pm'
    if (leadType !== 'pm' && leadType !== 'equipment_sale') {
      return NextResponse.json({ error: 'Invalid lead_type.' }, { status: 400 })
    }

    const hasExisting = typeof body.customer_id === 'number' && body.customer_id > 0
    const hasFreeText = !!body.customer_name_text?.trim()
    if (hasExisting === hasFreeText) {
      return NextResponse.json(
        { error: 'Provide either an existing customer or a new customer name — not both, not neither.' },
        { status: 400 }
      )
    }

    const insert: TechLeadInsert = {
      submitted_by: user.id,
      lead_type: leadType,
      customer_id: hasExisting ? body.customer_id! : null,
      customer_name_text: hasFreeText ? body.customer_name_text!.trim() : null,
      notes: body.notes?.trim() || null,
      equipment_description: '', // set per branch below
    }

    if (leadType === 'pm') {
      if (!body.equipment_description?.trim()) {
        return NextResponse.json(
          { error: 'Equipment description is required.' },
          { status: 400 }
        )
      }
      if (body.proposed_pm_frequency && !VALID_FREQUENCIES.includes(body.proposed_pm_frequency)) {
        return NextResponse.json(
          { error: 'Invalid proposed_pm_frequency.' },
          { status: 400 }
        )
      }
      insert.equipment_description = body.equipment_description.trim()
      insert.proposed_pm_frequency = body.proposed_pm_frequency ?? null
    } else {
      // equipment_sale
      if (!body.proposed_equipment_tier || !VALID_TIERS.includes(body.proposed_equipment_tier)) {
        return NextResponse.json(
          { error: 'A valid equipment tier is required.' },
          { status: 400 }
        )
      }
      insert.proposed_equipment_tier = body.proposed_equipment_tier
      // equipment_description is NOT NULL in the table; mirror the tier label plus
      // any tech notes for legacy queries that still read the column.
      insert.equipment_description = tierLabel(body.proposed_equipment_tier)
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
