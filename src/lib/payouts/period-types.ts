// Payout period shapes shared between the server query and the client tab.
//
// Same reason report-types.ts exists: src/lib/db/payouts.ts imports the
// server-only Supabase client, which throws at import time, and pulling it into
// a client component fails the build with a Client Component import trace
// rather than a useful error. `import type` is erased by SWC, but relying on
// that is a footgun one careless edit away from a real import.
//
// Keep this file free of any server import, forever.

export type PayoutPeriodStatus = 'draft' | 'locked' | 'paid'

export type PayoutPeriodState = {
  period: string
  status: PayoutPeriodStatus
  lockedAt: string | null
  /** Display name, not an id. */
  lockedBy: string | null
  paidAt: string | null
  paidBy: string | null
}

/** A tech whose live subtotal has moved away from what was locked.
 *
 *  Drift changes nothing about what gets paid -- a locked period pays from its
 *  snapshot. It is the signal that dollars arrived after the close and now
 *  belong to the next open period. */
export type PayoutDrift = {
  techId: string
  name: string
  lockedTotal: number
  liveTotal: number
}

export const PERIOD_STATUS_LABEL: Record<PayoutPeriodStatus, string> = {
  draft: 'Open',
  locked: 'Locked',
  paid: 'Paid',
}
