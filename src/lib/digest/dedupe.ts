import type { SectionResult } from './types'

/**
 * The headline counts DISTINCT entities, not the sum of section counts.
 *
 * Sections legitimately overlap and that overlap is not a bug to squash: a
 * completed ticket for a PO-required customer is both "ready to bill" and
 * "waiting on a PO", and both actions are real work for different people. A
 * ticket sitting in `estimated` untouched for a week is in both the idle queue
 * and the estimate queue. Each section therefore shows its own true count,
 * while the headline counts the union so one ticket is never counted twice.
 *
 * On 2026-08-20 the naive sum was 127 and the distinct count was 107.
 *
 * This works only because every row carries a prefixed entityKey. If a section
 * emits rows whose prefix does not match the entity they point at, the dedupe
 * silently stops working: nothing throws, the number is just wrong.
 */
export function dedupedCount(results: SectionResult[]): number {
  const keys = new Set<string>()
  for (const result of results) {
    if (!result.ok) continue
    for (const row of result.rows) keys.add(row.entityKey)
  }
  return keys.size
}
