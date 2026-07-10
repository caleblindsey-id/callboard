import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  validateNewManualPartRequests,
  hasNewRequestedPart,
  findPartMissingSynergyItemNumber,
  partsAwaitingReview,
} from './parts'
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

// ── findPartMissingSynergyItemNumber ──
// A Synergy item # (product_number) is only mandatory once a part is being
// ordered or has been received. New requests (pending_review) and queued
// 'requested' parts may not have one yet, and 'from_stock' parts are pulled
// in-house. Regression guard for feedback #30: a new manual part with no
// product_number must NOT be rejected on request.

test('does not flag a new manual part (pending_review, no item #) — feedback #30', () => {
  assert.equal(findPartMissingSynergyItemNumber([manual()]), undefined)
})

test('does not flag a queued requested part with no item #', () => {
  assert.equal(
    findPartMissingSynergyItemNumber([manual({ status: 'requested' })]),
    undefined,
  )
})

test('does not flag a from_stock part with no item #', () => {
  assert.equal(
    findPartMissingSynergyItemNumber([manual({ status: 'from_stock' })]),
    undefined,
  )
})

test('flags an ordered part missing its Synergy item #', () => {
  const part = manual({ status: 'ordered' })
  assert.equal(findPartMissingSynergyItemNumber([part]), part)
})

test('flags a received part missing its Synergy item #', () => {
  const part = manual({ status: 'received' })
  assert.equal(findPartMissingSynergyItemNumber([part]), part)
})

test('does not flag an ordered part that has a Synergy item #', () => {
  assert.equal(
    findPartMissingSynergyItemNumber([manual({ status: 'ordered', product_number: '146400019' })]),
    undefined,
  )
})

test('treats a whitespace-only item # as missing on an ordered part', () => {
  const part = manual({ status: 'ordered', product_number: '   ' })
  assert.equal(findPartMissingSynergyItemNumber([part]), part)
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

// ── partsAwaitingReview ──
// Gates service-ticket completion: a live pending_review part blocks; anything
// past triage (requested/ordered/received/from_stock) or cancelled does not.

test('flags a live pending_review part', () => {
  const part = manual({ status: 'pending_review' })
  assert.deepEqual(partsAwaitingReview([part]), [part])
})

test('a cancelled pending_review part does not block (the ghost-row case)', () => {
  const part = manual({ status: 'pending_review', cancelled: true })
  assert.deepEqual(partsAwaitingReview([part]), [])
})

test('an ordered part does not block completion', () => {
  assert.deepEqual(partsAwaitingReview([manual({ status: 'ordered' })]), [])
})

test('a requested part does not block completion', () => {
  assert.deepEqual(partsAwaitingReview([manual({ status: 'requested' })]), [])
})

test('a received part does not block completion', () => {
  assert.deepEqual(partsAwaitingReview([manual({ status: 'received' })]), [])
})

test('handles null / empty parts', () => {
  assert.deepEqual(partsAwaitingReview(null), [])
  assert.deepEqual(partsAwaitingReview([]), [])
})

test('returns only the pending_review parts from a mixed array', () => {
  const review = manual({ status: 'pending_review', requested_at: '2026-06-02T12:00:00.000Z' })
  const parts = [
    manual({ status: 'received' }),
    review,
    manual({ status: 'pending_review', cancelled: true }),
    manual({ status: 'ordered' }),
  ]
  assert.deepEqual(partsAwaitingReview(parts), [review])
})
