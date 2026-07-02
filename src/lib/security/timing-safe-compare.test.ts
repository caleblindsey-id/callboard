import { test } from 'node:test'
import assert from 'node:assert/strict'
import { timingSafeCompare } from './timing-safe-compare'

test('equal strings compare true', () => {
  assert.equal(timingSafeCompare('Bearer s3cret-value', 'Bearer s3cret-value'), true)
})

test('different strings of equal length compare false', () => {
  assert.equal(timingSafeCompare('aaaaaaaa', 'aaaaaaab'), false)
})

test('different lengths compare false without throwing', () => {
  // Raw timingSafeEqual throws on length mismatch — the SHA-256 wrap must not.
  assert.equal(timingSafeCompare('short', 'a-much-longer-candidate-string'), false)
})

test('empty vs non-empty compares false', () => {
  assert.equal(timingSafeCompare('', 'x'), false)
})

test('empty vs empty compares true', () => {
  // Callers must still reject unset/empty secrets BEFORE comparing — this
  // documents that the helper itself treats two empties as equal.
  assert.equal(timingSafeCompare('', ''), true)
})

test('unicode strings compare by content', () => {
  assert.equal(timingSafeCompare('café', 'café'), true)
  assert.equal(timingSafeCompare('café', 'cafe'), false)
})
