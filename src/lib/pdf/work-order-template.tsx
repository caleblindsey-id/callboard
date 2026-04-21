import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer'

// ============================================================
// Types
// ============================================================

interface PartLine {
  productNumber: string | null
  description: string
  quantity: number
  unitPrice?: number
}

interface PricingSummary {
  billingType: 'flat_rate' | 'time_and_materials' | 'contract'
  flatRate: number | null
  pmHours: number | null
  additionalHours: number | null
  laborRatePerHour: number
  pmPartsPriced: boolean
  grandTotal: number
}

interface WorkOrderTicket {
  workOrderNumber: number
  customerName: string
  accountNumber: string | null
  serviceLocation: string | null
  equipmentMake: string | null
  equipmentModel: string | null
  serialNumber: string | null
  locationOnSite: string | null
  equipmentContactName: string | null
  equipmentContactEmail: string | null
  equipmentContactPhone: string | null
  poNumber: string | null
  technicianName: string
  completedDate: string
  hoursWorked: number | null
  machineHours: number | null
  dateCode: string | null
  completionNotes: string | null
  pmParts: PartLine[]
  additionalParts: PartLine[]
  additionalHoursWorked: number | null
  customerSignature: string | null
  customerSignatureName: string | null
  photoUrls: string[]
  pricing?: PricingSummary | null
}

interface WorkOrderDocumentProps {
  ticket: WorkOrderTicket
  logoBase64: string | null
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
    paddingBottom: 50,
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
  companyName: {
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
  colProductNum: { width: 70, color: '#111111' },
  colDescription: { flex: 3, color: '#111111' },
  colQty: { width: 50, textAlign: 'right', color: '#111111' },
  tableHeaderText: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 7.5,
    color: '#444444',
  },
  noPartsText: {
    fontSize: 8,
    color: '#888888',
    fontStyle: 'italic',
    paddingLeft: 6,
    paddingVertical: 4,
  },
  signatureBlock: {
    marginTop: 16,
    paddingTop: 10,
    borderTopWidth: 0.5,
    borderTopColor: '#cccccc',
  },
  signatureImage: {
    height: 50,
    width: 150,
    objectFit: 'contain' as const,
  },
  signatureLine: {
    borderBottomWidth: 0.5,
    borderBottomColor: '#111111',
    width: 200,
    marginTop: 2,
    marginBottom: 2,
  },
  signatureName: {
    fontSize: 8,
    color: '#444444',
    marginTop: 2,
  },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  photoImage: {
    width: 160,
    height: 120,
    objectFit: 'contain' as const,
    borderWidth: 0.5,
    borderColor: '#cccccc',
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
  // ── Pricing Summary ──
  pricingTable: {
    marginTop: 4,
    borderWidth: 0.5,
    borderColor: '#cccccc',
  },
  pricingHeaderRow: {
    flexDirection: 'row',
    backgroundColor: '#f0f0f0',
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: '#cccccc',
  },
  pricingRow: {
    flexDirection: 'row',
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: '#e8e8e8',
  },
  pricingColDesc: { flex: 3, color: '#111111' },
  pricingColQty: { width: 40, textAlign: 'right', color: '#111111' },
  pricingColRate: { width: 70, textAlign: 'right', color: '#111111' },
  pricingColTotal: { width: 70, textAlign: 'right', color: '#111111' },
  pricingTotalRow: {
    flexDirection: 'row',
    backgroundColor: '#111111',
    paddingVertical: 6,
    paddingHorizontal: 6,
  },
  pricingTotalLabel: {
    flex: 1,
    color: '#ffffff',
    fontFamily: 'Helvetica-Bold',
    fontSize: 10,
  },
  pricingTotalValue: {
    width: 80,
    textAlign: 'right',
    color: '#ffffff',
    fontFamily: 'Helvetica-Bold',
    fontSize: 10,
  },
  disclaimerBox: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#b91c1c',
    backgroundColor: '#fef2f2',
    padding: 8,
  },
  disclaimerHeading: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 9,
    color: '#b91c1c',
    marginBottom: 3,
    letterSpacing: 0.5,
  },
  disclaimerBody: {
    fontSize: 8,
    color: '#7f1d1d',
    lineHeight: 1.4,
  },
})

// ============================================================
// Helpers
// ============================================================

function dash(value: string | null | undefined): string {
  return value?.trim() || '—'
}

function money(n: number): string {
  return `$${n.toFixed(2)}`
}

function PricingSummarySection({
  pricing,
  pmParts,
  additionalParts,
  hoursWorked,
  additionalHoursWorked,
}: {
  pricing: PricingSummary
  pmParts: PartLine[]
  additionalParts: PartLine[]
  hoursWorked: number | null
  additionalHoursWorked: number | null
}) {
  const isFlatRate = pricing.billingType === 'flat_rate'
  const laborRate = pricing.laborRatePerHour

  // Rows for the priced line items.
  type Row = { desc: string; qty?: number; rate?: number; total: number }
  const rows: Row[] = []

  if (isFlatRate) {
    if (pricing.flatRate != null) {
      rows.push({ desc: 'PM Service — Flat Rate', total: pricing.flatRate })
    }
    for (const p of additionalParts) {
      const rate = p.unitPrice ?? 0
      rows.push({
        desc: p.description + (p.productNumber ? ` (${p.productNumber})` : ''),
        qty: p.quantity,
        rate,
        total: rate * p.quantity,
      })
    }
    const addlHrs = additionalHoursWorked ?? 0
    if (addlHrs > 0) {
      rows.push({
        desc: `Additional Labor`,
        qty: addlHrs,
        rate: laborRate,
        total: addlHrs * laborRate,
      })
    }
  } else {
    // T&M or contract: itemize everything.
    for (const p of [...pmParts, ...additionalParts]) {
      const rate = p.unitPrice ?? 0
      rows.push({
        desc: p.description + (p.productNumber ? ` (${p.productNumber})` : ''),
        qty: p.quantity,
        rate,
        total: rate * p.quantity,
      })
    }
    const totalHrs = (hoursWorked ?? 0) + (additionalHoursWorked ?? 0)
    if (totalHrs > 0) {
      rows.push({
        desc: 'Labor',
        qty: totalHrs,
        rate: laborRate,
        total: totalHrs * laborRate,
      })
    }
  }

  return (
    <View>
      <Text style={styles.sectionLabel}>Pricing Summary</Text>
      <View style={styles.pricingTable}>
        <View style={styles.pricingHeaderRow}>
          <Text style={[styles.pricingColDesc, styles.tableHeaderText]}>Description</Text>
          <Text style={[styles.pricingColQty, styles.tableHeaderText]}>Qty</Text>
          <Text style={[styles.pricingColRate, styles.tableHeaderText]}>Rate</Text>
          <Text style={[styles.pricingColTotal, styles.tableHeaderText]}>Total</Text>
        </View>
        {rows.length === 0 ? (
          <Text style={styles.noPartsText}>No charges</Text>
        ) : (
          rows.map((r, idx) => (
            <View key={idx} style={styles.pricingRow}>
              <Text style={styles.pricingColDesc}>{r.desc}</Text>
              <Text style={styles.pricingColQty}>{r.qty != null ? String(r.qty) : '—'}</Text>
              <Text style={styles.pricingColRate}>{r.rate != null ? money(r.rate) : '—'}</Text>
              <Text style={styles.pricingColTotal}>{money(r.total)}</Text>
            </View>
          ))
        )}
        <View style={styles.pricingTotalRow}>
          <Text style={styles.pricingTotalLabel}>Grand Total</Text>
          <Text style={styles.pricingTotalValue}>{money(pricing.grandTotal)}</Text>
        </View>
      </View>
      <View style={styles.disclaimerBox}>
        <Text style={styles.disclaimerHeading}>NOT A FINAL INVOICE</Text>
        <Text style={styles.disclaimerBody}>
          This document is for customer reference only. Final amounts are subject
          to change and do not include applicable taxes.
        </Text>
      </View>
    </View>
  )
}

// ============================================================
// Document
// ============================================================

export function CustomerWorkOrderDocument({ ticket, logoBase64 }: WorkOrderDocumentProps) {
  const equipmentLine = [ticket.equipmentMake, ticket.equipmentModel]
    .filter(Boolean)
    .join(' ') || '—'

  return (
    <Document>
      <Page size="LETTER" style={styles.page} wrap>
        {/* Header */}
        <View style={styles.header} fixed>
          {logoBase64 && (
            <Image src={logoBase64} style={styles.logo} />
          )}
          <Text style={styles.subtitle}>Service Work Order</Text>
        </View>

        {/* Work Order # */}
        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>Work Order #:</Text>
          <Text style={[styles.fieldValue, { fontFamily: 'Helvetica-Bold' }]}>WO-{ticket.workOrderNumber}</Text>
        </View>
        {ticket.poNumber && (
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>PO Number:</Text>
            <Text style={[styles.fieldValue, { fontFamily: 'Helvetica-Bold' }]}>{ticket.poNumber}</Text>
          </View>
        )}

        {/* Customer */}
        <Text style={styles.sectionLabel}>Customer</Text>
        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>Name:</Text>
          <Text style={styles.fieldValue}>{dash(ticket.customerName)}</Text>
        </View>
        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>Account #:</Text>
          <Text style={styles.fieldValue}>{dash(ticket.accountNumber)}</Text>
        </View>
        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>Service Location:</Text>
          <Text style={styles.fieldValue}>{dash(ticket.serviceLocation)}</Text>
        </View>

        {/* Equipment */}
        <Text style={styles.sectionLabel}>Equipment</Text>
        <View style={styles.fieldRow}>
          <Text style={styles.fieldValue}>
            {equipmentLine}
            {ticket.serialNumber ? `  |  Serial: ${ticket.serialNumber}` : ''}
            {ticket.locationOnSite ? `  |  Location: ${ticket.locationOnSite}` : ''}
          </Text>
        </View>
        {(ticket.equipmentContactName || ticket.equipmentContactEmail || ticket.equipmentContactPhone) && (
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>Site Contact:</Text>
            <Text style={styles.fieldValue}>
              {[ticket.equipmentContactName, ticket.equipmentContactEmail, ticket.equipmentContactPhone].filter(Boolean).join('  |  ')}
            </Text>
          </View>
        )}

        {/* Service Performed */}
        <Text style={styles.sectionLabel}>Service Performed</Text>
        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>Technician:</Text>
          <Text style={styles.fieldValue}>{dash(ticket.technicianName)}</Text>
        </View>
        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>Date Completed:</Text>
          <Text style={styles.fieldValue}>{dash(ticket.completedDate)}</Text>
        </View>
        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>Hours Worked:</Text>
          <Text style={styles.fieldValue}>
            {ticket.hoursWorked != null ? String(ticket.hoursWorked) : '—'}
          </Text>
        </View>
        {ticket.machineHours != null && (
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>Machine Hours:</Text>
            <Text style={styles.fieldValue}>{String(ticket.machineHours)}</Text>
          </View>
        )}
        {ticket.dateCode && (
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>Date Code:</Text>
            <Text style={styles.fieldValue}>{ticket.dateCode}</Text>
          </View>
        )}
        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>Notes:</Text>
          <Text style={styles.fieldValue}>{dash(ticket.completionNotes)}</Text>
        </View>

        {/* Service Photos */}
        {ticket.photoUrls.length > 0 && (
          <View>
            <Text style={styles.sectionLabel}>Service Photos</Text>
            <View style={styles.photoGrid}>
              {ticket.photoUrls.map((url, idx) => (
                <Image key={idx} src={url} style={styles.photoImage} />
              ))}
            </View>
          </View>
        )}

        {/* PM Parts */}
        <Text style={styles.sectionLabel}>PM Service — Parts Used</Text>
        <View style={styles.table}>
          <View style={styles.tableHeaderRow}>
            <Text style={[styles.colProductNum, styles.tableHeaderText]}>Product #</Text>
            <Text style={[styles.colDescription, styles.tableHeaderText]}>Description</Text>
            <Text style={[styles.colQty, styles.tableHeaderText]}>Qty</Text>
          </View>
          {ticket.pmParts.length === 0 ? (
            <Text style={styles.noPartsText}>No PM parts</Text>
          ) : (
            ticket.pmParts.map((part, idx) => (
              <View key={idx} style={styles.tableRow}>
                <Text style={styles.colProductNum}>{part.productNumber ?? '—'}</Text>
                <Text style={styles.colDescription}>{dash(part.description)}</Text>
                <Text style={styles.colQty}>{part.quantity}</Text>
              </View>
            ))
          )}
        </View>

        {/* Additional Work */}
        {(ticket.additionalParts.length > 0 || (ticket.additionalHoursWorked ?? 0) > 0) && (
          <View>
            <Text style={styles.sectionLabel}>Additional Work Performed</Text>
            {(ticket.additionalHoursWorked ?? 0) > 0 && (
              <View style={styles.fieldRow}>
                <Text style={styles.fieldLabel}>Additional Labor:</Text>
                <Text style={styles.fieldValue}>{ticket.additionalHoursWorked} hours</Text>
              </View>
            )}
            {ticket.additionalParts.length > 0 && (
              <View style={styles.table}>
                <View style={styles.tableHeaderRow}>
                  <Text style={[styles.colProductNum, styles.tableHeaderText]}>Product #</Text>
                  <Text style={[styles.colDescription, styles.tableHeaderText]}>Description</Text>
                  <Text style={[styles.colQty, styles.tableHeaderText]}>Qty</Text>
                </View>
                {ticket.additionalParts.map((part, idx) => (
                  <View key={idx} style={styles.tableRow}>
                    <Text style={styles.colProductNum}>{part.productNumber ?? '—'}</Text>
                    <Text style={styles.colDescription}>{dash(part.description)}</Text>
                    <Text style={styles.colQty}>{part.quantity}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {/* Pricing Summary */}
        {ticket.pricing && (
          <PricingSummarySection
            pricing={ticket.pricing}
            pmParts={ticket.pmParts}
            additionalParts={ticket.additionalParts}
            hoursWorked={ticket.hoursWorked}
            additionalHoursWorked={ticket.additionalHoursWorked}
          />
        )}

        {/* Customer Signature */}
        {ticket.customerSignature && (
          <View style={styles.signatureBlock}>
            <Text style={styles.sectionLabel}>Customer Acknowledgement</Text>
            <Image src={ticket.customerSignature} style={styles.signatureImage} />
            <View style={styles.signatureLine} />
            <Text style={styles.signatureName}>
              {ticket.customerSignatureName ?? '—'}
            </Text>
          </View>
        )}

        {/* Footer */}
        <Text style={styles.footer} fixed>
          Customer Copy — Imperial Dade Service Department
        </Text>
      </Page>
    </Document>
  )
}
