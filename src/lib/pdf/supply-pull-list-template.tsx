import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer'

// One flattened line per requested item — the warehouse-relevant fields only.
// The API route maps the pending supply queue → this shape.
export interface SupplyPullRow {
  tech: string | null
  item: string | null
  quantity: number | null
  unit: string | null
}

interface SupplyPullListDocumentProps {
  rows: SupplyPullRow[]
  generatedDate: string
  logoBase64: string | null
}

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 10,
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
    paddingVertical: 5,
    paddingHorizontal: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: '#e8e8e8',
  },
  headerText: { fontFamily: 'Helvetica-Bold', fontSize: 9, color: '#444444' },
  colCheck: { width: 24 },
  checkBox: { width: 9, height: 9, borderWidth: 0.8, borderColor: '#888888', borderRadius: 1 },
  colTech: { width: 150, color: '#444444', paddingRight: 6 },
  colItem: { flex: 1, color: '#111111', fontFamily: 'Helvetica-Bold' as const, paddingRight: 6 },
  colQty: { width: 40, textAlign: 'center' as const, color: '#111111' },
  colUnit: { width: 70, color: '#444444' },
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

export function SupplyPullListDocument({ rows, generatedDate, logoBase64 }: SupplyPullListDocumentProps) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page} wrap>
        {/* Header (repeats on every page) */}
        <View style={styles.header} fixed>
          {logoBase64 ? <Image src={logoBase64} style={styles.logo} /> : <View />}
          <View>
            <Text style={styles.title}>Shop Supply Pull List</Text>
            <Text style={styles.subtitle}>
              {generatedDate}
              {'  |  '}
              {rows.length} {rows.length === 1 ? 'item' : 'items'}
            </Text>
          </View>
        </View>

        {/* Column headers (repeat on every page) */}
        <View style={styles.tableHeaderRow} fixed>
          <Text style={[styles.colCheck, styles.headerText]}>{' '}</Text>
          <Text style={[styles.colTech, styles.headerText]}>Tech</Text>
          <Text style={[styles.colItem, styles.headerText]}>Item</Text>
          <Text style={[styles.colQty, styles.headerText]}>Qty</Text>
          <Text style={[styles.colUnit, styles.headerText]}>Unit</Text>
        </View>

        {rows.length === 0 ? (
          <Text style={styles.empty}>Nothing waiting to be pulled.</Text>
        ) : (
          rows.map((r, i) => (
            <View key={i} style={styles.tableRow} wrap={false}>
              {/* Empty box to check off as each item is pulled. */}
              <View style={styles.colCheck}>
                <View style={styles.checkBox} />
              </View>
              <Text style={styles.colTech}>{dash(r.tech)}</Text>
              <Text style={styles.colItem}>{dash(r.item)}</Text>
              <Text style={styles.colQty}>{r.quantity ?? 1}</Text>
              <Text style={styles.colUnit}>{dash(r.unit)}</Text>
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
