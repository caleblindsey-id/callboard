// Sales-tax math for customer-facing estimates and work orders.
//
// Rule (set by Caleb): tax applies to PARTS ONLY — labor, trip charge, and
// diagnostic fee are non-taxable (standard AL separately-stated repair-service
// treatment). Exempt customers (Synergy TaxType=2) are never taxed.
//
// The rate rides the nightly Synergy sync and is denormalized onto the customer
// row (migration 133): customers.tax_rate is the jurisdiction percent (e.g.
// 7.7500) and customers.tax_exempt mirrors TaxType=2.
//
// This is DISPLAY-ONLY. The stored billing_amount that flows to Synergy stays
// pre-tax; Synergy applies the authoritative tax when the invoice is keyed.
// Mirrors how src/lib/margin.ts centralizes the parts margin-floor math.

export interface CustomerTaxProfile {
  tax_rate?: number | null
  tax_exempt?: boolean | null
}

/**
 * Effective tax rate as a fraction (0..1). Returns 0 for exempt customers or
 * when no rate is on file. e.g. tax_rate 7.75 -> 0.0775.
 */
export function effectiveTaxRate(c: CustomerTaxProfile | null | undefined): number {
  if (!c || c.tax_exempt || c.tax_rate == null) return 0
  const pct = Number(c.tax_rate)
  if (!Number.isFinite(pct) || pct <= 0) return 0
  return pct / 100
}

/**
 * Tax on a parts subtotal at the given fractional rate, rounded to cents.
 * Parts only — never pass labor, trip, or diagnostic into this.
 */
export function computePartsTax(partsSubtotal: number, rate: number): number {
  const base = Number(partsSubtotal)
  if (!Number.isFinite(base) || base <= 0 || rate <= 0) return 0
  return Math.round(base * rate * 100) / 100
}

/**
 * Display percent for a customer's effective rate, e.g. 7.75 (0 when exempt).
 * Used to label the "Sales Tax (7.75%)" line.
 */
export function taxRatePercent(c: CustomerTaxProfile | null | undefined): number {
  return Math.round(effectiveTaxRate(c) * 100 * 10000) / 10000
}
