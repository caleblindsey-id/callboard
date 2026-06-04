// Tech-lead PM bonus rules.
//
// Mirrors the payout logic in supabase/migrations/094_tech_lead_half_bonus_six_month.sql
// (function earn_tech_lead_on_pm_completion). Keep the two in sync: 1/2/3 (monthly/
// bi-monthly/quarterly) earn the full first-PM flat rate, 6 (semi-annual) earns half,
// 4 and 12 earn nothing. These helpers drive the modal previews only — the actual
// bonus_amount is set by the trigger and read as-stored on the payout page.

export type BonusRate = 0 | 0.5 | 1

export function bonusRateForInterval(months: number | null | undefined): BonusRate {
  if (months === 1 || months === 2 || months === 3) return 1
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
  if (rate === 0.5) return ' — half bonus'
  return ' — no bonus'
}
