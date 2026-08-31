import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deriveCustomerBillTerms, deriveCustomerBillAmount, type WarrantyBillTicketFields } from './warranty-server'

function ticket(overrides: Partial<WarrantyBillTicketFields> = {}): WarrantyBillTicketFields {
  return {
    billing_amount: 500,
    shipping_charge: null,
    diagnostic_charge: null,
    diagnostic_invoice_number: null,
    warranty_labor_covered: false,
    parts_used: [],
    ...overrides,
  }
}

test('deriveCustomerBillAmount: null billing_amount is null (not completed)', () => {
  assert.equal(deriveCustomerBillAmount(ticket({ billing_amount: null })), null)
  assert.equal(deriveCustomerBillTerms(ticket({ billing_amount: null })), null)
})

test('deriveCustomerBillAmount: full coverage (labor covered, all parts covered) is 0', () => {
  const t = ticket({
    billing_amount: 500,
    warranty_labor_covered: true,
    parts_used: [
      { synergy_product_id: 1, quantity: 2, description: 'Belt', unit_price: 50, warranty_covered: true },
    ],
  })
  assert.equal(deriveCustomerBillAmount(t), 0)
})

test('deriveCustomerBillAmount: parts-only coverage — customer pays laborPlusTrip + diagnostic', () => {
  // billing_amount = labor(200) + parts(100 covered) + diagnostic(25) = 325
  const t = ticket({
    billing_amount: 325,
    diagnostic_charge: 25,
    warranty_labor_covered: false,
    parts_used: [
      { synergy_product_id: 1, quantity: 1, description: 'Filter', unit_price: 100, warranty_covered: true },
    ],
  })
  // laborPlusTrip backs out to 325 - 100 - 25 - 0 = 200. Labor not covered, so
  // nothing further is subtracted: customer pays 200 (labor) + 25 (diagnostic).
  assert.equal(deriveCustomerBillAmount(t), 225)
})

test('deriveCustomerBillAmount: parts-only coverage with shipping — shipping rides the parts waiver', () => {
  // billing_amount = labor(200) + parts(100 covered) + shipping(15) = 315
  const t = ticket({
    billing_amount: 315,
    shipping_charge: 15,
    warranty_labor_covered: false,
    parts_used: [
      { synergy_product_id: 1, quantity: 1, description: 'Filter', unit_price: 100, warranty_covered: true },
    ],
  })
  // laborCovered is false, so the shipping waiver (which only fires under
  // laborCovered) never applies here: customer pays labor(200) + shipping(15).
  assert.equal(deriveCustomerBillAmount(t), 215)
})

test('deriveCustomerBillAmount: labor-only coverage with parts present — customer pays parts + shipping', () => {
  // billing_amount = labor(200, covered) + parts(100, not covered) + shipping(15) = 315
  const t = ticket({
    billing_amount: 315,
    shipping_charge: 15,
    warranty_labor_covered: true,
    parts_used: [
      { synergy_product_id: 1, quantity: 1, description: 'Filter', unit_price: 100, warranty_covered: false },
    ],
  })
  // laborCovered subtracts labor(200); shipping is NOT waived because not
  // every part line is covered. Customer pays parts(100) + shipping(15) = 115.
  assert.equal(deriveCustomerBillAmount(t), 115)
})

test('deriveCustomerBillAmount: negative diagnostic (already invoiced separately) passes through as a credit', () => {
  // billing_amount = labor(200) + diagnostic(-40, credited back) = 160
  const t = ticket({
    billing_amount: 160,
    diagnostic_charge: 40,
    diagnostic_invoice_number: 'INV-1',
    warranty_labor_covered: true,
  })
  const terms = deriveCustomerBillTerms(t)
  assert.ok(terms)
  assert.equal(terms!.signedDiagnostic, -40)
  // laborCovered subtracts labor(200) + trip(0) + max(-40, 0)=0 -> 160 - 200 = 0 (floored)
  assert.equal(deriveCustomerBillAmount(t), 0)
})

test('deriveCustomerBillTerms: laborTotal never goes negative even if parts/diagnostic/shipping exceed billing_amount', () => {
  const t = ticket({
    billing_amount: 50,
    shipping_charge: 100,
    parts_used: [],
  })
  const terms = deriveCustomerBillTerms(t)
  assert.ok(terms)
  assert.equal(terms!.laborTotal, 0)
})
