// Tech-lead-submitted email template. Pure function — no DB, no fetch, no side
// effects. The notify helper loads the lead + recipients and passes everything
// in. Sent to every active manager the moment a technician files a lead, so a
// lead never sits unseen on the /tech-leads dashboard.
//
// Modeled on lead-to-sales-rep.ts (same EmailTemplate shape + card markup), but
// framed as "new lead awaiting review" with a button into CallBoard rather than
// a forward to a sales rep. Photos are intentionally omitted (they need 7-day
// signed URLs); managers see them on the dashboard.

export type TechLeadSubmittedTemplateInput = {
  techName: string
  customerName: string
  leadTypeLabel: string
  equipmentDescription: string
  contact: {
    name: string | null
    email: string | null
    phone: string | null
  }
  notes: string | null
  reviewUrl: string
  companyName: string
}

export type EmailTemplate = {
  subject: string
  html: string
  text: string
}

export function renderTechLeadSubmittedEmail(
  input: TechLeadSubmittedTemplateInput
): EmailTemplate {
  const {
    techName,
    customerName,
    leadTypeLabel,
    equipmentDescription,
    contact,
    notes,
    reviewUrl,
    companyName,
  } = input

  const subject = `New lead from ${techName} — ${customerName}`

  const introTextLine = `${techName} just submitted a ${leadTypeLabel} lead at ${customerName}. Review it in CallBoard to approve or follow up.`
  const introHtml = `${escapeHtml(techName)} just submitted a ${escapeHtml(leadTypeLabel)} lead at <strong>${escapeHtml(customerName)}</strong>. Review it in CallBoard to approve or follow up.`

  const contactLines = [
    contact.name ? `Name:  ${contact.name}` : null,
    contact.email ? `Email: ${contact.email}` : null,
    contact.phone ? `Phone: ${contact.phone}` : null,
  ].filter((l): l is string => l !== null)

  const text = [
    `Hi,`,
    '',
    introTextLine,
    '',
    `Review: ${reviewUrl}`,
    '',
    'Contact:',
    ...(contactLines.length > 0 ? contactLines : ['No contact info captured.']),
    '',
    `${leadTypeLabel === 'PM' ? 'Equipment' : 'Equipment / opportunity'}:`,
    equipmentDescription || '(none provided)',
    notes ? '' : null,
    notes ? `Tech notes: ${notes}` : null,
    '',
    `Thanks,`,
    `${companyName}`,
  ]
    .filter((line): line is string => line !== null)
    .join('\n')

  const contactRowsHtml = [
    contact.name ? row('Name', escapeHtml(contact.name)) : '',
    contact.email
      ? row('Email', `<a href="mailto:${escapeAttr(contact.email)}" style="color:#0f172a;">${escapeHtml(contact.email)}</a>`)
      : '',
    contact.phone
      ? row('Phone', `<a href="tel:${escapeAttr(contact.phone.replace(/[^\d+]/g, ''))}" style="color:#0f172a;">${escapeHtml(contact.phone)}</a>`)
      : '',
  ].join('')

  const notesHtml = notes
    ? `<tr>
          <td style="padding:8px 32px 0;color:#52525b;font-size:13px;text-transform:uppercase;letter-spacing:0.04em;font-weight:600;">Tech notes</td>
        </tr>
        <tr>
          <td style="padding:8px 32px 16px;color:#1f2937;font-size:15px;line-height:1.55;white-space:pre-wrap;">${escapeHtml(notes)}</td>
        </tr>`
    : ''

  const equipmentLabel = leadTypeLabel === 'PM' ? 'Equipment' : 'Equipment / opportunity'

  const html = `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f5;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e4e4e7;">
          <tr>
            <td style="padding:24px 32px;background:#0f172a;color:#ffffff;font-size:18px;font-weight:600;">
              New ${escapeHtml(leadTypeLabel)} lead — ${escapeHtml(customerName)}
            </td>
          </tr>
          <tr>
            <td style="padding:24px 32px 8px;color:#1f2937;font-size:15px;line-height:1.55;">
              <p style="margin:0;">${introHtml}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 32px 20px;">
              <a href="${escapeAttr(reviewUrl)}" style="display:inline-block;padding:12px 24px;background:#0f172a;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:6px;">Review lead</a>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 32px 0;color:#52525b;font-size:13px;text-transform:uppercase;letter-spacing:0.04em;font-weight:600;">Contact</td>
          </tr>
          <tr>
            <td style="padding:8px 32px 16px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
                ${contactRowsHtml || '<tr><td style="color:#71717a;font-size:14px;">No contact info captured.</td></tr>'}
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 32px 0;color:#52525b;font-size:13px;text-transform:uppercase;letter-spacing:0.04em;font-weight:600;">${escapeHtml(equipmentLabel)}</td>
          </tr>
          <tr>
            <td style="padding:8px 32px 16px;color:#1f2937;font-size:15px;line-height:1.55;white-space:pre-wrap;">${escapeHtml(equipmentDescription || '(none provided)')}</td>
          </tr>
          ${notesHtml}
          <tr>
            <td style="padding:20px 32px;border-top:1px solid #e4e4e7;color:#52525b;font-size:13px;">
              ${escapeHtml(companyName)}
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

function row(label: string, valueHtml: string): string {
  return `<tr>
            <td style="padding:2px 12px 2px 0;color:#71717a;font-size:14px;width:80px;vertical-align:top;">${escapeHtml(label)}</td>
            <td style="padding:2px 0;color:#1f2937;font-size:14px;">${valueHtml}</td>
          </tr>`
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
