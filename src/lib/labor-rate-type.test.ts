import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LABOR_RATE_TYPES, isLaborRateType, resolveLaborRateType } from './labor-rate-type'

test('LABOR_RATE_TYPES matches the DB CHECK constraint', () => {
  assert.deepEqual([...LABOR_RATE_TYPES], ['standard', 'industrial', 'vacuum'])
})

test('isLaborRateType accepts every known type', () => {
  for (const t of LABOR_RATE_TYPES) {
    assert.equal(isLaborRateType(t), true, `${t} should be valid`)
  }
})

test('isLaborRateType rejects anything outside the set', () => {
  for (const v of ['', 'Industrial', 'INDUSTRIAL', 'commercial', 'standard ', null, undefined, 0, 1, {}, [], true]) {
    assert.equal(isLaborRateType(v), false, `${JSON.stringify(v)} should be rejected`)
  }
})

test('resolveLaborRateType prefers the submitted type', () => {
  assert.equal(resolveLaborRateType('industrial', 'standard'), 'industrial')
  assert.equal(resolveLaborRateType('vacuum', 'industrial'), 'vacuum')
})

test('resolveLaborRateType falls back to the stored type when nothing is submitted', () => {
  assert.equal(resolveLaborRateType(undefined, 'industrial'), 'industrial')
  assert.equal(resolveLaborRateType(null, 'vacuum'), 'vacuum')
})

test('resolveLaborRateType falls back to standard when both are missing', () => {
  assert.equal(resolveLaborRateType(undefined, null), 'standard')
  assert.equal(resolveLaborRateType(undefined, undefined), 'standard')
})

// A stored value that predates the CHECK constraint (or arrives from an
// untyped join) must not leak into the rate lookup as-is — getCustomerLaborRate
// silently falls back to the standard column for an unknown key, which would
// bill the wrong rate without any error surfacing.
test('resolveLaborRateType ignores an unrecognised stored value', () => {
  assert.equal(resolveLaborRateType(undefined, 'commercial'), 'standard')
})
