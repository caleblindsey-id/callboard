import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchesSearch } from './search'

test('an empty or whitespace-only query matches everything', () => {
  assert.equal(matchesSearch(['Acme Baking'], ''), true)
  assert.equal(matchesSearch(['Acme Baking'], '   '), true)
  // Including a row with nothing to match on.
  assert.equal(matchesSearch([null, undefined, ''], ''), true)
})

test('matching is case-insensitive substring, not whole-word', () => {
  assert.equal(matchesSearch(['Acme Baking Co'], 'acme'), true)
  assert.equal(matchesSearch(['Acme Baking Co'], 'BAK'), true)
  assert.equal(matchesSearch(['Acme Baking Co'], 'zebra'), false)
})

test('every token must match, but tokens may hit different parts', () => {
  const parts = ['Acme Baking Co', 'Hobart', 'HL600']
  assert.equal(matchesSearch(parts, 'acme hobart'), true)
  // Order is irrelevant — the parts are joined into one haystack.
  assert.equal(matchesSearch(parts, 'hobart acme'), true)
  // Extra whitespace between tokens is collapsed.
  assert.equal(matchesSearch(parts, '  acme   hl600 '), true)
  // One token missing fails the whole query.
  assert.equal(matchesSearch(parts, 'acme vulcan'), false)
})

test('numeric parts (WO#, account #) are searchable', () => {
  assert.equal(matchesSearch([10432, 'Acme Baking Co'], '10432'), true)
  assert.equal(matchesSearch([10432, 'Acme Baking Co'], '043'), true)
  assert.equal(matchesSearch([10432], '10433'), false)
})

test('null, undefined and blank parts are skipped, not joined as gaps', () => {
  // Without the filter these would join as "Acme  Co" and 'acme co' would miss.
  assert.equal(matchesSearch(['Acme', null, undefined, '', 'Co'], 'acme co'), true)
  assert.equal(matchesSearch([null, undefined], 'acme'), false)
})

test('a single token never spans two parts', () => {
  // Parts are joined with a space, so 'acmebaking' is not in the haystack even
  // though 'Acme' and 'Baking' are adjacent. Typed as two tokens it matches.
  assert.equal(matchesSearch(['Acme', 'Baking'], 'acmebaking'), false)
  assert.equal(matchesSearch(['Acme', 'Baking'], 'acme baking'), true)
})
