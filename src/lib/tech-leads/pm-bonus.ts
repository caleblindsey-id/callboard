// Tech-lead PM bonus rules.
//
// Mirrors the payout logic in the earn_tech_lead_on_pm_completion trigger (latest:
// supabase/migrations/095_tech_lead_four_month_75pct_bonus.sql). Keep the two in
// sync: 1/2/3 (monthly/bi-monthly/quarterly) earn the full first-PM flat rate,
// 4 (four-month) earns 75%, 6 (semi-annual) earns half, 12 (annual) earns nothing.
// These helpers drive the modal previews only — the actual bonus_amount is set by
// the trigger and read as-stored on the payout page.

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

/** Dropdown suffix describing the bonus for an interval, e.g. ' — 75% bonus'. */
export function bonusSuffixForInterval(months: number | null | undefined): string {
  const rate = bonusRateForInterval(months)
  if (rate === 1) return ''
  if (rate === 0) return ' — no bonus'
  return ` — ${rate * 100}% bonus`
}
