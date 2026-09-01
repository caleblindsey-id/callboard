// Manager-facing credit follow-up email (feedback #75). Pure function -- no DB,
// no fetch, no side effects. The cron loads the open reviews and passes them in.
//
// This is the escalation half of the follow-up. The other half re-sends AR its
// Release/Block link and reuses the existing credit-review template; this one
// goes to managers, who cannot action a review from an email at all -- clearing
// a block needs the release passcode typed into /credit-review. So every row
// here deep-links into the queue rather than offering a one-click action.

import type { EmailTemplate } from './estimate-approval'

export type CreditFollowupItem = {
  customerName: string
  accountNumber: string | null
  orderLabel: string
  /** 'blocked' = AR blocked it, needs a manager passcode. 'pending' = AR has gone quiet. */
  status: 'pending' | 'blocked'
  blockReason: string | null
  decidedByName: string | null
  daysWaiting: number
  /** Absolute link into the credit-review queue, or the order itself. */
  href: string
}

export type CreditFollowupTemplateInput = {
  items: CreditFollowupItem[]
  queueUrl: string
  settings: {
    company_name: string
  }
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many
}

export function renderCreditFollowupEmail(
  input: CreditFollowupTemplateInput
): EmailTemplate {
  const { items, queueUrl, settings } = input

  const blocked = items.filter((i) => i.status === 'blocked')
  const pending = items.filter((i) => i.status === 'pending')
  const oldest = items.reduce((m, i) => Math.max(m, i.daysWaiting), 0)

  // Lead the subject with the count and the worst age -- the two facts that
  // decide whether this gets opened. A block that has been sitting 64 days
  // should not read the same as one from this morning.
  const n = items.length
  const subject = `Credit still on hold — ${n} ${plural(n, 'order', 'orders')} waiting (oldest ${oldest}d)`

  const describe = (i: CreditFollowupItem): string => {
    const acct = i.accountNumber ? ` (acct ${i.accountNumber})` : ''
    const who =
      i.status === 'blocked'
        ? `blocked${i.decidedByName ? ` by ${i.decidedByName}` : ''}`
        : 'awaiting an AR decision'
    const why = i.blockReason ? ` — "${i.blockReason}"` : ''
    return `${i.customerName}${acct} — ${i.orderLabel}\n  ${i.daysWaiting}d ${who}${why}\n  ${i.href}`
  }

  const textParts: string[] = []
  if (blocked.length) {
    textParts.push(
      `${blocked.length} ${plural(blocked.length, 'order is', 'orders are')} blocked by AR and need a manager to release ${plural(blocked.length, 'it', 'them')} with the release passcode:`,
      '',
      ...blocked.map((i) => `• ${describe(i)}`),
      ''
    )
  }
  if (pending.length) {
    textParts.push(
      `${pending.length} ${plural(pending.length, 'order has', 'orders have')} been waiting on an AR credit decision with no response:`,
      '',
      ...pending.map((i) => `• ${describe(i)}`),
      ''
    )
  }

  const text = [
    'Work on these orders is locked until the credit hold is cleared.',
    '',
    ...textParts,
    `Open the credit review queue: ${queueUrl}`,
    '',
    `${settings.company_name} — Credit Review`,
  ].join('\n')

  const row = (i: CreditFollowupItem): string => {
    const acct = i.accountNumber ? ` (acct ${i.accountNumber})` : ''
    const who =
      i.status === 'blocked'
        ? `blocked${i.decidedByName ? ` by ${escapeHtml(i.decidedByName)}` : ''}`
        : 'awaiting an AR decision'
    // Past a week the age is the story, so it gets the alarm colour.
    const ageColor = i.daysWaiting >= 7 ? '#b91c1c' : '#a16207'
    return `
              <tr>
                <td style="padding:14px 0;border-bottom:1px solid #e4e4e7;color:#1f2937;font-size:14px;">
                  <a href="${escapeAttr(i.href)}" style="color:#0f172a;font-weight:600;text-decoration:none;">${escapeHtml(i.customerName)}${escapeHtml(acct)}</a>
                  <div style="margin-top:3px;color:#52525b;font-size:13px;">${escapeHtml(i.orderLabel)}</div>
                  <div style="margin-top:5px;font-size:13px;">
                    <span style="color:${ageColor};font-weight:600;">${i.daysWaiting}d</span>
                    <span style="color:#52525b;"> ${who}</span>
                  </div>
                  ${
                    i.blockReason
                      ? `<div style="margin-top:5px;color:#7f1d1d;font-size:13px;font-style:italic;">“${escapeHtml(i.blockReason)}”</div>`
                      : ''
                  }
                </td>
              </tr>`
  }

  const group = (heading: string, list: CreditFollowupItem[]): string =>
    list.length === 0
      ? ''
      : `
              <p style="margin:0 0 8px;color:#1f2937;font-size:14px;font-weight:600;">${escapeHtml(heading)}</p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;">
                ${list.map(row).join('')}
              </table>`

  const html = `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f5;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e4e4e7;">
          <tr>
            <td style="padding:24px 32px;background:#7f1d1d;color:#ffffff;font-size:18px;font-weight:600;">
              ${escapeHtml(settings.company_name)} — Credit Still On Hold
            </td>
          </tr>
          <tr>
            <td style="padding:32px;color:#1f2937;font-size:15px;line-height:1.55;">
              <p style="margin:0 0 20px;">Work on these orders is locked until the credit hold is cleared.</p>
              ${group(
                blocked.length === 1
                  ? 'Blocked by AR — needs a manager to release it with the passcode'
                  : 'Blocked by AR — need a manager to release them with the passcode',
                blocked
              )}
              ${group('Waiting on an AR credit decision', pending)}
              <a href="${escapeAttr(queueUrl)}" style="background:#0f172a;border-radius:6px;color:#ffffff;display:inline-block;font-size:13px;font-weight:600;line-height:36px;padding:0 18px;text-decoration:none;">Open the credit review queue</a>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px;border-top:1px solid #e4e4e7;color:#52525b;font-size:13px;">
              ${escapeHtml(settings.company_name)} — Credit Review
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
