// User-invite email template. Pure function — no DB, no fetch, no side effects.
// The caller (the create-user route and the resend-invite route) loads the
// company name, mints the single-use set-password link, and passes everything
// in. Mirrors the CTA-button style of estimate-approval.ts.
//
// The button points at our own /set-password page, NOT Supabase's action_link.
// That page does nothing on GET — it only consumes the recovery token when the
// user submits a password — so an email link-scanner's pre-fetch can't burn it.

export type UserInviteTemplateInput = {
  name: string | null
  setPasswordUrl: string
  companyName: string
}

export type EmailTemplate = {
  subject: string
  html: string
  text: string
}

export function renderUserInviteEmail(input: UserInviteTemplateInput): EmailTemplate {
  const { name, setPasswordUrl, companyName } = input

  const greetingName = name?.trim().split(' ')[0] || 'there'
  const company = companyName.trim() || 'CallBoard'

  const subject = `Set your ${company} CallBoard password`

  const text = [
    `Hi ${greetingName},`,
    '',
    `An account has been created for you in CallBoard, the ${company} service platform.`,
    '',
    'Set your password and log in here:',
    setPasswordUrl,
    '',
    'This link is single use. If it has expired, ask your administrator to resend your invite.',
    '',
    'Thank you,',
    `${company}`,
  ].join('\n')

  // Inline-styled HTML — styled email clients strip <style>, so styles live on
  // the elements directly. Single CTA, no images, ~600px max width.
  const html = `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f5;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e4e4e7;">
          <tr>
            <td style="padding:24px 32px;background:#0f172a;color:#ffffff;font-size:18px;font-weight:600;">
              ${escapeHtml(company)} CallBoard
            </td>
          </tr>
          <tr>
            <td style="padding:32px;color:#1f2937;font-size:15px;line-height:1.55;">
              <p style="margin:0 0 16px;">Hi ${escapeHtml(greetingName)},</p>
              <p style="margin:0 0 24px;">
                An account has been created for you in CallBoard, the
                ${escapeHtml(company)} service platform. Click below to set your
                password and log in.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;">
                <tr>
                  <td>
                    <!--[if mso]>
                    <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${escapeAttr(setPasswordUrl)}" style="height:44px;v-text-anchor:middle;width:200px;" arcsize="14%" stroke="f" fillcolor="#0f172a">
                      <w:anchorlock/>
                      <center style="color:#ffffff;font-family:'Segoe UI',Arial,sans-serif;font-size:15px;font-weight:600;">Set your password</center>
                    </v:roundrect>
                    <![endif]-->
                    <!--[if !mso]><!-- -->
                    <a href="${escapeAttr(setPasswordUrl)}" style="background:#0f172a;border-radius:6px;color:#ffffff;display:inline-block;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;line-height:44px;text-align:center;text-decoration:none;width:200px;mso-hide:all;">Set your password</a>
                    <!--<![endif]-->
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 16px;color:#52525b;font-size:13px;">
                Button not working?
                <a href="${escapeAttr(setPasswordUrl)}" style="color:#0f172a;text-decoration:underline;">Open the set-password page</a>.
              </p>
              <p style="margin:0 0 0;color:#52525b;font-size:13px;">
                This link is single use. If it has expired, ask your administrator to resend your invite.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px;border-top:1px solid #e4e4e7;color:#52525b;font-size:13px;">
              ${escapeHtml(company)}
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
