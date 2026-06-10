import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer'
import { APP_NAME } from '@/lib/branding'
import { partLabel } from '@/lib/parts'

// ============================================================
// Types
// ============================================================

interface EstimatePart {
  description: string
  // Free-text detail for catch-all items (e.g. SHOP SUPPLIES). Optional.
  detail?: string | null
  quantity: number
  unitPrice: number
  warrantyCovered: boolean
}

interface EstimateData {
  workOrderNumber: number | null
  customerName: string
  accountNumber: string | null
  serviceAddress: string | null
  equipmentLine: string
  serialNumber: string | null
  contactName: string | null
  contactEmail: string | null
  contactPhone: string | null
  problemDescription: string
  diagnosisNotes: string | null
  billingType: string
  laborHours: number
  laborRate: number
  parts: EstimatePart[]
  tripCharge: number
  estimateTotal: number
  createdDate: string
}

interface EstimateDocumentProps {
  estimate: EstimateData
  logoBase64: string | null
  companyName?: string
}

// ============================================================
// Styles
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
  logo: {
    width: 160,
    height: 50,
    objectFit: 'contain' as const,
    marginBottom: 6,
  },
  title: {
    fontSize: 16,
    fontFamily: 'Helvetica-Bold',
    color: '#111111',
    letterSpacing: 0.3,
  },
  subtitle: {
    fontSize: 11,
    color: '#444444',
    marginTop: 3,
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
  fieldRow: {
    flexDirection: 'row',
    marginBottom: 2,
  },
  fieldLabel: {
    width: 100,
    color: '#666666',
  },
  fieldValue: {
    flex: 1,
    color: '#111111',
  },
  table: {
    marginTop: 4,
  },
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
  tableHeaderText: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 7.5,
    color: '#444444',
  },
  summaryBlock: {
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#cccccc',
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 2,
  },
  summaryLabel: {
    width: 120,
    textAlign: 'right',
    color: '#666666',
    paddingRight: 10,
  },
  summaryValue: {
    width: 70,
    textAlign: 'right',
    color: '#111111',
  },
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
  disclaimer: {
    marginTop: 20,
    paddingTop: 10,
    borderTopWidth: 0.5,
    borderTopColor: '#e0e0e0',
  },
  disclaimerText: {
    fontSize: 7.5,
    color: '#888888',
    fontStyle: 'italic',
    lineHeight: 1.4,
  },
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

export function EstimateDocument({ estimate, logoBase64, companyName }: EstimateDocumentProps) {
  const laborTotal = estimate.laborHours * estimate.laborRate
  const isWarranty = estimate.billingType === 'warranty'
  const partsTotal = isWarranty
    ? 0
    : estimate.parts
        .filter((p) => !p.warrantyCovered)
        .reduce((sum, p) => sum + p.quantity * p.unitPrice, 0)

  return (
    <Document>
      <Page size="LETTER" style={styles.page} wrap>
        {/* Header */}
        <View style={styles.header} fixed>
          {logoBase64 && (
            <Image src={logoBase64} style={styles.logo} />
          )}
          <Text style={styles.title}>Service Estimate</Text>
          <Text style={styles.subtitle}>
            {estimate.workOrderNumber ? `WO-${estimate.workOrderNumber}` : 'Estimate'}
            {'  |  '}
            {estimate.createdDate}
          </Text>
        </View>

        {/* Customer */}
        <Text style={styles.sectionLabel}>Customer</Text>
        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>Name:</Text>
          <Text style={styles.fieldValue}>{dash(estimate.customerName)}</Text>
        </View>
        {estimate.accountNumber && (
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>Account #:</Text>
            <Text style={styles.fieldValue}>{estimate.accountNumber}</Text>
          </View>
        )}
        {estimate.serviceAddress && (
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>Service Location:</Text>
            <Text style={styles.fieldValue}>{estimate.serviceAddress}</Text>
          </View>
        )}

        {/* Equipment */}
        <Text style={styles.sectionLabel}>Equipment</Text>
        <View style={styles.fieldRow}>
          <Text style={styles.fieldValue}>
            {estimate.equipmentLine}
            {estimate.serialNumber ? `  |  Serial: ${estimate.serialNumber}` : ''}
          </Text>
        </View>
        {(estimate.contactName || estimate.contactEmail || estimate.contactPhone) && (
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>Site Contact:</Text>
            <Text style={styles.fieldValue}>
              {[estimate.contactName, estimate.contactEmail, estimate.contactPhone].filter(Boolean).join('  |  ')}
            </Text>
          </View>
        )}

        {/* Problem Description */}
        <Text style={styles.sectionLabel}>Problem Description</Text>
        <View style={styles.fieldRow}>
          <Text style={styles.fieldValue}>{dash(estimate.problemDescription)}</Text>
        </View>

        {/* Diagnosis */}
        {estimate.diagnosisNotes && (
          <>
            <Text style={styles.sectionLabel}>Diagnosis</Text>
            <View style={styles.fieldRow}>
              <Text style={styles.fieldValue}>{estimate.diagnosisNotes}</Text>
            </View>
          </>
        )}

        {/* Estimate Breakdown */}
        <Text style={styles.sectionLabel}>Estimate Breakdown</Text>

        {/* Labor */}
        <View style={styles.table}>
          <View style={styles.tableHeaderRow}>
            <Text style={[styles.colDescription, styles.tableHeaderText]}>Description</Text>
            <Text style={[styles.colQty, styles.tableHeaderText]}>Qty</Text>
            <Text style={[styles.colPrice, styles.tableHeaderText]}>Rate/Price</Text>
            <Text style={[styles.colTotal, styles.tableHeaderText]}>Amount</Text>
          </View>

          {/* Labor line */}
          {estimate.laborHours > 0 && (
            <View style={styles.tableRow}>
              <Text style={styles.colDescription}>Service Labor</Text>
              <Text style={styles.colQty}>{estimate.laborHours}</Text>
              <Text style={styles.colPrice}>{money(estimate.laborRate)}/hr</Text>
              <Text style={styles.colTotal}>{money(laborTotal)}</Text>
            </View>
          )}

          {/* Parts lines */}
          {estimate.parts.map((part, idx) => (
            <View key={idx} style={styles.tableRow}>
              <Text style={styles.colDescription}>
                {partLabel(part)}
                {part.warrantyCovered ? ' (warranty)' : ''}
              </Text>
              <Text style={styles.colQty}>{part.quantity}</Text>
              <Text style={styles.colPrice}>{money(part.unitPrice)}</Text>
              <Text style={styles.colTotal}>
                {part.warrantyCovered ? '$0.00' : money(part.quantity * part.unitPrice)}
              </Text>
            </View>
          ))}

          {/* Trip charge line */}
          {estimate.tripCharge > 0 && (
            <View style={styles.tableRow}>
              <Text style={styles.colDescription}>Trip Charge</Text>
              <Text style={styles.colQty}></Text>
              <Text style={styles.colPrice}></Text>
              <Text style={styles.colTotal}>{money(estimate.tripCharge)}</Text>
            </View>
          )}
        </View>

        {/* Summary */}
        <View style={styles.summaryBlock}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Labor Subtotal:</Text>
            <Text style={styles.summaryValue}>{money(laborTotal)}</Text>
          </View>
          {estimate.parts.length > 0 && (
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Parts Subtotal:</Text>
              <Text style={styles.summaryValue}>{money(partsTotal)}</Text>
            </View>
          )}
          {estimate.tripCharge > 0 && (
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Trip Charge:</Text>
              <Text style={styles.summaryValue}>{money(estimate.tripCharge)}</Text>
            </View>
          )}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Estimated Total:</Text>
            <Text style={styles.totalValue}>{money(estimate.estimateTotal)}</Text>
          </View>
        </View>

        {/* Disclaimer */}
        <View style={styles.disclaimer}>
          <Text style={styles.disclaimerText}>
            This is an estimate only and is subject to change. Actual charges may vary based on
            findings during service. All prices are subject to applicable taxes. This estimate does
            not constitute a binding agreement. Parts availability and pricing are subject to change
            without notice.
          </Text>
        </View>

        {/* Footer */}
        <Text style={styles.footer} fixed>
          Estimate — {companyName ?? APP_NAME} Service Department
        </Text>
      </Page>
    </Document>
  )
}
