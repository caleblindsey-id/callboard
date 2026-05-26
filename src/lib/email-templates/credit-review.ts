// Credit-review email template. Pure function — no DB, no fetch, no side
// effects. The credit-review helper loads the customer's pending orders + the
// company settings, builds one reviewUrl per order, and passes everything in.
//
// One email per customer: AR sees every new order for that customer in a single
// message, each row with its own "Review this order" link to /cr/<token>.

import type { EmailTemplate } from './estimate-approval'

export type CreditReviewTemplateInput = {
  customerName: string
  accountNumber: string | null
  reviews: Array<{
    orderLabel: string // e.g. "PM WO-1234 — Tennant T7" or "Service WO-5678 — $420.00"
    reviewUrl: string // `${appUrl}/cr/${action_token}`
  }>
  settings: {
    company_name: string
    support_phone: string | null
  }
}

export function renderCreditReviewEmail(
  input: CreditReviewTemplateInput
): EmailTemplate {
  const { customerName, accountNumber, reviews, settings } = input

  const n = reviews.length
  const acct = accountNumber ? ` (acct ${accountNumber})` : ''
  const subject = `Credit review required — ${customerName} (${n} order${n === 1 ? '' : 's'})`

  const supportLine = settings.support_phone
    ? `Questions? Call us at ${settings.support_phone}.`
    : 'Questions? Reply to this email.'

  const text = [
    `${customerName}${acct} is on credit hold, and the following new order${n === 1 ? '' : 's'} need a credit decision:`,
    '',
    ...reviews.map((r) => `• ${r.orderLabel}\n  Review: ${r.reviewUrl}`),
    '',
    'Open each link to Release (let the work proceed) or Block (lock the work until a manager overrides).',
    'These links are valid for 7 days.',
    '',
    supportLine,
    '',
    `${settings.company_name} — Accounts Receivable`,
  ].join('\n')

  const rows = reviews
    .map(
      (r) => `
              <tr>
                <td style="padding:12px 0;border-bottom:1px solid #e4e4e7;color:#1f2937;font-size:14px;">
                  ${escapeHtml(r.orderLabel)}
                  <div style="margin-top:6px;">
                    <a href="${escapeAttr(r.reviewUrl)}" style="background:#0f172a;border-radius:6px;color:#ffffff;display:inline-block;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;font-weight:600;line-height:36px;padding:0 18px;text-align:center;text-decoration:none;">Review this order</a>
                  </div>
                </td>
              </tr>`
    )
    .join('')

  const html = `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f5;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e4e4e7;">
          <tr>
            <td style="padding:24px 32px;background:#7f1d1d;color:#ffffff;font-size:18px;font-weight:600;">
              ${escapeHtml(settings.company_name)} — Credit Review Required
            </td>
          </tr>
          <tr>
            <td style="padding:32px;color:#1f2937;font-size:15px;line-height:1.55;">
              <p style="margin:0 0 16px;">
                <strong>${escapeHtml(customerName)}</strong>${escapeHtml(acct)} is on credit hold, and the
                following new order${n === 1 ? '' : 's'} need a credit decision:
              </p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;">
                ${rows}
              </table>
              <p style="margin:0 0 16px;color:#52525b;font-size:13px;">
                Open each link to <strong>Release</strong> (let the work proceed) or
                <strong>Block</strong> (lock the work until a manager overrides). These links are valid for 7 days.
              </p>
              <p style="margin:0 0 0;color:#1f2937;">${escapeHtml(supportLine)}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px;border-top:1px solid #e4e4e7;color:#52525b;font-size:13px;">
              ${escapeHtml(settings.company_name)} — Accounts Receivable
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

function escapeAttr(s: string): string {
  return escapeHtml(s)
}
