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
export type CommissionedBucket = Exclude<SynergyLaborBucket, 'diagnostic_fee'>

export const SUBTOTAL_BUCKETS: CommissionedBucket[] = [
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

/** One approved ACE entry behind a tech's ACE column.
 *
 *  Carried per row for two reasons: the payout table can itemise what makes up
 *  the number, and locking a period needs the entry ids to write payout_lines
 *  as a manifest. Paying then walks that manifest instead of re-querying, so
 *  nothing can drift between lock and pay. */
export type AceDetail = {
  id: string
  hours: number
  /** rate_value_at_approval, snapshotted so a settings change cannot restate. */
  rate: number
  value: number
  approvedAt: string | null
  reason: string | null
}

/** One earned lead behind a tech's bonus column. Same manifest role as AceDetail. */
export type BonusDetail = {
  id: string
  leadType: string
  customer: string | null
  equipment: string | null
  amount: number
  earnedAt: string | null
}

export type CommissionRow = {
  techId: string | null
  synergyId: string | null
  name: string
  /** Drives the rate. Eligible techs resolve through commission_tiers (or their
   *  own override); everyone else is pinned to 0% and pays nothing, which is
   *  what the workbook does with a hardcoded 0 in H12/K12. Toggled per user in
   *  Settings → Rates & Billing → Commission. */
  commissionEligible: boolean
  /** users.role. A row can be non-technician when a manager or coordinator has
   *  ACE or bonus activity in the period — real in prod, and something that was
   *  invisible before this row existed. */
  role: string | null
  /** Per-bucket ERP labor for the period. */
  labor: Record<SynergyLaborBucket, number>
  aceLabor: number
  /** Approved ACE hours for the period, whether or not they pay anything.
   *
   *  Tracked for EVERY tech including the non-commissioned ones: their ACE
   *  labor earns $0 (a 0% rate on the subtotal it feeds), but the hours are
   *  still real work done and worth seeing. Dollars alone hide that, because
   *  for those techs the dollars are always zero. */
  aceHours: number
  /** The individual entries summing to aceLabor. */
  aceEntries: AceDetail[]
  /** The individual leads summing to pmBonus + equipmentBonus. */
  bonusLeads: BonusDetail[]
  /** labor buckets in SUBTOTAL_BUCKETS + aceLabor. */
  subtotal: number
  rate: number
  rateIsOverride: boolean
  commission: number
  pmBonus: number
  equipmentBonus: number
  /** commission + bonuses. What actually reaches the check. */
  total: number
  /** Null when the tech is not commission-eligible: there is no next tier to
   *  reach when the rate is pinned to zero. */
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
  /** Rows for people who are not technicians but carry ACE or bonus activity in
   *  this period. Split out so the payout table stays a payout table while the
   *  dollars stay visible instead of being dropped on the floor. */
  offRosterRows: CommissionRow[]
  /** True when no labor has been synced for the period at all. */
  isEmpty: boolean
}
