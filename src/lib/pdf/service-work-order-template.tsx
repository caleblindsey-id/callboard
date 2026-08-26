import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer'
import { APP_NAME } from '@/lib/branding'
import { partLabel } from '@/lib/parts'
import { computePartsTax } from '@/lib/tax'
import { PdfHeader, PdfFooter, type PdfHeaderLine } from '@/lib/pdf/chrome'

// ============================================================
// Types
// ============================================================
// Customer-facing completion document for a SERVICE ticket — the parity
// counterpart to the PM CustomerWorkOrderDocument. Styling mirrors the service
// estimate-template so estimate and work order read as one family.

interface ServiceWorkOrderPart {
  description: string
  // Free-text detail for catch-all items (e.g. SHOP SUPPLIES). Optional.
  detail?: string | null
  quantity: number
  unitPrice: number
  warrantyCovered: boolean
}

interface ServiceWorkOrderData {
  workOrderNumber: number | null
  // Synergy parts-order # — printed so coordinators can match the exported WO
  // back to its Synergy record when keying the invoice # (feedback #48). Optional.
  synergyOrderNumber: string | null
  // Customer PO number — printed so coordinators can key it onto the Synergy invoice. Optional.
  poNumber: string | null
  customerName: string
  accountNumber: string | null
  serviceAddress: string | null
  equipmentLine: string
  serialNumber: string | null
  machineHours: number | null
  dateCode: string | null
  contactName: string | null
  contactEmail: string | null
  contactPhone: string | null
  problemDescription: string
  diagnosisNotes: string | null
  workPerformed: string | null
  technicianName: string
  completedDate: string
  // Warranty review lifecycle (migration 160+, Round 6). 'full' = the claim
  // artifact — every line at full price, nothing zeroed. 'net' = the customer
  // document — covered lines print at $0, and the printed Total is
  // billingTotal, which the route has already resolved to whichever figure
  // the mode calls for (billing_amount for full, customer_bill_amount for a
  // verified new-lifecycle ticket, or the legacy stored billing_amount for a
  // frozen billing_type row).
  pricingMode: 'full' | 'net'
  warrantyReviewStatus: 'requested' | 'verified' | 'denied' | null
  warrantyCreditReceived: boolean
  laborHours: number
  laborRate: number
  // Already reflects net-mode zeroing when warranty_labor_covered — see
  // work-order-pdf/route.ts. Full mode always passes hours x laborRate.
  laborTotal: number
  parts: ServiceWorkOrderPart[]
  // Legacy-only: a frozen full 'warranty' billing_type row zeroes every part
  // line regardless of its own warrantyCovered flag (the old isWarranty
  // override). False everywhere else, where only individually-flagged lines zero.
  zeroAllParts: boolean
  // Already reflects net-mode zeroing (labor covered -> trip zeroed too). See
  // work-order-pricing.ts.
  tripCharge: number
  // Inbound freight billed to the customer (feedback #80). 0 when none was
  // charged, or when net mode zeroes it for coverage. Rendered as its own
  // line beside the trip charge rather than folded into the parts subtotal,
  // so the customer can see exactly what the shipping cost.
  shippingCharge: number
  diagnosticCharge: number
  // When present, the diagnostic was already billed separately (Synergy invoice),
  // so it renders as a negative credit on this work order rather than a charge.
  diagnosticInvoiceNumber: string | null
  // New review-lifecycle net mode only: a positive diagnostic charge credited
  // away by warranty coverage. Forces the line to $0.00 regardless of the
  // invoice-number credit logic above.
  diagnosticZeroed: boolean
  billingTotal: number
  // Customer sales-tax rate as a percent (e.g. 7.75); 0 when exempt or none on
  // file. Display-only — applied to the parts subtotal only (migration 133).
  taxRatePercent: number
  customerSignature: string | null
  customerSignatureName: string | null
  photoUrls: string[]
}

interface ServiceWorkOrderDocumentProps {
  workOrder: ServiceWorkOrderData
  logoBase64: string | null
  companyName?: string
}

// ============================================================
// Styles (mirrors estimate-template)
// ============================================================

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 9,
    color: '#111111',
    paddingTop: 40,
    paddingBottom: 70,
    paddingHorizontal: 48,
    backgroundColor: '#ffffff',
  },
  sectionLabel: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: '#888888',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 4,
    marginTop: 12,
  },
  fieldRow: { flexDirection: 'row', marginBottom: 2 },
  fieldLabel: { width: 100, color: '#666666' },
  fieldValue: { flex: 1, color: '#111111' },
  table: { marginTop: 4 },
  tableHeaderRow: {
    flexDirection: 'row',
    backgroundColor: '#f0f0f0',
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderTopWidth: 0.5,
    borderTopColor: '#cccccc',
    borderBottomWidth: 0.5,
    borderBottomColor: '#cccccc',
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: '#e8e8e8',
  },
  colDescription: { flex: 3, color: '#111111' },
  colQty: { width: 40, textAlign: 'center', color: '#111111' },
  colPrice: { width: 65, textAlign: 'right', color: '#111111' },
  colTotal: { width: 70, textAlign: 'right', color: '#111111' },
  tableHeaderText: { fontFamily: 'Helvetica-Bold', fontSize: 7.5, color: '#444444' },
  summaryBlock: { marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#cccccc' },
  summaryRow: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 2 },
  summaryLabel: { width: 120, textAlign: 'right', color: '#666666', paddingRight: 10 },
  summaryValue: { width: 70, textAlign: 'right', color: '#111111' },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 4,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: '#111111',
  },
  totalLabel: {
    width: 120,
    textAlign: 'right',
    paddingRight: 10,
    fontFamily: 'Helvetica-Bold',
    fontSize: 11,
    color: '#111111',
  },
  totalValue: {
    width: 70,
    textAlign: 'right',
    fontFamily: 'Helvetica-Bold',
    fontSize: 11,
    color: '#111111',
  },
  signatureBlock: { marginTop: 18, paddingTop: 10, borderTopWidth: 0.5, borderTopColor: '#cccccc' },
  signatureDate: { fontSize: 8.5, color: '#555555', marginBottom: 4 },
  signatureImage: { height: 50, width: 200, objectFit: 'contain' as const },
  signatureLine: { borderBottomWidth: 0.75, borderBottomColor: '#111111', width: 220, marginTop: 2, marginBottom: 3 },
  signatureName: { fontSize: 9, color: '#111111', fontFamily: 'Helvetica-Bold' },
  signatureCaption: { fontSize: 7.5, color: '#888888', letterSpacing: 0.4, textTransform: 'uppercase', marginTop: 1 },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 },
  photoImage: { width: 164, height: 110, objectFit: 'cover' as const, borderWidth: 0.5, borderColor: '#e5e5e5', margin: 3 },
  warrantyNoteBlock: { marginTop: 6, marginBottom: 2 },
  warrantyNoteText: { fontSize: 7.5, color: '#888888', fontStyle: 'italic', lineHeight: 1.3 },
})

// ============================================================
// Helpers
// ============================================================

function dash(value: string | null | undefined): string {
  return value?.trim() || '—'
}

function money(amount: number): string {
  return `$${amount.toFixed(2)}`
}

// ============================================================
// Document
// ============================================================

export function ServiceWorkOrderDocument({ workOrder, logoBase64, companyName }: ServiceWorkOrderDocumentProps) {
  const isNet = workOrder.pricingMode === 'net'
  // A part line zeroes for display when net mode says so: either every line
  // zeroes (legacy full 'warranty' row) or just this line's own flag does.
  const partZeroed = (p: ServiceWorkOrderPart) => isNet && (workOrder.zeroAllParts || p.warrantyCovered)
  const partsTotal = workOrder.parts.reduce(
    (sum, p) => sum + (partZeroed(p) ? 0 : p.quantity * p.unitPrice),
    0,
  )
  // Full mode: the pending/verified-review note, shown only while the
  // customer hasn't already seen the discounted net total.
  const warrantyNote =
    workOrder.pricingMode === 'full' && workOrder.warrantyReviewStatus === 'requested'
      ? 'Pending warranty review, covered items will be credited on your final invoice.'
      : workOrder.pricingMode === 'full'
          && workOrder.warrantyReviewStatus === 'verified'
          && !workOrder.warrantyCreditReceived
        ? 'Warranty verified, covered items will show at $0 on your final invoice.'
        : null
  // Tax applies to parts only (labor/trip/diagnostic excluded). Display-only;
  // billingTotal is pre-tax, so the printed Total = billingTotal + tax.
  const taxAmount = computePartsTax(partsTotal, (workOrder.taxRatePercent ?? 0) / 100)
  const grandTotal = workOrder.billingTotal + taxAmount

  return (
    <Document>
      <Page size="LETTER" style={styles.page} wrap>
        {/* Header */}
        <PdfHeader
          logoBase64={logoBase64}
          companyName={companyName ?? APP_NAME}
          title="Service Work Order"
          documentNumber={workOrder.workOrderNumber ? `WO-${workOrder.workOrderNumber}` : undefined}
          rightLines={[
            workOrder.synergyOrderNumber ? { text: `Synergy Order #: ${workOrder.synergyOrderNumber}` } : null,
            workOrder.poNumber ? { text: `PO: ${workOrder.poNumber}` } : null,
            { text: workOrder.completedDate },
          ].filter((line): line is PdfHeaderLine => line !== null)}
        />

        {/* Customer */}
        <Text style={styles.sectionLabel}>Customer</Text>
        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>Name:</Text>
          <Text style={styles.fieldValue}>{dash(workOrder.customerName)}</Text>
        </View>
        {workOrder.accountNumber && (
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>Account #:</Text>
            <Text style={styles.fieldValue}>{workOrder.accountNumber}</Text>
          </View>
        )}
        {workOrder.serviceAddress && (
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>Service Location:</Text>
            <Text style={styles.fieldValue}>{workOrder.serviceAddress}</Text>
          </View>
        )}

        {/* Equipment */}
        <Text style={styles.sectionLabel}>Equipment</Text>
        <View style={styles.fieldRow}>
          <Text style={styles.fieldValue}>
            {workOrder.equipmentLine}
            {workOrder.serialNumber ? `  |  Serial: ${workOrder.serialNumber}` : ''}
          </Text>
        </View>
        {(workOrder.machineHours != null || workOrder.dateCode) && (
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>Service Data:</Text>
            <Text style={styles.fieldValue}>
              {[
                workOrder.machineHours != null ? `${workOrder.machineHours} machine hrs` : null,
                workOrder.dateCode ? `Date code ${workOrder.dateCode}` : null,
              ].filter(Boolean).join('  |  ')}
            </Text>
          </View>
        )}
        {(workOrder.contactName || workOrder.contactEmail || workOrder.contactPhone) && (
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>Site Contact:</Text>
            <Text style={styles.fieldValue}>
              {[workOrder.contactName, workOrder.contactEmail, workOrder.contactPhone].filter(Boolean).join('  |  ')}
            </Text>
          </View>
        )}
        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>Technician:</Text>
          <Text style={styles.fieldValue}>{dash(workOrder.technicianName)}</Text>
        </View>

        {/* Problem */}
        <Text style={styles.sectionLabel}>Problem Description</Text>
        <View style={styles.fieldRow}>
          <Text style={styles.fieldValue}>{dash(workOrder.problemDescription)}</Text>
        </View>

        {/* Diagnosis */}
        {workOrder.diagnosisNotes && (
          <>
            <Text style={styles.sectionLabel}>Diagnosis</Text>
            <View style={styles.fieldRow}>
              <Text style={styles.fieldValue}>{workOrder.diagnosisNotes}</Text>
            </View>
          </>
        )}

        {/* Work Performed */}
        <Text style={styles.sectionLabel}>Work Performed</Text>
        <View style={styles.fieldRow}>
          <Text style={styles.fieldValue}>{dash(workOrder.workPerformed)}</Text>
        </View>

        {/* Charges */}
        <Text style={styles.sectionLabel}>Charges</Text>
        <View style={styles.table}>
          <View style={styles.tableHeaderRow}>
            <Text style={[styles.colDescription, styles.tableHeaderText]}>Description</Text>
            <Text style={[styles.colQty, styles.tableHeaderText]}>Qty</Text>
            <Text style={[styles.colPrice, styles.tableHeaderText]}>Rate/Price</Text>
            <Text style={[styles.colTotal, styles.tableHeaderText]}>Amount</Text>
          </View>

          {workOrder.laborHours > 0 && (
            <View style={styles.tableRow}>
              <Text style={styles.colDescription}>Service Labor</Text>
              <Text style={styles.colQty}>{workOrder.laborHours}</Text>
              <Text style={styles.colPrice}>{money(workOrder.laborRate)}/hr</Text>
              <Text style={styles.colTotal}>{money(workOrder.laborTotal)}</Text>
            </View>
          )}

          {workOrder.parts.map((part, idx) => (
            <View key={idx} style={styles.tableRow}>
              <Text style={styles.colDescription}>
                {partLabel(part)}
                {isNet && part.warrantyCovered ? ' (warranty)' : ''}
              </Text>
              <Text style={styles.colQty}>{part.quantity}</Text>
              <Text style={styles.colPrice}>{money(part.unitPrice)}</Text>
              <Text style={styles.colTotal}>
                {partZeroed(part) ? '$0.00' : money(part.quantity * part.unitPrice)}
              </Text>
            </View>
          ))}

          {workOrder.tripCharge > 0 && (
            <View style={styles.tableRow}>
              <Text style={styles.colDescription}>Trip Charge</Text>
              <Text style={styles.colQty}>—</Text>
              <Text style={styles.colPrice}>—</Text>
              <Text style={styles.colTotal}>{money(workOrder.tripCharge)}</Text>
            </View>
          )}

          {workOrder.shippingCharge > 0 && (
            <View style={styles.tableRow}>
              <Text style={styles.colDescription}>Shipping</Text>
              <Text style={styles.colQty}>—</Text>
              <Text style={styles.colPrice}>—</Text>
              <Text style={styles.colTotal}>{money(workOrder.shippingCharge)}</Text>
            </View>
          )}

          {workOrder.diagnosticCharge > 0 && (
            <View style={styles.tableRow}>
              <Text style={styles.colDescription}>
                {workOrder.diagnosticZeroed
                  ? 'Diagnostic Fee (warranty)'
                  : workOrder.diagnosticInvoiceNumber
                    ? `Diagnostic Fee Credit (Inv #${workOrder.diagnosticInvoiceNumber})`
                    : 'Diagnostic Fee'}
              </Text>
              <Text style={styles.colQty}>—</Text>
              <Text style={styles.colPrice}>—</Text>
              <Text style={styles.colTotal}>
                {workOrder.diagnosticZeroed
                  ? '$0.00'
                  : workOrder.diagnosticInvoiceNumber
                    ? `-${money(workOrder.diagnosticCharge)}`
                    : money(workOrder.diagnosticCharge)}
              </Text>
            </View>
          )}
        </View>

        {/* Summary */}
        <View style={styles.summaryBlock}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Labor Subtotal:</Text>
            <Text style={styles.summaryValue}>{money(workOrder.laborTotal)}</Text>
          </View>
          {workOrder.parts.length > 0 && (
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Parts Subtotal:</Text>
              <Text style={styles.summaryValue}>{money(partsTotal)}</Text>
            </View>
          )}
          {workOrder.tripCharge > 0 && (
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Trip Charge:</Text>
              <Text style={styles.summaryValue}>{money(workOrder.tripCharge)}</Text>
            </View>
          )}
          {workOrder.shippingCharge > 0 && (
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Shipping:</Text>
              <Text style={styles.summaryValue}>{money(workOrder.shippingCharge)}</Text>
            </View>
          )}
          {workOrder.diagnosticCharge > 0 && (
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>
                {workOrder.diagnosticZeroed
                  ? 'Diagnostic Fee (warranty):'
                  : workOrder.diagnosticInvoiceNumber ? 'Diagnostic Fee Credit:' : 'Diagnostic Fee:'}
              </Text>
              <Text style={styles.summaryValue}>
                {workOrder.diagnosticZeroed
                  ? '$0.00'
                  : workOrder.diagnosticInvoiceNumber
                    ? `-${money(workOrder.diagnosticCharge)}`
                    : money(workOrder.diagnosticCharge)}
              </Text>
            </View>
          )}
          {warrantyNote && (
            <View style={styles.warrantyNoteBlock}>
              <Text style={styles.warrantyNoteText}>{warrantyNote}</Text>
            </View>
          )}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total:</Text>
            <Text style={styles.totalValue}>{money(workOrder.billingTotal)}</Text>
          </View>
          {taxAmount > 0 && (
            <>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Sales Tax ({workOrder.taxRatePercent}%):</Text>
                <Text style={styles.summaryValue}>{money(taxAmount)}</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Total with tax:</Text>
                <Text style={styles.summaryValue}>{money(grandTotal)}</Text>
              </View>
            </>
          )}
        </View>

        {/* Service Photos */}
        {workOrder.photoUrls.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>Service Photos</Text>
            <View style={styles.photoGrid}>
              {workOrder.photoUrls.map((url, idx) => (
                <Image key={idx} src={url} style={styles.photoImage} />
              ))}
            </View>
          </>
        )}

        {/* Customer Signature */}
        {workOrder.customerSignature && (
          <View style={styles.signatureBlock} wrap={false}>
            <Text style={styles.signatureDate}>Signed on {dash(workOrder.completedDate)}</Text>
            <Image src={workOrder.customerSignature} style={styles.signatureImage} />
            <View style={styles.signatureLine} />
            <Text style={styles.signatureName}>{workOrder.customerSignatureName ?? '—'}</Text>
            <Text style={styles.signatureCaption}>Customer Signature</Text>
          </View>
        )}

        {/* Footer */}
        <PdfFooter
          left={workOrder.workOrderNumber ? `WO-${workOrder.workOrderNumber}` : 'Work Order'}
          right={`${companyName ?? APP_NAME} Service Department`}
        />
      </Page>
    </Document>
  )
}
