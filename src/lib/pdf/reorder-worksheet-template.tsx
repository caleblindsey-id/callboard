import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer'
import { APP_NAME } from '@/lib/branding'
import { PdfHeader, PdfFooter } from '@/lib/pdf/chrome'

// Per-vendor PO worksheet — mirrors billing-template.tsx's structure (one
// Page per grouping, PdfHeader/PdfFooter chrome, a local StyleSheet for the
// body). See docs/superpowers/specs/2026-07-14-purchasing-reorder-module-
// design.md, "PO Worksheet Output".

// ============================================================
// Types
// ============================================================

export interface WorksheetLine {
  productNumber: string
  description: string | null
  orderQty: number
  buyingUom: string | null
  vendorItemNumber: string | null
  unitCost: number | null
  caseCost: number
  extended: number
  binLocation: string | null
  note: string | null
}

export interface WorksheetVendorGroup {
  vendorCode: number
  vendorName: string
  orderMinimum: number | null
  lines: WorksheetLine[]
  subtotal: number
  lineCount: number
}

interface ReorderWorksheetDocumentProps {
  vendors: WorksheetVendorGroup[]
  buyerName: string | null
  exportedAt: string
  companyName?: string
  logoBase64?: string | null
}

// ============================================================
// Styles
// ============================================================

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 8.5,
    color: '#111111',
    paddingTop: 40,
    paddingBottom: 50,
    paddingHorizontal: 48,
    backgroundColor: '#ffffff',
  },
  fieldBlock: {
    marginBottom: 10,
  },
  fieldRow: {
    flexDirection: 'row',
    marginBottom: 2,
  },
  fieldLabel: {
    width: 90,
    color: '#666666',
  },
  fieldValue: {
    flex: 1,
    color: '#111111',
  },
  minBadge: {
    fontFamily: 'Helvetica-Bold',
  },
  minMet: { color: '#166534' },
  minNotMet: { color: '#b45309' },
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
  tableHeaderText: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 7,
    color: '#444444',
  },
  colProductNum: { width: 52, color: '#111111' },
  colDescription: { flex: 2, color: '#111111' },
  colQty: { width: 32, textAlign: 'right', color: '#111111' },
  colUom: { width: 28, color: '#111111' },
  colVendorItem: { width: 52, color: '#111111' },
  colUnitCost: { width: 42, textAlign: 'right', color: '#111111' },
  colCaseCost: { width: 42, textAlign: 'right', color: '#111111' },
  colExtended: { width: 46, textAlign: 'right', color: '#111111' },
  colBin: { width: 36, color: '#111111' },
  colNote: { flex: 1, color: '#111111' },
  summaryBlock: {
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 0.5,
    borderTopColor: '#cccccc',
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  summaryLabel: {
    color: '#666666',
    textAlign: 'right',
    paddingRight: 8,
  },
  summaryValue: {
    width: 80,
    fontFamily: 'Helvetica-Bold',
    fontSize: 10,
    textAlign: 'right',
    color: '#111111',
  },
})

// ============================================================
// Helpers
// ============================================================

function fmt(value: number): string {
  return `$${value.toFixed(2)}`
}

function dash(value: string | null | undefined): string {
  return value?.trim() || '—'
}

// ============================================================
// Single vendor page
// ============================================================

function VendorWorksheetPage({
  group,
  buyerName,
  exportedAt,
  companyName,
  logoBase64,
}: {
  group: WorksheetVendorGroup
  buyerName: string | null
  exportedAt: string
  companyName?: string
  logoBase64?: string | null
}) {
  const hasMinimum = group.orderMinimum != null && group.orderMinimum > 0
  const minimumMet = hasMinimum ? group.subtotal >= (group.orderMinimum as number) : null

  return (
    <Page size="LETTER" style={styles.page} wrap>
      <PdfHeader
        logoBase64={logoBase64}
        companyName={companyName ?? APP_NAME}
        title="Reorder PO Worksheet"
        subtitle={`Vendor ${group.vendorCode}: ${group.vendorName}`}
        rightLines={[{ text: `Generated: ${exportedAt}` }]}
      />

      <View style={styles.fieldBlock}>
        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>Vendor:</Text>
          <Text style={styles.fieldValue}>
            {group.vendorCode} ({dash(group.vendorName)})
          </Text>
        </View>
        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>Buyer:</Text>
          <Text style={styles.fieldValue}>{dash(buyerName)}</Text>
        </View>
        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>Date:</Text>
          <Text style={styles.fieldValue}>{exportedAt}</Text>
        </View>
        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>Ship to:</Text>
          <Text style={styles.fieldValue}>Imperial Dade, Whse 4 (Service)</Text>
        </View>
        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>Order minimum:</Text>
          <Text style={styles.fieldValue}>
            {hasMinimum ? (
              <>
                {fmt(group.orderMinimum as number)}{' '}
                <Text style={[styles.minBadge, minimumMet ? styles.minMet : styles.minNotMet]}>
                  ({minimumMet ? 'met' : 'not met'})
                </Text>
              </>
            ) : (
              'None on file'
            )}
          </Text>
        </View>
      </View>

      <View style={styles.table}>
        <View style={styles.tableHeaderRow}>
          <Text style={[styles.colProductNum, styles.tableHeaderText]}>Product #</Text>
          <Text style={[styles.colDescription, styles.tableHeaderText]}>Description</Text>
          <Text style={[styles.colQty, styles.tableHeaderText]}>Qty</Text>
          <Text style={[styles.colUom, styles.tableHeaderText]}>UOM</Text>
          <Text style={[styles.colVendorItem, styles.tableHeaderText]}>Vendor Item #</Text>
          <Text style={[styles.colUnitCost, styles.tableHeaderText]}>Unit Cost</Text>
          <Text style={[styles.colCaseCost, styles.tableHeaderText]}>Case Cost</Text>
          <Text style={[styles.colExtended, styles.tableHeaderText]}>Extended</Text>
          <Text style={[styles.colBin, styles.tableHeaderText]}>Bin</Text>
          <Text style={[styles.colNote, styles.tableHeaderText]}>Note</Text>
        </View>
        {group.lines.map((line, idx) => (
          <View key={idx} style={styles.tableRow}>
            <Text style={styles.colProductNum}>{line.productNumber}</Text>
            <Text style={styles.colDescription}>{dash(line.description)}</Text>
            <Text style={styles.colQty}>{line.orderQty}</Text>
            <Text style={styles.colUom}>{dash(line.buyingUom)}</Text>
            <Text style={styles.colVendorItem}>{dash(line.vendorItemNumber)}</Text>
            <Text style={styles.colUnitCost}>{line.unitCost != null ? fmt(line.unitCost) : '—'}</Text>
            <Text style={styles.colCaseCost}>{fmt(line.caseCost)}</Text>
            <Text style={styles.colExtended}>{fmt(line.extended)}</Text>
            <Text style={styles.colBin}>{dash(line.binLocation)}</Text>
            <Text style={styles.colNote}>{dash(line.note)}</Text>
          </View>
        ))}
      </View>

      <View style={styles.summaryBlock}>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>
            {group.lineCount} line{group.lineCount === 1 ? '' : 's'}, subtotal:
          </Text>
          <Text style={styles.summaryValue}>{fmt(group.subtotal)}</Text>
        </View>
      </View>

      <PdfFooter left="For entry into SynergyERP: Reorder worksheet" right={companyName ?? APP_NAME} />
    </Page>
  )
}

// ============================================================
// Main document component
// ============================================================

export function ReorderWorksheetDocument({
  vendors,
  buyerName,
  exportedAt,
  companyName,
  logoBase64,
}: ReorderWorksheetDocumentProps) {
  return (
    <Document>
      {vendors.map((group) => (
        <VendorWorksheetPage
          key={group.vendorCode}
          group={group}
          buyerName={buyerName}
          exportedAt={exportedAt}
          companyName={companyName}
          logoBase64={logoBase64}
        />
      ))}
    </Document>
  )
}
