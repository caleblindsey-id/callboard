// Per-line gross-margin floor for service-ticket pricing.
//
// Rule (set by Caleb): a part line's price can never be set so that gross margin
// falls below 15% OF PRICE. Equivalently, price must be at least loaded cost
// divided by (1 - 0.15) = cost / 0.85.
//
//   margin% = (price - cost) / price        floor: margin% >= 0.15
//   <=>  price >= cost / (1 - 0.15)          minPrice(cost) = cost / 0.85
//
// Scope is PARTS ONLY — labor and diagnostic charges are excluded.
//
// Enforcement is server-side and re-derives cost from the products catalog by
// synergy_product_id; a client-submitted unit_cost is NEVER trusted for the
// floor. When a line's cost is unknown (manual part with no catalog match, or
// a product whose unit_cost hasn't synced) the floor is NOT enforced and the
// line is flagged "cost unknown" in the UI.

export const MARGIN_FLOOR = 0.15

// A manager may approve a price below the 15% floor, but NEVER below loaded
// cost. Re-running the same checks with this floor (0% margin) makes the
// minimum price equal to cost — the absolute, un-overridable limit.
export const COST_FLOOR = 0

// Currency comparisons round to cents; this absolute tolerance keeps a price
// that is exactly at the floor (after rounding) from being rejected.
const EPSILON = 0.005

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function toCost(unitCost: number | null | undefined): number | null {
  if (unitCost == null) return null
  const n = Number(unitCost)
  // A non-finite or non-positive cost is treated as unknown — we can't build a
  // meaningful floor from it (and a 0 cost would let any price through anyway).
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

/**
 * Minimum allowed unit price for a given loaded cost, rounded to cents.
 * Returns null when cost is unknown (floor not enforceable). The `floor`
 * defaults to the 15% margin floor; pass COST_FLOOR (0) for the loaded-cost
 * limit used by an approved manager override.
 */
export function minPrice(
  unitCost: number | null | undefined,
  floor: number = MARGIN_FLOOR,
): number | null {
  const cost = toCost(unitCost)
  if (cost === null) return null
  return round2(cost / (1 - floor))
}

export interface LineMarginResult {
  ok: boolean
  /** Cost unknown — floor not enforced for this line. */
  unknown: boolean
  /** Minimum allowed price (cents), or null when cost is unknown. */
  minPrice: number | null
}

/**
 * Evaluate one line's price against the margin floor.
 * Unknown cost => { ok: true, unknown: true } (allowed, flagged elsewhere).
 */
export function lineMarginOk(
  unitPrice: number,
  unitCost: number | null | undefined,
  floor: number = MARGIN_FLOOR,
): LineMarginResult {
  const min = minPrice(unitCost, floor)
  if (min === null) return { ok: true, unknown: true, minPrice: null }
  const price = Number(unitPrice)
  const ok = Number.isFinite(price) && price + EPSILON >= min
  return { ok, unknown: false, minPrice: min }
}

export interface PartLineInput {
  synergy_product_id?: number | null
  description?: string
  unit_price: number
}

export interface LineViolation {
  index: number
  description: string
  unitPrice: number
  minPrice: number
}

export interface PartLinesCheck {
  ok: boolean
  /** Lines below their floor (known cost only). */
  violations: LineViolation[]
  /** Count of lines whose cost is unknown (floor not enforced). */
  unknownCount: number
}

/**
 * Check every part line against the floor, sourcing cost from `costLookup`
 * keyed by synergy_product_id. Lines with no product id or no looked-up cost
 * are treated as unknown (allowed). Returns the set of known-cost violations.
 *
 * `costLookup` MUST be built from the authoritative products table on the
 * server — do not pass client-supplied costs.
 */
export function checkPartLines(
  lines: PartLineInput[],
  costLookup: (synergyProductId: number) => number | null | undefined,
  floor: number = MARGIN_FLOOR,
): PartLinesCheck {
  const violations: LineViolation[] = []
  let unknownCount = 0

  lines.forEach((line, index) => {
    const cost =
      line.synergy_product_id != null ? costLookup(line.synergy_product_id) : null
    const res = lineMarginOk(line.unit_price, cost, floor)
    if (res.unknown) {
      unknownCount += 1
      return
    }
    if (!res.ok && res.minPrice !== null) {
      violations.push({
        index,
        description: line.description || `Line ${index + 1}`,
        unitPrice: Number(line.unit_price),
        minPrice: res.minPrice,
      })
    }
  })

  return { ok: violations.length === 0, violations, unknownCount }
}
