// Estimate-approval email template. Pure function — no DB, no fetch, no
// side effects. Caller (the send-estimate route) loads the ticket + settings,
// builds the approvalUrl, and passes everything in.

export type EstimateApprovalTemplateInput = {
  ticket: {
    work_order_number: number | null
    customer_name: string | null
    contact_name: string | null
    estimate_amount: number | null
  }
  approvalUrl: string
  settings: {
    company_name: string
    support_phone: string | null
  }
}

export type EmailTemplate = {
  subject: string
  html: string
  text: string
}

export function renderEstimateApprovalEmail(
  input: EstimateApprovalTemplateInput
): EmailTemplate {
  const { ticket, approvalUrl, settings } = input

  const woLabel = ticket.work_order_number ? `WO-${ticket.work_order_number}` : 'Service'
  const customerName = ticket.customer_name ?? 'Customer'
  const greetingName = ticket.contact_name?.split(' ')[0] ?? 'there'
  const totalLine =
    ticket.estimate_amount != null
      ? `$${ticket.estimate_amount.toFixed(2)}`
      : null
  const supportLine = settings.support_phone
    ? `If you have any questions, please call us at ${settings.support_phone}.`
    : 'If you have any questions, please reply to this email.'

  const subject = `Service Estimate — ${woLabel} — ${customerName}`

  const text = [
    `Hi ${greetingName},`,
    '',
    `Please find your service estimate for ${customerName} (${woLabel}) ready for review.`,
    totalLine ? `Estimate total: ${totalLine}` : null,
    '',
    'Approve or decline online:',
    approvalUrl,
    '',
    'When you approve, you can include your PO number if you have one.',
    '',
    'This link is valid for 7 days. This estimate is subject to change. All prices are subject to applicable taxes.',
    '',
    supportLine,
    '',
    `Thank you,`,
    `${settings.company_name} Service Department`,
  ]
    .filter((line) => line !== null)
    .join('\n')

  // Inline-styled HTML — every styled email client strips <style>, so styles
  // live on the elements directly. Single CTA, no images, ~600px max width.
  const html = `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f5;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e4e4e7;">
          <tr>
            <td style="padding:24px 32px;background:#0f172a;color:#ffffff;font-size:18px;font-weight:600;">
              ${escapeHtml(settings.company_name)} — Service Estimate
            </td>
          </tr>
          <tr>
            <td style="padding:32px;color:#1f2937;font-size:15px;line-height:1.55;">
              <p style="margin:0 0 16px;">Hi ${escapeHtml(greetingName)},</p>
              <p style="margin:0 0 16px;">
                Your service estimate for <strong>${escapeHtml(customerName)}</strong>
                (${escapeHtml(woLabel)}) is ready for review.
              </p>
              ${
                totalLine
                  ? `<p style="margin:0 0 24px;font-size:18px;"><strong>Estimate total:</strong> ${escapeHtml(totalLine)}</p>`
                  : ''
              }
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;">
                <tr>
                  <td>
                    <!--[if mso]>
                    <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${escapeAttr(approvalUrl)}" style="height:44px;v-text-anchor:middle;width:220px;" arcsize="14%" stroke="f" fillcolor="#0f172a">
                      <w:anchorlock/>
                      <center style="color:#ffffff;font-family:'Segoe UI',Arial,sans-serif;font-size:15px;font-weight:600;">Review your estimate</center>
                    </v:roundrect>
                    <![endif]-->
                    <!--[if !mso]><!-- -->
                    <a href="${escapeAttr(approvalUrl)}" style="background:#0f172a;border-radius:6px;color:#ffffff;display:inline-block;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;line-height:44px;text-align:center;text-decoration:none;width:220px;mso-hide:all;">Review your estimate</a>
                    <!--<![endif]-->
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 16px;color:#52525b;font-size:13px;">
                Button not working?
                <a href="${escapeAttr(approvalUrl)}" style="color:#0f172a;text-decoration:underline;">Open the estimate</a>.
              </p>
              <p style="margin:0 0 16px;color:#52525b;font-size:13px;">
                When you approve, you can include your PO number if you have one.
              </p>
              <p style="margin:0 0 16px;color:#52525b;font-size:13px;">
                This link is valid for 7 days. The estimate is subject to change and all prices are subject to applicable taxes.
              </p>
              <p style="margin:0 0 0;color:#1f2937;">${escapeHtml(supportLine)}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px;border-top:1px solid #e4e4e7;color:#52525b;font-size:13px;">
              ${escapeHtml(settings.company_name)} Service Department
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
