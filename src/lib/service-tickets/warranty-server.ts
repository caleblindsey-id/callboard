// Server-side derivation of customer_bill_amount from a STORED ticket row
// (migration 160). Coverage can change after completion — verify, change a
// verdict, or reconcile a credit — and each of those needs to recompute the
// customer's total without drifting off the rate/qty snapshot the ticket
// actually billed at.
//
// Exact-reconstruction, not re-pricing: /complete stores
//   billing_amount = laborTotal + allPartsTotal + signedDiagnostic + tripCharge + shippingCharge
// at completion time. Re-deriving laborRate x hours here would drift the
// moment a rate changes in settings after the ticket completed. Instead this
// backs laborPlusTrip out of the stored billing_amount, so the customer total
// always reconstructs from what was actually billed, never from a live rate.
//
// Pure computation over a stored row; combines with computeCustomerBillAmount
// in ./warranty (the shared pure module) to do the actual subtraction.

import { shippingChargeAmount } from '@/lib/shipping'
import { computeCustomerBillAmount, type CustomerBillTerms } from './warranty'
import type { ServicePartUsed } from '@/types/service-tickets'

export type WarrantyBillTicketFields = {
  /** Full-price completion total. NULL means the ticket hasn't completed yet. */
  billing_amount: number | null
  shipping_charge: number | null
  diagnostic_charge: number | null
  diagnostic_invoice_number: string | null
  warranty_labor_covered: boolean | null
  parts_used: ServicePartUsed[] | null
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Reconstructs the CustomerBillTerms a stored ticket row implies, or null when
 * the ticket has no billing_amount yet (not completed). laborTotal here is
 * really "labor + trip charge combined" (tripCharge is folded in as 0 since
 * the stored total already has it baked in and there is no way to split it
 * back out) -- computeCustomerBillAmount only ever sums the two together, so
 * the split doesn't matter to the result.
 */
export function deriveCustomerBillTerms(t: WarrantyBillTicketFields): CustomerBillTerms | null {
  if (t.billing_amount == null) return null

  const parts = t.parts_used ?? []
  const partLines = parts.map((p) => ({
    lineTotal: round2((Number(p.quantity) || 0) * (Number(p.unit_price) || 0)),
    covered: !!p.warranty_covered,
  }))
  const allPartsTotal = round2(partLines.reduce((sum, p) => sum + p.lineTotal, 0))

  // Same presence rule as the completion route: an invoice number means the
  // diagnostic visit was already billed separately, so it's a credit here.
  const diagnosticCharge = Number(t.diagnostic_charge ?? 0) || 0
  const hasDiagInvoice = !!String(t.diagnostic_invoice_number ?? '').trim()
  const signedDiagnostic = hasDiagInvoice ? -diagnosticCharge : diagnosticCharge

  const shippingCharge = shippingChargeAmount(t.shipping_charge)

  const laborPlusTrip = Math.max(
    0,
    round2(t.billing_amount - allPartsTotal - signedDiagnostic - shippingCharge),
  )

  return {
    billingAmount: t.billing_amount,
    laborTotal: laborPlusTrip,
    tripCharge: 0,
    signedDiagnostic,
    shippingCharge,
    laborCovered: !!t.warranty_labor_covered,
    parts: partLines,
  }
}

/** Post-coverage customer total for a stored row, or null pre-completion. */
export function deriveCustomerBillAmount(t: WarrantyBillTicketFields): number | null {
  const terms = deriveCustomerBillTerms(t)
  return terms == null ? null : computeCustomerBillAmount(terms)
}
