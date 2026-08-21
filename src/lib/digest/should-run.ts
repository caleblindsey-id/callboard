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
