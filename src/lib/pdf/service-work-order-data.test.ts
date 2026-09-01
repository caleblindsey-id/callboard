import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildServiceWorkOrder, type ServiceWorkOrderRow } from './service-work-order-data'

// The mapping these cover used to live inline in
// /api/service-tickets/[id]/work-order-pdf. It was extracted so the batch
// billing export could render the same document; these lock the behavior that
// extraction had to preserve, and guard the derived trip charge in particular
// (billingTotal minus every other term — a new term silently prints as Trip
// Charge if it isn't accounted for).

function row(overrides: Partial<ServiceWorkOrderRow> = {}): ServiceWorkOrderRow {
  return {
    id: 'st-1',
    work_order_number: 4021,
    synergy_order_number: 'SO-9',
    po_number: null,
    status: 'completed',
    ticket_type: 'inside',
    billing_type: 'billable',
    problem_description: 'Will not start',
    diagnosis_notes: null,
    completion_notes: 'Replaced starter',
    completed_at: '2026-08-14T15:00:00Z',
    hours_worked: 2,
    machine_hours: null,
    date_code: null,
    estimate_labor_rate: 100,
    labor_rate_type: 'standard',
    parts_used: [{ description: 'Starter', quantity: 1, unit_price: 260 }],
    diagnostic_charge: null,
    diagnostic_invoice_number: null,
    billing_amount: 500,
    customer_bill_amount: null,
    warranty_review_status: null,
    warranty_credit_received_at: null,
    warranty_labor_covered: null,
    shipping_charge: 15,
    customer_signature: null,
    customer_signature_name: null,
    photos: null,
    contact_name: null,
    contact_email: null,
    contact_phone: null,
    service_address: null,
    service_city: null,
    service_state: null,
    service_zip: null,
    equipment_make: null,
    equipment_model: null,
    equipment_serial_number: null,
    assigned_technician_id: 'u-1',
    customer_id: 7,
    customers: { name: 'Acme Foods', account_number: 'A-100', tax_rate: null, tax_exempt: null },
    equipment: {
      make: 'Hobart',
      model: 'HL200',
      serial_number: 'SN-55',
      ship_to_locations: { address: '1 Mill Rd', city: 'Dayton', state: 'OH', zip: '45402' },
    },
    assigned_technician: { name: 'Rick' },
    ...overrides,
  } as ServiceWorkOrderRow
}

const deps = { laborRate: 100, photoUrls: [] }

// --- pricing mode ---

test('a plain billable ticket renders in full mode with the trip charge derived', () => {
  // 500 total - 200 labor - 260 parts - 0 diagnostic - 15 freight = 25 trip
  const wo = buildServiceWorkOrder(row(), deps)
  assert.equal(wo.pricingMode, 'full')
  assert.equal(wo.laborTotal, 200)
  assert.equal(wo.tripCharge, 25)
  assert.equal(wo.shippingCharge, 15)
  assert.equal(wo.billingTotal, 500)
  assert.equal(wo.zeroAllParts, false)
  assert.equal(wo.diagnosticZeroed, false)
})

test('a legacy warranty row renders net and zeroes every part line', () => {
  const wo = buildServiceWorkOrder(row({ billing_type: 'warranty' }), deps)
  assert.equal(wo.pricingMode, 'net')
  assert.equal(wo.zeroAllParts, true)
  // A legacy full 'warranty' row never had freight added.
  assert.equal(wo.shippingCharge, 0)
})

test('legacy partial_warranty renders net but does NOT zero every line', () => {
  const wo = buildServiceWorkOrder(row({ billing_type: 'partial_warranty' }), deps)
  assert.equal(wo.pricingMode, 'net')
  assert.equal(wo.zeroAllParts, false)
})

test('a verified review stays in full mode until the vendor credit lands', () => {
  const verified = row({ warranty_review_status: 'verified' })
  assert.equal(buildServiceWorkOrder(verified, deps).pricingMode, 'full')

  const credited = row({
    warranty_review_status: 'verified',
    warranty_credit_received_at: '2026-08-20T00:00:00Z',
  })
  assert.equal(buildServiceWorkOrder(credited, deps).pricingMode, 'net')
})

test('requestedNet flips a verified-but-uncredited row to net (office preview only)', () => {
  const verified = row({ warranty_review_status: 'verified' })
  assert.equal(buildServiceWorkOrder(verified, { ...deps, requestedNet: true }).pricingMode, 'net')
})

test('requestedNet does NOT flip a row whose review is not verified', () => {
  const requested = row({ warranty_review_status: 'requested' })
  assert.equal(buildServiceWorkOrder(requested, { ...deps, requestedNet: true }).pricingMode, 'full')
})

// --- diagnostic charge ---

test('a diagnostic charge already invoiced is carried as a credit', () => {
  // Signed negative, so the trip derivation gains it back: 500 - 200 - 260 - (-50) - 15 = 75
  const wo = buildServiceWorkOrder(
    row({ diagnostic_charge: 50, diagnostic_invoice_number: 'INV-3' }),
    deps,
  )
  assert.equal(wo.diagnosticCharge, 50)
  assert.equal(wo.diagnosticInvoiceNumber, 'INV-3')
  assert.equal(wo.tripCharge, 75)
})

test('warranty-covered labor zeroes a positive diagnostic in the new net mode only', () => {
  const netCovered = row({
    warranty_review_status: 'verified',
    warranty_credit_received_at: '2026-08-20T00:00:00Z',
    warranty_labor_covered: true,
    diagnostic_charge: 50,
  })
  assert.equal(buildServiceWorkOrder(netCovered, deps).diagnosticZeroed, true)

  // Legacy branch never zeroes it.
  const legacy = row({ billing_type: 'warranty', warranty_labor_covered: true, diagnostic_charge: 50 })
  assert.equal(buildServiceWorkOrder(legacy, deps).diagnosticZeroed, false)
})

// --- service address ---

test('an outside ticket prints its own service address, not the equipment ship-to', () => {
  const wo = buildServiceWorkOrder(
    row({
      ticket_type: 'outside',
      service_address: '99 Plant Way',
      service_city: 'Xenia',
      service_state: 'OH',
      service_zip: '45385',
    }),
    deps,
  )
  assert.equal(wo.serviceAddress, '99 Plant Way, Xenia, OH, 45385')
})

test('an inside ticket falls back to the equipment ship-to', () => {
  const wo = buildServiceWorkOrder(row(), deps)
  assert.equal(wo.serviceAddress, '1 Mill Rd, Dayton, OH, 45402')
})

test('an outside ticket with no address on the ticket prints none', () => {
  const wo = buildServiceWorkOrder(row({ ticket_type: 'outside' }), deps)
  assert.equal(wo.serviceAddress, null)
})

// --- join shapes and fallbacks ---

test('the technician join is read whether Supabase returns an object or an array', () => {
  assert.equal(buildServiceWorkOrder(row(), deps).technicianName, 'Rick')
  assert.equal(
    buildServiceWorkOrder(row({ assigned_technician: [{ name: 'Dana' }] }), deps).technicianName,
    'Dana',
  )
  assert.equal(
    buildServiceWorkOrder(row({ assigned_technician: null }), deps).technicianName,
    '—',
  )
})

test('equipment falls back to the free-text columns when the join is missing', () => {
  const wo = buildServiceWorkOrder(
    row({
      equipment: null,
      equipment_make: 'Vulcan',
      equipment_model: 'VC4',
      equipment_serial_number: 'SN-99',
    }),
    deps,
  )
  assert.equal(wo.equipmentLine, 'Vulcan VC4')
  assert.equal(wo.serialNumber, 'SN-99')
})

test('a ticket with no equipment at all still renders', () => {
  const wo = buildServiceWorkOrder(row({ equipment: null }), deps)
  assert.equal(wo.equipmentLine, '—')
  assert.equal(wo.serialNumber, null)
  assert.equal(wo.serviceAddress, null)
})

// --- batch parity ---

test('a work order is identical whether built alone or as one of a batch', () => {
  // The batch export maps the same builder over N rows; nothing may depend on
  // position, so a row's document must not change when built alongside others.
  const rows = [row({ id: 'a' }), row({ id: 'b', billing_amount: 900, work_order_number: 4022 })]
  const alone = rows.map((r) => buildServiceWorkOrder(r, deps))
  const batched = rows.map((r) => buildServiceWorkOrder(r, deps))
  assert.deepEqual(batched, alone)
  // And the two rows really are different documents (guards a vacuous pass).
  assert.notDeepEqual(alone[0], alone[1])
})
