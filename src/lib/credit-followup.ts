// Follow-up cadence for open credit reviews (feedback #75).
//
// A credit review is emailed to AR once, at creation, and then nothing ever
// chases it. Production showed where that hurts: AR itself is fast (112 reviews,
// average 0.52 days to a decision, slowest 4.8, none over 7) but the orders AR
// *blocks* rot -- three sat 60, 64 and 68 days before a manager unblocked them.
// So the cadence matters far more on the blocked side than the pending side,
// even though the two share one mechanism here.
//
// This module is PURE -- no server imports, no DB, no clock of its own. Every
// function takes `now` explicitly. That is what makes the selection rules
// unit-testable; the cron does the I/O and calls in here to decide.

export const FOLLOWUP_DEFAULT_DAYS = 3
const FOLLOWUP_MIN_DAYS = 1
const FOLLOWUP_MAX_DAYS = 30

// Reminders sent to AR alone before managers start getting copied on a review
// that is still pending. AR has never taken more than 4.8 days in production, so
// at the default 3-day cadence this is a ~9-day safety net for when AR is out --
// it should almost never fire.
export const AR_ESCALATE_AFTER = 2

export type FollowupStatus = 'pending' | 'blocked'

export type FollowupCandidate = {
  id: string
  status: FollowupStatus
  createdAt: string
  /** When AR blocked it. Null on a pending review. */
  decidedAt: string | null
  lastRemindedAt: string | null
  reminderCount: number
}

/**
 * The configured cadence, in days, from the `credit_followup_days` setting.
 *
 * Clamped rather than trusted: this value is typed into a settings box by a
 * human and it drives how often we mail AR. A stray `0` would mean a reminder
 * on every single cron run, and a negative or NaN value would make every open
 * review permanently due. Anything unparseable falls back to the default.
 */
export function parseFollowupDays(raw: string | null | undefined): number {
  const trimmed = (raw ?? '').trim()
  // Blank means "never configured", which is the normal state -- and it must
  // reach the default, not the clamp. Number('') is 0, so without this an unset
  // setting would clamp up to the 1-day floor and mail AR three times as often.
  if (trimmed === '') return FOLLOWUP_DEFAULT_DAYS
  const n = Number(trimmed)
  if (!Number.isFinite(n)) return FOLLOWUP_DEFAULT_DAYS
  const whole = Math.floor(n)
  if (whole < FOLLOWUP_MIN_DAYS) return FOLLOWUP_MIN_DAYS
  if (whole > FOLLOWUP_MAX_DAYS) return FOLLOWUP_MAX_DAYS
  return whole
}

/**
 * The instant the current waiting period started -- what the cadence counts from.
 *
 * Once a review has been reminded, that is always the anchor. Before the first
 * reminder the anchor depends on who we are waiting for: a pending review has
 * been AR's to action since it was created, but a blocked review only became a
 * manager's problem when AR blocked it (`decided_at`). Anchoring a blocked
 * review on created_at would fire the first manager nudge early, sometimes
 * immediately, since AR usually decides inside a day.
 */
export function followupAnchor(c: FollowupCandidate): string {
  return c.lastRemindedAt ?? waitingSince(c)
}

/**
 * When this review first landed on its current owner's plate.
 *
 * Unlike followupAnchor this ignores reminders entirely -- it is the true start
 * of the wait, so "blocked 64 days" in an email keeps counting up instead of
 * resetting to 3 every time we send a nudge.
 */
export function waitingSince(c: FollowupCandidate): string {
  if (c.status === 'blocked' && c.decidedAt) return c.decidedAt
  return c.createdAt
}

/** Whole days a review has been waiting on its current owner, for email copy. */
export function daysWaiting(c: FollowupCandidate, now: Date): number {
  const ms = now.getTime() - new Date(waitingSince(c)).getTime()
  return Math.max(0, Math.floor(ms / 86_400_000))
}

/**
 * Is this review due for a reminder?
 *
 * A review that has never been reminded becomes due once it has been waiting a
 * full cadence; after that, each reminder restarts the clock. There is
 * deliberately no cap on the number of reminders -- Caleb asked for a nudge
 * "every so many days until it is clear", and a cap is exactly what would have
 * let the 68-day block go quiet again after a fortnight.
 */
export function isFollowupDue(c: FollowupCandidate, now: Date, days: number): boolean {
  const anchorMs = new Date(followupAnchor(c)).getTime()
  if (!Number.isFinite(anchorMs)) return false
  return now.getTime() - anchorMs >= days * 86_400_000
}

/** The due subset, oldest wait first so the cron works the worst backlog first. */
export function selectDueReviews<T extends FollowupCandidate>(
  rows: T[],
  now: Date,
  days: number
): T[] {
  return rows
    .filter((c) => isFollowupDue(c, now, days))
    .sort(
      (a, b) =>
        new Date(followupAnchor(a)).getTime() - new Date(followupAnchor(b)).getTime()
    )
}

/**
 * Should managers be copied on this reminder?
 *
 * Blocked reviews go to managers by definition -- only a manager can clear one,
 * with the release passcode. Pending reviews are AR's until AR has been nudged
 * AR_ESCALATE_AFTER times without deciding.
 */
export function shouldNotifyManagers(c: FollowupCandidate): boolean {
  if (c.status === 'blocked') return true
  return c.reminderCount >= AR_ESCALATE_AFTER
}

/** Should AR get a fresh Release/Block link? Only pending reviews are AR's to action. */
export function shouldNotifyAr(c: FollowupCandidate): boolean {
  return c.status === 'pending'
}
