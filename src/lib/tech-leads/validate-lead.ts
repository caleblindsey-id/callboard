import type {
  TechLeadFrequency,
  TechLeadType,
  EquipmentSaleTier,
  FirstPmCompletion,
  PartUsed,
} from '@/types/database'
import { EQUIPMENT_SALE_TIERS, tierLabel } from './bonus-tiers'

// Shared validation + normalization for tech-lead create (POST /api/tech-leads)
// and edit (PATCH /api/tech-leads/[id]). Pure — no DB, no Date/now — so it can
// be unit-tested and so the edit path can preserve fields the create path
// derives at insert time (e.g. expires_at, which the caller sets separately).

const VALID_FREQUENCIES: TechLeadFrequency[] = [
  'monthly',
  'bi-monthly',
  'quarterly',
  'semi-annual',
  'annual',
]

const VALID_TIERS: EquipmentSaleTier[] = Object.keys(EQUIPMENT_SALE_TIERS) as EquipmentSaleTier[]

// Free-text caps applied server-side. Mirror the soft-caps a future migration
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
const QUOTED_AMOUNT_MAX = 100

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type LeadFieldsInput = {
  lead_type?: TechLeadType | string | null
  customer_id?: number | null
  customer_name_text?: string | null
  make?: string | null
  model?: string | null
  serial_number?: string | null
  location_on_site?: string | null
  proposed_start_month?: number | null
  proposed_start_year?: number | null
  proposed_pm_frequency?: TechLeadFrequency | string | null
  proposed_equipment_tier?: EquipmentSaleTier | string | null
  quoted_amount?: string | null
  first_pm_performed?: boolean | null
  first_pm_completion?: Partial<FirstPmCompletion> | null
  notes?: string | null
  contact_name?: string | null
  contact_email?: string | null
  contact_phone?: string | null
}

// The normalized, write-ready column set common to insert and update. The
// caller layers on submitted_by (insert) and expires_at (equipment_sale insert).
export type ValidatedLeadFields = {
  lead_type: TechLeadType
  customer_id: number | null
  customer_name_text: string | null
  notes: string | null
  contact_name: string
  contact_email: string | null
  contact_phone: string | null
  equipment_description: string
  // PM-only — null on equipment_sale leads.
  make: string | null
  model: string | null
  serial_number: string | null
  location_on_site: string | null
  proposed_start_month: number | null
  proposed_start_year: number | null
  proposed_pm_frequency: TechLeadFrequency | null
  quoted_amount: string | null
  first_pm_performed: boolean
  first_pm_completion: FirstPmCompletion | null
  // equipment_sale-only — null on PM leads.
  proposed_equipment_tier: EquipmentSaleTier | null
}

export type ValidateResult =
  | { ok: true; fields: ValidatedLeadFields }
  | { ok: false; error: string; status: number }

function fail(error: string, status = 400): ValidateResult {
  return { ok: false, error, status }
}

// Compose the legacy `equipment_description` blob from the structured fields so
// downstream consumers (rep email, /my-leads sub-line) keep rendering.
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

export function validateLeadFields(body: LeadFieldsInput): ValidateResult {
  const leadType: TechLeadType = (body.lead_type as TechLeadType) ?? 'pm'
  if (leadType !== 'pm' && leadType !== 'equipment_sale') {
    return fail('Invalid lead_type.')
  }

  const hasExisting = typeof body.customer_id === 'number' && body.customer_id > 0
  const hasFreeText = !!body.customer_name_text?.trim()
  if (hasExisting === hasFreeText) {
    return fail(
      'Provide either an existing customer or a new customer name — not both, not neither.'
    )
  }

  const contactName = body.contact_name?.trim() ?? ''
  const contactEmail = body.contact_email?.trim() ?? ''
  const contactPhone = body.contact_phone?.trim() ?? ''
  if (!contactName) {
    return fail('Lead contact name is required.')
  }
  if (!contactEmail && !contactPhone) {
    return fail('Provide a contact email or phone — at least one.')
  }
  if (contactEmail && !EMAIL_SHAPE.test(contactEmail)) {
    return fail('Contact email looks invalid.')
  }
  if (contactPhone && contactPhone.replace(/\D+/g, '').length < 7) {
    return fail('Contact phone looks invalid.')
  }

  const fields: ValidatedLeadFields = {
    lead_type: leadType,
    customer_id: hasExisting ? body.customer_id! : null,
    customer_name_text: hasFreeText
      ? body.customer_name_text!.trim().slice(0, CUSTOMER_NAME_MAX)
      : null,
    notes: body.notes?.trim().slice(0, NOTES_MAX) || null,
    contact_name: contactName.slice(0, CONTACT_NAME_MAX),
    contact_email: contactEmail ? contactEmail.slice(0, CONTACT_EMAIL_MAX) : null,
    contact_phone: contactPhone ? contactPhone.slice(0, CONTACT_PHONE_MAX) : null,
    equipment_description: '',
    make: null,
    model: null,
    serial_number: null,
    location_on_site: null,
    proposed_start_month: null,
    proposed_start_year: null,
    proposed_pm_frequency: null,
    quoted_amount: null,
    first_pm_performed: false,
    first_pm_completion: null,
    proposed_equipment_tier: null,
  }

  if (leadType === 'pm') {
    const make = body.make?.trim() ?? ''
    const model = body.model?.trim() ?? ''
    const serial = body.serial_number?.trim() ?? ''
    const location = body.location_on_site?.trim() ?? ''
    if (!make) return fail('Equipment make is required.')
    if (!model) return fail('Equipment model is required.')
    if (!serial) return fail('Equipment serial number is required.')

    const startMonth = body.proposed_start_month
    const startYear = body.proposed_start_year
    if (!Number.isInteger(startMonth) || startMonth! < 1 || startMonth! > 12) {
      return fail('Proposed start month must be between 1 and 12.')
    }
    if (
      !Number.isInteger(startYear) ||
      startYear! < PROPOSED_START_YEAR_MIN ||
      startYear! > PROPOSED_START_YEAR_MAX
    ) {
      return fail(
        `Proposed start year must be between ${PROPOSED_START_YEAR_MIN} and ${PROPOSED_START_YEAR_MAX}.`
      )
    }
    if (
      body.proposed_pm_frequency &&
      !VALID_FREQUENCIES.includes(body.proposed_pm_frequency as TechLeadFrequency)
    ) {
      return fail('Invalid proposed_pm_frequency.')
    }

    fields.make = make.slice(0, EQUIPMENT_FIELD_MAX)
    fields.model = model.slice(0, EQUIPMENT_FIELD_MAX)
    fields.serial_number = serial.slice(0, EQUIPMENT_FIELD_MAX)
    fields.location_on_site = location ? location.slice(0, EQUIPMENT_FIELD_MAX) : null
    fields.proposed_start_month = startMonth!
    fields.proposed_start_year = startYear!
    fields.proposed_pm_frequency = (body.proposed_pm_frequency as TechLeadFrequency) ?? null
    fields.quoted_amount = body.quoted_amount?.trim().slice(0, QUOTED_AMOUNT_MAX) || null

    // First PM performed on site at signup (migration 130). When flagged, the
    // tech captures the completion essentials so the manager's Create Equipment
    // flow can record a completed, billable first PM.
    if (body.first_pm_performed) {
      const c = body.first_pm_completion ?? {}
      const completedDate = typeof c.completed_date === 'string' ? c.completed_date.trim() : ''
      if (!completedDate || Number.isNaN(new Date(completedDate + 'T12:00:00Z').getTime())) {
        return fail('First PM: enter a valid completion date.')
      }
      const hours = c.hours_worked
      if (typeof hours !== 'number' || !Number.isFinite(hours) || hours < 0) {
        return fail('First PM: hours worked must be a non-negative number.')
      }
      const machineHours = c.machine_hours
      if (typeof machineHours !== 'number' || !Number.isFinite(machineHours) || machineHours < 0) {
        return fail('First PM: machine hours must be a non-negative number.')
      }
      const dateCode = typeof c.date_code === 'string' ? c.date_code.trim() : ''
      if (!dateCode) return fail('First PM: date code is required.')
      const signature = typeof c.customer_signature === 'string' ? c.customer_signature : ''
      const signatureName = typeof c.customer_signature_name === 'string' ? c.customer_signature_name.trim() : ''
      if (!signature || !signatureName) {
        return fail('First PM: customer signature and printed name are required.')
      }
      const parts: PartUsed[] = Array.isArray(c.parts_used)
        ? (c.parts_used as PartUsed[]).filter(p => p && typeof p.description === 'string' && p.description.trim())
        : []
      fields.first_pm_performed = true
      fields.first_pm_completion = {
        completed_date: completedDate,
        hours_worked: hours,
        machine_hours: machineHours,
        date_code: dateCode.slice(0, 100),
        completion_notes: typeof c.completion_notes === 'string' ? c.completion_notes.trim().slice(0, NOTES_MAX) : '',
        parts_used: parts,
        customer_signature: signature,
        customer_signature_name: signatureName.slice(0, CONTACT_NAME_MAX),
      }
    }

    fields.equipment_description = composeEquipmentDescription({
      make: fields.make,
      model: fields.model,
      serial: fields.serial_number,
      location: fields.location_on_site,
    })
  } else {
    const tier = body.proposed_equipment_tier
    if (!tier || !VALID_TIERS.includes(tier as EquipmentSaleTier)) {
      return fail('A valid equipment tier is required.')
    }
    fields.proposed_equipment_tier = tier as EquipmentSaleTier
    // equipment_description is NOT NULL; mirror the tier label for legacy queries.
    fields.equipment_description = tierLabel(tier as EquipmentSaleTier)
  }

  return { ok: true, fields }
}
