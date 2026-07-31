// Commission tier math.
//
// THE ONE THING TO UNDERSTAND: the rate applies to the WHOLE subtotal, so tier
// boundaries are CLIFFS, not brackets. A tech at $7,499.99 earns $375.00; at
// $7,500.00 they earn $562.50. Crossing one boundary by a cent is worth $187.50.
//
// That is why Round 1 spent its effort on penny accuracy: attributing labor to
// invl.Slsm instead of invh.Slsm1 was a 3% error in one tech's subtotal and a
// 62% error in his commission. It is also why the report surfaces
// distanceToNextTier during the month -- a tech $80 short of a boundary should
// know while they can still do something about it.
//
// Bands are half-open [min, max) with max null meaning unbounded, seeded by
// migration 153 from the written plan effective 2022-11-01. Bonuses (PM sale,
// equipment sale) are FLAT and added AFTER the percentage, per the workbook's
// row 14 -- they are not part of the commissioned subtotal and must never be
// folded into it.
//
// Pure and dependency-free so it is directly unit-testable and safe on the
// client. No imports that pull in `server-only`.

export type CommissionTier = {
  min_subtotal: number
  /** EXCLUSIVE upper bound. null = unbounded. */
  max_subtotal: number | null
  /** Fraction, not percent: 0.025 = 2.5%. */
  rate: number
}

/**
 * Round to cents the way Postgres ROUND(numeric, 2) does: half away from zero.
 *
 * Math.round is half toward +Infinity, which disagrees with Postgres on
 * negative halves (Math.round(-0.5) === -0, Postgres ROUND(-0.5) === -1).
 * Amounts here can be negative -- Synergy Status 31 credit memos net against
 * invoices -- so the difference is reachable, and a previewed number that
 * disagrees with the stored one is the exact failure this codebase already
 * guards against in src/lib/tech-leads/pm-bonus.ts.
 */
export function roundCents(value: number): number {
  if (!Number.isFinite(value)) return 0
  const scaled = value * 100
  // Nudge for binary representation error before the half-away-from-zero step,
  // so 1.005 * 100 = 100.49999999999999 still rounds to 101.
  const eps = Math.sign(scaled) * 1e-9
  return Math.sign(scaled) * Math.round(Math.abs(scaled + eps)) / 100
}

/** Tiers sorted by min_subtotal ascending. Defensive: callers pass DB rows. */
function sorted(tiers: CommissionTier[]): CommissionTier[] {
  return [...tiers].sort((a, b) => a.min_subtotal - b.min_subtotal)
}

/**
 * The tier a subtotal falls in, or null if none matches (which means the tier
 * table has a gap and the caller should NOT silently pay zero).
 */
export function tierForSubtotal(
  subtotal: number,
  tiers: CommissionTier[],
): CommissionTier | null {
  for (const t of sorted(tiers)) {
    const aboveMin = subtotal >= t.min_subtotal
    const belowMax = t.max_subtotal === null || subtotal < t.max_subtotal
    if (aboveMin && belowMax) return t
  }
  return null
}

/** Convenience: the rate for a subtotal, 0 when no tier matches. */
export function rateForSubtotal(subtotal: number, tiers: CommissionTier[]): number {
  return tierForSubtotal(subtotal, tiers)?.rate ?? 0
}

/**
 * Dollars a subtotal earns. `rateOverride` (users.commission_rate_override)
 * REPLACES the tier lookup entirely when set -- it is a negotiated off-table
 * rate, not a modifier.
 */
export function commissionFor(
  subtotal: number,
  tiers: CommissionTier[],
  rateOverride?: number | null,
): { rate: number; commission: number } {
  const rate = rateOverride ?? rateForSubtotal(subtotal, tiers)
  return { rate, commission: roundCents(subtotal * rate) }
}

export type NextTier = {
  /** Subtotal at which the next rate starts. */
  threshold: number
  /** Dollars still needed to reach it. Always > 0. */
  amountAway: number
  /** The rate on the other side. */
  nextRate: number
  /** Extra commission from crossing, at exactly the threshold. */
  gain: number
}

/**
 * How far a subtotal is from the next rate up, or null if already in the top
 * tier (or the table has no higher band).
 *
 * `gain` is the honest number to show: it is the jump in TOTAL commission from
 * landing exactly on the threshold, not the marginal rate on the extra dollars.
 * Because the rate applies to the whole subtotal, earning the last $80 to reach
 * $7,500 is worth $187.50, not $6. Showing the marginal figure would understate
 * it by 30x and defeat the point of surfacing this at all.
 */
export function distanceToNextTier(
  subtotal: number,
  tiers: CommissionTier[],
  rateOverride?: number | null,
): NextTier | null {
  // An override means the tier table does not govern this tech, so there is no
  // boundary to chase.
  if (rateOverride != null) return null

  const current = tierForSubtotal(subtotal, tiers)
  if (!current || current.max_subtotal === null) return null

  const next = sorted(tiers).find((t) => t.min_subtotal === current.max_subtotal)
  if (!next || next.rate <= current.rate) return null

  const threshold = current.max_subtotal
  const amountAway = roundCents(threshold - subtotal)
  if (amountAway <= 0) return null

  const currentCommission = roundCents(subtotal * current.rate)
  const atThreshold = roundCents(threshold * next.rate)
  return {
    threshold,
    amountAway,
    nextRate: next.rate,
    gain: roundCents(atThreshold - currentCommission),
  }
}

/** '2.5%' — tier rates are quarter-percent steps, so one decimal is enough. */
export function formatRate(rate: number): string {
  const pct = rate * 100
  return `${Number.isInteger(pct) ? pct : pct.toFixed(1)}%`
}
