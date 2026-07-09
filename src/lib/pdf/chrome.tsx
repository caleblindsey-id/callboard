import { Image, StyleSheet, Text, View } from '@react-pdf/renderer'
import { APP_NAME } from '@/lib/branding'

// ============================================================
// Round 11 (PDF document family): shared header/footer chrome so the six
// generated documents (estimate, work order x2, billing, pick list, supply
// pull list) read as one family. Each template's BODY layout stays its own
// StyleSheet — only the chrome unifies here. Layout modeled on
// work-order-template.tsx's two-column header, judged the best of the four
// pre-existing patterns (see outputs/audits/callboard-ux gap-generated-pdf-
// documents finding 5).
// ============================================================

// ============================================================
// Shared style tokens
// ============================================================

export const pdfStyles = StyleSheet.create({
  // ── Header ──
  header: {
    marginBottom: 20,
    borderBottomWidth: 1.5,
    borderBottomColor: '#111111',
    paddingBottom: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  headerLeft: {
    flexDirection: 'column',
  },
  headerRight: {
    flexDirection: 'column',
    alignItems: 'flex-end',
    maxWidth: 240,
  },
  logo: {
    width: 160,
    height: 50,
    objectFit: 'contain' as const,
    marginBottom: 6,
  },
  headerCompanyName: {
    fontSize: 14,
    fontFamily: 'Helvetica-Bold',
    color: '#111111',
    letterSpacing: 0.3,
  },
  headerTitle: {
    fontSize: 16,
    fontFamily: 'Helvetica-Bold',
    color: '#111111',
    letterSpacing: 0.3,
    marginTop: 2,
  },
  headerSubtitle: {
    fontSize: 11,
    color: '#444444',
    marginTop: 3,
  },
  headerDocNumber: {
    fontSize: 13,
    fontFamily: 'Helvetica-Bold',
    color: '#111111',
    letterSpacing: 0.3,
  },
  headerRightDivider: {
    width: 180,
    borderBottomWidth: 0.5,
    borderBottomColor: '#d4d4d4',
    marginVertical: 4,
  },
  headerLine: {
    fontSize: 9,
    color: '#444444',
    marginTop: 2,
  },
  headerLineBold: {
    fontSize: 9,
    color: '#111111',
    fontFamily: 'Helvetica-Bold',
    marginTop: 4,
  },

  // ── Footer ──
  footer: {
    position: 'absolute',
    bottom: 24,
    left: 48,
    right: 48,
    textAlign: 'center',
    fontSize: 7.5,
    color: '#888888',
    borderTopWidth: 0.5,
    borderTopColor: '#e0e0e0',
    paddingTop: 6,
  },

  // ── Body tokens (Direction 1 recipe, pm-pdf-design.md) ──
  // Available for reuse; existing templates keep their own body StyleSheets
  // this round per the plan ("keep each document's BODY layout as-is").
  sectionTitle: {
    fontSize: 8.5,
    fontFamily: 'Helvetica-Bold',
    color: '#111111',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginTop: 18,
    marginBottom: 6,
    paddingBottom: 3,
    borderBottomWidth: 0.5,
    borderBottomColor: '#d4d4d4',
  },
  fieldRow: {
    flexDirection: 'row',
    marginBottom: 2,
  },
  fieldLabel: {
    width: 80,
    fontSize: 8.5,
    color: '#555555',
  },
  fieldValue: {
    flex: 1,
    color: '#111111',
  },
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
})

// ============================================================
// PdfHeader
// ============================================================

export interface PdfHeaderLine {
  text: string
  bold?: boolean
}

export interface PdfHeaderProps {
  /** Base64 data URI. When present, the logo renders instead of companyName
   * text — never both (the logo wordmark already says the name; see
   * wiki/feedback/pdf-logo-dedupe.md). */
  logoBase64?: string | null
  /** Fallback text shown only when logoBase64 is absent. Defaults to APP_NAME. */
  companyName?: string
  /** Bold document-type title, e.g. "Service Estimate", "Parts Pick List". */
  title?: string
  /** Smaller line under the title/logo — a subtitle or period label. */
  subtitle?: string
  /** Large bold identifier on the right, e.g. "WO-1234". */
  documentNumber?: string
  /** Secondary lines under the document number (Synergy Order #, PO #,
   * contact info, technician, generated date, item counts). A hairline
   * divider is drawn between documentNumber and these lines when both exist. */
  rightLines?: PdfHeaderLine[]
}

export function PdfHeader({
  logoBase64,
  companyName,
  title,
  subtitle,
  documentNumber,
  rightLines,
}: PdfHeaderProps) {
  const lines = rightLines?.filter((line) => line.text) ?? []
  const hasRight = !!documentNumber || lines.length > 0

  return (
    <View style={pdfStyles.header} fixed>
      <View style={pdfStyles.headerLeft}>
        {logoBase64 ? (
          <Image src={logoBase64} style={pdfStyles.logo} />
        ) : (
          <Text style={pdfStyles.headerCompanyName}>{companyName ?? APP_NAME}</Text>
        )}
        {title && <Text style={pdfStyles.headerTitle}>{title}</Text>}
        {subtitle && <Text style={pdfStyles.headerSubtitle}>{subtitle}</Text>}
      </View>
      {hasRight && (
        <View style={pdfStyles.headerRight}>
          {documentNumber && <Text style={pdfStyles.headerDocNumber}>{documentNumber}</Text>}
          {documentNumber && lines.length > 0 && <View style={pdfStyles.headerRightDivider} />}
          {lines.map((line, idx) => (
            <Text key={idx} style={line.bold ? pdfStyles.headerLineBold : pdfStyles.headerLine}>
              {line.text}
            </Text>
          ))}
        </View>
      )}
    </View>
  )
}

// ============================================================
// PdfFooter
// ============================================================

export interface PdfFooterProps {
  /** Text before the page-count segment, e.g. "WO-1234" or a document label. */
  left?: string
  /** Text after the page-count segment. Pass companyName here (falling back
   * to APP_NAME only when the tenant hasn't configured one) so the footer
   * never hardcodes the app default while the header honors the setting. */
  right?: string
}

export function PdfFooter({ left, right }: PdfFooterProps) {
  return (
    <Text
      style={pdfStyles.footer}
      fixed
      render={({ pageNumber, totalPages }) => {
        const segments = [left, `Page ${pageNumber} of ${totalPages}`, right].filter(Boolean)
        return segments.join('   ·   ')
      }}
    />
  )
}
