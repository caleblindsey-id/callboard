import { taxRatePercent } from '@/lib/tax'
import { shippingChargeAmount } from '@/lib/shipping'
import { deriveWorkOrderTerms, type WorkOrderPricingMode } from '@/lib/pdf/work-order-pricing'
import type { ServiceWorkOrderData } from '@/lib/pdf/service-work-order-template'
import type { ServicePartUsed, WarrantyReviewStatus } from '@/types/service-tickets'

// Raw service-ticket row → the ServiceWorkOrderData the PDF template renders.
//
// This lives here, not in a route, because TWO routes render the same document:
// the per-ticket POST /api/service-tickets/[id]/work-order-pdf and the batch
// POST /api/billing/service/export-pdf. The warranty pricing rules below
// (pricingMode, zeroAllParts, diagnosticZeroed, and above all the DERIVED trip
// charge) are subtle enough that a second copy would drift, and a drifted copy
// prints wrong dollar amounts on a customer-facing document. Every field a work
// order shows must be identical whether it was exported on its own or inside a
// batch. (The one thing that legitimately differs is the footer's "Page X of Y",
// which @react-pdf scopes to the whole Document — see the batch route.)
//
// Deliberately free of DB imports so it stays unit-testable: everything that
// needs a query (labor rate, photo signed URLs) arrives via `deps`.

// Shared column list so both routes select exactly the same shape. A route that
// hand-rolls its own select silently drops fields to null on the PDF.
export const SERVICE_WORK_ORDER_SELECT = `
  id,
  work_order_number,
  synergy_order_number,
  po_number,
  status,
  ticket_type,
  billing_type,
  problem_description,
  diagnosis_notes,
  completion_notes,
  completed_at,
  hours_worked,
  machine_hours,
  date_code,
  estimate_labor_rate,
  labor_rate_type,
  parts_used,
  diagnostic_charge,
  diagnostic_invoice_number,
  billing_amount,
  customer_bill_amount,
  warranty_review_status,
  warranty_credit_received_at,
  warranty_labor_covered,
  shipping_charge,
  customer_signature,
  customer_signature_name,
  photos,
  contact_name,
  contact_email,
  contact_phone,
  service_address,
  service_city,
  service_state,
  service_zip,
  equipment_make,
  equipment_model,
  equipment_serial_number,
  assigned_technician_id,
  customer_id,
  customers(name, account_number, tax_rate, tax_exempt),
  equipment:equipment!service_tickets_equipment_id_fkey(
    make, model, serial_number,
    ship_to_locations(address, city, state, zip)
  ),
  assigned_technician:users!service_tickets_assigned_technician_id_fkey(name)
`

export interface ServiceWorkOrderRow {
  id: string
  work_order_number: number | null
  synergy_order_number: string | null
  po_number: string | null
  status: string
  ticket_type: string | null
  billing_type: string
  problem_description: string
  diagnosis_notes: string | null
  completion_notes: string | null
  completed_at: string | null
  hours_worked: number | null
  machine_hours: number | null
  date_code: string | null
  estimate_labor_rate: number | null
  labor_rate_type: string | null
  parts_used: ServicePartUsed[] | null
  diagnostic_charge: number | null
  diagnostic_invoice_number: string | null
  billing_amount: number | null
  customer_bill_amount: number | null
  warranty_review_status: WarrantyReviewStatus | null
  warranty_credit_received_at: string | null
  warranty_labor_covered: boolean | null
  shipping_charge: number | null
  customer_signature: string | null
  customer_signature_name: string | null
  photos: Array<{ storage_path: string }> | null
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  service_address: string | null
  service_city: string | null
  service_state: string | null
  service_zip: string | null
  equipment_make: string | null
  equipment_model: string | null
  equipment_serial_number: string | null
  assigned_technician_id: string | null
  customer_id: number | null
  customers: {
    name: string
    account_number: string | null
    tax_rate: number | null
    tax_exempt: boolean | null
  } | null
  equipment: {
    make: string | null
    model: string | null
    serial_number: string | null
    ship_to_locations: {
      address: string | null
      city: string | null
      state: string | null
      zip: string | null
    } | null
  } | null
  // Supabase types a to-one join as either the object or a 1-element array
  // depending on how the FK is resolved; both shapes show up in practice.
  assigned_technician: { name: string } | { name: string }[] | null
}

export interface ServiceWorkOrderDeps {
  // Informational labor rate for the breakdown. Resolve as
  // `raw.estimate_labor_rate ?? await getCustomerLaborRate(customer_id, labor_rate_type)`
  // — the snapshot taken at estimate time wins, so a later rate change doesn't
  // rewrite an already-quoted work order. The authoritative figure printed as
  // Total is billing_amount (server-computed), not this.
  laborRate: number
  // Short-lived signed URLs for completion photos, embedded at render time.
  photoUrls: string[]
  // Office-only preview toggle (a `pricing: 'net'` body). A technician
  // generating their own copy, and the billing export, never set this.
  requestedNet?: boolean
}

export function buildServiceWorkOrder(
  raw: ServiceWorkOrderRow,
  { laborRate, photoUrls, requestedNet = false }: ServiceWorkOrderDeps,
): ServiceWorkOrderData {
  const customer = raw.customers
  const equipment = raw.equipment

  let serviceAddress: string | null = null
  if (raw.ticket_type === 'outside') {
    serviceAddress = [raw.service_address, raw.service_city, raw.service_state, raw.service_zip]
      .filter(Boolean).join(', ') || null
  } else if (equipment?.ship_to_locations) {
    const loc = equipment.ship_to_locations
    serviceAddress = [loc.address, loc.city, loc.state, loc.zip].filter(Boolean).join(', ') || null
  }

  const equipmentLine = [
    equipment?.make ?? raw.equipment_make,
    equipment?.model ?? raw.equipment_model,
  ].filter(Boolean).join(' ') || '—'

  const technicianEntry = raw.assigned_technician
  const technicianName = Array.isArray(technicianEntry)
    ? (technicianEntry[0]?.name ?? '—')
    : (technicianEntry?.name ?? '—')

  const partsUsed = raw.parts_used ?? []

  // --- Pricing mode selection (warranty review lifecycle, migration 160+) ---
  //   'net'  — a legacy frozen billing_type row (warranty/partial_warranty), OR
  //            warranty_review_status === 'verified' with the vendor credit
  //            already received, OR verified + the office explicitly asked for
  //            a net preview.
  //   'full' — everything else (default). The claim artifact: every line at
  //            full price, plus a pending-review note when applicable.
  const billingType = raw.billing_type
  const isLegacyWarranty = billingType === 'warranty' || billingType === 'partial_warranty'
  const reviewStatus = raw.warranty_review_status ?? null
  const creditReceived = !!raw.warranty_credit_received_at
  const verified = reviewStatus === 'verified'
  const laborCoveredFlag = raw.warranty_labor_covered === true
  const pricingMode: WorkOrderPricingMode =
    isLegacyWarranty || (verified && (creditReceived || requestedNet)) ? 'net' : 'full'

  const laborTotalPdf = (raw.hours_worked ?? 0) * laborRate
  const diagnosticPdf = raw.diagnostic_charge ?? 0
  const hasDiagInvoice = !!String(raw.diagnostic_invoice_number ?? '').trim()
  const signedDiagnosticPdf = hasDiagInvoice ? -diagnosticPdf : diagnosticPdf

  // Parts total feeding the trip-charge subtraction only (NOT the per-line
  // display, which the template derives itself from pricingMode/zeroAllParts).
  // Legacy net mode excludes only individually-flagged warranty_covered lines
  // — mirrors the pre-Round-6 route exactly, so a reprint doesn't change.
  // Full mode and the new review-lifecycle net mode use every line's full
  // price: billing_amount is always full price under both (migration 160+
  // never zeroes it), so the trip must be derived in that same full-price
  // space — see work-order-pricing.ts T1c.
  const partsTotalForTrip = isLegacyWarranty
    ? partsUsed
        .filter((p) => !p.warranty_covered)
        .reduce((s, p) => s + (Number(p.quantity) || 0) * (Number(p.unit_price) || 0), 0)
    : partsUsed.reduce((s, p) => s + (Number(p.quantity) || 0) * (Number(p.unit_price) || 0), 0)

  // Freight: a legacy full 'warranty' row never had shipping added (mirrors
  // the pre-Round-6 route); everywhere else it's full price, zeroed for
  // DISPLAY only in the new-lifecycle net branch (deriveWorkOrderTerms).
  const shippingChargePdf =
    billingType === 'warranty' ? 0 : shippingChargeAmount(raw.shipping_charge)

  const allPartsCovered = partsUsed.length > 0 && partsUsed.every((p) => p.warranty_covered === true)

  const terms = deriveWorkOrderTerms(pricingMode, {
    billingAmount: raw.billing_amount ?? 0,
    customerBillAmount: raw.customer_bill_amount,
    laborTotal: laborTotalPdf,
    signedDiagnostic: signedDiagnosticPdf,
    shippingCharge: shippingChargePdf,
    partsTotal: partsTotalForTrip,
    isLegacyWarranty,
    laborCovered: laborCoveredFlag,
    allPartsCovered,
  })

  // Per-line zero + "(warranty)" suffix in net mode: a legacy full 'warranty'
  // row zeroes every part line regardless of its own flag (old isWarranty
  // override); everywhere else in net mode only individually-flagged lines
  // zero. Full mode never zeroes a line.
  const zeroAllParts = pricingMode === 'net' && billingType === 'warranty'

  // A positive diagnostic charge credited away by warranty coverage — new
  // review-lifecycle net mode only (the legacy branch never zeroes it, see
  // work-order-pricing.ts). An already-negative diagnostic (already a
  // credit) is untouched regardless.
  const diagnosticZeroed =
    pricingMode === 'net' && !isLegacyWarranty && laborCoveredFlag && signedDiagnosticPdf > 0

  return {
    workOrderNumber: raw.work_order_number,
    synergyOrderNumber: raw.synergy_order_number ?? null,
    poNumber: raw.po_number ?? null,
    customerName: customer?.name ?? '—',
    accountNumber: customer?.account_number ?? null,
    serviceAddress,
    equipmentLine,
    serialNumber: equipment?.serial_number ?? raw.equipment_serial_number ?? null,
    machineHours: raw.machine_hours,
    dateCode: raw.date_code,
    contactName: raw.contact_name,
    contactEmail: raw.contact_email,
    contactPhone: raw.contact_phone,
    problemDescription: raw.problem_description,
    diagnosisNotes: raw.diagnosis_notes,
    workPerformed: raw.completion_notes,
    technicianName,
    completedDate: raw.completed_at
      ? new Date(raw.completed_at).toLocaleDateString('en-US', {
          year: 'numeric', month: 'long', day: 'numeric',
        })
      : '—',
    pricingMode,
    warrantyReviewStatus: reviewStatus,
    warrantyCreditReceived: creditReceived,
    laborHours: raw.hours_worked ?? 0,
    laborRate,
    laborTotal: terms.laborDisplay,
    parts: partsUsed.map((p) => ({
      description: p.description,
      detail: p.detail ?? null,
      quantity: p.quantity,
      unitPrice: p.unit_price,
      warrantyCovered: p.warranty_covered ?? false,
    })),
    zeroAllParts,
    tripCharge: terms.tripDisplay,
    shippingCharge: terms.shippingDisplay,
    diagnosticCharge: raw.diagnostic_charge ?? 0,
    diagnosticInvoiceNumber: raw.diagnostic_invoice_number ?? null,
    diagnosticZeroed,
    billingTotal: terms.total,
    taxRatePercent: taxRatePercent(customer),
    customerSignature: raw.customer_signature,
    customerSignatureName: raw.customer_signature_name,
    photoUrls,
  }
}
