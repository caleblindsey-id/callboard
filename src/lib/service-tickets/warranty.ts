// Warranty review lifecycle (migration 160).
//
// Warranty moves from a pricing switch (billing_type) to a review -> claim ->
// reconcile lifecycle. Tickets always complete at full price (billing_amount
// stays the full-price claim artifact the vendor requires); the office
// verifies coverage, files the claim, and reconciles the vendor credit
// line-by-line. customer_bill_amount carries the post-coverage customer
// total; NULL means "same as billing_amount".
//
// This module is pure and client-safe (no server/supabase imports) so it can
// be shared by client components, API routes, and the digest.

export type WarrantyReviewStatus = 'requested' | 'verified' | 'denied'

export const WARRANTY_REVIEW_STATUS_LABELS: Record<WarrantyReviewStatus, string> = {
  requested: 'Pending review',
  verified: 'Verified',
  denied: 'Denied',
}

// --- Billing gate ---

export type WarrantyGateFields = {
  warranty_review_status?: WarrantyReviewStatus | null
  warranty_credit_received_at?: string | null
  // Legacy leg: pre-redesign rows that never got a review status backfilled.
  // Remove after the 161 sweep is live.
  billing_type?: string | null
}

export type WarrantyBlockReason = 'pending_review' | 'awaiting_credit' | null

/**
 * Whether a ticket is blocked from billing on warranty grounds, and why.
 * `requested` means coverage is still undecided, so the ticket can't be
 * invoiced at all. `verified` without a received credit means it can be
 * invoiced but the office still owes the vendor a reconcile. Legacy rows
 * (no review status, but billing_type flags them as warranty/partial) fall
 * back to the pre-redesign awaiting-credit gate until they're backfilled.
 */
export function warrantyBillingBlock(t: WarrantyGateFields): WarrantyBlockReason {
  if (t.warranty_review_status === 'requested') return 'pending_review'
  if (t.warranty_review_status === 'verified') {
    return t.warranty_credit_received_at ? null : 'awaiting_credit'
  }
  if (t.warranty_review_status == null) {
    const legacyWarranty = t.billing_type === 'warranty' || t.billing_type === 'partial_warranty'
    if (legacyWarranty && !t.warranty_credit_received_at) return 'awaiting_credit'
  }
  // denied, or verified+credited, or null status with no legacy warranty flag
  return null
}

// --- Customer bill amount ---

export type CustomerBillTerms = {
  /** Stored full-price completion total. */
  billingAmount: number
  /** Hours worked x labor rate. */
  laborTotal: number
  tripCharge: number
  /** May be negative when the diagnostic invoice credits back. */
  signedDiagnostic: number
  shippingCharge: number
  laborCovered: boolean
  parts: { lineTotal: number; covered: boolean }[]
}

/**
 * Post-coverage customer total. Starts from the full-price billingAmount and
 * subtracts covered parts, then (if labor is covered) labor + trip + any
 * positive diagnostic charge -- a negative diagnostic is a credit the
 * customer keeps regardless of warranty, so it is never subtracted. Freight
 * rides the parts: it's only waived when there ARE parts and every one of
 * them is covered, mirroring the old warranty-zeroes-shipping behavior.
 * Rounds to cents and floors at 0.
 */
export function computeCustomerBillAmount(t: CustomerBillTerms): number {
  let total = t.billingAmount

  for (const part of t.parts) {
    if (part.covered) total -= part.lineTotal
  }

  if (t.laborCovered) {
    total -= t.laborTotal + t.tripCharge + Math.max(t.signedDiagnostic, 0)
    if (t.parts.length > 0 && t.parts.every((p) => p.covered)) {
      total -= t.shippingCharge
    }
  }

  return Math.max(0, Math.round(total * 100) / 100)
}

// --- Expected credit suggestion ---

export type ExpectedCreditInput = {
  hoursWorked: number
  laborCovered: boolean
  vendorLaborRate: number | null
  /** unitCost from products.unit_cost; null/<=0 = unknown. */
  parts: { qty: number; covered: boolean; unitCost: number | null }[]
}

export type ExpectedCreditResult = {
  amount: number
  /** Count of covered parts whose cost is unknown, excluded from amount. */
  unknownCostParts: number
}

/**
 * Suggest the expected vendor credit from known costs: covered parts at
 * qty x unitCost, plus covered labor at hoursWorked x vendorLaborRate when
 * both are set. Parts with an unknown/non-positive cost are counted but
 * excluded from the amount so the office knows the suggestion is a floor,
 * not the full expected credit.
 */
export function suggestExpectedCredit(i: ExpectedCreditInput): ExpectedCreditResult {
  let amount = 0
  let unknownCostParts = 0

  for (const part of i.parts) {
    if (!part.covered) continue
    if (part.unitCost != null && part.unitCost > 0) {
      amount += part.qty * part.unitCost
    } else {
      unknownCostParts += 1
    }
  }

  if (i.laborCovered && i.vendorLaborRate != null && i.vendorLaborRate > 0) {
    amount += i.hoursWorked * i.vendorLaborRate
  }

  return { amount: Math.round(amount * 100) / 100, unknownCostParts }
}

// --- Worklist bucketing ---

export type WarrantyBucket = 'to_review' | 'to_file' | 'awaiting_credit' | 'received' | 'billed_unclaimed'

export type BucketFields = {
  warranty_review_status?: WarrantyReviewStatus | null
  status: string
  warranty_credit_received_at?: string | null
  warranty_claim_submitted_at?: string | null
}

/**
 * Which worklist section a ticket belongs in. Callers only pass rows that
 * queue membership already selected (requested/verified reviews); this stays
 * pure and order-sensitive: requested beats billed, received beats submitted.
 */
export function bucketOf(r: BucketFields): WarrantyBucket {
  if (r.warranty_review_status === 'requested') return 'to_review'
  if (r.status === 'billed') return 'billed_unclaimed'
  if (r.warranty_credit_received_at) return 'received'
  if (r.warranty_claim_submitted_at) return 'awaiting_credit'
  return 'to_file'
}
