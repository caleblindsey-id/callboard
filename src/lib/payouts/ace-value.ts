// What an ACE labor entry is worth.
//
// ACE labor is a commission BASIS, not a payment. It lands on row 10 of the
// manual workbook, inside the tiered subtotal, and pays at whatever rate the
// tech's subtotal resolves to. A tech who is not commission-eligible earns
// nothing on it. "Mark ACE paid" has always meant "this period is closed", not
// "we cut a cheque for the billable value".
//
// This formula was written twice: once in src/lib/db/commission.ts through
// roundCents, and once inline in PayoutReport.tsx as a raw float sum rendered
// with .toFixed(2). Sub-cent divergence between the two reports for the same
// month was reachable. This is now the only copy.
//
// Client-safe: no server import belongs in here.

import { roundCents } from '@/lib/commission/tiers'

export type AceValueSource = {
  hours: number | string | null
  /** Snapshotted at approval so a later settings change cannot restate a
   *  closed month. NULL on a still-pending entry, which is worth nothing yet. */
  rate_value_at_approval: number | string | null
}

/** Billable value of one entry: hours x the rate snapshotted at approval. */
export function aceBillableValue(entry: AceValueSource): number {
  const rate = Number(entry.rate_value_at_approval ?? 0)
  const hours = Number(entry.hours ?? 0)
  if (!Number.isFinite(rate) || !Number.isFinite(hours)) return 0
  return roundCents(rate * hours)
}

/** Billable value of many entries. Rounds once per entry, then sums, matching
 *  how the workbook is keyed and how Postgres would sum the same rows. */
export function aceBillableTotal(entries: readonly AceValueSource[]): number {
  return roundCents(entries.reduce((sum, e) => sum + aceBillableValue(e), 0))
}
