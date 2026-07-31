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
 *  diagnostic_fee is deliberately ABSENT. Caleb ruled 2026-07-31 that
 *  diagnostic fees are NOT commissioned: they are not the technician's number.
 *  It is still synced (so the dollars exist and reconcile against Synergy) but
 *  it is not shown on a per-tech payout row either, because putting it there
 *  would imply the tech owns it. Do not add it here. */
export const SUBTOTAL_BUCKETS: SynergyLaborBucket[] = [
  'labor_shop',
  'labor_warranty',
  'trip_charge',
  'pm_labor',
]

/** Synergy salesman codes that carry service labor but are NOT technicians, so
 *  their dollars can never reach a tech payout. Verified against the ERP
 *  `sslsm` master 2026-07-31 and confirmed by Caleb ("those are not tech
 *  numbers"):
 *
 *    7    Stanley Burt      outside sales rep
 *    9    Andye Bramlett    outside sales rep
 *    38   Tommy Mayson      outside sales rep
 *    200  Tim Adams         outside sales rep
 *    999  INTERNAL          internal / house account
 *
 *  These are filtered out of the report's unmapped-labor warning so it does not
 *  cry wolf every month with the same non-actionable names. A code NOT on this
 *  list and NOT matched to a CallBoard user still raises the banner, which is
 *  the case actually worth investigating: a real technician nobody mapped. */
export const KNOWN_NON_TECH_SYNERGY_IDS = new Set(['7', '9', '38', '200', '999'])

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
  /** Labor the ERP attributed to a synergy_id no CallBoard user carries AND
   *  which is not a known non-tech. These can never reach a payout; surfaced so
   *  the gap is visible rather than a silent shortfall. This is why
   *  synergy_labor_facts has no FK to users. */
  unmappedLabor: { synergyId: string; amount: number }[]
  /** Service labor invoiced under a known outside sales rep or INTERNAL. Not a
   *  problem and not a tech's money, but reported quietly so the difference
   *  between the report's total and Synergy's is always explainable. */
  nonTechLabor: number
  /** True when no labor has been synced for the period at all. */
  isEmpty: boolean
}
