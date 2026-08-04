import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isRpcConflict, isOptimisticLockError, isStatusConflictError } from './rpc-conflict'

// The post-157 shape: P0001 carrying the raised name.
test('matches the raised name on P0001', () => {
  assert.equal(isOptimisticLockError({ code: 'P0001', message: 'OPTIMISTIC_LOCK' }), true)
  assert.equal(isStatusConflictError({ code: 'P0001', message: 'STATUS_CONFLICT' }), true)
})

test('does not confuse one named conflict for another', () => {
  // Both raise P0001, so the code alone cannot tell them apart.
  assert.equal(isOptimisticLockError({ code: 'P0001', message: 'STATUS_CONFLICT' }), false)
  assert.equal(isStatusConflictError({ code: 'P0001', message: 'OPTIMISTIC_LOCK' }), false)
})

// The pre-157 shape, so a deploy that lands before the migration still works.
test('still matches the legacy 40001 shape', () => {
  assert.equal(isOptimisticLockError({ code: '40001', message: 'OPTIMISTIC_LOCK' }), true)
  assert.equal(isStatusConflictError({ code: '40001', message: 'STATUS_CONFLICT' }), true)
})

test('a bare 40001 counts as a conflict whatever the message', () => {
  // Post-157 this can only be a genuine serialization failure, which is itself a
  // "someone changed this underneath you" condition — 409 describes it fairly.
  assert.equal(isOptimisticLockError({ code: '40001', message: 'could not serialize access' }), true)
})

test('other database errors are not conflicts', () => {
  assert.equal(isOptimisticLockError({ code: '28000', message: 'UNAUTHORIZED' }), false)
  assert.equal(isOptimisticLockError({ code: '42501', message: 'FORBIDDEN' }), false)
  assert.equal(isOptimisticLockError({ code: '22023', message: 'INVALID_SOURCE' }), false)
  assert.equal(isOptimisticLockError({ code: '23505', message: 'duplicate key' }), false)
})

test('a missing or empty error is not a conflict', () => {
  assert.equal(isOptimisticLockError(null), false)
  assert.equal(isOptimisticLockError(undefined), false)
  assert.equal(isOptimisticLockError({}), false)
})

test('tolerates whitespace and missing fields', () => {
  assert.equal(isOptimisticLockError({ code: 'P0001', message: '  OPTIMISTIC_LOCK  ' }), true)
  assert.equal(isRpcConflict({ message: 'OPTIMISTIC_LOCK' }, 'OPTIMISTIC_LOCK'), true)
  assert.equal(isRpcConflict({ code: 'P0001' }, 'OPTIMISTIC_LOCK'), false)
})

test('40P01 (deadlock_detected) is NOT treated as a conflict', () => {
  // Also in the retryable class; if one of our functions ever raised it we would
  // want the same fix, not a silent 409 that hides a real deadlock.
  assert.equal(isOptimisticLockError({ code: '40P01', message: 'deadlock detected' }), false)
})
