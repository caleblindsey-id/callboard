import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isDeliverableEmail } from './email-deliverable'

// Guards the notification email leg against addresses that exist as a login but
// have no mailbox behind them. Before this guard, every technician carried a
// synthetic tech<synergy_id>@imperialdade.com address, so assignment, parts-ready
// and supply-ready notices were sent into a black hole for months.

test('isDeliverableEmail: real Imperial Dade addresses pass', () => {
  assert.equal(isDeliverableEmail('mjennings@imperialdade.com'), true)
  assert.equal(isDeliverableEmail('jeffery.verberne@imperialdade.com'), true)
  assert.equal(isDeliverableEmail('ken.crummie@imperialdade.com'), true)
})

test('isDeliverableEmail: synthetic tech<code>@ placeholders are rejected', () => {
  assert.equal(isDeliverableEmail('tech401@imperialdade.com'), false)
  assert.equal(isDeliverableEmail('tech444@imperialdade.com'), false)
  // Case-insensitive: the sync writes lowercase, but a hand-entered row may not.
  assert.equal(isDeliverableEmail('TECH407@IMPERIALDADE.COM'), false)
})

test('isDeliverableEmail: the non-routable @callboard.local login domain is rejected', () => {
  assert.equal(isDeliverableEmail('travis.white@callboard.local'), false)
  assert.equal(isDeliverableEmail('anyone@CallBoard.Local'), false)
})

test('isDeliverableEmail: empty, null and malformed values are rejected', () => {
  assert.equal(isDeliverableEmail(null), false)
  assert.equal(isDeliverableEmail(undefined), false)
  assert.equal(isDeliverableEmail(''), false)
  assert.equal(isDeliverableEmail('   '), false)
  assert.equal(isDeliverableEmail('not-an-address'), false)
})

test('isDeliverableEmail: a real name that merely starts with "tech" still passes', () => {
  // The placeholder pattern is tech + digits only. Do not over-match a person.
  assert.equal(isDeliverableEmail('techsupport@imperialdade.com'), true)
  assert.equal(isDeliverableEmail('tech.jones@imperialdade.com'), true)
})
