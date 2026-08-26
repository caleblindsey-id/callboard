/**
 * Vercel Cron is UTC only, so a fixed UTC schedule drifts an hour at every DST
 * change. CallBoard's three pre-existing crons are pinned near 13:00 UTC and
 * therefore run at 7 AM Central every winter.
 *
 * The digest registers TWO weekday schedules, 13:00Z and 14:00Z, and this gate
 * lets exactly one of them do work: whichever is 8 AM in the business timezone
 * on that date. In summer 13:00Z is 8 AM and 14:00Z is 9 AM; in winter it
 * reverses. They can never both be 8 AM local, and Vercel never double-fires a
 * single schedule, so no already-sent state file is needed.
 *
 * The Python original needed one of those state files, but only because a
 * laptop that was off at 8 AM would fire the task late at logon. Vercel has no
 * logon catch-up, so that failure mode does not exist here.
 */
export function shouldRunNow(now: Date, timeZone: string, targetHour = 8): boolean {
  return localHourIn(now, timeZone) === targetHour
}

/**
 * Weekday in the BUSINESS timezone, not UTC.
 *
 * The cron expression already restricts the schedule to 1-5, so this exists for
 * the manual path: `vercel crons run`, or a curl with the secret, must not be
 * able to mail the branch on a Saturday.
 *
 * It has to resolve through the business timezone rather than getUTCDay(),
 * because the digest's 14:00Z winter fire is still Friday in UTC when it is
 * Friday in Central, but a naive UTC check at other hours would disagree near
 * midnight.
 */
export function isBusinessWeekday(now: Date, timeZone: string): boolean {
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(now)
  return weekday !== 'Sat' && weekday !== 'Sun'
}

export function localHourIn(now: Date, timeZone: string): number {
  const hour = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    hour12: false,
  }).format(now)
  // 'en-US' with hour12:false renders midnight as '24' on some ICU versions,
  // which would break an equality check against a target hour of 0.
  return Number(hour) % 24
}
