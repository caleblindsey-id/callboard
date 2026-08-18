import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer'
import { APP_NAME } from '@/lib/branding'
import { PdfHeader, PdfFooter } from '@/lib/pdf/chrome'

// ============================================================
// PM quote — customer-facing priced document for scheduled preventative
// maintenance. One quote spans many PM work orders for a single customer.
//
// Deliberately NOT the service estimate (src/lib/pdf/estimate-template.tsx):
// that one prices diagnosed repair work off service_tickets. A PM is a
// flat_rate agreement price carried on pm_schedules, so every line here is one
// work order at one flat rate, and the parts seeded onto the ticket are
// covered by that rate and print as scope, never as priced rows.
//
// Body styling follows the Direction 1 recipe (wiki/knowledge/pm-pdf-design.md
// in the Compass repo). Chrome comes from ./chrome.tsx so this reads as part of
// the same document family.
// ============================================================

// ============================================================
// Types
// ============================================================

export interface PmQuoteLine {
  workOrderNumber: number | null
  /** "TENNANT T300E" — make and model joined. */
  equipmentLine: string
  /** Equipment description, e.g. "FLOOR SCRUBBER ORBITAL". */
  equipmentDescription: string | null
  serialNumber: string | null
  /** "Semi-Annual", from INTERVAL_OPTIONS. */
  frequencyLabel: string
  /** Flat rate snapshot for this work order. */
  amount: number
}

export interface PmQuoteData {
  /** Null in the stateless round, before quotes are persisted. */
  quoteNumber: number | null
  preparedDate: string
  /** Billing period the quoted work orders fall in, e.g. "July 2026". */
  servicePeriod: string | null
  customerName: string
  accountNumber: string | null
  billingAddress: string | null
  siteName: string | null
  siteAddress: string | null
  siteContact: string | null
  arTerms: string | null
  poRequired: boolean
  lines: PmQuoteLine[]
  /** Deduped default-product descriptions covered by the flat rate. */
  includedScope: string[]
  subtotal: number
  taxExempt: boolean
}

interface PmQuoteDocumentProps {
  quote: PmQuoteData
  logoBase64: string | null
  companyName?: string
  serviceEmail?: string | null
  servicePhone?: string | null
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
  sectionLabel: {
    fontSize: 8.5,
    fontFamily: 'Helvetica-Bold',
    color: '#111111',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginTop: 14,
    marginBottom: 6,
    paddingBottom: 3,
    borderBottomWidth: 0.5,
    borderBottomColor: '#d4d4d4',
  },

  // Two-up address blocks
  addressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  addressCol: {
    flex: 1,
    paddingRight: 12,
  },
  addressHeading: {
    fontSize: 7.5,
    fontFamily: 'Helvetica-Bold',
    color: '#888888',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 3,
  },
  addressName: {
    fontFamily: 'Helvetica-Bold',
    color: '#111111',
    marginBottom: 1,
  },
  addressLine: {
    color: '#444444',
  },
  addressContact: {
    color: '#444444',
    marginTop: 4,
  },

  // Line-item table
  tableHeaderRow: {
    flexDirection: 'row',
    backgroundColor: '#f7f7f7',
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: '#cccccc',
  },
  tableHeaderText: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 7.5,
    color: '#444444',
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 5,
    paddingHorizontal: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: '#eeeeee',
  },
  tableRowAlt: {
    backgroundColor: '#fafafa',
  },
  colWo: { width: 52, color: '#111111' },
  colEquipment: { flex: 3, paddingRight: 8, color: '#111111' },
  colSerial: { width: 78, color: '#444444' },
  colFrequency: { width: 66, color: '#444444' },
  colAmount: { width: 62, textAlign: 'right', color: '#111111' },
  equipmentSub: {
    fontSize: 7.5,
    color: '#777777',
    marginTop: 1,
  },

  // Scope list
  scopeItem: {
    color: '#444444',
    marginBottom: 1,
  },
  scopeNote: {
    fontSize: 7.5,
    color: '#888888',
    marginTop: 4,
    fontStyle: 'italic',
  },

  // Totals
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 2,
  },
  summaryLabel: {
    width: 130,
    textAlign: 'right',
    color: '#666666',
    paddingRight: 10,
  },
  summaryValue: {
    width: 72,
    textAlign: 'right',
    color: '#111111',
  },
  totalBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    backgroundColor: '#f0f0f0',
    borderTopWidth: 1,
    borderTopColor: '#111111',
    marginTop: 6,
    paddingVertical: 6,
    paddingRight: 6,
  },
  totalLabel: {
    width: 130,
    textAlign: 'right',
    paddingRight: 10,
    fontFamily: 'Helvetica-Bold',
    fontSize: 10,
    color: '#111111',
  },
  totalValue: {
    width: 72,
    textAlign: 'right',
    fontFamily: 'Helvetica-Bold',
    fontSize: 10,
    color: '#111111',
  },

  // Terms
  termsRow: {
    flexDirection: 'row',
    marginBottom: 2,
  },
  termsLabel: {
    width: 90,
    fontSize: 8.5,
    color: '#555555',
  },
  termsValue: {
    flex: 1,
    color: '#111111',
  },

  // Amber disclaimer, matching the PM work order
  disclaimer: {
    marginTop: 14,
    padding: 8,
    backgroundColor: '#fffbeb',
    borderWidth: 0.5,
    borderColor: '#f59e0b',
    borderRadius: 2,
  },
  disclaimerTitle: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: '#92400e',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginBottom: 3,
  },
  disclaimerText: {
    fontSize: 7.5,
    color: '#92400e',
  },
})

// ============================================================
// Helpers
// ============================================================

function money(amount: number): string {
  return `$${amount.toFixed(2)}`
}

// ============================================================
// Document
// ============================================================

export function PmQuoteDocument({
  quote,
  logoBase64,
  companyName,
  serviceEmail,
  servicePhone,
}: PmQuoteDocumentProps) {
  const quoteLabel = quote.quoteNumber ? `Q-${quote.quoteNumber}` : undefined
  const footerLeft = quoteLabel ?? 'Preventative Maintenance Quote'

  return (
    <Document>
      <Page size="LETTER" style={styles.page} wrap>
        <PdfHeader
          logoBase64={logoBase64}
          companyName={companyName ?? APP_NAME}
          title="Preventative Maintenance Quote"
          subtitle={quote.servicePeriod ? `Service period: ${quote.servicePeriod}` : undefined}
          documentNumber={quoteLabel}
          rightLines={[
            { text: quote.preparedDate },
            { text: serviceEmail ?? '' },
            { text: servicePhone ?? '' },
          ]}
        />

        {/* Bill to / service location */}
        <View style={styles.addressRow}>
          <View style={styles.addressCol}>
            <Text style={styles.addressHeading}>Bill To</Text>
            <Text style={styles.addressName}>{quote.customerName}</Text>
            {quote.accountNumber && (
              <Text style={styles.addressLine}>Account {quote.accountNumber}</Text>
            )}
            {quote.billingAddress && (
              <Text style={styles.addressLine}>{quote.billingAddress}</Text>
            )}
          </View>
          <View style={styles.addressCol}>
            <Text style={styles.addressHeading}>Service Location</Text>
            <Text style={styles.addressName}>{quote.siteName ?? quote.customerName}</Text>
            {quote.siteAddress && <Text style={styles.addressLine}>{quote.siteAddress}</Text>}
            {quote.siteContact && <Text style={styles.addressContact}>{quote.siteContact}</Text>}
          </View>
        </View>

        {/* Line items */}
        <Text style={styles.sectionLabel}>Scheduled Preventative Maintenance</Text>
        <View style={styles.tableHeaderRow}>
          <Text style={[styles.colWo, styles.tableHeaderText]}>WO #</Text>
          <Text style={[styles.colEquipment, styles.tableHeaderText]}>Equipment</Text>
          <Text style={[styles.colSerial, styles.tableHeaderText]}>Serial</Text>
          <Text style={[styles.colFrequency, styles.tableHeaderText]}>Frequency</Text>
          <Text style={[styles.colAmount, styles.tableHeaderText]}>Amount</Text>
        </View>
        {quote.lines.map((line, idx) => (
          <View
            key={idx}
            style={idx % 2 === 1 ? [styles.tableRow, styles.tableRowAlt] : styles.tableRow}
            wrap={false}
          >
            <Text style={styles.colWo}>
              {line.workOrderNumber ? `${line.workOrderNumber}` : '—'}
            </Text>
            <View style={styles.colEquipment}>
              <Text>{line.equipmentLine}</Text>
              {line.equipmentDescription && (
                <Text style={styles.equipmentSub}>{line.equipmentDescription}</Text>
              )}
            </View>
            <Text style={styles.colSerial}>{line.serialNumber ?? '—'}</Text>
            <Text style={styles.colFrequency}>{line.frequencyLabel}</Text>
            <Text style={styles.colAmount}>{money(line.amount)}</Text>
          </View>
        ))}

        {/* Totals */}
        <View style={{ marginTop: 8 }}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Subtotal:</Text>
            <Text style={styles.summaryValue}>{money(quote.subtotal)}</Text>
          </View>
          {quote.taxExempt && (
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Sales Tax:</Text>
              <Text style={styles.summaryValue}>Exempt</Text>
            </View>
          )}
          <View style={styles.totalBar}>
            <Text style={styles.totalLabel}>Quote Total:</Text>
            <Text style={styles.totalValue}>{money(quote.subtotal)}</Text>
          </View>
        </View>

        {/* Included scope */}
        {quote.includedScope.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>Included With Each Preventative Maintenance</Text>
            {quote.includedScope.map((item, idx) => (
              <Text key={idx} style={styles.scopeItem}>
                {`•  ${item}`}
              </Text>
            ))}
            <Text style={styles.scopeNote}>
              Labor, travel, and the items listed above are covered by the flat rate shown for each
              work order.
            </Text>
          </>
        )}

        {/* Terms */}
        <Text style={styles.sectionLabel}>Terms</Text>
        {quote.arTerms && (
          <View style={styles.termsRow}>
            <Text style={styles.termsLabel}>Payment:</Text>
            <Text style={styles.termsValue}>{quote.arTerms}</Text>
          </View>
        )}
        <View style={styles.termsRow}>
          <Text style={styles.termsLabel}>Quote valid:</Text>
          <Text style={styles.termsValue}>30 days from the date above</Text>
        </View>
        {quote.poRequired && (
          <View style={styles.termsRow}>
            <Text style={styles.termsLabel}>Purchase order:</Text>
            <Text style={styles.termsValue}>
              Required on this account. Please provide a PO number with your approval so the work
              can be scheduled and invoiced without delay.
            </Text>
          </View>
        )}

        {/* Disclaimer */}
        <View style={styles.disclaimer} wrap={false}>
          <Text style={styles.disclaimerTitle}>This is a quote, not an invoice</Text>
          <Text style={styles.disclaimerText}>
            This quote covers scheduled preventative maintenance only. If a technician finds a
            repair need during the visit, that work is quoted separately and is not performed
            without your approval. Any applicable sales tax is calculated at the time of invoicing.
          </Text>
        </View>

        <PdfFooter left={footerLeft} right={`${companyName ?? APP_NAME} Service Department`} />
      </Page>
    </Document>
  )
}
