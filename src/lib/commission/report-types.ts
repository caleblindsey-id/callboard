// Shapes and labels shared between the commission query (server) and the
// commission tab (client).
//
// This file exists SPECIFICALLY so the client can import them. Putting them in
// src/lib/db/commission.ts would drag @/lib/supabase/server -- which is
// `server-only` and throws at import time -- into the client bundle, and the
// build fails with a "Client Component" import trace rather than a useful
// error. Same trap as src/lib/pm-tickets/pm-notify-rules.ts.
//
// Keep this file free of any server import, forever.

import type { NextTier } from './tiers'
import type { CommissionTier } from './tiers'
import type { SynergyLaborBucket } from '@/types/database'

/** Buckets that feed the tiered subtotal. Order drives the report columns.
 *
 *  diagnostic_fee is deliberately ABSENT: it has never been on the manual
 *  workbook. It was $0 in June 2026 so nobody had to decide, but July carries
 *  real values, so the report surfaces it in its own column rather than
 *  silently dropping or silently commissioning it. If it is ruled
 *  commissionable, adding it here is the only change needed. */
export const SUBTOTAL_BUCKETS: SynergyLaborBucket[] = [
  'labor_shop',
  'labor_warranty',
  'trip_charge',
  'pm_labor',
]

export const BUCKET_LABEL: Record<SynergyLaborBucket, string> = {
  labor_shop: 'Non-warranty',
  labor_warranty: 'Warranty',
  trip_charge: 'Trip charge',
  pm_labor: 'PM labor',
  diagnostic_fee: 'Diagnostic',
}

export type CommissionRow = {
  techId: string | null
  synergyId: string | null
  name: string
  commissionEligible: boolean
  /** Per-bucket ERP labor for the period. */
  labor: Record<SynergyLaborBucket, number>
  aceLabor: number
  /** labor buckets in SUBTOTAL_BUCKETS + aceLabor. */
  subtotal: number
  rate: number
  rateIsOverride: boolean
  commission: number
  pmBonus: number
  equipmentBonus: number
  /** commission + bonuses. What actually reaches the check. */
  total: number
  nextTier: NextTier | null
  /** Captured, not commissioned. Surfaced so a nonzero value is visible. */
  diagnosticFee: number
}

export type CommissionReport = {
  period: string
  rows: CommissionRow[]
  tiers: CommissionTier[]
  totals: {
    subtotal: number
    commission: number
    bonuses: number
    total: number
  }
  /** Labor the ERP attributed to a synergy_id no CallBoard user carries. These
   *  can never reach a payout; surfaced so the gap is visible rather than a
   *  silent shortfall. This is why synergy_labor_facts has no FK to users. */
  unmappedLabor: { synergyId: string; amount: number }[]
  /** True when no labor has been synced for the period at all. */
  isEmpty: boolean
}
