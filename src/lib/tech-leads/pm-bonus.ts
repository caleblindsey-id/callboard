// Tech-lead PM bonus rules.
//
// Mirrors the payout logic in supabase/migrations/151_tech_lead_four_month_75_percent.sql
// (function earn_tech_lead_on_pm_completion). Keep the two in sync.
//
// The written plan ("Outside Service Technician Commission Structure", eff. 2022-11-01)
// pays on PMs PER YEAR; schedules are stored as an interval in MONTHS. The mapping:
//
//   PMs/year   interval_months   payout
//   4 or more  1, 2, 3           100% of flat_rate
//   3          4                  75%
//   2          6                  50%
//   1          12                 nothing
//
// The plan document says annual should pay 25%. Caleb ruled on 2026-07-31 that annual
// pays nothing, so practice governs and the plan text is stale on that point.
//
// These helpers drive the modal previews only — the actual bonus_amount is set by the
// trigger and read as-stored on the payout page.

export type BonusRate = 0 | 0.5 | 0.75 | 1

export function bonusRateForInterval(months: number | null | undefined): BonusRate {
  if (months === 1 || months === 2 || months === 3) return 1
  if (months === 4) return 0.75
  if (months === 6) return 0.5
  return 0
}

/** Bonus a flat-rate schedule earns at the given interval, rounded to the cent.
 *  Round-half-up matches Postgres ROUND(...,2) so the previewed amount equals what's paid. */
export function bonusAmountForInterval(months: number | null | undefined, flatRate: number): number {
  const rate = bonusRateForInterval(months)
  if (rate === 0 || !Number.isFinite(flatRate) || flatRate <= 0) return 0
  return Math.round(flatRate * rate * 100) / 100
}

/** Dropdown suffix describing the bonus for an interval, e.g. ' — half bonus'. */
export function bonusSuffixForInterval(months: number | null | undefined): string {
  const rate = bonusRateForInterval(months)
  if (rate === 1) return ''
  if (rate === 0.75) return ' — 75% bonus'
  if (rate === 0.5) return ' — half bonus'
  return ' — no bonus'
}
