import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pinPolicyError, lockDurationMs, PIN_LOCK_THRESHOLD } from './pin-policy'

test('pinPolicyError accepts reasonable PINs', () => {
  assert.equal(pinPolicyError('8472'), null)
  assert.equal(pinPolicyError('290413'), null)
})

test('pinPolicyError rejects bad PINs', () => {
  assert.ok(pinPolicyError('abc'))       // non-digit
  assert.ok(pinPolicyError('123'))       // too short
  assert.ok(pinPolicyError('1234567'))   // too long
  assert.ok(pinPolicyError('0000'))      // all same
  assert.ok(pinPolicyError('111111'))    // all same
  assert.ok(pinPolicyError('1234'))      // ascending run
  assert.ok(pinPolicyError('4321'))      // descending run
  assert.ok(pinPolicyError('012345'))    // ascending run
})

test('lockDurationMs is zero below threshold and escalates after', () => {
  assert.equal(lockDurationMs(PIN_LOCK_THRESHOLD - 1), 0)
  const first = lockDurationMs(PIN_LOCK_THRESHOLD)
  const second = lockDurationMs(PIN_LOCK_THRESHOLD + 1)
  assert.ok(first > 0)
  assert.ok(second > first)               // escalating
  // capped at 24h
  assert.ok(lockDurationMs(PIN_LOCK_THRESHOLD + 50) <= 24 * 60 * 60 * 1000)
})
