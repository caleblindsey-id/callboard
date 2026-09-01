import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseFollowupDays,
  followupAnchor,
  waitingSince,
  daysWaiting,
  isFollowupDue,
  selectDueReviews,
  shouldNotifyManagers,
  shouldNotifyAr,
  FOLLOWUP_DEFAULT_DAYS,
  AR_ESCALATE_AFTER,
  type FollowupCandidate,
} from './credit-followup'

const NOW = new Date('2026-09-01T12:00:00Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString()

function candidate(over: Partial<FollowupCandidate> = {}): FollowupCandidate {
  return {
    id: 'r1',
    status: 'pending',
    createdAt: daysAgo(10),
    decidedAt: null,
    lastRemindedAt: null,
    reminderCount: 0,
    ...over,
  }
}

test('parseFollowupDays: defaults when unset or unparseable', () => {
  assert.equal(parseFollowupDays(null), FOLLOWUP_DEFAULT_DAYS)
  assert.equal(parseFollowupDays(undefined), FOLLOWUP_DEFAULT_DAYS)
  assert.equal(parseFollowupDays(''), FOLLOWUP_DEFAULT_DAYS)
  assert.equal(parseFollowupDays('every 3 days'), FOLLOWUP_DEFAULT_DAYS)
})

test('parseFollowupDays: accepts a plain value', () => {
  assert.equal(parseFollowupDays('5'), 5)
  assert.equal(parseFollowupDays(' 7 '), 7)
})

// A 0 here would mean a fresh AR email on every daily cron run, forever.
test('parseFollowupDays: clamps a value that would spam AR', () => {
  assert.equal(parseFollowupDays('0'), 1)
  assert.equal(parseFollowupDays('-4'), 1)
})

test('parseFollowupDays: clamps an absurdly long cadence and floors fractions', () => {
  assert.equal(parseFollowupDays('999'), 30)
  assert.equal(parseFollowupDays('3.9'), 3)
})

test('waitingSince / followupAnchor: counts a pending review from creation', () => {
  const c = candidate({ createdAt: daysAgo(4) })
  assert.equal(waitingSince(c), daysAgo(4))
})

// AR usually decides inside a day, so anchoring a block on created_at would
// fire the first manager nudge almost immediately.
test('waitingSince / followupAnchor: counts a blocked review from when AR blocked it, not creation', () => {
  const c = candidate({ status: 'blocked', createdAt: daysAgo(30), decidedAt: daysAgo(2) })
  assert.equal(waitingSince(c), daysAgo(2))
})

test('waitingSince / followupAnchor: falls back to creation when a blocked row has no decided_at', () => {
  const c = candidate({ status: 'blocked', createdAt: daysAgo(9), decidedAt: null })
  assert.equal(waitingSince(c), daysAgo(9))
})

test('waitingSince / followupAnchor: anchors the cadence on the last reminder once one was sent', () => {
  const c = candidate({ createdAt: daysAgo(30), lastRemindedAt: daysAgo(1) })
  assert.equal(followupAnchor(c), daysAgo(1))
})

// The age in the email must keep climbing across reminders -- a 64-day block
// reading "3d" every time we nudge is exactly the blindness being fixed.
test('daysWaiting: reports the total wait, not the time since the last reminder', () => {
  const c = candidate({
    status: 'blocked',
    createdAt: daysAgo(70),
    decidedAt: daysAgo(64),
    lastRemindedAt: daysAgo(1),
    reminderCount: 20,
  })
  assert.equal(daysWaiting(c, NOW), 64)
})

test('daysWaiting: never goes negative on a clock skew', () => {
  const c = candidate({ createdAt: new Date(NOW.getTime() + 60_000).toISOString() })
  assert.equal(daysWaiting(c, NOW), 0)
})

test('isFollowupDue: is not due before a full cadence has passed', () => {
  assert.equal(isFollowupDue(candidate({ createdAt: daysAgo(2) }), NOW, 3), false)
})

test('isFollowupDue: is due exactly on the cadence boundary', () => {
  assert.equal(isFollowupDue(candidate({ createdAt: daysAgo(3) }), NOW, 3), true)
})

test('isFollowupDue: is not due again until a cadence after the last reminder', () => {
  const c = candidate({ createdAt: daysAgo(30), lastRemindedAt: daysAgo(1) })
  assert.equal(isFollowupDue(c, NOW, 3), false)
})

test('isFollowupDue: becomes due again a cadence after the last reminder', () => {
  const c = candidate({ createdAt: daysAgo(30), lastRemindedAt: daysAgo(3) })
  assert.equal(isFollowupDue(c, NOW, 3), true)
})

// Caleb asked for a nudge "until it is clear". A cap is what let the 68-day
// block go quiet, so a high reminder count must not suppress the next one.
test('isFollowupDue: keeps firing no matter how many reminders have already gone out', () => {
  const c = candidate({
    status: 'blocked',
    decidedAt: daysAgo(68),
    lastRemindedAt: daysAgo(3),
    reminderCount: 22,
  })
  assert.equal(isFollowupDue(c, NOW, 3), true)
})

test('isFollowupDue: ignores a row with an unparseable timestamp rather than mailing forever', () => {
  const c = candidate({ createdAt: 'not-a-date' })
  assert.equal(isFollowupDue(c, NOW, 3), false)
})

test('selectDueReviews: returns only due rows, longest wait first', () => {
  const fresh = candidate({ id: 'fresh', createdAt: daysAgo(1) })
  const mid = candidate({ id: 'mid', createdAt: daysAgo(5) })
  const old = candidate({ id: 'old', createdAt: daysAgo(40) })
  const due = selectDueReviews([fresh, mid, old], NOW, 3)
  assert.deepEqual(due.map((c) => c.id), ['old', 'mid'])
})

test('selectDueReviews: returns nothing when the queue is clear', () => {
  assert.deepEqual(selectDueReviews([], NOW, 3), [])
})

test('routing: sends a pending review back to AR', () => {
  assert.equal(shouldNotifyAr(candidate({ status: 'pending' })), true)
})

// Only a manager can clear a block, and not from an email -- it needs the
// release passcode typed into /credit-review. Re-mailing AR would be noise.
test('routing: does not re-mail AR about a review AR already blocked', () => {
  assert.equal(shouldNotifyAr(candidate({ status: 'blocked' })), false)
})

test('routing: always tells managers about a blocked review', () => {
  assert.equal(shouldNotifyManagers(candidate({ status: 'blocked', reminderCount: 0 })), true)
})

test('routing: keeps early pending reminders between the office and AR', () => {
  assert.equal(shouldNotifyManagers(candidate({ reminderCount: 0 })), false)
  assert.equal(shouldNotifyManagers(candidate({ reminderCount: AR_ESCALATE_AFTER - 1 })), false)
})

test('routing: escalates a pending review to managers once AR has stayed silent', () => {
  assert.equal(shouldNotifyManagers(candidate({ reminderCount: AR_ESCALATE_AFTER })), true)
  assert.equal(shouldNotifyManagers(candidate({ reminderCount: AR_ESCALATE_AFTER + 5 })), true)
})

// credit_reviews 1a04a9f5: blocked 2026-06-29 "have invoice over 120 days
// old", not unblocked until 2026-09-01 -- 64 days with nothing chasing it.
test('the production case this was built for: chases a 64-day block that has never been reminded', () => {
  const c = candidate({
    status: 'blocked',
    createdAt: '2026-06-28T00:00:00Z',
    decidedAt: '2026-06-29T00:00:00Z',
    lastRemindedAt: null,
    reminderCount: 0,
  })
  assert.equal(isFollowupDue(c, NOW, FOLLOWUP_DEFAULT_DAYS), true)
  assert.equal(shouldNotifyManagers(c), true)
  assert.equal(shouldNotifyAr(c), false)
  assert.equal(daysWaiting(c, NOW), 64)
})

// AR's slowest real decision was 4.83 days. At a 3-day cadence that review
// gets exactly one nudge, and never escalates to managers.
test('the production case this was built for: nudges AR once on its slowest observed decision, without escalating', () => {
  const c = candidate({ status: 'pending', createdAt: daysAgo(4) })
  assert.equal(isFollowupDue(c, NOW, FOLLOWUP_DEFAULT_DAYS), true)
  assert.equal(shouldNotifyAr(c), true)
  assert.equal(shouldNotifyManagers(c), false)
})

// The common case: 102 of 112 production reviews were decided inside 3 days
// and must never generate a reminder at all.
test('the production case this was built for: stays silent on a review AR handled the same day', () => {
  const c = candidate({ status: 'pending', createdAt: daysAgo(0) })
  assert.equal(isFollowupDue(c, NOW, FOLLOWUP_DEFAULT_DAYS), false)
})
