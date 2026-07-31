import { createClient } from '@/lib/supabase/server'
import { monthWindowUtc } from '@/lib/business-time'
import {
  commissionFor,
  distanceToNextTier,
  roundCents,
  type CommissionTier,
} from '@/lib/commission/tiers'
import {
  SUBTOTAL_BUCKETS,
  KNOWN_NON_TECH_SYNERGY_IDS,
  type CommissionReport,
  type CommissionRow,
} from '@/lib/commission/report-types'
import type { SynergyLaborBucket } from '@/types/database'

// Shapes and labels live in @/lib/commission/report-types so the client can
// import them without dragging `server-only` in through this file.
export type { CommissionReport, CommissionRow } from '@/lib/commission/report-types'

// Commission report assembly (tech payouts Round 4).
//
// Read-only and computed live from three sources. Nothing is persisted to
// payout_lines yet -- locking a period is the next step, and until then this
// report always reflects current data.
//
//   labor    synergy_labor_facts, written by scripts/sync/sync-labor-facts.py
//            from Synergy on an INVOICE-DATE basis. Synergy is the authority
//            for billed labor dollars.
//   ACE      ace_labor_entries, approved, bucketed on approved_at.
//   bonuses  tech_leads, earned, bucketed on earned_at.
//
// THE SUBTOTAL. Four ERP labor buckets plus ACE, matching the manual workbook's
// rows 6-10. Bonuses are FLAT and added AFTER the percentage (row 14) and are
// never part of the subtotal.
//
// diagnostic_fee is EXCLUDED. Caleb ruled 2026-07-31 that diagnostic fees are
// not commissioned because they are not the technician's number. Still synced,
// so the dollars reconcile against Synergy, but never on a tech's payout row.
//
// TIMEZONE. ACE and bonus timestamps are timestamptz and MUST be bucketed
// through business-time.ts. The labor side needs no anchoring: its period comes
// from invh.InvDate, a calendar date. See migration 154.
//
// SOFT DELETE is not a concern here: none of the three sources is soft-deleted.
// It becomes one the moment this reads pm_tickets or service_tickets directly.

function emptyBuckets(): Record<SynergyLaborBucket, number> {
  return {
    labor_shop: 0,
    labor_warranty: 0,
    trip_charge: 0,
    pm_labor: 0,
    diagnostic_fee: 0,
  }
}

export async function getCommissionReport(period: string): Promise<CommissionReport> {
  const supabase = await createClient()
  const [year, month] = period.split('-').map(Number)
  const win = monthWindowUtc(year, month)

  const [tierRes, userRes, laborRes, aceRes, leadRes] = await Promise.all([
    supabase
      .from('commission_tiers')
      .select('min_subtotal, max_subtotal, rate, effective_from')
      .order('min_subtotal', { ascending: true }),
    supabase
      .from('users')
      .select('id, name, synergy_id, commission_eligible, commission_rate_override'),
    supabase
      .from('synergy_labor_facts')
      .select('synergy_id, bucket, amount')
      .eq('period', period),
    supabase
      .from('ace_labor_entries')
      .select('tech_id, hours, rate_value_at_approval, status, approved_at')
      .in('status', ['approved', 'paid'])
      .gte('approved_at', win.start)
      .lt('approved_at', win.end),
    supabase
      .from('tech_leads')
      .select('submitted_by, lead_type, bonus_amount, status, earned_at')
      .in('status', ['earned', 'paid'])
      .gte('earned_at', win.start)
      .lt('earned_at', win.end),
  ])

  for (const r of [tierRes, userRes, laborRes, aceRes, leadRes]) {
    if (r.error) throw r.error
  }

  // Effective-dated: use the newest tier set that is in force. A future
  // effective_from must not govern a past period.
  const allTiers = (tierRes.data ?? []) as unknown as (CommissionTier & { effective_from: string })[]
  const periodEnd = `${year}-${String(month).padStart(2, '0')}-28`
  const inForce = allTiers.filter((t) => t.effective_from <= periodEnd)
  const newest = inForce.reduce<string | null>(
    (acc, t) => (acc === null || t.effective_from > acc ? t.effective_from : acc),
    null,
  )
  const tiers: CommissionTier[] = inForce
    .filter((t) => t.effective_from === newest)
    .map((t) => ({
      min_subtotal: Number(t.min_subtotal),
      max_subtotal: t.max_subtotal === null ? null : Number(t.max_subtotal),
      rate: Number(t.rate),
    }))

  type UserLite = {
    id: string
    name: string | null
    synergy_id: string | null
    commission_eligible: boolean
    commission_rate_override: number | null
  }
  const users = (userRes.data ?? []) as unknown as UserLite[]
  const bySynergyId = new Map<string, UserLite>()
  for (const u of users) {
    if (u.synergy_id) bySynergyId.set(String(u.synergy_id).trim(), u)
  }

  // ----- labor, keyed by synergy_id -----
  const laborBySynergy = new Map<string, Record<SynergyLaborBucket, number>>()
  for (const row of (laborRes.data ?? []) as unknown as {
    synergy_id: string
    bucket: SynergyLaborBucket
    amount: number
  }[]) {
    const key = String(row.synergy_id).trim()
    const buckets = laborBySynergy.get(key) ?? emptyBuckets()
    buckets[row.bucket] = roundCents(buckets[row.bucket] + Number(row.amount ?? 0))
    laborBySynergy.set(key, buckets)
  }

  // ----- ACE, keyed by user id. Billable value = hours x snapshotted rate -----
  const aceByTech = new Map<string, number>()
  for (const e of (aceRes.data ?? []) as unknown as {
    tech_id: string
    hours: number
    rate_value_at_approval: number | null
  }[]) {
    const value = (Number(e.rate_value_at_approval ?? 0) || 0) * (Number(e.hours) || 0)
    aceByTech.set(e.tech_id, roundCents((aceByTech.get(e.tech_id) ?? 0) + value))
  }

  // ----- bonuses, keyed by user id, split by lead type -----
  const pmBonusByTech = new Map<string, number>()
  const equipBonusByTech = new Map<string, number>()
  for (const l of (leadRes.data ?? []) as unknown as {
    submitted_by: string
    lead_type: string
    bonus_amount: number | null
  }[]) {
    const target = l.lead_type === 'pm' ? pmBonusByTech : equipBonusByTech
    target.set(
      l.submitted_by,
      roundCents((target.get(l.submitted_by) ?? 0) + Number(l.bonus_amount ?? 0)),
    )
  }

  // ----- assemble one row per commission-eligible tech -----
  const rows: CommissionRow[] = []
  for (const u of users) {
    if (!u.commission_eligible) continue

    const labor = (u.synergy_id && laborBySynergy.get(String(u.synergy_id).trim())) || emptyBuckets()
    const aceLabor = aceByTech.get(u.id) ?? 0
    const subtotal = roundCents(
      SUBTOTAL_BUCKETS.reduce((sum, b) => sum + labor[b], 0) + aceLabor,
    )

    const override = u.commission_rate_override === null ? null : Number(u.commission_rate_override)
    const { rate, commission } = commissionFor(subtotal, tiers, override)
    const pmBonus = pmBonusByTech.get(u.id) ?? 0
    const equipmentBonus = equipBonusByTech.get(u.id) ?? 0

    rows.push({
      techId: u.id,
      synergyId: u.synergy_id,
      name: u.name ?? '(unnamed)',
      commissionEligible: true,
      labor,
      aceLabor,
      subtotal,
      rate,
      rateIsOverride: override !== null,
      commission,
      pmBonus,
      equipmentBonus,
      // Bonuses are added AFTER the percentage, per the workbook's row 14.
      total: roundCents(commission + pmBonus + equipmentBonus),
      nextTier: distanceToNextTier(subtotal, tiers, override),
    })
  }

  rows.sort((a, b) => (a.synergyId ?? '').localeCompare(b.synergyId ?? ''))

  // ----- labor attributed to codes CallBoard has no user for -----
  // Split two ways. Known outside sales reps and INTERNAL are expected every
  // month and reported quietly; anything else is a code nobody has accounted
  // for, which could be a real technician, and gets a banner.
  const unmappedLabor: { synergyId: string; amount: number }[] = []
  let nonTechLabor = 0
  for (const [synergyId, buckets] of laborBySynergy) {
    if (bySynergyId.has(synergyId)) continue
    const amount = roundCents(SUBTOTAL_BUCKETS.reduce((s, b) => s + buckets[b], 0))
    if (amount === 0) continue
    if (KNOWN_NON_TECH_SYNERGY_IDS.has(synergyId)) {
      nonTechLabor = roundCents(nonTechLabor + amount)
    } else {
      unmappedLabor.push({ synergyId, amount })
    }
  }
  unmappedLabor.sort((a, b) => b.amount - a.amount)

  const totals = rows.reduce(
    (acc, r) => ({
      subtotal: roundCents(acc.subtotal + r.subtotal),
      commission: roundCents(acc.commission + r.commission),
      bonuses: roundCents(acc.bonuses + r.pmBonus + r.equipmentBonus),
      total: roundCents(acc.total + r.total),
    }),
    { subtotal: 0, commission: 0, bonuses: 0, total: 0 },
  )

  return {
    period,
    rows,
    tiers,
    totals,
    unmappedLabor,
    nonTechLabor,
    isEmpty: (laborRes.data ?? []).length === 0,
  }
}

/** Periods that have synced labor, newest first. Drives the report's picker so
 *  it can never offer a month with no data behind it. */
export async function getAvailablePeriods(): Promise<string[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('synergy_labor_facts')
    .select('period')
    .order('period', { ascending: false })
  if (error) throw error
  return [...new Set(((data ?? []) as unknown as { period: string }[]).map((r) => r.period))]
}
