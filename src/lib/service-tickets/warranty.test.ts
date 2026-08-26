import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  warrantyBillingBlock,
  computeCustomerBillAmount,
  suggestExpectedCredit,
  bucketOf,
} from './warranty'

// --- warrantyBillingBlock ---

test('warrantyBillingBlock: requested is always pending_review', () => {
  assert.equal(warrantyBillingBlock({ warranty_review_status: 'requested' }), 'pending_review')
})

test('warrantyBillingBlock: verified without credit is awaiting_credit', () => {
  assert.equal(
    warrantyBillingBlock({ warranty_review_status: 'verified', warranty_credit_received_at: null }),
    'awaiting_credit',
  )
})

test('warrantyBillingBlock: verified with credit clears the gate', () => {
  assert.equal(
    warrantyBillingBlock({
      warranty_review_status: 'verified',
      warranty_credit_received_at: '2026-08-01T00:00:00Z',
    }),
    null,
  )
})

test('warrantyBillingBlock: denied clears the gate', () => {
  assert.equal(warrantyBillingBlock({ warranty_review_status: 'denied' }), null)
})

test('warrantyBillingBlock: null status with no legacy flag clears the gate', () => {
  assert.equal(warrantyBillingBlock({ warranty_review_status: null }), null)
  assert.equal(warrantyBillingBlock({}), null)
})

test('warrantyBillingBlock: legacy billing_type=warranty without credit is awaiting_credit', () => {
  assert.equal(
    warrantyBillingBlock({ warranty_review_status: null, billing_type: 'warranty' }),
    'awaiting_credit',
  )
})

test('warrantyBillingBlock: legacy billing_type=warranty with credit clears the gate', () => {
  assert.equal(
    warrantyBillingBlock({
      warranty_review_status: null,
      billing_type: 'warranty',
      warranty_credit_received_at: '2026-08-01T00:00:00Z',
    }),
    null,
  )
})

test('warrantyBillingBlock: legacy billing_type=partial_warranty without credit is awaiting_credit', () => {
  assert.equal(
    warrantyBillingBlock({ warranty_review_status: null, billing_type: 'partial_warranty' }),
    'awaiting_credit',
  )
})

test('warrantyBillingBlock: legacy billing_type=non_warranty clears the gate', () => {
  assert.equal(
    warrantyBillingBlock({ warranty_review_status: null, billing_type: 'non_warranty' }),
    null,
  )
})

test('warrantyBillingBlock: a set review status wins over a legacy billing_type', () => {
  assert.equal(
    warrantyBillingBlock({
      warranty_review_status: 'verified',
      warranty_credit_received_at: '2026-08-01T00:00:00Z',
      billing_type: 'warranty',
    }),
    null,
  )
})

// --- computeCustomerBillAmount ---

function terms(overrides: Partial<Parameters<typeof computeCustomerBillAmount>[0]> = {}) {
  return {
    billingAmount: 500,
    laborTotal: 200,
    tripCharge: 25,
    signedDiagnostic: 0,
    shippingCharge: 15,
    laborCovered: false,
    parts: [] as { lineTotal: number; covered: boolean }[],
    ...overrides,
  }
}

test('computeCustomerBillAmount: nothing covered returns billingAmount', () => {
  assert.equal(computeCustomerBillAmount(terms()), 500)
})

test('computeCustomerBillAmount: covered parts subtract their line total', () => {
  const result = computeCustomerBillAmount(
    terms({ parts: [{ lineTotal: 100, covered: true }, { lineTotal: 50, covered: false }] }),
  )
  assert.equal(result, 400)
})

test('computeCustomerBillAmount: laborCovered subtracts labor + trip + positive diagnostic', () => {
  const result = computeCustomerBillAmount(terms({ laborCovered: true, signedDiagnostic: 40 }))
  // 500 - 200 - 25 - 40 = 235
  assert.equal(result, 235)
})

test('computeCustomerBillAmount: negative signedDiagnostic is not subtracted when laborCovered', () => {
  const result = computeCustomerBillAmount(terms({ laborCovered: true, signedDiagnostic: -40 }))
  // 500 - 200 - 25 - max(-40, 0)=0 = 275
  assert.equal(result, 275)
})

test('computeCustomerBillAmount: freight subtracted only when parts non-empty and all covered', () => {
  const allCovered = computeCustomerBillAmount(
    terms({ laborCovered: true, parts: [{ lineTotal: 30, covered: true }] }),
  )
  // 500 - 30 - 200 - 25 - 15 = 230
  assert.equal(allCovered, 230)

  const notAllCovered = computeCustomerBillAmount(
    terms({
      laborCovered: true,
      parts: [{ lineTotal: 30, covered: true }, { lineTotal: 10, covered: false }],
    }),
  )
  // 500 - 30 - 200 - 25 = 245 (shipping NOT waived, one line uncovered)
  assert.equal(notAllCovered, 245)
})

test('computeCustomerBillAmount: freight not subtracted when parts empty, even with laborCovered', () => {
  const result = computeCustomerBillAmount(terms({ laborCovered: true, parts: [] }))
  // 500 - 200 - 25 = 275 (no shipping waiver: no parts at all)
  assert.equal(result, 275)
})

test('computeCustomerBillAmount: rounds to cents', () => {
  const result = computeCustomerBillAmount(
    terms({ billingAmount: 100.005, laborCovered: false, parts: [] }),
  )
  assert.equal(result, 100.01)
})

test('computeCustomerBillAmount: floors at 0 when deductions exceed total', () => {
  const result = computeCustomerBillAmount(
    terms({ billingAmount: 50, laborCovered: true, laborTotal: 200, tripCharge: 25 }),
  )
  assert.equal(result, 0)
})

// --- suggestExpectedCredit ---

test('suggestExpectedCredit: covered parts priced at cost', () => {
  const result = suggestExpectedCredit({
    hoursWorked: 0,
    laborCovered: false,
    vendorLaborRate: null,
    parts: [
      { qty: 2, covered: true, unitCost: 10 },
      { qty: 1, covered: false, unitCost: 999 },
    ],
  })
  assert.equal(result.amount, 20)
  assert.equal(result.unknownCostParts, 0)
})

test('suggestExpectedCredit: unknown cost (null and 0) counted and excluded from amount', () => {
  const result = suggestExpectedCredit({
    hoursWorked: 0,
    laborCovered: false,
    vendorLaborRate: null,
    parts: [
      { qty: 1, covered: true, unitCost: null },
      { qty: 1, covered: true, unitCost: 0 },
      { qty: 1, covered: true, unitCost: -5 },
      { qty: 3, covered: true, unitCost: 4 },
    ],
  })
  assert.equal(result.amount, 12)
  assert.equal(result.unknownCostParts, 3)
})

test('suggestExpectedCredit: labor term only when laborCovered AND rate > 0', () => {
  const notCovered = suggestExpectedCredit({
    hoursWorked: 5,
    laborCovered: false,
    vendorLaborRate: 50,
    parts: [],
  })
  assert.equal(notCovered.amount, 0)

  const noRate = suggestExpectedCredit({
    hoursWorked: 5,
    laborCovered: true,
    vendorLaborRate: null,
    parts: [],
  })
  assert.equal(noRate.amount, 0)

  const zeroRate = suggestExpectedCredit({
    hoursWorked: 5,
    laborCovered: true,
    vendorLaborRate: 0,
    parts: [],
  })
  assert.equal(zeroRate.amount, 0)

  const covered = suggestExpectedCredit({
    hoursWorked: 5,
    laborCovered: true,
    vendorLaborRate: 50,
    parts: [],
  })
  assert.equal(covered.amount, 250)
})

test('suggestExpectedCredit: rounds to cents', () => {
  const result = suggestExpectedCredit({
    hoursWorked: 1,
    laborCovered: true,
    vendorLaborRate: 33.333,
    parts: [],
  })
  assert.equal(result.amount, 33.33)
})

// --- bucketOf ---

test('bucketOf: requested is to_review', () => {
  assert.equal(bucketOf({ warranty_review_status: 'requested', status: 'completed' }), 'to_review')
})

test('bucketOf: requested beats billed', () => {
  assert.equal(bucketOf({ warranty_review_status: 'requested', status: 'billed' }), 'to_review')
})

test('bucketOf: billed status (not requested) is billed_unclaimed', () => {
  assert.equal(bucketOf({ warranty_review_status: 'verified', status: 'billed' }), 'billed_unclaimed')
})

test('bucketOf: received beats submitted', () => {
  assert.equal(
    bucketOf({
      warranty_review_status: 'verified',
      status: 'completed',
      warranty_credit_received_at: '2026-08-01T00:00:00Z',
      warranty_claim_submitted_at: '2026-07-01T00:00:00Z',
    }),
    'received',
  )
})

test('bucketOf: submitted without credit is awaiting_credit', () => {
  assert.equal(
    bucketOf({
      warranty_review_status: 'verified',
      status: 'completed',
      warranty_claim_submitted_at: '2026-07-01T00:00:00Z',
    }),
    'awaiting_credit',
  )
})

test('bucketOf: neither submitted nor received is to_file', () => {
  assert.equal(bucketOf({ warranty_review_status: 'verified', status: 'completed' }), 'to_file')
})
