// Abandonment / final-collection notice. Pure function — no DB, no side effects.
// A firmer follow-up than pickup-ready: the unit has sat uncollected past the
// shop's threshold, so this sets a collection deadline. Manager-initiated only
// (never auto-sent).

export type AbandonmentNoticeTemplateInput = {
  ticket: {
    work_order_number: number | null
    contact_name: string | null
    equipment_label: string | null
    serial_number: string | null
    days_waiting: number | null
  }
  deadlineDays: number
  settings: {
    company_name: string
    service_phone: string | null
    pickup_address: string | null
    pickup_hours: string | null
  }
}

export type EmailTemplate = {
  subject: string
  html: string
  text: string
}

export function renderAbandonmentNoticeEmail(input: AbandonmentNoticeTemplateInput): EmailTemplate {
  const { ticket, deadlineDays, settings } = input

  const woLabel = ticket.work_order_number ? `WO-${ticket.work_order_number}` : null
  const greetingName = ticket.contact_name?.split(' ')[0]?.trim() || 'there'
  const equip = ticket.equipment_label?.trim() || 'your equipment'
  const serialSuffix = ticket.serial_number?.trim() ? ` (S/N ${ticket.serial_number.trim()})` : ''
  const equipmentLine = `${equip}${serialSuffix}`

  const phone = settings.service_phone?.trim() || null
  const address = settings.pickup_address?.trim() || null
  const hours = settings.pickup_hours?.trim() || null
  const company = settings.company_name?.trim() || 'Imperial Dade'

  const daysWaiting = ticket.days_waiting
  const sinceLine =
    daysWaiting != null
      ? `has been repaired and ready for pickup for ${daysWaiting} days and remains uncollected`
      : `has been repaired and ready for pickup and remains uncollected`

  const callLine = phone
    ? `Please call our service department at ${phone} to arrange collection or delivery.`
    : `Please reply to this email to arrange collection or delivery.`

  const subject = woLabel
    ? `Action needed: uncollected equipment — ${woLabel}`
    : 'Action needed: uncollected equipment'

  const textLines: (string | null)[] = [
    `Hi ${greetingName},`,
    '',
    `Our records show ${equipmentLine}${woLabel ? ` (${woLabel})` : ''} ${sinceLine}.`,
    '',
    `Please arrange to collect it within ${deadlineDays} days of this notice. After that date, the equipment may be subject to storage fees or considered abandoned in accordance with our terms.`,
    address ? '' : null,
    address ? 'Pickup location:' : null,
    address,
    hours ? `Hours: ${hours}` : null,
    '',
    callLine,
    '',
    'Thank you,',
    `${company} Service Department`,
  ]
  const text = textLines.filter((l) => l !== null).join('\n')

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
            <td style="padding:24px 32px;background:#7c2d12;color:#ffffff;font-size:18px;font-weight:600;">
              ${escapeHtml(company)} — Uncollected Equipment
            </td>
          </tr>
          <tr>
            <td style="padding:32px;color:#1f2937;font-size:15px;line-height:1.55;">
              <p style="margin:0 0 16px;">Hi ${escapeHtml(greetingName)},</p>
              <p style="margin:0 0 16px;">
                Our records show <strong>${escapeHtml(equipmentLine)}</strong>${woLabel ? ` (${escapeHtml(woLabel)})` : ''} ${escapeHtml(sinceLine)}.
              </p>
              <p style="margin:0 0 20px;">
                Please arrange to collect it <strong>within ${deadlineDays} days</strong> of this notice. After that date, the
                equipment may be subject to storage fees or considered abandoned in accordance with our terms.
              </p>
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
