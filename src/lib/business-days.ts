/**
 * Weekday in a given IANA timezone, not UTC. Originally lived in
 * src/lib/digest/should-run.ts (still re-exported there for compatibility);
 * moved here so businessDaysSince can share it without the digest module
 * pulling in a dependency the other direction.
 *
 * It has to resolve through the given timezone rather than getUTCDay(),
 * because an instant that is Saturday in UTC can still be Friday evening in
 * Central, and a naive UTC check near midnight would disagree.
 */
export function isBusinessWeekday(now: Date, timeZone: string): boolean {
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(now)
  return weekday !== 'Sat' && weekday !== 'Sun'
}

// Anchor an instant to noon UTC on its calendar day in `timeZone`. Noon UTC
// keeps the same calendar day in every timezone CallBoard runs in (matches
// the toDate() trick in lib/format.ts), so walking this anchor a day at a
// time never skips or repeats a calendar day.
function localDateAtNoon(d: Date, timeZone: string): Date {
  const dateStr = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
  return new Date(`${dateStr}T12:00:00Z`)
}

/**
 * Count of Mon-Fri calendar days strictly between `from` and `now`, in
 * `timeZone`. `from` itself never counts (a job completed today reads 0), and
 * weekend days elapsed are never counted (a Friday completion still reads 0
 * on the following Monday morning, then 1 that afternoon once `now` rolls
 * past... in practice this is evaluated once, at digest time, so a Friday
 * completion reads 0 all weekend and 1 starting Monday).
 */
export function businessDaysSince(from: Date, now: Date, timeZone: string): number {
  const start = localDateAtNoon(from, timeZone)
  const end = localDateAtNoon(now, timeZone)
  let count = 0
  const cursor = new Date(start)
  while (cursor.getTime() < end.getTime()) {
    cursor.setUTCDate(cursor.getUTCDate() + 1)
    if (isBusinessWeekday(cursor, timeZone)) count++
  }
  return count
}
