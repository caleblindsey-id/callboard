import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderValue, summarizeComplexDiff, summarizeComplexValue } from './format'

test('renderValue: primitives pass through unchanged', () => {
  assert.equal(renderValue('hello'), 'hello')
  assert.equal(renderValue(5), '5')
  assert.equal(renderValue(true), 'true')
  assert.equal(renderValue(false), 'false')
  assert.equal(renderValue(null), '—')
  assert.equal(renderValue(undefined), '—')
})

test('renderValue: strings over 80 chars still truncate at 77 + ellipsis', () => {
  const long = 'a'.repeat(90)
  const result = renderValue(long)
  assert.equal(result, 'a'.repeat(77) + '…')
  assert.equal(result.length, 78)
})

test('renderValue: strings at or under 80 chars are untouched', () => {
  const exact = 'a'.repeat(80)
  assert.equal(renderValue(exact), exact)
})

test('summarizeComplexDiff: parts array reports added, removed, and changed', () => {
  const oldParts = [
    { description: 'Vacuum Motor', quantity: 2, unit_price: 90, product_number: 'VM-9' },
    { description: 'Filter', quantity: 1, unit_price: 12, product_number: 'FTR-1' },
  ]
  const newParts = [
    { description: 'Filter', quantity: 2, unit_price: 14.5, product_number: 'FTR-1' },
    { description: 'Squeegee Blade', quantity: 1, unit_price: 8, product_number: 'TEN-222' },
    { description: 'Gasket', quantity: 3, unit_price: 5, product_number: 'GSK-2' },
  ]

  const summary = summarizeComplexDiff('parts_used', oldParts, newParts)

  assert.equal(summary.headline, '2 added, 1 removed, 1 changed')
  assert.ok(summary.lines.includes('+ 1x Squeegee Blade (TEN-222)'))
  assert.ok(summary.lines.includes('+ 3x Gasket (GSK-2)'))
  assert.ok(summary.lines.includes('- 2x Vacuum Motor'))
  assert.ok(summary.lines.includes('~ Filter: qty 1 -> 2, price $12.00 -> $14.50'))
})

test('summarizeComplexDiff: parts array with no changes reports "No changes"', () => {
  const parts = [{ description: 'Belt', quantity: 1, unit_price: 20, product_number: 'B-1' }]
  const summary = summarizeComplexDiff('estimate_parts', parts, [...parts])
  assert.equal(summary.headline, 'No changes')
  assert.deepEqual(summary.lines, [])
})

test('summarizeComplexDiff: known parts fields all use the same rich summarizer', () => {
  const known = ['parts_used', 'additional_parts_used', 'estimate_parts', 'parts_requested', 'items']
  for (const field of known) {
    const summary = summarizeComplexDiff(field, [], [{ description: 'Widget', quantity: 1 }])
    assert.equal(summary.headline, '1 added')
    assert.equal(summary.lines[0], '+ 1x Widget')
  }
})

test('summarizeComplexDiff: photos summarize as counts only, no detail lines', () => {
  const oldPhotos = [
    { storage_path: 'a.jpg', uploaded_at: '2026-01-01' },
    { storage_path: 'b.jpg', uploaded_at: '2026-01-01' },
  ]
  const newPhotos = [
    { storage_path: 'b.jpg', uploaded_at: '2026-01-01' },
    { storage_path: 'c.jpg', uploaded_at: '2026-01-02' },
    { storage_path: 'd.jpg', uploaded_at: '2026-01-02' },
  ]

  const summary = summarizeComplexDiff('photos', oldPhotos, newPhotos)

  assert.equal(summary.headline, '2 added, 1 removed')
  assert.deepEqual(summary.lines, [])
})

test('summarizeComplexValue: photos on an insert row summarize as a plain count', () => {
  const summary = summarizeComplexValue('photos', [
    { storage_path: 'a.jpg', uploaded_at: '2026-01-01' },
  ])
  assert.equal(summary.headline, '1 photo')
  assert.deepEqual(summary.lines, [])
})

test('summarizeComplexDiff: unknown object gets a shallow field-name summary, never raw JSON', () => {
  const oldVal = { status: 'open', qty: 1, price: 10, note: 'x' }
  const newVal = { status: 'closed', qty: 2, price: 12, note: 'x' }

  const summary = summarizeComplexDiff('context', oldVal, newVal)

  assert.equal(summary.headline, '3 fields changed: status, qty, price')
  assert.deepEqual(summary.lines, [])
  assert.ok(!summary.headline.includes('{'), 'must never fall back to raw JSON.stringify')
})

test('summarizeComplexDiff: unknown array collapses to a bare item count', () => {
  const summary = summarizeComplexDiff('tags', ['a', 'b'], ['a', 'b', 'c'])
  assert.equal(summary.headline, '[3 items]')
  assert.deepEqual(summary.lines, [])
})

test('summarizeComplexValue: unknown array on insert/delete also collapses to a count', () => {
  const summary = summarizeComplexValue('tags', ['a', 'b', 'c'])
  assert.equal(summary.headline, '[3 items]')
})
