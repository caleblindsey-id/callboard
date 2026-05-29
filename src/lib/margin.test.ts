import { test } from 'node:test'
import assert from 'node:assert/strict'
import { minPrice, lineMarginOk, checkPartLines, MARGIN_FLOOR } from './margin'

test('MARGIN_FLOOR is 15%', () => {
  assert.equal(MARGIN_FLOOR, 0.15)
})

test('minPrice = cost / 0.85, rounded to cents', () => {
  assert.equal(minPrice(85), 100) // 85 / 0.85 = 100 exactly
  assert.equal(minPrice(100), 117.65) // 100 / 0.85 = 117.647 -> 117.65
  assert.equal(minPrice(10), 11.76) // 10 / 0.85 = 11.7647 -> 11.76
})

test('minPrice returns null for unknown / non-positive / non-finite cost', () => {
  assert.equal(minPrice(null), null)
  assert.equal(minPrice(undefined), null)
  assert.equal(minPrice(0), null)
  assert.equal(minPrice(-5), null)
  assert.equal(minPrice(Number.NaN), null)
})

test('lineMarginOk: exact-floor price passes', () => {
  const r = lineMarginOk(100, 85)
  assert.equal(r.ok, true)
  assert.equal(r.unknown, false)
  assert.equal(r.minPrice, 100)
})

test('lineMarginOk: above floor passes, below floor fails', () => {
  assert.equal(lineMarginOk(120, 85).ok, true)
  assert.equal(lineMarginOk(99.99, 85).ok, false)
  assert.equal(lineMarginOk(99.5, 85).ok, false)
})

test('lineMarginOk: unknown cost is allowed and flagged', () => {
  const r = lineMarginOk(5, null)
  assert.equal(r.ok, true)
  assert.equal(r.unknown, true)
  assert.equal(r.minPrice, null)
})

test('lineMarginOk: epsilon tolerates a penny rounding at the floor', () => {
  // cost 100 -> floor 117.65; submitting 117.65 must pass despite float math
  assert.equal(lineMarginOk(117.65, 100).ok, true)
  assert.equal(lineMarginOk(117.64, 100).ok, false)
})

test('checkPartLines: flags only known-cost violations, counts unknowns', () => {
  const costs: Record<number, number> = { 1: 85, 2: 100 }
  const lookup = (id: number) => costs[id] ?? null
  const lines = [
    { synergy_product_id: 1, description: 'Belt', unit_price: 90 }, // below floor 100
    { synergy_product_id: 2, description: 'Motor', unit_price: 200 }, // above floor 117.65
    { synergy_product_id: 999, description: 'Unsynced', unit_price: 1 }, // no cost -> unknown
    { synergy_product_id: null, description: 'Manual part', unit_price: 1 }, // manual -> unknown
  ]
  const res = checkPartLines(lines, lookup)
  assert.equal(res.ok, false)
  assert.equal(res.unknownCount, 2)
  assert.equal(res.violations.length, 1)
  assert.equal(res.violations[0].description, 'Belt')
  assert.equal(res.violations[0].minPrice, 100)
  assert.equal(res.violations[0].index, 0)
})

test('checkPartLines: all-clear when every known line meets floor', () => {
  const lookup = (id: number) => (id === 1 ? 85 : null)
  const res = checkPartLines(
    [{ synergy_product_id: 1, description: 'Belt', unit_price: 100 }],
    lookup,
  )
  assert.equal(res.ok, true)
  assert.equal(res.violations.length, 0)
  assert.equal(res.unknownCount, 0)
})
