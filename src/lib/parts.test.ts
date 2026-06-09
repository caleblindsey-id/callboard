import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateNewManualPartRequests, hasNewRequestedPart } from './parts'
import type { PartRequest } from '../types/database'

// Helper: a fully-valid new manual request entry.
function manual(over: Partial<PartRequest> = {}): PartRequest {
  return {
    description: 'Drive belt',
    quantity: 1,
    vendor: 'Grainger',
    vendor_item_code: 'AB-123',
    unit_price: 42.5,
    // New requests now enter the office Review step as 'pending_review' — the
    // status the field-validators gate on.
    status: 'pending_review',
    requested_at: '2026-06-02T10:00:00.000Z',
    ...over,
  }
}

// ── validateNewManualPartRequests ──

test('passes when a new manual request has all required fields', () => {
  assert.equal(validateNewManualPartRequests([], [manual()]), null)
})

test('rejects a new manual request missing vendor', () => {
  assert.match(
    validateNewManualPartRequests([], [manual({ vendor: '' })]) ?? '',
    /vendor name/i,
  )
})

test('rejects a new manual request missing vendor part #', () => {
  assert.match(
    validateNewManualPartRequests([], [manual({ vendor_item_code: undefined })]) ?? '',
    /vendor part/i,
  )
})

test('rejects a new manual request with no price', () => {
  assert.match(
    validateNewManualPartRequests([], [manual({ unit_price: undefined })]) ?? '',
    /price/i,
  )
})

test('allows an explicit $0 price (warranty)', () => {
  assert.equal(validateNewManualPartRequests([], [manual({ unit_price: 0 })]), null)
})

test('exempts catalog parts (synergy_product_id set) from the required fields', () => {
  const catalog = manual({
    synergy_product_id: 555,
    vendor: undefined,
    vendor_item_code: undefined,
    unit_price: undefined,
  })
  assert.equal(validateNewManualPartRequests([], [catalog]), null)
})

test('skips legacy rows that have no requested_at', () => {
  const legacy = manual({ requested_at: undefined, vendor: undefined, vendor_item_code: undefined })
  assert.equal(validateNewManualPartRequests([], [legacy]), null)
})

test('does not re-validate a part already present in the stored array', () => {
  // A status change on an existing (pre-feature) manual part must not hard-fail.
  const stored = manual({ vendor: undefined, vendor_item_code: undefined, unit_price: undefined })
  const advanced = { ...stored, status: 'ordered' as const }
  assert.equal(validateNewManualPartRequests([stored], [advanced]), null)
})

test('only gates entries with status pending_review', () => {
  const ordered = manual({ status: 'ordered', vendor: undefined, requested_at: '2026-06-02T11:00:00.000Z' })
  assert.equal(validateNewManualPartRequests([], [ordered]), null)
})

// ── hasNewRequestedPart ──

test('detects a brand-new requested entry', () => {
  assert.equal(hasNewRequestedPart([], [manual()]), true)
})

test('returns false when the only requested entry is already stored', () => {
  const stored = manual()
  assert.equal(hasNewRequestedPart([stored], [stored]), false)
})

test('returns false for a legacy entry with no requested_at', () => {
  assert.equal(hasNewRequestedPart([], [manual({ requested_at: undefined })]), false)
})

test('returns false when a stored part merely changes status', () => {
  const stored = manual()
  const advanced = { ...stored, status: 'ordered' as const }
  assert.equal(hasNewRequestedPart([stored], [advanced]), false)
})
