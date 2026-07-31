import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  roundCents,
  tierForSubtotal,
  rateForSubtotal,
  commissionFor,
  distanceToNextTier,
  formatRate,
  type CommissionTier,
} from './tiers'

// The seeded tier table from migration 153, effective 2022-11-01. Half-open
// bands: [min, max), max null = unbounded.
const TIERS: CommissionTier[] = [
  { min_subtotal: 0, max_subtotal: 3000, rate: 0 },
  { min_subtotal: 3000, max_subtotal: 5000, rate: 0.025 },
  { min_subtotal: 5000, max_subtotal: 7500, rate: 0.05 },
  { min_subtotal: 7500, max_subtotal: 10000, rate: 0.075 },
  { min_subtotal: 10000, max_subtotal: null, rate: 0.1 },
]

// ---------------------------------------------------------------------------
// The cliff. This is the whole reason penny accuracy matters upstream.
// ---------------------------------------------------------------------------

test('THE CLIFF: one cent across a boundary is worth $187.50', () => {
  const below = commissionFor(7499.99, TIERS)
  const above = commissionFor(7500.0, TIERS)
  assert.equal(below.rate, 0.05)
  assert.equal(below.commission, 375.0)
  assert.equal(above.rate, 0.075)
  assert.equal(above.commission, 562.5)
  assert.equal(roundCents(above.commission - below.commission), 187.5)
})

test('the rate applies to the WHOLE subtotal, not just the excess', () => {
  // If this were a marginal bracket, $10,000 would earn far less than $1,000.
  assert.equal(commissionFor(10000, TIERS).commission, 1000)
})

test('Wyatt June 2026: the documented real case', () => {
  // Round 1 found attribution on invl.Slsm gave $7,324.62 (5%) and invh.Slsm1
  // gave $7,921.75 (7.5%). $594.13 is what was actually paid.
  assert.equal(commissionFor(7324.62, TIERS).commission, 366.23)
  const right = commissionFor(7921.75, TIERS)
  assert.equal(right.rate, 0.075)
  assert.equal(right.commission, 594.13)
})

// ---------------------------------------------------------------------------
// Boundaries and coverage
// ---------------------------------------------------------------------------

test('every boundary resolves to exactly one tier, half-open', () => {
  const cases: [number, number][] = [
    [0, 0], [2999.99, 0],
    [3000, 0.025], [4999.99, 0.025],
    [5000, 0.05], [7499.99, 0.05],
    [7500, 0.075], [9999.99, 0.075],
    [10000, 0.1], [250000, 0.1],
  ]
  for (const [subtotal, expected] of cases) {
    assert.equal(rateForSubtotal(subtotal, TIERS), expected, `subtotal ${subtotal}`)
  }
})

test('tiers are matched regardless of input order', () => {
  const shuffled = [TIERS[3], TIERS[0], TIERS[4], TIERS[2], TIERS[1]]
  assert.equal(rateForSubtotal(7500, shuffled), 0.075)
  assert.equal(rateForSubtotal(0, shuffled), 0)
})

test('a subtotal below every band returns no tier rather than a silent zero', () => {
  // A gapped table must be detectable. rateForSubtotal coerces to 0 for
  // callers that just want a number, but tierForSubtotal tells the truth.
  const gapped: CommissionTier[] = [{ min_subtotal: 3000, max_subtotal: null, rate: 0.1 }]
  assert.equal(tierForSubtotal(100, gapped), null)
  assert.equal(rateForSubtotal(100, gapped), 0)
})

test('a negative subtotal (credit memos exceeding invoices) pays nothing, not negative', () => {
  const r = commissionFor(-500, TIERS)
  assert.equal(r.rate, 0)
  assert.equal(r.commission, -0) // 0 rate => 0 dollars, sign is cosmetic
  assert.equal(Math.abs(r.commission), 0)
})

// ---------------------------------------------------------------------------
// Rate override
// ---------------------------------------------------------------------------

test('rate override REPLACES the tier lookup', () => {
  const r = commissionFor(2000, TIERS, 0.06)
  assert.equal(r.rate, 0.06)
  assert.equal(r.commission, 120) // would be $0 on the tier table
})

test('an override of 0 pays nothing even at a high subtotal', () => {
  // This is how a non-commissioned tech would be modelled if someone set an
  // override rather than clearing commission_eligible. 0 must not fall through
  // to the tier lookup via ??, which only guards null/undefined.
  const r = commissionFor(50000, TIERS, 0)
  assert.equal(r.rate, 0)
  assert.equal(r.commission, 0)
})

// ---------------------------------------------------------------------------
// Distance to next tier
// ---------------------------------------------------------------------------

test('distanceToNextTier reports the WHOLE-subtotal gain, not the marginal one', () => {
  const d = distanceToNextTier(7420, TIERS)
  assert.ok(d)
  assert.equal(d.threshold, 7500)
  assert.equal(d.amountAway, 80)
  assert.equal(d.nextRate, 0.075)
  // At 7420 x 5% = 371.00. At 7500 x 7.5% = 562.50. Gain = 191.50.
  // The marginal reading (80 x 7.5% = 6.00) would understate it 30x.
  assert.equal(d.gain, 191.5)
})

test('distanceToNextTier is null in the top tier', () => {
  assert.equal(distanceToNextTier(15000, TIERS), null)
})

test('distanceToNextTier is null exactly on a boundary', () => {
  // Already in the higher tier; the next one up is 10000.
  const d = distanceToNextTier(7500, TIERS)
  assert.ok(d)
  assert.equal(d.threshold, 10000)
  assert.equal(d.amountAway, 2500)
})

test('distanceToNextTier is null when an override governs', () => {
  assert.equal(distanceToNextTier(7420, TIERS, 0.06), null)
})

test('distanceToNextTier works from the zero-rate band', () => {
  const d = distanceToNextTier(2900, TIERS)
  assert.ok(d)
  assert.equal(d.amountAway, 100)
  assert.equal(d.nextRate, 0.025)
  assert.equal(d.gain, 75) // 3000 x 2.5% = 75, up from 0
})

// ---------------------------------------------------------------------------
// Rounding, which must match Postgres ROUND(numeric, 2)
// ---------------------------------------------------------------------------

test('roundCents matches Postgres: half away from zero', () => {
  assert.equal(roundCents(1.005), 1.01)
  assert.equal(roundCents(2.675), 2.68)
  assert.equal(roundCents(0.005), 0.01)
  // The negative half is where Math.round alone disagrees with Postgres.
  assert.equal(roundCents(-0.005), -0.01)
  assert.equal(roundCents(-1.005), -1.01)
  assert.equal(roundCents(-2.675), -2.68)
})

test('roundCents leaves exact cents untouched', () => {
  assert.equal(roundCents(594.13), 594.13)
  assert.equal(roundCents(0), 0)
  assert.equal(roundCents(-375), -375)
})

test('roundCents is defensive about non-finite input', () => {
  assert.equal(roundCents(NaN), 0)
  assert.equal(roundCents(Infinity), 0)
})

test('commission rounds to the cent, not to floating noise', () => {
  // 7921.75 * 0.075 = 594.13125
  assert.equal(commissionFor(7921.75, TIERS).commission, 594.13)
  // 3333.33 * 0.025 = 83.33325
  assert.equal(commissionFor(3333.33, TIERS).commission, 83.33)
})

test('formatRate renders tier rates readably', () => {
  assert.equal(formatRate(0), '0%')
  assert.equal(formatRate(0.025), '2.5%')
  assert.equal(formatRate(0.05), '5%')
  assert.equal(formatRate(0.075), '7.5%')
  assert.equal(formatRate(0.1), '10%')
})
