// Pickup-ready email template. Pure function — no DB, no fetch, no side effects.
// Caller (sendPickupNotice) resolves the recipient + settings and passes them in.
// Informational only: no token, no CTA button, no payment ask (the unit is
// already invoiced and B2B accounts settle on terms).

export type PickupReadyTemplateInput = {
  ticket: {
    work_order_number: number | null
    contact_name: string | null
    equipment_label: string | null   // e.g. "Tennant T300 floor scrubber"; null → generic
    serial_number: string | null
  }
  settings: {
    company_name: string
    service_phone: string | null
    pickup_address: string | null    // optional; multi-line allowed
    pickup_hours: string | null      // optional; e.g. "Mon–Fri, 7:30 AM – 4:30 PM"
  }
}

export type EmailTemplate = {
  subject: string
  html: string
  text: string
}

export function renderPickupReadyEmail(input: PickupReadyTemplateInput): EmailTemplate {
  const { ticket, settings } = input

  const woLabel = ticket.work_order_number ? `WO-${ticket.work_order_number}` : null
  const greetingName = ticket.contact_name?.split(' ')[0]?.trim() || 'there'

  // Equipment line: "Tennant T300 floor scrubber (S/N 10847211)" — each piece
  // optional, so a unit with no make/model still reads cleanly.
  const equip = ticket.equipment_label?.trim() || 'your equipment'
  const serialSuffix = ticket.serial_number?.trim() ? ` (S/N ${ticket.serial_number.trim()})` : ''
  const equipmentLine = `${equip}${serialSuffix}`

  const phone = settings.service_phone?.trim() || null
  const address = settings.pickup_address?.trim() || null
  const hours = settings.pickup_hours?.trim() || null
  const company = settings.company_name?.trim() || 'our service department'

  const callLine = phone
    ? `If you have any questions, please call our service department at ${phone}.`
    : `If you have any questions, please reply to this email.`

  const refLine = woLabel
    ? `When you come by, just reference ${woLabel} and we'll have it ready for you.`
    : `When you come by, just mention your repair and we'll have it ready for you.`

  const subject = woLabel
    ? `Your repaired equipment is ready for pickup — ${woLabel}`
    : 'Your repaired equipment is ready for pickup'

  // --- Plain text ---
  const textLines: (string | null)[] = [
    `Hi ${greetingName},`,
    '',
    'Your equipment is repaired and ready to be picked up at our service department.',
    '',
    `Equipment: ${equipmentLine}`,
    woLabel ? `Work order: ${woLabel}` : null,
    address ? '' : null,
    address ? 'Pickup location:' : null,
    address,
    hours ? `Hours: ${hours}` : null,
    '',
    refLine,
    '',
    callLine,
    '',
    'Thank you,',
    `${company} Service Department`,
  ]
  const text = textLines.filter((l) => l !== null).join('\n')

  // --- HTML (inline-styled, ~600px, no images, no CTA) ---
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
              ${escapeHtml(company)} — Ready for Pickup
            </td>
          </tr>
          <tr>
            <td style="padding:32px;color:#1f2937;font-size:15px;line-height:1.55;">
              <p style="margin:0 0 16px;">Hi ${escapeHtml(greetingName)},</p>
              <p style="margin:0 0 20px;">
                Your equipment is repaired and ready to be picked up at our service department.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 20px;background:#f8fafc;border:1px solid #e4e4e7;border-radius:6px;">
                <tr><td style="padding:16px 20px;">
                  <p style="margin:0 0 6px;"><strong>Equipment:</strong> ${escapeHtml(equipmentLine)}</p>
                  ${woLabel ? `<p style="margin:0;"><strong>Work order:</strong> ${escapeHtml(woLabel)}</p>` : ''}
                </td></tr>
              </table>
              ${addressBlock}
              ${hoursBlock}
              <p style="margin:0 0 16px;">${escapeHtml(refLine)}</p>
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
