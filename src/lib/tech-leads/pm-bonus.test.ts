import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  bonusRateForInterval,
  bonusAmountForInterval,
  bonusSuffixForInterval,
} from './pm-bonus'

// These pin the payout rules to the written commission plan and mirror
// supabase/migrations/151_tech_lead_four_month_75_percent.sql. If the trigger changes,
// these must change with it -- a preview that disagrees with the trigger means the tech
// is shown one number and paid another.
//
// The 4-month (75%) case is the reason this file exists: the plan has always paid 75%
// for 3 PMs a year, the code paid nothing, and nothing caught it for months.

test('4+ PMs a year (interval 1, 2, 3) earn the full flat rate', () => {
  assert.equal(bonusRateForInterval(1), 1)
  assert.equal(bonusRateForInterval(2), 1)
  assert.equal(bonusRateForInterval(3), 1)
})

test('3 PMs a year (interval 4) earns 75%', () => {
  assert.equal(bonusRateForInterval(4), 0.75)
})

test('2 PMs a year (interval 6) earns half', () => {
  assert.equal(bonusRateForInterval(6), 0.5)
})

test('annual (interval 12) earns nothing, per Caleb 2026-07-31', () => {
  assert.equal(bonusRateForInterval(12), 0)
})

test('intervals with no rule earn nothing', () => {
  assert.equal(bonusRateForInterval(5), 0)
  assert.equal(bonusRateForInterval(0), 0)
  assert.equal(bonusRateForInterval(-1), 0)
})

test('null and undefined intervals are ineligible', () => {
  assert.equal(bonusRateForInterval(null), 0)
  assert.equal(bonusRateForInterval(undefined), 0)
})

test('bonus amount applies the rate to the flat rate', () => {
  assert.equal(bonusAmountForInterval(3, 400), 400)
  assert.equal(bonusAmountForInterval(4, 400), 300)
  assert.equal(bonusAmountForInterval(6, 400), 200)
  assert.equal(bonusAmountForInterval(12, 400), 0)
})

test('bonus amount rounds half-up to the cent, matching Postgres ROUND(...,2)', () => {
  assert.equal(bonusAmountForInterval(4, 275), 206.25)
  // 166.66 * 0.75 = 124.995 -> 125.00 (half up, not banker's rounding)
  assert.equal(bonusAmountForInterval(4, 166.66), 125)
  // 100.01 * 0.5 = 50.005 -> 50.01
  assert.equal(bonusAmountForInterval(6, 100.01), 50.01)
})

test('bonus amount is 0 for a missing, zero, negative or non-finite flat rate', () => {
  assert.equal(bonusAmountForInterval(4, 0), 0)
  assert.equal(bonusAmountForInterval(4, -100), 0)
  assert.equal(bonusAmountForInterval(4, NaN), 0)
  assert.equal(bonusAmountForInterval(4, Infinity), 0)
})

test('each rate gets a distinct dropdown suffix so the picker cannot mislead', () => {
  assert.equal(bonusSuffixForInterval(3), '')
  assert.equal(bonusSuffixForInterval(4), ' — 75% bonus')
  assert.equal(bonusSuffixForInterval(6), ' — half bonus')
  assert.equal(bonusSuffixForInterval(12), ' — no bonus')
})
