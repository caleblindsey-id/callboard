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

// Free-text caps applied server-side. Mirrors the soft-cap a future migration
// can add as DB CHECK constraints.
const EQUIPMENT_DESCRIPTION_MAX = 500
const NOTES_MAX = 1000
const CUSTOMER_NAME_MAX = 200
const CONTACT_NAME_MAX = 200
const CONTACT_EMAIL_MAX = 320
const CONTACT_PHONE_MAX = 40
// Structured equipment fields (migration 073). Mirror DB CHECKs.
const EQUIPMENT_FIELD_MAX = 200
const PROPOSED_START_YEAR_MIN = 2000
const PROPOSED_START_YEAR_MAX = 2100

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type CreateBody = {
  lead_type?: TechLeadType
  customer_id?: number | null
  customer_name_text?: string | null
  // PM branch — structured equipment (migration 073).
  make?: string | null
  model?: string | null
  serial_number?: string | null
  location_on_site?: string | null
  proposed_start_month?: number | null
  proposed_start_year?: number | null
  // Legacy free-text description. Optional now — server composes from
  // structured fields when not supplied so the DB NOT NULL stays satisfied.
  equipment_description?: string
  proposed_pm_frequency?: TechLeadFrequency | null
  // Equipment-sale branch
  proposed_equipment_tier?: EquipmentSaleTier | null
  // Shared
  notes?: string | null
  contact_name?: string | null
  contact_email?: string | null
  contact_phone?: string | null
}

// Compose the legacy `equipment_description` blob from the structured fields
// so downstream consumers (rep email, /my-leads sub-line) keep rendering.
function composeEquipmentDescription(parts: {
  make: string
  model: string
  serial: string
  location: string | null
}): string {
  const segments = [
    `Make: ${parts.make}`,
    `Model: ${parts.model}`,
    `Serial: ${parts.serial}`,
  ]
  if (parts.location) segments.push(`Location: ${parts.location}`)
  return segments.join(' | ').slice(0, EQUIPMENT_DESCRIPTION_MAX)
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

    const contactName = body.contact_name?.trim() ?? ''
    const contactEmail = body.contact_email?.trim() ?? ''
    const contactPhone = body.contact_phone?.trim() ?? ''
    if (!contactName) {
      return NextResponse.json({ error: 'Lead contact name is required.' }, { status: 400 })
    }
    if (!contactEmail && !contactPhone) {
      return NextResponse.json(
        { error: 'Provide a contact email or phone — at least one.' },
        { status: 400 }
      )
    }
    if (contactEmail && !EMAIL_SHAPE.test(contactEmail)) {
      return NextResponse.json({ error: 'Contact email looks invalid.' }, { status: 400 })
    }
    if (contactPhone) {
      const digitCount = contactPhone.replace(/\D+/g, '').length
      if (digitCount < 7) {
        return NextResponse.json({ error: 'Contact phone looks invalid.' }, { status: 400 })
      }
    }

    const insert: TechLeadInsert = {
      submitted_by: user.id,
      lead_type: leadType,
      customer_id: hasExisting ? body.customer_id! : null,
      customer_name_text: hasFreeText ? body.customer_name_text!.trim().slice(0, CUSTOMER_NAME_MAX) : null,
      notes: body.notes?.trim().slice(0, NOTES_MAX) || null,
      contact_name: contactName.slice(0, CONTACT_NAME_MAX),
      contact_email: contactEmail ? contactEmail.slice(0, CONTACT_EMAIL_MAX) : null,
      contact_phone: contactPhone ? contactPhone.slice(0, CONTACT_PHONE_MAX) : null,
      equipment_description: '', // set per branch below
    }

    if (leadType === 'pm') {
      const make = body.make?.trim() ?? ''
      const model = body.model?.trim() ?? ''
      const serial = body.serial_number?.trim() ?? ''
      const location = body.location_on_site?.trim() ?? ''
      if (!make) {
        return NextResponse.json({ error: 'Equipment make is required.' }, { status: 400 })
      }
      if (!model) {
        return NextResponse.json({ error: 'Equipment model is required.' }, { status: 400 })
      }
      if (!serial) {
        return NextResponse.json({ error: 'Equipment serial number is required.' }, { status: 400 })
      }
      const startMonth = body.proposed_start_month
      const startYear = body.proposed_start_year
      if (!Number.isInteger(startMonth) || startMonth! < 1 || startMonth! > 12) {
        return NextResponse.json(
          { error: 'Proposed start month must be between 1 and 12.' },
          { status: 400 }
        )
      }
      if (
        !Number.isInteger(startYear) ||
        startYear! < PROPOSED_START_YEAR_MIN ||
        startYear! > PROPOSED_START_YEAR_MAX
      ) {
        return NextResponse.json(
          { error: `Proposed start year must be between ${PROPOSED_START_YEAR_MIN} and ${PROPOSED_START_YEAR_MAX}.` },
          { status: 400 }
        )
      }
      if (body.proposed_pm_frequency && !VALID_FREQUENCIES.includes(body.proposed_pm_frequency)) {
        return NextResponse.json(
          { error: 'Invalid proposed_pm_frequency.' },
          { status: 400 }
        )
      }
      insert.make = make.slice(0, EQUIPMENT_FIELD_MAX)
      insert.model = model.slice(0, EQUIPMENT_FIELD_MAX)
      insert.serial_number = serial.slice(0, EQUIPMENT_FIELD_MAX)
      insert.location_on_site = location ? location.slice(0, EQUIPMENT_FIELD_MAX) : null
      insert.proposed_start_month = startMonth!
      insert.proposed_start_year = startYear!
      insert.equipment_description = composeEquipmentDescription({
        make: insert.make!,
        model: insert.model!,
        serial: insert.serial_number!,
        location: insert.location_on_site,
      })
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
