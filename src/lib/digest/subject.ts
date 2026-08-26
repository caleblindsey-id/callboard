export type SubjectInput = {
  distinctCount: number
  failedCount: number
  dateLabel: string
}

/**
 * Failure aware by construction.
 *
 * The Python original computed its subject from a total that is 0 when every
 * query fails. `any_errored` correctly forced the send, but the subject still
 * read "0 items need action", so a complete outage looked exactly like a quiet
 * morning. It shipped that way on 2026-06-17 and 2026-08-03, both sitting
 * between 130-item days, and nobody noticed either time.
 *
 * A zero count with failures present can never render as calm here.
 *
 * Copy rule: no em-dashes or en-dashes anywhere in a subject Caleb's team
 * will read.
 */
export function buildSubject({ distinctCount, failedCount, dateLabel }: SubjectInput): string {
  const prefix = 'CallBoard Morning Digest'

  if (failedCount > 0 && distinctCount === 0) {
    return `${prefix}: degraded, ${failedCount} ${plural(failedCount, 'section')} could not load (${dateLabel})`
  }

  const items =
    distinctCount === 1 ? '1 item needs action' : `${distinctCount} items need action`

  if (failedCount > 0) {
    return `${prefix}: ${items}, ${failedCount} ${plural(failedCount, 'section')} could not load (${dateLabel})`
  }

  return `${prefix}: ${items} (${dateLabel})`
}

function plural(n: number, word: string): string {
  return n === 1 ? word : `${word}s`
}
