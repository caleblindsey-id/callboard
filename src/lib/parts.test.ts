import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  validateNewManualPartRequests,
  hasNewRequestedPart,
  findPartMissingSynergyItemNumber,
  partsAwaitingReview,
  partsOnOrder,
  partsAllFulfilled,
  isPartOutstanding,
  fulfilledRequestedParts,
  partsMissingFromWorkOrder,
  requestToUsedLine,
  isCoveredByAgreement,
  workOrderAutoAddPatch,
} from './parts'
import type { PartRequest, PartUsed } from '../types/database'

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

// ── fulfilledRequestedParts ──

test('fulfilledRequestedParts keeps received and from_stock, drops the rest', () => {
  const received = manual({ status: 'received' })
  const fromStock = manual({ status: 'from_stock' })
  const parts: PartRequest[] = [
    received,
    fromStock,
    manual({ status: 'pending_review' }),
    manual({ status: 'requested' }),
    manual({ status: 'ordered' }),
    manual({ status: 'received', cancelled: true }),
  ]
  assert.deepEqual(fulfilledRequestedParts(parts), [received, fromStock])
})

test('fulfilledRequestedParts counts a from_stock part before it is pulled', () => {
  // Looser than isPartStagedReady on purpose: billing cares that we committed
  // the part, not that someone has walked to the bin yet.
  const part = manual({ status: 'from_stock', pulled_at: undefined })
  assert.deepEqual(fulfilledRequestedParts([part]), [part])
})

// ── isPartOutstanding ──

test('isPartOutstanding judges a bare parts_order_queue row, not just a PartRequest', () => {
  // The structural signature is the point: the board's chip counts view rows
  // while the detail page counts JSONB entries, and one rule has to serve both.
  assert.equal(isPartOutstanding({ status: 'ordered', cancelled: false }), true)
  assert.equal(isPartOutstanding({ status: 'received', cancelled: false }), false)
  assert.equal(isPartOutstanding({ status: 'from_stock', cancelled: false }), false)
  assert.equal(isPartOutstanding({ status: 'ordered', cancelled: true }), false)
})

// ── partsAllFulfilled (the parts_received column + the board's ready signal) ──

test('every live part received means nothing outstanding', () => {
  assert.equal(
    partsAllFulfilled([manual({ status: 'received' }), manual({ status: 'received' })]),
    true,
  )
})

test('a from_stock part counts as fulfilled — the drift feedback #79 fixed', () => {
  // api/service-tickets/[id] used to require 'received' here while
  // api/parts-queue/update also accepted 'from_stock', so triaging a part to
  // pull-from-stock set the column from one route and cleared it from the other.
  assert.equal(partsAllFulfilled([manual({ status: 'from_stock' })]), true)
  assert.equal(
    partsAllFulfilled([manual({ status: 'received' }), manual({ status: 'from_stock' })]),
    true,
  )
})

test('an all-cancelled ticket has nothing left to wait for', () => {
  // The old derivation required live.length > 0, which pinned these at false
  // forever — the ticket sat in "waiting on parts" with no live part in sight.
  assert.equal(
    partsAllFulfilled([
      manual({ status: 'ordered', cancelled: true }),
      manual({ status: 'pending_review', cancelled: true }),
    ]),
    true,
  )
})

test('a cancelled part does not hold back an otherwise-fulfilled ticket', () => {
  assert.equal(
    partsAllFulfilled([
      manual({ status: 'received' }),
      manual({ status: 'ordered', cancelled: true }),
    ]),
    true,
  )
})

test('one live part still in flight blocks, at every pre-fulfilment status', () => {
  for (const status of ['pending_review', 'requested', 'ordered'] as const) {
    assert.equal(
      partsAllFulfilled([manual({ status: 'received' }), manual({ status })]),
      false,
      `${status} should still count as outstanding`,
    )
  }
})

test('no parts at all is vacuously fulfilled', () => {
  // Deliberate. Callers that must tell "nothing outstanding" apart from "no parts
  // ever" check the array themselves — the board does, via OR parts_requested = '[]'.
  assert.equal(partsAllFulfilled([]), true)
  assert.equal(partsAllFulfilled(null), true)
  assert.equal(partsAllFulfilled(undefined), true)
})

test('partsAllFulfilled is the exact complement of partsOnOrder', () => {
  // Not a tautology worth deleting: it is the invariant that lets the detail
  // page's Start Work gate (partsOnOrder-based) and the board's readiness chip
  // (parts_received-based) claim the same thing about the same ticket.
  const cases: PartRequest[][] = [
    [],
    [manual({ status: 'received' })],
    [manual({ status: 'from_stock' })],
    [manual({ status: 'ordered' })],
    [manual({ status: 'received' }), manual({ status: 'requested' })],
    [manual({ status: 'ordered', cancelled: true })],
  ]
  for (const parts of cases) {
    assert.equal(partsAllFulfilled(parts), partsOnOrder(parts).length === 0)
  }
})

// ── partsMissingFromWorkOrder ──

function used(over: Partial<PartUsed> = {}): PartUsed {
  return {
    synergy_product_id: null,
    quantity: 1,
    description: 'Drive belt',
    unit_price: 42.5,
    ...over,
  }
}

test('a fulfilled part with no work-order line at all is missing', () => {
  const part = manual({ status: 'received' })
  assert.deepEqual(partsMissingFromWorkOrder([part], []), [part])
})

test('an unfulfilled part is never reported missing', () => {
  assert.deepEqual(partsMissingFromWorkOrder([manual({ status: 'ordered' })], []), [])
})

test('from_request_at is an exact match even when the description was rewritten', () => {
  const part = manual({ status: 'received', requested_at: '2026-07-01T00:00:00.000Z' })
  const line = used({ description: 'totally different text', from_request_at: '2026-07-01T00:00:00.000Z' })
  assert.deepEqual(partsMissingFromWorkOrder([part], [line]), [])
})

test('from_request_at belonging to a different request does not match', () => {
  const part = manual({ status: 'received', requested_at: '2026-07-01T00:00:00.000Z' })
  const line = used({ description: 'unrelated', from_request_at: '2026-07-09T00:00:00.000Z' })
  assert.deepEqual(partsMissingFromWorkOrder([part], [line]), [part])
})

test('matches on synergy_product_id when descriptions differ', () => {
  const part = manual({ status: 'received', synergy_product_id: 761232807, description: 'PAD DRIVER 20"' })
  const line = used({ synergy_product_id: 761232807, description: 'pad driver' })
  assert.deepEqual(partsMissingFromWorkOrder([part], [line]), [])
})

test('matches when the Synergy item # appears inside the work-order description', () => {
  // Real prod shape: request "761000245 - GASKET, FLOAT", WO line "761000245".
  const part = manual({ status: 'received', product_number: '761000245', description: 'GASKET, FLOAT' })
  const line = used({ description: '761000245 - GASKET, FLOAT 600157' })
  assert.deepEqual(partsMissingFromWorkOrder([part], [line]), [])
})

test('matches across punctuation and case drift in the description', () => {
  // " KTRI05840 FILTER KIT" (leading space) vs "KTRI05840 FILTER KIT".
  const part = manual({ status: 'received', description: 'KTRI05840 FILTER KIT' })
  const line = used({ description: ' KTRI05840 FILTER KIT' })
  assert.deepEqual(partsMissingFromWorkOrder([part], [line]), [])
})

test('an unrelated work-order line does not satisfy a fulfilled part', () => {
  // Real prod case: WO 662 requested a nozzle motor, only a HEPA filter was billed.
  const part = manual({ status: 'received', description: 'NOZZLE MOTOR 104506' })
  const line = used({ description: 'HEPA FILTER, CARTRIDGE 107005' })
  assert.deepEqual(partsMissingFromWorkOrder([part], [line]), [part])
})

test('searches every array it is given (PM covered + additional)', () => {
  const part = manual({ status: 'received', synergy_product_id: 999 })
  const line = used({ synergy_product_id: 999 })
  assert.deepEqual(partsMissingFromWorkOrder([part], [], [line]), [])
  assert.deepEqual(partsMissingFromWorkOrder([part], null, undefined), [part])
})

test('a part marked not-used is suppressed rather than reported missing', () => {
  const part = manual({ status: 'received', wo_excluded_at: '2026-07-20T00:00:00.000Z' })
  assert.deepEqual(partsMissingFromWorkOrder([part], []), [])
})

test('a very short description does not fuzzy-match everything', () => {
  // Guard against the matcher silently swallowing real misses: "nut" must not
  // be considered present just because some other line contains those letters.
  const part = manual({ status: 'received', description: 'nut', product_number: undefined })
  const line = used({ description: 'Magnetic hub ring assembly' })
  assert.deepEqual(partsMissingFromWorkOrder([part], [line]), [part])
})

// ── requestToUsedLine ──

test('requestToUsedLine prefers the live catalog price over the stale request price', () => {
  const part = manual({ status: 'received', unit_price: 68.2 })
  assert.equal(requestToUsedLine(part, { unit_price: 75.02 }).unit_price, 75.02)
})

test('requestToUsedLine keeps the request price for an off-catalog part', () => {
  // Manual parts have no catalog row; the tech-captured price is the only one
  // that exists, and dropping it would silently bill the part at $0.
  const part = manual({ status: 'received', unit_price: 42.5 })
  assert.equal(requestToUsedLine(part, null).unit_price, 42.5)
  assert.equal(requestToUsedLine(part, { unit_price: null }).unit_price, 42.5)
})

test('requestToUsedLine stamps the link and carries sourcing fields', () => {
  const part = manual({
    status: 'received',
    requested_at: '2026-07-01T00:00:00.000Z',
    product_number: '761000245',
    vendor: 'TENNANT COMPANY',
    vendor_code: '761',
    vendor_item_code: '4035503',
  })
  const line = requestToUsedLine(part)
  assert.equal(line.from_request_at, '2026-07-01T00:00:00.000Z')
  assert.equal(line.product_number, '761000245')
  assert.equal(line.vendor, 'TENNANT COMPANY')
  assert.equal(line.vendor_code, '761')
  assert.equal(line.vendor_item_code, '4035503')
})

test('a line built by requestToUsedLine is never re-reported as missing', () => {
  // The round-trip that matters: auto-add writes this line, the banner must
  // then go quiet.
  const part = manual({ status: 'received' })
  assert.deepEqual(partsMissingFromWorkOrder([part], [requestToUsedLine(part)]), [])
})

// ── isCoveredByAgreement ──

test('isCoveredByAgreement treats an unset legacy flag as billable', () => {
  assert.equal(isCoveredByAgreement(manual({ covered_by_agreement: true })), true)
  assert.equal(isCoveredByAgreement(manual({ covered_by_agreement: false })), false)
  assert.equal(isCoveredByAgreement(manual({ covered_by_agreement: undefined })), false)
})

// ── workOrderAutoAddPatch (the auto-add decision the parts-queue route makes) ──

function autoAdd(over: Record<string, unknown> = {}) {
  return workOrderAutoAddPatch({
    source: 'service',
    action: 'mark_received',
    part: manual({ status: 'received' }),
    existingUsed: [],
    ...over,
  } as Parameters<typeof workOrderAutoAddPatch>[0])
}

test('receiving a service part puts it on parts_used', () => {
  const r = autoAdd()
  assert.equal(r?.column, 'parts_used')
  assert.equal(r?.value.length, 1)
  assert.equal(r?.line.description, 'Drive belt')
})

test('marking a pulled stock part puts it on the work order', () => {
  const r = autoAdd({
    action: 'mark_pulled',
    part: manual({ status: 'from_stock', pulled_at: '2026-07-27T00:00:00.000Z' }),
  })
  assert.equal(r?.column, 'parts_used')
})

test('a from_stock part not yet pulled off the shelf is NOT added', () => {
  // pull_from_stock is only the office triage decision; nobody has walked to
  // the bin. Adding here would bill a part still sitting in Whse 4.
  assert.equal(
    autoAdd({ action: 'pull_from_stock', part: manual({ status: 'from_stock' }) }),
    null,
  )
})

test('non-fulfilling actions never add a line', () => {
  for (const action of ['mark_ordered', 'patch', 'cancel', 'reopen', 'mark_collected', 'order']) {
    assert.equal(autoAdd({ action }), null, `${action} must not add a work-order line`)
  }
})

test('patching an already-received part does not resurrect a deleted line', () => {
  // The regression this scoping prevents: office edits a PO number on a
  // received part whose line the tech deliberately removed.
  assert.equal(autoAdd({ action: 'patch', part: manual({ status: 'received' }) }), null)
})

test('re-firing mark_received does not duplicate the line', () => {
  const part = manual({ status: 'received' })
  const first = autoAdd({ part })
  assert.equal(first?.value.length, 1)
  const second = autoAdd({ part, existingUsed: first!.value })
  assert.equal(second, null)
})

test('does not duplicate a line the tech already typed by hand', () => {
  const part = manual({ status: 'received', description: 'Drive belt' })
  const handTyped = used({ description: 'drive belt', quantity: 1, unit_price: 40 })
  assert.equal(autoAdd({ part, existingUsed: [handTyped] }), null)
})

test('a part marked not-used is never auto-added', () => {
  const part = manual({ status: 'received', wo_excluded_at: '2026-07-20T00:00:00.000Z' })
  assert.equal(autoAdd({ part }), null)
})

test('PM covered part goes to parts_used, billable goes to additional_parts_used', () => {
  const covered = autoAdd({
    source: 'pm',
    part: manual({ status: 'received', covered_by_agreement: true }),
    existingUsed: [used({ description: 'PM kit blade' })],
    existingAdditional: [],
  })
  assert.equal(covered?.column, 'parts_used')
  assert.equal(covered?.value.length, 2, 'appends to the kit, does not replace it')

  const billable = autoAdd({
    source: 'pm',
    part: manual({ status: 'received', covered_by_agreement: false }),
    existingUsed: [used({ description: 'PM kit blade' })],
    existingAdditional: [],
  })
  assert.equal(billable?.column, 'additional_parts_used')
  assert.equal(billable?.value.length, 1)
})

test('a PM part with no coverage pick lands in the billable array', () => {
  // Legacy rows must surface for review, not silently go out at $0.
  const r = autoAdd({
    source: 'pm',
    part: manual({ status: 'received', covered_by_agreement: undefined }),
    existingUsed: [],
    existingAdditional: [],
  })
  assert.equal(r?.column, 'additional_parts_used')
})

test('a PM part already on the covered array is not re-added to the billable one', () => {
  // Cross-array dedupe: PM must search BOTH arrays or a covered part gets a
  // second billable line.
  const part = manual({ status: 'received', synergy_product_id: 555, covered_by_agreement: false })
  const r = autoAdd({
    source: 'pm',
    part,
    existingUsed: [used({ synergy_product_id: 555 })],
    existingAdditional: [],
  })
  assert.equal(r, null)
})

test('the auto-added line re-prices off the catalog', () => {
  const r = autoAdd({
    part: manual({ status: 'received', unit_price: 68.2 }),
    catalog: { unit_price: 75.02 },
  })
  assert.equal(r?.line.unit_price, 75.02)
})

test('the auto-added line carries the request link so the banner goes quiet', () => {
  const part = manual({ status: 'received', requested_at: '2026-07-27T12:00:00.000Z' })
  const r = autoAdd({ part })
  assert.equal(r?.line.from_request_at, '2026-07-27T12:00:00.000Z')
  assert.deepEqual(partsMissingFromWorkOrder([part], r!.value), [])
})
