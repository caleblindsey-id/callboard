import { test } from 'node:test'
import assert from 'node:assert/strict'
import { productDescriptionLines, productLabel } from './products-search'
import { partDescriptionLines, partLabel } from './parts'

// Real prod row (product 459006801). Synergy keeps two 30-char description
// fields; `products.description` is the joined form, and the item code the
// office keys on ("0576-36") lives at the head of Desc2 — i.e. at the TAIL of
// the joined string, which is what made it the first thing an ellipsis ate.
const DESC_1 = 'NCL SPIT SHINE BURNISH 12/32QT'
const DESC_2 = '0576-36 HI-SPEED KLEEN & BURNI'
const JOINED = `${DESC_1} ${DESC_2}`

test('productDescriptionLines splits a synced product into Desc1 + Desc2', () => {
  const lines = productDescriptionLines({
    description: JOINED,
    description_1: DESC_1,
    description_2: DESC_2,
  })
  assert.equal(lines.primary, DESC_1)
  assert.equal(lines.secondary, DESC_2)
})

test('productDescriptionLines falls back to the joined description before the first post-167 sync', () => {
  // description_1/description_2 are NULL until the updated sync runs. The Desc2
  // text must stay visible in that window — just not separately labeled.
  const lines = productDescriptionLines({
    description: JOINED,
    description_1: null,
    description_2: null,
  })
  assert.equal(lines.primary, JOINED)
  assert.equal(lines.secondary, null)
  assert.ok(lines.primary.includes('0576-36'), 'item code must remain visible')
})

test('productDescriptionLines yields no secondary line for a product with no Desc2', () => {
  const lines = productDescriptionLines({
    description: 'SQUEEZE TUBE FOR FRONT LOAD',
    description_1: 'SQUEEZE TUBE FOR FRONT LOAD',
    description_2: null,
  })
  assert.equal(lines.primary, 'SQUEEZE TUBE FOR FRONT LOAD')
  assert.equal(lines.secondary, null)
})

test('productDescriptionLines tolerates a blank Desc1 and missing fields', () => {
  assert.deepEqual(
    productDescriptionLines({ description: JOINED, description_1: '  ', description_2: DESC_2 }),
    { primary: JOINED, secondary: null }
  )
  assert.deepEqual(productDescriptionLines({}), { primary: '', secondary: null })
})

test('productLabel is byte-identical to the old `${number} - ${description}` snapshot', () => {
  // The stored part description is a billable line and is matched against
  // elsewhere, so switching to productLabel() must not change the string.
  const legacy = `761000207 - ${JOINED}`
  assert.equal(
    productLabel({ number: '761000207', description: JOINED, description_1: DESC_1, description_2: DESC_2 }),
    legacy
  )
  assert.equal(
    productLabel({ number: '761000207', description: JOINED, description_1: null, description_2: null }),
    legacy
  )
})

// ── Stored part lines (parts_requested / parts_used snapshots) ──

test('partDescriptionLines strips the Desc2 tail off the label instead of repeating it', () => {
  const part = { description: `761000207 - ${JOINED}`, description_2: DESC_2 }
  const lines = partDescriptionLines(part)
  assert.equal(lines.itemCode, DESC_2)
  assert.equal(lines.label, `761000207 - ${DESC_1}`)
  assert.ok(!lines.label.includes(DESC_2), 'Desc2 must not render twice')
})

test('partDescriptionLines keeps the detail suffix on the label, not the item code', () => {
  const part = { description: `761000207 - ${JOINED}`, description_2: DESC_2, detail: 'rags + degreaser' }
  const lines = partDescriptionLines(part)
  assert.equal(lines.label, `761000207 - ${DESC_1} — rags + degreaser`)
  assert.equal(lines.itemCode, DESC_2)
})

test('partDescriptionLines leaves pre-feature and manual lines exactly as partLabel had them', () => {
  for (const part of [
    { description: `761000207 - ${JOINED}` }, // saved before description_2 existed
    { description: 'shop rags, 3 boxes' }, // hand-typed manual line
    { description: 'shop rags', detail: 'blue' },
  ]) {
    const lines = partDescriptionLines(part)
    assert.equal(lines.itemCode, null)
    assert.equal(lines.label, partLabel(part))
  }
})

test('partDescriptionLines refuses to split when description no longer ends with Desc2', () => {
  // A hand-edited line: the snapshot drifted from the stored Desc2, so slicing
  // by length would corrupt the label. Fall back to showing it whole.
  const part = { description: '761000207 - SOMETHING ELSE ENTIRELY', description_2: DESC_2 }
  const lines = partDescriptionLines(part)
  assert.equal(lines.itemCode, null)
  assert.equal(lines.label, '761000207 - SOMETHING ELSE ENTIRELY')
})

test('partDescriptionLines keeps the line whole when Desc2 is the entire description', () => {
  const part = { description: DESC_2, description_2: DESC_2 }
  const lines = partDescriptionLines(part)
  assert.equal(lines.itemCode, null, 'no empty primary line')
  assert.equal(lines.label, DESC_2)
})
