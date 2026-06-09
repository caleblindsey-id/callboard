import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compareValues } from './useSortableTable'

test('numbers compare numerically, not lexically', () => {
  assert.ok(compareValues(2, 10, 'asc') < 0)
  assert.ok(compareValues(10, 2, 'asc') > 0)
  assert.equal(compareValues(5, 5, 'asc'), 0)
})

test('strings use numeric-aware, case-insensitive compare', () => {
  // "WO-2" sorts before "WO-10" thanks to numeric collation
  assert.ok(compareValues('WO-2', 'WO-10', 'asc') < 0)
  // case-insensitive
  assert.equal(compareValues('acme', 'ACME', 'asc'), 0)
  assert.ok(compareValues('Apple', 'banana', 'asc') < 0)
})

test('desc reverses the ordering', () => {
  assert.ok(compareValues(2, 10, 'desc') > 0)
  assert.ok(compareValues('Apple', 'banana', 'desc') > 0)
})

test('null and undefined always sort last, regardless of direction', () => {
  // present value first, nullish last
  assert.ok(compareValues(5, null, 'asc') < 0)
  assert.ok(compareValues(null, 5, 'asc') > 0)
  assert.ok(compareValues('x', undefined, 'asc') < 0)
  assert.ok(compareValues(undefined, 'x', 'asc') < 0 === false)

  // desc does NOT float nulls to the top — they stay last
  assert.ok(compareValues(5, null, 'desc') < 0)
  assert.ok(compareValues(null, 5, 'desc') > 0)

  // two nullish values are equal
  assert.equal(compareValues(null, undefined, 'asc'), 0)
  assert.equal(compareValues(null, null, 'desc'), 0)
})
