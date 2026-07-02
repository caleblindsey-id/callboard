// Warranty-credit reminder digest — office-facing. Sent by the weekly
// warranty-credit-remind cron listing every claim still needing office action:
// unfiled claims (work done, no claim with the vendor yet) and filed claims
// whose vendor credit hasn't landed. Pure function — no DB, no fetch. The
// caller resolves rows + settings and passes them in.

export type WarrantyReminderRow = {
  work_order_number: number | null
  customer_name: string
  equipment_label: string
  warranty_vendor: string | null
  warranty_claim_number: string | null
  warranty_credit_expected: number | null
  // Aging: for unfiled claims, days since the work was completed; for filed
  // claims, days since the claim was submitted.
  days: number | null
}

export type WarrantyReminderTemplateInput = {
  toFile: WarrantyReminderRow[]
  awaitingCredit: WarrantyReminderRow[]
  queueUrl: string
  settings: {
    company_name: string
  }
}

export type EmailTemplate = {
  subject: string
  html: string
  text: string
}

function fmtMoney(amount: number | null): string {
  return amount == null ? '—' : `$${amount.toFixed(2)}`
}

function fmtDays(days: number | null): string {
  if (days == null) return '—'
  return days === 0 ? 'today' : `${days}d`
}

function textRow(r: WarrantyReminderRow, agedLabel: string): string {
  const wo = r.work_order_number != null ? `WO ${r.work_order_number}` : 'WO —'
  const vendor = r.warranty_vendor?.trim() || 'vendor not set'
  const claim = r.warranty_claim_number?.trim() ? ` claim ${r.warranty_claim_number.trim()}` : ''
  return `  - ${wo} | ${r.customer_name} | ${r.equipment_label} | ${vendor}${claim} | ${fmtMoney(r.warranty_credit_expected)} | ${agedLabel} ${fmtDays(r.days)}`
}

export function renderWarrantyReminderEmail(input: WarrantyReminderTemplateInput): EmailTemplate {
  const { toFile, awaitingCredit, queueUrl, settings } = input
  const company = settings.company_name?.trim() || 'CallBoard'
  const total = toFile.length + awaitingCredit.length

  const expectedTotal = [...toFile, ...awaitingCredit].reduce(
    (sum, r) => sum + (r.warranty_credit_expected ?? 0),
    0
  )
  const expectedNote = expectedTotal > 0 ? ` (${fmtMoney(expectedTotal)} expected)` : ''

  const subject = `Warranty credits to chase: ${total} open claim${total === 1 ? '' : 's'}${expectedNote}`

  // --- Plain text ---
  const textLines: (string | null)[] = [
    `${total} warranty claim${total === 1 ? ' is' : 's are'} still waiting on office action${expectedNote}.`,
    '',
    toFile.length > 0 ? `To file with the vendor (${toFile.length}):` : null,
    ...toFile.map((r) => textRow(r, 'completed')),
    toFile.length > 0 ? '' : null,
    awaitingCredit.length > 0 ? `Awaiting vendor credit (${awaitingCredit.length}):` : null,
    ...awaitingCredit.map((r) => textRow(r, 'filed')),
    awaitingCredit.length > 0 ? '' : null,
    `Work the queue: ${queueUrl}`,
    '',
    `${company} Service Department`,
  ]
  const text = textLines.filter((l) => l !== null).join('\n')

  // --- HTML (inline-styled, ~640px, no images) ---
  const tableFor = (rows: WarrantyReminderRow[], agedHeader: string): string => {
    const body = rows
      .map(
        (r) => `<tr>
          <td style="padding:6px 8px;border-bottom:1px solid #f1f5f9;white-space:nowrap;">${r.work_order_number != null ? `WO ${r.work_order_number}` : '—'}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #f1f5f9;">${escapeHtml(r.customer_name)}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #f1f5f9;">${escapeHtml(r.equipment_label)}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #f1f5f9;">${escapeHtml(r.warranty_vendor?.trim() || '—')}${r.warranty_claim_number?.trim() ? `<br/><span style="color:#64748b;font-size:12px;">claim ${escapeHtml(r.warranty_claim_number.trim())}</span>` : ''}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #f1f5f9;text-align:right;white-space:nowrap;">${fmtMoney(r.warranty_credit_expected)}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #f1f5f9;text-align:right;white-space:nowrap;${(r.days ?? 0) >= 30 ? 'color:#dc2626;font-weight:600;' : (r.days ?? 0) >= 14 ? 'color:#d97706;font-weight:600;' : ''}">${fmtDays(r.days)}</td>
        </tr>`
      )
      .join('')
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:13px;color:#1f2937;border-collapse:collapse;margin:0 0 20px;">
      <tr style="color:#52525b;font-size:12px;text-transform:uppercase;letter-spacing:.03em;">
        <th align="left" style="padding:6px 8px;border-bottom:1px solid #e4e4e7;">WO</th>
        <th align="left" style="padding:6px 8px;border-bottom:1px solid #e4e4e7;">Customer</th>
        <th align="left" style="padding:6px 8px;border-bottom:1px solid #e4e4e7;">Equipment</th>
        <th align="left" style="padding:6px 8px;border-bottom:1px solid #e4e4e7;">Vendor</th>
        <th align="right" style="padding:6px 8px;border-bottom:1px solid #e4e4e7;">Expected</th>
        <th align="right" style="padding:6px 8px;border-bottom:1px solid #e4e4e7;">${escapeHtml(agedHeader)}</th>
      </tr>
      ${body}
    </table>`
  }

  const toFileBlock =
    toFile.length > 0
      ? `<p style="margin:0 0 6px;color:#52525b;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.03em;">To file with the vendor (${toFile.length})</p>
         ${tableFor(toFile, 'Completed')}`
      : ''
  const awaitingBlock =
    awaitingCredit.length > 0
      ? `<p style="margin:0 0 6px;color:#52525b;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.03em;">Awaiting vendor credit (${awaitingCredit.length})</p>
         ${tableFor(awaitingCredit, 'Filed')}`
      : ''

  const html = `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f5;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e4e4e7;">
          <tr>
            <td style="padding:24px 32px;background:#0f172a;color:#ffffff;font-size:18px;font-weight:600;">
              Warranty Credits to Chase
            </td>
          </tr>
          <tr>
            <td style="padding:32px;color:#1f2937;font-size:15px;line-height:1.55;">
              <p style="margin:0 0 20px;">
                ${total} warranty claim${total === 1 ? ' is' : 's are'} still waiting on office action${escapeHtml(expectedNote)}.
                Warranty work can't bill until its vendor credit is logged.
              </p>
              ${toFileBlock}
              ${awaitingBlock}
              <p style="margin:0;">
                <a href="${escapeHtml(queueUrl)}" style="display:inline-block;padding:10px 18px;background:#0f172a;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:6px;">Open the Warranty Claims queue</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px;border-top:1px solid #e4e4e7;color:#52525b;font-size:13px;">
              ${escapeHtml(company)} Service Department — weekly reminder
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

  return { subject, html, text }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
