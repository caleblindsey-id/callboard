import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deriveWorkOrderTerms, type WorkOrderPricingInput } from './work-order-pricing'

function terms(overrides: Partial<WorkOrderPricingInput> = {}): WorkOrderPricingInput {
  return {
    billingAmount: 500,
    customerBillAmount: null,
    laborTotal: 200,
    signedDiagnostic: 0,
    shippingCharge: 15,
    partsTotal: 260,
    isLegacyWarranty: false,
    laborCovered: false,
    allPartsCovered: false,
    ...overrides,
  }
}

// --- full mode ---

test('full mode: nothing zeroed, trip derived by subtraction, total = billingAmount', () => {
  // 500 - 200 - 260 - 0 - 15 = 25
  const result = deriveWorkOrderTerms('full', terms())
  assert.equal(result.laborDisplay, 200)
  assert.equal(result.tripDisplay, 25)
  assert.equal(result.diagnosticDisplay, 0)
  assert.equal(result.shippingDisplay, 15)
  assert.equal(result.total, 500)
})

test('full mode: ignores laborCovered/allPartsCovered/customerBillAmount entirely', () => {
  const result = deriveWorkOrderTerms(
    'full',
    terms({ laborCovered: true, allPartsCovered: true, customerBillAmount: 50 }),
  )
  assert.equal(result.laborDisplay, 200)
  assert.equal(result.tripDisplay, 25)
  assert.equal(result.total, 500)
})

test('full mode: trip floors at 0 when other terms exceed the total', () => {
  const result = deriveWorkOrderTerms('full', terms({ billingAmount: 100 }))
  assert.equal(result.tripDisplay, 0)
})

// --- legacy net mode (frozen billing_type warranty/partial_warranty) ---

test('legacy net: labor and diagnostic are NEVER zeroed for display (reproduces the old bug verbatim)', () => {
  // Full 'warranty' row: billing_amount stored as 0, but labor/diagnostic still print.
  const result = deriveWorkOrderTerms(
    'net',
    terms({
      isLegacyWarranty: true,
      billingAmount: 0,
      partsTotal: 0, // caller pre-filters to exclude warranty_covered lines
      shippingCharge: 0, // caller pre-zeroes for a full 'warranty' row
      signedDiagnostic: 50,
    }),
  )
  assert.equal(result.laborDisplay, 200)
  assert.equal(result.diagnosticDisplay, 50)
  // 0 - 200 - 0 - 50 - 0 is negative -> floors at 0, does NOT reconcile with
  // the printed labor/diagnostic rows. That mismatch is the preserved legacy
  // behavior, not a bug introduced here.
  assert.equal(result.tripDisplay, 0)
  assert.equal(result.total, 0)
})

test('legacy net: total is always billingAmount, never customerBillAmount', () => {
  const result = deriveWorkOrderTerms(
    'net',
    terms({ isLegacyWarranty: true, billingAmount: 300, customerBillAmount: 999 }),
  )
  assert.equal(result.total, 300)
})

// --- new review-lifecycle net mode ---

test('new-lifecycle net: laborCovered zeroes labor and trip, credits a positive diagnostic', () => {
  const result = deriveWorkOrderTerms(
    'net',
    terms({ laborCovered: true, signedDiagnostic: 40, partsTotal: 260 }),
  )
  // trip derived in full-price space first: 500 - 200 - 260 - 40 - 15 = -15 -> floors at 0
  assert.equal(result.laborDisplay, 0)
  assert.equal(result.tripDisplay, 0)
  assert.equal(result.diagnosticDisplay, 0)
})

test('new-lifecycle net: a negative (credit) diagnostic is untouched even when laborCovered', () => {
  const result = deriveWorkOrderTerms('net', terms({ laborCovered: true, signedDiagnostic: -40 }))
  assert.equal(result.diagnosticDisplay, -40)
})

test('new-lifecycle net: shipping zeroes only when laborCovered AND allPartsCovered', () => {
  const neither = deriveWorkOrderTerms('net', terms({ laborCovered: false, allPartsCovered: true }))
  assert.equal(neither.shippingDisplay, 15)

  const laborOnly = deriveWorkOrderTerms('net', terms({ laborCovered: true, allPartsCovered: false }))
  assert.equal(laborOnly.shippingDisplay, 15)

  const both = deriveWorkOrderTerms('net', terms({ laborCovered: true, allPartsCovered: true }))
  assert.equal(both.shippingDisplay, 0)
})

test('new-lifecycle net: laborCovered false leaves labor and trip at full price', () => {
  const result = deriveWorkOrderTerms('net', terms({ laborCovered: false }))
  assert.equal(result.laborDisplay, 200)
  assert.equal(result.tripDisplay, 25)
})

test('new-lifecycle net: total prefers customerBillAmount, falls back to billingAmount', () => {
  const withCustomerAmount = deriveWorkOrderTerms('net', terms({ customerBillAmount: 235 }))
  assert.equal(withCustomerAmount.total, 235)

  const withoutCustomerAmount = deriveWorkOrderTerms('net', terms({ customerBillAmount: null }))
  assert.equal(withoutCustomerAmount.total, 500)
})

test('new-lifecycle net vs full: term consistency for a verified+credited ticket', () => {
  // Same underlying full-price terms; net mode should only ever ZERO a term
  // full mode showed, never invent a new positive figure.
  const full = deriveWorkOrderTerms('full', terms())
  const net = deriveWorkOrderTerms('net', terms({ laborCovered: true, allPartsCovered: true }))
  assert.ok(net.laborDisplay <= full.laborDisplay)
  assert.ok(net.tripDisplay <= full.tripDisplay)
  assert.ok(net.shippingDisplay <= full.shippingDisplay)
})
