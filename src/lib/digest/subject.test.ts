import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSubject } from './subject'

// Regression guard for the audit's worst find: the Python original computed
// its subject from a total that reads 0 when every query fails, so a complete
// outage shipped as "0 items need action" on 2026-06-17 and 2026-08-03, both
// sitting between 130-item days. Nobody noticed, because a calm subject on a
// quiet morning is unremarkable.

test('normal morning names the distinct count', () => {
  const s = buildSubject({ distinctCount: 107, failedCount: 0, dateLabel: 'Aug 20' })
  assert.equal(s, 'CallBoard Morning Digest: 107 items need action (Aug 20)')
})

test('singular item reads correctly', () => {
  const s = buildSubject({ distinctCount: 1, failedCount: 0, dateLabel: 'Aug 20' })
  assert.equal(s, 'CallBoard Morning Digest: 1 item needs action (Aug 20)')
})

test('total outage never renders as zero items', () => {
  // failedCount tracks SECTIONS.length so this stays a genuine total outage.
  const s = buildSubject({ distinctCount: 0, failedCount: 14, dateLabel: 'Aug 20' })
  assert.ok(!s.includes('0 items'), `subject must not claim zero items: ${s}`)
  assert.equal(s, 'CallBoard Morning Digest: degraded, 14 sections could not load (Aug 20)')
})

test('partial failure reports both the count and the failures', () => {
  const s = buildSubject({ distinctCount: 42, failedCount: 2, dateLabel: 'Aug 20' })
  assert.equal(
    s,
    'CallBoard Morning Digest: 42 items need action, 2 sections could not load (Aug 20)'
  )
})

test('a single failed section reads singular', () => {
  const s = buildSubject({ distinctCount: 42, failedCount: 1, dateLabel: 'Aug 20' })
  assert.equal(
    s,
    'CallBoard Morning Digest: 42 items need action, 1 section could not load (Aug 20)'
  )
})

test('a genuinely quiet morning is allowed to say zero when nothing failed', () => {
  const s = buildSubject({ distinctCount: 0, failedCount: 0, dateLabel: 'Aug 20' })
  assert.equal(s, 'CallBoard Morning Digest: 0 items need action (Aug 20)')
})

test('no dashes in the subject', () => {
  for (const input of [
    { distinctCount: 107, failedCount: 0, dateLabel: 'Aug 20' },
    { distinctCount: 0, failedCount: 13, dateLabel: 'Aug 20' },
    { distinctCount: 42, failedCount: 2, dateLabel: 'Aug 20' },
  ]) {
    const s = buildSubject(input)
    assert.ok(!s.includes('—') && !s.includes('–'), `subject contains a dash: ${s}`)
  }
})
