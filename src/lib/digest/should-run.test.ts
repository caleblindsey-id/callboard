import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shouldRunNow, localHourIn, isBusinessWeekday } from './should-run'

// Two weekday cron entries fire (13:00Z and 14:00Z) and exactly one must do
// work, year round. Every assertion is an absolute UTC instant so these hold
// on any machine regardless of its local timezone, matching the house style in
// business-time.test.ts.

const CENTRAL = 'America/Chicago'

test('CDT summer: the 13:00Z fire is 8 AM Central and runs', () => {
  assert.equal(shouldRunNow(new Date('2026-08-20T13:00:00Z'), CENTRAL), true)
})

test('CDT summer: the 14:00Z fire is 9 AM Central and no-ops', () => {
  assert.equal(shouldRunNow(new Date('2026-08-20T14:00:00Z'), CENTRAL), false)
})

test('CST winter: the 14:00Z fire is 8 AM Central and runs', () => {
  assert.equal(shouldRunNow(new Date('2026-01-15T14:00:00Z'), CENTRAL), true)
})

test('CST winter: the 13:00Z fire is 7 AM Central and no-ops', () => {
  assert.equal(shouldRunNow(new Date('2026-01-15T13:00:00Z'), CENTRAL), false)
})

test('spring forward day still produces exactly one run', () => {
  // 2026-03-08: Central switches at 08:00Z, so both fires are already CDT.
  assert.equal(shouldRunNow(new Date('2026-03-08T13:00:00Z'), CENTRAL), true)
  assert.equal(shouldRunNow(new Date('2026-03-08T14:00:00Z'), CENTRAL), false)
})

test('fall back day still produces exactly one run', () => {
  // 2026-11-01: Central switches at 09:00Z, so both fires are already CST.
  assert.equal(shouldRunNow(new Date('2026-11-01T13:00:00Z'), CENTRAL), false)
  assert.equal(shouldRunNow(new Date('2026-11-01T14:00:00Z'), CENTRAL), true)
})

test('exactly one send per day across the whole year', () => {
  const d = new Date('2026-01-01T00:00:00Z')
  let checked = 0
  while (d.getUTCFullYear() === 2026) {
    const y = d.getUTCFullYear()
    const m = String(d.getUTCMonth() + 1).padStart(2, '0')
    const day = String(d.getUTCDate()).padStart(2, '0')
    const at13 = shouldRunNow(new Date(`${y}-${m}-${day}T13:00:00Z`), CENTRAL)
    const at14 = shouldRunNow(new Date(`${y}-${m}-${day}T14:00:00Z`), CENTRAL)
    assert.equal(
      Number(at13) + Number(at14),
      1,
      `${y}-${m}-${day} did not produce exactly one run (13:00Z=${at13}, 14:00Z=${at14})`
    )
    checked++
    d.setUTCDate(d.getUTCDate() + 1)
  }
  assert.equal(checked, 365)
})

// The cron expression already restricts the schedule to weekdays. This guard is
// for the manual path: a curl with the secret must not mail the branch on a
// Saturday.
test('isBusinessWeekday: a normal Friday and Monday are weekdays', () => {
  assert.equal(isBusinessWeekday(new Date('2026-08-21T13:00:00Z'), CENTRAL), true) // Friday
  assert.equal(isBusinessWeekday(new Date('2026-08-24T13:00:00Z'), CENTRAL), true) // Monday
})

test('isBusinessWeekday: Saturday and Sunday are not', () => {
  assert.equal(isBusinessWeekday(new Date('2026-08-22T13:00:00Z'), CENTRAL), false)
  assert.equal(isBusinessWeekday(new Date('2026-08-23T13:00:00Z'), CENTRAL), false)
})

test('isBusinessWeekday resolves in Central, not UTC', () => {
  // 2026-08-22T02:00Z is Saturday in UTC but still Friday 9 PM in Central.
  assert.equal(isBusinessWeekday(new Date('2026-08-22T02:00:00Z'), CENTRAL), true)
  // 2026-08-24T02:00Z is Monday in UTC but still Sunday 9 PM in Central.
  assert.equal(isBusinessWeekday(new Date('2026-08-24T02:00:00Z'), CENTRAL), false)
})

test('localHourIn renders midnight as 0, not 24', () => {
  // 06:00Z in January is midnight Central. Some ICU builds format that as '24'
  // under hour12:false, which would break an equality check against a target
  // hour of 0.
  assert.equal(localHourIn(new Date('2026-01-15T06:00:00Z'), CENTRAL), 0)
})
