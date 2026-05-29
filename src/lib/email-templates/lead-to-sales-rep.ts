// Lead-to-sales-rep email template. Pure function — no DB, no fetch, no side
// effects. Caller (the approve-and-email route) loads the lead, signs photo
// URLs, and passes everything in.
//
// `primary.kind` controls framing: a `rep` recipient gets the standard
// "Forwarding this to you to follow up" intro; a sales/branch manager gets a
// "Forwarding this for you to assign to one of your reps" intro and a
// distinct subject prefix.

import type { SalesRepKind } from '@/types/database'

export type LeadToSalesRepTemplateInput = {
  primary: { name: string; kind: SalesRepKind }
  ccNames: string[]
  techName: string
  customerName: string
  contact: {
    name: string | null
    email: string | null
    phone: string | null
  }
  equipmentDescription: string
  notes: string | null
  signedPhotoUrls: string[]
  optionalNote: string | null
  companyName: string
}

export type EmailTemplate = {
  subject: string
  html: string
  text: string
}

export function renderLeadToSalesRepEmail(
  input: LeadToSalesRepTemplateInput
): EmailTemplate {
  const {
    primary,
    ccNames,
    techName,
    customerName,
    contact,
    equipmentDescription,
    notes,
    signedPhotoUrls,
    optionalNote,
    companyName,
  } = input

  const isManager = primary.kind !== 'rep'
  const primaryFirstName = primary.name.split(' ')[0] || 'there'
  const subject = isManager
    ? `Lead to assign: equipment lead from ${techName} — ${customerName}`
    : `New equipment lead from ${techName} — ${customerName}`

  const introTextLine = isManager
    ? `${techName} just submitted an equipment lead at ${customerName}. Forwarding it to you to assign to one of your reps.`
    : `${techName} just submitted an equipment lead at ${customerName}. Forwarding it to you to follow up.`

  const introHtml = isManager
    ? `${escapeHtml(techName)} just submitted an equipment lead at <strong>${escapeHtml(customerName)}</strong>. Forwarding it to you to <strong>assign to one of your reps</strong>.`
    : `${escapeHtml(techName)} just submitted an equipment lead at <strong>${escapeHtml(customerName)}</strong>. Forwarding it to you to follow up.`

  const ccLine = ccNames.length > 0 ? `Also notified: ${ccNames.join(', ')}.` : null

  const contactLines = [
    contact.name ? `Name:  ${contact.name}` : null,
    contact.email ? `Email: ${contact.email}` : null,
    contact.phone ? `Phone: ${contact.phone}` : null,
  ].filter((l): l is string => l !== null)

  const text = [
    `Hi ${primaryFirstName},`,
    '',
    introTextLine,
    optionalNote ? '' : null,
    optionalNote ? `Note: ${optionalNote}` : null,
    '',
    'Contact:',
    ...contactLines,
    '',
    'Equipment / opportunity:',
    equipmentDescription,
    notes ? '' : null,
    notes ? `Tech notes: ${notes}` : null,
    signedPhotoUrls.length > 0 ? '' : null,
    signedPhotoUrls.length > 0 ? 'Photos (links valid 7 days):' : null,
    ...signedPhotoUrls.map((u, i) => `  ${i + 1}. ${u}`),
    ccLine ? '' : null,
    ccLine,
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

  const photosHtml =
    signedPhotoUrls.length > 0
      ? `<tr>
            <td style="padding:8px 32px 0;color:#52525b;font-size:13px;text-transform:uppercase;letter-spacing:0.04em;font-weight:600;">Photos</td>
          </tr>
          <tr>
            <td style="padding:8px 32px 24px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  ${signedPhotoUrls
                    .map(
                      (url) => `
                  <td style="padding:0 8px 8px 0;vertical-align:top;">
                    <a href="${escapeAttr(url)}" style="display:inline-block;">
                      <img src="${escapeAttr(url)}" alt="Equipment photo" width="160" height="160" style="display:block;width:160px;height:160px;object-fit:cover;border:1px solid #e4e4e7;border-radius:6px;" />
                    </a>
                  </td>`
                    )
                    .join('')}
                </tr>
              </table>
              <p style="margin:8px 0 0;color:#71717a;font-size:12px;">Photo links expire after 7 days.</p>
            </td>
          </tr>`
      : ''

  const noteHtml = optionalNote
    ? `<tr>
          <td style="padding:0 32px 16px;">
            <div style="padding:12px 16px;background:#fef3c7;border-left:3px solid #f59e0b;border-radius:4px;color:#78350f;font-size:14px;font-style:italic;">
              ${escapeHtml(optionalNote)}
            </div>
          </td>
        </tr>`
    : ''

  const notesHtml = notes
    ? `<tr>
          <td style="padding:8px 32px 0;color:#52525b;font-size:13px;text-transform:uppercase;letter-spacing:0.04em;font-weight:600;">Tech notes</td>
        </tr>
        <tr>
          <td style="padding:8px 32px 16px;color:#1f2937;font-size:15px;line-height:1.55;white-space:pre-wrap;">${escapeHtml(notes)}</td>
        </tr>`
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
              New equipment lead — ${escapeHtml(customerName)}
            </td>
          </tr>
          <tr>
            <td style="padding:24px 32px 8px;color:#1f2937;font-size:15px;line-height:1.55;">
              <p style="margin:0 0 12px;">Hi ${escapeHtml(primaryFirstName)},</p>
              <p style="margin:0;">${introHtml}</p>
            </td>
          </tr>
          ${noteHtml}
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
            <td style="padding:8px 32px 0;color:#52525b;font-size:13px;text-transform:uppercase;letter-spacing:0.04em;font-weight:600;">Equipment / opportunity</td>
          </tr>
          <tr>
            <td style="padding:8px 32px 16px;color:#1f2937;font-size:15px;line-height:1.55;white-space:pre-wrap;">${escapeHtml(equipmentDescription)}</td>
          </tr>
          ${notesHtml}
          ${photosHtml}
          ${ccLine ? `<tr>
            <td style="padding:0 32px 16px;color:#71717a;font-size:13px;font-style:italic;">
              ${escapeHtml(ccLine)}
            </td>
          </tr>` : ''}
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
