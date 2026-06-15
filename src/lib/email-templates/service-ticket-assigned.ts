// Service-ticket-assigned email template — tech-facing. Sent when a service
// ticket is created assigned to a tech, or reassigned onto a tech's board.
// Pure function — no DB, no fetch. The caller (notifyTechOfAssignment /
// notifyTechOfBulkAssignment) resolves the recipient + settings + ticket data
// and passes them in. Two shapes: a single-ticket notice and a bulk digest.

export type EmailTemplate = {
  subject: string
  html: string
  text: string
}

export type ServiceTicketAssignedInput = {
  ticket: {
    work_order_number: number | null
    tech_first_name: string | null
    customer_name: string | null
    priority: 'emergency' | 'standard' | 'low'
    problem_description: string | null
    machine_label: string | null   // e.g. "Tennant T300 — S/N 10847211"; null → omitted
    url: string | null             // deep link to the ticket; null → omitted
  }
  settings: {
    company_name: string
    service_phone: string | null
  }
}

export type ServiceTicketsAssignedDigestInput = {
  tech_first_name: string | null
  tickets: {
    work_order_number: number | null
    customer_name: string | null
    url: string | null
  }[]
  board_url: string | null
  settings: {
    company_name: string
    service_phone: string | null
  }
}

function callLineFor(phone: string | null): string {
  return phone ? `Questions? Call the service office at ${phone}.` : 'Questions? Reply to this email.'
}

// --- Single-ticket assignment ---

export function renderServiceTicketAssignedEmail(input: ServiceTicketAssignedInput): EmailTemplate {
  const { ticket, settings } = input

  const woLabel = ticket.work_order_number ? `WO-${ticket.work_order_number}` : null
  const greetingName = ticket.tech_first_name?.trim() || 'there'
  const company = settings.company_name?.trim() || 'the shop'
  const phone = settings.service_phone?.trim() || null
  const customer = ticket.customer_name?.trim() || null
  const machine = ticket.machine_label?.trim() || null
  const problem = ticket.problem_description?.trim() || null
  const isEmergency = ticket.priority === 'emergency'
  const callLine = callLineFor(phone)

  const subject = isEmergency
    ? `EMERGENCY service ticket assigned — ${woLabel ?? 'new ticket'}`
    : `New service ticket assigned — ${woLabel ?? 'new ticket'}`

  // --- Plain text ---
  const textLines: (string | null)[] = [
    `Hi ${greetingName},`,
    '',
    `A service ticket has been assigned to you${woLabel ? ` (${woLabel})` : ''}.`,
    '',
    isEmergency ? 'Priority: EMERGENCY' : null,
    customer ? `Customer: ${customer}` : null,
    machine ? `Machine: ${machine}` : null,
    woLabel ? `Work order: ${woLabel}` : null,
    problem ? '' : null,
    problem ? 'Problem:' : null,
    problem ? `  ${problem}` : null,
    '',
    ticket.url ? `Open the ticket: ${ticket.url}` : null,
    ticket.url ? '' : null,
    callLine,
    '',
    `${company} Service Department`,
  ]
  const text = textLines.filter((l) => l !== null).join('\n')

  // --- HTML (inline-styled, ~600px, no images) ---
  const priorityBadge = isEmergency
    ? `<p style="margin:0 0 12px;"><span style="display:inline-block;padding:3px 10px;border-radius:4px;background:#fee2e2;color:#b91c1c;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;">Emergency</span></p>`
    : ''

  const metaRows = [
    customer ? `<p style="margin:0 0 6px;"><strong>Customer:</strong> ${escapeHtml(customer)}</p>` : '',
    machine ? `<p style="margin:0 0 6px;"><strong>Machine:</strong> ${escapeHtml(machine)}</p>` : '',
    woLabel ? `<p style="margin:0;"><strong>Work order:</strong> ${escapeHtml(woLabel)}</p>` : '',
  ].join('')

  const problemBlock = problem
    ? `<p style="margin:0 0 6px;color:#52525b;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.03em;">Problem</p>
       <p style="margin:0 0 20px;color:#1f2937;white-space:pre-line;">${escapeHtml(problem)}</p>`
    : ''

  const ctaBlock = ticket.url
    ? `<p style="margin:0 0 20px;"><a href="${escapeAttr(ticket.url)}" style="display:inline-block;padding:10px 20px;background:#0f172a;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px;">Open the ticket</a></p>`
    : ''

  const header = isEmergency ? 'Emergency Service Ticket Assigned' : 'Service Ticket Assigned'

  const html = `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f5;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e4e4e7;">
          <tr>
            <td style="padding:24px 32px;background:#0f172a;color:#ffffff;font-size:18px;font-weight:600;">
              ${escapeHtml(header)}
            </td>
          </tr>
          <tr>
            <td style="padding:32px;color:#1f2937;font-size:15px;line-height:1.55;">
              <p style="margin:0 0 16px;">Hi ${escapeHtml(greetingName)},</p>
              ${priorityBadge}
              <p style="margin:0 0 20px;">
                A service ticket has been assigned to you${woLabel ? ` (${escapeHtml(woLabel)})` : ''}.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 20px;background:#f8fafc;border:1px solid #e4e4e7;border-radius:6px;">
                <tr><td style="padding:16px 20px;">
                  ${metaRows}
                </td></tr>
              </table>
              ${problemBlock}
              ${ctaBlock}
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

// --- Bulk digest (several tickets assigned to one tech at once) ---

export function renderServiceTicketsAssignedDigestEmail(input: ServiceTicketsAssignedDigestInput): EmailTemplate {
  const { tickets, settings } = input
  const greetingName = input.tech_first_name?.trim() || 'there'
  const company = settings.company_name?.trim() || 'the shop'
  const phone = settings.service_phone?.trim() || null
  const callLine = callLineFor(phone)
  const n = tickets.length

  const subject = `${n} service ticket${n === 1 ? '' : 's'} assigned to you`

  const lineText = (t: ServiceTicketsAssignedDigestInput['tickets'][number]) => {
    const wo = t.work_order_number ? `WO-${t.work_order_number}` : 'New ticket'
    const cust = t.customer_name?.trim() ? ` — ${t.customer_name.trim()}` : ''
    return `${wo}${cust}`
  }

  // --- Plain text ---
  const textLines: (string | null)[] = [
    `Hi ${greetingName},`,
    '',
    `${n} service ticket${n === 1 ? ' has' : 's have'} been assigned to you:`,
    '',
    ...tickets.map((t) => `  - ${lineText(t)}`),
    '',
    input.board_url ? `View your tickets: ${input.board_url}` : null,
    input.board_url ? '' : null,
    callLine,
    '',
    `${company} Service Department`,
  ]
  const text = textLines.filter((l) => l !== null).join('\n')

  // --- HTML ---
  const rowsHtml = tickets
    .map((t) => {
      const label = lineText(t)
      const inner = t.url
        ? `<a href="${escapeAttr(t.url)}" style="color:#0f172a;text-decoration:underline;">${escapeHtml(label)}</a>`
        : escapeHtml(label)
      return `<li style="margin:0 0 6px;">${inner}</li>`
    })
    .join('')

  const ctaBlock = input.board_url
    ? `<p style="margin:0 0 20px;"><a href="${escapeAttr(input.board_url)}" style="display:inline-block;padding:10px 20px;background:#0f172a;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px;">View your tickets</a></p>`
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
              Service Tickets Assigned
            </td>
          </tr>
          <tr>
            <td style="padding:32px;color:#1f2937;font-size:15px;line-height:1.55;">
              <p style="margin:0 0 16px;">Hi ${escapeHtml(greetingName)},</p>
              <p style="margin:0 0 16px;">
                ${n} service ticket${n === 1 ? ' has' : 's have'} been assigned to you:
              </p>
              <ul style="margin:0 0 20px;padding-left:20px;color:#1f2937;">${rowsHtml}</ul>
              ${ctaBlock}
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

function escapeAttr(s: string): string {
  return escapeHtml(s)
}
