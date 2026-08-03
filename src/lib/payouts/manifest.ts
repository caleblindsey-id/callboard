// Turning a computed commission report into the payout_lines manifest.
//
// Pure and client-safe on purpose: it is the piece most worth testing, and it
// must not drag the server Supabase client in. The API route computes the
// report, calls this, and hands the result to fn_lock_payout_period.
//
// A MANIFEST, not a report snapshot. Every ACE entry and every earned lead gets
// its own line carrying source_id, so paying the period walks those exact ids
// instead of re-running the window query. That is what makes lock-then-pay
// drift-proof: between the two, the underlying data can change and the payment
// still goes to what was locked.

import { SUBTOTAL_BUCKETS, type CommissionReport, type CommissionRow } from '@/lib/commission/report-types'
import { roundCents } from '@/lib/commission/tiers'

export type PayoutLineInput = {
  tech_id: string
  kind: 'basis' | 'commission' | 'bonus'
  category:
    | 'labor_shop'
    | 'labor_warranty'
    | 'trip_charge'
    | 'pm_labor'
    | 'ace_labor'
    | 'commission'
    | 'pm_bonus'
    | 'equipment_bonus'
  amount: number
  source_kind?: 'ace_labor_entry' | 'tech_lead' | 'synergy_invoice' | 'manual' | null
  source_id?: string | null
  source_ref?: string | null
  rate_at_lock?: number | null
  basis_subtotal_at_lock?: number | null
  note?: string | null
}

/** A tech with nothing at all this period contributes no lines. Everyone else
 *  gets a commission line even when the payout is zero, so the snapshot records
 *  WHY it was zero: a non-commissioned tech's 0% and a $2,900 subtotal that
 *  missed the first tier are different facts and both are worth keeping. */
function hasActivity(r: CommissionRow): boolean {
  return r.subtotal !== 0 || r.pmBonus !== 0 || r.equipmentBonus !== 0
}

export function buildPayoutManifest(report: CommissionReport): PayoutLineInput[] {
  const lines: PayoutLineInput[] = []

  for (const r of report.rows) {
    if (!r.techId || !hasActivity(r)) continue

    // ----- basis: ERP labor, one line per non-zero bucket -----
    // No per-invoice granularity: synergy_labor_facts is already aggregated to
    // (synergy_id, period, bucket) by the sync, so the period is the finest
    // provenance available. source_ref carries it.
    for (const bucket of SUBTOTAL_BUCKETS) {
      const amount = r.labor[bucket]
      if (amount === 0) continue
      lines.push({
        tech_id: r.techId,
        kind: 'basis',
        category: bucket,
        amount,
        source_kind: 'synergy_invoice',
        source_ref: report.period,
      })
    }

    // ----- basis: ACE, one line per entry -----
    for (const e of r.aceEntries) {
      lines.push({
        tech_id: r.techId,
        kind: 'basis',
        category: 'ace_labor',
        amount: e.value,
        source_kind: 'ace_labor_entry',
        source_id: e.id,
        note: e.reason,
      })
    }

    // ----- the computed payout, with the tier decision frozen beside it -----
    lines.push({
      tech_id: r.techId,
      kind: 'commission',
      category: 'commission',
      amount: r.commission,
      rate_at_lock: r.rate,
      basis_subtotal_at_lock: r.subtotal,
      note: r.commissionEligible ? null : 'Not commission eligible: rate pinned to 0%.',
    })

    // ----- bonuses: flat, added after the percentage, one line per lead -----
    for (const l of r.bonusLeads) {
      lines.push({
        tech_id: r.techId,
        kind: 'bonus',
        category: l.leadType === 'pm' ? 'pm_bonus' : 'equipment_bonus',
        amount: l.amount,
        source_kind: 'tech_lead',
        source_id: l.id,
        note: [l.customer, l.equipment].filter(Boolean).join(' - ') || null,
      })
    }
  }

  return lines
}

/** What the manifest says each tech is owed. Recomputed from the lines rather
 *  than copied from the report, so a manifest that does not add up to the
 *  report is caught before it is written rather than after it is paid. */
export function manifestTotals(lines: readonly PayoutLineInput[]): {
  commission: number
  bonuses: number
  total: number
} {
  let commission = 0
  let bonuses = 0
  for (const l of lines) {
    if (l.kind === 'commission') commission = roundCents(commission + l.amount)
    else if (l.kind === 'bonus') bonuses = roundCents(bonuses + l.amount)
  }
  return { commission, bonuses, total: roundCents(commission + bonuses) }
}

/** Reasons a period must not be locked yet. Empty means it is safe.
 *
 *  These are refusals, not warnings. Locking is the step that freezes money, so
 *  anything ambiguous should be resolved while the period is still open. */
export function lockBlockers(report: CommissionReport): string[] {
  const blockers: string[] = []

  if (report.isEmpty) {
    blockers.push(
      'No Synergy labor has been synced for this period, so every subtotal is incomplete.',
    )
  }

  if (report.unmappedLabor.length > 0) {
    blockers.push(
      `${report.unmappedLabor.length} Synergy code(s) carry labor but match no CallBoard user ` +
        `(${report.unmappedLabor.map((u) => u.synergyId).join(', ')}). ` +
        'If one is a technician, their labor would be locked out of the period entirely.',
    )
  }

  return blockers
}

/** Things worth seeing before locking that do not justify blocking it.
 *
 *  Off-roster activity is the case this exists for: a manager's stray ACE entry
 *  should not hold a month's payroll hostage, but it must not be swept into the
 *  manifest either, or locking would quietly close it at $0 and the underlying
 *  mistake would never be found. */
export function lockWarnings(report: CommissionReport): string[] {
  const warnings: string[] = []

  if (report.offRosterRows.length > 0) {
    warnings.push(
      `${report.offRosterRows.length} non-technician(s) have ACE or bonus activity this period ` +
        `(${report.offRosterRows.map((r) => r.name).join(', ')}). ` +
        'They are NOT included in the lock and will keep showing until the entries are ' +
        'reassigned or rejected.',
    )
  }

  const currentPeriod = report.period
  if (report.rows.every((r) => !hasActivity(r))) {
    warnings.push(`No technician has any activity in ${currentPeriod}.`)
  }

  return warnings
}
