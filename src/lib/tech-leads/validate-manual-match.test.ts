import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateManualMatch } from './validate-manual-match'

function body(overrides: Record<string, unknown> = {}) {
  return {
    synergy_order_number: 949635,
    synergy_order_date: '2026-06-01',
    tier: 'walk_behind_scrubber',
    ...overrides,
  }
}

test('accepts a valid manual match and snapshots the tier bonus', () => {
  const r = validateManualMatch(body())
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.fields.synergy_order_number, 949635)
  assert.equal(r.fields.synergy_order_date, '2026-06-01')
  assert.equal(r.fields.tier, 'walk_behind_scrubber')
  assert.equal(r.fields.bonus_amount, 100)
  assert.equal(r.fields.synergy_order_total, null)
})

test('coerces a numeric string order number and total', () => {
  const r = validateManualMatch(body({ synergy_order_number: ' 949635 ', synergy_order_total: '1499.99' }))
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.fields.synergy_order_number, 949635)
  assert.equal(r.fields.synergy_order_total, 1499.99)
})

test('rejects a non-integer / non-positive order number', () => {
  assert.equal(validateManualMatch(body({ synergy_order_number: 0 })).ok, false)
  assert.equal(validateManualMatch(body({ synergy_order_number: -5 })).ok, false)
  assert.equal(validateManualMatch(body({ synergy_order_number: 12.5 })).ok, false)
  assert.equal(validateManualMatch(body({ synergy_order_number: 'abc' })).ok, false)
})

test('rejects a missing or malformed order date', () => {
  assert.equal(validateManualMatch(body({ synergy_order_date: '' })).ok, false)
  assert.equal(validateManualMatch(body({ synergy_order_date: '06/01/2026' })).ok, false)
  assert.equal(validateManualMatch(body({ synergy_order_date: '2026-13-40' })).ok, false)
})

test('rejects an invalid tier', () => {
  assert.equal(validateManualMatch(body({ tier: 'nonsense' })).ok, false)
  assert.equal(validateManualMatch(body({ tier: undefined })).ok, false)
})

test('rejects a negative order total', () => {
  assert.equal(validateManualMatch(body({ synergy_order_total: -1 })).ok, false)
})
