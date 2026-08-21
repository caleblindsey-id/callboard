import { SECTIONS } from './sections'
import type { DigestDb, SectionResult } from './types'

// Shared by the cron, the preview route and the test send, so all three see
// exactly the same queues. Anything that runs sections should call this rather
// than looping SECTIONS itself.

export type SectionStatus =
  | { key: string; ok: true; count: number }
  | { key: string; ok: false; message: string }

/**
 * Run every section, isolating failures.
 *
 * One failing query must never take down the digest, and must never silently
 * vanish from it either. A section that throws becomes a visible warning card
 * in the email, because an omitted section is indistinguishable from a cleared
 * queue, which is the same class of bug as the "0 items need action" subject
 * that shipped twice during a total outage.
 */
export async function runSections(db: DigestDb): Promise<SectionResult[]> {
  return Promise.all(
    SECTIONS.map(async (section): Promise<SectionResult> => {
      try {
        return { ok: true, sectionKey: section.key, rows: await section.fetch(db) }
      } catch (err) {
        console.error(`morning-digest: section ${section.key} failed`, err)
        return {
          ok: false,
          sectionKey: section.key,
          message: err instanceof Error ? err.message : 'query failed',
        }
      }
    })
  )
}

export function sectionStatuses(results: SectionResult[]): SectionStatus[] {
  return results.map((r) =>
    r.ok
      ? { key: r.sectionKey, ok: true, count: r.rows.length }
      : { key: r.sectionKey, ok: false, message: r.message }
  )
}

export async function getSetting(db: DigestDb, key: string): Promise<string | null> {
  const { data } = await db.from('settings').select('value').eq('key', key).maybeSingle()
  return (data as { value: string | null } | null)?.value ?? null
}

export function digestDateLabel(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, month: 'short', day: 'numeric' }).format(now)
}
