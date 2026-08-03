import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { roundCents } from '@/lib/commission/tiers'
import { SUBTOTAL_BUCKETS, type CommissionReport } from '@/lib/commission/report-types'
import { buildPayoutManifest, type PayoutLineInput } from '@/lib/payouts/manifest'
import type { PayoutDrift, PayoutPeriodState, PayoutPeriodStatus } from '@/lib/payouts/period-types'
import type { SynergyLaborBucket } from '@/types/database'

// The payout period as an object: draft -> locked -> paid.
//
// A draft period does not exist as a row. It is simply a period nobody has
// locked yet, and it recomputes live. Locking creates the payout_periods row
// and the payout_lines manifest; from that point the report reads the snapshot.
//
// Shapes live in @/lib/payouts/period-types so the client can import them
// without dragging `server-only` in through this file.
export type { PayoutDrift, PayoutPeriodState, PayoutPeriodStatus } from '@/lib/payouts/period-types'

const DRAFT = (period: string): PayoutPeriodState => ({
  period,
  status: 'draft',
  lockedAt: null,
  lockedBy: null,
  paidAt: null,
  paidBy: null,
})

export async function getPayoutPeriod(period: string): Promise<PayoutPeriodState> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('payout_periods')
    .select('period, status, locked_at, paid_at, locked_by:users!payout_periods_locked_by_id_fkey(name), paid_by:users!payout_periods_paid_by_id_fkey(name)')
    .eq('period', period)
    .maybeSingle()

  if (error) throw error
  if (!data) return DRAFT(period)

  const row = data as unknown as {
    period: string
    status: PayoutPeriodStatus
    locked_at: string | null
    paid_at: string | null
    locked_by: { name: string | null } | null
    paid_by: { name: string | null } | null
  }

  return {
    period: row.period,
    status: row.status,
    lockedAt: row.locked_at,
    lockedBy: row.locked_by?.name ?? null,
    paidAt: row.paid_at,
    paidBy: row.paid_by?.name ?? null,
  }
}

/** Every period that has ever been locked, so the picker can badge them. */
export async function getLockedPeriods(): Promise<Record<string, PayoutPeriodStatus>> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('payout_periods').select('period, status')
  if (error) throw error
  const out: Record<string, PayoutPeriodStatus> = {}
  for (const r of (data ?? []) as unknown as { period: string; status: PayoutPeriodStatus }[]) {
    out[r.period] = r.status
  }
  return out
}

type LineRow = {
  tech_id: string
  kind: 'basis' | 'commission' | 'bonus'
  category: string
  amount: number
  source_kind: string | null
  source_id: string | null
  rate_at_lock: number | null
  basis_subtotal_at_lock: number | null
  note: string | null
}

/** Rebuild a report from a locked period's snapshot.
 *
 *  This is the whole point of locking: a locked month is read from payout_lines
 *  and can no longer be moved by a Synergy resync, a reopened ticket, or an ACE
 *  approval that lands late. `liveReport` supplies the tech roster (names,
 *  synergy ids, eligibility) and the tier table for display, but not a single
 *  dollar figure -- every amount below comes from the snapshot. */
export async function getLockedReport(
  period: string,
  liveReport: CommissionReport,
): Promise<CommissionReport> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('payout_lines')
    .select(
      'tech_id, kind, category, amount, source_kind, source_id, rate_at_lock, basis_subtotal_at_lock, note, payout_periods!inner(period)',
    )
    .eq('payout_periods.period', period)

  if (error) throw error
  const lines = (data ?? []) as unknown as LineRow[]

  const byTech = new Map<string, LineRow[]>()
  for (const l of lines) {
    const list = byTech.get(l.tech_id) ?? []
    list.push(l)
    byTech.set(l.tech_id, list)
  }

  const rows = liveReport.rows
    .filter((r) => r.techId && byTech.has(r.techId))
    .map((r) => {
      const mine = byTech.get(r.techId!)!
      const labor = {
        labor_shop: 0,
        labor_warranty: 0,
        trip_charge: 0,
        pm_labor: 0,
        diagnostic_fee: 0,
      } as Record<SynergyLaborBucket, number>
      let aceLabor = 0
      let commission = 0
      let pmBonus = 0
      let equipmentBonus = 0
      let rate = 0
      let subtotal = 0

      for (const l of mine) {
        const amt = Number(l.amount)
        if (l.kind === 'basis') {
          if (l.category === 'ace_labor') aceLabor = roundCents(aceLabor + amt)
          else labor[l.category as SynergyLaborBucket] = roundCents(
            labor[l.category as SynergyLaborBucket] + amt,
          )
        } else if (l.kind === 'commission') {
          commission = roundCents(commission + amt)
          rate = Number(l.rate_at_lock ?? 0)
          subtotal = Number(l.basis_subtotal_at_lock ?? 0)
        } else if (l.category === 'pm_bonus') {
          pmBonus = roundCents(pmBonus + amt)
        } else {
          equipmentBonus = roundCents(equipmentBonus + amt)
        }
      }

      // Detail comes from the snapshot's source ids, matched back to the live
      // rows for their labels. An entry that has since been edited shows its
      // locked amount with its current description, which is the right trade:
      // the money is frozen, the wording is not worth freezing.
      const lockedAceIds = new Set(
        mine.filter((l) => l.source_kind === 'ace_labor_entry').map((l) => l.source_id),
      )
      const lockedLeadIds = new Set(
        mine.filter((l) => l.source_kind === 'tech_lead').map((l) => l.source_id),
      )

      const lockedEntries = r.aceEntries.filter((e) => lockedAceIds.has(e.id))

      return {
        ...r,
        labor,
        aceLabor,
        // Hours follow the snapshot's entries, not the live window, so a
        // locked month reports the hours it was locked with.
        aceHours: Math.round(lockedEntries.reduce((h, e) => h + e.hours, 0) * 100) / 100,
        aceEntries: lockedEntries,
        bonusLeads: r.bonusLeads.filter((l) => lockedLeadIds.has(l.id)),
        subtotal,
        rate,
        commission,
        pmBonus,
        equipmentBonus,
        total: roundCents(commission + pmBonus + equipmentBonus),
        // A locked period is settled. "You are $80 from the next tier" is
        // advice for a month still in play.
        nextTier: null,
      }
    })

  const totals = rows.reduce(
    (acc, r) => ({
      subtotal: roundCents(acc.subtotal + r.subtotal),
      commission: roundCents(acc.commission + r.commission),
      bonuses: roundCents(acc.bonuses + r.pmBonus + r.equipmentBonus),
      total: roundCents(acc.total + r.total),
    }),
    { subtotal: 0, commission: 0, bonuses: 0, total: 0 },
  )

  return { ...liveReport, rows, totals, isEmpty: lines.length === 0 }
}

/** Whether the live numbers have moved away from what was locked.
 *
 *  A locked period is paid from its snapshot, so drift changes nothing on its
 *  own. It is surfaced because it is the signal that something arrived late --
 *  a Synergy invoice posted after the close, a ticket reopened and rebilled --
 *  and that something now belongs to the next open period. Silent would be
 *  worse than noisy here. */
export function detectDrift(locked: CommissionReport, live: CommissionReport): PayoutDrift[] {
  const liveByTech = new Map(live.rows.filter((r) => r.techId).map((r) => [r.techId!, r]))
  const out: PayoutDrift[] = []

  for (const l of locked.rows) {
    if (!l.techId) continue
    const now = liveByTech.get(l.techId)
    // Compare the commissioned subtotal, not the payout: a subtotal that moves
    // without crossing a tier still means dollars arrived late.
    const liveSubtotal = now?.subtotal ?? 0
    if (roundCents(liveSubtotal - l.subtotal) !== 0) {
      out.push({
        techId: l.techId,
        name: l.name,
        lockedTotal: l.subtotal,
        liveTotal: liveSubtotal,
      })
    }
  }
  return out
}

export type LockResult =
  | { ok: true; periodId: string; lineCount: number }
  | { ok: false; code: string; message: string }

/** Freeze a period. `report` must be the live report for that same period. */
export async function lockPayoutPeriod(
  period: string,
  userId: string,
  report: CommissionReport,
): Promise<LockResult> {
  const lines: PayoutLineInput[] = buildPayoutManifest(report)
  if (lines.length === 0) {
    return { ok: false, code: 'NO_LINES', message: 'Nothing to lock in this period.' }
  }

  // Service role: payout_lines is RLS'd to super_admin + manager and the route
  // has already checked the role. The payload is built server-side and never
  // round-trips through a browser.
  const admin = await createAdminClient('SERVER_ONLY')
  const { data, error } = await admin.rpc('fn_lock_payout_period', {
    p_period: period,
    p_user: userId,
    p_lines: lines,
  })

  if (error) {
    const code = (error.message.match(/^([A-Z_]+):/) ?? [])[1] ?? 'LOCK_FAILED'
    return { ok: false, code, message: error.message }
  }
  return { ok: true, periodId: data as unknown as string, lineCount: lines.length }
}

export type PayResult =
  | { ok: true; leadsPaid: number; acePaid: number }
  | { ok: false; code: string; message: string }

/** Settle a locked period: commission, lead bonuses, and the ACE labor that fed
 *  the subtotal, all in one transaction against the locked manifest. */
export async function payPayoutPeriod(period: string, userId: string): Promise<PayResult> {
  const admin = await createAdminClient('SERVER_ONLY')
  const { data, error } = await admin.rpc('fn_pay_payout_period', {
    p_period: period,
    p_user: userId,
  })

  if (error) {
    const code = (error.message.match(/^([A-Z_]+):/) ?? [])[1] ?? 'PAY_FAILED'
    return { ok: false, code, message: error.message }
  }
  const res = data as unknown as { leads_paid: number; ace_paid: number }
  return { ok: true, leadsPaid: res?.leads_paid ?? 0, acePaid: res?.ace_paid ?? 0 }
}

export async function unlockPayoutPeriod(
  period: string,
  userId: string,
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  const admin = await createAdminClient('SERVER_ONLY')
  const { error } = await admin.rpc('fn_unlock_payout_period', {
    p_period: period,
    p_user: userId,
  })
  if (error) {
    const code = (error.message.match(/^([A-Z_]+):/) ?? [])[1] ?? 'UNLOCK_FAILED'
    return { ok: false, code, message: error.message }
  }
  return { ok: true }
}

/** Buckets a locked report exposes, kept beside SUBTOTAL_BUCKETS so a bucket
 *  added to one is a type error in the other rather than a silent omission. */
export const LOCKED_BASIS_CATEGORIES = [...SUBTOTAL_BUCKETS, 'ace_labor'] as const
