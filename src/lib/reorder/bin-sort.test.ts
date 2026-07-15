import { test } from 'node:test'
import assert from 'node:assert/strict'
import { binSortKey } from './bin-sort'

// Whse-4 bin format (confirmed in the design spec): zone letter + bay number,
// e.g. "E5", "W1", with dash-suffixed overflow "E5-D". Real samples from
// discovery: E5, W1, F2, H2, E5-D, E5-C, E7, SR.

test('binSortKey: "E5" -> zero-padded zone|bay|', () => {
  assert.equal(binSortKey('E5'), 'E|005|')
})

test('binSortKey: "W1"', () => {
  assert.equal(binSortKey('W1'), 'W|001|')
})

test('binSortKey: "F2"', () => {
  assert.equal(binSortKey('F2'), 'F|002|')
})

test('binSortKey: "H2"', () => {
  assert.equal(binSortKey('H2'), 'H|002|')
})

test('binSortKey: "E5-D" overflow suffix appended after the bay', () => {
  assert.equal(binSortKey('E5-D'), 'E|005|D')
})

test('binSortKey: "E5-C" overflow suffix', () => {
  assert.equal(binSortKey('E5-C'), 'E|005|C')
})

test('binSortKey: "E7"', () => {
  assert.equal(binSortKey('E7'), 'E|007|')
})

test('binSortKey: "SR" (no bay number) sorts last', () => {
  const key = binSortKey('SR')
  const validKey = binSortKey('E5')
  assert.ok(key > validKey, `expected "SR" key (${key}) to sort after a valid key (${validKey})`)
})

test('binSortKey: null sorts last', () => {
  const key = binSortKey(null)
  const validKey = binSortKey('E5')
  assert.ok(key > validKey, `expected null key (${key}) to sort after a valid key (${validKey})`)
})

test('binSortKey: empty string sorts last', () => {
  const key = binSortKey('')
  const validKey = binSortKey('E5')
  assert.ok(key > validKey)
})

test('binSortKey: zero-padding makes "E5" sort before "E10"', () => {
  assert.ok(binSortKey('E5') < binSortKey('E10'), 'E5 must sort before E10')
})

test('binSortKey: primary bin sorts before its own overflow suffix', () => {
  assert.ok(binSortKey('E5') < binSortKey('E5-D'), 'E5 (primary) must sort before E5-D (overflow)')
})
