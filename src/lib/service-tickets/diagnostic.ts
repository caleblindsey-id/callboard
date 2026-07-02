// Signed diagnostic-fee line for customer-facing estimate surfaces (approval
// page, estimate email, estimate PDF).
//
// Policy (2026-07-02): a separately-invoiced diagnostic shows as a CREDIT only
// when the Synergy invoice number has been VERIFIED to exist (the nightly
// validator stamps diagnostic_invoice_validation_status, migration 137). An
// unverified or invalid invoice number renders as a positive charge — the
// conservative direction — until verification lands.
//
// Display-time by design: validation lands asynchronously (the Python job
// writes straight to the DB), so baking the signed amount into the stored
// estimate_amount would go stale overnight. estimate_amount stays
// labor + parts + trip everywhere; surfaces add this line on top.
//
// The completion/billing side (billing_amount, WO PDF) keeps its existing
// presence-based sign — by billing time the office has confirmed the invoice.

export interface EstimateDiagnosticLine {
  /** Always positive; direction conveyed by `credited`. */
  amount: number
  /** true → customer already paid it; render as a negative credit. */
  credited: boolean
  invoiceNumber: string | null
}

export function estimateDiagnosticLine(t: {
  diagnostic_charge: number | string | null
  diagnostic_invoice_number: string | null
  diagnostic_invoice_validation_status: string | null
  billing_type: string | null
}): EstimateDiagnosticLine | null {
  // Warranty estimates are zeroed everywhere; no diagnostic line either.
  if (t.billing_type === 'warranty') return null
  const charge = Number(t.diagnostic_charge ?? 0) || 0
  if (charge <= 0) return null
  const invoice = String(t.diagnostic_invoice_number ?? '').trim()
  const credited = !!invoice && t.diagnostic_invoice_validation_status === 'valid'
  return { amount: charge, credited, invoiceNumber: invoice || null }
}

/** Signed value to add to the repair total: -amount when credited, else +amount. */
export function signedDiagnostic(line: EstimateDiagnosticLine | null): number {
  if (!line) return 0
  return line.credited ? -line.amount : line.amount
}
