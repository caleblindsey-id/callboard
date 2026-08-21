/**
 * Read-only parity harness for the morning digest port.
 *
 * Runs the REAL section fetchers against prod with a service-role client and
 * prints per-section counts, so the CallBoard numbers can be diffed against the
 * Python digest's before anything is deployed. Sends nothing, writes nothing.
 *
 * Run: npx tsx --env-file=.env.local scripts/digest-parity.ts
 */
import { createClient } from '@supabase/supabase-js'
import { SECTIONS } from '../src/lib/digest/sections'
import { dedupedCount } from '../src/lib/digest/dedupe'
import type { DigestDb, SectionResult } from '../src/lib/digest/types'

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  }

  const db = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as DigestDb

  const results: SectionResult[] = []
  for (const section of SECTIONS) {
    try {
      const rows = await section.fetch(db)
      results.push({ ok: true, sectionKey: section.key, rows })
    } catch (err) {
      results.push({
        ok: false,
        sectionKey: section.key,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const out: Record<string, unknown> = {}
  for (const r of results) {
    out[r.sectionKey] = r.ok ? { ok: true, count: r.rows.length } : { ok: false, error: r.message }
  }

  const okRows = results.filter((r) => r.ok) as Extract<SectionResult, { ok: true }>[]
  console.log(
    JSON.stringify(
      {
        sections: out,
        naiveSum: okRows.reduce((n, r) => n + r.rows.length, 0),
        distinct: dedupedCount(results),
        failed: results.filter((r) => !r.ok).length,
      },
      null,
      2
    )
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
