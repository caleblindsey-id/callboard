// Shared "set your CallBoard password" invite sender. Called from the create-user
// route (auto-send on add) and the resend-invite route (manual re-send from the
// Settings user row). One code path so the recovery link, email, and from-name
// never drift between the two callers. Mirrors send-estimate-notice.ts.
//
// Uses a Supabase *recovery* link rather than emailing a plaintext password.
// We extract only the hashed_token and build our OWN /set-password URL — never
// Supabase's action_link, whose GET-on-/verify would let an email link-scanner
// burn the single-use token before the human clicks. The token is consumed only
// when the user POSTs a new password from /set-password.

import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendMandrillEmail } from '@/lib/mandrill'
import { renderUserInviteEmail } from '@/lib/email-templates/user-invite'

export type SendInviteResult = { sent: true; messageId: string }

// Generates a fresh recovery link for the user's email, renders the invite
// email, and sends it. Throws on a config/link/send failure — the caller wraps
// the call in try/catch and treats a failure as non-fatal (the user is still
// created; the admin can resend or fall back to the temp password).
export async function sendUserInviteEmail(
  input: { email: string; name: string | null },
): Promise<SendInviteResult> {
  const { email, name } = input

  const admin = await createAdminClient('SERVER_ONLY')

  // Mint a single-use recovery token for this account. We only need the
  // hashed_token; the action_link is intentionally discarded.
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: 'recovery',
    email,
  })
  if (linkError || !linkData?.properties?.hashed_token) {
    throw new Error(`sendUserInviteEmail: generateLink failed: ${linkError?.message ?? 'no token'}`)
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, '')
  if (!appUrl) {
    throw new Error('Public app URL is not configured. Set NEXT_PUBLIC_APP_URL.')
  }
  const setPasswordUrl =
    `${appUrl}/set-password?token_hash=${encodeURIComponent(linkData.properties.hashed_token)}&type=recovery`

  // Company name for the from-line + body. Service-role read so it isn't blocked
  // by the RLS a cookie client would hit.
  const { data: settingsRow } = await admin
    .from('settings')
    .select('value')
    .eq('key', 'company_name')
    .maybeSingle()
  const company = (settingsRow?.value as string | null)?.trim() || 'Imperial Dade'

  const message = renderUserInviteEmail({ name, setPasswordUrl, companyName: company })

  const sendResult = await sendMandrillEmail({
    to: { email, name: name ?? undefined },
    subject: message.subject,
    html: message.html,
    text: message.text,
    // Recipient sees the branch, not the internal tool name.
    fromName: company,
    tags: ['user-invite'],
    metadata: { email },
  })

  return { sent: true, messageId: sendResult.messageId }
}
