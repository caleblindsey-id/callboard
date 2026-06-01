import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateLeadFields } from './validate-lead'

// Minimal valid PM body — reused and overridden per case.
function pmBody(overrides: Record<string, unknown> = {}) {
  return {
    lead_type: 'pm',
    customer_id: 42,
    contact_name: 'Pat Buyer',
    contact_phone: '(205) 555-0100',
    make: 'Tennant',
    model: 'T16',
    serial_number: 'SN-9',
    proposed_start_month: 6,
    proposed_start_year: 2026,
    ...overrides,
  }
}

function saleBody(overrides: Record<string, unknown> = {}) {
  return {
    lead_type: 'equipment_sale',
    customer_name_text: 'Acme New Co',
    contact_name: 'Pat Buyer',
    contact_email: 'pat@acme.com',
    proposed_equipment_tier: 'walk_behind_scrubber',
    ...overrides,
  }
}

// --- happy paths ---

test('accepts a valid PM lead and composes equipment_description', () => {
  const r = validateLeadFields(pmBody({ location_on_site: 'Dock 3' }))
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.fields.lead_type, 'pm')
  assert.equal(r.fields.customer_id, 42)
  assert.equal(r.fields.customer_name_text, null)
  assert.equal(r.fields.make, 'Tennant')
  assert.equal(r.fields.proposed_start_month, 6)
  assert.match(r.fields.equipment_description, /Make: Tennant/)
  assert.match(r.fields.equipment_description, /Location: Dock 3/)
  // PM leaves equipment-sale-only field null
  assert.equal(r.fields.proposed_equipment_tier, null)
})

test('accepts a valid equipment_sale lead with free-text customer', () => {
  const r = validateLeadFields(saleBody())
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.fields.lead_type, 'equipment_sale')
  assert.equal(r.fields.customer_id, null)
  assert.equal(r.fields.customer_name_text, 'Acme New Co')
  assert.equal(r.fields.proposed_equipment_tier, 'walk_behind_scrubber')
  // equipment_sale nulls the PM-only structured fields
  assert.equal(r.fields.make, null)
  assert.equal(r.fields.proposed_start_month, null)
  // equipment_description mirrors the tier label
  assert.ok(r.fields.equipment_description.length > 0)
})

test('trims and slices over-long notes/contact fields', () => {
  const r = validateLeadFields(pmBody({ notes: '  hello  ' }))
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.fields.notes, 'hello')
})

// --- customer xor ---

test('rejects when both customer_id and customer_name_text given', () => {
  const r = validateLeadFields(pmBody({ customer_name_text: 'Both' }))
  assert.equal(r.ok, false)
})

test('rejects when neither customer is given', () => {
  const r = validateLeadFields(pmBody({ customer_id: null }))
  assert.equal(r.ok, false)
})

// --- contact rules ---

test('rejects missing contact name', () => {
  const r = validateLeadFields(pmBody({ contact_name: '   ' }))
  assert.equal(r.ok, false)
})

test('rejects when neither email nor phone given', () => {
  const r = validateLeadFields(pmBody({ contact_phone: '', contact_email: '' }))
  assert.equal(r.ok, false)
})

test('rejects a malformed email', () => {
  const r = validateLeadFields(pmBody({ contact_phone: '', contact_email: 'not-an-email' }))
  assert.equal(r.ok, false)
})

test('rejects a too-short phone', () => {
  const r = validateLeadFields(pmBody({ contact_phone: '123' }))
  assert.equal(r.ok, false)
})

// --- lead_type ---

test('defaults lead_type to pm when omitted', () => {
  const b = pmBody()
  delete (b as Record<string, unknown>).lead_type
  const r = validateLeadFields(b)
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.fields.lead_type, 'pm')
})

test('rejects an invalid lead_type', () => {
  const r = validateLeadFields(pmBody({ lead_type: 'bogus' }))
  assert.equal(r.ok, false)
})

// --- PM-specific ---

test('rejects PM lead missing make', () => {
  const r = validateLeadFields(pmBody({ make: '' }))
  assert.equal(r.ok, false)
})

test('rejects PM lead missing serial', () => {
  const r = validateLeadFields(pmBody({ serial_number: '' }))
  assert.equal(r.ok, false)
})

test('rejects PM lead with month out of range', () => {
  const r = validateLeadFields(pmBody({ proposed_start_month: 13 }))
  assert.equal(r.ok, false)
})

test('rejects PM lead with year out of range', () => {
  const r = validateLeadFields(pmBody({ proposed_start_year: 1999 }))
  assert.equal(r.ok, false)
})

test('rejects PM lead with an invalid frequency', () => {
  const r = validateLeadFields(pmBody({ proposed_pm_frequency: 'weekly' }))
  assert.equal(r.ok, false)
})

test('accepts PM lead with a valid frequency', () => {
  const r = validateLeadFields(pmBody({ proposed_pm_frequency: 'quarterly' }))
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.fields.proposed_pm_frequency, 'quarterly')
})

// --- equipment_sale-specific ---

test('rejects equipment_sale lead missing a tier', () => {
  const r = validateLeadFields(saleBody({ proposed_equipment_tier: null }))
  assert.equal(r.ok, false)
})

test('rejects equipment_sale lead with an invalid tier', () => {
  const r = validateLeadFields(saleBody({ proposed_equipment_tier: 'gold_plated' }))
  assert.equal(r.ok, false)
})
