import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer'

// ============================================================
// Types
// ============================================================

interface PartLine {
  productNumber: string | null
  description: string
  quantity: number
  unit_price: number
}

interface BillingTicket {
  id: string
  workOrderNumber: number
  customerName: string
  accountNumber: string | null
  billingAddress: string | null
  serviceLocation: string | null
  arTerms: string | null
  equipmentMake: string | null
  equipmentModel: string | null
  serialNumber: string | null
  locationOnSite: string | null
  equipmentContactName: string | null
  equipmentContactEmail: string | null
  equipmentContactPhone: string | null
  technicianName: string
  completedDate: string
  hoursWorked: number | null
  machineHours: number | null
  dateCode: string | null
  completionNotes: string | null
  partsUsed: PartLine[]
  additionalPartsUsed: PartLine[]
  additionalHoursWorked: number | null
  laborRate: number
  billingAmount: number | null
  billingType: string | null
  flatRate: number | null
  poRequired: boolean
  poNumber: string | null
  billingContactName: string | null
  billingContactEmail: string | null
  billingContactPhone: string | null
  customerSignature: string | null
  customerSignatureName: string | null
  photoUrls: string[]
}

interface BillingDocumentProps {
  tickets: BillingTicket[]
  month: number
  year: number
  exportedAt: string
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
  // Header
  header: {
    marginBottom: 20,
    borderBottomWidth: 1.5,
    borderBottomColor: '#111111',
    paddingBottom: 10,
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
  generated: {
    fontSize: 7.5,
    color: '#888888',
    marginTop: 4,
  },
  // Section label
  sectionLabel: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: '#888888',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 4,
    marginTop: 12,
  },
  // Field rows
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
  // Parts table
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
  colQty: { width: 40, textAlign: 'right', color: '#111111' },
  colUnitPrice: { width: 60, textAlign: 'right', color: '#111111' },
  colTotal: { width: 60, textAlign: 'right', color: '#111111' },
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
  // Billing summary
  summaryBlock: {
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 0.5,
    borderTopColor: '#cccccc',
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 2,
  },
  summaryLabel: {
    width: 120,
    color: '#666666',
    textAlign: 'right',
    paddingRight: 8,
  },
  summaryValue: {
    width: 80,
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
    fontFamily: 'Helvetica-Bold',
    fontSize: 10,
    textAlign: 'right',
    paddingRight: 8,
    color: '#111111',
  },
  totalValue: {
    width: 80,
    fontFamily: 'Helvetica-Bold',
    fontSize: 10,
    textAlign: 'right',
    color: '#111111',
  },
  // Customer signature
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
  // Service photos
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
  // Divider between tickets
  ticketDivider: {
    borderBottomWidth: 0.5,
    borderBottomColor: '#cccccc',
    marginTop: 20,
    marginBottom: 4,
  },
  // Footer
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

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function fmt(value: number): string {
  return `$${value.toFixed(2)}`
}

function dash(value: string | null | undefined): string {
  return value?.trim() || '—'
}

// ============================================================
// Single ticket section
// ============================================================

function TicketSection({ ticket }: { ticket: BillingTicket }) {
  const isFlatRate = ticket.billingType === 'flat_rate' && ticket.flatRate != null
  const pmSubtotal = isFlatRate ? ticket.flatRate! : 0
  const additionalPartsTotal = ticket.additionalPartsUsed.reduce(
    (sum, p) => sum + p.quantity * p.unit_price, 0
  )
  const additionalLaborTotal = (ticket.additionalHoursWorked ?? 0) * ticket.laborRate
  const additionalSubtotal = additionalLaborTotal + additionalPartsTotal

  const equipmentLine = [ticket.equipmentMake, ticket.equipmentModel]
    .filter(Boolean)
    .join(' ') || '—'

  return (
    <View>
      {/* WORK ORDER */}
      <View style={styles.fieldRow}>
        <Text style={styles.fieldLabel}>Work Order #:</Text>
        <Text style={[styles.fieldValue, { fontFamily: 'Helvetica-Bold' }]}>WO-{ticket.workOrderNumber}</Text>
      </View>

      {/* CUSTOMER */}
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
        <Text style={styles.fieldLabel}>AR Terms:</Text>
        <Text style={styles.fieldValue}>{dash(ticket.arTerms)}</Text>
      </View>
      <View style={styles.fieldRow}>
        <Text style={styles.fieldLabel}>Billing Address:</Text>
        <Text style={styles.fieldValue}>{dash(ticket.billingAddress)}</Text>
      </View>
      <View style={styles.fieldRow}>
        <Text style={styles.fieldLabel}>Service Location:</Text>
        <Text style={styles.fieldValue}>{dash(ticket.serviceLocation)}</Text>
      </View>
      {ticket.poRequired && (
        <View style={[styles.fieldRow, { marginTop: 4 }]}>
          <Text style={[styles.fieldLabel, { fontFamily: 'Helvetica-Bold', color: '#cc0000' }]}>
            PO REQUIRED
          </Text>
          {ticket.poNumber && (
            <Text style={styles.fieldValue}>PO #: {ticket.poNumber}</Text>
          )}
        </View>
      )}

      {/* BILLING CONTACT */}
      {(ticket.billingContactName || ticket.billingContactEmail || ticket.billingContactPhone) && (
        <View style={{ marginTop: 4 }}>
          <Text style={[styles.fieldLabel, { marginBottom: 2 }]}>Billing Contact:</Text>
          <Text style={styles.fieldValue}>
            {[ticket.billingContactName, ticket.billingContactEmail, ticket.billingContactPhone].filter(Boolean).join('  |  ')}
          </Text>
        </View>
      )}

      {/* EQUIPMENT */}
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

      {/* SERVICE PERFORMED */}
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

      {/* SERVICE PHOTOS */}
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

      {/* PM SERVICE — COVERED UNDER AGREEMENT */}
      <Text style={styles.sectionLabel}>PM Service — Covered Under Agreement</Text>
      <View style={styles.table}>
        <View style={styles.tableHeaderRow}>
          <Text style={[styles.colProductNum, styles.tableHeaderText]}>Product #</Text>
          <Text style={[styles.colDescription, styles.tableHeaderText]}>Description</Text>
          <Text style={[styles.colQty, styles.tableHeaderText]}>Qty</Text>
        </View>
        {ticket.partsUsed.length === 0 ? (
          <Text style={styles.noPartsText}>No PM parts</Text>
        ) : (
          ticket.partsUsed.map((part, idx) => (
            <View key={idx} style={styles.tableRow}>
              <Text style={styles.colProductNum}>{part.productNumber ?? '—'}</Text>
              <Text style={styles.colDescription}>{dash(part.description)}</Text>
              <Text style={styles.colQty}>{part.quantity}</Text>
            </View>
          ))
        )}
      </View>
      {isFlatRate && (
        <View style={[styles.summaryRow, { marginTop: 4 }]}>
          <Text style={styles.summaryLabel}>PM Service (Flat Rate):</Text>
          <Text style={styles.summaryValue}>{fmt(pmSubtotal)}</Text>
        </View>
      )}

      {/* ADDITIONAL WORK — NOT COVERED UNDER AGREEMENT */}
      {(ticket.additionalPartsUsed.length > 0 || (ticket.additionalHoursWorked ?? 0) > 0) && (
        <View>
          <Text style={styles.sectionLabel}>Additional Work — Not Covered Under Agreement</Text>
          {(ticket.additionalHoursWorked ?? 0) > 0 && (
            <View style={[styles.summaryRow, { marginBottom: 4 }]}>
              <Text style={styles.summaryLabel}>
                Labor ({ticket.additionalHoursWorked} hrs @ {fmt(ticket.laborRate)}/hr):
              </Text>
              <Text style={styles.summaryValue}>{fmt(additionalLaborTotal)}</Text>
            </View>
          )}
          {ticket.additionalPartsUsed.length > 0 && (
            <View style={styles.table}>
              <View style={styles.tableHeaderRow}>
                <Text style={[styles.colProductNum, styles.tableHeaderText]}>Product #</Text>
                <Text style={[styles.colDescription, styles.tableHeaderText]}>Description</Text>
                <Text style={[styles.colQty, styles.tableHeaderText]}>Qty</Text>
                <Text style={[styles.colUnitPrice, styles.tableHeaderText]}>Unit Price</Text>
                <Text style={[styles.colTotal, styles.tableHeaderText]}>Total</Text>
              </View>
              {ticket.additionalPartsUsed.map((part, idx) => (
                <View key={idx} style={styles.tableRow}>
                  <Text style={styles.colProductNum}>{part.productNumber ?? '—'}</Text>
                  <Text style={styles.colDescription}>{dash(part.description)}</Text>
                  <Text style={styles.colQty}>{part.quantity}</Text>
                  <Text style={styles.colUnitPrice}>{fmt(part.unit_price)}</Text>
                  <Text style={styles.colTotal}>{fmt(part.quantity * part.unit_price)}</Text>
                </View>
              ))}
            </View>
          )}
          <View style={[styles.summaryRow, { marginTop: 4 }]}>
            <Text style={styles.summaryLabel}>Additional Work Subtotal:</Text>
            <Text style={styles.summaryValue}>{fmt(additionalSubtotal)}</Text>
          </View>
        </View>
      )}

      {/* GRAND TOTAL */}
      <View style={styles.summaryBlock}>
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>TOTAL AMOUNT DUE:</Text>
          <Text style={styles.totalValue}>
            {ticket.billingAmount != null ? fmt(ticket.billingAmount) : '—'}
          </Text>
        </View>
        <View style={[styles.summaryRow, { marginTop: 2 }]}>
          <Text style={[styles.summaryLabel, { fontSize: 7, color: '#888888', fontStyle: 'italic' }]}>
            Taxes not included
          </Text>
        </View>
      </View>

      {/* CUSTOMER SIGNATURE */}
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
    </View>
  )
}

// ============================================================
// Main document component
// ============================================================

export function BillingDocument({ tickets, month, year, exportedAt }: BillingDocumentProps) {
  const monthName = MONTHS[month - 1] ?? String(month)

  return (
    <Document>
      {tickets.map((ticket, idx) => (
        <Page key={ticket.id} size="LETTER" style={styles.page} wrap>
          {/* Header — on every page but logically per-ticket page */}
          <View style={styles.header} fixed>
            <Text style={styles.companyName}>American Osment — Service Department</Text>
            <Text style={styles.subtitle}>
              PM Billing Summary — {monthName} {year}
            </Text>
            <Text style={styles.generated}>Generated: {exportedAt}</Text>
          </View>

          <TicketSection ticket={ticket} />

          {/* Footer */}
          <Text style={styles.footer} fixed>
            For entry into SynergyERP — Reference document  |  PM Scheduler  |  Generated {exportedAt}
          </Text>
        </Page>
      ))}
    </Document>
  )
}
