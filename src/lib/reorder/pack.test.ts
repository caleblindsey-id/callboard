import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parsePackQty, roundUpToPack } from './pack'

test('parsePackQty: "12/CS" parses to 12', () => {
  assert.equal(parsePackQty('12/CS'), 12)
})

test('parsePackQty: "4/CS" parses to 4', () => {
  assert.equal(parsePackQty('4/CS'), 4)
})

test('parsePackQty: "6/CS" parses to 6', () => {
  assert.equal(parsePackQty('6/CS'), 6)
})

test('parsePackQty: "10EA/PK" parses to 10', () => {
  assert.equal(parsePackQty('10EA/PK'), 10)
})

test('parsePackQty: "EACH" falls back to 1', () => {
  assert.equal(parsePackQty('EACH'), 1)
})

test('parsePackQty: null falls back to 1', () => {
  assert.equal(parsePackQty(null), 1)
})

test('parsePackQty: unparseable string falls back to 1', () => {
  assert.equal(parsePackQty('garbage'), 1)
  assert.equal(parsePackQty(''), 1)
})

test('parsePackQty: never returns 0', () => {
  assert.notEqual(parsePackQty('0/CS'), 0)
  assert.equal(parsePackQty('0/CS'), 1)
})

test('roundUpToPack: 13 eaches, pack 12 -> 2 cases', () => {
  assert.equal(roundUpToPack(13, 12), 2)
})

test('roundUpToPack: exact multiple, 24 eaches pack 12 -> 2 cases', () => {
  assert.equal(roundUpToPack(24, 12), 2)
})

test('roundUpToPack: 1 each, pack 1 -> 1', () => {
  assert.equal(roundUpToPack(1, 1), 1)
})

test('roundUpToPack: falsy packQty treated as 1', () => {
  assert.equal(roundUpToPack(5, 0), 5)
})

test('roundUpToPack: negative eaches -> 0', () => {
  assert.equal(roundUpToPack(-5, 12), 0)
})

test('roundUpToPack: 0 eaches -> 0', () => {
  assert.equal(roundUpToPack(0, 12), 0)
})
