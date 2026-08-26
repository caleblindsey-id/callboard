// Pure term derivation for the service work-order PDF (Round 6). Shared by
// 'full' and 'net' pricing modes so the trip-charge-by-subtraction landmine
// (deriving a line from a total that's already had some OTHER line zeroed
// out of it) can't desync between them — see work-order-pdf/route.ts T1c.
//
// There is no stored trip_charge column on the ticket (it's folded into
// billing_amount at completion). So the trip line is ALWAYS derived from the
// FULL-PRICE total by subtraction first, in one coherent full-price space,
// and only zeroed for display afterward if warranty coverage says so. Never
// derive it from a total that has already had some other term zeroed — that
// bleeds the missing term into the trip-charge line (the documented bug
// class this function exists to prevent).

export type WorkOrderPricingMode = 'full' | 'net'

export interface WorkOrderPricingInput {
  /** Stored full-price completion total (service_tickets.billing_amount). */
  billingAmount: number
  /** Post-coverage total for verified tickets; null everywhere else. */
  customerBillAmount: number | null
  /** hours_worked x labor rate, full price. */
  laborTotal: number
  /** Always positive; direction conveyed separately by an invoice-number flag. */
  signedDiagnostic: number
  /** Full-price inbound freight. */
  shippingCharge: number
  /**
   * Parts total to subtract when deriving the trip charge. Callers choose the
   * filtering that matches the stored billing_amount's own math: the full,
   * unfiltered sum of every part for 'full' mode and the new review-lifecycle
   * 'net' mode (billing_amount is always full price under migration 160+), or
   * the legacy "excluding warranty_covered lines" sum for a frozen
   * billing_type row (mirrors the pre-Round-6 derivation exactly, so a
   * reprint of a legacy document doesn't change).
   */
  partsTotal: number
  /** Frozen pre-redesign row (billing_type IN warranty, partial_warranty). */
  isLegacyWarranty: boolean
  /** warranty_labor_covered — new review-lifecycle only. */
  laborCovered: boolean
  /** Every part line flagged warranty_covered, and there's at least one part. */
  allPartsCovered: boolean
}

export interface WorkOrderPricingTerms {
  laborDisplay: number
  tripDisplay: number
  diagnosticDisplay: number
  shippingDisplay: number
  total: number
}

export function deriveWorkOrderTerms(
  mode: WorkOrderPricingMode,
  i: WorkOrderPricingInput,
): WorkOrderPricingTerms {
  // Trip charge: total minus every other full-price term, floored at 0.
  const tripChargeFull = Math.max(
    0,
    i.billingAmount - i.laborTotal - i.partsTotal - i.signedDiagnostic - i.shippingCharge,
  )

  if (mode === 'full' || i.isLegacyWarranty) {
    // Full mode: nothing is zeroed anywhere — this is the claim artifact.
    // Legacy net mode: reproduced VERBATIM from the pre-Round-6 route. Labor
    // and diagnostic were never zeroed for display there either (only parts
    // and, for a full 'warranty' row, shipping were) — so on a legacy
    // 'warranty' row (billing_amount stored as 0) the derived trip line
    // floors at 0 rather than reconciling against the printed labor/diagnostic
    // rows. That mismatch is the historical behavior being preserved, not a
    // bug introduced here. Parts-row zeroing and the legacy shipping value
    // are the caller's responsibility (route.ts), not this function's.
    return {
      laborDisplay: i.laborTotal,
      tripDisplay: tripChargeFull,
      diagnosticDisplay: i.signedDiagnostic,
      shippingDisplay: i.shippingCharge,
      total: i.billingAmount,
    }
  }

  // New review-lifecycle net mode: labor + trip zero when labor is covered.
  // A positive diagnostic charge is credited when labor is covered; an
  // already-negative diagnostic (a credit the customer keeps regardless) is
  // never touched. Shipping zeros only when labor AND every part are
  // covered. Mirrors lib/service-tickets/warranty.ts computeCustomerBillAmount.
  const laborDisplay = i.laborCovered ? 0 : i.laborTotal
  const tripDisplay = i.laborCovered ? 0 : tripChargeFull
  const diagnosticDisplay = i.laborCovered ? Math.min(i.signedDiagnostic, 0) : i.signedDiagnostic
  const shippingDisplay = i.laborCovered && i.allPartsCovered ? 0 : i.shippingCharge

  return {
    laborDisplay,
    tripDisplay,
    diagnosticDisplay,
    shippingDisplay,
    total: i.customerBillAmount ?? i.billingAmount,
  }
}
