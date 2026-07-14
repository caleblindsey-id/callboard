import { test } from 'node:test'
import assert from 'node:assert/strict'
import { suggestQty, type SuggestQtyInput } from './suggest'

function baseInput(overrides: Partial<SuggestQtyInput> = {}): SuggestQtyInput {
  return {
    qtyOnHand: 0,
    qtyOnPo: 0,
    qtyCommitted: 0,
    orderPoint: 0,
    maxStock: 0,
    safetyStock: 0,
    doNotReorder: false,
    packQty: 1,
    periodUsage: [],
    usageRate: null,
    demand: null,
    ...overrides,
  }
}

test('suggestQty: below-ROP fast mover suggests > 0 and rounds to cases', () => {
  const result = suggestQty(
    baseInput({
      qtyOnHand: 5,
      orderPoint: 20,
      packQty: 12,
      periodUsage: [40, 40, 40], // 120 / (3*4) = 10/week
    }),
  )

  assert.equal(result.weeklyUsage, 10)
  // available = 5; target = ceil(6*10) + 0 = 60; suggestedEach = 60 - 5 = 55
  assert.equal(result.suggestedEach, 55)
  // roundUpToPack(55, 12) = ceil(55/12) = 5
  assert.equal(result.suggestedCases, 5)
  assert.equal(result.urgency, 'red')
})

test('suggestQty: overstock (120 on hand, weeklyUsage ~1) suggests 0', () => {
  const result = suggestQty(
    baseInput({
      qtyOnHand: 120,
      orderPoint: 20,
      periodUsage: [4, 4, 4], // 12 / 12 = 1/week
    }),
  )

  assert.equal(result.weeklyUsage, 1)
  assert.equal(result.suggestedEach, 0)
  assert.equal(result.suggestedCases, 0)
  assert.equal(result.urgency, 'green')
})

test('suggestQty: no-usage healthy item suggests 0 and is grey', () => {
  const result = suggestQty(
    baseInput({
      qtyOnHand: 50,
      orderPoint: 10,
    }),
  )

  assert.equal(result.weeklyUsage, 0)
  assert.equal(result.weeksOfSupply, Infinity)
  assert.equal(result.suggestedEach, 0)
  assert.equal(result.urgency, 'grey')
})

test('suggestQty: doNotReorder always suggests 0 even when below ROP', () => {
  const result = suggestQty(
    baseInput({
      qtyOnHand: 5,
      orderPoint: 20,
      doNotReorder: true,
      periodUsage: [40, 40, 40],
    }),
  )

  assert.equal(result.suggestedEach, 0)
  assert.equal(result.suggestedCases, 0)
})

test('suggestQty: empty periodUsage falls back to usageRate/4', () => {
  const result = suggestQty(
    baseInput({
      qtyOnHand: 50,
      periodUsage: [],
      usageRate: 40,
    }),
  )

  assert.equal(result.weeklyUsage, 10)
})

test('suggestQty: empty periodUsage and no usageRate falls back to demand/4', () => {
  const result = suggestQty(
    baseInput({
      qtyOnHand: 50,
      periodUsage: [],
      usageRate: null,
      demand: 20,
    }),
  )

  assert.equal(result.weeklyUsage, 5)
})

test('suggestQty: all-zero periodUsage is treated as empty for fallback purposes', () => {
  const result = suggestQty(
    baseInput({
      qtyOnHand: 50,
      periodUsage: [0, 0, 0],
      usageRate: 40,
    }),
  )

  assert.equal(result.weeklyUsage, 10)
})

test('suggestQty: pack rounding — 13 eaches with a 12/CS pack rounds to 2 cases', () => {
  const result = suggestQty(
    baseInput({
      qtyOnHand: 0,
      orderPoint: 5,
      safetyStock: 13,
      packQty: 12,
    }),
  )

  // available = 0 <= orderPoint(5) -> needTrigger; no usage -> target = 0 + safetyStock(13)
  assert.equal(result.suggestedEach, 13)
  assert.equal(result.suggestedCases, 2)
})

test('suggestQty: max-stock special case suggests up to maxStock when below ROP', () => {
  const result = suggestQty(
    baseInput({
      qtyOnHand: 5,
      orderPoint: 20,
      maxStock: 50,
    }),
  )

  // available = 5 <= orderPoint(20) and maxStock > 0 -> target = maxStock
  assert.equal(result.suggestedEach, 45)
})

test('suggestQty: usage wins over a contradictory low max (order point > max)', () => {
  // Real Whse-4 case: order point 13 but max 4, available 4, ~1.83/week usage.
  // "Order up to max" alone would suggest 0 (available already == max); usage
  // must stay the floor so a below-ROP item with real demand still reorders.
  const result = suggestQty(
    baseInput({
      qtyOnHand: 4,
      orderPoint: 13,
      maxStock: 4,
      packQty: 4,
      periodUsage: [12, 0, 10], // 22 / 12 = 1.833/week
    }),
  )

  // usageTarget = ceil(6 * 1.833) = 11; maxTarget = 4; target = max(11,4) = 11
  assert.equal(result.suggestedEach, 7)
  assert.equal(result.suggestedCases, 2) // ceil(7/4)
})

test('suggestQty: negative available (oversold) is red urgency', () => {
  const result = suggestQty(
    baseInput({
      qtyOnHand: -5,
      qtyCommitted: 0,
      orderPoint: 0,
    }),
  )

  assert.equal(result.urgency, 'red')
})
