import type { ShipToRequestWithJoins } from '@/lib/db/ship-to-requests'

// Techs raise a ship-to request from the field, and they raise the same one more
// than once when nothing visibly happens. The live backlog on 2026-08-24 held 14
// pending rows, five of which were one HEALTHSOUTH address submitted by one tech
// on one day, differing only in the capitalisation of "Ridgeway". Fourteen rows
// were really ten distinct asks.
//
// So the queue groups before it renders. The office resolves the address once and
// every request for it closes together, which is both less clicking and a more
// honest backlog count.

/** Lowercase, strip punctuation, collapse whitespace. The grouping key's core. */
export function normalizeNote(note: string): string {
  return note
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Group key: same customer AND same normalized note. Customer is part of the key
 * because two customers can legitimately share an address string (a strip mall,
 * a school board and its schools), and those are genuinely separate asks.
 */
export function groupKey(row: Pick<ShipToRequestWithJoins, 'customer_id' | 'note'>): string {
  return `${row.customer_id}::${normalizeNote(row.note)}`
}

export type ShipToRequestGroup = {
  key: string
  /** Every request id in this group. Actions apply to all of them. */
  ids: number[]
  /** The oldest request, used for display and for the aging clock. */
  primary: ShipToRequestWithJoins
  rows: ShipToRequestWithJoins[]
  count: number
  /** ISO timestamp of the OLDEST request in the group, not the newest. */
  oldestRequestedAt: string
  /** Distinct requester names, oldest first. Usually one. */
  requesterNames: string[]
}

/**
 * Collapse rows into groups, oldest group first.
 *
 * Aging is measured from the OLDEST request in a group. A tech re-asking does not
 * reset the clock: the office has been sitting on that address since the first ask,
 * and sorting by the newest would push the most-nagged item DOWN the list.
 */
export function groupShipToRequests(rows: ShipToRequestWithJoins[]): ShipToRequestGroup[] {
  const byKey = new Map<string, ShipToRequestWithJoins[]>()

  for (const row of rows) {
    const key = groupKey(row)
    const bucket = byKey.get(key)
    if (bucket) bucket.push(row)
    else byKey.set(key, [row])
  }

  const groups: ShipToRequestGroup[] = []
  for (const [key, bucket] of byKey) {
    const ordered = [...bucket].sort(
      (a, b) => new Date(a.requested_at).getTime() - new Date(b.requested_at).getTime()
    )
    const names: string[] = []
    for (const r of ordered) {
      const name = r.requested_by_user?.name
      if (name && !names.includes(name)) names.push(name)
    }
    groups.push({
      key,
      ids: ordered.map((r) => r.id),
      primary: ordered[0],
      rows: ordered,
      count: ordered.length,
      oldestRequestedAt: ordered[0].requested_at,
      requesterNames: names,
    })
  }

  return groups.sort(
    (a, b) =>
      new Date(a.oldestRequestedAt).getTime() - new Date(b.oldestRequestedAt).getTime()
  )
}
