import { test } from 'node:test'
import assert from 'node:assert/strict'
import { QUOTE_VALID_TRANSITIONS, canTransitionQuote } from './transitions'
import { PM_QUOTE_STATUSES } from '@/types/database'

test('QUOTE_VALID_TRANSITIONS matches the pinned quote state machine', () => {
  assert.deepEqual(QUOTE_VALID_TRANSITIONS, {
    draft: ['sent', 'void'],
    sent: ['accepted', 'declined', 'expired', 'void'],
    accepted: ['void'],
    declined: ['sent', 'void'],
    expired: ['sent', 'void'],
    void: [],
  })
})

test('canTransitionQuote allows every listed pair and forbids every other', () => {
  for (const from of PM_QUOTE_STATUSES) {
    for (const to of PM_QUOTE_STATUSES) {
      const expected = QUOTE_VALID_TRANSITIONS[from].includes(to)
      assert.equal(canTransitionQuote(from, to), expected, `${from} -> ${to}`)
    }
  }
})

test('an accepted quote cannot be walked back to draft or sent', () => {
  // The start-work gate reads 'accepted'. Reverting it would silently
  // un-authorize work that may already be underway.
  assert.equal(canTransitionQuote('accepted', 'draft'), false)
  assert.equal(canTransitionQuote('accepted', 'sent'), false)
  assert.equal(canTransitionQuote('accepted', 'declined'), false)
  assert.equal(canTransitionQuote('accepted', 'void'), true)
})

test('void is final', () => {
  for (const to of PM_QUOTE_STATUSES) {
    assert.equal(canTransitionQuote('void', to), false, `void -> ${to}`)
  }
})

test('a declined or expired quote can be re-sent', () => {
  assert.equal(canTransitionQuote('declined', 'sent'), true)
  assert.equal(canTransitionQuote('expired', 'sent'), true)
})
