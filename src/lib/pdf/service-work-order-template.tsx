import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer'
import { APP_NAME } from '@/lib/branding'
import { partLabel } from '@/lib/parts'

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
  billingType: string
  laborHours: number
  laborRate: number
  parts: ServiceWorkOrderPart[]
  tripCharge: number
  diagnosticCharge: number
  // When present, the diagnostic was already billed separately (Synergy invoice),
  // so it renders as a negative credit on this work order rather than a charge.
  diagnosticInvoiceNumber: string | null
  billingTotal: number
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
  header: {
    marginBottom: 20,
    borderBottomWidth: 1.5,
    borderBottomColor: '#111111',
    paddingBottom: 10,
  },
  logo: { width: 160, height: 50, objectFit: 'contain' as const, marginBottom: 6 },
  title: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: '#111111', letterSpacing: 0.3 },
  subtitle: { fontSize: 11, color: '#444444', marginTop: 3 },
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
  footer: {
    position: 'absolute',
    bottom: 24,
    left: 48,
    right: 48,
    textAlign: 'center',
    fontSize: 7,
    color: '#aaaaaa',
    fontStyle: 'italic',
    borderTopWidth: 0.5,
    borderTopColor: '#e0e0e0',
    paddingTop: 6,
  },
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
  const laborTotal = workOrder.laborHours * workOrder.laborRate
  const isWarranty = workOrder.billingType === 'warranty'
  // Warranty tickets bill no parts; partial/non-warranty bill only non-covered lines.
  const partsTotal = isWarranty
    ? 0
    : workOrder.parts
        .filter((p) => !p.warrantyCovered)
        .reduce((sum, p) => sum + p.quantity * p.unitPrice, 0)

  return (
    <Document>
      <Page size="LETTER" style={styles.page} wrap>
        {/* Header */}
        <View style={styles.header} fixed>
          {logoBase64 && <Image src={logoBase64} style={styles.logo} />}
          <Text style={styles.title}>Service Work Order</Text>
          <Text style={styles.subtitle}>
            {workOrder.workOrderNumber ? `WO-${workOrder.workOrderNumber}` : 'Work Order'}
            {workOrder.synergyOrderNumber ? `  |  Synergy #${workOrder.synergyOrderNumber}` : ''}
            {'  |  '}
            {workOrder.completedDate}
          </Text>
        </View>

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
              <Text style={styles.colTotal}>{money(laborTotal)}</Text>
            </View>
          )}

          {workOrder.parts.map((part, idx) => (
            <View key={idx} style={styles.tableRow}>
              <Text style={styles.colDescription}>
                {partLabel(part)}
                {part.warrantyCovered ? ' (warranty)' : ''}
              </Text>
              <Text style={styles.colQty}>{part.quantity}</Text>
              <Text style={styles.colPrice}>{money(part.unitPrice)}</Text>
              <Text style={styles.colTotal}>
                {part.warrantyCovered || isWarranty ? '$0.00' : money(part.quantity * part.unitPrice)}
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

          {workOrder.diagnosticCharge > 0 && (
            <View style={styles.tableRow}>
              <Text style={styles.colDescription}>
                {workOrder.diagnosticInvoiceNumber
                  ? `Diagnostic Fee Credit (Inv #${workOrder.diagnosticInvoiceNumber})`
                  : 'Diagnostic Fee'}
              </Text>
              <Text style={styles.colQty}>—</Text>
              <Text style={styles.colPrice}>—</Text>
              <Text style={styles.colTotal}>
                {workOrder.diagnosticInvoiceNumber
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
            <Text style={styles.summaryValue}>{money(laborTotal)}</Text>
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
          {workOrder.diagnosticCharge > 0 && (
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>
                {workOrder.diagnosticInvoiceNumber ? 'Diagnostic Fee Credit:' : 'Diagnostic Fee:'}
              </Text>
              <Text style={styles.summaryValue}>
                {workOrder.diagnosticInvoiceNumber
                  ? `-${money(workOrder.diagnosticCharge)}`
                  : money(workOrder.diagnosticCharge)}
              </Text>
            </View>
          )}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total:</Text>
            <Text style={styles.totalValue}>{money(workOrder.billingTotal)}</Text>
          </View>
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
        <Text style={styles.footer} fixed>
          Work Order — {companyName ?? APP_NAME} Service Department
        </Text>
      </Page>
    </Document>
  )
}
