import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer'

// ============================================================
// Types
// ============================================================

// Trimmed To-Pull row — the puller-relevant fields only. The API route maps
// PartsQueueRow → this shape so the client doesn't ship the whole row.
export interface PickListRow {
  bin_location: string | null
  product_number: string | null
  part: string | null            // partLabel(row) || description
  quantity: number | null
  machine: string | null         // "Make Model — S/N 1234"
  customer_name: string | null
  work_order_number: number | null
  technician_name: string | null
}

interface PickListDocumentProps {
  rows: PickListRow[]
  generatedDate: string
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
    paddingTop: 36,
    paddingBottom: 48,
    paddingHorizontal: 36,
    backgroundColor: '#ffffff',
  },
  header: {
    marginBottom: 14,
    borderBottomWidth: 1.5,
    borderBottomColor: '#111111',
    paddingBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  logo: { width: 150, height: 46, objectFit: 'contain' as const },
  title: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: '#111111' },
  subtitle: { fontSize: 10, color: '#444444', marginTop: 2, textAlign: 'right' as const },
  tableHeaderRow: {
    flexDirection: 'row',
    backgroundColor: '#f0f0f0',
    paddingVertical: 5,
    paddingHorizontal: 4,
    borderTopWidth: 0.5,
    borderTopColor: '#cccccc',
    borderBottomWidth: 0.5,
    borderBottomColor: '#cccccc',
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: '#e8e8e8',
  },
  headerText: { fontFamily: 'Helvetica-Bold', fontSize: 8, color: '#444444' },
  colBin: { width: 80, fontFamily: 'Helvetica-Bold' as const, color: '#111111' },
  colItem: { width: 85, color: '#111111' },
  colPart: { flex: 1, color: '#111111', paddingRight: 6 },
  colQty: { width: 34, textAlign: 'center' as const, color: '#111111' },
  colMachine: { width: 150, color: '#444444', paddingRight: 6 },
  colCustomer: { width: 130, color: '#444444', paddingRight: 6 },
  colWo: { width: 50, color: '#444444' },
  colTech: { width: 90, color: '#444444' },
  empty: { marginTop: 24, textAlign: 'center' as const, color: '#888888', fontSize: 10 },
  footer: {
    position: 'absolute',
    bottom: 20,
    left: 36,
    right: 36,
    textAlign: 'center' as const,
    fontSize: 7,
    color: '#aaaaaa',
    fontStyle: 'italic',
  },
})

function dash(v: string | number | null | undefined): string {
  if (v == null) return '—'
  const s = String(v).trim()
  return s || '—'
}

// ============================================================
// Document
// ============================================================

export function PickListDocument({ rows, generatedDate, logoBase64 }: PickListDocumentProps) {
  return (
    <Document>
      <Page size="LETTER" orientation="landscape" style={styles.page} wrap>
        {/* Header (repeats on every page) */}
        <View style={styles.header} fixed>
          {logoBase64 ? <Image src={logoBase64} style={styles.logo} /> : <View />}
          <View>
            <Text style={styles.title}>Parts Pick List</Text>
            <Text style={styles.subtitle}>
              {generatedDate}
              {'  |  '}
              {rows.length} {rows.length === 1 ? 'part' : 'parts'}
            </Text>
          </View>
        </View>

        {/* Column headers (repeat on every page) */}
        <View style={styles.tableHeaderRow} fixed>
          <Text style={[styles.colBin, styles.headerText]}>Bin</Text>
          <Text style={[styles.colItem, styles.headerText]}>Synergy Item #</Text>
          <Text style={[styles.colPart, styles.headerText]}>Part</Text>
          <Text style={[styles.colQty, styles.headerText]}>Qty</Text>
          <Text style={[styles.colMachine, styles.headerText]}>Machine</Text>
          <Text style={[styles.colCustomer, styles.headerText]}>Customer</Text>
          <Text style={[styles.colWo, styles.headerText]}>WO #</Text>
          <Text style={[styles.colTech, styles.headerText]}>Tech</Text>
        </View>

        {rows.length === 0 ? (
          <Text style={styles.empty}>Nothing waiting to be pulled from stock.</Text>
        ) : (
          rows.map((r, i) => (
            <View key={i} style={styles.tableRow} wrap={false}>
              <Text style={styles.colBin}>{dash(r.bin_location)}</Text>
              <Text style={styles.colItem}>{dash(r.product_number)}</Text>
              <Text style={styles.colPart}>{dash(r.part)}</Text>
              <Text style={styles.colQty}>{r.quantity ?? 1}</Text>
              <Text style={styles.colMachine}>{dash(r.machine)}</Text>
              <Text style={styles.colCustomer}>{dash(r.customer_name)}</Text>
              <Text style={styles.colWo}>{r.work_order_number != null ? `WO-${r.work_order_number}` : '—'}</Text>
              <Text style={styles.colTech}>{dash(r.technician_name)}</Text>
            </View>
          ))
        )}

        <Text
          style={styles.footer}
          fixed
          render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
        />
      </Page>
    </Document>
  )
}
