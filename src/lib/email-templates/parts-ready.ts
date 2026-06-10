// Parts-ready email template — tech-facing. Sent when the whole order for a
// ticket is staged (every live part received from a PO or pulled from stock).
// Pure function — no DB, no fetch. Caller (sendPartsReadyNotice) resolves the
// recipient + settings + part list and passes them in. Informational only.

export type PartsReadyTemplateInput = {
  ticket: {
    work_order_number: number | null
    tech_first_name: string | null
    customer_name: string | null
    machine_label: string | null   // e.g. "Tennant T300 — S/N 10847211"; null → omitted
  }
  parts: { description: string; quantity: number | null }[]
  settings: {
    company_name: string
    service_phone: string | null
    pickup_address: string | null   // optional; multi-line allowed
    pickup_hours: string | null     // optional
  }
}

export type EmailTemplate = {
  subject: string
  html: string
  text: string
}

export function renderPartsReadyEmail(input: PartsReadyTemplateInput): EmailTemplate {
  const { ticket, parts, settings } = input

  const woLabel = ticket.work_order_number ? `WO-${ticket.work_order_number}` : null
  const greetingName = ticket.tech_first_name?.trim() || 'there'
  const company = settings.company_name?.trim() || 'the shop'
  const phone = settings.service_phone?.trim() || null
  const address = settings.pickup_address?.trim() || null
  const hours = settings.pickup_hours?.trim() || null

  const customer = ticket.customer_name?.trim() || null
  const machine = ticket.machine_label?.trim() || null

  const partLines = parts.map((p) => {
    const qty = p.quantity != null && p.quantity !== 1 ? ` × ${p.quantity}` : ''
    return `${p.description}${qty}`
  })

  const subject = woLabel
    ? `Parts ready for pickup — ${woLabel}`
    : 'Parts ready for pickup'

  const callLine = phone
    ? `Questions? Call the service office at ${phone}.`
    : `Questions? Reply to this email.`

  // --- Plain text ---
  const textLines: (string | null)[] = [
    `Hi ${greetingName},`,
    '',
    `All the parts for ${woLabel ?? 'your ticket'} are in and staged for pickup at the shop.`,
    '',
    customer ? `Customer: ${customer}` : null,
    machine ? `Machine: ${machine}` : null,
    woLabel ? `Work order: ${woLabel}` : null,
    '',
    'Parts:',
    ...partLines.map((l) => `  - ${l}`),
    '',
    address ? 'Pickup location:' : null,
    address,
    hours ? `Hours: ${hours}` : null,
    address || hours ? '' : null,
    callLine,
    '',
    `${company} Service Department`,
  ]
  const text = textLines.filter((l) => l !== null).join('\n')

  // --- HTML (inline-styled, ~600px, no images, no CTA) ---
  const metaRows = [
    customer ? `<p style="margin:0 0 6px;"><strong>Customer:</strong> ${escapeHtml(customer)}</p>` : '',
    machine ? `<p style="margin:0 0 6px;"><strong>Machine:</strong> ${escapeHtml(machine)}</p>` : '',
    woLabel ? `<p style="margin:0;"><strong>Work order:</strong> ${escapeHtml(woLabel)}</p>` : '',
  ].join('')

  const partsHtml = partLines
    .map((l) => `<li style="margin:0 0 4px;">${escapeHtml(l)}</li>`)
    .join('')

  const addressBlock = address
    ? `<p style="margin:0 0 4px;color:#52525b;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.03em;">Pickup location</p>
       <p style="margin:0 0 ${hours ? '4px' : '16px'};color:#1f2937;white-space:pre-line;">${escapeHtml(address)}</p>`
    : ''
  const hoursBlock = hours
    ? `<p style="margin:0 0 16px;color:#1f2937;"><strong>Hours:</strong> ${escapeHtml(hours)}</p>`
    : ''

  const html = `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f5;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e4e4e7;">
          <tr>
            <td style="padding:24px 32px;background:#0f172a;color:#ffffff;font-size:18px;font-weight:600;">
              Parts Ready for Pickup
            </td>
          </tr>
          <tr>
            <td style="padding:32px;color:#1f2937;font-size:15px;line-height:1.55;">
              <p style="margin:0 0 16px;">Hi ${escapeHtml(greetingName)},</p>
              <p style="margin:0 0 20px;">
                All the parts for ${escapeHtml(woLabel ?? 'your ticket')} are in and staged for pickup at the shop.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 20px;background:#f8fafc;border:1px solid #e4e4e7;border-radius:6px;">
                <tr><td style="padding:16px 20px;">
                  ${metaRows}
                </td></tr>
              </table>
              <p style="margin:0 0 6px;color:#52525b;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.03em;">Parts</p>
              <ul style="margin:0 0 20px;padding-left:20px;color:#1f2937;">${partsHtml}</ul>
              ${addressBlock}
              ${hoursBlock}
              <p style="margin:0;">${escapeHtml(callLine)}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px;border-top:1px solid #e4e4e7;color:#52525b;font-size:13px;">
              ${escapeHtml(company)} Service Department
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
