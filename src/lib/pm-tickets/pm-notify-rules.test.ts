import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildPmNotification,
  groupCreatedByTechnician,
  shouldNotifyForMonth,
} from './pm-notify-rules'

const TECH_A = '11111111-1111-1111-1111-111111111111'
const TECH_B = '22222222-2222-2222-2222-222222222222'

// Fixed clock: 12:00 PM CDT on July 15 2026 (CDT is UTC-5 in July).
const MID_JULY = new Date('2026-07-15T17:00:00Z')

test('shouldNotifyForMonth: a future month notifies', () => {
  assert.equal(shouldNotifyForMonth(8, 2026, MID_JULY), true)
})

test('shouldNotifyForMonth: the current month notifies', () => {
  assert.equal(shouldNotifyForMonth(7, 2026, MID_JULY), true)
})

test('shouldNotifyForMonth: a past month is silent', () => {
  assert.equal(shouldNotifyForMonth(3, 2026, MID_JULY), false)
})

test('shouldNotifyForMonth: December of a prior year is silent', () => {
  assert.equal(shouldNotifyForMonth(12, 2025, MID_JULY), false)
})

test('shouldNotifyForMonth: January of next year notifies', () => {
  assert.equal(shouldNotifyForMonth(1, 2027, MID_JULY), true)
})

// This is the whole reason the gate resolves "today" through America/Chicago
// instead of the server clock. Vercel runs UTC, so at 11 PM CDT on July 31 the
// server reads August 1. A UTC-based gate would classify a current-month July
// run as "past" and go silent. 2026-08-01T04:00:00Z == July 31 11:00 PM CDT.
test('shouldNotifyForMonth: July still notifies at 11 PM CDT on July 31 (Aug 1 in UTC)', () => {
  const lateJuly = new Date('2026-08-01T04:00:00Z')
  assert.equal(shouldNotifyForMonth(7, 2026, lateJuly), true)
})

test('groupCreatedByTechnician: counts per technician across a mixed batch', () => {
  const result = groupCreatedByTechnician([
    { assigned_technician_id: TECH_A },
    { assigned_technician_id: TECH_B },
    { assigned_technician_id: TECH_A },
  ])
  const sorted = [...result].sort((a, b) => a.technicianId.localeCompare(b.technicianId))
  assert.deepEqual(sorted, [
    { technicianId: TECH_A, count: 2 },
    { technicianId: TECH_B, count: 1 },
  ])
})

test('groupCreatedByTechnician: drops unassigned rows', () => {
  const result = groupCreatedByTechnician([
    { assigned_technician_id: null },
    { assigned_technician_id: TECH_A },
    { assigned_technician_id: null },
  ])
  assert.deepEqual(result, [{ technicianId: TECH_A, count: 1 }])
})

test('groupCreatedByTechnician: empty input returns an empty array', () => {
  assert.deepEqual(groupCreatedByTechnician([]), [])
})

test('groupCreatedByTechnician: an all-unassigned batch returns an empty array', () => {
  assert.deepEqual(groupCreatedByTechnician([{ assigned_technician_id: null }]), [])
})

test('buildPmNotification: title carries the month name and the year', () => {
  const n = buildPmNotification({ month: 8, year: 2026, count: 14, appUrl: 'https://cb.app' })
  assert.equal(n.title, 'August 2026 PMs are ready')
})

test('buildPmNotification: plural body above one', () => {
  const n = buildPmNotification({ month: 8, year: 2026, count: 14, appUrl: 'https://cb.app' })
  assert.equal(n.body, '14 PM tickets assigned to you.')
})

test('buildPmNotification: singular body at exactly one', () => {
  const n = buildPmNotification({ month: 8, year: 2026, count: 1, appUrl: 'https://cb.app' })
  assert.equal(n.body, '1 PM ticket assigned to you.')
})

test('buildPmNotification: url deep-links to the month board', () => {
  const n = buildPmNotification({ month: 8, year: 2026, count: 3, appUrl: 'https://cb.app' })
  assert.equal(n.url, 'https://cb.app/tickets?month=8&year=2026')
})

test('buildPmNotification: a trailing slash on appUrl does not double up', () => {
  const n = buildPmNotification({ month: 8, year: 2026, count: 3, appUrl: 'https://cb.app/' })
  assert.equal(n.url, 'https://cb.app/tickets?month=8&year=2026')
})

test('buildPmNotification: empty appUrl degrades to a relative path', () => {
  const n = buildPmNotification({ month: 8, year: 2026, count: 3, appUrl: '' })
  assert.equal(n.url, '/tickets?month=8&year=2026')
})

// Keyed to the target month so a re-run replaces the lock-screen entry instead
// of stacking a second one. Zero-padded so it sorts and reads consistently.
test('buildPmNotification: tag is zero-padded and month-keyed', () => {
  const n = buildPmNotification({ month: 8, year: 2026, count: 3, appUrl: 'https://cb.app' })
  assert.equal(n.tag, 'pm-generated-2026-08')
})

test('buildPmNotification: tag zero-padding holds for a two-digit month', () => {
  const n = buildPmNotification({ month: 12, year: 2026, count: 3, appUrl: 'https://cb.app' })
  assert.equal(n.tag, 'pm-generated-2026-12')
})
