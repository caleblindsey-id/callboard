/**
 * Read-only check of the ship-to queue's grouping and match scoring against the
 * REAL pending backlog in prod. Run:
 *   npx tsx --env-file=.env.local scripts/verify-ship-to-queue.ts
 */
import { createClient } from '@supabase/supabase-js'
import { groupShipToRequests } from '../src/lib/ship-to-requests/group'
import { findLikelyShipTos } from '../src/lib/ship-to-requests/match'
import type { ShipToRequestWithJoins } from '../src/lib/db/ship-to-requests'
import type { ShipToLocationRow } from '../src/types/database'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
const db = createClient(url, key, { auth: { persistSession: false } })

async function main() {
  const { data, error } = await db
    .from('ship_to_requests')
    .select(
      `*, customer:customers(id, name), requested_by_user:users!requested_by(name),
       equipment(id, make, model, serial_number)`
    )
    .eq('status', 'pending')
    .order('requested_at', { ascending: false })
  if (error) throw error

  const rows = (data ?? []) as unknown as ShipToRequestWithJoins[]
  const groups = groupShipToRequests(rows)

  const customerIds = [...new Set(rows.map((r) => r.customer_id))]
  const { data: locData, error: locErr } = await db
    .from('ship_to_locations')
    .select('*')
    .in('customer_id', customerIds)
  if (locErr) throw locErr
  const locations = (locData ?? []) as ShipToLocationRow[]

  const byCustomer = new Map<number, ShipToLocationRow[]>()
  for (const l of locations) {
    if (l.customer_id == null) continue
    const b = byCustomer.get(l.customer_id)
    if (b) b.push(l)
    else byCustomer.set(l.customer_id, [l])
  }

  console.log(`pending rows: ${rows.length}`)
  console.log(`groups:       ${groups.length}`)
  console.log(`locations pulled for ${customerIds.length} customers: ${locations.length}`)
  console.log('')

  let withMatch = 0
  for (const g of groups) {
    const matches = findLikelyShipTos(g.primary.note, byCustomer.get(g.primary.customer_id) ?? [])
    if (matches.length > 0) withMatch += 1
    const days = Math.floor((Date.now() - new Date(g.oldestRequestedAt).getTime()) / 86_400_000)
    const note = g.primary.note.replace(/\s+/g, ' ').slice(0, 46)
    console.log(
      `[${String(g.ids.length).padStart(2)}x] ${String(days).padStart(3)}d  ` +
        `${(g.primary.customer?.name ?? '?').slice(0, 26).padEnd(26)} ${note}`
    )
    for (const m of matches) {
      console.log(`        -> SUGGEST ${m.location.name} (score ${m.score}; ${m.reasons.join(' / ')})`)
    }
  }

  console.log('')
  console.log(`groups with at least one suggestion: ${withMatch}`)
  const sum = groups.reduce((n, g) => n + g.ids.length, 0)
  console.log(`id-count check: ${sum} ids across groups vs ${rows.length} rows -> ${sum === rows.length ? 'OK' : 'MISMATCH'}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
