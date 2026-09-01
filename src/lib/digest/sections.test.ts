import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SECTIONS, OWNER_BLOCKS, TOP_N } from './sections'
import { KEY_PREFIXES } from './types'

test('all seventeen sections are registered', () => {
  assert.equal(SECTIONS.length, 17)
})

test('section keys are unique', () => {
  const keys = SECTIONS.map((s) => s.key)
  assert.equal(new Set(keys).size, keys.length)
})

// The dedupe reads row prefixes and nothing throws when they are wrong, so a
// section registered without one silently corrupts the headline count.
test('every section declares at least one known key prefix', () => {
  for (const s of SECTIONS) {
    assert.ok(s.keyPrefixes.length > 0, `${s.key} declares no key prefix`)
    for (const p of s.keyPrefixes) {
      assert.ok(KEY_PREFIXES.includes(p), `${s.key} declares unknown prefix ${p}`)
    }
  }
})

test('every section belongs to a rendered owner block', () => {
  const owners = new Set(OWNER_BLOCKS.map((b) => b.owner))
  for (const s of SECTIONS) {
    assert.ok(owners.has(s.owner), `${s.key} has owner ${s.owner} with no block to render it`)
  }
})

test('every owner block has at least one section', () => {
  for (const b of OWNER_BLOCKS) {
    assert.ok(
      SECTIONS.some((s) => s.owner === b.owner),
      `owner block ${b.owner} would render empty`
    )
  }
})

test('no dashes in any section title or action', () => {
  for (const s of SECTIONS) {
    for (const copy of [s.title, s.action]) {
      assert.ok(!copy.includes('—') && !copy.includes('–'), `${s.key}: "${copy}" contains a dash`)
    }
  }
})

test('every section has an app-relative deep link', () => {
  for (const s of SECTIONS) {
    assert.ok(s.viewAllPath.startsWith('/'), `${s.key} viewAllPath must be app-relative`)
  }
})

test('every section is wired to a real fetch function', () => {
  for (const s of SECTIONS) {
    assert.equal(typeof s.fetch, 'function', `${s.key} has no fetch`)
  }
})

test('ready_to_bill, not_entered_synergy, po_gated and credit_blocked are the mixed-entity sections', () => {
  // The Billing Chase worklist (migration 163) spans both ticket types, so
  // both digest sections built on it are mixed alongside the pre-existing
  // ready_to_bill. credit_blocked (feedback #75) is mixed for the same reason:
  // a credit review gates either a PM or a service order, and its row must key
  // on the gated ticket so the headline count dedupes against the sections that
  // already list that ticket.
  const mixed = SECTIONS.filter((s) => s.keyPrefixes.length > 1).map((s) => s.key)
  assert.deepEqual(mixed, ['ready_to_bill', 'not_entered_synergy', 'po_gated', 'credit_blocked'])
})

test('TOP_N matches the Python original', () => {
  assert.equal(TOP_N, 5)
})
