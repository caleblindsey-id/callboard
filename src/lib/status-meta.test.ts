import { test } from 'node:test'
import assert from 'node:assert/strict'
import { STATUS_META, getStatusMeta } from './status-meta'

test('every (domain, status) has a nonempty label and classes', () => {
  for (const [domain, statuses] of Object.entries(STATUS_META)) {
    for (const [status, meta] of Object.entries(statuses)) {
      assert.ok(meta.label.length > 0, `${domain}.${status} has an empty label`)
      assert.ok(meta.classes.length > 0, `${domain}.${status} has empty classes`)
    }
  }
})

test('getStatusMeta resolves the same entry the raw map holds', () => {
  assert.deepEqual(getStatusMeta('service', 'estimated'), STATUS_META.service.estimated)
  assert.deepEqual(getStatusMeta('pm', 'billed'), STATUS_META.pm.billed)
})

test('getStatusMeta falls back gracefully for an unrecognized status', () => {
  // Cast past the type system the way a bad DB value would arrive at runtime.
  const meta = getStatusMeta('pm', 'not_a_real_status' as never)
  assert.equal(meta.label, 'Unknown')
})

// --- Cross-domain color unification (standard-draft dimensions 13 + 18) ---

test('in_progress is the same blue in every domain that has it', () => {
  assert.equal(STATUS_META.pm.in_progress.classes, STATUS_META.service.in_progress.classes)
})

test('completed is the same green in every domain that has it', () => {
  assert.equal(STATUS_META.pm.completed.classes, STATUS_META.service.completed.classes)
})

test('billed is the same purple in every domain that has it', () => {
  assert.equal(STATUS_META.pm.billed.classes, STATUS_META.service.billed.classes)
})

test('terminal-negative states use only the red (still-actionable) or gray (fully closed) tokens', () => {
  const RED = 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'
  const negativeButActionable = [STATUS_META.service.declined, STATUS_META.lead.rejected]
  for (const meta of negativeButActionable) {
    assert.equal(meta.classes, RED)
  }
  // Fully-closed states use a gray family (exact shade may vary by domain —
  // this only asserts "gray", not byte-identical, since pm/lead gray shades
  // pre-date this file and were left alone).
  const fullyClosed = [STATUS_META.pm.skipped, STATUS_META.service.canceled, STATUS_META.lead.cancelled]
  for (const meta of fullyClosed) {
    assert.match(meta.classes, /bg-gray-\d00/)
  }
})

// --- Canonical Round 4 label decisions baked into status-meta up front ---

test('service "estimated" reads as the canonical "Awaiting Approval"', () => {
  assert.equal(STATUS_META.service.estimated.label, 'Awaiting Approval')
})

test('lead pending/approved match the dashboard pipeline convention', () => {
  assert.equal(STATUS_META.lead.pending.label, 'Submitted')
  assert.equal(STATUS_META.lead.approved.label, 'Approved')
})

test('parts statuses use the canonical vocabulary', () => {
  assert.equal(STATUS_META.parts.pending_review.label, 'In Review')
  assert.equal(STATUS_META.parts.requested.label, 'Requested')
  assert.equal(STATUS_META.parts.ordered.label, 'Ordered')
  assert.equal(STATUS_META.parts.received.label, 'Received')
  assert.equal(STATUS_META.parts.from_stock.label, 'From Stock')
  assert.equal(STATUS_META.parts.pulled.label, 'Pulled')
})
