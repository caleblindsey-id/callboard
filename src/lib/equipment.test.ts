import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeSerial, serialsMatch, serialsNearMatch } from './equipment'

test('normalizeSerial trims and maps blank to null', () => {
  assert.equal(normalizeSerial('  ABC '), 'ABC')
  assert.equal(normalizeSerial(''), null)
  assert.equal(normalizeSerial('   '), null)
  assert.equal(normalizeSerial(null), null)
  assert.equal(normalizeSerial(undefined), null)
})

test('serialsMatch is exact (case/whitespace-insensitive) only', () => {
  assert.equal(serialsMatch('abc123', 'ABC123'), true)
  assert.equal(serialsMatch(' abc123 ', 'abc123'), true)
  assert.equal(serialsMatch('abc123', 'abc124'), false)
  assert.equal(serialsMatch(null, 'abc'), false)
  assert.equal(serialsMatch('abc', null), false)
})

// The feedback #18 case: customer 175 had two Windsor iScrub 20 records whose
// serials differed by one inserted digit. Exact matching (serialsMatch) missed
// it; near-match must catch it.
test('serialsNearMatch catches a single inserted character (feedback #18)', () => {
  assert.equal(serialsNearMatch('10061330001011', '100631330001011'), true)
})

test('serialsNearMatch catches single deletion / substitution', () => {
  assert.equal(serialsNearMatch('abc123', 'abc23'), true) // deletion
  assert.equal(serialsNearMatch('abc23', 'abc123'), true) // insertion (other order)
  assert.equal(serialsNearMatch('abc123', 'abc124'), true) // substitution
})

test('serialsNearMatch is true for exact (normalized) match', () => {
  assert.equal(serialsNearMatch(' ABC123 ', 'abc123'), true)
})

test('serialsNearMatch is false when more than one edit apart', () => {
  assert.equal(serialsNearMatch('abc123', 'abc1245'), false) // 2 inserts
  assert.equal(serialsNearMatch('abc123', 'axc124'), false) // 2 substitutions
  assert.equal(serialsNearMatch('123456', '654321'), false)
})

test('serialsNearMatch is false for null/blank operands', () => {
  assert.equal(serialsNearMatch(null, 'abc'), false)
  assert.equal(serialsNearMatch('abc', null), false)
  assert.equal(serialsNearMatch('', ''), false)
  assert.equal(serialsNearMatch('   ', 'abc'), false)
})

// Guard against a degenerate "everything is near everything" bug: two empty-ish
// short serials shouldn't collapse. A single char vs blank is one edit, but
// blank normalizes to null so it can't match.
test('serialsNearMatch does not treat unrelated short serials as near', () => {
  assert.equal(serialsNearMatch('A', 'Z'), true) // single substitution — by design
  assert.equal(serialsNearMatch('A', 'BC'), false) // 2 edits
})
