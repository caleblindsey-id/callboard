import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SHIPPING_METHODS,
  SHIPPING_NOTE_MAX_LEN,
  isShippingMethod,
  shippingMethodOf,
  shippingMethodLabel,
  shippingMethodShortLabel,
  isPriorityShipping,
  normalizeShippingCharge,
  shippingChargeAmount,
  normalizeShippingNote,
} from './shipping'

// ── shippingMethodOf / defaults ──
// The no-backfill promise: every part written before this feature has no
// shipping_method, and reading that absence as 'standard' is what lets the
// field ship without touching a single existing row.

test('shippingMethodOf defaults absent/null/undefined to standard', () => {
  assert.equal(shippingMethodOf(undefined), 'standard')
  assert.equal(shippingMethodOf(null), 'standard')
  assert.equal(shippingMethodOf({}), 'standard')
  assert.equal(shippingMethodOf({ shipping_method: null }), 'standard')
})

test('shippingMethodOf passes through every real method', () => {
  for (const m of SHIPPING_METHODS) {
    assert.equal(shippingMethodOf({ shipping_method: m }), m)
  }
})

test('shippingMethodOf falls back rather than throwing on garbage', () => {
  // A bad string on one row must not break the whole queue render.
  assert.equal(shippingMethodOf({ shipping_method: 'overnight-ish' }), 'standard')
  assert.equal(shippingMethodOf({ shipping_method: '' }), 'standard')
})

test('isShippingMethod narrows only real values', () => {
  assert.equal(isShippingMethod('next_day'), true)
  assert.equal(isShippingMethod('NEXT_DAY'), false)
  assert.equal(isShippingMethod(2), false)
  assert.equal(isShippingMethod(null), false)
})

// ── labels ──

test('labels are defined for every method and never leak the raw key', () => {
  for (const m of SHIPPING_METHODS) {
    const label = shippingMethodLabel(m)
    const short = shippingMethodShortLabel(m)
    assert.ok(label.length > 0)
    assert.ok(short.length > 0)
    assert.ok(!label.includes('_'), `label for ${m} leaked the enum key`)
    assert.ok(!short.includes('_'), `short label for ${m} leaked the enum key`)
  }
})

test('labels fall back to Standard for unknown input', () => {
  assert.equal(shippingMethodLabel('nonsense'), 'Standard')
  assert.equal(shippingMethodShortLabel(undefined), 'Standard')
})

// ── isPriorityShipping ──

test('isPriorityShipping is true only for faster-than-ground', () => {
  assert.equal(isPriorityShipping({ shipping_method: 'next_day' }), true)
  assert.equal(isPriorityShipping({ shipping_method: 'second_day' }), true)
  assert.equal(isPriorityShipping({ shipping_method: 'standard' }), false)
  // Absent must NOT badge — badging every row trains people to ignore it.
  assert.equal(isPriorityShipping({}), false)
  assert.equal(isPriorityShipping(null), false)
})

// ── normalizeShippingCharge ──

test('normalizeShippingCharge treats null/undefined/empty as "none charged"', () => {
  for (const v of [null, undefined, '']) {
    const r = normalizeShippingCharge(v)
    assert.equal(r.ok, true)
    assert.equal(r.ok && r.value, null)
  }
})

test('normalizeShippingCharge distinguishes an explicit 0 from null', () => {
  // 0 means "freight quoted, and it was free" — a real, deliberate statement.
  // null means nobody has answered the question. They must not collapse.
  const zero = normalizeShippingCharge(0)
  assert.equal(zero.ok, true)
  assert.equal(zero.ok && zero.value, 0)
})

test('normalizeShippingCharge accepts numeric strings from form inputs', () => {
  const r = normalizeShippingCharge(' 25.00 ')
  assert.equal(r.ok, true)
  assert.equal(r.ok && r.value, 25)
})

test('normalizeShippingCharge rounds to cents', () => {
  const r = normalizeShippingCharge(25.999)
  assert.equal(r.ok, true)
  assert.equal(r.ok && r.value, 26)
  const r2 = normalizeShippingCharge(12.344)
  assert.equal(r2.ok && r2.value, 12.34)
})

test('normalizeShippingCharge rejects negatives and non-numbers', () => {
  for (const bad of [-1, '-0.01', 'abc', NaN, Infinity, {}, []]) {
    const r = normalizeShippingCharge(bad)
    assert.equal(r.ok, false, `expected ${JSON.stringify(bad)} to be rejected`)
  }
})

test('normalizeShippingCharge error messages are customer-safe', () => {
  const r = normalizeShippingCharge(-5)
  assert.equal(r.ok, false)
  assert.ok(r.ok === false && r.error.length > 0)
})

// ── shippingChargeAmount ──

test('shippingChargeAmount collapses null to 0 so billing can add it blind', () => {
  assert.equal(shippingChargeAmount(null), 0)
  assert.equal(shippingChargeAmount(undefined), 0)
  assert.equal(shippingChargeAmount(0), 0)
  assert.equal(shippingChargeAmount(25), 25)
})

test('shippingChargeAmount never returns a negative or NaN into the total', () => {
  assert.equal(shippingChargeAmount(-10), 0)
  assert.equal(shippingChargeAmount(NaN), 0)
})

// ── normalizeShippingNote ──

test('normalizeShippingNote trims, drops empties, and clamps length', () => {
  assert.equal(normalizeShippingNote('  rush  '), 'rush')
  assert.equal(normalizeShippingNote('   '), undefined)
  assert.equal(normalizeShippingNote(''), undefined)
  assert.equal(normalizeShippingNote(null), undefined)
  assert.equal(normalizeShippingNote(42), undefined)
  const long = 'x'.repeat(SHIPPING_NOTE_MAX_LEN + 50)
  assert.equal(normalizeShippingNote(long)?.length, SHIPPING_NOTE_MAX_LEN)
})
